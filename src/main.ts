import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import { AutoCommitManager } from "./autoCommit";
import { registerCommands } from "./commands";
import {
	diffStats,
	parseDiff,
	readCommitFileDiff,
	readFileDiff,
	readUntrackedDiff,
} from "./git/diff";
import type { DiffLine } from "./git/diff";
import { GitQueue } from "./git/exec";
import { readCommitFiles, readLog } from "./git/log";
import {
	commitAll as gitCommitAll,
	commitFile as gitCommitFile,
	discardFile as gitDiscardFile,
	initRepo as gitInitRepo,
	pull as gitPull,
	push as gitPush,
} from "./git/ops";
import { detectRepo } from "./git/repo";
import { readStatus } from "./git/status";
import { countChangedLines } from "./git/stats";
import {
	DEFAULT_SETTINGS,
	formatCommitMessage,
	normalizeSettings,
	RionGitSettingTab,
} from "./settings";
import type { AutoCommitMode, RionGitSettings } from "./settings";
import type { CommitFile, FileChange, GitContext, LogEntry, RepoStatus } from "./types";
import { ChangesModal } from "./ui/changesModal";
import { ConfirmModal } from "./ui/confirmModal";
import { DiffView, VIEW_TYPE_RION_GIT_DIFF } from "./ui/diffView";
import { RionGitView, VIEW_TYPE_RION_GIT } from "./ui/sidebarView";
import { GitStatusBar } from "./ui/statusBar";
import { VaultWatcher } from "./vaultWatcher";

const AUTO_RETRY_COOLDOWN_MS = 5 * 60_000;
const HISTORY_LIMIT = 30;
/** 面板打开时的状态轮询间隔。 */
const STATUS_REFRESH_MS = 30_000;

export default class RionGitPlugin extends Plugin {
	settings: RionGitSettings = { ...DEFAULT_SETTINGS };

	/** 侧边栏与状态栏共用的最新快照。 */
	lastStatus: RepoStatus | null = null;
	lastLog: LogEntry[] = [];
	lastError: string | null = null;

	private queue = new GitQueue();
	private cwd = "";
	private statusBar: GitStatusBar | null = null;
	private autoCommit: AutoCommitManager | null = null;
	private watcher: VaultWatcher | null = null;
	private autoCooldownUntil = 0;
	private lastActiveMode: AutoCommitMode = "interval";

	async onload(): Promise<void> {
		await this.loadSettings();

		this.cwd = (this.app.vault.adapter as FileSystemAdapter).getBasePath();

		this.registerView(VIEW_TYPE_RION_GIT, (leaf) => new RionGitView(leaf, this));
		this.registerView(
			VIEW_TYPE_RION_GIT_DIFF,
			(leaf) => new DiffView(leaf, this)
		);

		this.addSettingTab(new RionGitSettingTab(this.app, this));
		this.addRibbonIcon("git-branch", "Rion Git: 打开面板", () => {
			void this.activateView();
		});

		if (this.settings.showStatusBar) {
			this.statusBar = new GitStatusBar(this);
		}

		registerCommands(this);

		this.autoCommit = new AutoCommitManager(this);
		this.autoCommit.register();

		this.watcher = new VaultWatcher(this);
		this.watcher.register();

		// 不再监听 vault 变更事件，面板打开时靠轻量轮询保持状态新鲜。
		this.registerInterval(
			window.setInterval(() => {
				if (this.app.workspace.getLeavesOfType(VIEW_TYPE_RION_GIT).length === 0) {
					return;
				}
				void this.refresh();
			}, STATUS_REFRESH_MS)
		);

		this.app.workspace.onLayoutReady(() => {
			void this.refresh();
			if (this.settings.autoOpenPanel) void this.ensurePanelVisible();
		});
	}

