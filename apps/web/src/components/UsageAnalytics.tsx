import { useMemo, useState, type CSSProperties } from "react";
import { Activity, Clock, Flame, Layers, Sparkles, TrendingUp, Zap } from "lucide-react";
import { HARNESS_IDS } from "@kodo/protocol/client";
import type { HarnessId, Snapshot, Usage } from "@kodo/protocol";
import { api } from "../lib/host-client";
import {
  HARNESS_NAMES,
  HARNESS_VISUALS,
  formatDate,
  modelProvider,
  providerLabel,
  shortModelLabel,
} from "../lib/harnesses";
import { useT } from "../lib/i18n";
import { HarnessBadge } from "./KodoBrand";
import { SegmentedControl } from "./SegmentedControl";

type Wire = Record<string, any>;
type Action = (work: () => Promise<unknown>) => Promise<void>;
type TimeRange = "7d" | "14d" | "30d" | "all";
type MetricMode = "cost" | "tokens";
type ScopeFilter = "all" | "turn" | "session";

const RANGE_OPTIONS: Array<{ id: TimeRange; label: string; days: number | null }> = [
  { id: "7d", label: "7D", days: 7 },
  { id: "14d", label: "14D", days: 14 },
  { id: "30d", label: "30D", days: 30 },
  { id: "all", label: "全部", days: null },
];

const METRIC_MODES: Array<{ id: MetricMode; label: string }> = [
  { id: "cost", label: "费用 USD" },
  { id: "tokens", label: "Token" },
];

function formatTokens(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US");
}

function formatCompactTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(2)}`;
  if (n >= 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function formatDurationMs(ms?: number | null): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

function ttftTone(ms?: number | null): "fast" | "normal" | "slow" | "empty" {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "empty";
  if (ms <= 1500) return "fast";
  if (ms <= 5000) return "normal";
  return "slow";
}

function localDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shortDayLabel(dayKey: string): string {
  return dayKey.slice(5).replace("-", "/");
}

function addDays(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + delta);
  return d;
}

function harnessStroke(id: HarnessId, idx: number): string {
  const vis = HARNESS_VISUALS[id];
  if (vis?.ink) return vis.ink;
  const fallback = ["#C2422F", "#5640B8", "#166B48", "#2257B8", "#8F3C81", "#1E66A8"];
  return fallback[idx % fallback.length]!;
}

interface DayBucket {
  day: string;
  cost: number;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  count: number;
  byHarness: Record<string, { cost: number; tokens: number }>;
}

function DailyTrendChart({
  days,
  harnesses,
  mode,
}: {
  days: DayBucket[];
  harnesses: HarnessId[];
  mode: MetricMode;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const maxVal = useMemo(() => {
    const top = Math.max(...days.map((d) => (mode === "cost" ? d.cost : d.tokens)), 0);
    return top > 0 ? top * 1.15 : 1;
  }, [days, mode]);

  const activeDay = hoverIdx !== null ? days[hoverIdx] : null;
  const hasAny = days.some((d) => (mode === "cost" ? d.cost > 0 : d.tokens > 0));

  const W = 620;
  const H = 200;
  const padL = 48;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(days.length, 1);
  const slotW = plotW / n;
  const barW = Math.max(6, Math.min(26, slotW * 0.62));
  const labelStep = n > 20 ? 5 : n > 10 ? 2 : 1;

  const yTicks = [0, 0.5, 1];
  const polylinePts = days
    .map((d, i) => {
      const val = mode === "cost" ? d.cost : d.tokens;
      const x = padL + i * slotW + slotW / 2;
      const y = padT + plotH - (val / maxVal) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="usage-card usage-chart-card">
      <div className="usage-card__head">
        <div className="usage-card__title">
          <TrendingUp size={14} aria-hidden="true" />
          <h3>{mode === "cost" ? "每日费用趋势" : "每日 Token 吞吐"}</h3>
        </div>
        <div className="usage-chart-readout">
          {activeDay ? (
            <>
              <span className="mono-value">{activeDay.day}</span>
              <strong>
                {mode === "cost"
                  ? formatUsd(activeDay.cost)
                  : formatCompactTokens(activeDay.tokens)}
              </strong>
              <span className="usage-chart-readout__meta">{activeDay.count} 次</span>
            </>
          ) : (
            <span className="usage-chart-readout__idle">
              {days[0]?.day
                ? `${shortDayLabel(days[0].day)} – ${shortDayLabel(days.at(-1)!.day)}`
                : "—"}
            </span>
          )}
        </div>
      </div>

      <div className="usage-svg-wrap">
        <svg
          className="usage-trend-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={mode === "cost" ? "每日费用堆叠柱状图" : "每日 Token 堆叠柱状图"}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {yTicks.map((ratio) => {
            const y = padT + plotH * (1 - ratio);
            const val = maxVal * ratio;
            const tickText = !hasAny
              ? ratio === 0
                ? "0"
                : ""
              : mode === "cost"
                ? val >= 1
                  ? `$${val.toFixed(1)}`
                  : `$${val.toFixed(2)}`
                : formatCompactTokens(Math.round(val));
            return (
              <g key={ratio}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={y}
                  y2={y}
                  className={ratio === 0 ? "usage-axis-base" : "usage-grid-line"}
                />
                {tickText && (
                  <text x={padL - 8} y={y + 3.5} textAnchor="end" className="usage-axis-label">
                    {tickText}
                  </text>
                )}
              </g>
            );
          })}

          {hasAny && days.length > 1 && (
            <polyline fill="none" points={polylinePts} className="usage-trend-line" />
          )}

          {days.map((d, i) => {
            const slotX = padL + i * slotW;
            const barX = slotX + (slotW - barW) / 2;
            const isHovered = hoverIdx === i;
            let cursorY = padT + plotH;

            const segments = harnesses
              .map((h, hIdx) => {
                const entry = d.byHarness[h];
                const v = entry ? (mode === "cost" ? entry.cost : entry.tokens) : 0;
                return { h, v, color: harnessStroke(h, hIdx) };
              })
              .filter((s) => s.v > 0);

            return (
              <g
                key={d.day}
                className="usage-bar-col"
                onMouseEnter={() => setHoverIdx(i)}
                onClick={() => setHoverIdx(i === hoverIdx ? null : i)}
              >
                {isHovered && (
                  <rect
                    x={slotX + 1}
                    y={padT}
                    width={Math.max(slotW - 2, 4)}
                    height={plotH}
                    rx={5}
                    className="usage-col-highlight"
                  />
                )}
                {segments.length === 0 ? (
                  <rect
                    x={barX}
                    y={padT + plotH - 2}
                    width={barW}
                    height={2}
                    rx={1}
                    className="usage-bar-empty"
                  />
                ) : (
                  segments.map((seg, sIdx) => {
                    const segH = Math.max(2, (seg.v / maxVal) * plotH);
                    cursorY -= segH;
                    const isTop = sIdx === segments.length - 1;
                    return (
                      <rect
                        key={seg.h}
                        x={barX}
                        y={cursorY}
                        width={barW}
                        height={segH}
                        rx={isTop ? 3 : 0}
                        fill={seg.color}
                        opacity={hoverIdx === null || isHovered ? 0.9 : 0.4}
                        className="usage-bar-seg"
                      />
                    );
                  })
                )}
                <rect x={slotX} y={padT} width={slotW} height={plotH + padB} fill="transparent" />
                {(i % labelStep === 0 || i === days.length - 1) && (
                  <text
                    x={slotX + slotW / 2}
                    y={H - 6}
                    textAnchor="middle"
                    className={`usage-axis-label ${isHovered ? "is-active" : ""}`}
                  >
                    {shortDayLabel(d.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {harnesses.length > 0 && (
        <div className="usage-legend">
          {harnesses.map((h, i) => (
            <span className="usage-legend__item" key={h}>
              <span
                className="usage-legend__dot"
                style={{ backgroundColor: harnessStroke(h, i) }}
                aria-hidden="true"
              />
              <span>{HARNESS_NAMES[h] ?? h}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TokenCompositionDonut({
  input,
  output,
  cacheRead,
  cacheWrite,
}: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = input + output + cacheRead + cacheWrite;
  const cacheHitBase = input + cacheRead;
  const cacheHitPct = cacheHitBase > 0 ? Math.round((cacheRead / cacheHitBase) * 100) : 0;

  const slices = [
    { id: "input", label: "输入 Token", value: input, color: "#2257B8" },
    { id: "cacheRead", label: "缓存读取", value: cacheRead, color: "#166B48" },
    { id: "output", label: "输出 Token", value: output, color: "#C2422F" },
    { id: "cacheWrite", label: "缓存写入", value: cacheWrite, color: "#8F3C81" },
  ];

  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div className="usage-card usage-donut-card">
      <div className="usage-card__head">
        <div className="usage-card__title">
          <Layers size={14} aria-hidden="true" />
          <h3>Token 构成</h3>
        </div>
        {cacheHitBase > 0 && (
          <span className="mini-pill mini-pill--subtle">缓存 {cacheHitPct}%</span>
        )}
      </div>

      <div className="usage-donut-body">
        <div className="usage-donut-ring">
          <svg viewBox="0 0 140 140" role="img" aria-label="Token 构成环形图">
            <circle cx="70" cy="70" r={R} className="usage-donut-track" />
            {total > 0 &&
              slices.map((s) => {
                if (s.value <= 0) return null;
                const frac = s.value / total;
                const arcLen = Math.max(0, frac * C - 2);
                const offset = -acc * C;
                acc += frac;
                const active = hovered === null || hovered === s.id;
                return (
                  <circle
                    key={s.id}
                    cx="70"
                    cy="70"
                    r={R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={hovered === s.id ? 14 : 11}
                    strokeLinecap="round"
                    strokeDasharray={`${arcLen} ${C}`}
                    strokeDashoffset={offset}
                    opacity={active ? 0.92 : 0.3}
                    transform="rotate(-90 70 70)"
                    className="usage-donut-arc"
                    onMouseEnter={() => setHovered(s.id)}
                    onMouseLeave={() => setHovered(null)}
                  />
                );
              })}
          </svg>
          <div className="usage-donut-center">
            <strong>{total > 0 ? formatCompactTokens(total) : "0"}</strong>
            <span>Tokens</span>
          </div>
        </div>

        <div className="usage-donut-legend">
          {slices.map((s) => {
            const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
            return (
              <div
                key={s.id}
                className={`usage-donut-row ${hovered === s.id ? "is-hovered" : ""}`}
                onMouseEnter={() => setHovered(s.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="usage-donut-row__label">
                  <span
                    className="usage-legend__dot"
                    style={{ backgroundColor: s.color }}
                    aria-hidden="true"
                  />
                  <span>{s.label}</span>
                </span>
                <span className="usage-donut-row__val">
                  <strong>{s.value > 0 ? formatCompactTokens(s.value) : "0"}</strong>
                  <small>{pct}%</small>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ActivityHeatmap({ records, mode }: { records: Usage[]; mode: MetricMode }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { weeks, maxVal, activeDays } = useMemo(() => {
    const map = new Map<string, { cost: number; tokens: number; count: number }>();
    for (const r of records) {
      const k = localDayKey(r.createdAt);
      if (!k) continue;
      const cur = map.get(k) ?? { cost: 0, tokens: 0, count: 0 };
      cur.count += 1;
      cur.tokens += (r.input ?? 0) + (r.output ?? 0) + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0);
      cur.cost += r.costUsd ?? 0;
      map.set(k, cur);
    }

    const totalDays = 84;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDow = today.getDay();
    const gridEnd = addDays(today, 6 - endDow);
    const gridStart = addDays(gridEnd, -(totalDays - 1));

    const cols: Array<
      Array<{ key: string; future: boolean; count: number; cost: number; tokens: number }>
    > = [];
    let peak = 0;
    let active = 0;
    for (let w = 0; w < 12; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const dt = addDays(gridStart, w * 7 + d);
        const k = localDayKey(dt);
        const future = dt.getTime() > today.getTime();
        const stats = map.get(k) ?? { cost: 0, tokens: 0, count: 0 };
        if (!future && stats.count > 0) active++;
        const metric = mode === "cost" ? stats.cost : stats.tokens;
        if (metric > peak) peak = metric;
        col.push({ key: k, future, ...stats });
      }
      cols.push(col);
    }
    return { weeks: cols, maxVal: peak, activeDays: active };
  }, [records, mode]);

  const flatCells = weeks.flat();
  const inspected = selectedDay ? flatCells.find((c) => c.key === selectedDay) : null;

  const levelFor = (cell: { future: boolean; count: number; cost: number; tokens: number }) => {
    if (cell.future || cell.count === 0) return 0;
    const val = mode === "cost" ? cell.cost : cell.tokens;
    if (maxVal <= 0 || val <= 0) return 1;
    const ratio = val / maxVal;
    if (ratio >= 0.75) return 4;
    if (ratio >= 0.45) return 3;
    if (ratio >= 0.18) return 2;
    return 1;
  };

  return (
    <div className="usage-card usage-heatmap-card">
      <div className="usage-card__head">
        <div className="usage-card__title">
          <Flame size={14} aria-hidden="true" />
          <h3>12 周活跃热力</h3>
        </div>
        <div className="usage-chart-readout">
          {inspected ? (
            <>
              <span className="mono-value">{inspected.key}</span>
              <strong>
                {mode === "cost"
                  ? formatUsd(inspected.cost)
                  : formatCompactTokens(inspected.tokens)}
              </strong>
              <span className="usage-chart-readout__meta">{inspected.count} 次</span>
            </>
          ) : (
            <span className="usage-chart-readout__idle">活跃 {activeDays} 天</span>
          )}
        </div>
      </div>

      <div className="usage-heatmap-wrap">
        <div className="usage-heatmap-dow" aria-hidden="true">
          <span>日</span>
          <span />
          <span>二</span>
          <span />
          <span>四</span>
          <span />
          <span>六</span>
        </div>
        <div className="usage-heatmap-grid" role="grid" aria-label="近 12 周活跃热力图">
          {weeks.map((col, wIdx) => (
            <div className="usage-heatmap-col" key={wIdx}>
              {col.map((cell) => {
                const lvl = levelFor(cell);
                const label = `${cell.key}: ${cell.count} 次 · ${formatCompactTokens(cell.tokens)} tok · ${formatUsd(cell.cost)}`;
                return (
                  <button
                    key={cell.key}
                    type="button"
                    disabled={cell.future}
                    className={`usage-heat-cell lvl-${lvl} ${selectedDay === cell.key ? "is-selected" : ""}`}
                    title={label}
                    aria-label={label}
                    onMouseEnter={() => !cell.future && setSelectedDay(cell.key)}
                    onClick={() => !cell.future && setSelectedDay(cell.key)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="usage-heatmap-foot">
        <span className="mono-value">
          {weeks[0]?.[0]?.key ? shortDayLabel(weeks[0][0].key) : ""}
        </span>
        <div className="usage-heat-scale" aria-hidden="true">
          <span className="usage-heat-cell lvl-0" />
          <span className="usage-heat-cell lvl-1" />
          <span className="usage-heat-cell lvl-2" />
          <span className="usage-heat-cell lvl-3" />
          <span className="usage-heat-cell lvl-4" />
        </div>
        <span className="mono-value">今日</span>
      </div>
    </div>
  );
}

export function UsagePage({
  snapshot,
  usage,
  act,
}: {
  snapshot: Snapshot;
  usage?: { records: Usage[]; budgets: Wire[] };
  act: Action;
}) {
  const [project, setProject] = useState("");
  const [usd, setUsd] = useState("");
  const [filter, setFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [range, setRange] = useState<TimeRange>("14d");
  const [metricMode, setMetricMode] = useState<MetricMode>("cost");

  const allRecords = usage?.records ?? [];
  const rangeOption = RANGE_OPTIONS.find((r) => r.id === range)!;

  const turnSessions = useMemo(
    () => new Set(allRecords.filter((r) => r.scope === "turn").map((r) => r.sessionId)),
    [allRecords],
  );
  const records = useMemo(() => {
    const now = new Date();
    const cutoff =
      rangeOption.days !== null ? addDays(now, -(rangeOption.days - 1)).setHours(0, 0, 0, 0) : null;
    return allRecords.filter((r) => {
      if (filter && r.source !== filter) return false;
      if (projectFilter && r.projectId !== projectFilter) return false;
      if (scopeFilter !== "all" && r.scope !== scopeFilter) return false;
      // "All" counts each turn once: a session snapshot is a running total of turns
      // already listed, so only keep it for sessions that have no per-turn records.
      if (scopeFilter === "all" && r.scope === "session" && turnSessions.has(r.sessionId))
        return false;
      if (cutoff !== null) {
        const ts = new Date(r.createdAt).getTime();
        if (!Number.isNaN(ts) && ts < cutoff) return false;
      }
      return true;
    });
  }, [allRecords, turnSessions, filter, projectFilter, scopeFilter, rangeOption.days]);

  const knownUsdRecords = records.filter((r) => r.costUsd !== null);
  const actualCount = records.filter((r) => r.costKind === "actual").length;
  const estimateCount = records.filter((r) => r.costKind === "estimate").length;
  const totalKnownUsd = knownUsdRecords.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const unknownCostCount = records.length - knownUsdRecords.length;
  const totalInput = records.reduce((sum, r) => sum + (r.input ?? 0), 0);
  const totalOutput = records.reduce((sum, r) => sum + (r.output ?? 0), 0);
  const totalCacheRead = records.reduce((sum, r) => sum + (r.cacheRead ?? 0), 0);
  const totalCacheWrite = records.reduce((sum, r) => sum + (r.cacheWrite ?? 0), 0);
  const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite;
  const cacheHitPct =
    totalInput + totalCacheRead > 0
      ? Math.round((totalCacheRead / (totalInput + totalCacheRead)) * 100)
      : 0;

  const dayBuckets = useMemo(() => {
    const byDay = new Map<string, DayBucket>();
    const ensure = (day: string): DayBucket => {
      let cur = byDay.get(day);
      if (!cur) {
        cur = {
          day,
          cost: 0,
          tokens: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          count: 0,
          byHarness: {},
        };
        byDay.set(day, cur);
      }
      return cur;
    };

    for (const r of records) {
      const day = localDayKey(r.createdAt);
      if (!day) continue;
      const b = ensure(day);
      const tok = (r.input ?? 0) + (r.output ?? 0) + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0);
      b.count += 1;
      b.input += r.input ?? 0;
      b.output += r.output ?? 0;
      b.cacheRead += r.cacheRead ?? 0;
      b.cacheWrite += r.cacheWrite ?? 0;
      b.tokens += tok;
      b.cost += r.costUsd ?? 0;
      const h = b.byHarness[r.source] ?? { cost: 0, tokens: 0 };
      h.cost += r.costUsd ?? 0;
      h.tokens += tok;
      b.byHarness[r.source] = h;
    }

    const span = rangeOption.days ?? 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: DayBucket[] = [];
    if (rangeOption.days !== null) {
      for (let i = span - 1; i >= 0; i--) {
        const key = localDayKey(addDays(today, -i));
        result.push(ensure(key));
      }
      return result;
    }
    if (byDay.size === 0) {
      for (let i = span - 1; i >= 0; i--) result.push(ensure(localDayKey(addDays(today, -i))));
      return result;
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [records, rangeOption.days]);

  const byHarness = useMemo(() => {
    const buckets = new Map<
      HarnessId,
      {
        harnessId: HarnessId;
        count: number;
        tokens: number;
        input: number;
        output: number;
        cacheRead: number;
        usd: number;
        hasUsd: boolean;
      }
    >();
    for (const r of records) {
      const id = r.source as HarnessId;
      const cur = buckets.get(id) ?? {
        harnessId: id,
        count: 0,
        tokens: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        usd: 0,
        hasUsd: false,
      };
      cur.count += 1;
      cur.input += r.input ?? 0;
      cur.output += r.output ?? 0;
      cur.cacheRead += r.cacheRead ?? 0;
      cur.tokens += (r.input ?? 0) + (r.output ?? 0) + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0);
      if (r.costUsd !== null) {
        cur.usd += r.costUsd;
        cur.hasUsd = true;
      }
      buckets.set(id, cur);
    }
    return [...buckets.values()].sort((a, b) => b.usd - a.usd || b.tokens - a.tokens);
  }, [records]);

  const byModel = useMemo(() => {
    const buckets = new Map<
      string,
      {
        model: string;
        count: number;
        tokens: number;
        cacheHitBase: number;
        cacheRead: number;
        usd: number;
        hasUsd: boolean;
      }
    >();
    for (const r of records) {
      const session = snapshot.sessions.find((s) => s.id === r.sessionId);
      const route = r.model ?? session?.model;
      // The same model through different providers is one model here.
      const modelName = route ? shortModelLabel(route) : "未报告模型";
      const cur = buckets.get(modelName) ?? {
        model: modelName,
        count: 0,
        tokens: 0,
        cacheHitBase: 0,
        cacheRead: 0,
        usd: 0,
        hasUsd: false,
      };
      cur.count += 1;
      cur.tokens += (r.input ?? 0) + (r.output ?? 0) + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0);
      cur.cacheHitBase += (r.input ?? 0) + (r.cacheRead ?? 0);
      cur.cacheRead += r.cacheRead ?? 0;
      if (r.costUsd !== null) {
        cur.usd += r.costUsd;
        cur.hasUsd = true;
      }
      buckets.set(modelName, cur);
    }
    return [...buckets.values()].sort((a, b) => b.usd - a.usd || b.tokens - a.tokens).slice(0, 12);
  }, [records, snapshot.sessions]);

  const byProvider = useMemo(() => {
    const buckets = new Map<
      string,
      {
        provider: string;
        count: number;
        tokens: number;
        usd: number;
        hasUsd: boolean;
        models: Set<string>;
      }
    >();
    for (const r of records) {
      const session = snapshot.sessions.find((s) => s.id === r.sessionId);
      const route = r.model ?? session?.model ?? "";
      const binding = snapshot.bindings.find((b) => b.id === r.bindingId);
      const provider =
        (binding ? `绑定 · ${binding.name}` : undefined) ??
        providerLabel(modelProvider(route)) ??
        `${HARNESS_NAMES[r.source as HarnessId] ?? r.source} 原生`;
      const cur = buckets.get(provider) ?? {
        provider,
        count: 0,
        tokens: 0,
        usd: 0,
        hasUsd: false,
        models: new Set<string>(),
      };
      cur.count += 1;
      cur.tokens += (r.input ?? 0) + (r.output ?? 0) + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0);
      if (route) cur.models.add(shortModelLabel(route));
      if (r.costUsd !== null) {
        cur.usd += r.costUsd;
        cur.hasUsd = true;
      }
      buckets.set(provider, cur);
    }
    return [...buckets.values()].sort((a, b) => b.usd - a.usd || b.tokens - a.tokens);
  }, [records, snapshot.sessions, snapshot.bindings]);
  const maxProviderTokens = Math.max(1, ...byProvider.map((p) => p.tokens));

  const t = useT();
  const PAGE_SIZE = 20;
  const [logPage, setLogPage] = useState(0);
  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [records],
  );
  const latencySummary = useMemo(() => {
    let ttftSum = 0;
    let ttftCount = 0;
    let durSum = 0;
    let durCount = 0;
    for (const r of records) {
      if (
        typeof r.firstTokenMs === "number" &&
        Number.isFinite(r.firstTokenMs) &&
        r.firstTokenMs >= 0
      ) {
        ttftSum += r.firstTokenMs;
        ttftCount += 1;
      }
      if (typeof r.durationMs === "number" && Number.isFinite(r.durationMs) && r.durationMs >= 0) {
        durSum += r.durationMs;
        durCount += 1;
      }
    }
    return {
      avgFirstTokenMs: ttftCount > 0 ? ttftSum / ttftCount : null,
      avgDurationMs: durCount > 0 ? durSum / durCount : null,
    };
  }, [records]);
  const pageCount = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));
  const currentPage = Math.min(logPage, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageRecords = sortedRecords.slice(pageStart, pageStart + PAGE_SIZE);

  const peakDay = useMemo(() => {
    let best: DayBucket | null = null;
    for (const d of dayBuckets) {
      const score = metricMode === "cost" ? d.cost : d.tokens;
      const bestScore = best ? (metricMode === "cost" ? best.cost : best.tokens) : 0;
      if (score > bestScore) best = d;
    }
    return best;
  }, [dayBuckets, metricMode]);

  const spentByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRecords) {
      if (r.projectId && r.costUsd !== null) {
        m.set(r.projectId, (m.get(r.projectId) ?? 0) + r.costUsd);
      }
    }
    return m;
  }, [allRecords]);

  const anyHarnessUsd = byHarness.some((b) => b.hasUsd && b.usd > 0);
  const weightForHarness = (b: (typeof byHarness)[number]) =>
    metricMode === "cost" && anyHarnessUsd ? b.usd : b.tokens || b.count;

  const anyModelUsd = byModel.some((m) => m.hasUsd && m.usd > 0);
  const weightForModel = (m: (typeof byModel)[number]) =>
    metricMode === "cost" && anyModelUsd ? m.usd : m.tokens || m.count;

  const maxBucketScale = useMemo(() => {
    if (byHarness.length === 0) return 1;
    return Math.max(...byHarness.map(weightForHarness), 0.0001);
  }, [byHarness, metricMode, anyHarnessUsd]);

  const maxModelScale = useMemo(() => {
    if (byModel.length === 0) return 1;
    return Math.max(...byModel.map(weightForModel), 0.0001);
  }, [byModel, metricMode, anyModelUsd]);

  const harnessIdsInData = byHarness.map((b) => b.harnessId);
  const harnessShareTotal = byHarness.reduce((s, b) => s + weightForHarness(b), 0);

  return (
    <div className="page-stack usage-page">
      <div className="usage-toolbar">
        <div className="usage-toolbar__filters">
          <select
            aria-label="用量 harness 筛选"
            className="setting-row__select"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">全部 Harness</option>
            {HARNESS_IDS.map((h) => (
              <option key={h} value={h}>
                {HARNESS_NAMES[h]}
              </option>
            ))}
          </select>

          <select
            aria-label="用量项目筛选"
            className="setting-row__select"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="">全部项目</option>
            {snapshot.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            aria-label="计量粒度筛选"
            className="setting-row__select"
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
          >
            <option value="all">全部（不重复计）</option>
            <option value="turn">本轮增量</option>
            <option value="session">累计快照</option>
          </select>
        </div>

        <div className="usage-toolbar__toggles">
          <SegmentedControl<TimeRange>
            className="usage-segmented"
            size="sm"
            ariaLabel="时间窗口"
            value={range}
            onChange={setRange}
            options={RANGE_OPTIONS.map((opt) => ({ value: opt.id, label: opt.label }))}
          />

          <SegmentedControl<MetricMode>
            className="usage-segmented"
            size="sm"
            ariaLabel="图表指标"
            value={metricMode}
            onChange={setMetricMode}
            options={METRIC_MODES.map((opt) => ({ value: opt.id, label: opt.label }))}
          />
        </div>
      </div>

      <div className="metric-strip metric-strip--4">
        <div className="metric-cell" style={{ "--i": 0 } as CSSProperties}>
          <div className="metric-cell__top">
            <span className="metric-cell__index">01</span>
            {knownUsdRecords.length > 0 && (
              <span className="metric-cell__tick">
                实际 {actualCount} · 估算 {estimateCount}
              </span>
            )}
          </div>
          <span className="metric-cell__label">已知费用汇总</span>
          <strong className="metric-cell__value">
            {knownUsdRecords.length > 0 ? formatUsd(totalKnownUsd) : "—"}
          </strong>
        </div>

        <div className="metric-cell" style={{ "--i": 1 } as CSSProperties}>
          <div className="metric-cell__top">
            <span className="metric-cell__index">02</span>
            {totalInput + totalCacheRead > 0 && (
              <span className="metric-cell__tick">缓存 {cacheHitPct}%</span>
            )}
          </div>
          <span className="metric-cell__label">总吞吐 Token</span>
          <strong className="metric-cell__value">
            {totalTokens > 0 ? formatCompactTokens(totalTokens) : "—"}
          </strong>
        </div>

        <div className="metric-cell" style={{ "--i": 2 } as CSSProperties}>
          <div className="metric-cell__top">
            <span className="metric-cell__index">03</span>
            <span className="metric-cell__tick">{records.length} 条</span>
          </div>
          <span className="metric-cell__label">
            {metricMode === "cost" ? "均次费用" : "均次 Token"}
          </span>
          <strong className="metric-cell__value">
            {records.length === 0
              ? "—"
              : metricMode === "cost"
                ? knownUsdRecords.length > 0
                  ? formatUsd(totalKnownUsd / knownUsdRecords.length)
                  : "—"
                : formatCompactTokens(Math.round(totalTokens / records.length))}
          </strong>
        </div>

        <div className="metric-cell" style={{ "--i": 3 } as CSSProperties}>
          <div className="metric-cell__top">
            <span className="metric-cell__index">04</span>
            <span className="metric-cell__tick">
              {peakDay ? shortDayLabel(peakDay.day) : `未报费 ${unknownCostCount}`}
            </span>
          </div>
          <span className="metric-cell__label">峰值日产出</span>
          <strong className="metric-cell__value">
            {peakDay
              ? metricMode === "cost"
                ? formatUsd(peakDay.cost)
                : formatCompactTokens(peakDay.tokens)
              : unknownCostCount}
          </strong>
        </div>
      </div>

      <div className="usage-charts-grid">
        <DailyTrendChart days={dayBuckets} harnesses={harnessIdsInData} mode={metricMode} />
        <TokenCompositionDonut
          input={totalInput}
          output={totalOutput}
          cacheRead={totalCacheRead}
          cacheWrite={totalCacheWrite}
        />
      </div>

      <ActivityHeatmap
        records={allRecords.filter(
          (r) =>
            (!filter || r.source === filter) && (!projectFilter || r.projectId === projectFilter),
        )}
        mode={metricMode}
      />

      {byHarness.length > 0 && (
        <div className="usage-split-grid">
          <section className="usage-card usage-split-panel">
            <div className="usage-card__head">
              <div className="usage-card__title">
                <Activity size={14} aria-hidden="true" />
                <h3>按 Harness 分布</h3>
              </div>
              {filter && (
                <button type="button" className="quiet-btn" onClick={() => setFilter("")}>
                  清除筛选
                </button>
              )}
            </div>

            {harnessShareTotal > 0 && (
              <div className="usage-proportion-strip" aria-hidden="true">
                {byHarness.map((b, idx) => {
                  const val = weightForHarness(b);
                  if (val <= 0) return null;
                  const pct = (val / harnessShareTotal) * 100;
                  return (
                    <span
                      key={b.harnessId}
                      style={{
                        width: `${Math.max(pct, 2)}%`,
                        backgroundColor: harnessStroke(b.harnessId, idx),
                      }}
                    />
                  );
                })}
              </div>
            )}

            <div className="breakdown-list">
              {byHarness.map((b, idx) => {
                const weight = weightForHarness(b);
                const pct =
                  weight > 0
                    ? Math.max(4, Math.min(100, Math.round((weight / maxBucketScale) * 100)))
                    : 0;
                const color = harnessStroke(b.harnessId, idx);
                return (
                  <button
                    type="button"
                    className={`breakdown-row breakdown-row--interactive ${filter === b.harnessId ? "is-selected" : ""}`}
                    key={b.harnessId}
                    style={{ "--i": idx } as CSSProperties}
                    onClick={() => setFilter(filter === b.harnessId ? "" : b.harnessId)}
                  >
                    <div className="breakdown-row__head">
                      <div className="breakdown-row__name">
                        <HarnessBadge harnessId={b.harnessId} size="xs" tone="mono" />
                        <span>{HARNESS_NAMES[b.harnessId] ?? b.harnessId}</span>
                        <span className="breakdown-row__count">{b.count} 次</span>
                      </div>
                      <div className="breakdown-row__nums">
                        <span>{formatCompactTokens(b.tokens)} tok</span>
                        {b.hasUsd && <strong>{formatUsd(b.usd)}</strong>}
                      </div>
                    </div>
                    <div className="breakdown-bar" aria-hidden="true">
                      <div
                        className="breakdown-bar__fill"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="usage-card usage-split-panel">
            <div className="usage-card__head">
              <div className="usage-card__title">
                <Sparkles size={14} aria-hidden="true" />
                <h3>模型消耗排行</h3>
              </div>
              <span className="mini-pill mini-pill--subtle">{byModel.length} 个</span>
            </div>

            <div className="breakdown-list">
              {byModel.map((m, idx) => {
                const weight = weightForModel(m);
                const pct =
                  weight > 0
                    ? Math.max(4, Math.min(100, Math.round((weight / maxModelScale) * 100)))
                    : 0;
                const modelCachePct =
                  m.cacheHitBase > 0 ? Math.round((m.cacheRead / m.cacheHitBase) * 100) : 0;
                return (
                  <div
                    className="breakdown-row"
                    key={m.model}
                    style={{ "--i": idx } as CSSProperties}
                  >
                    <div className="breakdown-row__head">
                      <div className="breakdown-row__name">
                        <span className="model-rank-idx">{String(idx + 1).padStart(2, "0")}</span>
                        <span className="mono-cell">{m.model}</span>
                        <span className="breakdown-row__count">{m.count} 次</span>
                      </div>
                      <div className="breakdown-row__nums">
                        {modelCachePct > 0 && <small>命中 {modelCachePct}%</small>}
                        <span>{formatCompactTokens(m.tokens)} tok</span>
                        {m.hasUsd && <strong>{formatUsd(m.usd)}</strong>}
                      </div>
                    </div>
                    <div className="breakdown-bar" aria-hidden="true">
                      <div className="breakdown-bar__fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="usage-card usage-split-panel">
            <div className="usage-card__head">
              <div className="usage-card__title">
                <Layers size={14} aria-hidden="true" />
                <h3>按 Provider 统计</h3>
              </div>
              <span className="mini-pill mini-pill--subtle">{byProvider.length} 个</span>
            </div>
            <div className="breakdown-list">
              {byProvider.map((p, idx) => (
                <div
                  className="breakdown-row"
                  key={p.provider}
                  style={{ "--i": idx } as CSSProperties}
                >
                  <div className="breakdown-row__head">
                    <div className="breakdown-row__name">
                      <span className="mono-cell">{p.provider}</span>
                      <span className="breakdown-row__count">
                        {p.count} 次 · {p.models.size} 个模型
                      </span>
                    </div>
                    <div className="breakdown-row__nums">
                      <span>{formatCompactTokens(p.tokens)} tok</span>
                      {p.hasUsd && <strong>{formatUsd(p.usd)}</strong>}
                    </div>
                  </div>
                  <div className="breakdown-bar" aria-hidden="true">
                    <div
                      className="breakdown-bar__fill"
                      style={{
                        width: `${Math.max(4, Math.round((p.tokens / maxProviderTokens) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <section>
        <div className="section-line section-head-space">
          <h2>本地预算</h2>
        </div>

        <div className="settings-group budget-panel">
          <form
            className="budget-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => api("/budgets", "POST", { projectId: project, usd: Number(usd) }));
            }}
          >
            <select
              aria-label="预算项目"
              required
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">选择项目…</option>
              {snapshot.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="budget-form__amount">
              <span aria-hidden="true">$</span>
              <input
                aria-label="上限 USD"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="上限 USD"
                required
                value={usd}
                onChange={(e) => setUsd(e.target.value)}
              />
            </div>
            <button type="submit" className="primary">
              保存预算
            </button>
          </form>

          {usage && usage.budgets.length > 0 ? (
            <div className="budget-list">
              {usage.budgets.map((b, i) => {
                const limitUsd = Math.max(Number(b.usd), 0.01);
                const spent = spentByProject.get(b.projectId) ?? 0;
                const pct = Math.min(100, Math.round((spent / limitUsd) * 100));
                const tone = spent >= limitUsd ? "is-over" : pct >= 75 ? "is-warn" : "is-ok";
                return (
                  <div className="budget-row budget-row--gauge" key={i}>
                    <div className="budget-row__head">
                      <strong>
                        {snapshot.projects.find((p) => p.id === b.projectId)?.name ?? "未命名项目"}
                      </strong>
                      <div className="budget-row__metrics">
                        <span className="mono-value">
                          {formatUsd(spent)} / ${limitUsd.toFixed(2)}
                        </span>
                        <span
                          className={`mini-pill ${tone === "is-over" ? "mini-pill--coral" : "mini-pill--subtle"}`}
                        >
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div className="budget-meter" aria-hidden="true">
                      <div className={`budget-meter__fill ${tone}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="budget-empty">未设上限</div>
          )}
        </div>
      </section>

      <section className="usage-ledger-section">
        <div className="usage-ledger-header section-head-space">
          <div className="usage-ledger-header__title">
            <h2>{t("usage.ledgerTitle")}</h2>
            <span className="mini-pill mini-pill--subtle">{records.length} 条</span>
          </div>
          {(latencySummary.avgFirstTokenMs !== null || latencySummary.avgDurationMs !== null) && (
            <div className="usage-ledger-header__stats" aria-label="响应耗时均值">
              {latencySummary.avgFirstTokenMs !== null && (
                <span className="usage-latency-chip" title="当前筛选范围内平均首字响应时间">
                  <Zap size={12} aria-hidden="true" />
                  <span>{t("usage.avgTtft")}</span>
                  <strong>{formatDurationMs(latencySummary.avgFirstTokenMs)}</strong>
                </span>
              )}
              {latencySummary.avgDurationMs !== null && (
                <span className="usage-latency-chip" title="当前筛选范围内平均轮次总耗时">
                  <Clock size={12} aria-hidden="true" />
                  <span>{t("usage.avgDuration")}</span>
                  <strong>{formatDurationMs(latencySummary.avgDurationMs)}</strong>
                </span>
              )}
            </div>
          )}
        </div>

        {records.length === 0 ? (
          <div className="empty-small settings-group">
            <span className="empty-small__badge" aria-hidden="true">
              <Activity size={20} />
            </span>
            <h3>暂无用量记录</h3>
          </div>
        ) : (
          <div className="settings-group usage-ledger-card">
            <div className="table-scroll usage-ledger-desktop">
              <table className="usage-table">
                <colgroup>
                  <col className="usage-col-source" />
                  <col className="usage-col-model" />
                  <col className="usage-col-tokens" />
                  <col className="usage-col-ttft" />
                  <col className="usage-col-duration" />
                  <col className="usage-col-cost" />
                  <col className="usage-col-time" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t("usage.col.engineSession")}</th>
                    <th>{t("usage.col.model")}</th>
                    <th className="is-num">{t("usage.col.tokens")}</th>
                    <th className="is-num">{t("usage.col.ttft")}</th>
                    <th className="is-num">{t("usage.col.duration")}</th>
                    <th className="is-num">{t("usage.col.cost")}</th>
                    <th className="is-num">{t("usage.col.time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.map((u) => {
                    const harnessId = u.source as HarnessId;
                    const session = snapshot.sessions.find((s) => s.id === u.sessionId);
                    const rawModel = u.model ?? session?.model ?? null;
                    const modelText = rawModel ? shortModelLabel(rawModel) : null;
                    const hasTokens =
                      (u.input ?? 0) > 0 ||
                      (u.output ?? 0) > 0 ||
                      (u.cacheRead ?? 0) > 0 ||
                      (u.cacheWrite ?? 0) > 0;
                    const hasCache = (u.cacheRead ?? 0) > 0 || (u.cacheWrite ?? 0) > 0;
                    const firstTone = ttftTone(u.firstTokenMs);
                    const tokenTooltip = [
                      `输入 ${formatTokens(u.input)}`,
                      `输出 ${formatTokens(u.output)}`,
                      (u.cacheRead ?? 0) > 0 ? `缓存读 ${formatTokens(u.cacheRead)}` : null,
                      (u.cacheWrite ?? 0) > 0 ? `缓存写 ${formatTokens(u.cacheWrite)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr key={u.id}>
                        <td>
                          <div className="usage-source-cell">
                            <HarnessBadge harnessId={harnessId} size="sm" tone="tinted" />
                            <div className="usage-source-cell__text">
                              <strong>{HARNESS_NAMES[harnessId] ?? u.source}</strong>
                              <span
                                className={
                                  session ? "usage-session-title" : "usage-session-title is-removed"
                                }
                                title={session?.title ?? "已移除会话"}
                              >
                                {session?.title ?? "已移除会话"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          {modelText ? (
                            <span className="usage-model-pill" title={rawModel ?? modelText}>
                              {modelText}
                            </span>
                          ) : (
                            <span className="usage-empty-dash">未报告</span>
                          )}
                        </td>
                        <td className="is-num" title={tokenTooltip}>
                          <div className={`usage-token-pair ${hasTokens ? "" : "is-muted"}`}>
                            <span className="usage-token-pair__item">
                              <em className="usage-token-dir">入</em>
                              {u.input !== null ? formatCompactTokens(u.input) : "—"}
                            </span>
                            <span className="usage-token-sep" aria-hidden="true">
                              /
                            </span>
                            <span className="usage-token-pair__item">
                              <em className="usage-token-dir">出</em>
                              {u.output !== null ? formatCompactTokens(u.output) : "—"}
                            </span>
                          </div>
                          {hasCache && (
                            <small className="usage-cache-meta">
                              {(u.cacheRead ?? 0) > 0
                                ? `读 ${formatCompactTokens(u.cacheRead!)}`
                                : ""}
                              {(u.cacheRead ?? 0) > 0 && (u.cacheWrite ?? 0) > 0 ? " · " : ""}
                              {(u.cacheWrite ?? 0) > 0
                                ? `写 ${formatCompactTokens(u.cacheWrite!)}`
                                : ""}
                            </small>
                          )}
                        </td>
                        <td className="is-num">
                          {firstTone !== "empty" ? (
                            <span
                              className={`usage-latency-pill is-${firstTone}`}
                              title={`首字响应时间 ${Math.round(u.firstTokenMs!)}ms`}
                            >
                              {formatDurationMs(u.firstTokenMs)}
                            </span>
                          ) : (
                            <span className="usage-empty-dash">—</span>
                          )}
                        </td>
                        <td className="is-num">
                          {u.durationMs !== null &&
                          u.durationMs !== undefined &&
                          Number.isFinite(u.durationMs) ? (
                            <span
                              className="usage-duration-value"
                              title={`总耗时 ${Math.round(u.durationMs)}ms`}
                            >
                              {formatDurationMs(u.durationMs)}
                            </span>
                          ) : (
                            <span className="usage-empty-dash">—</span>
                          )}
                        </td>
                        <td className="is-num">
                          {u.costUsd === null ? (
                            <span className="usage-empty-dash">未知</span>
                          ) : (
                            <span className="usage-cost-cell">
                              <strong className={u.costUsd === 0 ? "is-zero" : ""}>
                                ${u.costUsd.toFixed(4)}
                              </strong>
                              <span
                                className={`usage-cost-kind ${u.costKind === "actual" ? "is-actual" : "is-estimate"}`}
                              >
                                {u.costKind === "estimate" ? "估算" : "实际"}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="is-num">
                          <div className="usage-time-cell">
                            <span className="usage-time-primary">{formatDate(u.createdAt)}</span>
                            <span
                              className={`usage-scope-pill ${u.scope === "session" ? "is-session" : "is-turn"}`}
                            >
                              {u.scope === "session" ? "累计快照" : "本轮增量"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="usage-ledger-mobile" role="list" aria-label="使用明细列表">
              {pageRecords.map((u) => {
                const harnessId = u.source as HarnessId;
                const session = snapshot.sessions.find((s) => s.id === u.sessionId);
                const rawModel = u.model ?? session?.model ?? null;
                const modelText = rawModel ? shortModelLabel(rawModel) : null;
                const firstTone = ttftTone(u.firstTokenMs);
                return (
                  <article className="usage-mobile-item" role="listitem" key={u.id}>
                    <div className="usage-mobile-item__top">
                      <div className="usage-source-cell">
                        <HarnessBadge harnessId={harnessId} size="sm" tone="tinted" />
                        <div className="usage-source-cell__text">
                          <strong>{HARNESS_NAMES[harnessId] ?? u.source}</strong>
                          <span
                            className={
                              session ? "usage-session-title" : "usage-session-title is-removed"
                            }
                          >
                            {session?.title ?? "已移除会话"}
                          </span>
                        </div>
                      </div>
                      <div className="usage-mobile-item__cost">
                        {u.costUsd === null ? (
                          <span className="usage-empty-dash">未知</span>
                        ) : (
                          <>
                            <strong className={u.costUsd === 0 ? "is-zero" : ""}>
                              ${u.costUsd.toFixed(4)}
                            </strong>
                            <span
                              className={`usage-cost-kind ${u.costKind === "actual" ? "is-actual" : "is-estimate"}`}
                            >
                              {u.costKind === "estimate" ? "估算" : "实际"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="usage-mobile-item__meta">
                      {modelText ? (
                        <span className="usage-model-pill">{modelText}</span>
                      ) : (
                        <span className="usage-empty-dash">未报告模型</span>
                      )}
                      <span
                        className={`usage-scope-pill ${u.scope === "session" ? "is-session" : "is-turn"}`}
                      >
                        {u.scope === "session" ? "累计快照" : "本轮增量"}
                      </span>
                      <span className="usage-mobile-item__time">{formatDate(u.createdAt)}</span>
                    </div>

                    <div className="usage-mobile-item__metrics">
                      <div className="usage-mobile-metric">
                        <span>Token</span>
                        <strong
                          className={
                            (u.input ?? 0) === 0 && (u.output ?? 0) === 0 ? "is-muted" : ""
                          }
                        >
                          <em className="usage-token-dir">入</em>
                          {u.input !== null ? formatCompactTokens(u.input) : "—"}{" "}
                          <span className="usage-token-sep">/</span>{" "}
                          <em className="usage-token-dir">出</em>
                          {u.output !== null ? formatCompactTokens(u.output) : "—"}
                        </strong>
                      </div>
                      <div className="usage-mobile-metric">
                        <span>首字时间</span>
                        {firstTone !== "empty" ? (
                          <span className={`usage-latency-pill is-${firstTone}`}>
                            {formatDurationMs(u.firstTokenMs)}
                          </span>
                        ) : (
                          <strong className="is-muted">—</strong>
                        )}
                      </div>
                      <div className="usage-mobile-metric">
                        <span>总时间</span>
                        <strong className={u.durationMs == null ? "is-muted" : ""}>
                          {formatDurationMs(u.durationMs)}
                        </strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {pageCount > 1 && (
              <div className="usage-pager" role="navigation" aria-label="明细翻页">
                <span className="usage-pager__summary">
                  第 {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, sortedRecords.length)} 条 · 共{" "}
                  {sortedRecords.length} 条
                </span>
                <div className="usage-pager__controls">
                  <button
                    type="button"
                    disabled={currentPage === 0}
                    onClick={() => setLogPage(currentPage - 1)}
                  >
                    上一页
                  </button>
                  <span className="usage-pager__page">
                    {currentPage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => setLogPage(currentPage + 1)}
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
