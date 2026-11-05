import { FileSystemAdapter, Menu, Notice, Plugin } from "obsidian";
import { registerCommands } from "./commands";
import { GitQueue } from "./git/exec";
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
import type { GitContext } from "./types";
import { ChangesModal } from "./ui/changesModal";
import { GitStatusBar } from "./ui/statusBar";

export default class RionGitPlugin extends Plugin {
	settings: RionGitSettings = { ...DEFAULT_SETTINGS };

	private queue = new GitQueue();
	private cwd = "";
	private statusBar: GitStatusBar | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.cwd = (this.app.vault.adapter as FileSystemAdapter).getBasePath();

		this.addSettingTab(new RionGitSettingTab(this.app, this));
		this.addRibbonIcon("git-branch", "Rion Git", (evt) => this.openMenu(evt));

		if (this.settings.showStatusBar) {
			this.statusBar = new GitStatusBar(this);
		}

		registerCommands(this);

		this.app.workspace.onLayoutReady(() => void this.refresh());
	}

	onunload(): void {
		console.info("[Rion Git] 已卸载");
	}

	private get ctx(): GitContext {
		return { cwd: this.cwd, gitPath: this.settings.gitPath };
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async refresh(): Promise<void> {
		await this.queue.add(() => this.refreshInQueue());
	}

	async commitAll(): Promise<void> {
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;
			this.statusBar?.busy("提交中…");

			const result = await gitCommitAll(
				this.ctx,
				formatCommitMessage(this.settings.commitMessageTemplate)
			);
			this.notify(result);
			await this.refreshInQueue();
		});
	}

	async push(): Promise<void> {
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;
			this.statusBar?.busy("推送中…");

			const result = await gitPush(this.ctx);
			this.notify(result);
			await this.refreshInQueue();
		});
	}

	async pull(): Promise<void> {
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;
			this.statusBar?.busy("拉取中…");

			const result = await gitPull(this.ctx);
			this.notify(result);
			await this.refreshInQueue();
		});
	}

	async commitAndPush(): Promise<void> {
		await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return;
			this.statusBar?.busy("提交中…");

			const commit = await gitCommitAll(
				this.ctx,
				formatCommitMessage(this.settings.commitMessageTemplate)
			);
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
		});
	}

	async showChanges(): Promise<void> {
		const status = await this.queue.add(async () => {
			if (!(await this.ensureRepo())) return null;
			return readStatus(this.ctx);
		});
		if (!status) return;

		this.statusBar?.update(status);
		new ChangesModal(this.app, this, status).open();
	}

	async initRepo(): Promise<void> {
		await this.queue.add(async () => {
			this.statusBar?.busy("初始化…");

			const result = await gitInitRepo(this.ctx);
			if (result.ok) await this.ensureDefaultGitignore();

			this.notify(result);
			await this.refreshInQueue();
		});
	}

	private async refreshInQueue(): Promise<void> {
		const detection = await detectRepo(this.ctx);
		if (detection.kind !== "ok") {
			this.statusBar?.showError(detection.detail);
			return;
		}

		const status = await readStatus(this.ctx);
		this.statusBar?.update(status);
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

	private openMenu(evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("提交全部改动")
				.setIcon("save")
				.onClick(() => void this.commitAll())
		);
		menu.addItem((item) =>
			item
				.setTitle("提交并推送")
				.setIcon("upload")
				.onClick(() => void this.commitAndPush())
		);
		menu.addItem((item) =>
			item
				.setTitle("推送")
				.setIcon("upload")
				.onClick(() => void this.push())
		);
		menu.addItem((item) =>
			item
				.setTitle("拉取")
				.setIcon("download")
				.onClick(() => void this.pull())
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("查看改动")
				.setIcon("list")
				.onClick(() => void this.showChanges())
		);
		menu.showAtMouseEvent(evt);
	}
}
