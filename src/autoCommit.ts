import type RionGitPlugin from "./main";

export class AutoCommitManager {
	private intervalId: number | null = null;

	constructor(private plugin: RionGitPlugin) {}

	register(): void {
		this.applySettings();
	}

	/** 定时器随设置变化重建；旧句柄先清掉，避免热重载后多份定时器叠加。 */
	applySettings(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}

		const { autoCommitEnabled, autoCommitInterval } = this.plugin.settings;
		if (!autoCommitEnabled || autoCommitInterval <= 0) return;

		this.intervalId = window.setInterval(
			() => void this.plugin.runAutoCommit("定时"),
			autoCommitInterval * 60_000
		);
		this.plugin.registerInterval(this.intervalId);
	}

	dispose(): void {
		if (this.intervalId !== null) window.clearInterval(this.intervalId);
		this.intervalId = null;
	}
}