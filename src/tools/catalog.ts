/** Standard host extensions are recognized in portable cards without granting runtime access. */
export const hostToolNames = Object.freeze([
  'todo.read', 'todo.write',
  'knowledge.browse', 'knowledge.search', 'knowledge.read', 'knowledge.publish',
  'web.fetch',
  'lsp.hover', 'lsp.definition', 'lsp.references', 'lsp.symbols', 'lsp.diagnostics',
  'skill.list', 'skill.load',
  'verify.run', 'memory.write',
] as const);

/**
 * Model-facing names (phase 2b) for builtins whose stable internal names stay in
 * persisted calls, recovery records and existing cards. Requests are recorded and
 * executed under the internal name; tool specs advertise the public name.
 */
export const publicToolAliases: Readonly<Record<string, string>> = Object.freeze({
  'file.write': 'file.apply_patch',
  'file.edit': 'file.patch',
  'background.read': 'process.read',
  'context.snapshot': 'update_progress',
});
const internalToPublic: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.entries(publicToolAliases).map(([alias, name]) => [name, alias])));
/** The stable internal name of a model-facing or internal tool name. */
export const canonicalToolName = (name: string): string => publicToolAliases[name] ?? name;
/** The name advertised to models for an internal tool name. */
export const publicToolName = (name: string): string => internalToPublic[name] ?? name;
/** Whether a card tool list grants this tool under either of its names. */
export const toolListed = (allowed: readonly string[], name: string): boolean => {
  const internal = canonicalToolName(name);
  return allowed.includes(internal) || allowed.includes(publicToolName(internal));
};
