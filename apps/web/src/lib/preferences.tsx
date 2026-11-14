import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppSettings } from "@kodo/protocol";
import { api } from "./host-client";

const defaults: AppSettings = {
  revision: 0,
  language: "system",
  defaultHarnessId: "kodo",
  theme: "system",
  messageFontSize: 15,
  sendShortcut: "enter",
  reduceMotion: false,
  autoRefreshModels: true,
  personalInstructions: "",
  expandThinking: true,
  collapseTools: true,
  harnessDefaults: {},
};
const Context = createContext<{
  settings: AppSettings;
  loaded: boolean;
  error: string;
  save: (next: AppSettings) => Promise<void>;
}>({ settings: defaults, loaded: false, error: "", save: async () => {} });

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaults),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void api<AppSettings>("/app-settings")
      .then((next) => {
        setSettings(next);
        setLoaded(true);
      })
      .catch((error: Error) => setError(error.message));
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--message-font-size",
      `${settings.messageFontSize}px`,
    );
    document.documentElement.dataset.reduceMotion = String(settings.reduceMotion);
  }, [settings.messageFontSize, settings.reduceMotion]);
  useEffect(() => {
    const nav = navigator.language.toLowerCase();
    document.documentElement.lang =
      settings.language !== "system"
        ? settings.language
        : nav.startsWith("zh")
          ? "zh-CN"
          : nav.startsWith("ja")
            ? "ja"
            : "en";
  }, [settings.language]);
  const save = async (next: AppSettings) => {
    const saved = await api<AppSettings>("/app-settings", "PATCH", next);
    setSettings(saved);
    setError("");
  };
  return <Context.Provider value={{ settings, loaded, error, save }}>{children}</Context.Provider>;
}
export function useAppPreferences() {
  return useContext(Context);
}
export function shouldSend(
  event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    nativeEvent: { isComposing?: boolean };
  },
  shortcut: AppSettings["sendShortcut"],
) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    (shortcut === "enter" || event.ctrlKey || event.metaKey)
  );
}
