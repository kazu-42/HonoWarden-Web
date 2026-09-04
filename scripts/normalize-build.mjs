import { Buffer } from "node:buffer";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootArgument = process.argv.indexOf("--root");
if (rootArgument < 0 || !process.argv[rootArgument + 1]) {
  throw new Error("--root <build-directory> is required");
}

const buildRoot = path.resolve(process.argv[rootArgument + 1]);
const configPath = path.join(buildRoot, "honowarden_web", "wrangler.json");
const configuration = JSON.parse(await readFile(configPath, "utf8"));
const removed = [];

for (const key of ["configPath", "userConfigPath"]) {
  if (key in configuration) {
    delete configuration[key];
    removed.push(key);
  }
}

const absoluteValues = findAbsoluteFilesystemPaths(configuration);
if (absoluteValues.length > 0) {
  throw new Error(
    `generated Wrangler config contains absolute paths: ${absoluteValues.join(", ")}`,
  );
}

const serialized = `${JSON.stringify(configuration)}\n`;
const temporaryPath = `${configPath}.tmp-${process.pid}`;
await writeFile(temporaryPath, serialized, { flag: "wx" });
await rename(temporaryPath, configPath);

console.log(
  JSON.stringify(
    {
      status: "pass",
      root: buildRoot,
      file: configPath,
      removed,
      bytes: Buffer.byteLength(serialized, "utf8"),
    },
    null,
    2,
  ),
);

function findAbsoluteFilesystemPaths(value, keyPath = "$") {
  if (typeof value === "string") {
    return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
      ? [`${keyPath}=${value}`]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findAbsoluteFilesystemPaths(entry, `${keyPath}[${index}]`),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      findAbsoluteFilesystemPaths(entry, `${keyPath}.${key}`),
    );
  }
  return [];
}
