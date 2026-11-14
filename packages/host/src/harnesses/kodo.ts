import { descriptor, type HarnessAdapter } from "./adapter.js";
import { createKodoKernel } from "../kodo/kernel.js";
import { readSdkHistory, listSdkHistory, inspectSdkSessions } from "./sdk-history.js";

export const kodoAdapter: HarnessAdapter = {
  descriptor: descriptor(
    "kodo",
    "Kooyu",
    "sdk",
    ["directChat", "historyRead", "resume", "observeLive", "steer", "cancel", "usage"],
    "Kooyu product agent; Kooyu kernel (built on the pi SDK agent loop and SessionManager) with Host product tools; distinct from the standalone pi harness",
    "implemented",
  ),
  connect: createKodoKernel,
  standaloneRead: readSdkHistory,
  standaloneList: listSdkHistory,
  inspectSessions: inspectSdkSessions,
};
