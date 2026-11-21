import { existsSync, readFileSync } from "node:fs";

// Public release metadata is injected into artifacts, never used as an access secret.
const file = new URL("../../../distribution.json", import.meta.url);
function readDistribution(): {
  accountOrigin?: string;
  relay?: { origin: string; protocol: 1 | 2 };
} {
  if (!existsSync(file)) return {};
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (value.schema !== 1 || !value.relay) throw new Error("Invalid distribution metadata");
  const url = new URL(value.relay.origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== value.relay.origin ||
    ![1, 2].includes(value.relay.protocol)
  )
    throw new Error("Invalid distribution Relay");
  if (
    !value.accountOrigin ||
    new URL(value.accountOrigin).origin !== value.accountOrigin ||
    !value.accountOrigin.startsWith("https://")
  )
    throw Error("Missing release account origin");
  return {
    accountOrigin: value.accountOrigin,
    relay: { origin: url.origin, protocol: value.relay.protocol },
  };
}
export const distribution = readDistribution();
