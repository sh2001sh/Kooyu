import type { TaskDuration, TaskEdge, TaskGraph, TaskNode } from './types.js';

/** Nominal durations for path weighting; only their ratios matter. */
export const durationMs: Readonly<Record<TaskDuration, number>> = { quick: 15_000, medium: 120_000, long: 600_000 };

/**
 * Builds the dependency graph over known tasks. Completed tasks satisfy
 * dependencies; cycles are broken by dropping the edge into the later plan item.
 */
export function buildTaskGraph(input: readonly TaskNode[]): TaskGraph {
  const nodes = input.map(node => ({ ...node, dependsOn: [...node.dependsOn] }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const droppedEdges: TaskEdge[] = [];
  for (const node of nodes) node.dependsOn = node.dependsOn.filter(id => byId.has(id) && id !== node.id);

  // Kahn's order over all nodes; a leftover node sits on a cycle.
  const order = (): { sorted: TaskNode[]; cyclic: TaskNode[] } => {
    const indegree = new Map(nodes.map(node => [node.id, node.dependsOn.length]));
    const queue = nodes.filter(node => node.dependsOn.length === 0);
    const sorted: TaskNode[] = [];
    while (queue.length) {
      const node = queue.shift()!;
      sorted.push(node);
      for (const next of nodes) if (next.dependsOn.includes(node.id)) {
        const left = indegree.get(next.id)! - 1;
        indegree.set(next.id, left);
        if (left === 0) queue.push(next);
      }
    }
    return { sorted, cyclic: nodes.filter(node => !sorted.includes(node)) };
  };
  let { sorted, cyclic } = order();
  while (cyclic.length) {
    const target = cyclic.reduce((latest, node) => node.order > latest.order ? node : latest);
    const from = target.dependsOn.filter(id => cyclic.some(node => node.id === id)).reduce((latest, id) => byId.get(id)!.order > byId.get(latest)!.order ? id : latest);
    target.dependsOn = target.dependsOn.filter(id => id !== from);
    droppedEdges.push({ from, to: target.id });
    ({ sorted, cyclic } = order());
  }

  const edges = nodes.flatMap(node => node.dependsOn.map(from => ({ from, to: node.id })));
  const ancestors = new Map<string, Set<string>>();
  for (const node of sorted) {
    const set = new Set<string>();
    for (const id of node.dependsOn) { set.add(id); for (const above of ancestors.get(id)!) set.add(above); }
    ancestors.set(node.id, set);
  }
  const related = (left: string, right: string): boolean => ancestors.get(left)!.has(right) || ancestors.get(right)!.has(left);
  const open = sorted.filter(node => node.status !== 'completed');
  const done = (id: string): boolean => byId.get(id)!.status === 'completed';

  // Longest weighted chain of unfinished work; completed tasks cost nothing.
  const best = new Map<string, { ms: number; path: string[] }>();
  for (const node of sorted) {
    const own = node.status === 'completed' ? 0 : durationMs[node.estimatedDuration];
    const previous = node.dependsOn.map(id => best.get(id)!).reduce<{ ms: number; path: string[] }>((top, item) => item.ms > top.ms ? item : top, { ms: 0, path: [] });
    best.set(node.id, { ms: previous.ms + own, path: node.status === 'completed' ? previous.path : [...previous.path, node.id] });
  }
  const critical = [...best.values()].reduce<{ ms: number; path: string[] }>((top, item) => item.ms > top.ms ? item : top, { ms: 0, path: [] });

  const canParallelWith = Object.fromEntries(open.map(node => [node.id, open.filter(other => other.id !== node.id && !related(node.id, other.id)).map(other => other.id)]));
  const ready = open.filter(node => node.dependsOn.every(done)).map(node => node.id);
  // Ready tasks never depend on each other (their dependencies are complete), so they form one group.
  const parallelOpportunities = ready.length > 1 ? [ready] : [];
  return { nodes, edges, criticalPath: critical.path, criticalPathMs: critical.ms, ready, parallelOpportunities, canParallelWith, droppedEdges };
}
