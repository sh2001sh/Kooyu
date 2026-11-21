import { ensureHost } from "./host-client.js";
// Run independently of the UI after an installer replaces application files.
const resources = process.argv[2];
if (!resources) throw new Error("Missing installation resources directory");
const MAX_ATTEMPTS = 120; // 30 minutes max so the helper cannot spin forever
for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
  try {
    await ensureHost(resources);
    break;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    if (!/任务|待处理消息|正在切换|暂缓|稍后/.test(message) || attempt === MAX_ATTEMPTS - 1) {
      process.exitCode = 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
}
