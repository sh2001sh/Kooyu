import { createRelay } from "./server.mjs";
import { accountGateway } from "./account-gateway.mjs";
const origin = process.env.RELAY_ORIGIN;
if (!origin || new URL(origin).protocol !== "https:")
  throw new Error("Production Relay requires an HTTPS RELAY_ORIGIN");
const relay = createRelay({
  origin,
  gateway: accountGateway({issuer:process.env.ACCOUNT_ORIGIN,controlOrigin:process.env.ACCOUNT_CONTROL_ORIGIN,controlSecret:process.env.RELAY_CONTROL_SECRET,origin}),
  webRoot: process.env.RELAY_WEB_ROOT ?? "/app/web",
  maxHosts: Number(process.env.RELAY_MAX_HOSTS ?? 1000),
  proxy: process.env.RELAY_TRUST_PROXY === "1",
  mailboxPath: process.env.RELAY_MAILBOX_DB ?? ":memory:",
  previewDomain: process.env.RELAY_PREVIEW_DOMAIN || undefined,
});
relay.server.listen(Number(process.env.PORT ?? 4321), process.env.RELAY_BIND ?? "0.0.0.0", () =>
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
