/** Presentation only: never changes the model's stored message or future context. */
export interface AssistantContent {
  text: string;
  thinking: string;
}

export function isThinkingChannel(value: unknown): boolean {
  return (
    value === "thought" || value === "analysis" || value === "reasoning" || value === "thinking"
  );
}

/** Only leading protocol wrappers are interpreted; quoted examples/code stay literal. */
export function splitAssistantText(text: string): AssistantContent {
  let rest = text.trimStart();
  const thoughts: string[] = [];
  let wrapped = false;
  while (true) {
    const open = /^<(analysis|think|thinking)>/i.exec(rest);
    if (!open) break;
    wrapped = true;
    rest = rest.slice(open[0].length);
    const close = new RegExp(`</${open[1]}>`, "i").exec(rest);
    if (!close) return { text: "", thinking: [...thoughts, rest].filter(Boolean).join("\n\n") };
    thoughts.push(rest.slice(0, close.index).trim());
    rest = rest.slice(close.index + close[0].length).trimStart();
  }
  // A streamed opening tag may span events. Do not flash it as an answer.
  const opening = rest.toLowerCase();
  if (
    opening.startsWith("<") &&
    ["<analysis>", "<think>", "<thinking>", "<final>"].some((tag) => tag.startsWith(opening))
  )
    return { text: "", thinking: thoughts.filter(Boolean).join("\n\n") };
  if (/^<final>/i.test(rest)) {
    wrapped = true;
    rest = rest.replace(/^<final>/i, "").replace(/<\/final>\s*$/i, "");
    const tagStart = rest.lastIndexOf("<");
    if (tagStart >= 0 && "</final>".startsWith(rest.slice(tagStart).toLowerCase()))
      rest = rest.slice(0, tagStart);
  }
  return { text: wrapped ? rest.trim() : text, thinking: thoughts.filter(Boolean).join("\n\n") };
}

/** Separate native reasoning blocks/channels and relay wrappers from answer text. */
export function assistantContent(payload: unknown): AssistantContent {
  if (typeof payload === "string") return splitAssistantText(payload);
  if (!payload || typeof payload !== "object") return { text: "", thinking: "" };
  const p = payload as Record<string, any>;
  if (p.message && p.text === undefined && p.content === undefined)
    return assistantContent(p.message);
  const thoughts: string[] = [];
  const text =
    typeof p.text === "string"
      ? p.text
      : typeof p.content === "string"
        ? p.content
        : Array.isArray(p.content)
          ? p.content
              .flatMap((block: Record<string, any>) => {
                if (!block || typeof block !== "object") return [];
                if (isThinkingChannel(block.type) || isThinkingChannel(block.channel)) {
                  const value = block.thinking ?? block.text;
                  if (typeof value === "string") thoughts.push(value);
                  return [];
                }
                return ["text", "output_text"].includes(block.type) &&
                  typeof block.text === "string"
                  ? [block.text]
                  : [];
              })
              .join("\n")
          : "";
  if (typeof p.reasoning_content === "string") thoughts.push(p.reasoning_content);
  if (isThinkingChannel(p.channel) || isThinkingChannel(p.type))
    return {
      text: "",
      thinking: [...thoughts, text || p.thinking || ""].filter(Boolean).join("\n\n"),
    };
  const split = splitAssistantText(text);
  return { text: split.text, thinking: [...thoughts, split.thinking].filter(Boolean).join("\n\n") };
}
