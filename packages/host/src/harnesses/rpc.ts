import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, join, extname, dirname, resolve } from "node:path";
import { KodoError } from "@kodo/protocol";
import type { AdapterContext, Wire } from "./adapter.js";
export class RpcRejected extends Error {
  constructor(
    message: string,
    readonly rpcCode?: number,
  ) {
    super(message);
  }
}
export function executable(command: string): string | null {
  const runnable = (path: string) => {
    try {
      if (!statSync(path).isFile()) return false;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (runnable(command)) return command;
  for (const path of (process.env.PATH ?? "").split(delimiter))
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]) {
      const candidate = join(path, command + ext);
      if (runnable(candidate)) return candidate;
    }
  return null;
}
export function launch(
  ctx: AdapterContext,
  options: { detached?: boolean } = {},
): ChildProcessWithoutNullStreams {
  const bin = executable(ctx.launch.command);
  if (!bin)
    throw new KodoError(
      "UNAVAILABLE",
      ctx.launch.unavailableReason ??
        `未发现 ${ctx.launch.command} 的原生入口。可使用桌面版附带入口或配置 installations.json。`,
    );
  let command = bin,
    args = ctx.launch.args;
  if (process.platform === "win32" && [".cmd", ".bat"].includes(extname(bin).toLowerCase())) {
    // npm's shim is configuration, never a command shell. Resolve its JS entry
    // and pass arguments as argv, including paths with spaces and metacharacters.
    const source = readFileSync(bin, "utf8"),
      entry =
        /%(?:dp0|dp0:)%?[^"\r\n]*?\.(?:c?js|mjs)/i.exec(source)?.[0] ??
        /%dp0%[^"\r\n]*?\.(?:c?js|mjs)/i.exec(source)?.[0];
    const npmEntry = entry
      ? resolve(dirname(bin), entry.replace(/^%dp0%?[\\/]?/i, "").replaceAll("\\", "/"))
      : null;
    if (!npmEntry || !existsSync(npmEntry))
      throw new KodoError(
        "UNAVAILABLE",
        `无法直接解析 ${bin} 的 Node 入口，请在 installations.json 配置原生可执行文件或 node + JS 入口。`,
      );
    command = process.execPath;
    args = [npmEntry, ...args];
  }
  return spawn(command, args, {
    cwd: ctx.cwd ?? ctx.dataDir,
    env: { ...ctx.env, ...ctx.launch.env },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    detached: options.detached ?? false,
  });
}
export class JsonRpc {
  readonly child: ChildProcessWithoutNullStreams;
  private pending = new Map<
    string,
    {
      resolve: (v: Wire) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout> | undefined;
    }
  >();
  private closed = false;
  private closing?: Promise<void>;
  onNotification: (method: string, params: Wire) => void = () => {};
  onRequest: (method: string, params: Wire, id: string | number) => Promise<unknown> = async () => {
    throw new RpcRejected("Unsupported client request", -32601);
  };
  onClose: (error: Error) => void = () => {};
  constructor(
    ctx: AdapterContext,
    private readonly includeVersion = true,
  ) {
    this.child = launch(ctx);
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      let msg: Wire;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.method && msg.id !== undefined) {
        void Promise.resolve()
          .then(() => this.onRequest(msg.method, msg.params ?? {}, msg.id))
          .then(
            (result) => this.write({ id: msg.id, result }),
            (error) =>
              this.write({
                id: msg.id,
                error: {
                  code: error instanceof RpcRejected ? error.rpcCode : -32603,
                  message: error instanceof Error ? error.message : "Client request failed",
                },
              }),
          )
          .catch(() => {});
      } else if (msg.method) {
        try {
          ctx.onNativeNotification?.(msg.method, msg.params ?? {});
          this.onNotification(msg.method, msg.params ?? {});
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Native translation failed"));
        }
      } else if (msg.id !== undefined) {
        const p = this.pending.get(String(msg.id));
        if (!p) return;
        this.pending.delete(String(msg.id));
        clearTimeout(p.timer);
        if (msg.error) p.reject(new RpcRejected(msg.error.message, msg.error.code));
        else p.resolve(msg.result ?? {});
      }
    });
    if (ctx.onStderr)
      this.child.stderr.on("data", (data: Buffer) => ctx.onStderr?.(data.toString()));
    else this.child.stderr.resume();
    const fail = (error: Error) => {
      if (this.closed) return;
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      this.pending.clear();
      try {
        this.onClose(error);
      } catch {
        console.error("Native close callback failed");
      }
      this.child.stdin.end();
      if (this.child.exitCode === null) this.child.kill();
      lines.close();
    };
    this.child.on("error", fail);
    this.child.on("exit", (code) =>
      fail(new Error(`原生进程已退出 (${code ?? "signal"})，运行状态需要对账。`)),
    );
    this.child.stdin.on("error", fail);
  }
  private write(msg: Wire): void {
    if (this.closed || this.closing) throw new Error("原生连接已关闭。");
    this.child.stdin.write(
      JSON.stringify(this.includeVersion ? { jsonrpc: "2.0", ...msg } : msg) + "\n",
    );
  }
  request(
    method: string,
    params: unknown = {},
    id: string = randomUUID(),
    timeoutMs = 30000,
  ): Promise<Wire> {
    if (this.pending.has(id)) return Promise.reject(new Error("Duplicate wire request id"));
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`${method} 响应超时；原生接收结果未知。`));
            }, timeoutMs)
          : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  notify(method: string, params: unknown = {}): void {
    this.write({ method, params });
  }
  async close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.closing = new Promise<void>((resolve, reject) => {
      let forced: ReturnType<typeof setTimeout> | undefined;
      const graceful = setTimeout(() => {
        this.child.kill();
        forced = setTimeout(() => {
          this.child.removeListener("exit", exited);
          reject(new Error("原生进程退出尚未确认，未启动替代进程。"));
        }, 3000);
      }, 2000);
      const exited = () => {
        clearTimeout(graceful);
        clearTimeout(forced);
        resolve();
      };
      this.child.once("exit", exited);
      this.child.stdin.end();
    });
    return this.closing;
  }
}
