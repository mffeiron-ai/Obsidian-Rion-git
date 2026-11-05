import { ItemView, Menu, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type RionGitPlugin from "../main";
import { isConflict, statusLabel } from "../git/status";
import type { RionGitSettings } from "../settings";
import type { CommitFile, FileChange, LogEntry } from "../types";

export const VIEW_TYPE_RION_GIT = "rion-git-sidebar";

const MAX_ROWS = 200;

interface SectionAction {
	icon: string;
	label: string;
	action: (evt: MouseEvent) => void;
}

function autoSummary(settings: RionGitSettings): string {
	const push = settings.autoPush ? "，并自动推送" : "";

	if (settings.autoCommitMode === "interval") {
		return settings.autoCommitInterval > 0
			? `自动提交：每 ${settings.autoCommitInterval} 分钟${push}`
			: "自动提交：关闭";
	}

	if (settings.autoCommitMode === "smart") {
		const parts: string[] = [];
		if (settings.smartFileThreshold > 0) {
			parts.push(`≥${settings.smartFileThreshold} 个文件`);
		}
		if (settings.smartLineThreshold > 0) {
			parts.push(`≥${settings.smartLineThreshold} 行`);
		}
		return parts.length > 0
			? `自动提交：${parts.join(" 或 ")}${push}`
			: "自动提交：关闭";
	}

	return "自动提交：关闭";
}

function changeBadge(change: FileChange): string {
	if (isConflict(change)) return "!";
	if (change.index === "?" && change.worktree === "?") return "U";
	if (change.index === "D" || change.worktree === "D") return "D";
	if (change.index === "R" || change.worktree === "R") return "R";
	if (change.index === "A") return "A";
	return "M";
}

function splitPath(path: string): { name: string; dir: string } {
	const index = path.lastIndexOf("/");
	if (index === -1) return { name: path, dir: "" };
	return { name: path.slice(index + 1), dir: path.slice(0, index) };
}

export class RionGitView extends ItemView {
	private collapsed = new Set<string>();
	private expandedCommits = new Set<string>();
	private commitFiles = new Map<string, CommitFile[]>();
	private draft = "";
	private messageEl: HTMLTextAreaElement | null = null;
	private pendingRender = false;
	private restoreFocus = false;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: RionGitPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_RION_GIT;
	}

	getDisplayText(): string {
		return "Rion Git";
	}

	getIcon(): string {
		return "git-branch";
	}

	async onOpen(): Promise<void> {
		this.render();
		void this.plugin.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	render(force = false): void {
		// 轮询刷新时如果用户正在输入提交消息，推迟到失焦后再渲染，避免打断输入。
		if (!force && this.messageEl && document.activeElement === this.messageEl) {
			this.pendingRender = true;
			return;
		}
		this.pendingRender = false;

		const el = this.contentEl;
		el.empty();
		el.addClass("rion-git-sidebar");

		if (this.plugin.lastError) {
			el.createEl("div", { cls: "rion-git-error", text: this.plugin.lastError });
		}

		this.renderCommitBox(el);
		this.renderChangesSection(el);
		this.renderHistorySection(el);
	}

	private renderCommitBox(el: HTMLElement): void {
		const status = this.plugin.lastStatus;
		const box = el.createEl("div", { cls: "rion-git-commit-box" });

		const input = box.createEl("textarea", {
			cls: "rion-git-message",
			attr: {
				rows: "2",
				placeholder: `消息（Enter 在 "${status?.branch ?? "当前分支"}" 上提交）`,
			},
		});
		input.value = this.draft;
		this.messageEl = input;
		if (this.restoreFocus) {
			this.restoreFocus = false;
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		}
		input.addEventListener("input", () => {
			this.draft = input.value;
		});
		input.addEventListener("blur", () => {
			if (!this.pendingRender) return;
			this.pendingRender = false;
			this.render(true);
		});
		input.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter" || evt.shiftKey) return;
			evt.preventDefault();
			void this.commit();
		});

		const actions = box.createEl("div", { cls: "rion-git-commit-actions" });

		const commitButton = actions.createEl("button", { cls: "mod-cta rion-git-commit-btn" });
		setIcon(commitButton.createSpan({ cls: "rion-git-btn-icon" }), "check");
		commitButton.createSpan({ text: "提交" });
		commitButton.onclick = () => void this.commit();

		const caret = actions.createEl("button", { cls: "mod-cta rion-git-caret" });
		caret.setAttribute("aria-label", "更多提交方式");
		setIcon(caret, "chevron-down");
		caret.onclick = (evt) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("提交")
					.setIcon("check")
					.onClick(() => void this.commit())
			);
			menu.addItem((item) =>
				item
					.setTitle("提交并推送")
					.setIcon("upload")
					.onClick(() => void this.commitAndPush())
			);
			menu.showAtMouseEvent(evt);
		};

		box.createEl("div", {
			cls: "rion-git-auto-hint",
			text: autoSummary(this.plugin.settings),
		});
	}

	private async commit(): Promise<void> {
		const ok = await this.plugin.commitWithMessage(this.draft.trim());
		if (ok) {
			this.draft = "";
			this.restoreFocus = true;
			this.render(true);
		}
	}

	private async commitAndPush(): Promise<void> {
		const ok = await this.plugin.commitAndPush(this.draft.trim());
		if (ok) {
			this.draft = "";
			this.restoreFocus = true;
			this.render(true);
		}
	}

	private renderChangesSection(el: HTMLElement): void {
		const status = this.plugin.lastStatus;
		const files = status?.files ?? [];
		const auto = this.plugin.settings.autoCommitMode !== "off";

		const body = this.createSection(
			el,
			"changes",
			"更改",
			files.length > 0 ? String(files.length) : undefined,
			[
				{
					icon: auto ? "zap" : "zap-off",
					label: auto ? "自动提交：开（点击关闭）" : "自动提交：关（点击开启）",
					action: () => void this.plugin.toggleAutoCommit(),
				},
				{
					icon: "refresh-cw",
					label: "刷新",
					action: () => void this.plugin.refresh(),
				},
				{
					icon: "more-horizontal",
					label: "更多操作",
					action: (evt) => this.openMoreMenu(evt),
				},
			]
		);
		if (!body) return;

		if (!status) {
			body.createEl("div", { cls: "rion-git-empty", text: "正在检测仓库…" });
			return;
		}

		if (files.length === 0) {
			body.createEl("div", { cls: "rion-git-empty", text: "工作区是干净的。" });
			return;
		}

		for (const file of files.slice(0, MAX_ROWS)) {
			this.renderFileRow(body, changeBadge(file), file.path, statusLabel(file), {
				onOpen: () => void this.plugin.showDiff(file),
				onCommit: () => void this.plugin.commitFile(file.path),
				onDiscard: () => void this.plugin.discardFile(file),
			});
		}

		if (files.length > MAX_ROWS) {
			body.createEl("div", {
				cls: "rion-git-empty",
				text: `还有 ${files.length - MAX_ROWS} 个文件未显示…`,
			});
		}
	}

	private renderHistorySection(el: HTMLElement): void {
		const log = this.plugin.lastLog;
		const body = this.createSection(
			el,
			"history",
			"历史提交",
			log.length > 0 ? String(log.length) : undefined,
			[
				{ icon: "download", label: "拉取", action: () => void this.plugin.pull() },
				{ icon: "upload", label: "推送", action: () => void this.plugin.push() },
				{
					icon: "activity",
					label: "历史统计",
					action: () => void this.plugin.openStatsView(),
				},
				{
					icon: "refresh-cw",
					label: "刷新历史",
					action: () => void this.plugin.refresh(),
				},
			]
		);
		if (!body) return;

		if (log.length === 0) {
			body.createEl("div", { cls: "rion-git-empty", text: "还没有提交记录。" });
			return;
		}

		for (const entry of log) this.renderCommitRow(body, entry);
	}

	private renderCommitRow(parent: HTMLElement, entry: LogEntry): void {
		const expanded = this.expandedCommits.has(entry.hash);
		const item = parent.createEl("div", { cls: "rion-git-commit-item" });

		const head = item.createEl("div", { cls: "rion-git-commit-head" });
		head.createEl("span", { cls: "rion-git-commit-dot" });

		const subject = head.createEl("span", {
			cls: "rion-git-commit-subject",
			text: entry.subject,
		});
		subject.setAttribute("title", entry.subject);

		if (entry.refs.length > 0) {
			const refs = head.createEl("span", { cls: "rion-git-refs" });
			for (const ref of entry.refs) {
				refs.createEl("span", { cls: "rion-git-ref", text: ref });
			}
		}

		head.onclick = () => void this.toggleCommit(entry.hash);

		if (!expanded) return;

		const files = this.commitFiles.get(entry.hash);
		const filesEl = item.createEl("div", { cls: "rion-git-commit-files" });

		if (!files) {
			filesEl.createEl("div", { cls: "rion-git-empty", text: "读取中…" });
			return;
		}
		if (files.length === 0) {
			filesEl.createEl("div", { cls: "rion-git-empty", text: "没有文件变更。" });
			return;
		}

		for (const file of files) {
			this.renderFileRow(filesEl, file.status, file.path, file.status, {
				onOpen: () => void this.plugin.showCommitDiff(entry.hash, file.path),
			});
		}
	}

	private async toggleCommit(hash: string): Promise<void> {
		if (this.expandedCommits.has(hash)) {
			this.expandedCommits.delete(hash);
			this.render();
			return;
		}

		this.expandedCommits.add(hash);
		this.render();

		if (this.commitFiles.has(hash)) return;
		const files = await this.plugin.loadCommitFiles(hash);
		this.commitFiles.set(hash, files);
		this.render();
	}

	private renderFileRow(
		parent: HTMLElement,
		badge: string,
		path: string,
		tooltip: string,
		actions?: { onOpen: () => void; onCommit?: () => void; onDiscard?: () => void }
	): void {
		const { name, dir } = splitPath(path);
		const row = parent.createEl("div", { cls: "rion-git-file-row" });
		row.setAttribute("title", tooltip);
		row.createEl("span", { cls: `rion-git-file-badge mod-${badge}`, text: badge });
		row.createEl("span", { cls: "rion-git-file-name", text: name });

		const end = row.createEl("div", { cls: "rion-git-file-end" });
		if (dir) end.createEl("span", { cls: "rion-git-file-dir", text: dir });

		if (!actions) return;

		row.addClass("is-clickable");
		row.onclick = () => actions.onOpen();

		if (!actions.onCommit && !actions.onDiscard) return;

		const buttons = end.createEl("div", { cls: "rion-git-file-actions" });
		const addIcon = (icon: string, label: string, handler?: () => void): void => {
			if (!handler) return;
			const button = buttons.createEl("button", { cls: "clickable-icon" });
			button.setAttribute("aria-label", label);
			button.setAttribute("title", label);
			setIcon(button, icon);
			button.onclick = (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				handler();
			};
		};
		addIcon("check", "提交此文件", actions.onCommit);
		addIcon("rotate-ccw", "撤销修改", actions.onDiscard);
	}

	private createSection(
		el: HTMLElement,
		key: string,
		title: string,
		badge: string | undefined,
		actions: SectionAction[]
	): HTMLElement | null {
		const isCollapsed = this.collapsed.has(key);
		const section = el.createEl("div", { cls: "rion-git-section" });
		const header = section.createEl("div", { cls: "rion-git-section-header" });

		setIcon(
			header.createEl("span", { cls: "rion-git-chevron" }),
			isCollapsed ? "chevron-right" : "chevron-down"
		);
		header.createEl("span", { cls: "rion-git-section-title", text: title });
		if (badge !== undefined) {
			header.createEl("span", { cls: "rion-git-badge", text: badge });
		}

		const actionsEl = header.createEl("div", { cls: "rion-git-section-actions" });
		for (const action of actions) {
			const button = actionsEl.createEl("button", { cls: "clickable-icon" });
			button.setAttribute("aria-label", action.label);
			button.setAttribute("title", action.label);
			setIcon(button, action.icon);
			button.onclick = (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				action.action(evt);
			};
		}

		header.onclick = () => {
			if (isCollapsed) this.collapsed.delete(key);
			else this.collapsed.add(key);
			this.render();
		};

		return isCollapsed
			? null
			: section.createEl("div", { cls: "rion-git-section-body" });
	}

	private openMoreMenu(evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("提交全部")
				.setIcon("check")
				.onClick(() => void this.commit())
		);
		menu.addItem((item) =>
			item
				.setTitle("提交并推送")
				.setIcon("upload")
				.onClick(() => void this.commitAndPush())
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle("拉取").setIcon("download").onClick(() => void this.plugin.pull())
		);
		menu.addItem((item) =>
			item.setTitle("推送").setIcon("upload").onClick(() => void this.plugin.push())
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("初始化仓库")
				.setIcon("git-branch")
				.onClick(() => void this.plugin.initRepo())
		);
		menu.addItem((item) =>
			item
				.setTitle("清空提交消息")
				.setIcon("eraser")
				.onClick(() => {
					this.draft = "";
					this.render();
				})
		);
		menu.showAtMouseEvent(evt);
	}
}
