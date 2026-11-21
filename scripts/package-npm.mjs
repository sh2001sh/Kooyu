import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as platform from "../packages/platform/dist/index.js";
import { stageDistribution } from "./distribution-config.mjs";

const root = resolve(".");
const stage = join(root, "release/npm");
const runtime = join(stage, "runtime");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const host = JSON.parse(await readFile(join(root, "packages/host/package.json"), "utf8"));
const version = process.env.KOOYU_NPM_VERSION ?? pkg.version;
if (!/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(version))
  throw new Error("Expected X.Y.Z or X.Y.Z-preview.N for the npm version.");
// Fixed workspace output; never delete a caller-supplied path.
await rm(stage, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
await cp(join(root, "package-lock.json"), join(runtime, "package-lock.json"));
await writeFile(
  join(runtime, "package.json"),
  JSON.stringify(
    {
      name: "kooyu-runtime",
      version,
      private: true,
      type: "module",
    },
    null,
    2,
  ) + "\n",
);
for (const name of ["host", "platform", "protocol"]) {
  const target = join(runtime, "packages", name);
  await mkdir(target, { recursive: true });
  await cp(join(root, "packages", name, "dist"), join(target, "dist"), { recursive: true });
  const original = JSON.parse(await readFile(join(root, "packages", name, "package.json"), "utf8"));
  const manifest = {
    name: original.name,
    version: original.version,
    type: "module",
    exports: original.exports,
    dependencies: original.dependencies,
    license: pkg.license,
    files: ["dist", "LICENSE"],
  };
  await writeFile(join(target, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (name !== "host") {
    // npm's bundledDependencies includes these private, precompiled workspaces.
    // Third-party dependencies are installed for the user's OS by npm.
    const bundled = join(stage, "node_modules/@kodo", name);
    await cp(target, bundled, { recursive: true });
    await cp(join(root, "LICENSE"), join(bundled, "LICENSE"));
  }
}
await mkdir(join(runtime, "apps/web"), { recursive: true });
await cp(join(root, "apps/web/dist"), join(runtime, "apps/web/dist"), { recursive: true });
await mkdir(join(runtime, "docs"), { recursive: true });
await cp(join(root, "docs/verification.json"), join(runtime, "docs/verification.json"));
await mkdir(join(stage, "bin"), { recursive: true });
await cp(join(root, "scripts/npm/kooyu.mjs"), join(stage, "bin/kooyu.mjs"));
await chmod(join(stage, "bin/kooyu.mjs"), 0o755);
await cp(join(root, "LICENSE"), join(stage, "LICENSE"));
await cp(join(root, "docs/npm-package.md"), join(stage, "README.md"));
await writeFile(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "kooyu",
      version,
      description:
        "Kooyu Web: a local-first AI agent workbench with native sessions, projects, schedules and memory",
      type: "module",
      license: pkg.license,
      repository: { type: "git", url: "git+https://github.com/sh2001sh/Kooyu.git" },
      homepage: "https://github.com/sh2001sh/Kooyu#readme",
      bugs: { url: "https://github.com/sh2001sh/Kooyu/issues" },
      engines: { node: ">=24.13.0" },
      bin: { kooyu: "bin/kooyu.mjs" },
      files: ["bin", "runtime", "LICENSE", "README.md"],
      dependencies: host.dependencies,
      bundledDependencies: ["@kodo/platform", "@kodo/protocol"],
      publishConfig: { access: "public", registry: "https://registry.npmjs.org/" },
      keywords: ["kooyu", "ai", "agents", "web", "workbench", "self-hosted"],
    },
    null,
    2,
  ) + "\n",
);
await stageDistribution(runtime);
if (typeof platform.hostBuildId === "function") {
  await writeFile(
    join(runtime, "host-build.json"),
    JSON.stringify({ buildId: platform.hostBuildId(runtime), version }) + "\n",
  );
}
console.log(`Prepared kooyu@${version} in ${stage}`);
