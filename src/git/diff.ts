import { promises as fs } from "node:fs";
import path from "node:path";
import type { GitContext } from "../types";
import { runGit } from "./exec";

export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "context";

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
}

const META_PREFIXES = [
	"diff --git",
	"index ",
	"--- ",
	"+++ ",
	"new file mode",
	"deleted file mode",
	"old mode",
	"new mode",
	"similarity index",
	"rename from",
	"rename to",
	"Binary files",
	"GIT binary patch",
];

export function parseDiff(raw: string): DiffLine[] {
	const lines: DiffLine[] = [];

	for (const text of raw.split("\n")) {
		if (text.length === 0) continue;

		let kind: DiffLineKind = "context";
		if (text.startsWith("@@")) kind = "hunk";
		else if (META_PREFIXES.some((prefix) => text.startsWith(prefix))) kind = "meta";
		else if (text.startsWith("+")) kind = "add";
		else if (text.startsWith("-")) kind = "del";
		else if (text.startsWith("\\")) kind = "meta";

		lines.push({ kind, text });
	}

	return lines;
}

export function diffStats(lines: DiffLine[]): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of lines) {
		if (line.kind === "add") additions++;
		else if (line.kind === "del") deletions++;
	}
	return { additions, deletions };
}

export async function readFileDiff(
	ctx: GitContext,
	filePath: string
): Promise<string> {
	let res = await runGit(ctx.cwd, ctx.gitPath, [
		"diff",
		"--no-color",
		"--unified=3",
		"HEAD",
		"--",
		filePath,
	]);

	// 仓库还没有任何提交时 HEAD 不存在，退回到「工作区 vs 索引」。
	if (res.code !== 0) {
		res = await runGit(ctx.cwd, ctx.gitPath, [
			"diff",
			"--no-color",
			"--unified=3",
			"--",
			filePath,
		]);
	}

	return res.code === 0 ? res.stdout : "";
}

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

/** 历史提交里某个文件的差异：该提交相对其父提交的变化。 */
export async function readCommitFileDiff(
	ctx: GitContext,
	hash: string,
	filePath: string
): Promise<string> {
	const res = await runGit(ctx.cwd, ctx.gitPath, [
		"show",
		"--no-color",
		"--unified=3",
		"--format=",
		hash,
		"--",
		filePath,
	]);

	return res.code === 0 ? res.stdout : "";
}

/** 未跟踪文件没有 diff，直接按「整篇都是新增」呈现。 */
export async function readUntrackedDiff(
	ctx: GitContext,
	filePath: string
): Promise<{ text: string; note?: string }> {
	const fullPath = path.join(ctx.cwd, ...filePath.split("/"));

	let size: number;
	try {
		const stat = await fs.stat(fullPath);
		if (!stat.isFile()) return { text: "", note: "不是普通文件，无法预览。" };
		size = stat.size;
	} catch {
		return { text: "", note: "文件不存在或无法读取。" };
	}

	if (size > MAX_PREVIEW_BYTES) {
		return { text: "", note: `文件过大（${Math.round(size / 1024)} KB），不预览。` };
	}

	const content = await fs.readFile(fullPath, "utf8");
	if (content.includes("\0")) return { text: "", note: "二进制文件，无法预览。" };

	const normalized = content.replace(/\r\n/g, "\n");
	const body = normalized.endsWith("\n")
		? normalized.slice(0, -1)
		: normalized;

	return {
		text: body
			.split("\n")
			.map((line) => `+${line}`)
			.join("\n"),
	};
}
