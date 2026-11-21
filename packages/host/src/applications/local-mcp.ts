import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface Entry {
  client: Client;
  ready: Promise<void>;
  users: number;
  idle?: ReturnType<typeof setTimeout>;
  closed: boolean;
}

export class LocalMcpPool {
  private entries = new Map<string, Entry>();

  private evict(key: string, entry: Entry) {
    entry.closed = true;
    clearTimeout(entry.idle);
    if (this.entries.get(key) === entry) {
      this.entries.delete(key);
    }
  }

  async use<T>(
    key: string,
    command: string,
    args: string[],
    run: (client: Client) => Promise<T>,
    env: Record<string, string> = {},
  ) {
    let entry = this.entries.get(key);
    if (!entry || entry.closed) {
      const client = new Client({ name: "kooyu", version: "1.0.0" });
      const transport = new StdioClientTransport({ command, args, env, stderr: "ignore" });
      const created: Entry = {
        client,
        ready: Promise.resolve(),
        users: 0,
        closed: false,
      };
      transport.onclose = () => this.evict(key, created);
      transport.onerror = () => this.evict(key, created);
      created.ready = client.connect(transport).catch((error) => {
        this.evict(key, created);
        void client.close().catch(() => {});
        throw error;
      });
      this.entries.set(key, created);
      entry = created;
    }
    clearTimeout(entry.idle);
    entry.users++;
    try {
      await entry.ready;
      return await run(entry.client);
    } catch (error) {
      if (entry.closed) {
        this.evict(key, entry);
      }
      throw error;
    } finally {
      entry.users = Math.max(0, entry.users - 1);
      if (entry.users === 0 && !entry.closed && this.entries.get(key) === entry) {
        entry.idle = setTimeout(() => void this.close(key), 60000);
        entry.idle.unref();
      }
    }
  }

  async close(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.evict(key, entry);
    await entry.client.close().catch(() => {});
  }

  async dispose() {
    await Promise.all([...this.entries.keys()].map((key) => this.close(key)));
  }
}
