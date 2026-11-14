import type { HarnessModelOption, ModelParameter, ModelPricing } from "@kodo/protocol";

const usd = (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 12 });
export function formatPricing(p: ModelPricing): string {
  const parts = [
    p.input !== undefined ? `输入 ${usd(p.input)}` : "",
    p.output !== undefined ? `输出 ${usd(p.output)}` : "",
    p.cacheRead !== undefined ? `缓存读 ${usd(p.cacheRead)}` : "",
    p.cacheWrite !== undefined ? `缓存写 ${usd(p.cacheWrite)}` : "",
    p.reasoning !== undefined ? `思考 ${usd(p.reasoning)}` : "",
  ].filter(Boolean);
  if (p.billingMode === "request")
    return p.perRequest !== undefined ? `${usd(p.perRequest)} / 次` : "按次计费 · 价格未确认";
  return (
    [
      parts.length ? `${parts.join(" · ")} / 1M tokens` : "",
      p.perRequest !== undefined ? `${usd(p.perRequest)} / 次` : "",
      p.tiers?.length ? `阶梯计价（${p.tiers.length} 档）` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "未公开"
  );
}

export function ModelParameters({ model }: { model?: HarnessModelOption }) {
  const fields: [ModelParameter, string][] = [
    ["contextWindow", "上下文窗口"],
    ["maxOutputTokens", "最大输出"],
    ["reasoning", "思考档位"],
    ["pricing", "价格"],
  ];
  return (
    <dl className="model-parameters" aria-label="模型自动参数">
      {fields.map(([field, label]) => {
        const value = model?.[field];
        const source = model?.parameterSources?.[field];
        const confirmed = source && value !== undefined;
        return (
          <div className="model-parameters__row" key={field}>
            <dt>{label}</dt>
            <dd>
              <span>
                {confirmed
                  ? Array.isArray(value)
                    ? value.length
                      ? value.join(" / ")
                      : "原生未提供可选档位"
                    : typeof value === "object"
                      ? formatPricing(value)
                      : `${value.toLocaleString("en-US")} tokens`
                  : field === "pricing"
                    ? "未公开"
                    : "参数未确认"}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
