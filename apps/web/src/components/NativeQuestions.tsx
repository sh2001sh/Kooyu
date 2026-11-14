import { useId, useState } from "react";

type Wire = Record<string, any>;
type Question = {
  key: string;
  text: string;
  body?: string;
  options: { label: string; description?: string; id?: string }[];
  multiple: boolean;
  custom: boolean;
  secret: boolean;
};
export function nativeQuestions(payload: Wire): Question[] | null {
  const claude = payload.protocol === "claude" && payload.toolName === "AskUserQuestion";
  const codex = payload.protocol === "codex" && payload.method === "item/tool/requestUserInput";
  const opencode = payload.protocol === "opencode" && payload.type === "question.asked";
  const kimi = payload.protocol === "kimi" && payload.method === "question/request";
  if (!claude && !codex && !opencode && !kimi) return null;
  const questions = (claude ? payload.input : payload.params)?.questions;
  if (!Array.isArray(questions) || !questions.length || questions.length > 20) return null;
  const normalized: Question[] = [];
  for (const [index, q] of questions.entries()) {
    if (
      !q ||
      typeof q.question !== "string" ||
      ((codex || kimi) && (typeof q.id !== "string" || !q.id))
    )
      return null;
    const options = q.options ?? [];
    if (
      !Array.isArray(options) ||
      options.length > 100 ||
      options.some(
        (o: Wire) =>
          !o || typeof o.label !== "string" || (kimi && (typeof o.id !== "string" || !o.id)),
      ) ||
      new Set(options.map((o: Wire) => (kimi ? o.id : o.label))).size !== options.length
    )
      return null;
    const key = codex || kimi ? q.id : claude ? q.question : String(index);
    if (normalized.some((item) => item.key === key)) return null;
    normalized.push({
      key,
      text: q.question,
      ...(kimi && typeof q.body === "string" ? { body: q.body } : {}),
      options,
      multiple: claude
        ? q.multiSelect === true
        : kimi
          ? q.multi_select === true
          : opencode && q.multiple === true,
      custom:
        !options.length ||
        (codex
          ? q.isOther === true
          : kimi
            ? q.allow_other === true
            : opencode
              ? q.custom !== false
              : true),
      secret: codex && q.isSecret === true,
    });
  }
  return normalized;
}

export function NativeQuestions({
  payload,
  questions,
  reply,
  disabled,
  onToggleCustom,
}: {
  payload: Wire;
  questions: Question[];
  reply: (answer: unknown) => Promise<unknown>;
  disabled: boolean;
  onToggleCustom?: () => void;
  isCustom?: boolean;
}) {
  const id = useId();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const kimi = payload.protocol === "kimi";
  const answers = questions.map((_q, index) =>
    custom[index]?.trim() ? [custom[index]!.trim()] : (selected[index] ?? []),
  );
  const ready = answers.every((answer, index) => answer.length > 0 || (kimi && skipped[index]));
  const submit = () => {
    if (!ready || disabled) return;
    const answer = kimi
      ? {
          answers: Object.fromEntries(
            questions.map((q, index) => {
              const text = custom[index]?.trim(),
                ids = selected[index] ?? [];
              return [
                q.key,
                skipped[index]
                  ? { kind: "skipped" }
                  : text
                    ? q.multiple && ids.length
                      ? { kind: "multi_with_other", option_ids: ids, other_text: text }
                      : { kind: "other", text }
                    : q.multiple
                      ? { kind: "multi", option_ids: ids }
                      : { kind: "single", option_id: ids[0] },
              ];
            }),
          ),
          method: "click",
        }
      : payload.protocol === "opencode"
        ? { answers }
        : payload.protocol === "codex"
          ? {
              answers: Object.fromEntries(
                questions.map((q, i) => [q.key, { answers: answers[i] }]),
              ),
            }
          : {
              behavior: "allow",
              updatedInput: {
                answers: Object.fromEntries(
                  questions.map((q, i) => [q.key, answers[i]!.join(", ")]),
                ),
              },
            };
    void reply(answer);
  };
  return (
    <div className="interaction__questions">
      {questions.map((q, index) => (
        <fieldset key={q.key} disabled={disabled} className="interaction__question">
          <legend className="interaction__question-title">
            <span>{q.text}</span>
            <span className="interaction__badge">{q.multiple ? "可多选" : "单选"}</span>
          </legend>
          {q.body && <p className="interaction__choice-desc">{q.body}</p>}
          <div className="interaction__choices">
            {q.options.map((option) => {
              const value = kimi ? option.id! : option.label;
              const isSelected =
                !skipped[index] &&
                (selected[index] ?? []).includes(value) &&
                ((kimi && q.multiple) || !custom[index]?.trim());
              return (
                <label
                  key={value}
                  className={`interaction__choice ${isSelected ? "is-selected" : ""}`}
                >
                  <input
                    type={q.multiple ? "checkbox" : "radio"}
                    name={id + "-" + index}
                    checked={isSelected}
                    disabled={disabled || skipped[index]}
                    onChange={(e) => {
                      if (!kimi || !q.multiple) setCustom((values) => ({ ...values, [index]: "" }));
                      setSelected((values) => ({
                        ...values,
                        [index]: q.multiple
                          ? e.target.checked
                            ? [...(values[index] ?? []), value]
                            : (values[index] ?? []).filter((v) => v !== value)
                          : [value],
                      }));
                    }}
                  />
                  <div className="interaction__choice-content">
                    <span className="interaction__choice-label">{option.label}</span>
                    {typeof option.description === "string" && (
                      <small className="interaction__choice-desc">{option.description}</small>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          {q.custom && (
            <label className="interaction__free-answer">
              <span className="interaction__free-answer-label">
                {q.options.length ? "其他回答" : "你的回答"}
              </span>
              <input
                type={q.secret ? "password" : "text"}
                autoComplete="off"
                aria-label={q.text + (q.options.length ? "：其他回答" : "：你的回答")}
                value={custom[index] ?? ""}
                disabled={disabled || skipped[index]}
                placeholder={q.options.length ? "输入其他回答..." : "输入你的回答..."}
                onChange={(e) => setCustom((values) => ({ ...values, [index]: e.target.value }))}
              />
            </label>
          )}
          {kimi && (
            <button
              type="button"
              className="quiet-btn"
              aria-pressed={Boolean(skipped[index])}
              onClick={() => setSkipped((values) => ({ ...values, [index]: !values[index] }))}
            >
              {skipped[index] ? "继续回答" : "跳过此题"}
            </button>
          )}
        </fieldset>
      ))}
      <div className="actions interaction__actions">
        <button type="button" className="primary" disabled={!ready || disabled} onClick={submit}>
          {disabled ? "正在提交…" : "提交回答"}
        </button>
        {payload.protocol !== "codex" && (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              void reply(payload.protocol === "claude" ? { behavior: "deny" } : { cancelled: true })
            }
          >
            取消回答
          </button>
        )}
        {onToggleCustom && (
          <button
            type="button"
            className="quiet-btn interaction__json-toggle"
            disabled={disabled}
            onClick={onToggleCustom}
          >
            结构化回答
          </button>
        )}
      </div>
    </div>
  );
}
