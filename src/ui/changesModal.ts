import { App, Modal } from "obsidian";
import type RionGitPlugin from "../main";
import { statusLabel } from "../git/status";
import type { RepoStatus } from "../types";

const MAX_ROWS = 100;

export class ChangesModal extends Modal {
	constructor(
		app: App,
		private plugin: RionGitPlugin,
		private status: RepoStatus
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("rion-git-modal");

		contentEl.createEl("h2", { text: `Git 改动（${this.status.files.length}）` });
		contentEl.createEl("p", {
			text: `分支：${this.status.branch ?? "（还没有提交）"}`,
			cls: "rion-git-branch",
		});

		const list = contentEl.createEl("div", { cls: "rion-git-file-list" });
		if (this.status.files.length === 0) {
			list.createEl("p", { text: "工作区是干净的。" });
		}
		for (const file of this.status.files.slice(0, MAX_ROWS)) {
			const row = list.createEl("div", { cls: "rion-git-file-row" });
			row.createEl("span", { text: statusLabel(file), cls: "rion-git-file-state" });
			row.createEl("span", { text: file.path, cls: "rion-git-file-path" });
		}
		if (this.status.files.length > MAX_ROWS) {
			list.createEl("p", {
				text: `还有 ${this.status.files.length - MAX_ROWS} 个文件未显示…`,
			});
		}

		const actions = contentEl.createEl("div", { cls: "rion-git-modal-actions" });
		const addButton = (label: string, action: () => void): void => {
			const button = actions.createEl("button", { text: label });
			button.onclick = () => {
				this.close();
				action();
			};
		};
		addButton("提交全部", () => void this.plugin.commitAll());
		addButton("推送", () => void this.plugin.push());
		addButton("拉取", () => void this.plugin.pull());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
