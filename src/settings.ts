import { App, PluginSettingTab, Setting } from "obsidian";
import type RionGitPlugin from "./main";

export interface RionGitSettings {
	gitPath: string;
	commitMessageTemplate: string;
	showStatusBar: boolean;
	/** 插件加载完成后是否自动在右侧边栏打开面板。 */
	autoOpenPanel: boolean;
	/** 自动提交总开关。 */
	autoCommitEnabled: boolean;
	/** 定时自动提交间隔，单位分钟；0 表示关闭。 */
	autoCommitInterval: number;
	/** 自动提交后是否自动推送。 */
	autoPush: boolean;
}

export const DEFAULT_SETTINGS: RionGitSettings = {
	gitPath: "git",
	commitMessageTemplate: "vault backup: {{date}}",
	showStatusBar: true,
	autoOpenPanel: true,
	autoCommitEnabled: true,
	autoCommitInterval: 10,
	autoPush: false,
};

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

export function formatDate(date: Date, pattern: string): string {
	return pattern
		.replace(/YYYY/g, String(date.getFullYear()))
		.replace(/MM/g, pad2(date.getMonth() + 1))
		.replace(/DD/g, pad2(date.getDate()))
		.replace(/HH/g, pad2(date.getHours()))
		.replace(/mm/g, pad2(date.getMinutes()))
		.replace(/ss/g, pad2(date.getSeconds()));
}

export function formatCommitMessage(
	template: string,
	date: Date = new Date()
): string {
	const text = template.trim() || DEFAULT_SETTINGS.commitMessageTemplate;
	return text.replace(/\{\{date\}\}/g, formatDate(date, "YYYY-MM-DD HH:mm:ss"));
}

export class RionGitSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: RionGitPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Rion Git" });

		new Setting(containerEl)
			.setName("Git 可执行文件")
			.setDesc(
				"默认为 git。若从快捷方式启动 Obsidian 时提示找不到 git，请填写完整路径，例如 C:\\Program Files\\Git\\cmd\\git.exe"
			)
			.addText((text) =>
				text
					.setPlaceholder("git")
					.setValue(this.plugin.settings.gitPath)
					.onChange(async (value) => {
						this.plugin.settings.gitPath = value.trim() || "git";
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					})
			);

		new Setting(containerEl)
			.setName("提交消息模板")
			.setDesc("{{date}} 会替换为当前时间。")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.commitMessageTemplate)
					.setValue(this.plugin.settings.commitMessageTemplate)
					.onChange(async (value) => {
						this.plugin.settings.commitMessageTemplate =
							value.trim() || DEFAULT_SETTINGS.commitMessageTemplate;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "自动备份" });

		new Setting(containerEl)
			.setName("启用自动提交")
			.setDesc("总开关。关闭后不再定时提交。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCommitEnabled)
					.onChange(async (value) => {
						this.plugin.settings.autoCommitEnabled = value;
						await this.plugin.saveSettings();
						this.plugin.applyAutoSettings();
					})
			);

		new Setting(containerEl)
			.setName("定时提交间隔")
			.setDesc("单位分钟，0 表示关闭定时提交。")
			.addSlider((slider) =>
				slider
					.setLimits(0, 60, 1)
					.setValue(this.plugin.settings.autoCommitInterval)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.autoCommitInterval = value;
						await this.plugin.saveSettings();
						this.plugin.applyAutoSettings();
					})
			);

		new Setting(containerEl)
			.setName("自动提交后推送")
			.setDesc("需要已经配置好远端。推送失败后会自动暂停 5 分钟。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoPush)
					.onChange(async (value) => {
						this.plugin.settings.autoPush = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "界面" });

		new Setting(containerEl)
			.setName("启动时自动打开面板")
			.setDesc("Obsidian 启动后自动在右侧边栏打开 Rion Git。关闭后可用 Ribbon 图标、状态栏或命令手动打开。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoOpenPanel)
					.onChange(async (value) => {
						this.plugin.settings.autoOpenPanel = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("显示状态栏")
			.setDesc("在窗口底部显示改动数量与操作状态（重载插件后生效）。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showStatusBar)
					.onChange(async (value) => {
						this.plugin.settings.showStatusBar = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("侧边栏面板")
			.setDesc("在右侧边栏打开 Rion Git 面板。")
			.addButton((button) =>
				button
					.setButtonText("打开")
					.onClick(() => void this.plugin.activateView())
			);

		containerEl.createEl("h3", { text: "操作" });

		new Setting(containerEl)
			.setName("提交全部改动")
			.addButton((button) =>
				button.setButtonText("提交").onClick(() => void this.plugin.commitAll())
			);

		new Setting(containerEl)
			.setName("提交并推送")
			.addButton((button) =>
				button
					.setButtonText("执行")
					.onClick(() => void this.plugin.commitAndPush())
			);

		new Setting(containerEl)
			.setName("从远端拉取")
			.addButton((button) =>
				button.setButtonText("拉取").onClick(() => void this.plugin.pull())
			);

		new Setting(containerEl)
			.setName("初始化仓库")
			.setDesc("仅当 vault 还不是 git 仓库时使用。")
			.addButton((button) =>
				button.setButtonText("初始化").onClick(() => void this.plugin.initRepo())
			);
	}
}
