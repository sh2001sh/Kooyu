import type { ToolPlugin, ToolContext } from '../plugins/index.js';
import type { RuntimeCore } from '../core/runtime.js';
import { KodoError } from '../runtime/types.js';
import { Tools } from '../tools/index.js';

/**
 * Shell tool plugin.
 *
 * Provides:
 * - `shell.exec`: Execute shell commands
 *
 * Wraps the monolithic Tools class, exposing only the shell.exec tool.
 */
export function createShellPlugin(): ToolPlugin {
  let tools: Tools;

  return {
    name: 'shell',
    tools: [
      {
        name: 'shell.exec',
        description: 'Execute a shell command',
        parameters: { type: 'object' },
      },
    ],

    async initialize(runtime: RuntimeCore): Promise<void> {
      if (!runtime.store) {
        throw new KodoError('PLUGIN_CONFIG', 'shell plugin requires a Store');
      }
      tools = new Tools(runtime.store, []);
    },

    async execute(name: string, args: unknown, context: ToolContext): Promise<unknown> {
      if (name !== 'shell.exec') {
        throw new KodoError('TOOL_NOT_FOUND', `Unknown tool: ${name}`);
      }

      return tools.execute(
        context.runId,
        'shell.exec',
        args as Record<string, unknown>,
        context.signal,
        context.markEffectStarted
      );
    },
  };
}
