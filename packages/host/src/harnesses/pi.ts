import { descriptor, type HarnessAdapter } from "./adapter.js";
import { createKodoKernel } from "../kodo/kernel.js";
import { readSdkHistory, listSdkHistory, inspectSdkSessions } from "./sdk-history.js";
export const piAdapter: HarnessAdapter = {
  descriptor: descriptor(
    "pi",
    "pi",
    "sdk",
    ["directChat", "historyRead", "resume", "observeLive", "steer", "cancel", "usage"],
    "Standalone pi harness: pi SDK / SessionManager 1.5.2 via the shared SDK runner; base tools and native loop; no Kooyu management tools",
    "implemented",
  ),
  connect: createKodoKernel,
  standaloneRead: readSdkHistory,
  standaloneList: listSdkHistory,
  inspectSessions: inspectSdkSessions,
};
