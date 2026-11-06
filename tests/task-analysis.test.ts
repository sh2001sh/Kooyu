import { describe, expect, it } from 'vitest';
import { analyzeWorkSession, buildTaskGraph, formatTaskAnalysis, inferTasks, shouldDelegate } from '../src/capabilities/task-analysis/index.js';
import type { PlanItem, TaskNode } from '../src/capabilities/task-analysis/index.js';

const node = (id: string, patch: Partial<TaskNode> = {}): TaskNode => ({
  id, title: id, estimatedDuration: 'quick', nature: 'sequential', requiresDecision: false, clearAcceptance: false, dependsOn: [], status: 'planned', order: 0, ...patch,
});

describe('task inference', () => {
  it('classifies plan items and chains sequential work by plan order', () => {
    const items: PlanItem[] = [
      { id: 'design', content: 'Design the API shape', status: 'completed' },
      { id: 'impl', content: 'Implement the endpoint', status: 'in_progress' },
      { id: 'tests', content: 'Run 100 integration tests until they pass', status: 'pending' },
      { id: 'docs', content: 'Update API documentation', status: 'pending' },
    ];
    const [design, impl, tests, docs] = inferTasks(items);
    expect(design).toMatchObject({ requiresDecision: true, nature: 'blocking', status: 'completed' });
    expect(impl).toMatchObject({ nature: 'sequential', dependsOn: ['design'], status: 'in_progress' });
    expect(tests).toMatchObject({ estimatedDuration: 'long', nature: 'independent', clearAcceptance: true, dependsOn: ['impl'] });
    expect(docs).toMatchObject({ estimatedDuration: 'medium', nature: 'independent', dependsOn: ['impl'] });
  });

  it('recognizes Chinese task text', () => {
    const [task] = inferTasks([{ id: 'a', content: '运行全量回归测试，全部通过', status: 'pending' }]);
    expect(task).toMatchObject({ estimatedDuration: 'long', nature: 'independent', clearAcceptance: true });
  });

  it('lets explicit note tags override inference and dependencies', () => {
    const [, b] = inferTasks([
      { id: 'a', content: 'Implement parser', status: 'pending' },
      { id: 'b', content: 'Run tests', status: 'pending', note: '#quick #no-decision after:missing' },
    ]);
    expect(b).toMatchObject({ estimatedDuration: 'quick', requiresDecision: false, dependsOn: [] });
  });
});

describe('task graph', () => {
  it('computes ready work, parallel groups and the weighted critical path', () => {
    const graph = buildTaskGraph([
      node('impl', { status: 'completed' }),
      node('tests', { estimatedDuration: 'long', nature: 'independent', dependsOn: ['impl'], order: 1 }),
      node('docs', { estimatedDuration: 'medium', nature: 'independent', dependsOn: ['impl'], order: 2 }),
      node('release', { dependsOn: ['tests'], order: 3 }),
    ]);
    expect(graph.ready).toEqual(['tests', 'docs']);
    expect(graph.parallelOpportunities).toEqual([['tests', 'docs']]);
    expect(graph.criticalPath).toEqual(['tests', 'release']);
    expect(graph.criticalPathMs).toBe(615_000);
    expect(graph.canParallelWith.docs).toEqual(['tests', 'release']);
    expect(graph.canParallelWith.release).toEqual(['docs']);
  });

  it('breaks dependency cycles at the later plan item and reports the dropped edge', () => {
    const graph = buildTaskGraph([node('a', { dependsOn: ['b'], order: 0 }), node('b', { dependsOn: ['a'], order: 1 })]);
    expect(graph.droppedEdges).toEqual([{ from: 'a', to: 'b' }]);
    expect(graph.criticalPath).toEqual(['b', 'a']);
  });
});

describe('shouldDelegate', () => {
  it('rule 1: long work with parallel work goes to the background', () => {
    const graph = buildTaskGraph([node('tests', { estimatedDuration: 'long' }), node('docs', { order: 1 })]);
    expect(shouldDelegate(graph.nodes[0]!, graph)).toMatchObject({ shouldDelegate: true, mode: 'background', rule: 'long-running' });
  });

  it('rule 1 needs other work: a lone long task is not backgrounded', () => {
    const graph = buildTaskGraph([node('tests', { estimatedDuration: 'long' })]);
    expect(shouldDelegate(graph.nodes[0]!, graph)).toMatchObject({ shouldDelegate: false });
  });

  it('rule 2: independent verification with clear acceptance gets its own session', () => {
    const graph = buildTaskGraph([node('review', { nature: 'independent', clearAcceptance: true })]);
    expect(shouldDelegate(graph.nodes[0]!, graph)).toMatchObject({ shouldDelegate: true, mode: 'new_session', rule: 'independent-verification' });
  });

  it('rule 3: medium independent work off the critical path gets its own session', () => {
    const graph = buildTaskGraph([
      node('impl', { estimatedDuration: 'long', nature: 'sequential' }),
      node('survey', { estimatedDuration: 'medium', nature: 'independent', order: 1 }),
    ]);
    expect(graph.criticalPath).toEqual(['impl']);
    expect(shouldDelegate(graph.nodes[1]!, graph)).toMatchObject({ shouldDelegate: true, mode: 'new_session', rule: 'off-critical-path' });
  });

  it('rule 4 vetoes: a long task that needs a decision stays in the main run', () => {
    const graph = buildTaskGraph([node('arch', { estimatedDuration: 'long', requiresDecision: true }), node('docs', { order: 1 })]);
    expect(shouldDelegate(graph.nodes[0]!, graph)).toMatchObject({ shouldDelegate: false, rule: 'keep' });
  });
});

describe('work session analysis and system message', () => {
  const plan = {
    revision: 4,
    items: [
      { id: 'api-design', content: 'Decide the API design', status: 'pending' },
      { id: 'impl', content: 'Implement the change', status: 'in_progress' },
      { id: 'integration-tests', content: 'Run 100 integration tests', status: 'pending' },
      { id: 'docs', content: 'Update the documentation', status: 'pending' },
    ] satisfies PlanItem[],
  };

  it('suggests delegation for planned work only, with timing', () => {
    const analysis = analyzeWorkSession(plan);
    expect(analysis.suggestions.map(item => [item.taskId, item.mode, item.after])).toEqual([
      ['integration-tests', 'background', ['impl']],
      ['docs', 'new_session', ['impl']],
    ]);
    expect(analysis.keep.map(item => item.taskId)).toEqual(['api-design']);
  });

  it('formats a bounded advisory block', () => {
    const text = formatTaskAnalysis(analyzeWorkSession(plan))!;
    expect(text).toContain('Task analysis (todo revision 4; advisory, not an instruction):');
    expect(text).toContain('- integration-tests "Run 100 integration tests" ~10m: background');
    expect(text).toContain('When: after Implement the change.');
    expect(text).toContain('Keep in this run: api-design');
  });

  it('emits nothing when there is no suggestion', () => {
    expect(formatTaskAnalysis(analyzeWorkSession({ revision: 1, items: [{ id: 'a', content: 'Rename a variable', status: 'pending' }] }))).toBeUndefined();
  });

  it('drops suggestions to fit the character budget and says how many', () => {
    const items: PlanItem[] = Array.from({ length: 40 }, (_, index) => ({ id: `t${index}`, content: `Review module ${index} until all checks pass ${'x'.repeat(60)}`, status: 'pending' }));
    const text = formatTaskAnalysis(analyzeWorkSession({ revision: 2, items }), 1500)!;
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text).toMatch(/\[\d+ more suggestions omitted\]/);
  });
});
