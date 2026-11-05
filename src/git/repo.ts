import type { GitContext } from "../types";
import { runGit } from "./exec";

export type RepoKind = "ok" | "no-git" | "no-repo" | "error";

export interface RepoDetection {
	kind: RepoKind;
	detail: string;
}

export async function detectRepo(ctx: GitContext): Promise<RepoDetection> {
	const version = await runGit(ctx.cwd, ctx.gitPath, ["--version"]);

	if (version.spawnError === "ENOENT") {
		return {
			kind: "no-git",
			detail: `找不到 git 可执行文件「${ctx.gitPath}」，请在插件设置里填写完整路径。`,
		};
	}
	if (version.code !== 0) {
		return {
			kind: "error",
			detail: `git 无法执行：${version.stderr.trim() || version.stdout.trim() || "未知错误"}`,
		};
	}

	const inside = await runGit(ctx.cwd, ctx.gitPath, [
		"rev-parse",
		"--is-inside-work-tree",
	]);
	if (inside.code !== 0 || inside.stdout.trim() !== "true") {
		return { kind: "no-repo", detail: "当前 vault 不是 git 仓库。" };
	}

	return { kind: "ok", detail: version.stdout.trim() };
}

export async function getIdentity(
	ctx: GitContext
): Promise<{ name: string; email: string }> {
	const name = await runGit(ctx.cwd, ctx.gitPath, ["config", "user.name"]);
	const email = await runGit(ctx.cwd, ctx.gitPath, ["config", "user.email"]);
	return {
		name: name.code === 0 ? name.stdout.trim() : "",
		email: email.code === 0 ? email.stdout.trim() : "",
	};
}

export async function hasRemote(ctx: GitContext): Promise<boolean> {
	const res = await runGit(ctx.cwd, ctx.gitPath, ["remote"]);
	return res.code === 0 && res.stdout.trim().length > 0;
}
