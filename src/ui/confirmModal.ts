import { Modal } from "obsidian";
import type { App } from "obsidian";

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private message: string,
		private onConfirm: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: "确认操作" });
		contentEl.createEl("p", { text: this.message });

		const actions = contentEl.createEl("div", { cls: "rion-git-modal-actions" });

		const cancel = actions.createEl("button", { text: "取消" });
		cancel.onclick = () => this.close();

		const confirm = actions.createEl("button", { text: "确定", cls: "mod-warning" });
		confirm.onclick = () => {
			this.close();
			this.onConfirm();
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
