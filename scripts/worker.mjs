import { runWorker } from "../packages/host/dist/execution/worker.js";
if (!process.argv[2]) throw new Error("Usage: node scripts/worker.mjs <config.json>");
await runWorker(process.argv[2]);
