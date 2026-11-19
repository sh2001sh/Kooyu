import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_UPDATE_SETTINGS, DEFAULT_VOICE_SETTINGS, type AppSettings } from "@kodo/protocol";
import { installAppearanceSync } from "./appearance";
import { api } from "./host-client";

const defaults: AppSettings = {
  revision: 0,
  language: "system",
  voice: { ...DEFAULT_VOICE_SETTINGS },
  update: { ...DEFAULT_UPDATE_SETTINGS },
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
  update: (updater: (current: AppSettings) => AppSettings) => Promise<void>;
}>({
  settings: defaults,
  loaded: false,
  error: "",
  save: async () => {},
  update: async () => {},
});

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaults),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const settingsRef = useRef(defaults);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    installAppearanceSync();
    void api<AppSettings>("/app-settings")
      .then((next) => {
        settingsRef.current = next;
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
  const enqueue = useCallback(
    (nextOrUpdater: AppSettings | ((current: AppSettings) => AppSettings)) => {
      const task = queueRef.current.then(async () => {
        const payload =
          typeof nextOrUpdater === "function" ? nextOrUpdater(settingsRef.current) : nextOrUpdater;
        const saved = await api<AppSettings>("/app-settings", "PATCH", payload);
        settingsRef.current = saved;
        setSettings(saved);
        setError("");
      });
      queueRef.current = task.catch(() => {});
      return task;
    },
    [],
  );
  const save = useCallback((next: AppSettings) => enqueue(next), [enqueue]);
  const update = useCallback(
    (updater: (current: AppSettings) => AppSettings) => enqueue(updater),
    [enqueue],
  );
  return (
    <Context.Provider value={{ settings, loaded, error, save, update }}>
      {children}
    </Context.Provider>
  );
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
