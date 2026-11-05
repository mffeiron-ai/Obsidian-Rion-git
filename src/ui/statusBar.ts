import type RionGitPlugin from "../main";
import type { RepoStatus } from "../types";

export class GitStatusBar {
	private el: HTMLElement;

	constructor(plugin: RionGitPlugin) {
		this.el = plugin.addStatusBarItem();
		this.el.addClass("rion-git-status");
		this.render("Git …", "Rion Git 正在检测仓库…");
		this.el.onClickEvent(() => void plugin.activateView());
	}

	busy(label: string): void {
		this.render(`Git ⟳ ${label}`, label);
	}

	update(status: RepoStatus): void {
		const branch = status.branch ?? "无提交";
		if (status.hasConflicts) {
			this.render("Git ⚠ 冲突", `分支 ${branch}：存在合并冲突`);
			return;
		}
		if (status.files.length === 0) {
			this.render("Git ✓", `分支 ${branch}：工作区干净`);
			return;
		}
		this.render(
			`Git • ${status.files.length}`,
			`分支 ${branch}：${status.files.length} 个改动（点击打开面板）`
		);
	}

	showError(text: string): void {
		this.render("Git ⚠", text);
	}

	private render(label: string, tooltip: string): void {
		this.el.setText(label);
		this.el.setAttribute("aria-label", tooltip);
		this.el.setAttribute("title", tooltip);
	}
}
