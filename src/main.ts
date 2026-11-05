import { Notice, Plugin } from "obsidian";
import type { FileSystemAdapter } from "obsidian";

export default class RionGitPlugin extends Plugin {
	async onload(): Promise<void> {
		const vaultPath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
		console.info(
			`[Rion Git] v${this.manifest.version} 已加载，vault: ${vaultPath}`
		);
		new Notice(`Rion Git 已加载（v${this.manifest.version}）`);
	}

	onunload(): void {
		console.info("[Rion Git] 已卸载");
	}
}
