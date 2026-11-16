import type { IncomingMessage, ServerResponse } from "node:http";
import type { FileService } from "./store.js";
import type { ManagedFileAccess } from "@kodo/protocol";

const INLINE =
  /^(text\/(plain|markdown|csv)|application\/(json|pdf)|image\/(png|jpeg|gif|webp))(?:;|$)/i;
export function fileAccess(files: FileService, id: string): ManagedFileAccess {
  const { file } = files.open(id),
    contentUrl = `/api/files/${id}/content`;
  return {
    fileId: id,
    size: file.size,
    sha256: file.sha256,
    mediaType: file.mediaType,
    preview: {
      available: INLINE.test(file.mediaType),
      reason: INLINE.test(file.mediaType) ? null : "此类型仅支持下载。",
      contentUrl,
    },
    downloadUrl: `${contentUrl}?download=1`,
    etag: `"${file.sha256}"`,
    supportsRanges: true,
    maxUploadBytes: files.limit,
  };
}
/** Authenticated streaming with bounded single-range support for native PDF/image viewers. */
export function serveFileContent(
  files: FileService,
  id: string,
  req: IncomingMessage,
  res: ServerResponse,
  download: boolean,
) {
  const opened = files.open(id),
    { file, size } = opened,
    etag = `"${file.sha256}"`;
  res.setHeader(
    "Content-Type",
    /^text\/html(?:;|$)/i.test(file.mediaType) ? "text/plain; charset=utf-8" : file.mediaType,
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("ETag", etag);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    file.mediaType === "application/pdf"
      ? "frame-ancestors 'self'; base-uri 'none'"
      : "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'",
  );
  res.setHeader(
    "Content-Disposition",
    (!download && INLINE.test(file.mediaType) ? "inline" : "attachment") +
      "; filename*=UTF-8''" +
      encodeURIComponent(file.displayName).replace(/'/g, "%27"),
  );
  const noneMatch = req.headers["if-none-match"];
  if (
    noneMatch &&
    (noneMatch.trim() === "*" ||
      noneMatch.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag))
  ) {
    res.writeHead(304);
    res.end();
    return;
  }
  let range: { start: number; end: number } | undefined;
  const requested = req.method === "GET" ? req.headers.range : undefined;
  if (requested && (!req.headers["if-range"] || req.headers["if-range"] === etag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
    if (match && (match[1] || match[2]) && size > 0) {
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1]
        ? match[2]
          ? Math.min(size - 1, Number(match[2]))
          : size - 1
        : size - 1;
      if (
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start <= end &&
        start < size &&
        (match[1] || Number(match[2]) > 0)
      )
        range = { start, end };
    }
    if (!range) {
      res.setHeader("Content-Range", `bytes */${size}`);
      res.setHeader("Content-Length", "0");
      res.writeHead(416);
      res.end();
      return;
    }
  }
  if (range) res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  res.setHeader("Content-Length", String(range ? range.end - range.start + 1 : size));
  res.writeHead(range ? 206 : 200);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = opened.stream(range);
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
