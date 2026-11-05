const FIELD = "\x1f";
const RECORD = "\x1e";

export interface CommitStat {
	hash: string;
	/** YYYY-MM-DD */
	date: string;
	subject: string;
	files: number;
	lines: number;
}

export interface DailyStat {
	date: string;
	commits: number;
	files: number;
	lines: number;
}

export interface WeeklyStat {
	/** 该周周一的日期 */
	weekStart: string;
	commits: number;
	files: number;
	lines: number;
}

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

/** 用 UTC 做日期运算，避免本地时区/夏令时导致偏差。 */
function toUTC(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function fromUTC(timestamp: number): string {
	const d = new Date(timestamp);
	return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 解析 `git log --date=short --numstat --pretty=format:%x1e%H%x1f%ad%x1f%s`。
 * 每条记录以 \x1e 开头，首行是「哈希 / 日期 / 主题」，其后是 numstat 行。
 */
export function parseNumstatLog(raw: string): CommitStat[] {
	const commits: CommitStat[] = [];

	for (const record of raw.split(RECORD)) {
		const body = record.replace(/^\n+/, "");
		if (!body.trim()) continue;

		const lines = body.split("\n");
		const header = lines[0] ?? "";
		const [hash, date = "", ...subjectParts] = header.split(FIELD);
		if (!hash || !date) continue;

		let files = 0;
		let total = 0;

		for (const line of lines.slice(1)) {
			if (!line.trim()) continue;

			const parts = line.split("\t");
			const added = parts[0];
			const deleted = parts[1];
			if (added === undefined || deleted === undefined) continue;

			files += 1;
			// 二进制文件在 numstat 里是 `-\t-`，只计文件数、不计行数。
			if (added === "-" || deleted === "-") continue;

			const a = Number.parseInt(added, 10);
			const d = Number.parseInt(deleted, 10);
			if (!Number.isNaN(a)) total += a;
			if (!Number.isNaN(d)) total += d;
		}

		commits.push({
			hash,
			date,
			subject: subjectParts.join(FIELD),
			files,
			lines: total,
		});
	}

	return commits;
}

export function eachDay(startDate: string, endDate: string): string[] {
	const days: string[] = [];
	const end = toUTC(endDate);

	for (let t = toUTC(startDate); t <= end; t += 86_400_000) {
		days.push(fromUTC(t));
	}

	return days;
}

/** 把提交按天汇总，并补齐没有提交的日期（用于日历热力图）。 */
export function aggregateDaily(
	commits: CommitStat[],
	startDate: string,
	endDate: string
): DailyStat[] {
	const buckets = new Map<string, DailyStat>();

	for (const day of eachDay(startDate, endDate)) {
		buckets.set(day, { date: day, commits: 0, files: 0, lines: 0 });
	}

	for (const commit of commits) {
		const bucket = buckets.get(commit.date);
		if (!bucket) continue;
		bucket.commits += 1;
		bucket.files += commit.files;
		bucket.lines += commit.lines;
	}

	return [...buckets.values()];
}

/** 周一起算的周分桶，用于折线图。 */
export function aggregateByWeek(daily: DailyStat[]): WeeklyStat[] {
	const weeks: WeeklyStat[] = [];
	let currentKey = "";

	for (const day of daily) {
		const weekday = weekdayIndex(day.date);
		const weekStart = fromUTC(toUTC(day.date) - weekday * 86_400_000);

		if (weekStart !== currentKey) {
			currentKey = weekStart;
			weeks.push({ weekStart, commits: 0, files: 0, lines: 0 });
		}

		const bucket = weeks[weeks.length - 1];
		if (!bucket) continue;
		bucket.commits += day.commits;
		bucket.files += day.files;
		bucket.lines += day.lines;
	}

	return weeks;
}

/** 周一为一周起点，返回 0..6。 */
export function weekdayIndex(date: string): number {
	return (new Date(toUTC(date)).getUTCDay() + 6) % 7;
}

export function todayString(): string {
	const now = new Date();
	return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function shiftDays(date: string, days: number): string {
	return fromUTC(toUTC(date) + days * 86_400_000);
}
