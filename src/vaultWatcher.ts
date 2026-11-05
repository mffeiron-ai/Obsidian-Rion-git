import type RionGitPlugin from "./main";

/**
 * 只用于「界面及时刷新」：合并高频文件事件后更新状态栏与面板。
 * 不参与提交决策——自动提交由定时器或阈值触发。
 */
export class VaultWatcher {
	private timer: number | null = null;

	constructor(private plugin: RionGitPlugin) {}

	register(): void {
		const vault = this.plugin.app.vault;
		const onChange = (path: string): void => {
			if (isNoisePath(path, vault.configDir)) return;
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

/**
 * git 自身产物、回收站、插件构建产物不触发界面刷新。
 * 配置目录名可由用户自定义，因此需要传入 `Vault#configDir` 的实际值。
 */
export function isNoisePath(path: string, configDir: string): boolean {
	if (path.startsWith(".git/") || path === ".git") return true;
	if (path.startsWith(".trash/") || path === ".trash") return true;
	if (path.startsWith(configDir + "/plugins/")) return true;
	if (path === configDir + "/workspace.json") return true;
	if (path === configDir + "/workspace-mobile.json") return true;
	return false;
}