import type { ToolPlugin, ToolContext } from '../plugins/index.js';
import type { RuntimeCore } from '../core/runtime.js';
import { KodoError } from '../runtime/types.js';
import { Tools } from '../tools/index.js';
import { canonicalToolName } from '../tools/catalog.js';

/**
 * Background tool plugin.
 *
 * Provides:
 * - `background.read`: Read output from background process (public alias for process.read)
 *
 * Wraps the monolithic Tools class, exposing the process.read tool under its public alias.
 */
export function createBackgroundPlugin(): ToolPlugin {
  let tools: Tools;

  return {
    name: 'background',
    tools: [
      {
        name: 'background.read',
        description: 'Read a managed background process output',
        parameters: { type: 'object' },
      },
    ],

    async initialize(runtime: RuntimeCore): Promise<void> {
      if (!runtime.store) {
        throw new KodoError('PLUGIN_CONFIG', 'background plugin requires a Store');
      }
      tools = new Tools(runtime.store, []);
    },

    async execute(name: string, args: unknown, context: ToolContext): Promise<unknown> {
      // Map public name to internal name
      const internalName = canonicalToolName(name);
      if (internalName !== 'process.read') {
        throw new KodoError('TOOL_NOT_FOUND', `Unknown tool: ${name}`);
      }

      return tools.execute(
        context.runId,
        internalName,
        args as Record<string, unknown>,
        context.signal,
        context.markEffectStarted
      );
    },
  };
}
