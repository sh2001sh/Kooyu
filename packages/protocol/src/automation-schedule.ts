import type { AutomationInput } from "./self-hosted.js";
export type AutomationTrigger = AutomationInput["trigger"];
export type ScheduleMode =
  "once" | "daily" | "weekdays" | "weekly" | "monthly" | "interval" | "custom" | "webhook";
export interface ScheduleEditorValue {
  mode: ScheduleMode;
  time: string;
  date: string;
  weekdays: number[];
  dayOfMonth: number;
  every: number;
  unit: "minutes" | "hours" | "days";
  startAt: string;
  expression: string;
  legacyOnce?: string;
}
export function scheduleEditorValue(trigger?: AutomationTrigger): ScheduleEditorValue {
  const today = new Date();
  const value: ScheduleEditorValue = {
    mode: "daily",
    time: "09:00",
    date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
    weekdays: [1],
    dayOfMonth: 1,
    every: 1,
    unit: "hours",
    startAt: "",
    expression: "0 9 * * 1",
  };
  if (!trigger) return value;
  if (trigger.kind === "calendar")
    return {
      ...value,
      mode: trigger.frequency,
      time: trigger.time,
      date: trigger.date ?? value.date,
      weekdays: trigger.weekdays ?? [1],
      dayOfMonth: trigger.dayOfMonth ?? 1,
    };
  if (trigger.kind === "interval") return { ...value, ...trigger, mode: "interval" };
  if (trigger.kind === "once") return { ...value, mode: "once", legacyOnce: trigger.at };
  if (trigger.kind === "webhook") return { ...value, mode: "webhook" };
  const [minute, hour, day, month, week, ...extra] = trigger.expression.trim().split(/\s+/);
  if (!extra.length && /^\d+$/.test(minute!) && /^\d+$/.test(hour!) && month === "*") {
    value.time = `${hour!.padStart(2, "0")}:${minute!.padStart(2, "0")}`;
    if (day === "*") {
      if (week === "*") return value;
      if (week === "1-5") return { ...value, mode: "weekdays" };
      if (/^[0-7](,[0-7])*$/.test(week!))
        return {
          ...value,
          mode: "weekly",
          weekdays: [
            ...new Set(
              week!
                .split(",")
                .map(Number)
                .map((n) => n % 7),
            ),
          ],
        };
    } else if (week === "*" && /^\d+$/.test(day!))
      return { ...value, mode: "monthly", dayOfMonth: Number(day) };
  }
  return { ...value, mode: "custom", expression: trigger.expression };
}
export function editorTrigger(v: ScheduleEditorValue): AutomationTrigger {
  if (v.mode === "custom") return { kind: "cron", expression: v.expression };
  if (v.mode === "webhook") return { kind: "webhook" };
  if (v.mode === "interval") {
    if (!Number.isInteger(v.every) || v.every < 1 || v.every > 525600)
      throw Error("执行间隔须为 1 至 525600 的整数。");
    return {
      kind: "interval",
      every: v.every,
      unit: v.unit,
      startAt:
        v.startAt ||
        new Date(
          Date.now() + v.every * { minutes: 60000, hours: 3600000, days: 86400000 }[v.unit],
        ).toISOString(),
    };
  }
  if (v.mode === "once" && v.legacyOnce) return { kind: "once", at: v.legacyOnce };
  if (v.mode === "weekly" && !v.weekdays.length) throw Error("请至少选择一天。");
  return {
    kind: "calendar",
    frequency: v.mode,
    time: v.time,
    ...(v.mode === "once" ? { date: v.date } : {}),
    ...(v.mode === "weekly" ? { weekdays: v.weekdays } : {}),
    ...(v.mode === "monthly" ? { dayOfMonth: v.dayOfMonth } : {}),
  };
}
export function describeAutomationSchedule(trigger: AutomationTrigger): string {
  if (trigger.kind === "interval")
    return `每隔 ${trigger.every} ${{ minutes: "分钟", hours: "小时", days: "天" }[trigger.unit]}`;
  if (trigger.kind === "once") return new Date(trigger.at).toLocaleString();
  const v = scheduleEditorValue(trigger);
  if (v.mode === "webhook") return "收到事件时执行";
  if (v.mode === "custom") return "自定义时间规则";
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${v.mode === "once" ? v.date : v.mode === "daily" ? "每天" : v.mode === "weekdays" ? "每个工作日" : v.mode === "weekly" ? `每${v.weekdays.map((d) => days[d]).join("、")}` : `每月 ${v.dayOfMonth} 日`} ${v.time}`;
}
