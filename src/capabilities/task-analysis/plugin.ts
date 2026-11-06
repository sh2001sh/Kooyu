import { KodoError } from '../../runtime/types.js';
import { readTodoSnapshot } from '../../tools/todo.js';
import { attachment } from '../../runtime/attachments.js';
import type { RuntimeCore } from '../../core/runtime.js';
import type { CoreRun } from '../../core/types.js';
import type { CapabilityPlugin } from '../../plugins/capability.js';
import type { Store } from '../../storage/index.js';
import { analyzeWorkSession } from './analyze.js';
import { formatTaskAnalysis } from './format.js';
import type { PlanItem } from './infer.js';
import type { WorkSessionAnalysis } from './types.js';

/** Event emitted on `runtime.events` after each analysis; payload is `WorkSessionAnalysis`. */
export const taskGraphBuilt = 'task.graph_built';

export interface TaskAnalysisOptions {
  /**
   * The run's current plan. Defaults to the `todo.updated` snapshot recorded in the
   * Store under the core run ID, which is the `runId` todo tools receive in their context.
   */
  plan?: (run: CoreRun, store: Store | undefined) => { revision: number; items: readonly PlanItem[] };
}

/**
 * Task-flow analysis. Before each model request it rebuilds the task graph from the
 * run's plan and, when there is a delegation opportunity, appends an advisory
 * `task-analysis` runtime block. Unchanged plans are not re-injected.
 */
export function createTaskAnalysisPlugin(options: TaskAnalysisOptions = {}): CapabilityPlugin {
  let runtime: RuntimeCore | undefined;
  const injected = new Map<string, string>();
  const plan = options.plan ?? ((run, store) => {
    if (!store) throw new KodoError('PLUGIN_CONFIG', 'task-analysis reads the todo plan from the Store; pass createRuntime({ store }) or a plan option');
    return readTodoSnapshot(store, run.id);
  });
  return {
    name: 'task-analysis',
    version: '1.0.0',
    initialize(core) {
      if (!options.plan && !core.store) throw new KodoError('PLUGIN_CONFIG', 'task-analysis reads the todo plan from the Store; pass createRuntime({ store }) or a plan option');
      runtime = core;
    },
    hooks: {
      async beforeModelCall(run) {
        const current = plan(run, runtime?.store);
        if (!current.revision) return;
        const analysis: WorkSessionAnalysis = analyzeWorkSession(current);
        await runtime?.events.emit(taskGraphBuilt, analysis);
        const text = formatTaskAnalysis(analysis);
        // Injected blocks stay in the transcript; repeat one only when the advice changes.
        if (!text || injected.get(run.id) === text) return;
        injected.set(run.id, text);
        return { inject: [attachment('task-analysis', text)] };
      },
    },
    cleanup() { injected.clear(); },
  };
}
