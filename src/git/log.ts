import type { CommitFile, GitContext, LogEntry } from "../types";
import { runGit } from "./exec";

const FIELD = "\x1f";
const RECORD = "\x1e";

export function parseLogOutput(raw: string): LogEntry[] {
	const entries: LogEntry[] = [];

	for (const record of raw.split(RECORD)) {
		const trimmed = record.trim();
		if (!trimmed) continue;

		const [hash = "", shortHash = "", author = "", date = "", subject = "", refs = ""] =
			trimmed.split(FIELD);

		entries.push({
			hash,
			shortHash,
			author,
			date,
			subject,
			refs: refs
				.split(",")
				.map((ref) => ref.trim())
				.filter((ref) => ref.length > 0),
		});
	}

	return entries;
}

export function parseNameStatus(raw: string): CommitFile[] {
	const tokens = raw.split("\0");
	const files: CommitFile[] = [];
	let i = 0;

	while (i < tokens.length) {
		const status = tokens[i] ?? "";
		if (!status) break;

		const isRename = status.startsWith("R") || status.startsWith("C");
		const first = tokens[i + 1];
		const second = isRename ? tokens[i + 2] : first;
		if (!first || !second) break;

		files.push({
			status: status.charAt(0),
			path: second,
			from: isRename ? first : undefined,
		});

		i += isRename ? 3 : 2;
	}

	return files;
}

export async function readLog(
	ctx: GitContext,
	limit = 30
): Promise<LogEntry[]> {
	const res = await runGit(ctx.cwd, ctx.gitPath, [
		"log",
		`--max-count=${limit}`,
		"--date=short",
		`--pretty=format:%H${FIELD}%h${FIELD}%an${FIELD}%ad${FIELD}%s${FIELD}%D${RECORD}`,
	]);

	return res.code === 0 ? parseLogOutput(res.stdout) : [];
}

export async function readCommitFiles(
	ctx: GitContext,
	hash: string
): Promise<CommitFile[]> {
	const res = await runGit(ctx.cwd, ctx.gitPath, [
		"show",
		"--pretty=format:",
		"--name-status",
		"-z",
		hash,
	]);

	return res.code === 0 ? parseNameStatus(res.stdout) : [];
}
