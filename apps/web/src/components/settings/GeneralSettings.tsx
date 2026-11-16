import { useEffect, useState } from "react";
import type { AppSettings, Snapshot } from "@kodo/protocol";
import { useAppPreferences } from "../../lib/preferences";
import { LANGUAGES, useT } from "../../lib/i18n";
import {
  SaveBar,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SxSelect,
  Toggle,
} from "./SettingsKit";

/** Language, workspace, appearance, conversation display and personal instructions. */
export function GeneralSettings({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const { settings, loaded, error: loadError, save } = useAppPreferences();
  const [draft, setDraft] = useState(settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setSaved(false);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        void save(draft)
          .then(() => setSaved(true))
          .catch((e: Error) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <SettingsPage title={t("nav.general")}>
        {loadError && <p className="sx-note is-error">{loadError}</p>}

        <SettingsSection title="首次设置引导">
          <SettingsRow label="重新检查主 Agent 与执行引擎">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("kooyu:open-setup"))}
            >
              打开设置引导
            </button>
          </SettingsRow>
        </SettingsSection>
        <SettingsSection title={t("general.section.language")}>
          <SettingsRow
            label={t("general.language")}
            description={t("general.language.desc")}
            htmlFor="pref-lang"
          >
            <SxSelect
              id="pref-lang"
              ariaLabel={t("general.language")}
              value={draft.language}
              options={LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
              onChange={(val) => set("language", val as AppSettings["language"])}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("general.section.workspace")}>
          <SettingsRow
            label={t("general.defaultEngine")}
            description={t("general.defaultEngine.desc")}
            htmlFor="pref-harness"
          >
            <SxSelect
              id="pref-harness"
              ariaLabel={t("general.defaultEngine")}
              value={draft.defaultHarnessId}
              options={snapshot.harnesses.map((h) => ({
                value: h.id,
                label: `${h.name}${h.health?.launchable === false ? ` ${t("general.notInstalled")}` : ""}`,
                disabled: h.health?.launchable === false,
              }))}
              onChange={(val) => set("defaultHarnessId", val as AppSettings["defaultHarnessId"])}
            />
          </SettingsRow>
          <SettingsRow
            label={t("general.sendKey")}
            description={t("general.sendKey.desc")}
            htmlFor="pref-send"
          >
            <SxSelect
              id="pref-send"
              ariaLabel={t("general.sendKey")}
              value={draft.sendShortcut}
              options={[
                { value: "enter", label: t("general.sendKey.enter") },
                { value: "mod-enter", label: t("general.sendKey.mod") },
              ]}
              onChange={(val) => set("sendShortcut", val as AppSettings["sendShortcut"])}
            />
          </SettingsRow>
          <SettingsRow label={t("general.autoModels")} description={t("general.autoModels.desc")}>
            <Toggle
              label={t("general.autoModels")}
              checked={draft.autoRefreshModels}
              onChange={(v) => set("autoRefreshModels", v)}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("general.section.appearance")}>
          <SettingsRow label={t("general.theme")} htmlFor="pref-theme">
            <SxSelect
              id="pref-theme"
              ariaLabel={t("general.theme")}
              value={draft.theme}
              options={[
                { value: "system", label: t("general.theme.system") },
                { value: "light", label: t("general.theme.light") },
                { value: "dark", label: t("general.theme.dark") },
              ]}
              onChange={(val) => set("theme", val as AppSettings["theme"])}
            />
          </SettingsRow>
          <SettingsRow
            label={t("general.fontSize")}
            description={t("general.fontSize.desc")}
            htmlFor="pref-font"
          >
            <SxSelect
              id="pref-font"
              ariaLabel={t("general.fontSize")}
              value={draft.messageFontSize}
              options={[12, 14, 15, 16, 18, 20, 22].map((size) => ({
                value: size,
                label: `${size} px`,
              }))}
              onChange={(val) => set("messageFontSize", Number(val))}
            />
          </SettingsRow>
          <SettingsRow label={t("general.motion")} description={t("general.motion.desc")}>
            <Toggle
              label={t("general.motion")}
              checked={draft.reduceMotion}
              onChange={(v) => set("reduceMotion", v)}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("general.section.chat")}>
          <SettingsRow label={t("general.thinking")} description={t("general.thinking.desc")}>
            <Toggle
              label={t("general.thinking")}
              checked={draft.expandThinking}
              onChange={(v) => set("expandThinking", v)}
            />
          </SettingsRow>
          <SettingsRow label={t("general.tools")} description={t("general.tools.desc")}>
            <Toggle
              label={t("general.tools")}
              checked={draft.collapseTools}
              onChange={(v) => set("collapseTools", v)}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          title={t("general.section.instructions")}
          description={t("general.instructions.desc")}
        >
          <SettingsRow
            stacked
            label={t("general.instructions.label")}
            description={`${draft.personalInstructions.length.toLocaleString()} / 16,000`}
            htmlFor="pref-instructions"
          >
            <textarea
              id="pref-instructions"
              rows={7}
              maxLength={16000}
              value={draft.personalInstructions}
              onChange={(e) => set("personalInstructions", e.target.value)}
              placeholder={t("general.instructions.placeholder")}
            />
          </SettingsRow>
        </SettingsSection>

        <SaveBar
          dirty={dirty && loaded}
          busy={busy}
          saved={saved}
          error={error}
          onReset={() => setDraft(settings)}
        />
      </SettingsPage>
    </form>
  );
}
