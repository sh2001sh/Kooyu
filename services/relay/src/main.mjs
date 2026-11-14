import { createRelay } from "./server.mjs";
const origin = process.env.RELAY_ORIGIN ?? "https://relay.kooyu.app";
if (new URL(origin).protocol !== "https:") throw new Error("Production Relay requires HTTPS");
const relay = createRelay({
  origin,
  webRoot: process.env.RELAY_WEB_ROOT ?? "/app/web",
  maxHosts: Number(process.env.RELAY_MAX_HOSTS ?? 1000),
  proxy: process.env.RELAY_TRUST_PROXY === "1",
});
relay.server.listen(Number(process.env.PORT ?? 4321), "0.0.0.0", () =>
  console.log("Kooyu Relay listening"),
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void relay.close().then(() => {
      process.exitCode = 0;
    });
  });
