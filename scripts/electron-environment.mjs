// Electron interprets this inherited Node flag before loading application code.
export function electronEnvironment(source = process.env) {
  const env = Object.fromEntries(
    Object.entries(source).filter(([key]) => key.toUpperCase() !== "ELECTRON_RUN_AS_NODE"),
  );
  if (process.platform === "win32")
    env.KOOYU_SOFTWARE_RENDERING ??= env.KODO_SOFTWARE_RENDERING ?? "1";
  return env;
}
