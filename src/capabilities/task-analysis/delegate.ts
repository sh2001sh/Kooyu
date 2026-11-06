import type { DelegationDecision, TaskGraph, TaskNode } from './types.js';

/**
 * Decides whether one unfinished task is worth handing off. The decision rule
 * (rule 4) runs first as a veto: a long task that needs a design decision stays
 * with the main run rather than being sent to the background by rule 1.
 */
export function shouldDelegate(task: TaskNode, graph: TaskGraph): DelegationDecision {
  if (task.status === 'completed') return { shouldDelegate: false, rule: 'none', reason: 'Already completed' };
  if (task.requiresDecision || task.nature === 'blocking') {
    return { shouldDelegate: false, rule: 'keep', reason: task.requiresDecision ? 'Requires a decision the main run owns' : 'Blocks later work; tightly coupled' };
  }
  const parallel = graph.canParallelWith[task.id] ?? [];
  if (task.estimatedDuration === 'long' && parallel.length > 0) {
    const titles = parallel.map(id => graph.nodes.find(node => node.id === id)?.title ?? id).slice(0, 3);
    return { shouldDelegate: true, mode: 'background', rule: 'long-running', reason: `Long-running; ${titles.join(', ')} can proceed meanwhile` };
  }
  if (task.nature === 'independent' && task.clearAcceptance) {
    return { shouldDelegate: true, mode: 'new_session', rule: 'independent-verification', reason: 'Independent verification with clear acceptance' };
  }
  if (task.estimatedDuration === 'medium' && task.nature === 'independent' && !graph.criticalPath.includes(task.id)) {
    return { shouldDelegate: true, mode: 'new_session', rule: 'off-critical-path', reason: 'Independent work off the critical path' };
  }
  return { shouldDelegate: false, rule: 'none', reason: 'No delegation opportunity identified' };
}
