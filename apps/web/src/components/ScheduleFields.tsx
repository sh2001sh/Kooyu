import { type ScheduleEditorValue, type ScheduleMode } from "@kodo/protocol";
import "../styles/work-center.css";
import { DateTimeSelection } from "./DateTimeSelection";
export function ScheduleFields({
  value: v,
  onChange,
  zone,
  onZoneChange,
}: {
  value: ScheduleEditorValue;
  onChange: (v: ScheduleEditorValue) => void;
  zone: string;
  onZoneChange: (s: string) => void;
}) {
  const set = (patch: Partial<ScheduleEditorValue>) => onChange({ ...v, ...patch });
  return (
    <div className="work-form schedule-fields">
      <label className="work-field">
        <span>执行频率</span>
        <select
          value={v.mode}
          onChange={(e) => set({ mode: e.target.value as ScheduleMode, legacyOnce: undefined })}
        >
          <option value="once">只执行一次</option>
          <option value="daily">每天</option>
          <option value="weekdays">周一至周五</option>
          <option value="weekly">每周</option>
          <option value="monthly">每月</option>
          <option value="interval">每隔一段时间</option>
          <option value="custom">高级：自定义规则</option>
          <option value="webhook">收到外部事件时</option>
        </select>
      </label>
      {v.mode === "interval" ? (
        <div className="work-grid">
          <label className="work-field">
            <span>每隔</span>
            <input
              type="number"
              min={1}
              max={525600}
              step={1}
              required
              value={v.every}
              onChange={(e) => set({ every: Number(e.target.value), startAt: "" })}
            />
          </label>
          <label className="work-field">
            <span>间隔单位</span>
            <select
              value={v.unit}
              onChange={(e) =>
                set({ unit: e.target.value as ScheduleEditorValue["unit"], startAt: "" })
              }
            >
              <option value="minutes">分钟</option>
              <option value="hours">小时</option>
              <option value="days">天</option>
            </select>
          </label>
          <p>新建或修改间隔后，等待一个间隔开始；“天”按 24 小时计算。</p>
        </div>
      ) : v.mode === "custom" ? (
        <label className="work-field">
          <span>自定义 cron 规则</span>
          <input
            required
            value={v.expression}
            onChange={(e) => set({ expression: e.target.value })}
          />
        </label>
      ) : (
        v.mode !== "webhook" && (
          <>
            {v.mode === "once" && v.legacyOnce ? (
              <p>
                原定时间：{new Date(v.legacyOnce).toLocaleString()}{" "}
                <button type="button" onClick={() => set({ legacyOnce: undefined })}>
                  重新选择日期和时间
                </button>
              </p>
            ) : (
              <>
                {v.mode === "once" && (
                  <label className="work-field">
                    <span>执行日期</span>
                    <DateTimeSelection
                      type="date"
                      required
                      value={v.date}
                      onChange={(e) => set({ date: e.target.value })}
                    />
                  </label>
                )}
                <label className="work-field">
                  <span>执行时间</span>
                  <DateTimeSelection
                    type="time"
                    required
                    value={v.time}
                    onChange={(e) => set({ time: e.target.value })}
                  />
                </label>
              </>
            )}
            {v.mode === "weekly" && (
              <fieldset>
                <legend>每周哪几天</legend>
                <div className="work-actions">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <label key={d}>
                      <input
                        type="checkbox"
                        checked={v.weekdays.includes(d)}
                        onChange={(e) =>
                          set({
                            weekdays: e.target.checked
                              ? [...v.weekdays, d]
                              : v.weekdays.filter((x) => x !== d),
                          })
                        }
                      />
                      {["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {v.mode === "monthly" && (
              <label className="work-field">
                <span>每月几号</span>
                <select
                  value={v.dayOfMonth}
                  onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}
                >
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1} 日
                    </option>
                  ))}
                </select>
                <small>当月没有该日期时跳过。</small>
              </label>
            )}
          </>
        )
      )}
      <details>
        <summary>时区 · {zone}</summary>
        <label className="work-field">
          <span>执行时区</span>
          <input
            required
            value={zone}
            onChange={(e) => onZoneChange(e.target.value)}
            list="schedule-timezones"
          />
          <datalist id="schedule-timezones">
            {[
              "Asia/Shanghai",
              "Asia/Tokyo",
              "America/Los_Angeles",
              "America/New_York",
              "Europe/London",
              "UTC",
            ].map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>
      </details>
    </div>
  );
}
