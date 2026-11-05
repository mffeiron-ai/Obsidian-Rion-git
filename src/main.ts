import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import { AutoCommitManager } from "./autoCommit";
import { registerCommands } from "./commands";
import { GitQueue } from "./git/exec";
import { readCommitFiles, readLog } from "./git/log";
import {
	commitAll as gitCommitAll,
	initRepo as gitInitRepo,
	pull as gitPull,
	push as gitPush,
} from "./git/ops";
import { detectRepo } from "./git/repo";
import { readStatus } from "./git/status";
import {
	DEFAULT_SETTINGS,
	formatCommitMessage,
	RionGitSettingTab,
} from "./settings";
import type { RionGitSettings } from "./settings";
import type { CommitFile, GitContext, LogEntry, RepoStatus } from "./types";
import { ChangesModal } from "./ui/changesModal";
import { RionGitView, VIEW_TYPE_RION_GIT } from "./ui/sidebarView";
import { GitStatusBar } from "./ui/statusBar";

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
	private autoCooldownUntil = 0;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.cwd = (this.app.vault.adapter as FileSystemAdapter).getBasePath();

		this.registerView(VIEW_TYPE_RION_GIT, (leaf) => new RionGitView(leaf, this));

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

		// 不再监听 vault 变更事件，面板打开时靠轻量轮询保持状态新鲜。
		this.registerInterval(
			window.setInterval(() => {
				if (this.app.workspace.getLeavesOfType(VIEW_TYPE_RION_GIT).length === 0) {
					return;
				}
				void this.refresh();
			}, STATUS_REFRESH_MS)
		);

		this.app.workspace.onLayoutReady(() => void this.refresh());
	}

	onunload(): void {
		this.autoCommit?.dispose();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_RION_GIT);
	}

	private get ctx(): GitContext {
		return { cwd: this.cwd, gitPath: this.settings.gitPath };
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) ?? {};
		const settings = { ...DEFAULT_SETTINGS };
		const target = settings as Record<string, unknown>;

		// 只接受当前版本仍然存在的键，避免旧版本遗留的设置项被反复写回。
		for (const key of Object.keys(DEFAULT_SETTINGS)) {
			const value = stored[key];
			if (value !== undefined && typeof value === typeof target[key]) {
				target[key] = value;
			}
		}

		this.settings = settings;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	applyAutoSettings(): void {
		this.autoCommit?.applySettings();
	}

	async toggleAutoCommit(): Promise<void> {
		this.settings.autoCommitEnabled = !this.settings.autoCommitEnabled;
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

	/** 自动提交入口：成功时静默，只更新界面；失败则进入冷却期，避免反复弹窗。 */
	async runAutoCommit(reason: string): Promise<void> {
		console.debug(`[Rion Git] 自动提交触发（${reason}）`);

		await this.queue.add(async () => {
			if (!this.settings.autoCommitEnabled) return;
			if (Date.now() < this.autoCooldownUntil) return;

			const detection = await detectRepo(this.ctx);
			if (detection.kind !== "ok") {
				this.lastStatus = null;
				this.lastError = detection.detail;
				this.refreshViews();
				return;
			}

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
		});
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
