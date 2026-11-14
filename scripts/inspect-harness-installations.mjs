import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  inspectInstallation,
  launchDefaults,
  resolveInstallationModes,
} from "../packages/host/dist/configuration/config.js";

const dataDirIndex = process.argv.indexOf("--data-dir");
if (dataDirIndex >= 0 && !process.argv[dataDirIndex + 1])
  throw new Error("--data-dir requires a path");
const appData =
  process.platform === "win32"
    ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : (process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"));
const dataDir =
  dataDirIndex >= 0
    ? resolve(process.argv[dataDirIndex + 1])
    : process.env.KODO_DATA_DIR
      ? resolve(process.env.KODO_DATA_DIR)
      : join(appData, "Kodo", "host");
const rows = Object.keys(launchDefaults).map((id) => {
  const installation = inspectInstallation(dataDir, id);
  return {
    id,
    selected: installation.ready ? installation.launch.source : null,
    modes: resolveInstallationModes(id, installation.desktops),
    desktops: installation.desktops,
  };
});
if (process.argv.includes("--json"))
  console.log(JSON.stringify({ dataDir, harnesses: rows }, null, 2));
else
  console.table(
    rows.map((row) => ({
      harness: row.id,
      selected: row.selected ?? "none",
      cliOnly: row.modes.cliOnly.source ?? "unavailable",
      desktopOnly: row.modes.desktopOnly.source ?? "unavailable",
      desktopCount: row.desktops.length,
    })),
  );
