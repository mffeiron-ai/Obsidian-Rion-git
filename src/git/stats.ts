import { promises as fs } from "node:fs";
import path from "node:path";
import type { GitContext } from "../types";
import { runGit } from "./exec";

/** 解析 `git diff --numstat`：`新增行\t删除行\t路径`，二进制文件是 `-\t-`。 */
export function sumNumstat(raw: string): number {
	let total = 0;

	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;

		const parts = line.split("\t");
		const added = parts[0];
		const deleted = parts[1];
		if (added === undefined || deleted === undefined) continue;

		if (added === "-" || deleted === "-") {
			total += 1;
			continue;
		}

		const a = Number.parseInt(added, 10);
		const d = Number.parseInt(deleted, 10);
		if (Number.isNaN(a) || Number.isNaN(d)) continue;
		total += a + d;
	}

	return total;
}

const MAX_UNTRACKED_FILES = 50;
const MAX_UNTRACKED_BYTES = 512 * 1024;

/**
 * 统计「已跟踪文件的改动行数 + 未跟踪文件的行数」。
 * 未跟踪文件不在 `git diff` 里，需要单独读取，因此加了数量与体积上限。
 */
export async function countChangedLines(
	ctx: GitContext,
	untracked: string[]
): Promise<number> {
	let res = await runGit(ctx.cwd, ctx.gitPath, ["diff", "--numstat", "HEAD"]);
	if (res.code !== 0) {
		// 仓库还没有提交时 HEAD 不存在。
		res = await runGit(ctx.cwd, ctx.gitPath, ["diff", "--numstat"]);
	}

	let total = res.code === 0 ? sumNumstat(res.stdout) : 0;

	for (const file of untracked.slice(0, MAX_UNTRACKED_FILES)) {
		const fullPath = path.join(ctx.cwd, ...file.split("/"));
		try {
			const stat = await fs.stat(fullPath);
			if (!stat.isFile() || stat.size > MAX_UNTRACKED_BYTES) continue;

			const content = await fs.readFile(fullPath, "utf8");
			if (content.includes("\0")) continue;

			const lines = content.split("\n");
			total += content.endsWith("\n") ? lines.length - 1 : lines.length;
		} catch {
			// 读取失败（被删除、无权限）时忽略该文件
		}
	}

	return total;
}
