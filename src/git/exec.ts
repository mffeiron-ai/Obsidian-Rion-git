import { execFile } from "child_process";

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
	/** 进程未能正常启动时的原因，如 ENOENT（git 不存在）、timeout。 */
	spawnError?: string;
}

export interface RunOptions {
	timeoutMs?: number;
}

export function runGit(
	cwd: string,
	gitPath: string,
	args: string[],
	options: RunOptions = {}
): Promise<GitResult> {
	return new Promise((resolve) => {
		execFile(
			gitPath,
			args,
			{
				cwd,
				timeout: options.timeoutMs ?? 30_000,
				maxBuffer: 32 * 1024 * 1024,
				windowsHide: true,
				env: {
					...process.env,
					// 桌面端没有 TTY，交互式索要密码只会把进程挂死。
					GIT_TERMINAL_PROMPT: "0",
					GIT_OPTIONAL_LOCKS: "0",
				},
			},
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ code: 0, stdout, stderr });
					return;
				}
				const err = error as NodeJS.ErrnoException & {
					killed?: boolean;
					signal?: string;
				};
				const numericCode = typeof err.code === "number" ? err.code : -1;
				const spawnError =
					typeof err.code === "string"
						? err.code
						: err.killed
							? "timeout"
							: undefined;
				resolve({ code: numericCode, stdout, stderr, spawnError });
			}
		);
	});
}

/** 所有 git 调用串行化：git 的 index.lock 是全局的，并发必然互锁。 */
export class GitQueue {
	private tail: Promise<unknown> = Promise.resolve();

	add<T>(task: () => Promise<T>): Promise<T> {
		const run = this.tail.then(task, task);
		this.tail = run.catch(() => undefined);
		return run;
	}
}

export function firstLine(text: string): string {
	const line = text.split(/\r?\n/).find((l) => l.trim().length > 0);
	return line ? line.trim() : "";
}
