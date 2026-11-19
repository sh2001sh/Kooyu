import type { Root, RootContent, PhrasingContent } from "mdast";
import { workspaceLinkPath } from "./workspace-files";

/** Recognize a whole file reference, not a command, URL, or code expression. */
function fileReference(value: string): boolean {
  const path = workspaceLinkPath(value);
  if (!path || /[\n\r<>|*?"`=]/.test(value) || /^(?:https?:|\/\/)/i.test(value)) return false;
  const withoutLine = path.replace(/\\/g, "/");
  // Spaces are useful within names, but a command before a relative path is not a filename.
  if (!/^(?:[a-z]:\/|\/|file:)/i.test(value) && /\s/.test(withoutLine.split("/")[0]!)) return false;
  return /(?:^|\/)(?:[^/]+\.[a-z][a-z\d]{0,11}|\.[a-z][\w.-]*|Dockerfile|Makefile)$/i.test(
    withoutLine,
  );
}

/** Add local links without rewriting Markdown, fenced code, or existing links. */
export function remarkFileLinks() {
  return (tree: Root) => {
    const visit = (parent: { children: RootContent[] | PhrasingContent[] }) => {
      const next: (RootContent | PhrasingContent)[] = [];
      for (const node of parent.children) {
        if (node.type === "inlineCode" && fileReference(node.value)) {
          next.push({ type: "link", url: node.value, children: [node] });
        } else if (node.type === "text") {
          // Unquoted paths require a clear boundary and no spaces; quoted paths above may have spaces.
          const pattern =
            /(?:^|(?<=[\s（(【[：:]))(?:[a-z]:[\\/]|\.?\.?[\\/])?[\p{L}\p{N}_.@-]+(?:[\\/][\p{L}\p{N}_.@-]+)+(?::\d+(?::\d+)?)?/giu;
          let start = 0;
          for (const match of node.value.matchAll(pattern)) {
            const value = match[0].replace(/[.,;]+$/, "");
            const end = match.index + value.length;
            if (!fileReference(value) || /[\w/@]/.test(node.value[end] ?? "")) continue;
            if (match.index > start)
              next.push({ type: "text", value: node.value.slice(start, match.index) });
            next.push({ type: "link", url: value, children: [{ type: "text", value }] });
            start = end;
          }
          if (start < node.value.length)
            next.push({ type: "text", value: node.value.slice(start) });
        } else {
          if ("children" in node && !["link", "linkReference"].includes(node.type)) visit(node);
          next.push(node);
        }
      }
      parent.children = next as typeof parent.children;
    };
    visit(tree);
  };
}
