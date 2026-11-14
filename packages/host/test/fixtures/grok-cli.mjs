if (process.argv[2] === "export") {
  if (process.argv[3] !== "native-acp-test") process.exit(2);
  process.stdout.write("## User\n\nSynthetic prompt\n\n## Assistant\n\nSynthetic reply\n");
} else if (process.argv[2] === "agent" && process.argv.at(-1) === "stdio") {
  process.argv[2] = "acp";
  await import("./native-peer.mjs");
} else process.exit(2);
