#!/usr/bin/env node
// Private loopback administration. JSON files/stdin keep credentials out of argv.
import { readFile } from "node:fs/promises";
const [method = "GET", path = "/internal/health", bodyFile] = process.argv.slice(2);
if (
  !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ||
  !/^\/(api|internal)\//.test(path)
)
  throw new Error("Usage: host-admin.mjs METHOD /api/path [body.json|-]");
const base =
  process.env.KOOYU_ADMIN_URL ??
  `http://127.0.0.1:${process.env.KODO_ADMIN_PORT ?? process.env.KODO_HOST_PORT ?? 4310}`;
const url = new URL(path, base);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.username ||
  url.password
)
  throw new Error(
    "Administration requires a loopback HTTP URL; use KODO_ADMIN_PORT for a TLS Host",
  );
let body = ["POST", "PUT", "PATCH", "DELETE"].includes(method) ? "{}" : undefined;
if (bodyFile) {
  let input;
  if (bodyFile === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = Buffer.concat(chunks).toString("utf8");
  } else input = await readFile(bodyFile, "utf8");
  body = JSON.stringify(JSON.parse(input));
}
const response = await fetch(url, {
  method,
  headers: { "Content-Type": "application/json" },
  ...(body ? { body } : {}),
  redirect: "error",
  signal: AbortSignal.timeout(120000),
});
const result = await response.text();
console.log(result);
if (!response.ok) process.exitCode = 1;
