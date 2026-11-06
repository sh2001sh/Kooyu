import type { CapabilityPlugin, RuntimeCore, ToolContext, ToolPlugin } from '../plugins/index.js';
import type { Store as _UnusedStore } from '../storage/index.js';
import { KodoError } from '../runtime/types.js';

/**
 * Recovery capability plugin (placeholder).
 *
 * Provides `recovery.inspect` tool and handles uncertain effects at run start.
 * Full recovery integration requires coordination with Tools, native probes,
 * and the effect reconciliation system.
 *
 * When disabled, uncertain effects remain blocked and require manual confirmation.
 */
export function createRecoveryPlugin(): CapabilityPlugin & ToolPlugin {
  return {
    name: 'recovery',
    tools: [
      {
        name: 'recovery.inspect',
        description: 'Ask the host to inspect this run\'s uncertain effects using existing file probes and registered verifiers. Returns remaining blocked call IDs and evidence. Only host-verified outcomes are recorded; this tool does not accept model-supplied verdicts or replay calls. If blocked calls remain without a verifier, report the required host verification instead of retrying writes.',
        parameters: { type: 'object' },
      },
    ],

    async initialize(runtime: RuntimeCore): Promise<void> {
      if (!runtime.store) {
        throw new KodoError('PLUGIN_CONFIG', 'recovery plugin requires a Store');
      }
      const _unused: _UnusedStore = runtime.store;
      void _unused;
      // TODO: integrate with native-recovery.ts and recovery-resolution.ts
    },

    async execute(_name: string, _args: unknown, _context: ToolContext): Promise<unknown> {
      if (_name !== 'recovery.inspect') {
        throw new KodoError('TOOL_NOT_FOUND', `Unknown tool: ${_name}`);
      }
      // TODO: delegate to inspectUncertainEffects from recovery.ts
      return { blockedCalls: [], evidence: [] };
    },
  };
}
