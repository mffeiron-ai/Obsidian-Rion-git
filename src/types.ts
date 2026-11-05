export interface GitContext {
	cwd: string;
	gitPath: string;
}

export interface FileChange {
	path: string;
	index: string;
	worktree: string;
	origPath?: string;
}

export interface RepoStatus {
	branch: string | null;
	files: FileChange[];
	hasConflicts: boolean;
}

export interface OpResult {
	ok: boolean;
	message: string;
}

export interface LogEntry {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	subject: string;
	refs: string[];
}

export interface CommitFile {
	status: string;
	path: string;
	from?: string;
}
