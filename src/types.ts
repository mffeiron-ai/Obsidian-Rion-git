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
