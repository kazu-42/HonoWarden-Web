import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const outputArgument = process.argv.indexOf("--output");
if (outputArgument < 0 || !process.argv[outputArgument + 1]) {
  throw new Error("--output <path> is required");
}

const outputPath = path.resolve(process.argv[outputArgument + 1]);
const roots = ["dist/client", "dist/honowarden_web"];
const files = [];

for (const root of roots) {
  for (const relative of await listFiles(path.resolve(root))) {
    const absolute = path.resolve(root, relative);
    const content = await readFile(absolute);
    files.push({
      path: path.posix.join(root, relative),
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
}

files.sort((left, right) => left.path.localeCompare(right.path));
const manifest = {
  schemaVersion: 1,
  algorithm: "sha256",
  files,
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, serialized);
console.log(
  JSON.stringify(
    {
      status: "pass",
      output: outputPath,
      files: files.length,
      bytes: Buffer.byteLength(serialized),
      sha256: createHash("sha256").update(serialized).digest("hex"),
    },
    null,
    2,
  ),
);

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await listFiles(path.join(directory, entry.name), relative)),
      );
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`refusing non-regular release entry: ${relative}`);
    }
  }
  return files;
}