	onunload(): void {
		this.autoCommit?.dispose();
		this.watcher?.dispose();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_RION_GIT);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_RION_GIT_DIFF);
	}

	private get ctx(): GitContext {
		return { cwd: this.cwd, gitPath: this.settings.gitPath };
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		if (this.settings.autoCommitMode !== "off") {
			this.lastActiveMode = this.settings.autoCommitMode;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	applyAutoSettings(): void {
		this.autoCommit?.applySettings();
	}

	async toggleAutoCommit(): Promise<void> {
		if (this.settings.autoCommitMode === "off") {
			this.settings.autoCommitMode = this.lastActiveMode;
		} else {
			this.lastActiveMode = this.settings.autoCommitMode;
			this.settings.autoCommitMode = "off";
		}

		await this.saveSettings();
		this.applyAutoSettings();
		this.refreshViews();
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_RION_GIT);
		const first = existing[0];
		if (first) {
			await workspace.revealLeaf(first);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_RION_GIT, active: true });
		await workspace.revealLeaf(leaf);
	}

	/** 布局恢复后调用：只有面板确实不存在时才创建，避免覆盖用户的侧边栏布局。 */
	async ensurePanelVisible(): Promise<void> {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE_RION_GIT).length > 0) {
			return;
		}
		await this.activateView();
	}

	async refresh(): Promise<void> {
		await this.queue.add(() => this.refreshInQueue());
	}

	async loadCommitFiles(hash: string): Promise<CommitFile[]> {
		return this.queue.add(() => readCommitFiles(this.ctx, hash));
	}

	async commitAll(): Promise<boolean> {
		return this.commitWithMessage("");
	}

	async commitWithMessage(message: string): Promise<boolean> {
		const text =
			message.trim() ||
			formatCommitMessage(this.settings.commitMessageTemplate);

		let ok = false;
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;
			this.statusBar?.busy("提交中…");

			const result = await gitCommitAll(this.ctx, text);
			this.notify(result);
			await this.refreshInQueue();
			ok = result.ok;
		});
		return ok;
	}

	async push(): Promise<boolean> {
		let ok = false;
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;
			this.statusBar?.busy("推送中…");

			const result = await gitPush(this.ctx);
			this.notify(result);
			await this.refreshInQueue();
			ok = result.ok;
		});
		return ok;
	}

	async pull(): Promise<boolean> {
		let ok = false;
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;
			this.statusBar?.busy("拉取中…");

			const result = await gitPull(this.ctx);
			this.notify(result);
			await this.refreshInQueue();
			ok = result.ok;
		});
		return ok;
	}

	async commitAndPush(message = ""): Promise<boolean> {
		let ok = false;
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;
			this.statusBar?.busy("提交中…");

			const text =
				message.trim() ||
				formatCommitMessage(this.settings.commitMessageTemplate);
			const commit = await gitCommitAll(this.ctx, text);
			if (!commit.ok) {
				this.notify(commit);
				await this.refreshInQueue();
				return;
			}

			this.statusBar?.busy("推送中…");
			const pushed = await gitPush(this.ctx);
			this.notify({
				ok: pushed.ok,
				message: pushed.ok
					? `已提交 ${commit.count ?? 0} 个改动并推送。`
					: pushed.message,
			});
			await this.refreshInQueue();
			ok = pushed.ok;
		});
		return ok;
	}

	async showChanges(): Promise<void> {
		const status = await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return null;
			return readStatus(this.ctx);
		});
		if (!status) return;

		this.lastStatus = status;
		this.statusBar?.update(status);
		this.refreshViews();
		new ChangesModal(this.app, this, status).open();
	}

	async showDiff(change: FileChange): Promise<void> {
		await this.openDiffView({
			path: change.path,
			untracked: change.index === "?" && change.worktree === "?",
		});
	}

	async showCommitDiff(hash: string, filePath: string): Promise<void> {
		await this.openDiffView({ path: filePath, untracked: false, commit: hash });
	}

	private async openDiffView(state: {
		path: string;
		untracked: boolean;
		commit?: string;
	}): Promise<void> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_RION_GIT_DIFF,
			active: true,
			state,
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	async loadDiff(
		filePath: string,
		untracked: boolean,
		commit = ""
	): Promise<{ lines: DiffLine[]; stats: { additions: number; deletions: number }; note?: string }> {
		let raw = "";
		let note: string | undefined;

		if (commit) {
			raw = await this.queue.add(() =>
				readCommitFileDiff(this.ctx, commit, filePath)
			);
			if (!raw.trim()) note = "该提交没有改动这个文件。";
		} else if (untracked) {
			const result = await readUntrackedDiff(this.ctx, filePath);
			raw = result.text;
			note = result.note;
		} else {
			raw = await this.queue.add(() => readFileDiff(this.ctx, filePath));
			if (!raw.trim()) note = "没有可显示的差异（文件可能已恢复或为空）。";
		}

		const lines = parseDiff(raw);
		return { lines, stats: diffStats(lines), note };
	}

	findChange(filePath: string): FileChange {
		const found = this.lastStatus?.files.find((file) => file.path === filePath);
		return found ?? { path: filePath, index: "M", worktree: "M" };
	}

	/** 供 vault 事件使用：只刷新状态，不读历史、不提交。 */
	async refreshStatusOnly(): Promise<void> {
		await this.queue.add(async () => {
			const detection = await detectRepo(this.ctx);
			if (detection.kind !== "ok") {
				this.lastStatus = null;
				this.lastError = detection.detail;
				this.statusBar?.showError(detection.detail);
				this.refreshViews();
				return;
			}

			this.lastError = null;
			this.lastStatus = await readStatus(this.ctx);
			this.statusBar?.update(this.lastStatus);
			this.refreshViews();
			await this.maybeSmartCommit(this.lastStatus);
		});
	}

	async commitFile(filePath: string): Promise<void> {
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;
			this.statusBar?.busy("提交中…");

			const result = await gitCommitFile(
				this.ctx,
				filePath,
				formatCommitMessage(this.settings.commitMessageTemplate)
			);
			this.notify(result);
			await this.refreshInQueue();
		});
	}

	async discardFile(change: FileChange): Promise<void> {
		const untracked = change.index === "?" && change.worktree === "?";
		const message = untracked
			? `将删除未跟踪文件「${change.path}」，此操作不可恢复。`
			: `将丢弃「${change.path}」的所有改动，此操作不可恢复。`;

		new ConfirmModal(this.app, message, () => {
			void this.runDiscard(change);
		}).open();
	}

	private async runDiscard(change: FileChange): Promise<void> {
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;

			const result = await gitDiscardFile(this.ctx, change);
			this.notify(result);
			await this.refreshInQueue();
		});
	}

	async initRepo(): Promise<boolean> {
		let ok = false;
		await this.queue.add(async () => {
			this.statusBar?.busy("初始化…");

			const result = await gitInitRepo(this.ctx);
			if (result.ok) await this.ensureDefaultGitignore();

			this.notify(result);
			await this.refreshInQueue();
			ok = result.ok;
		});
		return ok;
	}

	/** 定时提交入口（只有 autoCommitMode === "interval" 时会被调度）。 */
	async runAutoCommit(reason: string): Promise<void> {
		await this.queue.add(async () => {
			if (this.settings.autoCommitMode !== "interval") return;
			if (Date.now() < this.autoCooldownUntil) return;

			const detection = await detectRepo(this.ctx);
			if (detection.kind !== "ok") {
				this.lastStatus = null;
				this.lastError = detection.detail;
				this.refreshViews();
				return;
			}

			await this.commitSilently(reason);
		});
	}

	/** 智能提交：改动文件数或改动行数达到阈值时触发，与定时模式互斥。 */
	private async maybeSmartCommit(status: RepoStatus): Promise<void> {
		const settings = this.settings;
		if (settings.autoCommitMode !== "smart") return;
		if (status.files.length === 0) return;
		if (Date.now() < this.autoCooldownUntil) return;

		if (
			settings.smartFileThreshold > 0 &&
			status.files.length >= settings.smartFileThreshold
		) {
			await this.commitSilently(`改动 ${status.files.length} 个文件`);
			return;
		}

		if (settings.smartLineThreshold <= 0) return;

		const untracked = status.files
			.filter((file) => file.index === "?" && file.worktree === "?")
			.map((file) => file.path);
		const lines = await countChangedLines(this.ctx, untracked);
		if (lines < settings.smartLineThreshold) return;

		await this.commitSilently(`改动 ${lines} 行`);
	}

	private async commitSilently(trigger: string): Promise<void> {
		console.debug(`[Rion Git] 自动提交（${trigger}）`);

		const result = await gitCommitAll(
			this.ctx,
			formatCommitMessage(this.settings.commitMessageTemplate)
		);
		if (!result.ok) {
			this.autoCooldownUntil = Date.now() + AUTO_RETRY_COOLDOWN_MS;
			new Notice(
				`Rion Git 自动提交失败：${result.message}（5 分钟内不再重试）`,
				8000
			);
			await this.refreshInQueue();
			return;
		}

		if ((result.count ?? 0) > 0 && this.settings.autoPush) {
			const pushed = await gitPush(this.ctx);
			if (!pushed.ok) {
				this.autoCooldownUntil = Date.now() + AUTO_RETRY_COOLDOWN_MS;
				new Notice(`Rion Git 自动推送失败：${pushed.message}`, 8000);
			}
		}

		await this.refreshInQueue();
	}

	private async refreshInQueue(): Promise<void> {
		const detection = await detectRepo(this.ctx);
		if (detection.kind !== "ok") {
			this.lastStatus = null;
			this.lastLog = [];
			this.lastError = detection.detail;
			this.statusBar?.showError(detection.detail);
			this.refreshViews();
			return;
		}

		this.lastError = null;
		this.lastStatus = await readStatus(this.ctx);
		this.lastLog = await readLog(this.ctx, HISTORY_LIMIT);
		this.statusBar?.update(this.lastStatus);
		this.refreshViews();
	}

	private refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RION_GIT)) {
			if (leaf.view instanceof RionGitView) leaf.view.render();
		}
	}

	private async ensureRepo(): Promise<boolean> {
		const detection = await detectRepo(this.ctx);
		if (detection.kind === "ok") return true;

		if (detection.kind === "no-repo") {
			new Notice(
				"当前 vault 还不是 git 仓库。可执行命令「Rion Git: 初始化仓库」。",
				8000
			);
		} else {
			new Notice(detection.detail, 8000);
		}
		return false;
	}

	private notify(result: { ok: boolean; message: string }): void {
		new Notice(
			result.ok ? result.message : `Rion Git: ${result.message}`,
			result.ok ? 3000 : 8000
		);
	}

	private async ensureDefaultGitignore(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(".gitignore")) return;

		await adapter.write(
			".gitignore",
			[
				".obsidian/workspace.json",
				".obsidian/workspace-mobile.json",
				".trash/",
				"",
			].join("\n")
		);
	}
}
