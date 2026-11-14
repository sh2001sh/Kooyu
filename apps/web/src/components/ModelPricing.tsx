import { useState } from "react";
import type { ModelPricing } from "@kodo/protocol";

const priceFields = [
  ["input", "输入价格", "输入"],
  ["output", "输出价格", "输出"],
  ["cacheRead", "缓存读取价格", "缓存读取"],
  ["cacheWrite", "缓存写入价格", "缓存写入"],
  ["reasoning", "思考 Token 价格", "思考"],
  ["perRequest", "每次请求价格", "按次"],
] as const;
type PriceField = (typeof priceFields)[number][0];
type RatesDraft = Record<PriceField, string>;
type TierDraft = RatesDraft & { upToInputTokens: string };
export type PricingDraft = {
  rates: RatesDraft;
  billingMode: NonNullable<ModelPricing["billingMode"]> | "auto";
  tierMode: "auto" | "custom" | "off";
  tiers: TierDraft[];
};
const ratesDraft = (p?: ModelPricing): RatesDraft => ({
  input: p?.input?.toString() ?? "",
  output: p?.output?.toString() ?? "",
  cacheRead: p?.cacheRead?.toString() ?? "",
  cacheWrite: p?.cacheWrite?.toString() ?? "",
  reasoning: p?.reasoning?.toString() ?? "",
  perRequest: p?.perRequest?.toString() ?? "",
});
export function usePricingDraft(overrides?: ModelPricing, automatic?: ModelPricing) {
  return useState<PricingDraft>(() => ({
    rates: ratesDraft(overrides),
    billingMode: overrides?.billingMode ?? "auto",
    tierMode: overrides?.tiers === undefined ? "auto" : overrides.tiers.length ? "custom" : "off",
    tiers: (overrides?.tiers ?? automatic?.tiers ?? []).map((tier) => ({
      ...ratesDraft(tier),
      upToInputTokens: tier.upToInputTokens?.toString() ?? "",
    })),
  }));
}
function readRates(draft: RatesDraft): ModelPricing {
  const rates: ModelPricing = {};
  for (const [key, label] of priceFields) {
    if (!draft[key].trim()) continue;
    const value = Number(draft[key]);
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`${label}必须是大于或等于 0 的数字。`);
    rates[key] = value;
  }
  return rates;
}
export function readPricingDraft(draft: PricingDraft): ModelPricing | undefined {
  const pricing = readRates(draft.rates);
  if (draft.billingMode !== "auto") pricing.billingMode = draft.billingMode;
  if (draft.tierMode === "off") pricing.tiers = [];
  if (draft.tierMode === "custom") {
    if (!draft.tiers.length) throw new Error("请至少添加一个价格阶梯，或选择不使用阶梯。");
    let previous = 0;
    pricing.tiers = draft.tiers.map((tier, index) => {
      const rates = readRates(tier);
      if (!tier.upToInputTokens.trim()) {
        if (index !== draft.tiers.length - 1)
          throw new Error("只有最后一档可以不设输入 Token 上限。");
        return rates;
      }
      const upper = Number(tier.upToInputTokens);
      if (!Number.isSafeInteger(upper) || upper <= previous)
        throw new Error("阶梯的输入 Token 上限必须是递增的正整数。");
      previous = upper;
      return { ...rates, upToInputTokens: upper };
    });
  }
  return Object.keys(pricing).length ? pricing : undefined;
}
const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 12 })}`;

export function ModelPricingSummary({ pricing: p }: { pricing?: ModelPricing }) {
  const requestOnly =
    p?.billingMode === "request" ||
    (p?.billingMode === undefined &&
      p?.perRequest !== undefined &&
      !priceFields.some(([key]) => key !== "perRequest" && p[key] !== undefined));
  return (
    <div className="model-price-summary">
      {priceFields
        .filter(([key]) =>
          requestOnly
            ? key === "perRequest"
            : key === "input" || key === "output" || p?.[key] !== undefined,
        )
        .map(([key, , label]) => (
          <span key={key}>
            {label} {p?.[key] === undefined ? "未确认" : usd(p[key])}
            {key === "perRequest" ? " / 次" : ""}
          </span>
        ))}
      <small>
        {requestOnly ? "按次计费 · USD / 次" : "参考价 · USD / 百万 Token"}
        {p?.billingMode === "hybrid" ? " · 另加每次请求费用" : ""}
      </small>
      {Boolean(p?.tiers?.length) && (
        <details className="model-price-tiers">
          <summary>阶梯计价 · {p!.tiers!.length} 档</summary>
          <p>按单次请求总输入（含缓存）选档；该档价格适用于整次请求，留空项沿用基础价。</p>
          <ol>
            {p!.tiers!.map((tier, index) => (
              <li key={index}>
                <strong>
                  {index > 0 ? `>${p!.tiers![index - 1]!.upToInputTokens!.toLocaleString()}，` : ""}
                  {tier.upToInputTokens === undefined
                    ? "无上限"
                    : `≤${tier.upToInputTokens.toLocaleString()}`}{" "}
                  输入 Token
                </strong>
                <div>
                  {priceFields
                    .filter(([key]) => tier[key] !== undefined)
                    .map(([key, , label]) => (
                      <span key={key}>
                        {label} {usd(tier[key]!)}
                        {key === "perRequest" ? " / 次" : " / 百万 Token"}
                      </span>
                    ))}
                  {!priceFields.some(([key]) => tier[key] !== undefined) && <span>沿用基础价</span>}
                </div>
              </li>
            ))}
          </ol>
          {p!.tiers!.at(-1)?.upToInputTokens !== undefined && (
            <p>超过最后一档上限时，价格未确认，不估算费用。</p>
          )}
        </details>
      )}
    </div>
  );
}

export function ModelPricingEditor({
  draft,
  onChange,
  automatic,
  disabled = false,
}: {
  draft: PricingDraft;
  onChange: (value: PricingDraft) => void;
  automatic?: ModelPricing;
  disabled?: boolean;
}) {
  const changeTier = (index: number, patch: Partial<TierDraft>) =>
    onChange({
      ...draft,
      tiers: draft.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)),
    });
  return (
    <fieldset className="model-pricing-editor" disabled={disabled}>
      <legend>价格配置</legend>
      <p className="provider-help">
        Token 单价为 USD / 百万 Token；按次单价为 USD / 次请求。留空沿用自动值，0
        表示免费。仅用于估算，账单以 Provider 为准。
      </p>
      <label>
        计费方式
        <select
          aria-label="计费方式"
          value={draft.billingMode}
          onChange={(e) =>
            onChange({ ...draft, billingMode: e.target.value as PricingDraft["billingMode"] })
          }
        >
          <option value="auto">
            自动
            {automatic?.billingMode === "request"
              ? "：按次"
              : automatic?.billingMode === "hybrid"
                ? "：Token 加按次"
                : ""}
          </option>
          <option value="tokens">按 Token 计费</option>
          <option value="request">按次计费</option>
          <option value="hybrid">Token 费用 + 每次请求费用</option>
        </select>
      </label>
      <div className="model-pricing-grid">
        {priceFields.map(([key, label]) => (
          <label key={key}>
            {label}
            <small>{key === "perRequest" ? "USD / 次" : "USD / 百万 Token"}</small>
            <input
              aria-label={label}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={draft.rates[key]}
              placeholder={automatic?.[key]?.toString() ?? "未确认"}
              onChange={(e) =>
                onChange({ ...draft, rates: { ...draft.rates, [key]: e.target.value } })
              }
            />
            <small>自动值：{automatic?.[key] ?? "未确认"}</small>
          </label>
        ))}
      </div>
      <label>
        阶梯计价
        <select
          aria-label="阶梯计价"
          value={draft.tierMode}
          onChange={(e) => {
            const tierMode = e.target.value as PricingDraft["tierMode"];
            onChange({
              ...draft,
              tierMode,
              tiers:
                tierMode === "custom" && !draft.tiers.length
                  ? [{ ...ratesDraft(), upToInputTokens: "" }]
                  : draft.tiers,
            });
          }}
        >
          <option value="auto">
            沿用自动阶梯
            {automatic?.tiers?.length ? `（${automatic.tiers.length} 档）` : "（未配置）"}
          </option>
          <option value="custom">手动设置阶梯</option>
          <option value="off">不使用阶梯</option>
        </select>
      </label>
      {draft.tierMode === "custom" && (
        <>
          <p className="provider-help">
            按单次请求总输入
            Token（含缓存）选档，整次请求采用该档价格；不累计分段。上限依次递增，最后一档留空表示无上限。价格留空沿用基础价。
          </p>
          {draft.tiers.map((tier, index) => (
            <fieldset className="model-pricing-tier" key={index}>
              <legend>第 {index + 1} 档</legend>
              <label>
                输入 Token 上限（含）
                <input
                  aria-label={`第 ${index + 1} 档输入 Token 上限`}
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={tier.upToInputTokens}
                  placeholder={index === draft.tiers.length - 1 ? "无上限" : "请填写上限"}
                  onChange={(e) => changeTier(index, { upToInputTokens: e.target.value })}
                />
              </label>
              <div className="model-pricing-grid">
                {priceFields.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <small>{key === "perRequest" ? "USD / 次" : "USD / 百万 Token"}</small>
                    <input
                      aria-label={`第 ${index + 1} 档${label}`}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={tier[key]}
                      placeholder={draft.rates[key] || automatic?.[key]?.toString() || "沿用基础价"}
                      onChange={(e) => changeTier(index, { [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                aria-label={`移除第 ${index + 1} 档`}
                onClick={() =>
                  onChange({ ...draft, tiers: draft.tiers.filter((_, i) => i !== index) })
                }
              >
                移除此阶梯
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={draft.tiers.length >= 32}
            onClick={() =>
              onChange({
                ...draft,
                tiers: [...draft.tiers, { ...ratesDraft(), upToInputTokens: "" }],
              })
            }
          >
            添加价格阶梯
          </button>
        </>
      )}
    </fieldset>
  );
}
