import type RionGitPlugin from "./main";

/** git 自身产物、回收站、插件构建产物不触发界面刷新。 */
const NOISE_PREFIXES = [".git/", ".git", ".trash/", ".trash", ".obsidian/plugins/"];
const NOISE_EXACT = [".obsidian/workspace.json", ".obsidian/workspace-mobile.json"];

export function isNoisePath(path: string): boolean {
	if (NOISE_EXACT.includes(path)) return true;
	return NOISE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * 只用于「界面及时刷新」：合并高频文件事件后更新状态栏与面板。
 * 不参与提交决策——自动提交仍然只由定时器触发。
 */
export class VaultWatcher {
	private timer: number | null = null;

	constructor(private plugin: RionGitPlugin) {}

	register(): void {
		const vault = this.plugin.app.vault;
		const onChange = (path: string): void => {
			if (isNoisePath(path)) return;
			this.schedule();
		};

		this.plugin.registerEvent(vault.on("modify", (file) => onChange(file.path)));
		this.plugin.registerEvent(vault.on("create", (file) => onChange(file.path)));
		this.plugin.registerEvent(vault.on("delete", (file) => onChange(file.path)));
		this.plugin.registerEvent(
			vault.on("rename", (file, oldPath) => {
				onChange(file.path);
				onChange(oldPath);
			})
		);
	}

	dispose(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
	}

	private schedule(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.plugin.refreshStatusOnly();
		}, 700);
	}
}
