import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  ChevronLeft,
  Folder,
  FolderOpen,
  GitBranch,
  Inbox,
  Info,
  Layers,
  MessageSquare,
  PanelRight,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import type {
  Command,
  ConversationMark,
  HarnessId,
  ProviderConfiguration,
  Project,
  RuntimeEvent,
  Session,
  Snapshot,
  Usage,
} from "@kodo/protocol";
import { AppPreferencesProvider, useAppPreferences } from "./lib/preferences";
import { FirstRun } from "./components/onboarding/FirstRun";
import { HostError, api, apiPath, hostPath, remoteClient, send } from "./lib/host-client";
import { CONNECTION_STATE_LABELS, HARNESS_NAMES, formatWorkspaceLabel } from "./lib/harnesses";
import { useSidebarLayout } from "./lib/useSidebarLayout";
import { completedCommandIds, reconcileCompletedCommands } from "./lib/command-completion";
import { Composer } from "./components/Composer";
import { RunStatus } from "./components/RunStatus";
import { CanvasAura } from "./components/CanvasAura";
import { DraftWorkspace, type DraftPreset } from "./components/DraftWorkspace";
import { HarnessBadge } from "./components/KodoBrand";
import { DeleteDialog, ProjectModal, ProjectEditModal } from "./components/Modals";
import { SessionDetail } from "./components/SessionDetail";
import { GoalPill, useGoals } from "./components/GoalPanel";
import { moveAttachments } from "./components/Attachments";
import { SessionRows, type SidebarViewMode } from "./components/SessionRows";
import { SegmentedControl } from "./components/SegmentedControl";
import {
  SETTINGS_LABEL_KEYS,
  SettingsMobileNav,
  SettingsSidebarChrome,
  SettingsSidebarNav,
  type SettingsCounts,
  type SettingsSectionId,
} from "./components/SettingsNavigation";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar } from "./components/Sidebar";
import { MobiusLoader } from "./components/MobiusLoader";
import { SplashScreen } from "./components/SplashScreen";
import { useT } from "./lib/i18n";
import { Transcript } from "./components/TranscriptView";
import { ConversationWorkspace } from "./components/ConversationWorkspace";
import { ConversationNav } from "./components/ConversationNav";
import {
  DevicesPage,
  HealthPage,
  InboxPage,
  PairScreen,
  UsagePage,
} from "./components/UtilityPages";
import { WorkCenter } from "./components/WorkCenter";
import { WorkbenchHub } from "./components/WorkbenchHub";
import { useWorkNotifications } from "./lib/work-notifications";
import "./styles/craft-tokens.css";
import "./styles/app.css";
import "./styles/settings.css";

type Wire = Record<string, any>;
type SearchHit = { sessionId: string; eventId?: string; snippet?: string };
type Action = (work: () => Promise<unknown>) => Promise<void>;

