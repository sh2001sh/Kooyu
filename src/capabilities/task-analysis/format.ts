import { durationMs } from './graph.js';
import type { WorkSessionAnalysis } from './types.js';

export const maxAnalysisChars = 4000;

const minutes = (ms: number): string => ms < 60_000 ? `~${Math.round(ms / 1000)}s` : `~${Math.round(ms / 60_000)}m`;

/**
 * Body of the `task-analysis` runtime block, or undefined when there is nothing
 * to suggest: an empty analysis would repeat the plan back on every request.
 */
export function formatTaskAnalysis(analysis: WorkSessionAnalysis, maxChars = maxAnalysisChars): string | undefined {
  if (!analysis.suggestions.length) return undefined;
  const { graph } = analysis;
  const title = (id: string): string => graph.nodes.find(node => node.id === id)?.title ?? id;
  const head = [`Task analysis (todo revision ${analysis.revision}; advisory, not an instruction):`];
  if (graph.criticalPath.length) head.push(`Critical path: ${graph.criticalPath.join(' → ')} (${minutes(graph.criticalPathMs)})`);
  if (graph.parallelOpportunities.length) head.push(`Ready in parallel: ${graph.parallelOpportunities.map(group => group.join(', ')).join('; ')}`);
  if (graph.droppedEdges.length) head.push(`Dependency cycle ignored: ${graph.droppedEdges.map(edge => `${edge.from} → ${edge.to}`).join(', ')}`);
  head.push('Delegation opportunities:');
  const lines = analysis.suggestions.map(item => {
    const node = graph.nodes.find(entry => entry.id === item.taskId);
    const size = node ? ` ${minutes(durationMs[node.estimatedDuration])}` : '';
    const when = item.after.length ? ` When: after ${item.after.map(title).join(', ')}.` : '';
    return `- ${item.taskId} "${item.title}"${size}: ${item.mode} (${item.reason}).${when}`;
  });
  const tail = analysis.keep.length ? [`Keep in this run: ${analysis.keep.map(item => `${item.taskId} (${item.reason.toLowerCase()})`).join('; ')}.`] : [];
  const join = (shown: string[], omitted: number): string => [...head, ...shown, ...(omitted ? [`[${omitted} more suggestions omitted]`] : []), ...tail].join('\n');
  let shown = lines.length;
  let text = join(lines, 0);
  while (text.length > maxChars && shown > 1) { shown--; text = join(lines.slice(0, shown), lines.length - shown); }
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
