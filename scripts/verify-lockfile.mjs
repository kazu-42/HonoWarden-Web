import { readFile } from "node:fs/promises";
import process from "node:process";

import { parse } from "yaml";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const workspace = parse(await readFile("pnpm-workspace.yaml", "utf8"));
const lockfile = parse(await readFile("pnpm-lock.yaml", "utf8"));
const errors = [];

if (String(lockfile.lockfileVersion) !== "9.0") {
  errors.push(`unexpected lockfile version: ${lockfile.lockfileVersion}`);
}

const direct = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};
const importer = lockfile.importers?.["."] ?? {};
const lockedDirect = {
  ...(importer.dependencies ?? {}),
  ...(importer.devDependencies ?? {}),
};

for (const [name, expected] of Object.entries(direct)) {
  if (
    typeof expected !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(expected)
  ) {
    errors.push(`${name} is not pinned to an exact version: ${expected}`);
    continue;
  }
  if (lockedDirect[name]?.specifier !== expected) {
    errors.push(
      `${name} lockfile specifier mismatch: ${lockedDirect[name]?.specifier ?? "missing"}`,
    );
  }
}

for (const name of Object.keys(lockedDirect)) {
  if (!(name in direct)) {
    errors.push(`lockfile has undeclared direct dependency: ${name}`);
  }
}

const packages = Object.entries(lockfile.packages ?? {});
const snapshots = Object.keys(lockfile.snapshots ?? {});
if (snapshots.length !== packages.length) {
  errors.push(
    `package/snapshot count mismatch: ${packages.length}/${snapshots.length}`,
  );
}
for (const [name, metadata] of packages) {
  const resolution = metadata?.resolution;
  if (!resolution || typeof resolution.integrity !== "string") {
    errors.push(`${name} has no registry integrity value`);
    continue;
  }
  if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(resolution.integrity)) {
    errors.push(`${name} has unexpected integrity format`);
  }
  if ("tarball" in resolution) {
    errors.push(`${name} overrides its registry tarball URL`);
  }
}

const allowedBuilds = workspace.allowBuilds ?? {};
const expectedBuilds = ["esbuild", "sharp", "workerd"];
for (const name of expectedBuilds) {
  if (allowedBuilds[name] !== true) {
    errors.push(`${name} install script is not explicitly allowed`);
  }
}

if (
  typeof workspace.minimumReleaseAge !== "number" ||
  !Number.isFinite(workspace.minimumReleaseAge) ||
  workspace.minimumReleaseAge < 1440
) {
  errors.push(
    `minimum release age is too short: ${String(workspace.minimumReleaseAge)}`,
  );
}
if (workspace.minimumReleaseAgeStrict !== true) {
  errors.push("minimum release age strict mode is not enabled");
}
for (const name of Object.keys(allowedBuilds)) {
  if (!expectedBuilds.includes(name)) {
    errors.push(`unexpected install-script allowlist entry: ${name}`);
  }
}

const releaseAgeExceptions = workspace.minimumReleaseAgeExclude ?? [];
for (const exception of releaseAgeExceptions) {
  if (typeof exception !== "string" || !exception.includes("@")) {
    errors.push(`invalid minimum-release-age exception: ${String(exception)}`);
  }
}

const report = {
  status: errors.length === 0 ? "pass" : "fail",
  lockfileVersion: String(lockfile.lockfileVersion),
  directDependencies: Object.keys(direct).length,
  lockedPackages: packages.length,
  lockedSnapshots: snapshots.length,
  allowedBuildScripts: expectedBuilds,
  minimumReleaseAgeMinutes: workspace.minimumReleaseAge,
  minimumReleaseAgeExceptions: releaseAgeExceptions.length,
  errors,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exitCode = 1;
}
