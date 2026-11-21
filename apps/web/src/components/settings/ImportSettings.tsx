import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  FolderOpen,
  Import,
  RefreshCw,
  Search,
  AlertTriangle,
} from "lucide-react";
import type {
  HarnessId,
  NativeImportCandidate,
  NativeImportDiscovery,
  NativeImportResult,
  Snapshot,
} from "@kodo/protocol";
import { HARNESS_IDS } from "@kodo/protocol/client";
import { api } from "../../lib/host-client";
import { HARNESS_NAMES, formatDate, shortModelLabel } from "../../lib/harnesses";
import { useT } from "../../lib/i18n";
import { HarnessBadge } from "../KooyuBrand";
import { SettingsPage, SettingsSection } from "./SettingsKit";

type Action = (work: () => Promise<unknown>) => Promise<void>;

const candidateKey = (c: Pick<NativeImportCandidate, "harnessId" | "nativeSessionId">) =>
  `${c.harnessId}:${c.nativeSessionId}`;

function shortFolder(path: string | null): string {
  if (!path) return "";
  const parts = path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

export function ImportSettings({
  snapshot,
  act,
  onOpenSession,
}: {
  snapshot: Snapshot;
  act: Action;
  onOpenSession?: (sessionId: string) => void;
}) {
  const t = useT();
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [harnessFilter, setHarnessFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [hideImported, setHideImported] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState<string>("");

  const [discovery, setDiscovery] = useState<NativeImportDiscovery | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [lastResult, setLastResult] = useState<NativeImportResult | null>(null);
  const scanGeneration = useRef(0);

  const resetScan = () => {
    scanGeneration.current++;
    setDiscovery(null);
    setSelected(new Set());
    setLastResult(null);
    setError("");
    setScanning(false);
  };

  const scan = useCallback(
    async (projId = projectFilter, hId = harnessFilter) => {
      if (!projId || !snapshot.projects.some((p) => p.id === projId)) return;
      const generation = ++scanGeneration.current;
      setScanning(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (projId) params.set("projectId", projId);
        if (hId) params.set("harnessId", hId);
        const qs = params.toString();
        const data = await api<NativeImportDiscovery>(`/native-imports${qs ? `?${qs}` : ""}`);
        if (generation !== scanGeneration.current) return;
        setDiscovery(data);
        setSelected((prev) => {
          const valid = new Set(
            data.candidates.filter((c) => !c.alreadyImported).map(candidateKey),
          );
          const next = new Set<string>();
          for (const k of prev) if (valid.has(k)) next.add(k);
          return next;
        });
      } catch (err) {
        if (generation === scanGeneration.current)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (generation === scanGeneration.current) setScanning(false);
      }
    },
    [projectFilter, harnessFilter, snapshot.projects],
  );

  useEffect(() => {
    return () => {
      scanGeneration.current++;
    };
  }, []);

  const projectNames = useMemo(
    () => new Map(snapshot.projects.map((p) => [p.id, p.name])),
    [snapshot.projects],
  );

  const visibleCandidates = useMemo(() => {
    const items = discovery?.candidates ?? [];
    const q = query.trim().toLowerCase();
    return items.filter((c) => {
      if (hideImported && c.alreadyImported) return false;
      if (!q) return true;
      const projName = (c.projectId ? projectNames.get(c.projectId) : "") ?? "";
      return (
        c.title.toLowerCase().includes(q) ||
        (c.cwd?.toLowerCase().includes(q) ?? false) ||
        (c.model?.toLowerCase().includes(q) ?? false) ||
        projName.toLowerCase().includes(q) ||
        (HARNESS_NAMES[c.harnessId] ?? c.harnessId).toLowerCase().includes(q)
      );
    });
  }, [discovery, hideImported, query, projectNames]);

  const importableVisible = useMemo(
    () => visibleCandidates.filter((c) => !c.alreadyImported),
    [visibleCandidates],
  );

  const groupedByProject = useMemo(() => {
    const map = new Map<
      string,
      { id: string | null; label: string; items: NativeImportCandidate[] }
    >();
    for (const c of visibleCandidates) {
      const key = c.projectId ?? "__unassigned__";
      const label = c.projectId
        ? (projectNames.get(c.projectId) ?? t("import.unassignedProject"))
        : t("import.unassignedProject");
      const group = map.get(key) ?? { id: c.projectId, label, items: [] };
      group.items.push(c);
      map.set(key, group);
    }
    return [...map.values()];
  }, [visibleCandidates, projectNames, t]);

  const toggleOne = (c: NativeImportCandidate) => {
    if (c.alreadyImported) return;
    const key = candidateKey(c);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of importableVisible) next.add(candidateKey(c));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const toggleProjectGroup = (items: NativeImportCandidate[]) => {
    const pickable = items.filter((c) => !c.alreadyImported);
    if (!pickable.length) return;
    const allChecked = pickable.every((c) => selected.has(candidateKey(c)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of pickable) {
        if (allChecked) next.delete(candidateKey(c));
        else next.add(candidateKey(c));
      }
      return next;
    });
  };

  const runImport = async () => {
    const all = discovery?.candidates ?? [];
    const chosen = all.filter((c) => !c.alreadyImported && selected.has(candidateKey(c)));
    if (!projectFilter || !chosen.length || importing) return;
    setImporting(true);
    setError("");
    setLastResult(null);
    try {
      let result: NativeImportResult | null = null;
      await act(async () => {
        result = await api<NativeImportResult>("/native-imports", "POST", {
          ...(targetProjectId || projectFilter
            ? { projectId: targetProjectId || projectFilter }
            : {}),
          items: chosen.map((c) => ({
            harnessId: c.harnessId,
            nativeSessionId: c.nativeSessionId,
            title: c.title,
            cwd: c.cwd,
            projectId: targetProjectId || c.projectId || projectFilter || null,
            workspaceId: targetProjectId && targetProjectId !== c.projectId ? null : c.workspaceId,
            model: c.model,
            createdAt: c.createdAt,
          })),
        });
      });
      if (result) {
        setLastResult(result);
        setSelected(new Set());
        const importedKeys = new Set(chosen.map(candidateKey));
        setDiscovery(
          (current) =>
            current && {
              ...current,
              candidates: current.candidates.map((c) => {
                const imported = result!.imported.find(
                  (s) => s.harnessId === c.harnessId && s.nativeSessionId === c.nativeSessionId,
                );
                return importedKeys.has(candidateKey(c)) && imported
                  ? { ...c, alreadyImported: true, existingSessionId: imported.id }
                  : c;
              }),
            },
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = selected.size;

  return (
    <SettingsPage
      title={t("import.title")}
      description={t("import.desc")}
      actions={
        <button
          type="button"
          className="quiet-btn"
          disabled={scanning || importing || !projectFilter}
          onClick={() => void scan(projectFilter, harnessFilter)}
        >
          <RefreshCw size={13} className={scanning ? "spin" : ""} />
          <span>{scanning ? t("import.scanning") : t("import.scan")}</span>
        </button>
      }
    >
      <SettingsSection title={t("import.filterSection")}>
        <div className="sx-import-filters">
          <label className="sx-import-field">
            <span>{t("import.projectFilter")}</span>
            <select
              aria-label={t("import.projectFilter")}
              value={projectFilter}
              disabled={importing}
              onChange={(e) => {
                resetScan();
                setProjectFilter(e.target.value);
              }}
            >
              <option value="">{t("import.chooseProject")}</option>
              {snapshot.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="sx-import-field">
            <span>{t("import.engineFilter")}</span>
            <select
              aria-label={t("import.engineFilter")}
              value={harnessFilter}
              disabled={importing}
              onChange={(e) => {
                resetScan();
                setHarnessFilter(e.target.value);
              }}
            >
              <option value="">{t("import.allEngines")}</option>
              {HARNESS_IDS.filter((id) => id !== "cursor").map((id) => (
                <option key={id} value={id}>
                  {HARNESS_NAMES[id as HarnessId] ?? id}
                </option>
              ))}
            </select>
          </label>

          <label className="sx-import-field sx-import-field--search">
            <span>{t("import.searchPlaceholder")}</span>
            <div className="sx-import-search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                aria-label={t("import.searchPlaceholder")}
                placeholder={t("import.searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </label>
        </div>
      </SettingsSection>

      {error && (
        <div className="sx-provider-apply__error" role="alert">
          {error}
        </div>
      )}

      {lastResult && (
        <div className="sx-import-banner" role="status">
          <div className="sx-import-banner__text">
            <strong>
              {t.locale === "en"
                ? `Imported ${lastResult.imported.length} chat(s)`
                : t.locale === "ja"
                  ? `${lastResult.imported.length} 件のチャットをインポートしました`
                  : `已成功导入 ${lastResult.imported.length} 个对话`}
            </strong>
            {(lastResult.skipped.length > 0 || lastResult.errors.length > 0) && (
              <span>
                {lastResult.skipped.length > 0
                  ? t.locale === "en"
                    ? ` · ${lastResult.skipped.length} skipped`
                    : t.locale === "ja"
                      ? ` · ${lastResult.skipped.length} 件スキップ`
                      : ` · 跳过 ${lastResult.skipped.length} 个重复项`
                  : ""}
                {lastResult.errors.length > 0
                  ? t.locale === "en"
                    ? ` · ${lastResult.errors.length} failed`
                    : t.locale === "ja"
                      ? ` · ${lastResult.errors.length} 件失敗`
                      : ` · 失败 ${lastResult.errors.length} 个`
                  : ""}
              </span>
            )}
          </div>
          {lastResult.imported[0] && onOpenSession && (
            <button
              type="button"
              className="quiet-btn"
              onClick={() => onOpenSession(lastResult.imported[0]!.id)}
            >
              <span>{t("import.openSession")}</span>
              <ExternalLink size={12} />
            </button>
          )}
        </div>
      )}

      <SettingsSection
        title={t("import.listSection")}
        actions={
          <div className="sx-import-toolbar">
            <label className="sx-import-hide-toggle">
              <input
                type="checkbox"
                checked={hideImported}
                onChange={(e) => setHideImported(e.target.checked)}
              />
              <span>{t("import.hideImported")}</span>
            </label>
            {importableVisible.length > 0 && (
              <>
                <button type="button" className="sx-apply-mini-btn" onClick={selectAllVisible}>
                  {t("import.selectAll")} ({importableVisible.length})
                </button>
                {selectedCount > 0 && (
                  <button type="button" className="sx-apply-mini-btn" onClick={clearSelection}>
                    {t("import.clearSelection")}
                  </button>
                )}
              </>
            )}
          </div>
        }
      >
        {scanning && !discovery ? (
          <div className="sx-import-empty">
            <RefreshCw size={18} className="spin" />
            <span>{t("import.scanning")}</span>
          </div>
        ) : visibleCandidates.length === 0 ? (
          <div className="sx-import-empty">
            <Import size={20} />
            <strong>{t(discovery ? "import.emptyTitle" : "import.readyTitle")}</strong>
            <p>{t(discovery ? "import.emptyDesc" : "import.readyDesc")}</p>
          </div>
        ) : (
          <div className="sx-import-groups">
            {groupedByProject.map((group) => {
              const pickable = group.items.filter((c) => !c.alreadyImported);
              const pickedInGroup = pickable.filter((c) => selected.has(candidateKey(c))).length;
              return (
                <div className="sx-import-group" key={group.id ?? "__unassigned__"}>
                  <div className="sx-import-group__head">
                    <span className="sx-import-group__title">
                      <FolderOpen size={13} aria-hidden="true" />
                      <strong>{group.label}</strong>
                      <span className="sx-tag">{group.items.length}</span>
                    </span>
                    {pickable.length > 0 && (
                      <button
                        type="button"
                        className="sx-apply-mini-btn"
                        onClick={() => toggleProjectGroup(group.items)}
                      >
                        {pickedInGroup === pickable.length
                          ? t("import.clearSelection")
                          : `${t("import.selectAll")} (${pickable.length})`}
                      </button>
                    )}
                  </div>

                  <div className="sx-import-list">
                    {group.items.map((c) => {
                      const key = candidateKey(c);
                      const checked = selected.has(key);
                      const when = c.updatedAt ?? c.createdAt;
                      return (
                        <div
                          key={key}
                          className={`sx-import-row ${checked ? "is-checked" : ""} ${c.alreadyImported ? "is-imported" : ""}`}
                        >
                          <button
                            type="button"
                            className="sx-import-row__main"
                            aria-pressed={checked}
                            disabled={c.alreadyImported}
                            onClick={() => toggleOne(c)}
                          >
                            <span
                              className={`sx-import-check ${checked ? "is-checked" : ""} ${c.alreadyImported ? "is-done" : ""}`}
                              aria-hidden="true"
                            >
                              {(checked || c.alreadyImported) && (
                                <Check size={12} strokeWidth={2.6} />
                              )}
                            </span>
                            <HarnessBadge harnessId={c.harnessId} size="sm" tone="tinted" />
                            <span className="sx-import-row__text">
                              <strong title={c.title}>{c.title}</strong>
                              <span className="sx-import-row__meta">
                                <span>{HARNESS_NAMES[c.harnessId] ?? c.harnessId}</span>
                                {c.model && (
                                  <span className="sx-import-model">
                                    {shortModelLabel(c.model)}
                                  </span>
                                )}
                                {c.cwd && (
                                  <span className="sx-import-cwd" title={c.cwd}>
                                    {shortFolder(c.cwd)}
                                  </span>
                                )}
                                {when && <time>{formatDate(when)}</time>}
                              </span>
                            </span>
                          </button>

                          {c.alreadyImported && (
                            <div className="sx-import-row__aside">
                              <span className="sx-apply-status is-applied">
                                {t("import.alreadyImported")}
                              </span>
                              {c.existingSessionId && onOpenSession && (
                                <button
                                  type="button"
                                  className="sx-apply-mini-btn"
                                  onClick={() => onOpenSession(c.existingSessionId!)}
                                >
                                  {t("import.openSession")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="sx-import-bar">
          <label className="sx-import-target">
            <span>{t("import.targetProject")}</span>
            <select
              aria-label={t("import.targetProject")}
              value={targetProjectId}
              onChange={(e) => setTargetProjectId(e.target.value)}
            >
              <option value="">{t("import.autoProject")}</option>
              {snapshot.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary sx-import-submit"
            disabled={!projectFilter || selectedCount === 0 || importing || scanning}
            onClick={() => void runImport()}
          >
            <Import size={14} />
            <span>
              {importing
                ? t("import.importing")
                : `${t("import.importAction")}${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
            </span>
          </button>
        </div>
      </SettingsSection>

      {discovery && discovery.warnings.length > 0 && (
        <details className="sx-import-warnings">
          <summary>
            <AlertTriangle size={13} />
            <span>
              {t("import.warningsTitle")} ({discovery.warnings.length})
            </span>
          </summary>
          <ul>
            {discovery.warnings.map((w, idx) => (
              <li key={`${w.harnessId}-${idx}`}>
                <strong>{HARNESS_NAMES[w.harnessId] ?? w.harnessId}</strong>：{w.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </SettingsPage>
  );
}
