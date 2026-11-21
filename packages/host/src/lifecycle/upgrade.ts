import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";

/** Updates pause execution, preserve receipts and back up before the handoff. */
export class HostUpgrade {
  private target: string | null = null;
  private transitioning = false;
  constructor(
    private readonly service: SessionService,
    readonly buildId: string,
    private readonly installedBuild: () => string | null,
    private readonly restart: (ticket: string) => Promise<void>,
  ) {}
  state() {
    return {
      buildId: this.buildId,
      targetBuildId: this.target,
      state: this.transitioning ? "restarting" : this.target ? "pausing" : "current",
    };
  }
  request(buildId: string) {
    if (buildId === this.buildId) return this.state();
    if (buildId !== this.installedBuild())
      throw new KodoError("CONFLICT", "新版后台文件尚未完整安装，请等待安装完成。");
    this.target = buildId;
    return this.state();
  }
  async tick() {
    if (this.transitioning) return;
    const installed = this.installedBuild();
    if (!installed || installed === this.buildId) {
      this.target = null;
      return;
    }
    this.target = installed;
    this.transitioning = true;
    const ticket = randomUUID();
    try {
      await this.service.pauseForUpdate();
      const frozen = this.service.health();
      const directory = join(this.service.dataDir, "upgrade-backups");
      mkdirSync(directory, { recursive: true });
      await backup(this.service.store.db, join(directory, `${Date.now()}-${ticket}.sqlite`));
      if (this.installedBuild() !== installed)
        throw new Error("安装文件在后台切换前发生变化，已延后切换。");
      this.service.store.put("lifecycle", "upgrade", {
        ticket,
        buildId: installed,
        generation: frozen.generation,
      });
      await this.restart(ticket);
    } catch (error) {
      this.service.store.remove("lifecycle", "upgrade");
      const frozen = this.service.health();
      this.service.lifecycle.resume(frozen.processIdentity, frozen.generation);
      this.service.resumeWork();
      this.transitioning = false;
      throw error;
    }
  }
}
