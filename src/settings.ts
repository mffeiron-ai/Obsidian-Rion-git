import type {
	App,
	SettingDefinitionItem,
} from "obsidian";
import { PluginSettingTab, Setting } from "obsidian";
import type RionGitPlugin from "./main";

export type AutoCommitMode = "off" | "interval" | "smart";

export interface RionGitSettings {
	gitPath: string;
	commitMessageTemplate: string;
	showStatusBar: boolean;
	/** 插件加载完成后是否自动在右侧边栏打开面板。 */
	autoOpenPanel: boolean;
	/** 自动提交方式：关闭 / 定时 / 智能阈值。三者互斥。 */
	autoCommitMode: AutoCommitMode;
	/** 定时模式下的提交间隔，单位分钟。 */
	autoCommitInterval: number;
	/** 智能模式：改动文件数达到该值即提交；0 表示不按文件数判断。 */
	smartFileThreshold: number;
	/** 智能模式：改动行数达到该值即提交；0 表示不按行数判断。 */
	smartLineThreshold: number;
	/** 自动提交后是否自动推送。 */
	autoPush: boolean;
}

export const DEFAULT_SETTINGS: RionGitSettings = {
	gitPath: "git",
	commitMessageTemplate: "vault backup: {{date}}",
	showStatusBar: true,
	autoOpenPanel: true,
	autoCommitMode: "interval",
	autoCommitInterval: 10,
	smartFileThreshold: 5,
	smartLineThreshold: 200,
	autoPush: false,
};

export const AUTO_COMMIT_MODES: readonly AutoCommitMode[] = [
	"off",
	"interval",
	"smart",
];

