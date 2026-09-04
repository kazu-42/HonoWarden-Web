import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

import { JSDOM } from "jsdom";

const clientRoot = path.resolve("dist/client");
const workerRoot = path.resolve("dist/honowarden_web");
const errors = [];
const files = await listFiles(clientRoot);
const workerFiles = await listFiles(workerRoot);
const publicSourceMaps = [
  ...files
    .filter((file) => file.endsWith(".map"))
    .map((file) => path.posix.join("client", file)),
  ...workerFiles
    .filter((file) => file.endsWith(".map"))
    .map((file) => path.posix.join("honowarden_web", file)),
];
if (publicSourceMaps.length > 0) {
  errors.push(`public source maps found: ${publicSourceMaps.join(", ")}`);
}

const generatedWrangler = JSON.parse(
  await readFile(path.join(workerRoot, "wrangler.json"), "utf8"),
);
for (const key of ["configPath", "userConfigPath"]) {
  if (key in generatedWrangler) {
    errors.push(`generated Wrangler config contains checkout metadata: ${key}`);
  }
}
for (const absolutePath of findAbsoluteFilesystemPaths(generatedWrangler)) {
  errors.push(
    `generated Wrangler config contains absolute path: ${absolutePath}`,
  );
}

const htmlPath = path.join(clientRoot, "index.html");
const html = await readFile(htmlPath, "utf8");
const document = new JSDOM(html).window.document;
const runtimeReferences = [];
const thirdPartyRuntimeReferences = [];

for (const element of document.querySelectorAll("[src], [href]")) {
  const value = element.getAttribute("src") ?? element.getAttribute("href");
  if (value) {
    runtimeReferences.push(value);
    if (/^(?:https?:)?\/\//.test(value)) {
      thirdPartyRuntimeReferences.push(value);
      errors.push(`external runtime reference: ${value}`);
    }
  }
}

for (const script of document.querySelectorAll("script")) {
  if (!script.getAttribute("src") || script.textContent?.trim()) {
    errors.push("inline or source-less script found in built HTML");
  }
}
for (const style of document.querySelectorAll("style")) {
  if (style.textContent?.trim()) {
    errors.push("inline style found in built HTML");
  }
}

const textualFiles = files.filter((file) => /\.(?:css|html|js)$/.test(file));
const forbiddenProductionMarkers = [
  "/_local/authenticated-shell",
  "synthetic@example.test",
  "local-preview-access-token",
  "local-preview-refresh-token",
  "serviceWorker.register",
];

for (const relative of textualFiles) {
  const source = await readFile(path.join(clientRoot, relative), "utf8");
  for (const marker of forbiddenProductionMarkers) {
    if (source.includes(marker)) {
      errors.push(
        `${relative} contains production-forbidden marker: ${marker}`,
      );
    }
  }
  if (relative.endsWith(".css")) {
    for (const match of source.matchAll(/url\(([^)]+)\)/g)) {
      const value = match[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
      if (/^(?:https?:)?\/\//.test(value)) {
        thirdPartyRuntimeReferences.push(value);
        errors.push(`${relative} contains external CSS asset: ${value}`);
      }
    }
  }
}

const javascriptGzipBytes = await gzipTotal(files, clientRoot, ".js");
const cssGzipBytes = await gzipTotal(files, clientRoot, ".css");
const budgets = {
  javascriptGzipBytes: 180 * 1024,
  cssGzipBytes: 30 * 1024,
  initialRequests: 8,
};

if (javascriptGzipBytes > budgets.javascriptGzipBytes) {
  errors.push(
    `JavaScript gzip budget exceeded: ${javascriptGzipBytes}/${budgets.javascriptGzipBytes}`,
  );
}
if (cssGzipBytes > budgets.cssGzipBytes) {
  errors.push(
    `CSS gzip budget exceeded: ${cssGzipBytes}/${budgets.cssGzipBytes}`,
  );
}
if (runtimeReferences.length > budgets.initialRequests - 1) {
  errors.push(
    `initial request budget exceeded: ${runtimeReferences.length + 1}/${budgets.initialRequests}`,
  );
}

const report = {
  status: errors.length === 0 ? "pass" : "fail",
  clientFiles: files.length,
  workerFiles: workerFiles.length,
  publicSourceMaps: publicSourceMaps.length,
  runtimeReferences: runtimeReferences.length,
  thirdPartyRuntimeReferences: thirdPartyRuntimeReferences.length,
  javascriptGzipBytes,
  cssGzipBytes,
  budgets,
  errors,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exitCode = 1;
}

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
      errors.push(`non-regular build entry: ${relative}`);
    }
  }
  return files;
}

async function gzipTotal(files, root, extension) {
  let total = 0;
  for (const file of files.filter((candidate) =>
    candidate.endsWith(extension),
  )) {
    total += gzipSync(await readFile(path.join(root, file))).byteLength;
  }
  return total;
}

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
