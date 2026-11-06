import { buildTaskGraph } from './graph.js';
import { shouldDelegate } from './delegate.js';
import { inferTasks } from './infer.js';
import type { PlanItem } from './infer.js';
import type { DelegationSuggestion, TaskNode, WorkSessionAnalysis } from './types.js';

/** Analyzes the run's plan: graph, delegation suggestions, and tasks to keep. */
export function analyzeWorkSession(plan: { revision: number; items: readonly PlanItem[] } | { revision: number; nodes: readonly TaskNode[] }): WorkSessionAnalysis {
  const graph = buildTaskGraph('nodes' in plan ? plan.nodes : inferTasks(plan.items));
  const suggestions: DelegationSuggestion[] = [];
  const keep: WorkSessionAnalysis['keep'] = [];
  const open = (id: string): boolean => graph.nodes.find(node => node.id === id)?.status !== 'completed';
  // An in-progress task is already being done here; only planned or blocked work is offered.
  for (const node of graph.nodes.filter(item => item.status === 'planned' || item.status === 'blocked')) {
    const decision = shouldDelegate(node, graph);
    if (decision.shouldDelegate) suggestions.push({ taskId: node.id, title: node.title, mode: decision.mode, rule: decision.rule, reason: decision.reason, after: node.dependsOn.filter(open) });
    else if (decision.rule === 'keep') keep.push({ taskId: node.id, title: node.title, reason: decision.reason });
  }
  return { revision: plan.revision, graph, suggestions, keep };
}