/** 把持久化的数据整理成当前版本的设置：丢弃废弃键、迁移旧字段、兜底非法值。 */
export function normalizeSettings(stored: unknown): RionGitSettings {
	const source = (stored ?? {}) as Record<string, unknown>;
	const settings = { ...DEFAULT_SETTINGS };
	const target = settings as Record<string, unknown>;

	for (const key of Object.keys(DEFAULT_SETTINGS)) {
		const value = source[key];
		if (value !== undefined && typeof value === typeof target[key]) {
			target[key] = value;
		}
	}

	// 旧版本是布尔开关 autoCommitEnabled，现在拆成三态 autoCommitMode。
	if (
		source.autoCommitMode === undefined &&
		typeof source.autoCommitEnabled === "boolean"
	) {
		settings.autoCommitMode = source.autoCommitEnabled ? "interval" : "off";
	}

	if (!AUTO_COMMIT_MODES.includes(settings.autoCommitMode)) {
		settings.autoCommitMode = DEFAULT_SETTINGS.autoCommitMode;
	}

	return settings;
}

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

	/**
	 * Obsidian 1.13+ 使用声明式设置（可被设置搜索索引）；
	 * 更早的版本会忽略它并回退到 display()。
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Git 可执行文件",
				desc: "默认为 git。若从快捷方式启动 Obsidian 时提示找不到 git，请填写完整路径，例如 C:\\Program Files\\Git\\cmd\\git.exe",
				control: { type: "text", key: "gitPath", placeholder: "git" },
			},
			{
				name: "提交消息模板",
				desc: "{{date}} 会替换为当前时间。",
				control: {
					type: "text",
					key: "commitMessageTemplate",
					placeholder: DEFAULT_SETTINGS.commitMessageTemplate,
				},
			},
			{
				type: "group",
				heading: "自动备份",
				items: [
					{
						name: "自动提交方式",
						desc: "三种方式互斥：关闭、定时（固定间隔）、智能（改动达到阈值时）。",
						control: {
							type: "dropdown",
							key: "autoCommitMode",
							options: { off: "关闭", interval: "定时", smart: "智能" },
						},
					},
					{
						name: "定时提交间隔",
						desc: "仅「定时」模式生效。单位分钟，0 表示不提交。",
						control: {
							type: "slider",
							key: "autoCommitInterval",
							min: 0,
							max: 60,
							step: 1,
						},
					},
					{
						name: "智能模式：改动文件数阈值",
						desc: "仅「智能」模式生效。改动文件达到该数量即自动提交，0 表示不按文件数判断。",
						control: {
							type: "slider",
							key: "smartFileThreshold",
							min: 0,
							max: 30,
							step: 1,
						},
					},
					{
						name: "智能模式：改动行数阈值",
						desc: "仅「智能」模式生效。新增与删除行数之和达到该值即自动提交，0 表示不按行数判断。",
						control: {
							type: "slider",
							key: "smartLineThreshold",
							min: 0,
							max: 2000,
							step: 20,
						},
					},
					{
						name: "自动提交后推送",
						desc: "需要已经配置好远端。推送失败后会自动暂停 5 分钟。",
						control: { type: "toggle", key: "autoPush" },
					},
				],
			},
			{
				type: "group",
				heading: "界面",
				items: [
					{
						name: "启动时自动打开面板",
						desc: "Obsidian 启动后自动在右侧边栏打开 Rion Git。关闭后可用 Ribbon 图标、状态栏或命令手动打开。",
						control: { type: "toggle", key: "autoOpenPanel" },
					},
					{
						name: "显示状态栏",
						desc: "在窗口底部显示改动数量与操作状态（重载插件后生效）。",
						control: { type: "toggle", key: "showStatusBar" },
					},
					{
						name: "侧边栏面板",
						desc: "在右侧边栏打开 Rion Git 面板。",
						action: () => void this.plugin.activateView(),
					},
				],
			},
			{
				type: "group",
				heading: "操作",
				items: [
					{ name: "提交全部改动", action: () => void this.plugin.commitAll() },
					{ name: "提交并推送", action: () => void this.plugin.commitAndPush() },
					{ name: "从远端拉取", action: () => void this.plugin.pull() },
					{
						name: "初始化仓库",
						desc: "仅当 vault 还不是 git 仓库时使用。",
						action: () => void this.plugin.initRepo(),
					},
				],
			},
		];
	}

	/** 声明式控件写入后触发与 display() 相同的副作用。 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);

		if (key === "autoCommitMode" || key === "autoCommitInterval") {
			this.plugin.applyAutoSettings();
		}
		if (key === "gitPath") {
			await this.plugin.refresh();
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

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

		new Setting(containerEl).setName("自动备份").setHeading();

		new Setting(containerEl)
			.setName("自动提交方式")
			.setDesc("三种方式互斥：关闭、定时（固定间隔）、智能（改动达到阈值时）。")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("off", "关闭")
					.addOption("interval", "定时")
					.addOption("smart", "智能")
					.setValue(this.plugin.settings.autoCommitMode)
					.onChange(async (value) => {
						this.plugin.settings.autoCommitMode =
							value as AutoCommitMode;
						await this.plugin.saveSettings();
						this.plugin.applyAutoSettings();
					})
			);

		new Setting(containerEl)
			.setName("定时提交间隔")
			.setDesc("仅「定时」模式生效。单位分钟，0 表示不提交。")
			.addSlider((slider) =>
				slider
					.setLimits(0, 60, 1)
					.setValue(this.plugin.settings.autoCommitInterval)
					.onChange(async (value) => {
						this.plugin.settings.autoCommitInterval = value;
						await this.plugin.saveSettings();
						this.plugin.applyAutoSettings();
					})
			);

		new Setting(containerEl)
			.setName("智能模式：改动文件数阈值")
			.setDesc("仅「智能」模式生效。改动文件达到该数量即自动提交，0 表示不按文件数判断。")
			.addSlider((slider) =>
				slider
					.setLimits(0, 30, 1)
					.setValue(this.plugin.settings.smartFileThreshold)
					.onChange(async (value) => {
						this.plugin.settings.smartFileThreshold = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("智能模式：改动行数阈值")
			.setDesc("仅「智能」模式生效。新增与删除行数之和达到该值即自动提交，0 表示不按行数判断。")
			.addSlider((slider) =>
				slider
					.setLimits(0, 2000, 20)
					.setValue(this.plugin.settings.smartLineThreshold)
					.onChange(async (value) => {
						this.plugin.settings.smartLineThreshold = value;
						await this.plugin.saveSettings();
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

		new Setting(containerEl).setName("界面").setHeading();

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

		new Setting(containerEl).setName("操作").setHeading();

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
