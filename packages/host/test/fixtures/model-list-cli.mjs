const args = process.argv.slice(2);
if (args.join(" ") === "models list --output-format json") {
  process.stdout.write(
    JSON.stringify([
      {
        modelId: "gemini-test",
        displayName: "Gemini Test",
        contextLimits: { inputTokens: 8192, outputTokens: 2048 },
      },
    ]),
  );
} else if (args.join(" ") === "models") {
  if (process.env.SYNTHETIC_GROK_MODELS === "1")
    process.stdout.write(
      "Default model: grok-test\nAvailable models:\n  * grok-test (default)\n  - grok-other\n",
    );
  else
    process.stdout.write(
      "Available models\n\nauto - Auto (current, default)\nmodel-test - Model Test\n",
    );
} else {
  process.stderr.write("unexpected arguments");
  process.exitCode = 1;
}
