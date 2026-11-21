import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import { KodoError, type Workspace } from "@kodo/protocol";

export interface TerminalChunkEvent {
  text: string;
  cursor: number;
  reset: boolean;
  closed: boolean;
}

type TerminalListener = (event: TerminalChunkEvent) => void;

interface Terminal {
  pty: IPty;
  owner: string;
  workspaceId: string;
  output: string;
  offset: number;
  closed: boolean;
  touched: number;
  listeners: Set<TerminalListener>;
}

export class TerminalService {
  private terminals = new Map<string, Terminal>();

  async open(workspace: Workspace, owner: string) {
    const { spawn } = await import("node-pty");
    if (this.terminals.size >= 32) throw new KodoError("CONFLICT", "终端数量已达上限。");
    const pty = spawn(process.platform === "win32" ? "powershell.exe" : "/bin/sh", [], {
      cwd: workspace.rootPath,
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !/TOKEN|SECRET|PASSWORD|API_KEY/i.test(k)),
      ),
    });
    const id = randomUUID();
    const item: Terminal = {
      pty,
      owner,
      workspaceId: workspace.id,
      output: "",
      offset: 0,
      closed: false,
      touched: Date.now(),
      listeners: new Set(),
    };
    this.terminals.set(id, item);
    pty.onData((chunk) => {
      item.output = (item.output + chunk).slice(-262144);
      item.offset += chunk.length;
      item.touched = Date.now();
      const payload: TerminalChunkEvent = {
        text: chunk,
        cursor: item.offset,
        reset: false,
        closed: false,
      };
      for (const listener of item.listeners) listener(payload);
    });
    pty.onExit(() => {
      item.closed = true;
      const payload: TerminalChunkEvent = {
        text: "",
        cursor: item.offset,
        reset: false,
        closed: true,
      };
      for (const listener of item.listeners) listener(payload);
    });
    return { id };
  }

  get(id: string, owner: string) {
    const item = this.terminals.get(id);
    if (!item || item.owner !== owner) throw new KodoError("NOT_FOUND", "终端不存在。");
    item.touched = Date.now();
    return item;
  }

  read(id: string, owner: string, cursor: number): TerminalChunkEvent {
    const item = this.get(id, owner);
    const start = item.offset - item.output.length;
    return {
      text: item.output.slice(Math.max(0, cursor - start)),
      cursor: item.offset,
      reset: cursor < start,
      closed: item.closed,
    };
  }

  subscribe(id: string, owner: string, cursor: number, listener: TerminalListener): () => void {
    const item = this.get(id, owner);
    const initial = this.read(id, owner, cursor);
    if (initial.text || initial.reset || initial.closed) {
      listener(initial);
    }
    if (item.closed) return () => {};
    item.listeners.add(listener);
    return () => {
      item.listeners.delete(listener);
    };
  }

  busy(workspaceId: string) {
    return [...this.terminals.values()].some((t) => t.workspaceId === workspaceId && !t.closed);
  }

  close(id: string) {
    const t = this.terminals.get(id);
    if (!t) return;
    t.closed = true;
    for (const listener of t.listeners) {
      listener({ text: "", cursor: t.offset, reset: false, closed: true });
    }
    t.listeners.clear();
    try {
      t.pty.kill();
    } catch {}
    this.terminals.delete(id);
  }

  sweep(allowed: (owner: string) => boolean) {
    for (const [id, t] of this.terminals) {
      if (!allowed(t.owner) || (t.listeners.size === 0 && Date.now() - t.touched > 120000)) {
        this.close(id);
      }
    }
  }

  dispose() {
    for (const id of this.terminals.keys()) this.close(id);
  }
}
