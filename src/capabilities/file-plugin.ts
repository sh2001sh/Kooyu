import type { ToolPlugin, ToolContext } from '../plugins/index.js';
import type { RuntimeCore } from '../core/runtime.js';
import { KodoError } from '../runtime/types.js';
import { Tools } from '../tools/index.js';
import { canonicalToolName } from '../tools/catalog.js';

/**
 * File tool plugin.
 *
 * Provides:
 * - `file.read`: Read file contents
 * - `file.write`: Write entire file (public alias for file.apply_patch)
 * - `file.edit`: Partial file edit (public alias for file.patch)
 * - `file.search`: Search files with glob + regex
 *
 * Wraps the monolithic Tools class, exposing only file tools with public aliases.
 */
export function createFilePlugin(): ToolPlugin {
  let tools: Tools;
  const fileToolNames = ['file.read', 'file.apply_patch', 'file.patch', 'file.search'];

  return {
    name: 'file',
    tools: [
      {
        name: 'file.read',
        description: 'Read a UTF-8 file inside the workspace',
        parameters: { type: 'object' },
      },
      {
        name: 'file.write',
        description: 'Create or replace one whole UTF-8 file atomically',
        parameters: { type: 'object' },
      },
      {
        name: 'file.edit',
        description: 'Apply ordered localized replacements atomically',
        parameters: { type: 'object' },
      },
      {
        name: 'file.search',
        description: 'Search workspace files by name pattern and/or content',
        parameters: { type: 'object' },
      },
    ],

    async initialize(runtime: RuntimeCore): Promise<void> {
      if (!runtime.store) {
        throw new KodoError('PLUGIN_CONFIG', 'file plugin requires a Store');
      }
      tools = new Tools(runtime.store, []);
    },

    async execute(name: string, args: unknown, context: ToolContext): Promise<unknown> {
      // Map public name to internal name
      const internalName = canonicalToolName(name);
      if (!fileToolNames.includes(internalName)) {
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
