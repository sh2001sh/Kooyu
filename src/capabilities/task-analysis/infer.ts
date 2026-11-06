import type { TaskDuration, TaskNature, TaskNode, TaskStatus } from './types.js';

/** The plan item shape of `todo.write`; kept structural so this module stays storage-free. */
export interface PlanItem { id: string; content: string; status: 'pending' | 'in_progress' | 'completed'; title?: string; note?: string }

const long = /\b(tests?|test suite|integration|e2e|end-to-end|build|compile|benchmark|perf(?:ormance)?|load test|full (?:check|suite|run)|regression|ci)\b|测试|构建|编译|基准|压测|回归|全量/i;
const medium = /\b(investigate|explore|research|survey|review|audit|docs?|documentation|readme|changelog|scan|analy[sz]e)\b|调研|探索|审查|评审|审计|文档|分析|扫描/i;
const decision = /\b(design|decide|decision|choose|architecture|architect|trade-?offs?|api shape|approach)\b|设计|决定|决策|选型|架构|权衡|方案/i;
const independent = /\b(tests?|verify|verification|validate|review|audit|docs?|documentation|readme|changelog|benchmark|scan|investigate|explore|research|survey)\b|测试|验证|验收|审查|评审|审计|文档|基准|扫描|调研|探索/i;
const acceptance = /\b(pass(?:es|ing)?|green|exit 0|acceptance|criteria|all \d+|\d+ (?:cases|tests))\b|通过|验收|全部|用例/i;
const verification = /\b(tests?|verify|verification|validate|benchmark|build|lint|type-?check)\b|测试|验证|构建|基准/i;

/**
 * Explicit note tags override inference: `#quick|#medium|#long`,
 * `#sequential|#independent|#blocking`, `#decision`, `#no-decision`,
 * `#acceptance`, and `after:id1,id2` for dependencies.
 */
function tags(note: string | undefined): { duration?: TaskDuration; nature?: TaskNature; decision?: boolean; acceptance?: boolean; after?: string[] } {
  if (!note) return {};
  const has = (tag: string): boolean => new RegExp(`(?:^|\\s)#${tag}\\b`, 'i').test(note);
  const pick = <T extends string>(values: readonly T[]): T | undefined => values.find(value => has(value));
  const after = /(?:^|\s)(?:after|depends):([A-Za-z0-9_,-]+)/i.exec(note)?.[1];
  return {
    duration: pick(['quick', 'medium', 'long'] as const),
    nature: pick(['sequential', 'independent', 'blocking'] as const),
    decision: has('decision') ? true : has('no-decision') ? false : undefined,
    acceptance: has('acceptance') ? true : undefined,
    after: after?.split(',').filter(Boolean),
  };
}

const status = (value: PlanItem['status']): TaskStatus => value === 'pending' ? 'planned' : value;

/** Infers one node's characteristics from its text; dependencies are filled by `inferTasks`. */
export function inferTask(item: PlanItem, order: number): TaskNode & { explicitDependsOn?: string[] } {
  const text = [item.title, item.content].filter(Boolean).join(' ');
  const tagged = tags(item.note);
  const requiresDecision = tagged.decision ?? decision.test(text);
  const nature: TaskNature = tagged.nature ?? (requiresDecision ? 'blocking' : independent.test(text) ? 'independent' : 'sequential');
  return {
    id: item.id,
    title: item.title?.trim() || item.content.trim().slice(0, 160),
    estimatedDuration: tagged.duration ?? (long.test(text) ? 'long' : medium.test(text) ? 'medium' : 'quick'),
    nature,
    requiresDecision,
    clearAcceptance: tagged.acceptance ?? (acceptance.test(text) || verification.test(text)),
    dependsOn: [],
    status: status(item.status),
    order,
    ...(tagged.after ? { explicitDependsOn: tagged.after } : {}),
  };
}

/**
 * Plan items to task nodes. Without explicit `after:` tags, each task depends on the
 * nearest earlier non-independent task: verification and docs follow the work
 * before them, while tasks sharing that predecessor stay mutually parallel.
 */
export function inferTasks(items: readonly PlanItem[]): TaskNode[] {
  const nodes = items.map((item, index) => inferTask(item, index));
  const known = new Set(nodes.map(node => node.id));
  let anchor: string | undefined;
  return nodes.map(({ explicitDependsOn, ...node }) => {
    const dependsOn = explicitDependsOn ? explicitDependsOn.filter(id => known.has(id) && id !== node.id) : anchor ? [anchor] : [];
    if (node.nature !== 'independent') anchor = node.id;
    return { ...node, dependsOn: [...new Set(dependsOn)] };
  });
}
