export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}
export interface WorkspaceFileList {
  path: string;
  entries: WorkspaceFileEntry[];
  truncated: boolean;
}
export interface WorkspaceFilePreview {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind: "text" | "image" | "pdf" | "unsupported";
  mime: string;
  text?: string;
  reason?: string;
}
export interface WorkspaceChange {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflict";
}
export interface WorkspaceChanges {
  git: boolean;
  branch: string | null;
  baseline: "HEAD" | "empty";
  files: WorkspaceChange[];
  attribution: "workspace";
  error?: string;
}
export interface WorkspaceFileDiff {
  path: string;
  text: string;
}
