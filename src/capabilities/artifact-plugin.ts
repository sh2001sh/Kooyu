import type { CapabilityPlugin, ToolContext, ToolPlugin } from '../plugins/index.js';
import type { RuntimeCore } from '../core/runtime.js';
import type { Store } from '../storage/index.js';
import { KodoError } from '../runtime/types.js';

/**
 * Artifact capability plugin.
 *
 * Provides:
 * - `artifact.read`: Read an artifact by ID
 * - `artifact.write`: Write a new artifact
 *
 * Artifacts are large structured tool outputs stored as content-addressed blobs.
 * When disabled, large outputs cannot be persisted as artifacts.
 */
export function createArtifactPlugin(): CapabilityPlugin & ToolPlugin {
  let store: Store;

  return {
    name: 'artifact',
    version: '1.0.0',
    tools: [
      {
        name: 'artifact.read',
        description: 'Read artifact by ID from this session',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
            contentOffset: { type: 'integer', minimum: 0 },
            maxChars: { type: 'integer', minimum: 1, maximum: 256_000 },
          },
          required: ['id'],
        },
      },
      {
        name: 'artifact.write',
        description: 'Write a new artifact',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', maxLength: 2_000_000 },
            note: { type: 'string', maxLength: 200 },
          },
          required: ['content'],
        },
      },
    ],

    async initialize(runtime: RuntimeCore): Promise<void> {
      if (!runtime.store) {
        throw new KodoError('PLUGIN_CONFIG', 'artifact plugin requires a Store');
      }
      store = runtime.store;
    },

    async execute(name: string, args: unknown, context: ToolContext): Promise<unknown> {
      const run = store.run(context.runId);

      switch (name) {
        case 'artifact.read': {
          const { id, contentOffset = 0, maxChars = 32_000 } = args as { id: string; contentOffset?: number; maxChars?: number };
          if (!Number.isSafeInteger(contentOffset) || contentOffset < 0 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 256_000) {
            throw new KodoError('TOOL_ARGUMENTS', 'contentOffset must be non-negative and maxChars between 1 and 256000');
          }
          const data = store.readArtifact(run.id, id);
          if (typeof data === 'string') {
            const complete = contentOffset + maxChars >= data.length;
            const text = data.slice(contentOffset, contentOffset + maxChars);
            return { text, complete, totalChars: data.length };
          }
          return data;
        }
        case 'artifact.write': {
          const { content } = args as { content: string; note?: string };
          if (typeof content !== 'string' || content.length > 2_000_000) {
            throw new KodoError('TOOL_ARGUMENTS', 'content must be a string up to 2MB');
          }
          context.markEffectStarted();
          const ref = store.blob(content);
          const id = store.artifact(run.id, ref);
          return { id, chars: content.length };
        }
        default:
          throw new KodoError('TOOL_NOT_FOUND', `Unknown tool: ${name}`);
      }
    },
  };
}
