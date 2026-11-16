#!/usr/bin/env node
// Print the running Host's self-check. Usage: node scripts/doctor.mjs [http://127.0.0.1:4310]
// Exit code 0 = ok, 1 = degraded, 2 = failing or unreachable.
const base = (process.argv[2] ?? `http://127.0.0.1:${process.env.KODO_HOST_PORT ?? 4310}`).replace(
  /\/$/,
  "",
);
const icon = { ok: "✔", warn: "!", fail: "✖" };
try {
  const response = await fetch(`${base}/api/host/doctor`, { signal: AbortSignal.timeout(30000) });
  const report = await response.json();
  if (!response.ok) throw new Error(report.error?.message ?? `HTTP ${response.status}`);
  console.log(`Kooyu Host ${base} — ${report.status} (${report.checkedAt})`);
  for (const check of report.checks)
    console.log(`  ${icon[check.status] ?? "?"} ${check.label}: ${check.detail}`);
  process.exitCode = report.status === "ok" ? 0 : report.status === "degraded" ? 1 : 2;
} catch (error) {
  console.error(`Host 不可达或自检失败：${error instanceof Error ? error.message : error}`);
  process.exitCode = 2;
}
