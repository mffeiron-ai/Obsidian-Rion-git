import type { FileChange, GitContext, RepoStatus } from "../types";
import { runGit } from "./exec";

const CONFLICT_PAIRS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function isConflict(change: FileChange): boolean {
	return CONFLICT_PAIRS.has(change.index + change.worktree);
}

/**
 * 解析 `git status --porcelain=v1 -z --untracked-files=all`。
 * -z 用 NUL 分隔，避免空格 / 中文 / 换行文件名被切错；
 * 重命名与复制的条目会额外跟一个 NUL 分隔的原路径。
 */
export function parseStatusOutput(raw: string, branch: string | null): RepoStatus {
	const tokens = raw.split("\0");
	const files: FileChange[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const entry = tokens[i];
		if (!entry || entry.length < 4) continue;

		const index = entry.charAt(0);
		const worktree = entry.charAt(1);
		const path = entry.slice(3);

		let origPath: string | undefined;
		if (index === "R" || index === "C" || worktree === "R" || worktree === "C") {
			i += 1;
			const next = tokens[i];
			if (next) origPath = next;
		}

		files.push({ path, index, worktree, origPath });
	}

	return {
		branch,
		files,
		hasConflicts: files.some(isConflict),
	};
}

export function statusLabel(change: FileChange): string {
	if (isConflict(change)) return "冲突";
	if (change.index === "?" && change.worktree === "?") return "未跟踪";
	if (change.index === "D" || change.worktree === "D") return "已删除";
	if (change.index === "A") return change.worktree === " " ? "新增" : "新增(未暂存)";
	if (change.index === "R") return "重命名";
	if (change.index === "C") return "复制";
	if (change.index !== " " && change.index !== "?") return "已暂存";
	return "已修改";
}

export async function readStatus(ctx: GitContext): Promise<RepoStatus> {
	const branchRes = await runGit(ctx.cwd, ctx.gitPath, [
		"rev-parse",
		"--abbrev-ref",
		"HEAD",
	]);
	const branch = branchRes.code === 0 ? branchRes.stdout.trim() : null;

	const statusRes = await runGit(ctx.cwd, ctx.gitPath, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
	]);

	return parseStatusOutput(statusRes.code === 0 ? statusRes.stdout : "", branch);
}
