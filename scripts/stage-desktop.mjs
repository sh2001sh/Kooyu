import { cp, mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { hostBuildId } from "../packages/platform/dist/index.js";
import { stageDistribution } from "./distribution-config.mjs";
import "./sync-desktop-icons.mjs";

// Stage on the target OS/architecture: keyring and other native addons are not portable.
if (process.versions.node !== "24.13.0") throw new Error("Desktop staging requires Node 24.13.0.");
const root = resolve("."),
  stage = resolve(".local/desktop-stage"),
  host = join(stage, "host");
// A new artifact must not retain modules or assets removed since the previous build.
await rm(stage, { recursive: true, force: true });
await mkdir(host, { recursive: true });
for (const path of ["package.json", "package-lock.json", "LICENSE", "docs/verification.json"]) {
  await mkdir(dirname(join(host, path)), { recursive: true });
  await cp(join(root, path), join(host, path), { recursive: true });
}
for (const name of ["protocol", "platform", "host"]) {
  await mkdir(join(host, "packages", name), { recursive: true });
  for (const entry of ["package.json", "dist"])
    await cp(join(root, "packages", name, entry), join(host, "packages", name, entry), {
      recursive: true,
    });
}
for (const name of ["web", "desktop"]) {
  await mkdir(join(host, "apps", name), { recursive: true });
  await cp(join(root, "apps", name, "package.json"), join(host, "apps", name, "package.json"));
}
await cp(join(root, "apps/web/dist"), join(host, "apps/web/dist"), { recursive: true });
// Preserve workspace metadata required by npm ci; Relay server code is not run locally.
await mkdir(join(host, "services/relay"), { recursive: true });
await cp(join(root, "services/relay/package.json"), join(host, "services/relay/package.json"));
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Use npm run package:desktop or npm run stage:desktop.");
const exitCode = await new Promise((done, reject) => {
  const child = spawn(
    process.execPath,
    [npm, "ci", "--omit=dev", "--workspace=@kodo/host", "--no-audit", "--no-fund"],
    {
      cwd: host,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  child.once("error", reject);
  child.once("exit", done);
});
if (exitCode !== 0) throw new Error(`Production dependency installation failed: ${exitCode}`);
// electron-builder intentionally excludes a directory named node_modules at
// each resource root. Place production dependencies in their own extraResource
// mapping below and materialize npm workspace junctions as ordinary packages.
await mkdir(join(host, "node_modules/@kodo"), { recursive: true });
for (const name of ["protocol", "platform", "host"]) {
  const target = join(host, "node_modules/@kodo", name);
  await rm(target, { recursive: true, force: true });
  await cp(join(host, "packages", name), target, { recursive: true, dereference: true });
}
for (const name of ["desktop", "web"])
  await rm(join(host, "node_modules/@kodo", name), { recursive: true, force: true });
// Relay runs on a server, not inside the desktop app. Do not ship npm's
// workspace junction back to the developer machine's staging directory.
await rm(join(host, "node_modules/kooyu-relay"), { recursive: true, force: true });
const runtime = join(stage, "runtime");
await mkdir(runtime, { recursive: true });
const binary = join(runtime, process.platform === "win32" ? "node.exe" : "node");
await cp(process.execPath, binary);
if (process.platform !== "win32") await chmod(binary, 0o755);
const licenseResponse = await fetch(
  "https://raw.githubusercontent.com/nodejs/node/v24.13.0/LICENSE",
);
if (!licenseResponse.ok) throw new Error("Could not obtain the Node distribution license.");
await writeFile(join(runtime, "LICENSE"), await licenseResponse.text());
await writeFile(
  join(runtime, "runtime.json"),
  JSON.stringify(
    { node: process.versions.node, platform: process.platform, arch: process.arch },
    null,
    2,
  ),
);
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const app = join(stage, "app");
await mkdir(join(app, "dist"), { recursive: true });
await build({
  entryPoints: [join(root, "apps/desktop/src/main.ts")],
  outfile: join(app, "dist/main.js"),
  platform: "node",
  format: "esm",
  bundle: true,
  external: ["electron"],
  target: "node22",
});
await cp(join(root, "apps/desktop/assets"), join(app, "assets"), { recursive: true });
await writeFile(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "kooyu",
      version: pkg.version,
      description: "Kooyu native session workbench",
      author: "Kooyu contributors",
      license: pkg.license,
      type: "module",
      main: "dist/main.js",
    },
    null,
    2,
  ),
);
await stageDistribution(host);
await writeFile(
  join(host, "host-build.json"),
  JSON.stringify({ buildId: hostBuildId(host), version: pkg.version }),
);
await build({
  entryPoints: [join(root, "apps/desktop/src/upgrade-host.ts")],
  outfile: join(stage, "upgrade-host.mjs"),
  platform: "node",
  format: "esm",
  bundle: true,
  target: "node24",
});
console.log(
  `Staged ${pkg.name} with standalone Node ${process.versions.node} for ${process.platform}/${process.arch}`,
);
