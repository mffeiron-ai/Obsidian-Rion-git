import type RionGitPlugin from "./main";

export function registerCommands(plugin: RionGitPlugin): void {
	plugin.addCommand({
		id: "open-panel",
		name: "打开侧边栏面板",
		callback: () => void plugin.activateView(),
	});

	plugin.addCommand({
		id: "commit-all",
		name: "提交全部改动",
		callback: () => void plugin.commitAll(),
	});

	plugin.addCommand({
		id: "push",
		name: "推送到远端",
		callback: () => void plugin.push(),
	});

	plugin.addCommand({
		id: "pull",
		name: "从远端拉取",
		callback: () => void plugin.pull(),
	});

	plugin.addCommand({
		id: "commit-and-push",
		name: "提交并推送",
		callback: () => void plugin.commitAndPush(),
	});

	plugin.addCommand({
		id: "show-changes",
		name: "查看改动",
		callback: () => void plugin.showChanges(),
	});

	plugin.addCommand({
		id: "init-repo",
		name: "初始化仓库",
		callback: () => void plugin.initRepo(),
	});

	plugin.addCommand({
		id: "refresh-status",
		name: "刷新状态",
		callback: () => void plugin.refresh(),
	});
}
