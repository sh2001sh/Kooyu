import type { CapabilityPlugin, RuntimeCore } from '../plugins/index.js';
import type { Store as _UnusedStore } from '../storage/index.js';
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

    async initialize(runtime: RuntimeCore): Promise<void> {
      if (!runtime.store) {
        throw new KodoError('PLUGIN_CONFIG', 'compaction plugin requires a Store');
      }
      // TODO: integrate with CompactionPolicy and compaction-trigger
      const _unused: _UnusedStore = runtime.store;
      void _unused;
    },

    async beforeModelCall() {
      // TODO: check if compaction is needed and trigger summarizeContext
      return {};
    },
  };
}
