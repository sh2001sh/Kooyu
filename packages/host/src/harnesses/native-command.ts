import type { AdapterContext } from "./adapter.js";
import { launch } from "./rpc.js";

export async function captureNativeCommand(
  ctx: AdapterContext,
  args: string[],
  maxBytes = 8 * 1024 * 1024,
  timeoutMs = 20_000,
): Promise<string> {
  const child = launch({ ...ctx, launch: { ...ctx.launch, args } });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let done = false;
    let failure: Error | null = null;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const abort = (error: Error) => {
      if (failure || done) return;
      failure = error;
      child.kill();
    };
    const timer = setTimeout(() => abort(new Error("Native command timed out.")), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) abort(new Error("Native command output exceeded the limit."));
      else if (!failure) chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2048);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (failure) finish(failure);
      else if (code === 0) finish();
      else finish(new Error(`Native command failed (${code}): ${stderr}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}
