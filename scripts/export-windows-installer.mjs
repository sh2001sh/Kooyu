import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

// Create a new file using the destination folder's inherited permissions.
// Copying security descriptors from a Low-integrity build workspace would
// make Windows start the published installer with the same restricted token.
const [sourceArg, directoryArg] = process.argv.slice(2);
if (!sourceArg || !directoryArg)
  throw new Error(
    "Usage: node scripts/export-windows-installer.mjs <installer.exe> <output-directory>",
  );
const source = resolve(sourceArg);
const directory = resolve(directoryArg);
const destination = join(directory, basename(source));
if (!source.toLowerCase().endsWith(".exe")) throw new Error("Expected a Windows installer .exe");
await stat(source);
await mkdir(directory, { recursive: true });
// Never overwrite a user's existing release or retain an existing file label.
const output = await open(destination, "wx");
try {
  for await (const chunk of createReadStream(source)) {
    let offset = 0;
    while (offset < chunk.length) {
      const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset);
      if (bytesWritten === 0) throw new Error("Installer export could not write data");
      offset += bytesWritten;
    }
  }
} finally {
  await output.close();
}
async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
const [expected, actual] = await Promise.all([checksum(source), checksum(destination)]);
if (expected !== actual) throw new Error("Exported installer checksum does not match");
console.log(JSON.stringify({ source, destination, sha256: actual }, null, 2));
