import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { build as bundle } from "esbuild";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "account-worker",
      async generateBundle() {
        const result = await bundle({
          entryPoints: ["src/account-worker.ts"],
          bundle: true,
          format: "iife",
          platform: "browser",
          write: false,
          target: "es2022",
          minify: true,
        });
        this.emitFile({
          type: "asset",
          fileName: "account-worker.js",
          source: result.outputFiles[0]!.text,
        });
      },
    },
  ],
  server: { proxy: { "/api": "http://127.0.0.1:4310" } },
  build: { target: "esnext", minify: false },
});
