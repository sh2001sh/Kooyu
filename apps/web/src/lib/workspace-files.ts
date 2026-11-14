import type { RuntimeEvent } from "@kodo/protocol";

/** An older detached Host can keep serving the newly built UI until it is restarted. */
export function workspaceErrorMessage(error: unknown): string {
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === "NOT_FOUND" && value.message === "接口不存在。")
    return "当前 Host 仍是旧版本，尚未加载文件与改动接口。刷新或关闭界面不会重启 Host；请先处理活动任务，再重启 Host。";
  return String(value?.message ?? error);
}

/** File links stay inside the authenticated Host. The Host validates workspace containment. */
export function workspaceLinkPath(href: string | undefined): string | null {
  if (!href || /^(?:https?:|mailto:|tel:|#|\/\/)/i.test(href)) return null;
  let path = href;
  if (/^file:\/\//i.test(path))
    path = path.replace(/^file:\/\/(?:localhost)?/i, "").replace(/^\/([a-z]:)/i, "$1");
  else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
  try {
    path = decodeURIComponent(path.split(/[?#]/)[0]!);
  } catch {
    return null;
  }
  path = path.replace(/(?::\d+)(?::\d+)?$/, "");
  return path && (/[/\\]/.test(path) || /\.[a-z\d]{1,12}$/i.test(path)) ? path : null;
}

/** Evidence of involvement, not proof of authorship. Native tools differ across harnesses. */
export function involvedFiles(events: RuntimeEvent[]): string[] {
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.length < 4096 && !value.includes("\n")) paths.add(value);
  };
  for (const event of events) {
    if (event.type !== "tool" && event.type !== "subagent") continue;
    const p = event.payload as Record<string, any>;
    if (!p || typeof p !== "object") continue;
    const tool = p.event?.type === "tool" ? p.event.payload : p;
    add(tool?.input?.file_path);
    add(tool?.input?.path);
    add(tool?.args?.path);
    add(tool?.arguments?.file_path);
    add(tool?.arguments?.path);
    for (const change of Array.isArray(tool?.changes) ? tool.changes : []) add(change?.path);
    for (const location of Array.isArray(tool?.locations) ? tool.locations : [])
      add(location?.path);
  }
  return [...paths].slice(-200).reverse();
}
