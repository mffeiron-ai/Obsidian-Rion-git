import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileChange, GitContext, OpResult } from "../types";
import { firstLine, runGit } from "./exec";
import { isConflict, readStatus } from "./status";

const NETWORK_TIMEOUT_MS = 120_000;

function fail(res: { stderr: string; stdout: string; spawnError?: string }): OpResult {
	if (res.spawnError === "ENOENT") {
		return { ok: false, message: "找不到 git 可执行文件，请检查设置里的路径。" };
	}
	if (res.spawnError === "timeout") {
		return { ok: false, message: "git 操作超时（网络或凭据可能有问题）。" };
	}
	const detail = firstLine(res.stderr) || firstLine(res.stdout) || "未知错误";
	return { ok: false, message: detail };
}

export async function commitAll(
	ctx: GitContext,
	message: string
): Promise<OpResult & { count?: number }> {
	const status = await readStatus(ctx);
	if (status.files.length === 0) {
		return { ok: true, message: "没有需要提交的改动。", count: 0 };
	}

	const add = await runGit(ctx.cwd, ctx.gitPath, ["add", "-A"]);
	if (add.code !== 0) return fail(add);

	const commit = await runGit(ctx.cwd, ctx.gitPath, ["commit", "-m", message]);
	if (commit.code !== 0) return fail(commit);

	return { ok: true, message: `已提交 ${status.files.length} 个改动。`, count: status.files.length };
}

export async function push(ctx: GitContext): Promise<OpResult> {
	const branchRes = await runGit(ctx.cwd, ctx.gitPath, [
		"rev-parse",
		"--abbrev-ref",
		"HEAD",
	]);
	if (branchRes.code !== 0) {
		return { ok: false, message: "当前仓库还没有任何提交。" };
	}
	const branch = branchRes.stdout.trim();

	const upstream = await runGit(ctx.cwd, ctx.gitPath, [
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{u}",
	]);

	const args =
		upstream.code === 0 ? ["push"] : ["push", "-u", "origin", branch];
	const res = await runGit(ctx.cwd, ctx.gitPath, args, {
		timeoutMs: NETWORK_TIMEOUT_MS,
	});
	if (res.code !== 0) return fail(res);

	return { ok: true, message: `已推送到 ${upstream.code === 0 ? upstream.stdout.trim() : `origin/${branch}`}。` };
}

export async function pull(ctx: GitContext): Promise<OpResult> {
	const res = await runGit(
		ctx.cwd,
		ctx.gitPath,
		["pull", "--no-rebase", "--no-edit"],
		{ timeoutMs: NETWORK_TIMEOUT_MS }
	);
	if (res.code !== 0) return fail(res);

	const status = await readStatus(ctx);
	if (status.hasConflicts) {
		return { ok: false, message: "拉取完成，但存在合并冲突，需要手动解决。" };
	}
	return { ok: true, message: "已从远端拉取。" };
}

export async function initRepo(ctx: GitContext): Promise<OpResult> {
	const res = await runGit(ctx.cwd, ctx.gitPath, ["init"]);
	if (res.code !== 0) return fail(res);
	return { ok: true, message: "已初始化 git 仓库。" };
}

/** 只提交指定文件：先把这个文件（含删除）放进索引，再按路径提交。 */
export async function commitFile(
	ctx: GitContext,
	filePath: string,
	message: string
): Promise<OpResult> {
	const add = await runGit(ctx.cwd, ctx.gitPath, ["add", "-A", "--", filePath]);
	if (add.code !== 0) return fail(add);

	const commit = await runGit(ctx.cwd, ctx.gitPath, [
		"commit",
		"-m",
		message,
		"--",
		filePath,
	]);
	if (commit.code !== 0) return fail(commit);

	return { ok: true, message: `已提交 ${filePath}` };
}

/** 撤销单个文件的改动；未跟踪文件直接删除。 */
export async function discardFile(
	ctx: GitContext,
	change: FileChange
): Promise<OpResult> {
	if (isConflict(change)) {
		return { ok: false, message: "冲突文件不支持一键撤销，请手动解决。" };
	}

	if (change.index === "?" && change.worktree === "?") {
		const fullPath = path.join(ctx.cwd, ...change.path.split("/"));
		try {
			await fs.unlink(fullPath);
			return { ok: true, message: `已删除未跟踪文件 ${change.path}` };
		} catch (error) {
			return {
				ok: false,
				message: `删除失败：${(error as Error).message}`,
			};
		}
	}

	const restore = await runGit(ctx.cwd, ctx.gitPath, [
		"restore",
		"--source=HEAD",
		"--staged",
		"--worktree",
		"--",
		change.path,
	]);
	if (restore.code === 0) {
		const message =
			change.index === "A"
				? `已撤销新增文件 ${change.path}`
				: `已撤销 ${change.path} 的修改`;
		return { ok: true, message };
	}

	// 新增到索引但 HEAD 里没有的文件，restore 会失败，退化为取消暂存。
	const reset = await runGit(ctx.cwd, ctx.gitPath, ["reset", "-q", "--", change.path]);
	if (reset.code === 0) {
		return {
			ok: true,
			message: `已取消暂存 ${change.path}（工作区内容已保留）`,
		};
	}

	return fail(restore);
}
