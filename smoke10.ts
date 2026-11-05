import { readCommitStats, aggregateDaily, aggregateByWeek, eachDay, shiftDays, todayString, parseNumstatLog } from "./src/git/history";

console.log("--- 解析样例（含二进制）---");
const sample = "\x1eabc123|2026-11-05|第一次提交\n3\t2\tsrc/a.ts\n-\t-\timg.png\n\n\x1edef456|2026-11-04|第二次\n0\t5\tb.md\n";
for (const c of parseNumstatLog(sample.replace(/\|/g, "\x1f"))) {
	console.log(`  ${c.hash.slice(0, 7)} ${c.date} files=${c.files} lines=${c.lines} "${c.subject}"`);
}

async function main() {
	const ctx = { cwd: process.argv[2], gitPath: "git" };
	const commits = await readCommitStats(ctx);
	console.log("\n--- 真实仓库 ---");
	console.log("提交数:", commits.length);
	console.log("前 3 条:", commits.slice(0, 3).map((c) => `${c.date} ${c.files}文件 ${c.lines}行`).join(" | "));

	const today = todayString();
	const start = shiftDays(today, -(26 * 7 - 1));
	const daily = aggregateDaily(commits, start, today);
	console.log("日历天数:", daily.length, "(应为 182)");
	console.log("区间提交数:", daily.reduce((s, d) => s + d.commits, 0));

	const weeks = aggregateByWeek(daily);
	console.log("周数:", weeks.length);
	console.log("最后一周:", JSON.stringify(weeks[weeks.length - 1]));
	console.log("月份标签样本:", eachDay(start, start).concat(eachDay(today, today)).join(","));
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });