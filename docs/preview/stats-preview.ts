/**
 * 在浏览器里直接运行真实的 StatsView 渲染逻辑，用于生成 README 预览图。
 * 数据是确定性生成的样例，不来自真实仓库。
 */
import { StatsView } from "../../src/ui/statsView";
import type { CommitStat } from "../../src/git/historyData";
import { shiftDays, todayString } from "../../src/git/historyData";

function makeSampleCommits(): CommitStat[] {
	let seed = 20261105;
	const random = (): number => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};

	const today = todayString();
	const commits: CommitStat[] = [];

	for (let offset = 181; offset >= 0; offset--) {
		const date = shiftDays(today, -offset);
		const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
		const weekend = weekday === 0 || weekday === 6;
		const max = weekend ? 2 : 5;
		const count = Math.floor(random() * (max + 1));

		for (let i = 0; i < count; i++) {
			const files = 1 + Math.floor(random() * 6);
			// 行数与文件数独立生成，避免两条折线完全重合
			const lines = 15 + Math.floor(random() * 320);
			commits.push({
				hash: `sample${offset}-${i}`,
				date,
				subject: "vault backup",
				files,
				lines,
			});
		}
	}

	return commits;
}

async function main(): Promise<void> {
	const root = document.getElementById("root");
	if (!root) return;

	const stubPlugin = {
		loadHistoryStats: async () => makeSampleCommits(),
	};

	const view = new StatsView(null as never, stubPlugin as never);
	root.appendChild(view.contentEl);
	await view.render();
}

void main();
