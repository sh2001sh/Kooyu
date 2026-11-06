import type { CapabilityPlugin, RuntimeCore } from '../plugins/index.js';
import { KodoError } from '../runtime/types.js';

/**
 * Messaging capability plugin (placeholder).
 *
 * Provides 12 collaboration tools for multi-agent coordination:
 * agent.spawn, agent.send, agent.kill, etc.
 *
 * Full messaging requires deep integration with Mailbox, agent-lifecycle,
 * and the coordinator. This is Phase 2a's largest conversion.
 *
 * When disabled, runs in single-agent mode.
 */
export function createMessagingPlugin(): CapabilityPlugin {
  return {
    name: 'messaging',

    async initialize(runtime: RuntimeCore): Promise<void> {
      if (!runtime.store) {
        throw new KodoError('PLUGIN_CONFIG', 'messaging plugin requires a Store');
      }
      // TODO: integrate with Mailbox and agent-lifecycle
    },

    async beforeModelCall() {
      // TODO: inject mailbox attachment
      return {};
    },
  };
}
