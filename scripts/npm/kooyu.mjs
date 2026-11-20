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

  -h, --help          Show this help
  -v, --version       Show the installed version
  -p, --port <port>   Web port (default: 4310 or KODO_HOST_PORT)
  --host <address>   Bind address (default: 127.0.0.1 or KODO_BIND)
  --data-dir <path>  Persistent data directory (defaults to the existing Kooyu Host directory)

Open the URL printed on startup. Press Ctrl+C to stop.
Non-loopback binding requires KODO_TLS_CERT and KODO_TLS_KEY.
Update a global install with: npm install -g kooyu@latest
For a one-off run: npx kooyu@latest`);
  } else if (values.version) {
    console.log(pkg.version);
  } else {
    if (positionals.length > 1 || (positionals.length === 1 && positionals[0] !== "start"))
      throw new Error("Unknown command. Use kooyu --help.");
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 24 || (major === 24 && minor < 13))
      throw new Error(
        "Kooyu requires Node.js >=24.13.0. Install a supported Node.js version first.",
      );
    const port = values.port ?? process.env.KODO_HOST_PORT ?? "4310";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
      throw new Error("Port must be an integer between 1 and 65535.");
    process.env.KODO_HOST_PORT = port;
    if (values.host) process.env.KODO_BIND = values.host;
    if (values["data-dir"]) process.env.KODO_DATA_DIR = resolve(values["data-dir"]);
    process.env.KOOYU_DISTRIBUTION = "npm";
    process.env.KOOYU_APP_VERSION = pkg.version;
    await import("../runtime/packages/host/dist/main.js");
  }
} catch (error) {
  console.error(`Kooyu: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
