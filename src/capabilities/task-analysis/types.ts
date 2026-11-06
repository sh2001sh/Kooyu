/**
 * Task-flow analysis types. A task graph is derived from the run's own plan; it
 * is advisory input to the model and never grants permissions or schedules work.
 */
export type TaskDuration = 'quick' | 'medium' | 'long';
export type TaskNature = 'sequential' | 'independent' | 'blocking';
export type TaskStatus = 'planned' | 'in_progress' | 'blocked' | 'completed';

export interface TaskNode {
  id: string;
  title: string;
  /** quick < 30 s, medium 30 s - 5 min, long > 5 min. */
  estimatedDuration: TaskDuration;
  nature: TaskNature;
  requiresDecision: boolean;
  clearAcceptance: boolean;
  /** IDs this task needs completed first. Unknown IDs are ignored. */
  dependsOn: string[];
  status: TaskStatus;
  /** Plan position, used as the default ordering of sequential work. */
  order: number;
}

export interface TaskEdge { from: string; to: string }

export interface TaskGraph {
  nodes: TaskNode[];
  /** Dependency edges among known tasks: `from` must complete before `to`. */
  edges: TaskEdge[];
  /** Unfinished tasks on the longest weighted dependency chain, in order. */
  criticalPath: string[];
  criticalPathMs: number;
  /** Unfinished tasks whose dependencies are all complete. */
  ready: string[];
  /** Groups of two or more ready tasks with no dependency between them. */
  parallelOpportunities: string[][];
  /** Per unfinished task: other unfinished tasks with no dependency path either way. */
  canParallelWith: Record<string, string[]>;
  /** Edges dropped to break dependency cycles. */
  droppedEdges: TaskEdge[];
}

export type DelegationMode = 'background' | 'new_session';
export type DelegationRule = 'long-running' | 'independent-verification' | 'off-critical-path' | 'keep' | 'none';

export type DelegationDecision =
  | { shouldDelegate: true; mode: DelegationMode; rule: DelegationRule; reason: string }
  | { shouldDelegate: false; rule: DelegationRule; reason: string };

export interface DelegationSuggestion {
  taskId: string;
  title: string;
  mode: DelegationMode;
  rule: DelegationRule;
  reason: string;
  /** Unfinished dependencies; the suggestion applies once they complete. */
  after: string[];
}

export interface WorkSessionAnalysis {
  /** Plan revision the analysis was computed from. */
  revision: number;
  graph: TaskGraph;
  suggestions: DelegationSuggestion[];
  /** Unfinished tasks the main run should keep, with the reason. */
  keep: { taskId: string; title: string; reason: string }[];
}
