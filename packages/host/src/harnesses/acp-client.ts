import { randomUUID } from "node:crypto";
import { open, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { RpcRejected, launch } from "./rpc.js";
import type { AdapterContext, Wire } from "./adapter.js";

const FILE_LIMIT = 1024 * 1024;
type Exit = { exitCode: number | null; signal: string | null };
type Terminal = {
  child: ChildProcessWithoutNullStreams;
  output: Buffer;
  limit: number;
  truncated: boolean;
  exit?: Exit;
  done: Promise<Exit>;
};

/** ACP v1 client services. Every write/command requires a one-operation approval. */
export class AcpClient {
  private terminals = new Map<string, Terminal>();
  private epoch = 0;
  private closed = false;
  constructor(
    private ctx: AdapterContext,
    private sessionId: () => string,
    private active: () => boolean,
  ) {}
  private check(params: Wire) {
    if (this.closed || !this.sessionId() || params.sessionId !== this.sessionId())
      throw new RpcRejected("ACP 客户端请求不属于当前会话。", -32602);
  }
  private async path(value: unknown, create = false): Promise<string> {
    if (typeof value !== "string" || !isAbsolute(value) || value.includes(String.fromCharCode(0)))
      throw new RpcRejected("ACP 文件和工作目录必须使用绝对路径。", -32602);
    const root = await realpath(this.ctx.cwd!);
    let actual: string;
    try {
      actual = await realpath(value);
    } catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      actual = join(await realpath(dirname(value)), basename(value));
    }
    const within = relative(root, actual);
    if (within === ".." || within.startsWith(".." + sep) || isAbsolute(within))
      throw new RpcRejected("ACP 客户端只允许访问当前工作目录。", -32602);
    return actual;
  }
  invalidateTurn() {
    this.epoch++;
  }
  private checkTurn(epoch: number) {
    if (this.closed || epoch !== this.epoch || !this.active())
      throw new RpcRejected("回合已停止，操作未执行。", -32602);
  }
  private async approve(method: string, params: Wire, requestId: string, epoch: number) {
    this.checkTurn(epoch);
    const answer = (await this.ctx.interact("client:" + requestId, {
      protocol: "acp",
      method,
      params,
      options: [
        { optionId: "allow_once", kind: "allow_once", name: "仅允许本次操作" },
        { optionId: "reject_once", kind: "reject_once", name: "拒绝" },
      ],
    })) as Wire;
    this.checkTurn(epoch);
    if (answer?.outcome?.outcome !== "selected" || answer.outcome.optionId !== "allow_once")
      throw new RpcRejected("用户拒绝或取消了此操作。", -32603);
  }
  async request(method: string, params: Wire, requestId: string): Promise<unknown> {
    this.check(params);
    const epoch = this.epoch;
    if (method === "fs/read_text_file") {
      if (!this.active()) throw new RpcRejected("当前没有活动回合。", -32602);
      for (const key of ["line", "limit"])
        if (params[key] != null && (!Number.isSafeInteger(params[key]) || params[key] < 1))
          throw new RpcRejected("行号和行数必须为正整数。", -32602);
      const file = await open(await this.path(params.path), "r");
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > FILE_LIMIT)
          throw new RpcRejected("只支持不超过 1 MiB 的文本文件。", -32602);
        const bytes = Buffer.alloc(FILE_LIMIT + 1);
        let bytesRead = 0;
        while (bytesRead < bytes.length) {
          const chunk = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
          if (chunk.bytesRead === 0) break;
          bytesRead += chunk.bytesRead;
        }
        if (bytesRead > FILE_LIMIT) throw new RpcRejected("文本文件超过读取上限。", -32602);
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, bytesRead),
        );
        if (content.includes(String.fromCharCode(0)))
          throw new RpcRejected("文件包含二进制内容。", -32602);
        const start = (params.line ?? 1) - 1;
        this.checkTurn(epoch);
        return {
          content:
            params.line == null && params.limit == null
              ? content
              : content
                  .split("\n")
                  .slice(start, params.limit == null ? undefined : start + params.limit)
                  .join("\n"),
        };
      } finally {
        await file.close();
      }
    }
    if (method === "fs/write_text_file") {
      if (typeof params.content !== "string" || Buffer.byteLength(params.content) > FILE_LIMIT)
        throw new RpcRejected("文本写入内容必须为不超过 1 MiB 的字符串。", -32602);
      const target = await this.path(params.path, true);
      await this.approve(method, { path: target, content: params.content }, requestId, epoch);
      if ((await this.path(params.path, true)) !== target)
        throw new RpcRejected("审批期间目标路径发生变化。", -32602);
      const temporary = join(dirname(target), ".kodo-acp-" + randomUUID());
      const file = await open(temporary, "wx", 0o600);
      try {
        const existing = await stat(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (existing && !existing.isFile()) throw new RpcRejected("只能写入普通文本文件。", -32602);
        if (existing) await file.chmod(existing.mode & 0o777);
        await file.writeFile(params.content, "utf8");
        await file.sync();
        await file.close();
        if ((await this.path(params.path, true)) !== target)
          throw new RpcRejected("写入期间目标路径发生变化。", -32602);
        if (this.closed || this.epoch !== epoch || !this.active())
          throw new RpcRejected("回合已停止，操作未执行。", -32602);
        await rename(temporary, target);
      } finally {
        await file.close();
        await unlink(temporary).catch(() => {});
      }
      return {};
    }
    if (method === "terminal/create") {
      if (
        typeof params.command !== "string" ||
        !params.command.trim() ||
        (params.args !== undefined &&
          (!Array.isArray(params.args) || params.args.some((x: unknown) => typeof x !== "string")))
      )
        throw new RpcRejected("终端命令或参数无效。", -32602);
      const limit = params.outputByteLimit ?? FILE_LIMIT;
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > FILE_LIMIT)
        throw new RpcRejected("终端输出上限必须为 0 到 1 MiB。", -32602);
      if (
        params.env !== undefined &&
        (!Array.isArray(params.env) ||
          params.env.some(
            (e: Wire) =>
              !e ||
              typeof e.name !== "string" ||
              !e.name ||
              e.name.includes("=") ||
              typeof e.value !== "string",
          ))
      )
        throw new RpcRejected("终端环境变量无效。", -32602);
      const cwd = await this.path(params.cwd ?? this.ctx.cwd);
      await this.approve(
        method,
        {
          command: params.command,
          args: params.args ?? [],
          cwd,
          execution: "使用 Host 用户权限执行",
          env: params.env ?? [],
        },
        requestId,
        epoch,
      );
      this.checkTurn(epoch);
      if (this.terminals.size >= 16) throw new RpcRejected("请先释放已有终端。", -32602);
      const child = launch(
        {
          ...this.ctx,
          cwd,
          env: {
            ...this.ctx.env,
            ...Object.fromEntries((params.env ?? []).map((e: Wire) => [e.name, e.value])),
          },
          launch: { command: params.command, args: params.args ?? [] },
        },
        { detached: process.platform !== "win32" },
      );
      child.stdin.end();
      let resolveExit!: (exit: Exit) => void;
      const done = new Promise<Exit>((resolve) => {
        resolveExit = resolve;
      });
      const terminal: Terminal = { child, output: Buffer.alloc(0), truncated: false, limit, done };
      const append = (text: string) => {
        terminal.output = Buffer.concat([terminal.output, Buffer.from(text)]);
        if (terminal.output.length > limit) {
          let offset = terminal.output.length - limit;
          while (offset < terminal.output.length && (terminal.output[offset]! & 0xc0) === 0x80)
            offset++;
          terminal.output = terminal.output.subarray(offset);
          terminal.truncated = true;
        }
      };
      for (const stream of [child.stdout, child.stderr]) {
        const decoder = new StringDecoder("utf8");
        stream.on("data", (data: Buffer) => append(decoder.write(data)));
        stream.on("end", () => append(decoder.end()));
      }
      child.once("error", (error) => {
        append(error.message);
        terminal.exit = { exitCode: null, signal: "spawn-error" };
        resolveExit(terminal.exit);
      });
      child.once("close", (exitCode, signal) => {
        terminal.exit ??= { exitCode, signal };
        resolveExit(terminal.exit);
      });
      const terminalId = randomUUID();
      this.terminals.set(terminalId, terminal);
      return { terminalId };
    }
    if (
      !["terminal/output", "terminal/wait_for_exit", "terminal/kill", "terminal/release"].includes(
        method,
      )
    )
      throw new RpcRejected("ACP 客户端不支持此方法。", -32601);
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) throw new RpcRejected("终端不存在或已释放。", -32602);
    if (method === "terminal/output")
      return {
        output: terminal.output.toString("utf8"),
        truncated: terminal.truncated,
        ...(terminal.exit ? { exitStatus: terminal.exit } : {}),
      };
    if (method === "terminal/wait_for_exit") return terminal.done;
    await this.kill(terminal);
    if (method === "terminal/release") this.terminals.delete(params.terminalId);
    return {};
  }
  private async kill(terminal: Terminal) {
    if (terminal.exit) return;
    if (process.platform === "win32" && terminal.child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill.exe", ["/PID", String(terminal.child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          shell: false,
        });
        const finish = () => {
          clearTimeout(timeout);
          terminal.child.kill();
          resolve();
        };
        const timeout = setTimeout(() => {
          killer.kill();
          finish();
        }, 5000);
        killer.once("error", finish);
        killer.once("exit", finish);
      });
    } else if (terminal.child.pid) {
      try {
        process.kill(-terminal.child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        terminal.child.kill("SIGKILL");
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        terminal.done,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("ACP 终端退出尚未确认。")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async cancel() {
    this.invalidateTurn();
    await Promise.all([...this.terminals.values()].map((terminal) => this.kill(terminal)));
  }
  async close() {
    this.closed = true;
    await this.cancel();
    this.terminals.clear();
  }
}
