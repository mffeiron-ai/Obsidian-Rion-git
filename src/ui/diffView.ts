import { ItemView, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type RionGitPlugin from "../main";

export const VIEW_TYPE_RION_GIT_DIFF = "rion-git-diff";

export interface DiffViewState extends Record<string, unknown> {
	path: string;
	untracked: boolean;
	commit?: string;
}

export class DiffView extends ItemView {
	private filePath = "";
	private untracked = false;
	private commitHash = "";
	private renderToken = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: RionGitPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_RION_GIT_DIFF;
	}

	getDisplayText(): string {
		if (!this.filePath) return "Git 差异";
		const name = this.filePath.split("/").pop() ?? this.filePath;
		return this.commitHash
			? `差异：${name} @ ${this.commitHash.slice(0, 7)}`
			: `差异：${name}`;
	}

	getIcon(): string {
		return "file-diff";
	}

	getState(): DiffViewState {
		return {
			path: this.filePath,
			untracked: this.untracked,
			commit: this.commitHash || undefined,
		};
	}

	async setState(state: DiffViewState, result: ViewStateResult): Promise<void> {
		this.filePath = state?.path ?? "";
		this.untracked = state?.untracked ?? false;
		this.commitHash = state?.commit ?? "";
		await super.setState(state, result);
		await this.render();
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	async render(): Promise<void> {
		const token = ++this.renderToken;
		const el = this.contentEl;
		el.empty();
		el.addClass("rion-git-diff-view");

		const header = el.createEl("div", { cls: "rion-git-diff-header" });
		const title = header.createEl("span", { cls: "rion-git-diff-title" });
		title.createSpan({ text: this.filePath || "未选择文件" });
		if (this.commitHash) {
			title.createSpan({
				cls: "rion-git-diff-commit",
				text: ` @ ${this.commitHash.slice(0, 7)}`,
			});
		}

		const meta = header.createEl("div", { cls: "rion-git-diff-meta" });

		const actions = header.createEl("div", { cls: "rion-git-diff-actions" });
		const addButton = (icon: string, label: string, handler: () => void): void => {
			const button = actions.createEl("button", { cls: "clickable-icon" });
			button.setAttribute("aria-label", label);
			button.setAttribute("title", label);
			setIcon(button, icon);
			button.onclick = () => handler();
		};
		addButton("refresh-cw", "重新读取差异", () => void this.render());
		if (!this.commitHash) {
			addButton("check", "提交此文件", () => void this.commit());
			addButton("rotate-ccw", "撤销修改", () => void this.discard());
		}

		const body = el.createEl("div", { cls: "rion-git-diff" });
		body.createEl("div", { cls: "rion-git-empty", text: "读取中…" });

		if (!this.filePath) return;

		const data = await this.plugin.loadDiff(this.filePath, this.untracked, this.commitHash);
		if (token !== this.renderToken) return;

		body.empty();

		meta.createEl("span", { cls: "rion-git-add", text: `+${data.stats.additions}` });
		meta.createEl("span", { cls: "rion-git-del", text: `-${data.stats.deletions}` });

		if (data.note) {
			body.createEl("div", { cls: "rion-git-empty", text: data.note });
		}

		for (const line of data.lines.slice(0, 5000)) {
			body.createEl("div", {
				cls: `rion-git-diff-line is-${line.kind}`,
				text: line.text,
			});
		}

		if (data.lines.length > 5000) {
			body.createEl("div", {
				cls: "rion-git-empty",
				text: `还有 ${data.lines.length - 5000} 行未显示…`,
			});
		}
	}

	private async commit(): Promise<void> {
		await this.plugin.commitFile(this.filePath);
		await this.render();
	}

	private async discard(): Promise<void> {
		await this.plugin.discardFile(this.plugin.findChange(this.filePath));
		await this.render();
	}
}
