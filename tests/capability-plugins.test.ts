import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../src/storage/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultBudget } from '../src/runtime/types.js';
import { fullToolCard, binding, answer, scripted } from './helpers.js';
import { createRuntime } from '../src/factory.js';
import type { CapabilityPlugin } from '../src/plugins/index.js';
import {
  createHistoryPlugin,
  createArtifactPlugin,
  createTodoPlugin,
  createCompactionPlugin,
  createRecoveryPlugin,
  createMessagingPlugin,
} from '../src/capabilities/index.js';

describe('capability plugins', () => {
  let testDir: string;
  let store: Store;
  const createdAt = new Date().toISOString();

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'kodo-test-'));
    store = new Store(testDir);
    store.putSession({
      id: 'session',
      workspace: testDir,
      permissions: ['read', 'write'],
      budget: { ...defaultBudget, maxContextTokens: 8192, maxOutputTokens: 1024 },
      tokens: 0,
      modelCalls: 0,
      toolCalls: 0,
      usageEstimated: false,
      createdAt,
    });
    store.putRun({
      id: 'run',
      sessionId: 'session',
      objective: 'test',
      status: 'running',
      card: fullToolCard,
      binding,
      contextRef: store.blob([]),
      step: 0,
      cancelRequested: false,
      createdAt,
    });
  });

  afterEach(() => {
    store.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('all plugins can initialize with Store', async () => {
    const runtime = await createRuntime({
      provider: scripted(answer()),
      binding,
      store,
      capabilities: [
        createHistoryPlugin() as CapabilityPlugin,
        createArtifactPlugin() as CapabilityPlugin,
        createTodoPlugin() as CapabilityPlugin,
        createCompactionPlugin() as CapabilityPlugin,
        createRecoveryPlugin() as CapabilityPlugin,
        createMessagingPlugin() as CapabilityPlugin,
      ],
    });

    expect(runtime).toBeDefined();
  });

  it('history plugin exposes history.read and history.search', () => {
    const plugin = createHistoryPlugin();
    expect(plugin.tools?.map(t => t.name)).toEqual(['history.read', 'history.search']);
  });

  it('artifact plugin exposes artifact.read and artifact.write', () => {
    const plugin = createArtifactPlugin();
    expect(plugin.tools?.map(t => t.name)).toEqual(['artifact.read', 'artifact.write']);
  });

  it('todo plugin exposes todo.read and todo.write', () => {
    const plugin = createTodoPlugin();
    expect(plugin.tools?.map(t => t.name)).toEqual(['todo.read', 'todo.write']);
  });

  it('recovery plugin exposes recovery.inspect', () => {
    const plugin = createRecoveryPlugin();
    expect(plugin.tools?.map(t => t.name)).toEqual(['recovery.inspect']);
  });
});
