import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const port = Number(process.env.KODO_UI_TEST_PORT ?? 4319);
export default defineConfig({
  testDir: "test",
  globalSetup: "./test/workbench-setup.ts",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 960 },
    headless: true,
  },
  webServer: {
    command: "node ../../packages/host/dist/main.js",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    env: {
      KODO_HOST_PORT: String(port),
      KODO_DATA_DIR: resolve(`../../.local/ui-tests/${Date.now()}`),
    },
    timeout: 30000,
  },
  reporter: "list",
});
