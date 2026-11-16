import { z } from "zod";

/**
 * Host-managed file. The display name is separate from the content-addressed
 * storage location; uploads never choose a Host path.
 */
export interface ManagedFile {
  id: string;
  sha256: string;
  size: number;
  mediaType: string;
  displayName: string;
  origin: "upload" | "artifact";
  state: "uploading" | "available" | "deleted";
  projectId: string | null;
  sessionId: string | null;
  goalId: string | null;
  createdAt: string;
}

export interface UploadSession {
  id: string;
  displayName: string;
  mediaType: string;
  size: number;
  sha256: string;
  received: number;
  projectId: string | null;
  sessionId: string | null;
  goalId: string | null;
  state: "open" | "completed" | "cancelled";
  fileId: string | null;
  createdAt: string;
}

/**
 * Immutable delivered result. Later edits to the source produce a new version;
 * an artifact already handed over never changes.
 */
export interface Artifact {
  id: string;
  fileId: string;
  goalId: string | null;
  sessionId: string | null;
  title: string;
  description: string;
  version: number;
  sha256: string;
  size: number;
  mediaType: string;
  displayName: string;
  /** Where the snapshot came from; null for inline content. */
  source: { workspaceId: string; path: string } | null;
  publishedBy: "model" | "user";
  createdAt: string;
}

/**
 * A file sent with a message. `delivery` records how the Host actually handed it to
 * the harness: inline text, a native image input, or a reference to a Host file.
 */
export interface MessageAttachment {
  fileId: string;
  displayName: string;
  mediaType: string;
  size: number;
  sha256: string;
  delivery?: "inline-text" | "image" | "file-reference";
  /** Host path given to the harness for file references. */
  path?: string;
  /** Inline text was cut to the per-file limit. */
  truncated?: boolean;
}

const name = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((v) => !/[\\/\0]/.test(v) && v !== "." && v !== "..", "文件名不能包含路径。");
export const createUploadSchema = z
  .object({
    requestId: z.string().uuid(),
    displayName: name,
    mediaType: z.string().trim().min(1).max(200).default("application/octet-stream"),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    projectId: z.string().uuid().nullable().optional(),
    sessionId: z.string().uuid().nullable().optional(),
    goalId: z.string().uuid().nullable().optional(),
  })
  .strict();
export const publishArtifactSchema = z
  .object({
    requestId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).default(""),
    goalId: z.string().uuid().nullable().optional(),
    /** Snapshot of a workspace file … */
    workspaceId: z.string().uuid().optional(),
    path: z.string().trim().min(1).max(1000).optional(),
    /** … or inline text content (e.g. a report written without a working directory). */
    content: z
      .string()
      .max(4 * 1024 * 1024)
      .optional(),
    displayName: name.optional(),
    mediaType: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((v) => (v.path !== undefined) !== (v.content !== undefined), {
    message: "需要且只能提供工作区文件路径或内联内容之一。",
  })
  .refine((v) => v.content === undefined || Boolean(v.displayName), {
    message: "内联内容需要文件名。",
  });
