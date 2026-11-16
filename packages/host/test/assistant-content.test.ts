import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantContent, splitAssistantText } from "@kodo/protocol/client";

test("assistant reasoning channels, native blocks and relay wrappers stay separate from final text", () => {
  for (const channel of ["analysis", "thought", "reasoning", "thinking"])
    assert.deepEqual(assistantContent({ channel, text: "思考" }), { text: "", thinking: "思考" });
  assert.deepEqual(
    assistantContent({
      content: [
        { type: "thinking", thinking: "原生思考" },
        { type: "text", text: "<analysis>补充分析</analysis>\n<final>最终回答</final>" },
      ],
    }),
    { text: "最终回答", thinking: "原生思考\n\n补充分析" },
  );
  assert.deepEqual(
    assistantContent({
      message: {
        content: [
          { type: "text", channel: "analysis", text: "通道分析" },
          { type: "output_text", text: "回答" },
        ],
      },
    }),
    { text: "回答", thinking: "通道分析" },
  );
  assert.deepEqual(assistantContent({ text: "回答", reasoning_content: "服务端分析" }), {
    text: "回答",
    thinking: "服务端分析",
  });
});

test("streamed analysis wrapper prefixes never flash as final text and preserve the answer suffix", () => {
  const text = "<analysis>先检查问题。</analysis>\n<final>修复完成。</final>";
  for (let i = 1; i <= text.indexOf("<final>"); i++) {
    assert.equal(splitAssistantText(text.slice(0, i)).text, "", `prefix ${i}`);
  }
  assert.deepEqual(splitAssistantText(text), { text: "修复完成。", thinking: "先检查问题。" });
  assert.deepEqual(splitAssistantText("<think>尚未结束"), { text: "", thinking: "尚未结束" });
});

test("literal tag examples, code fences and unwrapped prose are not stripped", () => {
  for (const text of [
    "解释 <analysis> 标记。",
    "```xml\n<analysis>示例</analysis>\n```",
    "  原始回答\n",
    "<analysis-mode>自定义内容",
  ])
    assert.deepEqual(splitAssistantText(text), { text, thinking: "" });
});
