import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/factory.js';
import { createTaskAnalysisPlugin, taskGraphBuilt } from '../src/capabilities/task-analysis/index.js';
import type { WorkSessionAnalysis } from '../src/capabilities/task-analysis/index.js';
import { Store } from '../src/storage/index.js';
import { todoTools } from '../src/tools/todo.js';
import type { ToolPlugin } from '../src/plugins/index.js';
import type { Message } from '../src/runtime/types.js';
import { defaultBudget } from '../src/runtime/types.js';
import { answer, binding, call, calls, fullToolCard, scripted, temp } from './helpers.js';

const plan = [
  { id: 'impl', content: 'Implement the change', status: 'in_progress' },
  { id: 'tests', content: 'Run 100 integration tests', status: 'pending' },
  { id: 'docs', content: 'Update documentation', status: 'pending' },
];

/**
 * The real todo tools over a store holding one session, adapted to the core
 * ToolPlugin shape. Core run IDs are mirrored into the store on first use.
 */
function todoPlugin(store: Store): ToolPlugin {
  const createdAt = new Date().toISOString();
  store.putSession({ id: 'session', workspace: temp(), permissions: ['read'], budget: { ...defaultBudget, maxContextTokens: 8192, maxOutputTokens: 1024 }, tokens: 0, modelCalls: 0, toolCalls: 0, usageEstimated: false, createdAt });
  const registrations = todoTools(store);
  return {
    name: 'todo-tools',
    tools: registrations.map(({ name, description, parameters }) => ({ name, description, parameters })),
    execute(name, args, context) {
      try { store.run(context.runId); } catch { store.putRun({ id: context.runId, sessionId: 'session', objective: 'test', status: 'running', card: fullToolCard, binding, contextRef: store.blob([]), step: 0, cancelRequested: false, createdAt }); }
      return registrations.find(item => item.name === name)!.execute({ run: store.run(context.runId), session: store.session('session'), signal: context.signal, markEffectStarted: context.markEffectStarted }, args as Record<string, unknown>);
    },
  };
}

describe('task-analysis plugin', () => {
  it('injects advice after todo.write, emits task.graph_built, and does not repeat unchanged advice', async () => {
    const store = new Store(path.join(temp(), '.state'));
    const requests: Message[][] = [];
    const record = (response: ReturnType<typeof answer>) => async (request: { messages: Message[] }) => { requests.push(request.messages); return response; };
    const provider = scripted(
      record(calls(call('todo.write', { expectedRevision: 0, items: plan }, 'c1'))),
      record(calls(call('todo.read', {}, 'c2'))),
      record(answer('done')),
    );
    const { runtime, shutdown } = await createRuntime({ provider, binding, store, capabilities: [createTaskAnalysisPlugin()], tools: [todoPlugin(store)] });
    const graphs: WorkSessionAnalysis[] = [];
    runtime.events.on<WorkSessionAnalysis>(taskGraphBuilt, analysis => { graphs.push(analysis); });
    const run = await runtime.run('task');
    await shutdown();
    store.close();

    expect(run.status).toBe('completed');
    const blocks = (messages: Message[]): string[] => messages.filter(m => m.content?.includes('kind="task-analysis"')).map(m => m.content!);
    expect(blocks(requests[0]!)).toEqual([]);
    const [advice] = blocks(requests[1]!);
    expect(advice).toContain('Task analysis (todo revision 1; advisory, not an instruction):');
    expect(advice).toContain('- tests "Run 100 integration tests" ~10m: background');
    expect(advice).toContain('When: after Implement the change.');
    // Same plan on the third request: the block is kept in the transcript, not appended again.
    expect(blocks(requests[2]!)).toEqual([advice]);
    expect(graphs.map(item => item.revision)).toEqual([1, 1]);
  });

  it('adds nothing when the plan has no delegation opportunity', async () => {
    const store = new Store(path.join(temp(), '.state'));
    const requests: Message[][] = [];
    const provider = scripted(
      calls(call('todo.write', { expectedRevision: 0, items: [{ id: 'a', content: 'Rename a variable', status: 'pending' }] }, 'c1')),
      async request => { requests.push(request.messages); return answer(); },
    );
    const { runtime, shutdown } = await createRuntime({ provider, binding, store, capabilities: [createTaskAnalysisPlugin()], tools: [todoPlugin(store)] });
    await runtime.run('task');
    await shutdown();
    store.close();
    expect(requests[0]!.some(m => m.content?.includes('task-analysis'))).toBe(false);
  });

  it('accepts a host plan source and fails fast without a Store or plan', async () => {
    const seen: Message[][] = [];
    const provider = scripted(async request => { seen.push(request.messages); return answer(); });
    const custom = createTaskAnalysisPlugin({ plan: () => ({ revision: 3, items: plan as never }) });
    const { runtime } = await createRuntime({ provider, binding, capabilities: [custom] });
    await runtime.run('task');
    expect(seen[0]!.at(-1)?.content).toContain('todo revision 3');
    await expect(createRuntime({ provider: scripted(answer()), binding, capabilities: [createTaskAnalysisPlugin()] })).rejects.toMatchObject({ code: 'PLUGIN_CONFIG' });
  });
});
