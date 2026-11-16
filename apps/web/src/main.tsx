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
  ChevronLeft,
  ChevronRight,
  Clock,
  Folder,
  Inbox,
  Layers,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import type {
  Command,
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
import { HostError, api, apiPath, hostPath, send } from "./lib/host-client";
import { CONNECTION_STATE_LABELS, HARNESS_NAMES, RUN_STATE_LABELS } from "./lib/harnesses";
import { useSidebarLayout } from "./lib/useSidebarLayout";
import { Composer } from "./components/Composer";
import { CanvasAura } from "./components/CanvasAura";
import { DraftWorkspace, type DraftPreset } from "./components/DraftWorkspace";
import { HarnessBadge } from "./components/KodoBrand";
import { DeleteDialog, ProjectModal, ProjectEditModal } from "./components/Modals";
import { SessionDetail } from "./components/SessionDetail";
import { GoalPill, useGoals } from "./components/GoalPanel";
import { moveAttachments } from "./components/Attachments";
import { SessionRows, type SidebarViewMode } from "./components/SessionRows";
import {
  SETTINGS_LABEL_KEYS,
  SettingsMobileNav,
  SettingsSidebarChrome,
  SettingsSidebarNav,
  type SettingsCounts,
  type SettingsSectionId,
} from "./components/SettingsNavigation";
import { Sidebar } from "./components/Sidebar";
import { MobiusLoader } from "./components/MobiusLoader";
import { SplashScreen } from "./components/SplashScreen";
import { useT } from "./lib/i18n";
import { Modal } from "./components/Motion";
import { Transcript } from "./components/TranscriptView";
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
  const { settings: preferences, save: savePreferences } = useAppPreferences();
  const t = useT();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [scope, setScope] = useState("all");
  const [selected, setSelected] = useState<string | null>(
    localStorage.getItem("kodo.session" + hostPath),
  );
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [optimistic, setOptimistic] = useState<{
    id: string;
    sessionId: string;
    text: string;
  } | null>(null);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [historyMode, setHistoryMode] = useState(false);
  const historyRef = useRef(false);
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
  const [viewMode, setViewMode] = useState<SidebarViewMode>(() =>
    localStorage.getItem("kodo.viewMode") === "harness" ? "harness" : "project",
  );
  const [showArchived, setShowArchived] = useState(false);
  const draftStorageKey = (id: string) => `kooyu.draft:${hostPath}:${id}`;
  const [compose, setCompose] = useState(() =>
    selected ? (localStorage.getItem(draftStorageKey(selected)) ?? "") : "",
  );
  const composeValue = useRef(compose);
  composeValue.current = compose;
  const readingPositions = useRef(new Map<string, { top: number; bottom: boolean }>());
  const restorePosition = useRef<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<{
    sessionId: string;
    eventId: string;
    text: string;
  }>();
  const [inDraft, setInDraft] = useState(false);
  const [draftPreset, setDraftPreset] = useState<DraftPreset>({ harnessId: "kodo", nonce: 0 });
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
    tab: "work" as "work" | "artifacts" | "project",
    nonce: 0,
  });
  const [filePreview, setFilePreview] = useState<{
    sessionId: string;
    path: string;
    key: number;
  }>();
  const [mobileNav, setMobileNav] = useState(false);
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
      setMobileNav(false);
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
            void api<{ events: RuntimeEvent[]; commands: Command[]; olderCursor: number | null }>(
              "/sessions/" + selectedId + "?tail=300",
            )
              .then((page) => {
                if (
                  cancelled ||
                  current !== generation ||
                  selectedRef.current !== selectedId ||
                  historyRef.current
                )
                  return;
                setCommands(page.commands);
                setOlderCursor(page.olderCursor);
                setEvents((events) =>
                  [
                    ...new Map(
                      [...page.events, ...events.filter((event) => event.sequence > cursor)].map(
                        (event) => [event.sequence, event],
                      ),
                    ).values(),
                  ]
                    .sort((a, b) => a.sequence - b.sequence)
                    .slice(-300),
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
              e.type === "turn-ended" || e.type === "settled" || e.type === "error"
                ? "idle"
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
                        s.id === e.sessionId && s.runState !== runState ? { ...s, runState } : s,
                      ),
                    }
                  : current,
              );
            if (e.sessionId === selectedRef.current && !historyRef.current) {
              setEvents((current) => {
                if (current.some((x) => x.sequence === e.sequence)) return current;
                const merged = [...current, e].sort((a, b) => a.sequence - b.sequence);
                if (merged.length > 300) setOlderCursor(merged[merged.length - 300]!.sequence);
                return merged.slice(-300);
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

  const loadPage = async (before?: number) => {
    const id = selectedRef.current;
    if (!id) return;
    const request = ++pageRequest.current;
    const priorHistory = historyRef.current;
    setAnchorEventId(undefined);
    historyRef.current = before !== undefined;
    setLoadingHistory(true);
    try {
      const r = await api<{
        events: RuntimeEvent[];
        commands: Command[];
        olderCursor: number | null;
      }>(`/sessions/${id}?${before === undefined ? "tail=300" : `before=${before}`}`);
      if (selectedRef.current !== id || request !== pageRequest.current) return;
      if (before === undefined) {
        historyScroll.current = null;
        bottom.current = true;
        setShowScrollToBottom(false);
        setEvents((current) =>
          [
            ...new Map(
              [
                ...r.events,
                ...current.filter((e) => e.sequence > (r.events.at(-1)?.sequence ?? 0)),
              ].map((e) => [e.sequence, e]),
            ).values(),
          ]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-300),
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
      setOlderCursor(r.olderCursor);
      setHistoryMode(before !== undefined);
    } catch (error) {
      if (request === pageRequest.current) historyRef.current = priorHistory;
      throw error;
    } finally {
      if (request === pageRequest.current) setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (!selected) return;
    const request = ++pageRequest.current;
    const eventId = searchFocus?.sessionId === selected ? searchFocus.eventId : undefined;
    localStorage.setItem("kodo.session" + hostPath, selected);
    setEvents([]);
    historyScroll.current = null;
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
    }>(`/sessions/${selected}?${eventId ? `event=${encodeURIComponent(eventId)}` : "tail=300"}`)
      .then((r) => {
        if (cancelled || request !== pageRequest.current) return;
        setCommands(r.commands);
        setOlderCursor(r.olderCursor);
        if (eventId) {
          setEvents(r.events);
          setAnchorEventId(eventId);
          if (r.nativeHistory !== undefined)
            setDetail(
              JSON.stringify({ source: "原生历史快照", history: r.nativeHistory }, null, 2),
            );
          return;
        }
        setEvents((current) =>
          [...new Map([...r.events, ...current].map((e) => [e.sequence, e])).values()]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-300),
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

  useLayoutEffect(() => {
    const prior = historyScroll.current;
    if (prior && scroll.current) {
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
    if (anchorEventId)
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
    if (bottom.current && !historyRef.current && !anchorEventId) {
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
    setOptimistic((current) =>
      current &&
      events.some(
        (event) =>
          event.sessionId === current.sessionId &&
          event.type === "message" &&
          (event.payload as { commandId?: string })?.commandId === current.id,
      )
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
  const isSpecial = ["health", "usage", "devices", "inbox", "work", "workbench"].includes(scope);
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

  const list = (snapshot?.sessions ?? []).filter(
    (s) =>
      !(s.kind === "supervisor" && !s.projectId) &&
      (scope !== "masters" || s.kind === "supervisor") &&
      matchesSessionFilter(s),
  );

  const openWorkbench = (project = "", tab: "work" | "artifacts" | "project" = "work") => {
    if (selected && !isSpecial) {
      localStorage.setItem(draftStorageKey(selected), composeValue.current);
      if (scroll.current)
        readingPositions.current.set(selected, {
          top: scroll.current.scrollTop,
          bottom: bottom.current,
        });
    }
    setHubContext((old) => ({ project, tab, nonce: old.nonce + 1 }));
    setScope("workbench");
    setDetail("");
    setMobileNav(false);
    setInDraft(false);
  };
  const scopeName =
    scope === "workbench"
      ? "项目与工作"
      : scope === "all"
        ? "全部会话"
        : scope === "masters"
          ? "主对话"
          : scope === "inbox"
            ? "待处理"
            : scope === "health"
              ? "Harness 与配置"
              : scope === "usage"
                ? "用量与预算"
                : scope === "devices"
                  ? "手机访问"
                  : (snapshot?.projects.find((p) => p.id === scope)?.name ?? "会话");

  const navigate = (next: string) => {
    if (next === "workbench") {
      openWorkbench(snapshot?.projects.some((p) => p.id === scope) ? scope : "");
      return;
    }
    if (next === "usage" || next === "devices" || next === "work") {
      setSettingsSection(next);
      next = "health";
    } else if (next === "health" && scope !== "health") {
      setSettingsSection("general");
    }
    setScope(next);
    setInDraft(false);
    setMobileNav(false);
    if (!isSpecial && ["health", "usage", "devices", "inbox", "work"].includes(next)) {
      setDetail("");
    }
  };

  const selectSettingsSection = (next: SettingsSectionId) => {
    setSettingsSection(next);
    setMobileNav(false);
  };

  const choose = (id: string, eventId?: string) => {
    if (selected) {
      localStorage.setItem(draftStorageKey(selected), composeValue.current);
      if (scroll.current)
        readingPositions.current.set(selected, {
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
    selectedRef.current = id;
    setSelected(id);
    setMobileNav(false);
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

  const scrollToBottomSmooth = () => {
    if (historyRef.current) {
      void act(() => loadPage());
      return;
    }
    bottom.current = true;
    setShowScrollToBottom(false);
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
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
  const pendingMessage = optimistic && optimistic.sessionId === session?.id ? optimistic : null;
  const hasPendingSend = commands.some(
    (c) =>
      c.kind === "send" &&
      c.origin === "user" &&
      (c.status === "accepted" || c.status === "dispatched"),
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

  return (
    <div
      className={`app ${selected && !isSpecial ? "has-session" : ""} ${
        inDraft && !selected && !isSpecial ? "has-draft" : ""
      } ${mobileNav ? "nav-open" : ""} ${detail ? "has-detail" : ""} ${
        isSpecial ? "has-page" : ""
      } ${isSettings ? "has-settings" : ""} ${layout.resizing ? "is-resizing" : ""}`}
      style={
        {
          "--sidebar-width": `${layout.width}px`,
          "--sidebar-collapsed": "76px",
        } as CSSProperties
      }
    >
      {mobileNav && (
        <button
          type="button"
          className="mobile-scrim"
          aria-label="关闭导航抽屉"
          onClick={() => setMobileNav(false)}
        />
      )}

      <Sidebar
        scope={scope}
        scopeName={scopeName}
        pending={pending}
        connected={connected}
        dark={dark}
        collapsed={layout.collapsed}
        resizing={layout.resizing}
        settingsMode={isSettings}
        settingsHeader={
          <SettingsSidebarChrome
            collapsed={layout.collapsed}
            onBack={() => navigate("all")}
            onToggleCollapsed={layout.toggleCollapsed}
            onCloseNav={() => setMobileNav(false)}
          />
        }
        navOpen={mobileNav}
        onToggleDark={() => {
          void savePreferences({ ...preferences, theme: dark ? "light" : "dark" }).catch(
            (error: Error) => setError(error.message),
          );
        }}
        onToggleCollapsed={layout.toggleCollapsed}
        onNavigate={navigate}
        onOpenNav={() => setMobileNav(true)}
        onCloseNav={() => setMobileNav(false)}
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
            onOpenProjectOverview={(id) => openWorkbench(id, "project")}
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
            onOpenInbox={() => navigate("inbox")}
            onCreateMaster={() => openNewDraft({ harnessId: "kodo", projectId: null })}
            onCreateProject={() => {
              setProjectForm(true);
              setMobileNav(false);
            }}
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

      <main className={`main ${isSpecial ? "wide" : ""}`}>
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
            <header className="page-header">
              <button
                type="button"
                className="mobile-only icon-button"
                aria-label="打开导航"
                onClick={() => setMobileNav(true)}
              >
                <PanelLeft size={19} />
              </button>
              {isSettings ? (
                <div className="page-heading">
                  <div className="breadcrumb">
                    <span>{t("settings.title")}</span>
                  </div>
                  <h1>{t(SETTINGS_LABEL_KEYS[settingsSection])}</h1>
                </div>
              ) : scope === "work" ? (
                <div className="page-heading">
                  <h1>{t("nav.work")}</h1>
                </div>
              ) : (
                <h1>{scopeName}</h1>
              )}
              <button
                type="button"
                className="icon-button icon-button--tinted"
                aria-label="刷新"
                onClick={() => void act(refresh)}
              >
                <RefreshCw size={16} />
              </button>
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
                  <SettingsMobileNav
                    active={settingsSection}
                    counts={settingsCounts}
                    onSelect={selectSettingsSection}
                  />
                  <HealthPage
                    snapshot={snapshot}
                    act={act}
                    section={settingsSection}
                    usage={usage}
                    onSectionChange={selectSettingsSection}
                    providerConfig={providerConfig}
                    onProviderConfigLoaded={setProviderConfig}
                  />
                </>
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

              <div className="chat-heading">
                <div className="breadcrumb">
                  <span>
                    {project?.name ?? (session.kind === "supervisor" ? "主对话" : "未归属")}
                  </span>
                  <ChevronRight size={11} aria-hidden="true" />
                  <span>
                    {session.kind === "supervisor"
                      ? session.projectId
                        ? "项目主对话"
                        : "跨项目主对话"
                      : HARNESS_NAMES[session.harnessId]}
                  </span>
                </div>
                <h1>{session.title}</h1>
              </div>

              <div className="chat-actions">
                <button
                  type="button"
                  className="icon-button"
                  title="项目工作与成果"
                  aria-label="项目工作与成果"
                  onClick={() => openWorkbench(session.projectId ?? "", "artifacts")}
                >
                  <Layers size={18} />
                </button>
                <button
                  type="button"
                  className={
                    detail === "files" || detail === "changes"
                      ? "icon-button active"
                      : "icon-button"
                  }
                  title="文件与改动"
                  aria-label="文件与改动"
                  onClick={() => setDetail(detail === "files" ? "" : "files")}
                >
                  <Folder size={18} />
                </button>
                <button
                  type="button"
                  className={detail === "timeline" ? "icon-button active" : "icon-button"}
                  title="运行时间线"
                  aria-label="运行时间线"
                  onClick={() => setDetail(detail === "timeline" ? "" : "timeline")}
                >
                  <Clock size={18} />
                </button>
                <button
                  type="button"
                  className={detail === "manage" ? "icon-button active" : "icon-button"}
                  title="会话详情与管理"
                  aria-label="会话详情与管理"
                  onClick={() => setDetail(detail === "manage" ? "" : "manage")}
                >
                  <MoreHorizontal size={19} />
                </button>
              </div>
            </header>

            <div className="runtime-bar">
              <span className="runtime-pill runtime-state">
                <span className={`status-dot ${session.runState}`} />
                {session.phase === "draft" ? "尚未启动" : RUN_STATE_LABELS[session.runState]}
              </span>
              <span className="runtime-pill">
                {CONNECTION_STATE_LABELS[session.connectionState]}
              </span>
              <span className={`runtime-pill ${isSupervised ? "is-supervised" : ""}`}>
                {isSupervised ? "自动继续已启用" : "自动继续未启用"}
              </span>
              <GoalPill goals={goals} onOpen={() => setDetail("goals")} />
              {workspace && (
                <span className="runtime-pill runtime-pill--path" title={workspace.rootPath}>
                  <Folder size={12} />
                  <span>{workspace.rootPath}</span>
                </span>
              )}
            </div>

            <div className="chat-body">
              <div className="conversation">
                {hasTranscript && (
                  <ConversationNav
                    scrollRef={scroll}
                    version={`${session.id}:${events.length}:${pendingMessage?.id ?? ""}`}
                  />
                )}
                <div
                  className="transcript"
                  ref={scroll}
                  onScroll={() => {
                    const el = scroll.current;
                    if (!el) return;
                    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                    bottom.current = dist < 80;
                    setShowScrollToBottom(dist > 180 && hasTranscript);
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
                            更早记录
                          </button>
                        )}
                        {historyMode && (
                          <button
                            type="button"
                            disabled={loadingHistory}
                            onClick={() => void act(() => loadPage())}
                          >
                            返回最新记录
                          </button>
                        )}
                        {historyMode && (
                          <span className="status-pill status-pill--muted">历史快照</span>
                        )}
                      </div>
                      <Transcript
                        events={events}
                        onEdit={(eventId, text) =>
                          setEditingMessage({ sessionId: session.id, eventId, text })
                        }
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
                          <span>
                            {pendingMessage
                              ? session.connectionState === "connected"
                                ? "正在发送…"
                                : `正在启动 ${HARNESS_NAMES[session.harnessId]}…`
                              : hasPendingSend && session.runState !== "running"
                                ? "等待响应…"
                                : "原生执行中"}
                          </span>
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
                              更早记录
                            </button>
                          )}
                          {historyMode && (
                            <button
                              type="button"
                              disabled={loadingHistory}
                              onClick={() => void act(() => loadPage())}
                            >
                              返回最新记录
                            </button>
                          )}
                          {historyMode && (
                            <span className="status-pill status-pill--muted">历史快照</span>
                          )}
                        </div>
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
                          <div className="context-line">
                            <Folder size={13} />
                            <span>
                              {session.kind === "supervisor"
                                ? `${session.scope === "project" ? "项目主对话" : "全局主对话 · 跨项目"} · ${workspace?.rootPath ? `默认工作目录 ${workspace.rootPath}` : "无默认工作目录"}`
                                : (workspace?.rootPath ?? "未绑定工作位置")}
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
                            <span>原生执行中</span>
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
                  compose={compose}
                  interactions={
                    snapshot?.inbox.filter(
                      (i) => i.sessionId === session.id && i.type === "interaction" && !i.resolved,
                    ) ?? []
                  }
                  unknownCommands={commands.filter((c) => c.status === "unknown")}
                  pendingCommands={commands.filter(
                    // An idle send ("new") is being delivered, not waiting in a queue.
                    (c) =>
                      c.kind === "send" &&
                      c.origin === "user" &&
                      c.status === "accepted" &&
                      c.body.mode !== "new",
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
                    setCommands((current) => current.map((c) => (c.id === result.id ? result : c)))
                  }
                  showScrollToBottom={showScrollToBottom}
                  onScrollToBottom={scrollToBottomSmooth}
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

      {/* Mobile iOS Tab Bar on List / Special Utility views */}
      {((!selected && !inDraft) || isSpecial) && (
        <nav className="mobile-tabbar mobile-only" aria-label="移动端标签导航">
          <button
            type="button"
            className={scope === "masters" ? "is-active" : ""}
            onClick={() => navigate("masters")}
          >
            <MessageSquare size={19} />
            <span>主控</span>
          </button>
          <button
            type="button"
            className={scope === "inbox" ? "is-active" : ""}
            onClick={() => navigate("inbox")}
          >
            <span className="mobile-tabbar__icon-wrap">
              <Inbox size={19} />
              {pending.length > 0 && <span className="mobile-tabbar__dot" aria-hidden="true" />}
            </span>
            <span>收件箱</span>
          </button>
          <button
            type="button"
            className={scope === "all" ? "is-active" : ""}
            onClick={() => navigate("all")}
          >
            <Layers size={19} />
            <span>会话</span>
          </button>
          <button
            type="button"
            className={scope === "health" ? "is-active" : ""}
            onClick={() => navigate("health")}
          >
            <Settings2 size={19} />
            <span>配置</span>
          </button>
        </nav>
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

      {editingMessage && (
        <Modal title="编辑消息" onClose={() => setEditingMessage(undefined)}>
          <form
            className="ios-form"
            onSubmit={(e) => {
              e.preventDefault();
              const edited = editingMessage;
              void act(async () => {
                const next = await api<Session>(`/sessions/${edited.sessionId}/branch`, "POST", {
                  requestId: crypto.randomUUID(),
                  eventId: edited.eventId,
                  edit: true,
                });
                setSelected(next.id);
                setCompose(edited.text);
                setEditingMessage(undefined);
              });
            }}
          >
            <p>修改后在新聊天中继续，带入此消息之前的对话文本。</p>
            <textarea
              aria-label="消息内容"
              value={editingMessage.text}
              rows={6}
              maxLength={200000}
              onChange={(e) => setEditingMessage({ ...editingMessage, text: e.target.value })}
            />
            <button type="submit" disabled={busy || !editingMessage.text.trim()}>
              保存到新聊天草稿
            </button>
          </form>
        </Modal>
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
