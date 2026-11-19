import { copyFile, mkdir } from "node:fs/promises";

// Keep development, tray, window and packaged assets on the approved brand.
const assets = new URL("../apps/desktop/assets/", import.meta.url);
await mkdir(assets, { recursive: true });
for (const [size, name] of [
  [32, "tray.png"],
  [256, "app.png"],
])
  await copyFile(
    new URL(`../brand/icons/kooyu-app-${size}.png`, import.meta.url),
    new URL(name, assets),
  );
