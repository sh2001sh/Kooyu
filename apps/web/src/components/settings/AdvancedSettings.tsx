import { useState } from "react";
import type { HarnessId, ProviderConfiguration, Snapshot } from "@kodo/protocol";
import { api } from "../../lib/host-client";
import { HARNESS_NAMES } from "../../lib/harnesses";
import { ProviderConfigurationPanel } from "../ProviderConfiguration";
import { SettingsPage, SettingsRow, SettingsSection, SxSelect } from "./SettingsKit";

type Action = (work: () => Promise<unknown>) => Promise<void>;

/**
 * Rarely needed settings: per-project overrides of an engine's model source, and
 * fixed model mappings for engines that need one exact model identity.
 */
export function AdvancedSettings({
  snapshot,
  act,
  providerConfig,
  onProviderConfigLoaded,
}: {
  snapshot: Snapshot;
  act: Action;
  providerConfig?: ProviderConfiguration;
  onProviderConfigLoaded?: (data: ProviderConfiguration) => void;
}) {
  const [projectId, setProjectId] = useState(snapshot.projects[0]?.id ?? "");
  const project = snapshot.projects.find((p) => p.id === projectId);
  const engines = snapshot.harnesses.filter((h) => h.health?.launchable);
  const setProjectDefault = (harnessId: HarnessId, value: string) => {
    if (!project) return;
    const map = { ...(project.bindingDefaults ?? {}) };
    if (value === "inherit") delete map[harnessId];
    else map[harnessId] = value === "native" ? null : value;
    void act(() =>
      api(`/projects/${project.id}/binding-defaults`, "PATCH", {
        expectedRevision: project.configRevision ?? 0,
        bindingDefaults: map,
      }),
    );
  };
  return (
    <SettingsPage
      title="高级"
      description="大多数情况下不需要修改这里。引擎的默认模型来源在「引擎」页设置。"
    >
      <SettingsSection
        title="按项目覆盖模型来源"
        description="让某个项目里的新对话改用另一个模型来源。未设置时沿用「引擎」页的选择。"
        actions={
          snapshot.projects.length > 0 ? (
            <SxSelect
              ariaLabel="选择项目"
              value={projectId}
              onChange={setProjectId}
              options={snapshot.projects.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
            />
          ) : undefined
        }
      >
        {!project ? (
          <div className="sx-empty">还没有项目。</div>
        ) : (
          engines.map((h) => {
            const current = project.bindingDefaults?.[h.id];
            const value = current === undefined ? "inherit" : current === null ? "native" : current;
            const bindings = snapshot.bindings.filter((b) => b.harnessId === h.id);
            return (
              <SettingsRow key={h.id} label={h.name} htmlFor={`proj-${h.id}`}>
                <SxSelect
                  id={`proj-${h.id}`}
                  value={value}
                  onChange={(val) => setProjectDefault(h.id, val)}
                  options={[
                    { value: "inherit", label: "沿用引擎设置" },
                    { value: "native", label: `${HARNESS_NAMES[h.id]} 自身登录` },
                    ...bindings.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                />
              </SettingsRow>
            );
          })
        )}
      </SettingsSection>

      <SettingsSection
        title="固定模型映射"
        description="把引擎固定到某个来源的某一个模型（含协议转换）。只在需要锁定模型身份时使用。"
      >
        <div className="sx-legacy">
          <ProviderConfigurationPanel
            snapshot={snapshot}
            act={act}
            section="bindings"
            onSectionChange={() => {}}
            data={providerConfig}
            onDataLoaded={onProviderConfigLoaded}
          />
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
