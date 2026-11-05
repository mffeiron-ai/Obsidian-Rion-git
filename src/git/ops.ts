import type { GitContext, OpResult } from "../types";
import { firstLine, runGit } from "./exec";
import { readStatus } from "./status";

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
