import type { GitContext } from "../types";
import { runGit } from "./exec";
import { parseNumstatLog } from "./historyData";
import type { CommitStat } from "./historyData";

export type { CommitStat, DailyStat, WeeklyStat } from "./historyData";
export {
	aggregateByWeek,
	aggregateDaily,
	eachDay,
	parseNumstatLog,
	shiftDays,
	todayString,
	weekdayIndex,
} from "./historyData";

/** 一次 git 调用取回提交及其改动量，供统计视图聚合。 */
export async function readCommitStats(
	ctx: GitContext,
	maxCommits = 3000
): Promise<CommitStat[]> {
	const res = await runGit(ctx.cwd, ctx.gitPath, [
		"log",
		`--max-count=${maxCommits}`,
		"--date=short",
		"--numstat",
		"--pretty=format:%x1e%H%x1f%ad%x1f%s",
	]);

	return res.code === 0 ? parseNumstatLog(res.stdout) : [];
}