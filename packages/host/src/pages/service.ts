import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KodoError, type InteractivePageRecord } from "@kodo/protocol";
import type { Store } from "../storage/store.js";

const MAX_HTML_CHARS = 200_000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strips <script> tags and inline event handlers so rendered report pages stay strictly offline & static-safe. */
function sanitizeFragment(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function wrapKooyuPageDocument(title: string, summary: string, fragmentHtml: string): string {
  const safeBody = sanitizeFragment(fragmentHtml);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;" />
  <title>${escapeHtml(title)} — Kooyu Report</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f6f7;
      --card: #ffffff;
      --sunken: #f0f1f4;
      --text: #111215;
      --muted: #5a5f6b;
      --border: rgba(17, 18, 21, 0.1);
      --accent: #e8624a;
      --accent-soft: rgba(232, 98, 74, 0.1);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0c0d10;
        --card: #15171c;
        --sunken: #1d2027;
        --text: #f2f4f8;
        --muted: #98a0b0;
        --border: rgba(255, 255, 255, 0.1);
        --accent: #f17561;
        --accent-soft: rgba(241, 117, 97, 0.14);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px 20px 64px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      line-height: 1.65;
    }
    .shell { max-width: 960px; margin: 0 auto; }
    .hero {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 22px 24px;
      margin-bottom: 18px;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: var(--accent);
      background: var(--accent-soft);
      padding: 2px 9px;
      border-radius: 999px;
      margin-bottom: 10px;
    }
    .hero h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: -0.02em; }
    .hero p { margin: 0; color: var(--muted); font-size: 14px; }
    .content {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
    }
    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13.5px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { background: var(--sunken); font-weight: 600; }
    pre, code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: var(--sunken);
      border-radius: 6px;
    }
    code { padding: 2px 5px; font-size: 0.9em; }
    pre { padding: 12px 14px; overflow-x: auto; font-size: 12.5px; }
    h2 { margin-top: 24px; font-size: 17px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
    h3 { margin-top: 18px; font-size: 15px; }
    blockquote { margin: 12px 0; padding: 10px 14px; border-left: 3px solid var(--accent); background: var(--sunken); border-radius: 0 8px 8px 0; }
  </style>
</head>
<body>
  <div class="shell">
    <header class="hero">
      <span class="badge">Kooyu Report</span>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(summary)}</p>
    </header>
    <main class="content">
      ${safeBody}
    </main>
  </div>
</body>
</html>
`;
}

/**
 * Generates and serves offline-safe, Kooyu-themed single-page HTML reports (`show_page`).
 */
export class InteractivePageService {
  readonly pagesDir: string;

  constructor(
    private readonly store: Store,
    dataDir: string,
  ) {
    this.pagesDir = join(dataDir, "kodo", "pages");
    mkdirSync(this.pagesDir, { recursive: true });
  }

  create(input: {
    sessionId: string | null;
    title: string;
    summary: string;
    html: string;
  }): InteractivePageRecord {
    const title = input.title.trim();
    const summary = input.summary.trim();
    const html = input.html.trim();
    if (!title || !summary || !html) {
      throw new KodoError("INVALID_INPUT", "展示页面的标题、摘要和 HTML 正文均不能为空。");
    }
    if (html.length > MAX_HTML_CHARS) {
      throw new KodoError("INVALID_INPUT", "展示页面 HTML 超出 200,000 字符上限。");
    }
    const id = randomUUID();
    const filePath = join(this.pagesDir, `${id}.html`);
    const tmp = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
    mkdirSync(this.pagesDir, { recursive: true });
    writeFileSync(tmp, wrapKooyuPageDocument(title, summary, html), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmp, filePath);

    const record: InteractivePageRecord = {
      id,
      sessionId: input.sessionId,
      title,
      summary,
      path: filePath,
      url: `/api/pages/${id}`,
      createdAt: new Date().toISOString(),
    };
    this.store.put("interactive-page", id, record);
    return record;
  }

  list(sessionId?: string | null): InteractivePageRecord[] {
    return this.store
      .records<InteractivePageRecord>("interactive-page")
      .filter((p) => !sessionId || p.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  readHtml(id: string): { record: InteractivePageRecord; html: string } {
    const record = this.store.record<InteractivePageRecord>("interactive-page", id);
    if (!record || !existsSync(record.path)) {
      throw new KodoError("NOT_FOUND", "未找到该展示页面。");
    }
    return { record, html: readFileSync(record.path, "utf8") };
  }
}
