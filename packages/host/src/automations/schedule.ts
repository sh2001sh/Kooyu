import { CronExpressionParser } from "cron-parser";
import { KodoError, type AutomationInput } from "@kodo/protocol";
type Schedule = Pick<AutomationInput, "trigger" | "timeZone">;
function calendarExpression(t: Extract<AutomationInput["trigger"], { kind: "calendar" }>) {
  const [hour, minute] = t.time.split(":");
  if (t.frequency === "weekly" && !t.weekdays?.length) throw new Error("请选择每周执行的星期。");
  if (t.frequency === "monthly" && !t.dayOfMonth) throw new Error("请选择每月执行日期。");
  if (t.frequency === "once") {
    if (!t.date) throw new Error("请选择执行日期。");
    const date = new Date(t.date + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== t.date)
      throw new Error("执行日期无效。");
    return `${minute} ${hour} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
  }
  return `${minute} ${hour} ${t.frequency === "monthly" ? t.dayOfMonth : "*"} * ${t.frequency === "weekly" ? [...new Set(t.weekdays)].sort().join(",") : t.frequency === "weekdays" ? "1-5" : "*"}`;
}
function calendarOnce(
  p: Schedule & { trigger: Extract<AutomationInput["trigger"], { kind: "calendar" }> },
) {
  const t = p.trigger;
  const occurrence = CronExpressionParser.parse(calendarExpression(t), {
    currentDate: new Date(Date.parse(t.date + "T00:00:00Z") - 2 * 86400000),
    tz: p.timeZone,
  })
    .next()
    .toDate();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: p.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(occurrence)
    .replace(" ", "T");
  if (parts !== `${t.date}T${t.time}`)
    throw new KodoError("INVALID_INPUT", "该时区中不存在所选时间，请重新选择。");
  return occurrence.toISOString();
}
export function validateSchedule(p: Schedule) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: p.timeZone }).format();
    if (p.trigger.kind === "cron") {
      if (p.trigger.expression.trim().split(/\s+/).length !== 5)
        throw new Error("仅支持五段 cron（分钟 小时 日期 月 星期）");
      CronExpressionParser.parse(p.trigger.expression, { tz: p.timeZone });
    }
    if (p.trigger.kind === "calendar") {
      CronExpressionParser.parse(calendarExpression(p.trigger), { tz: p.timeZone });
      if (p.trigger.frequency === "once") calendarOnce({ ...p, trigger: p.trigger });
    }
  } catch (e) {
    throw new KodoError("INVALID_INPUT", e instanceof Error ? e.message : "时间或时区无效。");
  }
}
export function nextOccurrence(p: Schedule, after: Date): string | null {
  validateSchedule(p);
  if (p.trigger.kind === "webhook") return null;
  if (p.trigger.kind === "once")
    return Date.parse(p.trigger.at) > after.getTime() ? new Date(p.trigger.at).toISOString() : null;
  if (p.trigger.kind === "interval") {
    const duration =
      p.trigger.every * { minutes: 60000, hours: 3600000, days: 86400000 }[p.trigger.unit];
    const start = Date.parse(p.trigger.startAt);
    const next =
      start > after.getTime()
        ? start
        : start + (Math.floor((after.getTime() - start) / duration) + 1) * duration;
    if (!Number.isFinite(next) || next > 8.64e15)
      throw new KodoError("INVALID_INPUT", "间隔超出可用日期范围。");
    return new Date(next).toISOString();
  }
  if (p.trigger.kind === "calendar" && p.trigger.frequency === "once") {
    const time = calendarOnce({ ...p, trigger: p.trigger });
    return Date.parse(time) > after.getTime() ? time : null;
  }
  const expression = CronExpressionParser.parse(
    p.trigger.kind === "cron" ? p.trigger.expression : calendarExpression(p.trigger),
    {
      currentDate: after,
      tz: p.timeZone,
    },
  );
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: p.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 1000; i++) {
    const candidate = expression.next().toDate();
    // cron-parser shifts missing wall times; our policy skips them instead.
    if (!expression.includesDate(candidate)) continue;
    const wall = fmt.format(candidate);
    // Fall-back duplicate: only the earlier physical instant may run, even after a restart.
    let duplicate = false;
    for (let offset = 15; offset <= 180; offset += 15)
      if (fmt.format(new Date(candidate.getTime() - offset * 60000)) === wall) {
        duplicate = true;
        break;
      }
    if (!duplicate) return candidate.toISOString();
  }
  throw new KodoError("INVALID_INPUT", "无法计算下次计划时间。");
}
export function previewSchedule(p: Schedule, after = new Date(), count = 3) {
  const times: string[] = [];
  let cursor = after;
  for (let i = 0; i < count; i++) {
    const t = nextOccurrence(p, cursor);
    if (!t) break;
    times.push(t);
    cursor = new Date(t);
  }
  return times;
}
