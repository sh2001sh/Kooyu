import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function stageDistribution(root, env = process.env) {
  const origin = env.KOOYU_OFFICIAL_RELAY_ORIGIN?.trim();
  if (!origin) {
    if (env.KOOYU_OFFICIAL_RELEASE === "1")
      throw new Error("Official release requires KOOYU_OFFICIAL_RELAY_ORIGIN");
    return;
  }
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin)
    throw new Error("Release Relay must be an HTTPS origin without paths or credentials");
  const accountOrigin = env.KOOYU_OFFICIAL_ACCOUNT_ORIGIN?.trim();
  if (
    !accountOrigin ||
    new URL(accountOrigin).origin !== accountOrigin ||
    !accountOrigin.startsWith("https://")
  )
    throw Error("Release requires KOOYU_OFFICIAL_ACCOUNT_ORIGIN");
  await writeFile(
    join(root, "distribution.json"),
    JSON.stringify({ schema: 1, accountOrigin, relay: { origin, protocol: 2 } }) + "\n",
  );
}
