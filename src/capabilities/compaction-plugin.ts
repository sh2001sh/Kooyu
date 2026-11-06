import type { CapabilityPlugin } from '../plugins/index.js';
import type { RuntimeCore } from '../core/runtime.js';
import { KodoError } from '../runtime/types.js';

/**
 * Compaction capability plugin (placeholder).
 *
 * Full compaction requires coordination with context-assembly, CompactionPolicy,
 * and HostHooks. For Phase 2a, this is a minimal scaffold.
 *
 * When disabled, context grows unbounded until hitting the model limit.
 */
export function createCompactionPlugin(): CapabilityPlugin {
  return {
    name: 'compaction',
    version: '1.0.0',
    async initialize(runtime: RuntimeCore): Promise<void> {
      if (!runtime.store) throw new KodoError('PLUGIN_CONFIG', 'compaction plugin requires a Store');
      // TODO: integrate with CompactionPolicy and compaction-trigger
    },
  };
}
