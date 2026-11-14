if (process.argv[2] === "session" && process.argv[3] === "list") {
  process.stdout.write(
    JSON.stringify([{ id: "native-acp-test", sessionDir: process.env.SYNTHETIC_KIMI_SESSION_DIR }]),
  );
} else if (process.argv[2] === "acp") await import("./native-peer.mjs");
else process.exit(2);
