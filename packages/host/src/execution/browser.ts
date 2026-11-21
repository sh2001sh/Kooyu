import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type CDPSession, type Cookie, type Page } from "playwright";
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
  private readonly casts = new Map<
    string,
    {
      session: CDPSession;
      page: Page;
      frame: string;
      sequence: number;
      generation: number;
      steps?: string[];
    }
  >();
  private closed = false;
  private executable() {
    const explicit = process.env.KOOYU_CHROMIUM_PATH;
    if (explicit) return existsSync(explicit) ? explicit : undefined;
    const candidates = [
      chromium.executablePath(),
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];
    for (const root of [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ]) {
      if (root)
        candidates.push(
          join(root, "Google/Chrome/Application/chrome.exe"),
          join(root, "Microsoft/Edge/Application/msedge.exe"),
        );
    }
    return candidates.find((path) => existsSync(path));
  }
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
      available: Boolean(this.executable()),
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
  private async context(id: string): Promise<BrowserContext> {
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
        headless: true,
        executablePath: this.executable(),
        acceptDownloads: false,
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
      })
      .then(async (context) => {
        if (this.closed) {
          await context.close();
          throw new Error("Browser service closed");
        }
        await this.loadSharedCookies(context, e.origins);
        await context.route("**/*", (route) => {
          const request = route.request();
          if (!request.isNavigationRequest()) return route.continue();
          try {
            if (request.frame().parentFrame()) return route.continue();
          } catch {
            /* First popup navigation has no frame yet. */
          }
          const url = request.url();
          const lease = this.leases.get(id);
          if (lease?.owner === "user" && lease.expiresAt > Date.now() && /^https?:/.test(url))
            return route.continue();
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
  private userCast(id: string, generation: number) {
    const lease = this.leases.get(id);
    const cast = this.casts.get(id);
    if (
      !lease ||
      lease.owner !== "user" ||
      lease.expiresAt <= Date.now() ||
      lease.generation !== generation ||
      cast?.generation !== generation
    )
      throw new KodoError("CONFLICT", "用户控制租约已失效。");
    return cast;
  }

  async humanControl(id: string, expectedGeneration: number) {
    const release = this.service.lifecycle.enter();
    try {
      const lease = this.acquire(id, "user", expectedGeneration, 600);
      const context = await this.context(id);
      const page = context.pages().at(-1) ?? (await context.newPage());
      if (page.url() === "about:blank")
        await page.goto(this.get(id).origins[0]!, { waitUntil: "domcontentloaded" });
      await this.castPage(id, context, page, lease);
      return lease;
    } finally {
      release();
    }
  }
  private async castPage(id: string, context: BrowserContext, page: Page, lease: Lease) {
    const old = this.casts.get(id);
    const session = await context.newCDPSession(page);
    if (
      this.leases.get(id) !== lease ||
      lease.expiresAt <= Date.now() ||
      this.casts.get(id) !== old
    ) {
      await session.detach().catch(() => {});
      throw new KodoError("CONFLICT", "浏览器页面或控制权已改变。");
    }
    const cast = {
      session,
      page,
      generation: lease.generation,
      frame: "",
      sequence: (old?.sequence ?? -1) + 1,
      steps: old?.generation === lease.generation ? old.steps : undefined,
    };
    this.casts.set(id, cast);
    session.on("Page.screencastFrame", (event) => {
      if (
        this.casts.get(id) === cast &&
        this.leases.get(id)?.generation === cast.generation &&
        lease.expiresAt > Date.now()
      ) {
        cast.frame = event.data;
        cast.sequence++;
        this.notifyFrame(id, cast.generation);
      }
      void session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
    });
    try {
      await session.send("Page.startScreencast", { format: "jpeg", quality: 65 });
    } finally {
      await old?.session.detach().catch(() => {});
    }
  }
  async selectTab(id: string, generation: number, pageId: string) {
    this.userCast(id, generation);
    const context = this.contexts.get(id),
      page = this.pages.get(pageId);
    if (!page || !context?.pages().includes(page))
      throw new KodoError("NOT_FOUND", "浏览器标签页已关闭。");
    await this.castPage(id, context, page, this.leases.get(id)!);
    return { pageId };
  }
  private readonly frameSubscribers = new Map<string, Set<() => void>>();

  private notifyFrame(id: string, generation: number) {
    const subs = this.frameSubscribers.get(`${id}:${generation}`);
    if (!subs) return;
    for (const fn of subs) fn();
  }

  subscribeFrame(id: string, generation: number, listener: () => void): () => void {
    this.userCast(id, generation);
    const key = `${id}:${generation}`;
    let subs = this.frameSubscribers.get(key);
    if (!subs) {
      subs = new Set();
      this.frameSubscribers.set(key, subs);
    }
    subs.add(listener);
    return () => {
      subs?.delete(listener);
      if (subs && subs.size === 0) this.frameSubscribers.delete(key);
    };
  }

  frame(id: string, generation: number, after: number) {
    const cast = this.userCast(id, generation);
    return {
      sequence: cast.sequence,
      frame: after === cast.sequence ? "" : cast.frame,
      pageId: this.pageId(cast.page),
      tabs: (this.contexts.get(id)?.pages() ?? []).map((page) => ({
        id: this.pageId(page),
        origin: new URL(page.url()).origin,
      })),
    };
  }
  record(id: string, generation: number, start: boolean) {
    const cast = this.userCast(id, generation);
    if (start) {
      cast.steps ??= [];
      return { recording: true };
    }
    if (!cast.steps?.length) throw new KodoError("INVALID_INPUT", "请先录制至少一个操作。");
    const recordingId = randomUUID();
    const markdown = [
      "---",
      "name: browser-demonstration",
      "description: 在受管浏览器重现已录制的操作。",
      "---",
      "",
      ...cast.steps.map((step, i) => i + 1 + ". " + step),
    ].join("\n");
    this.service.store.put("browser-demonstration", recordingId, {
      recordingId,
      environmentId: id,
      markdown,
    });
    delete cast.steps;
    return { recording: false, recordingId, markdown };
  }

  scheduleRecording(id: string, value: unknown) {
    const input = z
      .object({
        requestId: z.string().uuid(),
        recordingId: z.string().uuid(),
        name: z.string().trim().min(1).max(150),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        timeZone: z.string().min(1).max(100),
      })
      .strict()
      .parse(value);
    const demo = this.service.store.record<{ environmentId: string; markdown: string }>(
      "browser-demonstration",
      input.recordingId,
    );
    if (demo?.environmentId !== id) throw new KodoError("NOT_FOUND", "找不到此浏览器的示教录制。");
    const controllerSessionId = this.get(id).controllerSessionId;
    return this.service.store.transaction(() => {
      const grant = this.service.automations.authorize(controllerSessionId, input.requestId);
      return this.service.automations.save({
        requestId: input.requestId,
        name: input.name,
        controllerSessionId,
        grantId: grant.id,
        promptTemplate:
          "在受管浏览器 " +
          id +
          " 中根据以下已脱敏示教执行。遇到人工登录或缺少参数时暂停并询问。\n" +
          demo.markdown,
        trigger: { kind: "calendar", frequency: "daily", time: input.time },
        timeZone: input.timeZone,
      });
    });
  }
  async userInput(id: string, generation: number, value: unknown) {
    const cast = this.userCast(id, generation);
    const input = z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("click"),
          x: z.number().min(0).max(1280),
          y: z.number().min(0).max(900),
        }),
        z.object({ type: z.literal("text"), text: z.string().max(2048) }),
        z.object({
          type: z.literal("key"),
          key: z.enum([
            "Enter",
            "Tab",
            "Backspace",
            "Escape",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          ]),
        }),
      ])
      .parse(value);
    let step: string | undefined;
    const steps = cast.steps;
    if (steps && steps.length < 120) {
      const origin = new URL(cast.page.url()).origin;
      if (!this.get(id).origins.includes(origin)) step = "{{需要人工登录或授权环境}}";
      else {
        // Persist structural selectors only. Labels, field values, URLs with paths,
        // browser storage, network headers and cross-frame inputs never enter a recording.
        const selector = await cast.page.evaluate(
          (point) => {
            let el = point ? document.elementFromPoint(point.x, point.y) : document.activeElement;
            if (
              !el ||
              el.matches('iframe,input[type=password],input[autocomplete~="one-time-code"]')
            )
              return null;
            const parts: string[] = [];
            while (el && el !== document.documentElement && parts.length < 20) {
              const tag = el.localName;
              if (!/^[a-z][a-z0-9]*$/.test(tag)) return null;
              const siblings = Array.from(el.parentElement?.children ?? []).filter(
                (node) => node.localName === tag,
              );
              parts.unshift(tag + ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")");
              el = el.parentElement;
            }
            return el === document.documentElement && parts.length ? parts.join(" > ") : null;
          },
          input.type === "click" ? { x: input.x, y: input.y } : null,
        );
        step = selector
          ? origin +
            " · " +
            (input.type === "click"
              ? "点击 "
              : input.type === "text"
                ? "输入 {{用户提供的文本}} 到 "
                : "按 " + input.key + " 于 ") +
            selector
          : "{{需要人工登录或授权环境}}";
      }
      this.userCast(id, generation);
    }
    if (input.type === "text") await cast.session.send("Input.insertText", { text: input.text });
    else if (input.type === "key") {
      await cast.session.send("Input.dispatchKeyEvent", { type: "keyDown", key: input.key });
      this.userCast(id, generation);
      await cast.session.send("Input.dispatchKeyEvent", { type: "keyUp", key: input.key });
    } else {
      for (const type of ["mousePressed", "mouseReleased"] as const) {
        this.userCast(id, generation);
        await cast.session.send("Input.dispatchMouseEvent", {
          type,
          x: input.x,
          y: input.y,
          button: "left",
          clickCount: 1,
        });
      }
    }
    if (
      step &&
      steps &&
      steps === cast.steps &&
      (input.type === "click" || steps.at(-1) !== step) &&
      steps.length < 120
    ) {
      if (steps.join("\n").length + step.length < 17000) steps.push(step);
    }
    return { ok: true };
  }
  async returnControl(id: string, expectedGeneration: number) {
    const allowed = this.get(id).origins;
    for (const page of this.contexts.get(id)?.pages() ?? []) {
      if (page.url() !== "about:blank" && !allowed.includes(new URL(page.url()).origin))
        throw new KodoError("CONFLICT", "请先返回已授权站点，再交还主控。");
    }
    const lease = this.acquire(id, "agent", expectedGeneration);
    const cast = this.casts.get(id);
    this.casts.delete(id);
    await cast?.session.detach().catch(() => {});
    const ctx = this.contexts.get(id);
    if (ctx) {
      await this.persistAndBroadcastSharedCookies(id, ctx, allowed).catch(() => {});
    }
    return lease;
  }
  private sharedCookiesPath(): string {
    return join(this.service.dataDir, "kodo", "browser-shared-cookies.json");
  }
  private readSharedCookies(): Cookie[] {
    const file = this.sharedCookiesPath();
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      return Array.isArray(parsed) ? (parsed as Cookie[]) : [];
    } catch {
      return [];
    }
  }
  private cookieMatchesOrigins(cookie: Cookie, origins: string[]): boolean {
    const cookieDomain = cookie.domain.replace(/^\./, "").toLowerCase();
    return origins.some((origin) => {
      try {
        const host = new URL(origin).hostname.toLowerCase();
        return host === cookieDomain || host.endsWith(`.${cookieDomain}`);
      } catch {
        return false;
      }
    });
  }
  private async loadSharedCookies(context: BrowserContext, origins: string[]): Promise<void> {
    const matching = this.readSharedCookies().filter((c) => this.cookieMatchesOrigins(c, origins));
    if (matching.length) {
      await context.addCookies(matching).catch(() => {});
    }
  }
  private async persistAndBroadcastSharedCookies(
    sourceEnvId: string,
    sourceContext: BrowserContext,
    origins: string[],
  ): Promise<void> {
    const fresh = (await sourceContext.cookies(origins)).filter((c) =>
      this.cookieMatchesOrigins(c, origins),
    );
    if (!fresh.length) return;
    const existing = this.readSharedCookies();
    const keyOf = (c: Cookie) => `${c.domain}|${c.path}|${c.name}`;
    const merged = new Map<string, Cookie>(existing.map((c) => [keyOf(c), c]));
    for (const c of fresh) merged.set(keyOf(c), c);
    const all = [...merged.values()];
    const target = this.sharedCookiesPath();
    mkdirSync(join(this.service.dataDir, "kodo"), { recursive: true });
    const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify(all), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, target);

    // Push newly acquired cookies to any other live browser contexts sharing those origins
    for (const [otherId, otherCtx] of this.contexts.entries()) {
      if (otherId === sourceEnvId) continue;
      try {
        const otherOrigins = this.get(otherId).origins;
        const forOther = fresh.filter((c) => this.cookieMatchesOrigins(c, otherOrigins));
        if (forOther.length) await otherCtx.addCookies(forOther).catch(() => {});
      } catch {}
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
        title: await page.title().catch(() => ""),
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
