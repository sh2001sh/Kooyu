// Launch the installed OpenCode native server in its own bundled Node runtime.
// The archive stays in place; login and provider resolution remain native.
import { pathToFileURL } from "node:url";

const option = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const entry = option("--native-entry");
const hostname = option("--hostname");
const port = Number(option("--port"));
if (
  !entry ||
  hostname !== "127.0.0.1" ||
  !Number.isInteger(port) ||
  !process.env.OPENCODE_SERVER_PASSWORD
)
  throw new Error("OpenCode 桌面服务启动参数不完整。");

// Keep loopback calls local when the desktop user's proxy variables are present.
for (const key of ["NO_PROXY", "no_proxy"])
  process.env[key] = [process.env[key], "127.0.0.1", "localhost", "::1"].filter(Boolean).join(",");
const { Server } = await import(pathToFileURL(entry).href);
const listener = await Server.listen({
  hostname,
  port,
  username: "opencode",
  password: process.env.OPENCODE_SERVER_PASSWORD,
  cors: [],
});
console.log("OpenCode desktop native server ready");
const stop = async () => {
  await listener.stop();
  process.exit(0);
};
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
process.stdin.resume();
process.stdin.once("end", () => {
  void stop();
});