function App() {
  const {
    settings: preferences,
    loaded: preferencesLoaded,
    save: savePreferences,
  } = useAppPreferences();
  const t = useT();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [scope, setScope] = useState("all");
  const [selected, setSelected] = useState<string | null>(
    localStorage.getItem("kodo.session" + hostPath),
  );
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [messageIndex, setMessageIndex] = useState<ConversationMark[]>([]);
  const [optimistic, setOptimistic] = useState<{
    id: string;
    sessionId: string;
    text: string;
  } | null>(null);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [historyMode, setHistoryMode] = useState(false);
  const historyRef = useRef(false);
  const historicalEnd = useRef<number | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [searchFocus, setSearchFocus] = useState<{ sessionId: string; eventId: string } | null>(
    null,
  );
  const [anchorEventId, setAnchorEventId] = useState<string>();
  const pageRequest = useRef(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<SidebarViewMode>(() => {
    const saved = localStorage.getItem("kodo.viewMode");
    if (saved === "harness" || saved === "project" || saved === "recent") return saved;
    return typeof window !== "undefined" && window.innerWidth <= 760 ? "recent" : "project";
  });
  const [showArchived, setShowArchived] = useState(false);
  const draftStorageKey = (id: string) => `kooyu.draft:${hostPath}:${id}`;
  const [compose, setCompose] = useState(() =>
    selected ? (localStorage.getItem(draftStorageKey(selected)) ?? "") : "",
  );
  const composeValue = useRef(compose);
  composeValue.current = compose;
  const readingPositions = useRef(new Map<string, { top: number; bottom: boolean }>());
  const restorePosition = useRef<string | null>(null);
  const [inDraft, setInDraft] = useState(false);
  const [draftPreset, setDraftPreset] = useState<DraftPreset>({ harnessId: "kodo", nonce: 0 });
  useEffect(() => {
    if (!preferencesLoaded || inDraft || draftNonceRef.current !== 0) return;
    if (preferences.defaultHarnessId && preferences.defaultHarnessId !== draftPreset.harnessId) {
      draftNonceRef.current += 1;
      setDraftPreset({ harnessId: preferences.defaultHarnessId, nonce: draftNonceRef.current });
    }
  }, [preferencesLoaded, preferences.defaultHarnessId, inDraft, draftPreset.harnessId]);
  const [projectForm, setProjectForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project>();
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "project"; id: string; name: string; sessionCount: number }
    | { kind: "session"; id: string; title: string }
    | null
  >(null);
  const [detail, setDetail] = useState("");
  const [hubContext, setHubContext] = useState({
    project: "",
    tab: "work" as "work" | "artifacts" | "plans",
    nonce: 0,
  });
  const [filePreview, setFilePreview] = useState<{
    sessionId: string;
    path: string;
    key: number;
  }>();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [mobileSettingsDetail, setMobileSettingsDetail] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [mobileSubagents, setMobileSubagents] = useState<{
    count: number;
    selectedName: string | null;
  }>({ count: 0, selectedName: null });
  const [agentSheetOpen, setAgentSheetOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [pairNeeded, setPairNeeded] = useState(false);
  const [usage, setUsage] = useState<{ records: Usage[]; budgets: Wire[] }>();
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("harnesses");
  const [providerConfig, setProviderConfig] = useState<ProviderConfiguration>();
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [dark, setDark] = useState(localStorage.getItem("kodo.theme") === "dark");
  const layout = useSidebarLayout();

  const selectedRef = useRef(selected);
  const snapshotRef = useRef(snapshot);
  const snapshotRequest = useRef(0);
  const snapshotMutation = useRef(0);
  snapshotRef.current = snapshot;
  const draftNonceRef = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const historyScroll = useRef<{
    height: number;
    top: number;
    anchorId?: string;
    anchorTop?: number;
  } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyLoading = useRef(false);
  const [historyError, setHistoryError] = useState("");
  const automaticHistory = useRef(false);
  const bottom = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  selectedRef.current = selected;

  const openNewDraft = useCallback(
    (
      preset: {
        projectId?: string | null;
        workspaceId?: string | null;
        harnessId?: HarnessId;
        text?: string;
      } = {},
    ) => {
      if (selectedRef.current)
        localStorage.setItem(
          `kooyu.draft:${hostPath}:${selectedRef.current}`,
          composeValue.current,
        );
      draftNonceRef.current += 1;
      // Reuse a folder so "+" in a group does not ask for the path again: the folder of
      // the latest conversation in that project, else the last folder chosen anywhere.
      const sessions = snapshotRef.current?.sessions ?? [];
      const workspaces = snapshotRef.current?.workspaces ?? [];
      const known = (id: string | null | undefined) =>
        id && workspaces.some((w) => w.id === id && w.hostId === snapshotRef.current?.hostId)
          ? id
          : null;
      const latestIn = (projectId: string | null | undefined) =>
        [...sessions]
          .filter(
            (s) =>
              s.workspaceId &&
              (!s.executorId || s.executorId === "local") &&
              (projectId ? s.projectId === projectId : true),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.workspaceId ?? null;
      const workspaceId =
        preset.workspaceId !== undefined
          ? preset.workspaceId
          : preset.projectId
            ? (known(latestIn(preset.projectId)) ??
              workspaces.find(
                (w) => w.projectId === preset.projectId && w.hostId === snapshotRef.current?.hostId,
              )?.id ??
              null)
            : (known(localStorage.getItem("kodo.lastWorkspace")) ?? known(latestIn(null)));
      const projectId =
        preset.projectId !== undefined
          ? preset.projectId
          : workspaceId
            ? (workspaces.find((w) => w.id === workspaceId)?.projectId ?? null)
            : null;
      setScope("all");
      selectedRef.current = null;
      setSelected(null);
      localStorage.removeItem("kodo.session" + hostPath);
      setDetail("");
      setInDraft(true);
      setDraftPreset({
        projectId,
        workspaceId,
        harnessId: preset.harnessId ?? preferences.defaultHarnessId,
        nonce: draftNonceRef.current,
        text: preset.text,
      });
      setRenamingTitle(false);
    },
    [preferences.defaultHarnessId],
  );

  const refresh = useCallback(async () => {
    const request = ++snapshotRequest.current;
    const mutation = snapshotMutation.current;
    try {
      const next = await api<Snapshot>("/snapshot");
      // A response captured before local creation must not remove the new conversation.
      if (request !== snapshotRequest.current || mutation !== snapshotMutation.current)
        return snapshotRef.current ?? next;
      setSnapshot(next);
      if (selectedRef.current && !next.sessions.some((s) => s.id === selectedRef.current)) {
        setSelected(null);
        setDetail("");
        localStorage.removeItem("kodo.session" + hostPath);
      }
      setPairNeeded(false);
      return next;
    } catch (e) {
      if (e instanceof HostError && e.code === "UNAUTHORIZED") setPairNeeded(true);
      throw e;
    }
  }, []);

  const act: Action = async (work) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openNewDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewDraft]);

  useEffect(() => {
    localStorage.setItem("kodo.viewMode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      setDark(preferences.theme === "dark" || (preferences.theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("kodo.theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    let stream: EventSource | undefined,
      cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const start = () => {
      const current = ++generation;
      stream?.close();
      clearTimeout(retry);
      setConnected(false);
      if (cancelled || !navigator.onLine) return;
      void refresh()
        .then((snapshot) => {
          if (cancelled || current !== generation) return;
          setError("");
          // Snapshot supplies current projections; fetch transcript by page, stream only new events.
          const cursor = snapshot.eventCursor ?? 0;
          sessionStorage.setItem(`kodo.cursor.${snapshot.hostId}`, String(cursor));
          stream = new EventSource(apiPath("/events?after=" + cursor));
          stream.onopen = () => setConnected(true);
          stream.onerror = () => {
            if (cancelled || current !== generation) return;
            setConnected(false);
            stream?.close();
            clearTimeout(retry);
            retry = setTimeout(start, 2000);
          };
          stream.addEventListener("auth-expired", () => {
            stream?.close();
            setConnected(false);
            setPairNeeded(true);
          });
          // Reconcile the visible transcript after sleep/reconnect, not just projections.
          const selectedId = selectedRef.current;
          if (selectedId && !historyRef.current) {
            void api<{
              events: RuntimeEvent[];
              commands: Command[];
              olderCursor: number | null;
              messageIndex?: ConversationMark[];
            }>("/sessions/" + selectedId + "?tail=300")
              .then((page) => {
                if (
                  cancelled ||
                  current !== generation ||
                  selectedRef.current !== selectedId ||
                  historyRef.current
                )
                  return;
                setCommands(page.commands);
                if (page.messageIndex) setMessageIndex(page.messageIndex);
                setOlderCursor((old) =>
                  old === null
                    ? null
                    : page.olderCursor === null
                      ? null
                      : Math.min(old, page.olderCursor),
                );
                setEvents((events) =>
                  [
                    ...new Map(
                      [...events, ...page.events].map((event) => [event.sequence, event]),
                    ).values(),
                  ].sort((a, b) => a.sequence - b.sequence),
                );
              })
              .catch(() => {});
          }
          stream.onmessage = (message) => {
            const e = JSON.parse(message.data) as RuntimeEvent;
            sessionStorage.setItem(`kodo.cursor.${snapshot.hostId}`, String(e.sequence));
            // The host ingests the user message at dispatch: the command left the queue.
            const dispatchedId = (e.payload as { commandId?: string } | null)?.commandId;
            if (e.type === "message" && dispatchedId && e.sessionId === selectedRef.current) {
              setOptimistic((o) => (o?.id === dispatchedId ? null : o));
              setCommands((current) =>
                current.map((c) =>
                  c.id === dispatchedId && c.status === "accepted"
                    ? { ...c, status: "dispatched" }
                    : c,
                ),
              );
            }
            // Keep the session's run state in step with native events without waiting
            // for the debounced snapshot refresh.
            const runState =
              e.type === "turn-ended" || e.type === "settled"
                ? "idle"
                : e.type === "error"
                  ? (e.payload as Wire)?.result === "rejected" &&
                    (e.payload as Wire)?.mode !== "steer"
                    ? "idle"
                    : null
                  : e.type === "state" &&
                      ((e.payload as Wire)?.subtype === "api_retry" ||
                        (e.payload as Wire)?.type === "auto_retry_start" ||
                        (e.payload as Wire)?.willRetry ||
                        (e.payload as Wire)?.retry)
                    ? "running"
                    : e.type === "message" && dispatchedId
                      ? "running"
                      : e.type === "state" &&
                          ["running", "idle"].includes(String((e.payload as Wire)?.runState))
                        ? (String((e.payload as Wire).runState) as "running" | "idle")
                        : null;
            if (runState)
              setSnapshot((current) =>
                current
                  ? {
                      ...current,
                      sessions: current.sessions.map((s) =>
                        s.id === e.sessionId
                          ? {
                              ...s,
                              runState,
                              ...(e.type === "settled"
                                ? { executionState: "settled" as const }
                                : e.type === "message" && dispatchedId
                                  ? { executionState: "unknown" as const }
                                  : {}),
                            }
                          : s,
                      ),
                    }
                  : current,
              );
            if (e.sessionId === selectedRef.current) {
              setEvents((current) => {
                if (current.some((x) => x.sequence === e.sequence)) return current;
                const merged = [...current, e].sort((a, b) => a.sequence - b.sequence);
                return merged;
              });
            }
            if (!["text-delta", "tool", "message"].includes(e.type)) {
              clearTimeout(timer.current);
              timer.current = setTimeout(() => {
                void refresh().catch(() => {});
                const id = selectedRef.current;
                if (id)
                  void api<{ commands: Command[] }>(`/sessions/${id}?tail=300`)
                    .then((v) => {
                      if (selectedRef.current === id) setCommands(v.commands);
                    })
                    .catch(() => {});
              }, 200);
            }
          };
        })
        .catch((e) => {
          if (cancelled || current !== generation) return;
          setError(e.message);
          if (!(e instanceof HostError && e.code === "UNAUTHORIZED"))
            retry = setTimeout(start, 2000);
        });
    };
    const foreground = () => {
      if (document.visibilityState === "visible") start();
    };
    const offline = () => {
      generation++;
      stream?.close();
      clearTimeout(retry);
      setConnected(false);
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", start);
    window.addEventListener("offline", offline);
    start();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", start);
      window.removeEventListener("offline", offline);
      stream?.close();
      clearTimeout(timer.current);
      clearTimeout(retry);
    };
  }, [refresh]);

  const loadPage = async (before?: number, replace = false) => {
    const id = selectedRef.current;
    if (!id || (historyLoading.current && !replace)) return;
    historyLoading.current = true;
    const request = ++pageRequest.current;
    const priorHistory = historyRef.current;
    if (before !== undefined && !priorHistory)
      historicalEnd.current = eventsRef.current.at(-1)?.sequence ?? null;
    setAnchorEventId(undefined);
    historyRef.current = before !== undefined;
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const r = await api<{
        events: RuntimeEvent[];
        commands: Command[];
        olderCursor: number | null;
        messageIndex?: ConversationMark[];
      }>(`/sessions/${id}?${before === undefined ? "tail=300" : `before=${before}`}`);
      if (selectedRef.current !== id || request !== pageRequest.current) return;
      if (before !== undefined && r.olderCursor !== null && r.olderCursor >= before)
        throw new Error("历史记录未向前推进，请重试加载。");
      if (before === undefined) {
        // Search can start in the middle of a chat. Fill the gap to the latest
        // page before joining it, so subsequent upward scrolling never skips it.
        let cursor = r.olderCursor;
        while (
          !replace &&
          historicalEnd.current !== null &&
          cursor !== null &&
          (r.events[0]?.sequence ?? 0) > historicalEnd.current
        ) {
          const earlier = await api<{ events: RuntimeEvent[]; olderCursor: number | null }>(
            `/sessions/${id}?before=${cursor}`,
          );
          if (selectedRef.current !== id || request !== pageRequest.current) return;
          if (earlier.olderCursor !== null && earlier.olderCursor >= cursor)
            throw new Error("历史记录未向前推进，请重试加载。");
          r.events = [...earlier.events, ...r.events];
          cursor = earlier.olderCursor;
        }
        historicalEnd.current = null;
        historyScroll.current = null;
        restorePosition.current = null;
        bottom.current = true;
        setShowScrollToBottom(false);
        setEvents((current) =>
          replace
            ? r.events
            : [...new Map([...current, ...r.events].map((e) => [e.sequence, e])).values()].sort(
                (a, b) => a.sequence - b.sequence,
              ),
        );
      } else {
        bottom.current = false;
        const el = scroll.current;
        const anchor =
          el &&
          [...el.querySelectorAll<HTMLElement>('[id^="message-"]')].find(
            (row) => row.getBoundingClientRect().bottom > el.getBoundingClientRect().top,
          );
        const content = anchor?.querySelector(".markdown") ?? anchor;
        historyScroll.current = el
          ? {
              height: el.scrollHeight,
              top: el.scrollTop,
              anchorId: anchor?.id,
              anchorTop: content?.getBoundingClientRect().top,
            }
          : null;
        setEvents((current) =>
          [...new Map([...r.events, ...current].map((e) => [e.sequence, e])).values()].sort(
            (a, b) => a.sequence - b.sequence,
          ),
        );
      }
      setCommands(r.commands);
      if (r.messageIndex) setMessageIndex(r.messageIndex);
      if (before !== undefined || replace) setOlderCursor(r.olderCursor);
      setHistoryMode(before !== undefined);
      return r;
    } catch (error) {
      if (request === pageRequest.current) historyRef.current = priorHistory;
      throw error;
    } finally {
      if (request === pageRequest.current) {
        historyLoading.current = false;
        setLoadingHistory(false);
      }
    }
  };

  useEffect(() => {
    if (!selected) return;
    const request = ++pageRequest.current;
    const eventId = searchFocus?.sessionId === selected ? searchFocus.eventId : undefined;
    localStorage.setItem("kodo.session" + hostPath, selected);
    setEvents([]);
    setMessageIndex([]);
    setHistoryError("");
    automaticHistory.current = false;
    historicalEnd.current = null;
    historyScroll.current = null;
    historyLoading.current = false;
    setLoadingHistory(false);
    setCommands([]);
    setDetail("");
    setShowScrollToBottom(false);
    bottom.current = !eventId;
    let cancelled = false;
    historyRef.current = Boolean(eventId);
    setHistoryMode(Boolean(eventId));
    setAnchorEventId(undefined);
    setOlderCursor(null);
    void api<{
      events: RuntimeEvent[];
      commands: Command[];
      olderCursor: number | null;
      nativeHistory?: unknown;
      messageIndex?: ConversationMark[];
    }>(`/sessions/${selected}?${eventId ? `event=${encodeURIComponent(eventId)}` : "tail=300"}`)
      .then((r) => {
        if (cancelled || request !== pageRequest.current) return;
        setCommands(r.commands);
        if (r.messageIndex) setMessageIndex(r.messageIndex);
        setOlderCursor(r.olderCursor);
        if (eventId) {
          historicalEnd.current = r.events.at(-1)?.sequence ?? null;
          setEvents(r.events);
          setAnchorEventId(eventId);
          if (r.nativeHistory !== undefined)
            setDetail(
              JSON.stringify({ source: "原生历史快照", history: r.nativeHistory }, null, 2),
            );
          return;
        }
        setEvents((current) =>
          [...new Map([...r.events, ...current].map((e) => [e.sequence, e])).values()].sort(
            (a, b) => a.sequence - b.sequence,
          ),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          if (e.message?.includes("会话不存在") || e.code === "NOT_FOUND") {
            localStorage.removeItem("kodo.session" + hostPath);
            setSelected("");
            setError("");
          } else {
            setError(e.message);
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, searchFocus]);

  const loadEarlier = () => {
    if (olderCursor === null || historyLoading.current || historyError) return;
    void loadPage(olderCursor).catch((e) => {
      automaticHistory.current = false;
      setHistoryError(e instanceof Error ? e.message : "历史记录加载失败");
    });
  };

  useEffect(() => {
    if (automaticHistory.current && scroll.current && scroll.current.scrollTop < 160) loadEarlier();
  }, [events, loadingHistory]);

  const jumpToMessage = async (mark: ConversationMark) => {
    automaticHistory.current = false;
    const id = selectedRef.current;
    let cursor = olderCursor;
    try {
      while (!document.getElementById(mark.id) && cursor !== null && selectedRef.current === id) {
        const page = await loadPage(cursor);
        if (!page || page.olderCursor === cursor) break;
        cursor = page.olderCursor;
        if (page.events.some((e) => e.id === mark.eventId)) break;
      }
      if (selectedRef.current === id) setAnchorEventId(mark.eventId);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "消息加载失败");
    }
  };

  useLayoutEffect(() => {
    const prior = historyScroll.current;
    if (prior && scroll.current?.clientHeight) {
      historyScroll.current = null;
      const anchor = prior.anchorId ? document.getElementById(prior.anchorId) : null;
      const content = anchor?.querySelector(".markdown") ?? anchor;
      scroll.current.scrollTop =
        prior.top +
        (content && prior.anchorTop !== undefined
          ? content.getBoundingClientRect().top - prior.anchorTop
          : scroll.current.scrollHeight - prior.height);
    }
  }, [events]);

  useEffect(() => {
    if (anchorEventId && scroll.current?.clientHeight)
      scroll.current
        ?.querySelector('[data-search-hit="true"]')
        ?.scrollIntoView({ block: "center" });
  }, [events, anchorEventId]);

  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => {
      localStorage.setItem(draftStorageKey(selected), compose);
    }, 250);
    return () => clearTimeout(timer);
  }, [selected, compose]);

  useEffect(() => {
    if (scroll.current?.clientHeight && bottom.current && !historyRef.current && !anchorEventId) {
      if (restorePosition.current === selected && events.length) {
        restorePosition.current = null;
        const saved = selected ? readingPositions.current.get(selected) : undefined;
        if (saved && !saved.bottom && scroll.current) {
          bottom.current = false;
          scroll.current.scrollTop = saved.top;
          setShowScrollToBottom(true);
          return;
        }
      }
      scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "instant" });
    }
  }, [events]);

  // A paged read can confirm delivery before the live stream catches up.
  useEffect(() => {
    const completed = completedCommandIds(events);
    setCommands((current) => reconcileCompletedCommands(current, completed));
    setOptimistic((current) =>
      current &&
      (completed.has(current.id) ||
        events.some(
          (event) =>
            event.sessionId === current.sessionId &&
            event.type === "message" &&
            (event.payload as { commandId?: string })?.commandId === current.id,
        ))
        ? null
        : current,
    );
  }, [events]);

  // Session details show this session's tokens and cost; refresh when a turn ends.
  const [sessionUsage, setSessionUsage] = useState<Usage[]>([]);
  const turnsEnded = events.filter((e) => e.type === "turn-ended" || e.type === "usage").length;
  useEffect(() => {
    if (detail !== "manage" || !selected) return;
    let current = true;
    void api<{ records: Usage[] }>("/usage")
      .then((r) => {
        if (current) setSessionUsage(r.records.filter((u) => u.sessionId === selected));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [detail, selected, turnsEnded]);

  useEffect(() => {
    if (scope === "usage" || (scope === "health" && settingsSection === "usage")) {
      void api<{ records: Usage[]; budgets: Wire[] }>("/usage")
        .then(setUsage)
        .catch((e) => setError(e.message));
    }
    if (scope === "health") {
      void api<ProviderConfiguration>("/provider-configuration")
        .then(setProviderConfig)
        .catch(() => {});
    }
  }, [scope, snapshot, settingsSection]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      void api<Wire>(`/search?q=${encodeURIComponent(query)}`)
        .then((v) => {
          if (!cancelled) setSearchHits(v.hits);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query]);

  useWorkNotifications(scope === "health" || scope === "inbox" ? null : selected, (id) => {
    setScope("all");
    setSelected(id);
  });
  const session = snapshot?.sessions.find((s) => s.id === selected);
  const { goals, reload: reloadGoals } = useGoals(session, events);
  const project = snapshot?.projects.find((p) => p.id === session?.projectId);
  const workspace = snapshot?.workspaces.find((w) => w.id === session?.workspaceId);
  const [workspaceBranch, setWorkspaceBranch] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!workspace?.id) {
      setWorkspaceBranch(null);
      return;
    }
    void api<{ branch: string | null; git: boolean }>(`/workspaces/${workspace.id}/context`)
      .then((ctx) => {
        if (!cancelled) setWorkspaceBranch(ctx.git ? ctx.branch : null);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceBranch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  const isSpecial = [
    "health",
    "usage",
    "projects",
    "devices",
    "inbox",
    "work",
    "workbench",
  ].includes(scope);
  const isSettings = scope === "health";
  const pending = snapshot?.inbox.filter((i) => !i.resolved && !i.read) ?? [];

  const settingsCounts: SettingsCounts | undefined = useMemo(() => {
    if (!snapshot) return undefined;
    const installedCount = snapshot.harnesses.filter((h) => h.health?.installed).length;
    return {
      harnesses: `${installedCount}/${snapshot.harnesses.length}`,
      providers: providerConfig?.providers.length,
    };
  }, [snapshot, providerConfig]);

  const projectNames = useMemo(
    () => new Map((snapshot?.projects ?? []).map((p) => [p.id, p.name])),
    [snapshot?.projects],
  );

  const matchesSessionFilter = (s: Session) =>
    (showArchived || !s.archived) &&
    (!query ||
      s.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
      searchHits.some((h) => h.sessionId === s.id));

  const masters = (snapshot?.sessions ?? [])
    .filter((s) => s.kind === "supervisor" && !s.projectId && matchesSessionFilter(s))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));

  // The sidebar's 归档 segment is a view of archived sessions only; masters keep their own
  // L0 card and simply include archived ones while that view is open.
  const list = (snapshot?.sessions ?? []).filter(
    (s) =>
      !(s.kind === "supervisor" && !s.projectId) &&
      (scope !== "masters" || s.kind === "supervisor") &&
      (!showArchived || s.archived) &&
      matchesSessionFilter(s),
  );

  const openWorkbench = (
    project = "",
    tab: "work" | "artifacts" | "plans" | "project" = "work",
  ) => {
    if (selected && !isSpecial) {
      localStorage.setItem(draftStorageKey(selected), composeValue.current);
      if (scroll.current)
        readingPositions.current.set(selected, {
          top: scroll.current.scrollTop,
          bottom: bottom.current,
        });
    }
    setHubContext((old) => ({
      project,
      tab: tab === "project" ? "work" : tab,
      nonce: old.nonce + 1,
    }));
    setScope("workbench");
    setDetail("");
    setInDraft(false);
    setRenamingTitle(false);
  };
  const scopeName =
    scope === "workbench"
      ? t("nav.work")
      : scope === "all"
        ? t("sidebar.tab.all")
        : scope === "masters"
          ? t("sidebar.mainChat")
          : scope === "inbox"
            ? t("inbox.pending")
            : scope === "health"
              ? t("settings.title")
              : scope === "usage"
                ? t("usage.pageTitle")
                : scope === "projects"
                  ? t("projects.title")
                  : scope === "devices"
                    ? t("nav.devices")
                    : (snapshot?.projects.find((p) => p.id === scope)?.name ?? t("dock.chats"));

  const navigate = (next: string) => {
    if (next === "workbench") {
      openWorkbench(snapshot?.projects.some((p) => p.id === scope) ? scope : "");
      return;
    }
    if (next === "usage" || next === "devices" || next === "work") {
      setSettingsSection(next);
      setMobileSettingsDetail(true);
      next = "health";
    } else if (next === "health") {
      if (scope !== "health") setSettingsSection("general");
      setMobileSettingsDetail(false);
    }
    setScope(next);
    setInDraft(false);
    setRenamingTitle(false);
    if (!isSpecial && ["health", "usage", "devices", "inbox", "work"].includes(next)) {
      setDetail("");
    }
  };

  const selectSettingsSection = (next: SettingsSectionId) => {
    setSettingsSection(next);
    setMobileSettingsDetail(true);
  };

  useEffect(() => {
    const onOpenUpdate = () => {
      setScope("health");
      setSettingsSection("general");
      setMobileSettingsDetail(true);
      setInDraft(false);
      setTimeout(() => window.dispatchEvent(new Event("kooyu:check-updates")), 120);
    };
    window.addEventListener("kooyu:open-update", onOpenUpdate);
    return () => window.removeEventListener("kooyu:open-update", onOpenUpdate);
  }, []);

  const choose = useCallback(
    (id: string, eventId?: string) => {
      if (selectedRef.current) {
        localStorage.setItem(draftStorageKey(selectedRef.current), composeValue.current);
        if (scroll.current)
          readingPositions.current.set(selectedRef.current, {
            top: scroll.current.scrollTop,
            bottom: bottom.current,
          });
      }
      setCompose(localStorage.getItem(draftStorageKey(id)) ?? "");
      restorePosition.current = eventId ? null : id;
      bottom.current = true;
      if (snapshotRef.current?.sessions.find((session) => session.id === id)?.unread)
        void act(() => api("/sessions/" + id, "PATCH", { unread: false }));
      pageRequest.current++;
      setSearchFocus(eventId ? { sessionId: id, eventId } : null);
      if (isSpecial || scope === "masters") setScope("all");
      setInDraft(false);
      setRenamingTitle(false);
      setAgentSheetOpen(false);
      setMobileSubagents({ count: 0, selectedName: null });
      selectedRef.current = id;
      setSelected(id);
    },
    [act, isSpecial, scope],
  );

  const orderedNavSessions = useMemo(
    () =>
      (snapshot?.sessions ?? [])
        .filter((s) => !s.archived)
        .slice()
        .sort(
          (a, b) =>
            Number(b.kind === "supervisor") - Number(a.kind === "supervisor") ||
            b.createdAt.localeCompare(a.createdAt),
        ),
    [snapshot?.sessions],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLocaleLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
        return;
      }
      if (mod && key === "n") {
        e.preventDefault();
        openNewDraft();
        return;
      }
      if (mod && key === "b") {
        e.preventDefault();
        layout.toggleCollapsed();
        return;
      }
      if (mod && key === "i" && selectedRef.current && !isSpecial) {
        e.preventDefault();
        setDetail((current) => (current ? "" : "manage"));
        return;
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && orderedNavSessions.length) {
        e.preventDefault();
        const curIdx = orderedNavSessions.findIndex((s) => s.id === selectedRef.current);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const nextIdx =
          curIdx === -1
            ? 0
            : (curIdx + delta + orderedNavSessions.length) % orderedNavSessions.length;
        const nextSession = orderedNavSessions[nextIdx];
        if (nextSession) choose(nextSession.id);
        return;
      }
      if (e.key === "Escape" && renamingTitle) {
        setRenamingTitle(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [choose, isSpecial, layout, openNewDraft, orderedNavSessions, renamingTitle]);

  const commitSessionRename = async () => {
    const trimmed = renameDraft.trim();
    setRenamingTitle(false);
    if (!session || !trimmed || trimmed === session.title) return;
    await act(() => api(`/sessions/${session.id}`, "PATCH", { title: trimmed }));
  };

  const submit = async (text: string, attachmentIds: string[] = []): Promise<boolean> => {
    if (!session || (!text.trim() && !attachmentIds.length) || !connected) return false;
    const idle = session.runState === "idle";
    // Show the message and the running state at once; the host confirms them shortly.
    const optimisticId = crypto.randomUUID();
    if (idle) {
      setOptimistic({ id: optimisticId, sessionId: session.id, text });
      setCompose("");
      bottom.current = true;
    }
    let accepted = false;
    await act(async () => {
      try {
        const result = await send(
          session.id,
          text,
          idle ? "new" : "queue",
          optimisticId,
          attachmentIds,
        );
        setCommands((c) => [...c.filter((item) => item.id !== result.id), result]);
        setCompose("");
        accepted = true;
      } catch (error) {
        if (idle) setCompose(text);
        throw error;
      } finally {
        if (!accepted) setOptimistic((o) => (o?.id === optimisticId ? null : o));
      }
    });
    return accepted;
  };

  const scrollToLatest = () => {
    setAnchorEventId(undefined);
    if (historyRef.current) {
      automaticHistory.current = false;
      void act(() => loadPage());
      return;
    }
    bottom.current = true;
    setShowScrollToBottom(false);
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "instant" });
  };

  if (pairNeeded || location.hash.startsWith("#pair=")) {
    return (
      <div className="pair-shell">
        <PairScreen
          onDone={() => {
            history.replaceState(null, "", location.pathname + location.search);
            location.reload();
          }}
        />
      </div>
    );
  }

  const isSupervised = Boolean(
    session &&
    snapshot?.supervisions.some(
      (w) => w.targetSessionId === session.id && w.state === "active" && w.mode === "continue",
    ),
  );
  const hasUnknownCommands = commands.some((c) => c.status === "unknown");
  const completedCommands = completedCommandIds(events);
  const pendingMessage =
    optimistic && optimistic.sessionId === session?.id && !hasUnknownCommands ? optimistic : null;
  const hasPendingSend = commands.some(
    (c) =>
      c.kind === "send" &&
      c.origin === "user" &&
      !completedCommands.has(c.id) &&
      (c.status === "accepted" ||
        (c.status === "dispatched" && session?.executionState !== "settled")),
  );
  const isRunning = Boolean(
    session && (session.runState === "running" || pendingMessage || hasPendingSend),
  );
  const hasTranscript =
    Boolean(pendingMessage) ||
    hasPendingSend ||
    events.some(
      (e) =>
        ["message", "text-delta", "tool", "error"].includes(e.type) ||
        (e.type === "turn-ended" && (e.payload as { outcome?: string })?.outcome === "failed") ||
        (e.type === "state" &&
          Boolean(
            (e.payload as { message?: string; error?: string })?.message ||
            (e.payload as { message?: string; error?: string })?.error,
          )),
    );

  const isWindowsElectron =
    navigator.userAgent.includes("Electron") && navigator.userAgent.includes("Windows");

  const hostLabel = remoteClient ? "远程桌面 Host" : "本机桌面";
  const liveStatusText = !session
    ? null
    : session.phase === "draft"
      ? "草稿"
      : isRunning
        ? "运行中"
        : session.runState === "waiting-input"
          ? "等待确认"
          : hasUnknownCommands
            ? "结果待核对"
            : isSupervised
              ? "托管中"
              : session.connectionState !== "connected"
                ? CONNECTION_STATE_LABELS[session.connectionState]
                : null;
  const liveStatusTone = !session
    ? ""
    : session.phase === "draft"
      ? "draft"
      : isRunning
        ? "running"
        : session.runState === "waiting-input"
          ? "waiting-input"
          : isSupervised
            ? "is-supervised"
            : session.connectionState !== "connected"
              ? "offline"
              : session.runState;

  return (
    <div
      className={`app ${selected && !isSpecial ? "has-session" : ""} ${
        inDraft && !selected && !isSpecial ? "has-draft" : ""
      } ${detail ? "has-detail" : ""} ${
        isSpecial ? "has-page" : ""
      } ${isSettings ? "has-settings" : ""} ${layout.resizing ? "is-resizing" : ""}`}
      style={
        {
          "--sidebar-width": `${layout.width}px`,
          "--sidebar-collapsed": "68px",
          "--window-controls-inset": isWindowsElectron
            ? "138px"
            : "max(0px, 100vw - env(titlebar-area-width, 100vw))",
        } as CSSProperties
      }
    >
      <Sidebar
        scope={scope}
        hostName={hostLabel}
        connected={connected}
        dark={dark}
        collapsed={layout.collapsed}
        resizing={layout.resizing}
        settingsMode={isSettings}
        runningCount={
          (snapshot?.sessions ?? []).filter(
            (s) => !s.archived && (s.runState === "running" || s.runState === "waiting-input"),
          ).length
        }
        pendingCount={pending.length}
        projectCount={snapshot?.projects.length ?? 0}
        settingsHeader={
          <SettingsSidebarChrome
            collapsed={layout.collapsed}
            onBack={() => navigate("all")}
            onToggleCollapsed={layout.toggleCollapsed}
          />
        }
        onToggleDark={() => {
          void savePreferences({ ...preferences, theme: dark ? "light" : "dark" }).catch(
            (error: Error) => setError(error.message),
          );
        }}
        onToggleCollapsed={layout.toggleCollapsed}
        onNavigate={navigate}
        onOpenDevices={() => {
          setSettingsSection("devices");
          setMobileSettingsDetail(true);
          setScope("health");
          setInDraft(false);
        }}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onCreateSession={(preset) => openNewDraft(preset)}
      >
        {isSettings ? (
          <SettingsSidebarNav
            active={settingsSection}
            collapsed={layout.collapsed}
            counts={settingsCounts}
            onSelect={selectSettingsSection}
          />
        ) : (
          <SessionRows
            act={act}
            onEditProject={(project) => setEditingProject(project)}
            onOpenProjectOverview={(id) => openWorkbench(id, "work")}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            scope={scope}
            masters={masters}
            list={list}
            projects={snapshot?.projects ?? []}
            selected={selected}
            query={query}
            showArchived={showArchived}
            pendingCount={pending.length}
            searchHits={searchHits}
            supervisions={snapshot?.supervisions ?? []}
            projectNames={projectNames}
            onQueryChange={setQuery}
            onToggleArchived={() => setShowArchived((v) => !v)}
            onSelectSession={choose}
            onOpenWorkbench={() => openWorkbench()}
            onOpenInbox={() => navigate("inbox")}
            onCreateMaster={(text) => openNewDraft({ harnessId: "kodo", projectId: null, text })}
            onCreateProject={() => setProjectForm(true)}
            onCreateInProject={(projectId) => openNewDraft({ harnessId: "kodo", projectId })}
            onCreateWithHarness={(harnessId: HarnessId) => openNewDraft({ harnessId })}
            onDeleteSession={(s) => setPendingDelete({ kind: "session", id: s.id, title: s.title })}
            onDeleteProject={(p) =>
              setPendingDelete({
                kind: "project",
                id: p.id,
                name: p.name,
                sessionCount: (snapshot?.sessions ?? []).filter((s) => s.projectId === p.id).length,
              })
            }
          />
        )}
      </Sidebar>

      <button
        type="button"
        className="sidebar-resizer"
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        role="separator"
        tabIndex={0}
        onPointerDown={layout.beginResize}
        onDoubleClick={layout.resetWidth}
        onKeyDown={layout.onResizerKeyDown}
      />

      <main
        className={`main ${isSpecial ? "wide" : ""} ${
          (isSettings && mobileSettingsDetail) ||
          scope === "inbox" ||
          scope === "workbench" ||
          scope === "work" ||
          scope === "devices"
            ? "is-subpage"
            : ""
        }`}
      >
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="关闭错误提示" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}

        {isSpecial ? (
          <>
            <header
              className={`page-header ${
                (isSettings && mobileSettingsDetail) || scope === "inbox" || scope === "workbench"
                  ? "is-subpage"
                  : "is-root-tab"
              }`}
            >
              {isSettings && mobileSettingsDetail && (
                <button
                  type="button"
                  className="mobile-only settings-mobile-back-btn"
                  aria-label="返回设置列表"
                  onClick={() => setMobileSettingsDetail(false)}
                >
                  <ChevronLeft size={18} />
                  <span>{t("settings.title")}</span>
                </button>
              )}
              {(scope === "inbox" || scope === "workbench") && (
                <button
                  type="button"
                  className="mobile-only settings-mobile-back-btn"
                  aria-label={scope === "workbench" ? "返回设置列表" : "返回对话列表"}
                  onClick={() => navigate(scope === "workbench" ? "health" : "all")}
                >
                  <ChevronLeft size={18} />
                  <span>{scope === "workbench" ? t("settings.title") : "对话"}</span>
                </button>
              )}
              {isSettings ? (
                <div className="page-heading">
                  <div className="breadcrumb desktop-only">
                    <span>{t("settings.title")}</span>
                  </div>
                  <div className="page-heading__title-row">
                    <h1>
                      <span className="desktop-only">
                        {t(SETTINGS_LABEL_KEYS[settingsSection])}
                      </span>
                      <span className="mobile-only">
                        {mobileSettingsDetail
                          ? t(SETTINGS_LABEL_KEYS[settingsSection])
                          : t("settings.title")}
                      </span>
                    </h1>
                    {!mobileSettingsDetail && (
                      <span className="mobile-only-inline page-header__host-chip">
                        <span className={`status-dot ${connected ? "online" : "unknown"}`} />
                        <span>{connected ? t("status.localOnline") : t("status.connecting")}</span>
                      </span>
                    )}
                  </div>
                </div>
              ) : scope === "work" ? (
                <div className="page-heading">
                  <h1>{t("nav.work")}</h1>
                </div>
              ) : (
                <div className="page-heading__title-row">
                  <h1>{scopeName}</h1>
                  {scope !== "inbox" && scope !== "workbench" && (
                    <span className="mobile-only-inline page-header__host-chip">
                      <span className={`status-dot ${connected ? "online" : "unknown"}`} />
                      <span>{connected ? t("status.localOnline") : t("status.connecting")}</span>
                    </span>
                  )}
                </div>
              )}
              <div className="page-header__actions">
                {scope !== "inbox" && (
                  <button
                    type="button"
                    className={`mobile-only icon-button icon-button--tinted page-header__inbox-btn ${pending.length > 0 ? "has-badge" : ""}`}
                    aria-label="待办收件箱"
                    onClick={() => navigate("inbox")}
                  >
                    <Inbox size={16} />
                    {pending.length > 0 && (
                      <span className="home-bar-badge" aria-hidden="true">
                        {pending.length > 99 ? "99+" : pending.length}
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button icon-button--tinted"
                  aria-label="刷新"
                  onClick={() => void act(refresh)}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </header>
            <div className="page-content">
              {scope === "workbench" && snapshot && (
                <WorkbenchHub
                  key={hubContext.nonce}
                  snapshot={snapshot}
                  initialProject={hubContext.project}
                  initialTab={hubContext.tab}
                  onOpenSession={choose}
                  onCompose={(projectId, text) =>
                    openNewDraft({ projectId, harnessId: "kodo", text })
                  }
                  onBack={selected ? () => choose(selected) : () => navigate("all")}
                />
              )}
              {scope === "work" && snapshot && <WorkCenter snapshot={snapshot} />}
              {scope === "health" && snapshot && (
                <>
                  {!mobileSettingsDetail && (
                    <SettingsMobileNav
                      active={settingsSection}
                      counts={settingsCounts}
                      onSelect={selectSettingsSection}
                      onOpenWorkbench={() => navigate("workbench")}
                    />
                  )}
                  <div className={!mobileSettingsDetail ? "settings-detail-mobile-hidden" : ""}>
                    <HealthPage
                      snapshot={snapshot}
                      act={act}
                      section={settingsSection}
                      usage={usage}
                      onSectionChange={selectSettingsSection}
                      providerConfig={providerConfig}
                      onProviderConfigLoaded={setProviderConfig}
                      onOpenSession={(sid) => {
                        setScope("all");
                        setMobileSettingsDetail(false);
                        choose(sid);
                      }}
                    />
                  </div>
                </>
              )}
              {scope === "projects" && snapshot && (
                <MobileProjectsPage
                  snapshot={snapshot}
                  onOpenSession={(sid) => {
                    setScope("all");
                    choose(sid);
                  }}
                  onCreateProject={() => setProjectForm(true)}
                  onEditProject={(p) => setEditingProject(p)}
                  onDeleteProject={(p) =>
                    setPendingDelete({
                      kind: "project",
                      id: p.id,
                      name: p.name,
                      sessionCount: (snapshot.sessions ?? []).filter((s) => s.projectId === p.id)
                        .length,
                    })
                  }
                  onCreateInProject={(projectId) => openNewDraft({ projectId })}
                  onComposeWork={(projectId, text) =>
                    openNewDraft({ projectId, harnessId: "kodo", text })
                  }
                  onOpenProjectWork={(projectId) => openWorkbench(projectId, "work")}
                />
              )}
              {scope === "usage" && snapshot && (
                <UsagePage snapshot={snapshot} usage={usage} act={act} />
              )}
              {scope === "devices" && snapshot && <DevicesPage snapshot={snapshot} act={act} />}
              {scope === "inbox" && (
                <InboxPage
                  snapshot={snapshot}
                  pending={pending}
                  act={act}
                  onOpenSession={(sid) => {
                    setScope("all");
                    choose(sid);
                  }}
                />
              )}
            </div>
          </>
        ) : session ? (
          <>
            <header className="chat-header">
              <button
                type="button"
                className="mobile-only icon-button chat-back-btn"
                aria-label="返回会话列表"
                onClick={() => {
                  setInDraft(false);
                  selectedRef.current = null;
                  setSelected(null);
                }}
              >
                <ChevronLeft size={20} />
              </button>

              <div className="chat-header__badge">
                <HarnessBadge harnessId={session.harnessId} size="sm" tone="mono" />
              </div>

              {/* Unified frosted toolbar breadcrumb + double-click rename + on-demand status */}
              <div
                className="chat-heading chat-heading--crumbs"
                title={
                  session.kind === "supervisor"
                    ? session.projectId
                      ? "项目主对话"
                      : "跨项目主对话"
                    : HARNESS_NAMES[session.harnessId]
                }
              >
                <div className="chat-heading__top">
                  <div className="breadcrumb desktop-only-flex">
                    <button
                      type="button"
                      className="chat-project-crumb"
                      title="打开工作中心"
                      onClick={() => openWorkbench(session.projectId ?? "", "work")}
                    >
                      {project?.name ?? (session.kind === "supervisor" ? "主对话" : "未归属")}
                    </button>
                    <span className="breadcrumb__sep" aria-hidden="true">
                      /
                    </span>
                  </div>
                  {renamingTitle ? (
                    <input
                      className="chat-title-rename"
                      aria-label="重命名对话"
                      autoFocus
                      maxLength={200}
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => void commitSessionRename()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitSessionRename();
                        } else if (e.key === "Escape") {
                          setRenamingTitle(false);
                        }
                      }}
                    />
                  ) : (
                    <h1
                      title="双击重命名对话"
                      onDoubleClick={() => {
                        setRenameDraft(session.title);
                        setRenamingTitle(true);
                      }}
                    >
                      {session.title}
                    </h1>
                  )}
                  {liveStatusText && (
                    <span className={`chat-live-pill desktop-only-inline ${liveStatusTone}`}>
                      <span className={`status-dot ${liveStatusTone}`} aria-hidden="true" />
                      <span>{liveStatusText}</span>
                    </span>
                  )}
                </div>
                <div className="chat-mobile-subtitle mobile-only-flex">
                  <HarnessBadge harnessId={session.harnessId} size="xs" shape="squircle" />
                  <span>{HARNESS_NAMES[session.harnessId]}</span>
                  {liveStatusText && (
                    <span className={`chat-live-pill ${liveStatusTone}`}>
                      <span className={`status-dot ${liveStatusTone}`} aria-hidden="true" />
                      <span>{liveStatusText}</span>
                    </span>
                  )}
                  {mobileSubagents.count > 0 && (
                    <button
                      type="button"
                      className="chat-subagents-pill"
                      onClick={() => setAgentSheetOpen(true)}
                    >
                      <GitBranch size={11} aria-hidden="true" />
                      <span>{mobileSubagents.count} 子代理 ▾</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="chat-actions desktop-only-flex">
                {workspace && (
                  <button
                    type="button"
                    className={`chat-workspace-pill ${
                      detail === "files" || detail === "changes" ? "is-active" : ""
                    }`}
                    title={`${workspace.rootPath} · 点击浏览工作区文件`}
                    onClick={() => setDetail(detail === "files" ? "" : "files")}
                  >
                    <Folder size={13} aria-hidden="true" />
                    <span>
                      {formatWorkspaceLabel(workspace.rootPath) || workspace.rootPath}
                      {workspaceBranch ? ` · ${workspaceBranch}` : ""}
                    </span>
                  </button>
                )}
                <GoalPill
                  goals={goals}
                  onOpen={() => setDetail(detail === "goals" ? "" : "goals")}
                />
                <button
                  type="button"
                  className={detail ? "icon-button active" : "icon-button"}
                  title="检查器 (⌘I)"
                  aria-label="会话检查器"
                  aria-pressed={Boolean(detail)}
                  onClick={() => setDetail((current) => (current ? "" : "manage"))}
                >
                  <PanelRight size={17} />
                </button>
              </div>

              <button
                type="button"
                className={`icon-button mobile-only chat-inspector-btn ${detail ? "active" : ""}`}
                aria-label="会话检查器"
                aria-pressed={Boolean(detail)}
                onClick={() => setDetail((current) => (current ? "" : "manage"))}
              >
                <Info size={19} />
              </button>
            </header>

            <div className="chat-body">
              <ConversationWorkspace
                key={session.id}
                sessionId={session.id}
                harnessId={session.harnessId}
                events={events}
                agentSheetOpen={agentSheetOpen}
                onAgentSheetOpenChange={setAgentSheetOpen}
                onSubagentsSummaryChange={setMobileSubagents}
                onOpenFile={(path) => {
                  setFilePreview({ sessionId: session.id, path, key: Date.now() });
                  setDetail("files");
                }}
                onOpenChanges={() => setDetail("changes")}
              >
                <div className="conversation">
                  {hasTranscript && (
                    <ConversationNav
                      scrollRef={scroll}
                      version={`${session.id}:${events.length}:${pendingMessage?.id ?? ""}`}
                      messageIndex={messageIndex}
                      onLoadMessage={jumpToMessage}
                      loading={loadingHistory}
                    />
                  )}
                  <div
                    className="transcript"
                    ref={scroll}
                    onWheel={(event) => {
                      setAnchorEventId(undefined);
                      if (event.deltaY < 0) {
                        automaticHistory.current = true;
                        if ((scroll.current?.scrollTop ?? Infinity) < 160) loadEarlier();
                      }
                    }}
                    onTouchMove={() => {
                      setAnchorEventId(undefined);
                      automaticHistory.current = true;
                    }}
                    onScroll={() => {
                      const el = scroll.current;
                      if (!el?.clientHeight) return;
                      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                      bottom.current = dist < 80;
                      setShowScrollToBottom(dist > 180 && hasTranscript);
                      if (el.scrollTop < 160 && dist > 80) {
                        automaticHistory.current = true;
                        loadEarlier();
                      }
                    }}
                  >
                    {hasTranscript ? (
                      <div className="transcript-inner">
                        <div className="actions" aria-label="历史分页">
                          {olderCursor !== null && (
                            <button
                              type="button"
                              disabled={loadingHistory}
                              onClick={() => void act(() => loadPage(olderCursor))}
                            >
                              {loadingHistory
                                ? "正在加载更早记录…"
                                : historyError
                                  ? "重试加载更早记录"
                                  : "更早记录"}
                            </button>
                          )}
                          {historyMode && (
                            <span className="status-pill status-pill--muted">历史快照</span>
                          )}
                        </div>
                        {historyError && <p role="alert">{historyError}</p>}
                        <Transcript
                          events={events}
                          conversation={session.conversation}
                          branchBusy={
                            busy ||
                            session.runState !== "idle" ||
                            commands.some((c) =>
                              ["accepted", "dispatched", "unknown"].includes(c.status),
                            )
                          }
                          onSelectBranch={(branchId) =>
                            void act(async () => {
                              await api(`/sessions/${session.id}/message-branches`, "POST", {
                                action: "select",
                                requestId: crypto.randomUUID(),
                                branchId,
                              });
                              await loadPage(undefined, true);
                            })
                          }
                          onEdit={async (eventId, text) => {
                            let accepted = false;
                            await act(async () => {
                              await api(`/sessions/${session.id}/message-branches`, "POST", {
                                action: "edit",
                                requestId: crypto.randomUUID(),
                                eventId,
                                text,
                              });
                              await loadPage(undefined, true);
                              accepted = true;
                            });
                            return accepted;
                          }}
                          onBranch={(eventId) =>
                            void act(async () => {
                              const next = await api<Session>(
                                `/sessions/${session.id}/branch`,
                                "POST",
                                { requestId: crypto.randomUUID(), eventId },
                              );
                              setSelected(next.id);
                            })
                          }
                          onOpenFile={(path) => {
                            setFilePreview({ sessionId: session.id, path, key: Date.now() });
                            setDetail("files");
                          }}
                          harnessId={session.harnessId}
                          anchorEventId={anchorEventId}
                          running={session.runState === "running"}
                        />
                        {pendingMessage && (
                          <article
                            className="turn user-turn is-sending"
                            data-nav-user=""
                            data-nav-label={pendingMessage.text.slice(0, 80)}
                          >
                            <div className="markdown">
                              <p style={{ whiteSpace: "pre-wrap" }}>{pendingMessage.text}</p>
                            </div>
                          </article>
                        )}
                        {isRunning && (
                          <div className="run-indicator run-indicator--mobius">
                            <MobiusLoader size={24} label="正在执行" />
                            <RunStatus
                              retry={pendingMessage ? undefined : session.retry}
                              fallback={
                                hasUnknownCommands
                                  ? "运行状态待核对"
                                  : pendingMessage
                                    ? session.connectionState === "connected"
                                      ? "正在发送…"
                                      : `正在启动 ${HARNESS_NAMES[session.harnessId]}…`
                                    : hasPendingSend && session.runState !== "running"
                                      ? session.runState === "unknown"
                                        ? "运行状态待核对"
                                        : "排队等待执行…"
                                      : "原生执行中"
                              }
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="transcript-inner">
                          <div className="actions" aria-label="历史分页">
                            {olderCursor !== null && (
                              <button
                                type="button"
                                disabled={loadingHistory}
                                onClick={() => void act(() => loadPage(olderCursor))}
                              >
                                {loadingHistory
                                  ? "正在加载更早记录…"
                                  : historyError
                                    ? "重试加载更早记录"
                                    : "更早记录"}
                              </button>
                            )}
                            {historyMode && (
                              <span className="status-pill status-pill--muted">历史快照</span>
                            )}
                          </div>
                          {historyError && <p role="alert">{historyError}</p>}
                        </div>
                        <div className="chat-empty">
                          <CanvasAura harnessId={session.harnessId} intensity={0.85} />
                          <div className="chat-empty__content">
                            <div className="chat-empty__badge">
                              <HarnessBadge harnessId={session.harnessId} size="lg" tone="tinted" />
                            </div>
                            <h2>
                              {session.kind === "supervisor"
                                ? "把目标交给这段主对话"
                                : `与 ${HARNESS_NAMES[session.harnessId]} 直接对话`}
                            </h2>
                            <div className="context-line" title={workspace?.rootPath}>
                              <Folder size={13} />
                              <span>
                                {session.kind === "supervisor"
                                  ? `${session.scope === "project" ? "项目主对话" : "全局主对话 · 跨项目"} · ${workspace?.rootPath ? `默认目录 ${formatWorkspaceLabel(workspace.rootPath) || workspace.rootPath}` : "无默认工作目录"}`
                                  : workspace?.rootPath
                                    ? formatWorkspaceLabel(workspace.rootPath) || workspace.rootPath
                                    : "未绑定工作位置"}
                              </span>
                            </div>
                            {session.kind === "supervisor" && (
                              <div className="kodo-starters" aria-label="主对话起始建议">
                                {(session.scope === "project"
                                  ? [
                                      [
                                        "汇报进展",
                                        "汇报本项目所有会话的进展：哪些在运行、卡住、失败或等待我处理。",
                                      ],
                                      [
                                        "盯住一个会话",
                                        "帮我盯住本项目的一个会话，直到目标真正完成，完成后告诉我。先列出可选会话。",
                                      ],
                                      [
                                        "编排任务",
                                        "在本项目里完成以下任务，你来决定拆分和使用哪些 harness，并在完成前核验：",
                                      ],
                                    ]
                                  : [
                                      [
                                        "汇报所有进展",
                                        "按项目汇报我所有会话的进展：哪些在运行、卡住、失败或等待我处理。",
                                      ],
                                      [
                                        "盯住一个会话",
                                        "帮我盯住一个会话，直到目标真正完成，完成后告诉我。先列出可选会话。",
                                      ],
                                      [
                                        "整理会话",
                                        "帮我整理会话：找出长期空闲或已完成的会话，给出归档建议，确认后再执行。",
                                      ],
                                    ]
                                ).map(([label, prompt]) => (
                                  <button
                                    type="button"
                                    key={label}
                                    className="kodo-starter"
                                    onClick={() => setCompose(prompt!)}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        {session.runState === "running" && (
                          <div className="transcript-inner">
                            <div className="run-indicator run-indicator--mobius">
                              <MobiusLoader size={24} label="正在执行" />
                              <RunStatus retry={session.retry} fallback="原生执行中" />
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <Composer
                    session={session}
                    harnessDesc={snapshot?.harnesses.find((item) => item.id === session.harnessId)}
                    binding={snapshot?.bindings.find((item) => item.id === session.bindingId)}
                    connected={connected}
                    busy={busy}
                    running={isRunning && !hasUnknownCommands}
                    supervised={isSupervised}
                    compose={compose}
                    interactions={
                      snapshot?.inbox.filter(
                        (i) =>
                          i.sessionId === session.id && i.type === "interaction" && !i.resolved,
                      ) ?? []
                    }
                    unknownCommands={commands.filter((c) => c.status === "unknown")}
                    pendingCommands={commands.filter(
                      // A new send can also be held by an unresolved earlier receipt.
                      (c) =>
                        c.kind === "send" &&
                        c.origin === "user" &&
                        c.status === "accepted" &&
                        (c.body.mode !== "new" || hasUnknownCommands),
                    )}
                    onWithdraw={(commandId) =>
                      void act(async () => {
                        const result = await api<Command>(
                          `/sessions/${session.id}/commands/${commandId}`,
                          "DELETE",
                        );
                        setCommands((current) =>
                          current.map((c) => (c.id === result.id ? result : c)),
                        );
                      })
                    }
                    onCommandUpdate={(result) =>
                      setCommands((current) =>
                        current.map((c) => (c.id === result.id ? result : c)),
                      )
                    }
                    showScrollToBottom={historyMode || showScrollToBottom}
                    onScrollToBottom={scrollToLatest}
                    onComposeChange={setCompose}
                    onSubmit={submit}
                    onInspectNative={() =>
                      void act(async () =>
                        setDetail(
                          JSON.stringify(await api(`/sessions/${session.id}/native`), null, 2),
                        ),
                      )
                    }
                    onError={setError}
                    act={act}
                  />
                </div>
              </ConversationWorkspace>

              {detail && snapshot && (
                <>
                  <button
                    type="button"
                    className="detail-pane__backdrop"
                    aria-label="收起详情面板"
                    tabIndex={-1}
                    onClick={() => setDetail("")}
                  />
                  <SessionDetail
                    detail={detail}
                    requestedPath={
                      filePreview?.sessionId === session.id ? filePreview.path : undefined
                    }
                    requestKey={filePreview?.sessionId === session.id ? filePreview.key : 0}
                    onOpenFile={(path) => {
                      setFilePreview({ sessionId: session.id, path, key: Date.now() });
                      setDetail("files");
                    }}
                    session={session}
                    snapshot={snapshot}
                    events={events}
                    commands={commands}
                    usage={sessionUsage}
                    act={act}
                    onSelectDetail={(next) => setDetail(next)}
                    goals={goals}
                    reloadGoals={reloadGoals}
                    onClose={() => setDetail("")}
                    onDeleted={() => {
                      setSelected(null);
                      localStorage.removeItem("kodo.session" + hostPath);
                      setDetail("");
                    }}
                  />
                </>
              )}
            </div>
          </>
        ) : (
          <DraftWorkspace
            snapshot={snapshot}
            preset={draftPreset}
            connected={connected}
            busy={busy}
            act={act}
            onBackToList={() => {
              setInDraft(false);
              selectedRef.current = null;
              setSelected(null);
            }}
            onDraftActivated={() => {
              if (!selectedRef.current) setInDraft(true);
            }}
            onDraftSaved={(s) => choose(s.id)}
            onFirstSendStarted={(s, firstMessage, requestId) => {
              snapshotMutation.current++;
              setSnapshot((current) =>
                current
                  ? {
                      ...current,
                      sessions: current.sessions.some((item) => item.id === s.id)
                        ? current.sessions
                        : [...current.sessions, s],
                    }
                  : current,
              );
              setOptimistic({ id: requestId, sessionId: s.id, text: firstMessage });
              setCompose("");
              bottom.current = true;
              choose(s.id);
            }}
            onFirstSendFailed={async (s, message) => {
              setOptimistic((current) => (current?.sessionId === s.id ? null : current));
              moveAttachments("draft", s.id);
              if (selectedRef.current === s.id) setCompose(message);
              await refresh().catch(() => undefined);
            }}
          />
        )}
      </main>

      {/* Mobile Liquid-Glass 4-Tab Capsule (对话 | 项目 | 用量 | 设置):
          strictly shown on the 4 root tabs only — hidden inside conversation, draft, and all subpages. */}
      {((!selected && !inDraft && !isSpecial) ||
        scope === "projects" ||
        scope === "usage" ||
        (isSettings && !mobileSettingsDetail)) && (
        <MobileLiquidDock
          activeTab={scope === "projects" ? 1 : scope === "usage" ? 2 : isSettings ? 3 : 0}
          onSelectChat={() => {
            selectedRef.current = null;
            setSelected(null);
            setInDraft(false);
            navigate("all");
          }}
          onSelectProjects={() => {
            setScope("projects");
            setInDraft(false);
            setRenamingTitle(false);
            setDetail("");
          }}
          onSelectUsage={() => {
            setScope("usage");
            setInDraft(false);
            setRenamingTitle(false);
            setDetail("");
          }}
          onSelectSettings={() => navigate("health")}
        />
      )}

      {snapshot && (
        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          snapshot={snapshot}
          pendingInbox={pending}
          sidebarCollapsed={layout.collapsed}
          inspectorOpen={Boolean(detail)}
          canToggleInspector={Boolean(session && !isSpecial)}
          onOpenSession={choose}
          onNewDraft={(projectId) => openNewDraft({ projectId })}
          onNewProject={() => setProjectForm(true)}
          onToggleSidebar={layout.toggleCollapsed}
          onToggleInspector={() => setDetail((current) => (current ? "" : "manage"))}
          onOpenWorkbench={() => openWorkbench()}
          onOpenInbox={() => navigate("inbox")}
          onOpenSettings={(sec) => {
            setSettingsSection(sec);
            setMobileSettingsDetail(true);
            setScope("health");
            setInDraft(false);
          }}
          onToggleTheme={() => {
            void savePreferences({ ...preferences, theme: dark ? "light" : "dark" }).catch(
              (err: Error) => setError(err.message),
            );
          }}
        />
      )}

      {pendingDelete && (
        <DeleteDialog
          target={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onConfirm={(deleteSessions) =>
            act(async () => {
              const removed =
                pendingDelete.kind === "session"
                  ? [pendingDelete.id]
                  : (snapshot?.sessions ?? [])
                      .filter((s) => s.projectId === pendingDelete.id)
                      .map((s) => s.id);
              if (pendingDelete.kind === "session")
                await api(`/sessions/${pendingDelete.id}`, "DELETE");
              else
                await api(
                  `/projects/${pendingDelete.id}?sessions=${deleteSessions ? "delete" : "keep"}`,
                  "DELETE",
                );
              if (selectedRef.current && removed.includes(selectedRef.current)) {
                selectedRef.current = null;
                setSelected(null);
                localStorage.removeItem("kodo.session" + hostPath);
                setDetail("");
              }
              setPendingDelete(null);
            })
          }
        />
      )}

      {projectForm && (
        <ProjectModal
          act={act}
          onClose={() => setProjectForm(false)}
          onCreated={(id, workspaceId) => {
            setViewMode("project");
            setProjectForm(false);
            openNewDraft({ projectId: id, workspaceId });
          }}
        />
      )}

      {editingProject && (
        <ProjectEditModal
          key={editingProject.id}
          project={editingProject}
          workspaces={(snapshot?.workspaces ?? []).filter(
            (workspace) => workspace.projectId === editingProject.id,
          )}
          act={act}
          onClose={() => setEditingProject(undefined)}
        />
      )}
      {!snapshot && !pairNeeded && <SplashScreen mode="launch" onRetry={() => void act(refresh)} />}
    </div>
  );
}

function MobileProjectsPage({
  snapshot,
  onOpenSession,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  onCreateInProject,
  onComposeWork,
  onOpenProjectWork,
}: {
  snapshot: Snapshot;
  onOpenSession: (sessionId: string) => void;
  onCreateProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onCreateInProject: (projectId: string) => void;
  onComposeWork: (projectId: string | null, text: string) => void;
  onOpenProjectWork: (projectId: string) => void;
}) {
  const [section, setSection] = useState<"projects" | "work">("projects");
  const projects = snapshot.projects ?? [];
  const workspaces = snapshot.workspaces ?? [];
  const sessions = snapshot.sessions ?? [];

  return (
    <div className="mobile-projects-hub">
      <SegmentedControl<"projects" | "work">
        className="mobile-projects-segment"
        ariaLabel="项目视图切换"
        value={section}
        options={[
          { value: "projects", label: "项目与目录" },
          { value: "work", label: "工作与计划" },
        ]}
        onChange={setSection}
      />

      {section === "work" ? (
        <WorkbenchHub
          snapshot={snapshot}
          initialTab="work"
          onOpenSession={onOpenSession}
          onCompose={onComposeWork}
        />
      ) : (
        <>
          <div className="mobile-projects-hub__top">
            <span className="mobile-projects-hub__summary">
              {projects.length} 个项目 · {workspaces.length} 个工作目录
            </span>
            <button type="button" className="home-compose-cta" onClick={onCreateProject}>
              <Plus size={14} strokeWidth={2.3} />
              <span>新建项目</span>
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="list-empty list-empty--compact">
              <span className="list-empty__icon" aria-hidden="true">
                <FolderOpen size={20} />
              </span>
              <strong>暂无项目</strong>
              <p className="list-empty__hint">
                创建项目并绑定本地代码仓库目录后，可在此统一管理工作区对话、目标与交付成果
              </p>
            </div>
          ) : (
            <div className="mobile-projects-list">
              {projects.map((p) => {
                const projWorkspaces = workspaces.filter((w) => w.projectId === p.id);
                const projSessions = sessions
                  .filter((s) => s.projectId === p.id && !s.archived)
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                const running = projSessions.filter(
                  (s) => s.runState === "running" || s.runState === "waiting-input",
                ).length;

                return (
                  <section key={p.id} className="mobile-project-card">
                    <div className="mobile-project-card__head">
                      <span className="mobile-project-card__icon" aria-hidden="true">
                        <Folder size={18} />
                      </span>
                      <div className="mobile-project-card__titles">
                        <strong>{p.name}</strong>
                        <span>
                          {projSessions.length} 个对话
                          {running > 0 ? ` · ${running} 活跃` : ""}
                        </span>
                      </div>
                      <div className="mobile-project-card__head-actions">
                        <button
                          type="button"
                          className="mobile-project-card__ghost"
                          onClick={() => onEditProject(p)}
                        >
                          管理
                        </button>
                        <button
                          type="button"
                          className="mobile-project-card__ghost is-danger"
                          onClick={() => onDeleteProject(p)}
                        >
                          删除
                        </button>
                      </div>
                    </div>

                    {projWorkspaces.length > 0 && (
                      <div className="mobile-project-card__paths">
                        {projWorkspaces.map((ws) => (
                          <div key={ws.id} className="mobile-project-path">
                            <FolderOpen size={13} aria-hidden="true" />
                            <code>{ws.rootPath}</code>
                          </div>
                        ))}
                      </div>
                    )}

                    {projSessions.length > 0 && (
                      <div className="mobile-project-card__sessions">
                        {projSessions.slice(0, 2).map((s) => (
                          <button
                            type="button"
                            key={s.id}
                            className="mobile-project-session-row"
                            onClick={() => onOpenSession(s.id)}
                          >
                            <HarnessBadge harnessId={s.harnessId} size="xs" />
                            <span className="mobile-project-session-row__title">{s.title}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mobile-project-card__actions">
                      <button
                        type="button"
                        className="mobile-project-action-btn"
                        onClick={() => onCreateInProject(p.id)}
                      >
                        <MessageSquare size={13} />
                        <span>新建对话</span>
                      </button>
                      <button
                        type="button"
                        className="mobile-project-action-btn"
                        onClick={() => onOpenProjectWork(p.id)}
                      >
                        <Layers size={13} />
                        <span>目标与成果</span>
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MobileLiquidDock({
  activeTab,
  onSelectChat,
  onSelectProjects,
  onSelectUsage,
  onSelectSettings,
}: {
  activeTab: 0 | 1 | 2 | 3;
  onSelectChat: () => void;
  onSelectProjects: () => void;
  onSelectUsage: () => void;
  onSelectSettings: () => void;
}) {
  const [gliding, setGliding] = useState(false);
  const prevTab = useRef(activeTab);

  useEffect(() => {
    if (prevTab.current !== activeTab) {
      prevTab.current = activeTab;
      setGliding(true);
      const timer = window.setTimeout(() => setGliding(false), 300);
      return () => window.clearTimeout(timer);
    }
  }, [activeTab]);

  const t = useT();
  return (
    <nav
      className="mobile-tabbar mobile-only"
      aria-label="移动端标签导航"
      data-gliding={gliding ? "true" : undefined}
      style={{ "--active-tab": activeTab } as CSSProperties}
    >
      <span className="mobile-tabbar__thumb" aria-hidden="true">
        <span className="mobile-tabbar__thumb-inner" />
      </span>
      <button type="button" className={activeTab === 0 ? "is-active" : ""} onClick={onSelectChat}>
        <span className="mobile-tabbar__icon">
          <MessageSquare size={18} strokeWidth={activeTab === 0 ? 2.2 : 1.8} />
        </span>
        <span className="mobile-tabbar__label">{t("dock.chats")}</span>
      </button>
      <button
        type="button"
        className={activeTab === 1 ? "is-active" : ""}
        onClick={onSelectProjects}
      >
        <span className="mobile-tabbar__icon">
          <FolderOpen size={18} strokeWidth={activeTab === 1 ? 2.2 : 1.8} />
        </span>
        <span className="mobile-tabbar__label">{t("dock.projects")}</span>
      </button>
      <button type="button" className={activeTab === 2 ? "is-active" : ""} onClick={onSelectUsage}>
        <span className="mobile-tabbar__icon">
          <BarChart3 size={18} strokeWidth={activeTab === 2 ? 2.2 : 1.8} />
        </span>
        <span className="mobile-tabbar__label">{t("dock.usage")}</span>
      </button>
      <button
        type="button"
        className={activeTab === 3 ? "is-active" : ""}
        onClick={onSelectSettings}
      >
        <span className="mobile-tabbar__icon">
          <Settings2 size={18} strokeWidth={activeTab === 3 ? 2.2 : 1.8} />
        </span>
        <span className="mobile-tabbar__label">{t("dock.settings")}</span>
      </button>
    </nav>
  );
}

if (
  typeof document !== "undefined" &&
  navigator.userAgent.includes("Electron") &&
  navigator.userAgent.includes("Mac")
) {
  document.documentElement.dataset.platform = "darwin";
}

createRoot(document.getElementById("root")!).render(
  <AppPreferencesProvider>
    <FirstRun>
      <App />
    </FirstRun>
  </AppPreferencesProvider>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
