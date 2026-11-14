import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { CatalogModel } from "@kodo/protocol";
import { api } from "../../lib/host-client";

export function SetupModel({
  model: m,
  busy,
  run,
  onSave,
  onUpdated,
}: {
  model: CatalogModel;
  busy: boolean;
  run: (work: () => Promise<void>) => Promise<void>;
  onSave: (model: CatalogModel) => Promise<void>;
  onUpdated: () => Promise<void>;
}) {
  const p = m.effective;
  const [context, setContext] = useState(p.contextWindow?.toString() ?? "");
  const [output, setOutput] = useState(p.maxOutputTokens?.toString() ?? "");
  const [input, setInput] = useState(p.input ? (p.input.includes("image") ? "image" : "text") : "");
  const [reasoning, setReasoning] = useState(
    p.reasoning === undefined ? "" : p.reasoning ? "yes" : "no",
  );
  const missing = !p.contextWindow || !p.maxOutputTokens || !p.input || p.reasoning === undefined;
  const [editing, setEditing] = useState(Boolean(missing));
  return (
    <form
      className="setup-model"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          let selected = m;
          if (editing) {
            selected = await api<CatalogModel>("/provider-models", "POST", {
              id: m.id,
              expectedRevision: m.revision,
              providerId: m.providerId,
              endpointId: m.endpointId,
              model: m.model,
              requestId: crypto.randomUUID(),
              overrides: {
                ...m.overrides,
                contextWindow: Number(context),
                maxOutputTokens: Number(output),
                input: input === "image" ? ["text", "image"] : ["text"],
                reasoning: reasoning === "yes",
              },
            });
            await onUpdated();
          }
          await onSave(selected);
        });
      }}
    >
      <div className="setup-model-info">
        <strong>{missing ? "这个模型还缺少能力参数" : "主模型参数"}</strong>
        <p>
          {missing
            ? "请从服务商文档确认后填写，Kooyu 不会替未知参数猜默认值。"
            : "上下文 " +
              p.contextWindow!.toLocaleString() +
              " · 最大输出 " +
              p.maxOutputTokens!.toLocaleString() +
              " tokens"}
        </p>
        {!missing && (
          <button type="button" className="setup-text-button" onClick={() => setEditing(!editing)}>
            {editing ? "使用已保存参数" : "查看或修改能力参数"}
          </button>
        )}
      </div>
      <fieldset disabled={busy} className="setup-fields">
        {editing && (
          <div className="setup-parameter-grid">
            <label>
              上下文窗口（tokens）
              <input
                type="number"
                min={1}
                max={Number.MAX_SAFE_INTEGER}
                step={1}
                required
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </label>
            <label>
              最大输出（tokens）
              <input
                type="number"
                min={1}
                max={Number.MAX_SAFE_INTEGER}
                step={1}
                required
                value={output}
                onChange={(e) => setOutput(e.target.value)}
              />
            </label>
            <label>
              输入能力
              <select required value={input} onChange={(e) => setInput(e.target.value)}>
                <option value="">请选择</option>
                <option value="text">文本</option>
                <option value="image">文本与图片</option>
              </select>
            </label>
            <label>
              思考能力
              <select required value={reasoning} onChange={(e) => setReasoning(e.target.value)}>
                <option value="">请选择</option>
                <option value="no">不支持</option>
                <option value="yes">支持</option>
              </select>
            </label>
          </div>
        )}
        <div className="setup-footer">
          <span className="setup-help">仅作为主 Agent 的新对话默认配置</span>
          <button className="primary" disabled={busy}>
            {busy ? "正在保存…" : "使用此模型，继续"}
            <ArrowRight size={15} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}
