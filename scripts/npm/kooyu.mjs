#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      port: { type: "string", short: "p" },
      host: { type: "string" },
      "data-dir": { type: "string" },
    },
  });
  if (values.help) {
    console.log(`Kooyu ${pkg.version} — local Web workbench

Usage: kooyu [start] [options]
       kooyu account login|logout [--port <local Host port>]

  -h, --help          Show this help
  -v, --version       Show the installed version
  -p, --port <port>   Web port (default: 4310 or KOOYU_HOST_PORT)
  --host <address>   Bind address (default: 127.0.0.1 or KOOYU_BIND)
  --data-dir <path>  Persistent data directory (defaults to the existing Kooyu Host directory)

Open the URL printed on startup. Press Ctrl+C to stop.
Non-loopback binding requires KOOYU_TLS_CERT and KOOYU_TLS_KEY.
Update a global install with: npm install -g kooyu@latest
For a one-off run: npx kooyu@latest`);
  } else if (values.version) {
    console.log(pkg.version);
  } else if (["account login", "account logout"].includes(positionals.join(" "))) {
    const port = Number(
      values.port ?? process.env.KOOYU_HOST_PORT ?? process.env.KODO_HOST_PORT ?? 4310,
    );
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid local Host port");
    const endpoint = "http://127.0.0.1:" + port + "/api/remote/account/";
    async function post(action) {
      const r = await fetch(endpoint + action, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw Error("Account authorization failed (" + r.status + ").");
      return r.json();
    }
    if (positionals[1] === "logout") {
      await post("logout");
      console.log("Host signed out.");
    } else {
      const start = await post("start");
      console.log(
        "Open " +
          start.verificationUri +
          " and approve code " +
          start.userCode +
          " before " +
          new Date(start.expiresAt).toISOString(),
      );
      const cancel = () => void post("cancel").finally(() => process.exit(130));
      process.once("SIGINT", cancel);
      try {
        let interval = 5,
          bound = false;
        while (Date.now() < start.expiresAt) {
          await new Promise((resolve) => setTimeout(resolve, interval * 1000));
          const next = await post("poll");
          if (next.state === "approved") {
            bound = true;
            break;
          }
          interval = next.interval ?? 5;
        }
        if (!bound) throw Error("Authorization expired");
        console.log("Host bound to Kooyu account.");
      } finally {
        process.off("SIGINT", cancel);
      }
    }
  } else {
    if (positionals.length > 1 || (positionals.length === 1 && positionals[0] !== "start"))
      throw new Error("Unknown command. Use kooyu --help.");
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 24 || (major === 24 && minor < 13))
      throw new Error(
        "Kooyu requires Node.js >=24.13.0. Install a supported Node.js version first.",
      );
    const port = values.port ?? process.env.KOOYU_HOST_PORT ?? process.env.KODO_HOST_PORT ?? "4310";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
      throw new Error("Port must be an integer between 1 and 65535.");
    process.env.KOOYU_HOST_PORT = port;
    if (values.host) process.env.KOOYU_BIND = values.host;
    if (values["data-dir"]) process.env.KOOYU_DATA_DIR = resolve(values["data-dir"]);
    process.env.KOOYU_DISTRIBUTION = "npm";
    process.env.KOOYU_APP_VERSION = pkg.version;
    await import("../runtime/packages/host/dist/main.js");
  }
} catch (error) {
  console.error(`Kooyu: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
