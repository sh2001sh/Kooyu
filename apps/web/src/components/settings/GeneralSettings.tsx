import { useEffect, useState } from "react";
import {
  DEFAULT_VOICE_SETTINGS,
  type AppSettings,
  type Snapshot,
  type VoiceStatus,
} from "@kodo/protocol";
import { api } from "../../lib/host-client";
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
import { UpdateSection } from "./UpdateSection";

/** Language, voice input, workspace, appearance, conversation display and personal instructions. */
export function GeneralSettings({
  snapshot,
  onOpenAppearance,
}: {
  snapshot: Snapshot;
  onOpenAppearance?: () => void;
}) {
  const t = useT();
  const { settings, loaded, error: loadError, save, update } = useAppPreferences();
  const [draft, setDraft] = useState(settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    let active = true;
    void api<VoiceStatus>("/voice/status")
      .then((next) => {
        if (active) setVoiceStatus(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const draftVoice = draft.voice ?? DEFAULT_VOICE_SETTINGS;
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setSaved(false);
  };
  const setVoice = <K extends keyof AppSettings["voice"]>(
    key: K,
    value: AppSettings["voice"][K],
  ) => {
    setDraft((old) => ({
      ...old,
      voice: { ...(old.voice ?? DEFAULT_VOICE_SETTINGS), [key]: value },
    }));
    setSaved(false);
  };
  const changeLanguage = (language: AppSettings["language"]) => {
    setDraft((old) => ({ ...old, language }));
    setError("");
    void update((current) => ({ ...current, language }))
      .then(() => setSaved(true))
      .catch((e: Error) => setError(e.message));
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const normalized: AppSettings = {
          ...draft,
          voice: {
            ...draftVoice,
            model: draftVoice.model.trim() || "whisper-1",
          },
        };
        void save(normalized)
          .then(() => setSaved(true))
          .catch((e: Error) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <SettingsPage title={t("nav.general")}>
        {loadError && <p className="sx-note is-error">{loadError}</p>}

        <SettingsSection title={t("general.setupSection")}>
          <SettingsRow label={t("general.setupRow")}>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("kooyu:open-setup"))}
            >
              {t("general.openSetup")}
            </button>
          </SettingsRow>
        </SettingsSection>

        <UpdateSection />

        <SettingsSection title={t("general.section.language")}>
          <SettingsRow
            label={t("general.language")}
            description={t("general.languageApplied")}
            htmlFor="pref-lang"
          >
            <SxSelect
              id="pref-lang"
              ariaLabel={t("general.language")}
              value={draft.language}
              options={LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
              onChange={(val) => changeLanguage(val as AppSettings["language"])}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("voice.section")}>
          <SettingsRow label={t("voice.engine")} htmlFor="pref-voice-engine">
            <SxSelect
              id="pref-voice-engine"
              ariaLabel={t("voice.engine")}
              value={draftVoice.engine}
              options={[
                { value: "auto", label: t("voice.engine.auto") },
                { value: "browser", label: t("voice.engine.browser") },
                { value: "provider", label: t("voice.engine.provider") },
              ]}
              onChange={(val) => setVoice("engine", val as AppSettings["voice"]["engine"])}
            />
          </SettingsRow>
          <SettingsRow
            label={t("voice.provider")}
            description={
              voiceStatus && !voiceStatus.providerAvailable ? t("voice.provider.none") : undefined
            }
            htmlFor="pref-voice-provider"
          >
            <SxSelect
              id="pref-voice-provider"
              ariaLabel={t("voice.provider")}
              value={draftVoice.providerId ?? ""}
              options={[
                { value: "", label: t("voice.provider.auto") },
                ...(voiceStatus?.providers ?? []).map((p) => ({
                  value: p.providerId,
                  label: `${p.providerName} (${p.protocol === "openai-responses" ? "Responses" : "OpenAI"})`,
                })),
              ]}
              onChange={(val) => setVoice("providerId", val ? String(val) : null)}
            />
          </SettingsRow>
          <SettingsRow label={t("voice.model")} htmlFor="pref-voice-model">
            <input
              id="pref-voice-model"
              type="text"
              list="kooyu-voice-models"
              aria-label={t("voice.model")}
              value={draftVoice.model}
              maxLength={120}
              onChange={(e) => setVoice("model", e.target.value)}
              placeholder="whisper-1"
              className="sx-voice-model-input"
            />
            <datalist id="kooyu-voice-models">
              <option value="whisper-1" />
              <option value="gpt-4o-mini-transcribe" />
              <option value="gpt-4o-transcribe" />
            </datalist>
          </SettingsRow>
          <SettingsRow label={t("voice.language")} htmlFor="pref-voice-lang">
            <SxSelect
              id="pref-voice-lang"
              ariaLabel={t("voice.language")}
              value={draftVoice.language}
              options={[
                { value: "auto", label: t("voice.language.auto") },
                { value: "zh-CN", label: "简体中文 (zh-CN)" },
                { value: "en-US", label: "English (en-US)" },
                { value: "ja-JP", label: "日本語 (ja-JP)" },
              ]}
              onChange={(val) => setVoice("language", val as AppSettings["voice"]["language"])}
            />
          </SettingsRow>
          <SettingsRow label={t("voice.autoSend")}>
            <Toggle
              label={t("voice.autoSend")}
              checked={draftVoice.autoSend}
              onChange={(v) => setVoice("autoSend", v)}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("general.section.workspace")}>
          <SettingsRow label={t("general.defaultEngine")} htmlFor="pref-harness">
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
          <SettingsRow label={t("general.sendKey")} htmlFor="pref-send">
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
          <SettingsRow label={t("general.autoModels")}>
            <Toggle
              label={t("general.autoModels")}
              checked={draft.autoRefreshModels}
              onChange={(v) => set("autoRefreshModels", v)}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("general.section.appearance")}>
          {onOpenAppearance && (
            <SettingsRow label={t("general.appearanceCustomize")}>
              <button type="button" onClick={onOpenAppearance}>
                {t("general.openAppearance")}
              </button>
            </SettingsRow>
          )}
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
          <SettingsRow label={t("general.fontSize")} htmlFor="pref-font">
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
          <SettingsRow label={t("general.motion")}>
            <Toggle
              label={t("general.motion")}
              checked={draft.reduceMotion}
              onChange={(v) => set("reduceMotion", v)}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("general.section.chat")}>
          <SettingsRow label={t("general.thinking")}>
            <Toggle
              label={t("general.thinking")}
              checked={draft.expandThinking}
              onChange={(v) => set("expandThinking", v)}
            />
          </SettingsRow>
          <SettingsRow label={t("general.tools")}>
            <Toggle
              label={t("general.tools")}
              checked={draft.collapseTools}
              onChange={(v) => set("collapseTools", v)}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("general.section.instructions")}>
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
