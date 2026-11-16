import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { z } from "zod";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
interface BrowserEnvironment {
  id: string;
  name: string;
  controllerSessionId: string;
  origins: string[];
  createdAt: string;
}
interface Lease {
  generation: number;
  owner: "agent" | "user";
  expiresAt: number;
}
export class BrowserService {
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly leases = new Map<string, Lease>();
  private readonly opening = new Map<string, Promise<BrowserContext>>();
  private readonly pages = new Map<string, Page>();
  private closed = false;
  constructor(private readonly service: SessionService) {
    // Persist a monotonic fence but never revive a lease after process restart.
    for (const e of service.store.records<BrowserEnvironment>("browser-environment"))
      this.setGeneration(e.id, this.generation(e.id) + 1);
  }
  private generation(id: string) {
    return this.service.store.record<{ value: number }>("browser-generation", id)?.value ?? 0;
  }
  private setGeneration(id: string, value: number) {
    this.service.store.put("browser-generation", id, { value });
  }
  status() {
    return {
      available: existsSync(process.env.KOOYU_CHROMIUM_PATH ?? chromium.executablePath()),
      backend: "playwright-chromium",
      persistentProfiles: true,
      isolated: false,
      remote: false,
    };
  }
  list() {
    return this.service.store.records<BrowserEnvironment>("browser-environment").map((e) => ({
      ...e,
      status: this.contexts.has(e.id) ? "running" : "stopped",
      generation: this.generation(e.id),
      lease: this.leases.get(e.id) ?? null,
    }));
  }
  create(value: unknown) {
    this.service.lifecycle.assertOpen();
    const p = z
      .object({
        name: z.string().trim().min(1).max(100),
        controllerSessionId: z.string().uuid(),
        origins: z.array(z.string().url()).min(1).max(30),
      })
      .strict()
      .parse(value);
    const s = this.service.store.session(p.controllerSessionId);
    if (s.kind !== "supervisor") throw new KodoError("INVALID_INPUT", "浏览器需要 Kooyu 主对话。");
    const origins = [
      ...new Set(
        p.origins.map((x) => {
          const u = new URL(x);
          if (
            !["http:", "https:"].includes(u.protocol) ||
            u.username ||
            u.password ||
            u.origin !== x
          )
            throw new KodoError(
              "INVALID_INPUT",
              "请填写明确的网页 origin，例如 https://example.com。",
            );
          return u.origin;
        }),
      ),
    ];
    const e: BrowserEnvironment = {
      id: randomUUID(),
      name: p.name,
      controllerSessionId: p.controllerSessionId,
      origins,
      createdAt: new Date().toISOString(),
    };
    this.service.store.put("browser-environment", e.id, e);
    return e;
  }
  private get(id: string) {
    const e = this.service.store.record<BrowserEnvironment>("browser-environment", id);
    if (!e) throw new KodoError("NOT_FOUND", "浏览器环境不存在。");
    return e;
  }
  private async context(id: string, headed = false): Promise<BrowserContext> {
    if (this.closed) throw new KodoError("UNAVAILABLE", "浏览器服务已关闭。");
    const pending = this.opening.get(id);
    if (pending) return pending;
    const existing = this.contexts.get(id);
    if (existing) return existing;
    const e = this.get(id);
    if (!this.status().available)
      throw new KodoError(
        "UNAVAILABLE",
        "受管 Chromium 尚未安装；运行 npx playwright install chromium 或配置 KOOYU_CHROMIUM_PATH。",
      );
    const job = chromium
      .launchPersistentContext(join(this.service.dataDir, "browser-profiles", id), {
        headless: !headed,
        ...(process.env.KOOYU_CHROMIUM_PATH
          ? { executablePath: process.env.KOOYU_CHROMIUM_PATH }
          : {}),
        acceptDownloads: false,
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
      })
      .then(async (context) => {
        if (this.closed) {
          await context.close();
          throw new Error("Browser service closed");
        }
        await context.route("**/*", (route) => {
          const url = route.request().url();
          if (url.startsWith("data:") || url === "about:blank") return route.continue();
          try {
            if (e.origins.includes(new URL(url).origin)) return route.continue();
          } catch {}
          return route.abort("blockedbyclient");
        });
        context.on("close", () => {
          if (this.contexts.get(id) === context) this.contexts.delete(id);
        });
        this.contexts.set(id, context);
        return context;
      });
    this.opening.set(id, job);
    try {
      return await job;
    } finally {
      this.opening.delete(id);
    }
  }
  acquire(id: string, owner: "agent" | "user", expectedGeneration: number, ttlSeconds = 120) {
    this.service.lifecycle.assertOpen();
    this.get(id);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 10 || ttlSeconds > 600)
      throw new KodoError("INVALID_INPUT", "控制租约必须为 10–600 秒。");
    if (this.generation(id) !== expectedGeneration)
      throw new KodoError("CONFLICT", "控制权已变化，请刷新环境。");
    const lease: Lease = {
      generation: expectedGeneration + 1,
      owner,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    this.setGeneration(id, lease.generation);
    this.leases.set(id, lease);
    return lease;
  }
  private assertLease(id: string, generation: number) {
    const lease = this.leases.get(id);
    if (
      !lease ||
      lease.owner !== "agent" ||
      lease.generation !== generation ||
      lease.expiresAt <= Date.now()
    )
      throw new KodoError("CONFLICT", "浏览器控制租约已过期或用户已接管。");
  }
  private async closeContext(id: string) {
    await this.opening.get(id)?.catch(() => {});
    await this.contexts.get(id)?.close();
  }
  async humanControl(id: string, expectedGeneration: number) {
    const release = this.service.lifecycle.enter();
    try {
      const lease = this.acquire(id, "user", expectedGeneration, 600);
      await this.closeContext(id);
      await this.context(id, true);
      return lease;
    } finally {
      release();
    }
  }
  async returnControl(id: string, expectedGeneration: number) {
    const release = this.service.lifecycle.enter();
    try {
      const lease = this.acquire(id, "agent", expectedGeneration);
      await this.closeContext(id);
      return lease;
    } finally {
      release();
    }
  }
  private pageId(page: Page) {
    for (const [id, p] of this.pages) if (p === page) return id;
    const id = randomUUID();
    this.pages.set(id, page);
    page.on("close", () => this.pages.delete(id));
    return id;
  }
  async tabs(id: string) {
    this.get(id);
    const context = this.contexts.get(id);
    if (!context) return [];
    return Promise.all(
      context.pages().map(async (page) => ({
        id: this.pageId(page),
        url: page.url(),
        title: await page.title(),
      })),
    );
  }
  authorize(input: {
    environmentId: string;
    controllerSessionId: string;
    grantId: string;
    goalId?: string;
    action: "open" | "read" | "screenshot" | "click" | "fill" | "press";
    generation?: number;
    pageId?: string;
    url?: string;
    selector?: string;
    text?: string;
  }) {
    const e = this.get(input.environmentId);
    if (e.controllerSessionId !== input.controllerSessionId)
      throw new KodoError("UNAUTHORIZED", "浏览器属于另一个主对话。");
    const write = ["open", "click", "fill", "press"].includes(input.action);
    if (!["open", "read", "screenshot", "click", "fill", "press"].includes(input.action))
      throw new KodoError("INVALID_INPUT", "未知浏览器操作。");
    const page = input.pageId ? this.pages.get(input.pageId) : this.contexts.get(e.id)?.pages()[0];
    if (input.pageId && (!page || !this.contexts.get(e.id)?.pages().includes(page)))
      throw new KodoError("UNAUTHORIZED", "页面不属于此浏览器。");
    let target: string;
    try {
      const u = new URL(input.action === "open" ? (input.url ?? "") : (page?.url() ?? ""));
      if (u.username || u.password || !["http:", "https:"].includes(u.protocol)) throw new Error();
      target = u.origin;
    } catch {
      throw new KodoError("INVALID_INPUT", "需要当前受管页面或有效 HTTP(S) 地址。");
    }
    if (!e.origins.includes(target))
      throw new KodoError("UNAUTHORIZED", "网页超出已配置站点范围。");
    this.service.lifecycle.assertOpen();
    this.service.permissions.require(input.grantId, {
      controllerSessionId: e.controllerSessionId,
      goalId: input.goalId,
      operation: write ? "browser.write" : "browser.read",
      resource: target,
    });
    if (write) this.assertLease(e.id, input.generation ?? -1);
    return { e, page };
  }
  async act(input: Parameters<BrowserService["authorize"]>[0]) {
    const { e, page: initialPage } = this.authorize(input);
    let page = initialPage;
    const authorize = () => this.authorize(input);
    const release = this.service.lifecycle.enter();
    try {
      const context = await this.context(e.id);
      authorize();
      if (!page) page = context.pages()[0] ?? (await context.newPage());
      authorize();
      if (input.action === "open")
        await page.goto(input.url!, { waitUntil: "domcontentloaded", timeout: 30000 });
      else if (input.action === "read")
        return {
          pageId: this.pageId(page),
          url: page.url(),
          title: await page.title(),
          untrustedContent: (await page.locator("body").innerText({ timeout: 10000 })).slice(
            0,
            80000,
          ),
          elements: await page
            .locator("a,button,input:not([type=password]),textarea,select")
            .evaluateAll((nodes) =>
              nodes.slice(0, 150).map((n) => ({
                tag: n.tagName,
                text: n.textContent?.slice(0, 150),
                id: n.id,
                role: n.getAttribute("role"),
                name: n.getAttribute("name"),
                href: n.getAttribute("href"),
              })),
            ),
        };
      else if (input.action === "screenshot") {
        const data = await page.screenshot({ type: "png", fullPage: false, timeout: 15000 }),
          upload = this.service.files.createUpload({
            requestId: randomUUID(),
            displayName: "browser-" + Date.now() + ".png",
            mediaType: "image/png",
            size: data.length,
            sha256: createHash("sha256").update(data).digest("hex"),
            sessionId: e.controllerSessionId,
          });
        for (let i = 0; i < data.length; i += 512 * 1024)
          this.service.files.appendChunk(upload.id, i, data.subarray(i, i + 512 * 1024));
        return {
          pageId: this.pageId(page),
          file: await this.service.files.completeUpload(upload.id),
        };
      } else {
        const locator = page.locator(z.string().min(1).max(2000).parse(input.selector));
        if ((await locator.count()) !== 1)
          throw new KodoError("CONFLICT", "选择器必须唯一定位一个元素。");
        authorize();
        if (input.action === "click") await locator.click({ timeout: 10000 });
        else if (input.action === "fill")
          await locator.fill(z.string().max(20000).parse(input.text), { timeout: 10000 });
        else await locator.press(z.string().max(100).parse(input.text), { timeout: 10000 });
      }
      return {
        pageId: this.pageId(page),
        url: page.url(),
        title: await page.title(),
        lease: this.leases.get(e.id),
      };
    } finally {
      release();
    }
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.opening.values()]);
    await Promise.allSettled([...this.contexts.values()].map((c) => c.close()));
    this.leases.clear();
    this.pages.clear();
  }
}
