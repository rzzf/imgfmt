import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

const tarball = process.env.RELEASE_TARBALL;
const tag = process.env.TAG_VERSION;
const gitHead = process.env.GIT_HEAD;

if (!tarball || !tag || !gitHead) {
  throw new TypeError("RELEASE_TARBALL, TAG_VERSION and GIT_HEAD must all be set");
}

if (!statSync(tarball).isFile()) {
  throw new TypeError(`Release tarball is missing: ${tarball}`);
}

function readTar(args, encoding) {
  const result = spawnSync("tar", args, {
    encoding,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new TypeError(`Unable to inspect release tarball: ${String(result.stderr)}`);
  }

  return result.stdout;
}

function readEntry(path) {
  const value = readTar(["-xOf", tarball, path]);

  if (value.length === 0) {
    throw new TypeError(`Release tarball entry is empty: ${path}`);
  }

  return value;
}

const entries = readTar(["-tzf", tarball], "utf8").split("\n").filter(Boolean);
const entrySet = new Set(entries);

if (entrySet.size !== entries.length) {
  throw new TypeError("Release tarball contains duplicate entries");
}

for (const entry of entries) {
  if (
    !["package/LICENSE", "package/README.md", "package/package.json"].includes(entry) &&
    !entry.startsWith("package/dist/")
  ) {
    throw new TypeError(`Unexpected release tarball entry: ${entry}`);
  }
}

for (const entry of [
  "package/LICENSE",
  "package/README.md",
  "package/dist/index.d.ts",
  "package/dist/index.js",
  "package/package.json",
]) {
  if (!entrySet.has(entry)) {
    throw new TypeError(`Required release tarball entry is missing: ${entry}`);
  }

  readEntry(entry);
}

const manifest = JSON.parse(readEntry("package/package.json").toString("utf8"));

if (manifest.name !== "imgfmt" || manifest.version !== tag || manifest.gitHead !== gitHead) {
  throw new TypeError("Release manifest identity does not match the GitHub Release");
}

if (
  manifest.repository?.url !== "git+https://github.com/rzzf/imgfmt.git" ||
  manifest.repository?.directory !== "packages/imgfmt" ||
  manifest.publishConfig?.access !== "public"
) {
  throw new TypeError("Release manifest repository or publishing metadata is invalid");
}

if ("private" in manifest || "scripts" in manifest || "devDependencies" in manifest) {
  throw new TypeError("Release manifest contains private or development-only fields");
}

for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  for (const [name, version] of Object.entries(manifest[field] ?? {})) {
    if (name.startsWith("@imgfmt-internal/")) {
      throw new TypeError(`Private package leaked into release tarball: ${name}`);
    }

    if (typeof version === "string" && /^(?:catalog|file|link|portal|workspace):/.test(version)) {
      throw new TypeError(`Unresolved ${field} entry in release tarball: ${name}@${version}`);
    }
  }
}

const rootExport = manifest.exports?.["."];

if (
  manifest.main !== "./dist/index.js" ||
  manifest.types !== "./dist/index.d.ts" ||
  rootExport?.types !== "./dist/index.d.ts" ||
  rootExport?.["module-sync"] !== "./dist/index.js" ||
  rootExport?.default !== "./dist/index.js"
) {
  throw new TypeError("Release manifest entry points are invalid");
}

console.log(`Verified release tarball for imgfmt@${tag}`);
