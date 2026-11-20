import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error("Expected a numeric base version.");
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const run = event.workflow_run;
let stable = false;
if (run) {
  if (
    run.conclusion !== "success" ||
    run.head_repository?.full_name !== process.env.GITHUB_REPOSITORY
  )
    throw new Error("Only a successful release build from this repository can publish.");
  stable = run.head_branch === `v${pkg.version}`;
  if (!stable && run.head_branch !== "main") throw new Error("Unexpected release branch or tag.");
} else {
  if (process.env.GITHUB_REF !== "refs/heads/main")
    throw new Error("Run npm publishing from main.");
  stable = event.inputs?.channel === "latest";
}
const number = run?.run_number ?? process.env.GITHUB_RUN_ID;
if (!/^\d+$/.test(String(number))) throw new Error("Missing unique preview build number.");
console.log(`version=${pkg.version}${stable ? "" : "-preview." + number}`);
console.log(`tag=${stable ? "latest" : "next"}`);
