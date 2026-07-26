import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep as pathSeparator } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = resolve(repositoryRoot, "packages/imgfmt");

function parseReleaseVersion(tag) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag);

  if (!match) {
    throw new TypeError(
      `Release tag must be an unprefixed semantic version without build metadata, received: ${tag}`,
    );
  }

  if (
    match[4]?.split(".").some((identifier) => /^\d+$/.test(identifier) && /^0\d/.test(identifier))
  ) {
    throw new TypeError("Release tag contains a numeric prerelease identifier with a leading zero");
  }

  return { isPrerelease: match[4] !== undefined, version: tag };
}

function validateReleaseChannel(isPrerelease, npmTag, releasePrerelease) {
  const expectedTag = isPrerelease ? "next" : "latest";

  if (npmTag !== expectedTag) {
    throw new TypeError(
      `Release channel mismatch: expected npm tag ${expectedTag}, received ${npmTag}`,
    );
  }

  if (!["true", "false"].includes(releasePrerelease)) {
    throw new TypeError(`Invalid GitHub prerelease flag: ${releasePrerelease}`);
  }

  if ((releasePrerelease === "true") !== isPrerelease) {
    throw new TypeError("GitHub prerelease flag and release tag do not agree");
  }
}

function validateSourceDependencies(manifest) {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (name.startsWith("@imgfmt-internal/")) {
        throw new TypeError(`Private package leaked into release manifest: ${name}`);
      }

      if (typeof version === "string" && /^(?:file|link|portal):/.test(version)) {
        throw new TypeError(`Unresolved ${field} entry in release manifest: ${name}@${version}`);
      }
    }
  }
}

async function assertNonEmptyFile(path) {
  const file = await stat(path);

  if (!file.isFile() || file.size === 0) {
    throw new TypeError(`Expected release file is missing or empty: ${path}`);
  }
}

async function main() {
  const tag = process.env.TAG_VERSION;
  const gitHead = process.env.GIT_HEAD;
  const npmTag = process.env.NPM_TAG;
  const releasePrerelease = process.env.RELEASE_PRERELEASE;
  const releaseDirectoryInput = process.env.RELEASE_DIR;

  if (!tag || !gitHead || !npmTag || !releasePrerelease || !releaseDirectoryInput) {
    throw new TypeError(
      "TAG_VERSION, GIT_HEAD, NPM_TAG, RELEASE_PRERELEASE and RELEASE_DIR must all be set",
    );
  }

  if (!/^[0-9a-f]{40}$/i.test(gitHead)) {
    throw new TypeError(`GIT_HEAD must be a full 40-character commit SHA, received: ${gitHead}`);
  }

  const { isPrerelease, version } = parseReleaseVersion(tag);
  validateReleaseChannel(isPrerelease, npmTag, releasePrerelease);

  const manifestPath = resolve(packageRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest.name !== "imgfmt") {
    throw new TypeError(`Expected to prepare imgfmt, received: ${manifest.name}`);
  }

  if (manifest.private !== false) {
    throw new TypeError(
      "Refusing to publish while packages/imgfmt/package.json does not explicitly set private to false",
    );
  }

  if (manifest.publishConfig?.access !== "public") {
    throw new TypeError("imgfmt must explicitly opt in to public npm publishing");
  }

  validateSourceDependencies(manifest);
  await assertNonEmptyFile(resolve(packageRoot, "dist/index.js"));
  await assertNonEmptyFile(resolve(packageRoot, "dist/index.d.ts"));
  await assertNonEmptyFile(resolve(repositoryRoot, "LICENSE"));
  await assertNonEmptyFile(resolve(repositoryRoot, "README.md"));

  manifest.version = version;
  manifest.gitHead = gitHead;
  delete manifest.private;
  delete manifest.devDependencies;
  delete manifest.scripts;

  const releaseDirectory = resolve(releaseDirectoryInput);
  const releasePathFromRoot = relative(repositoryRoot, releaseDirectory);

  if (
    releasePathFromRoot === "" ||
    releasePathFromRoot === ".." ||
    releasePathFromRoot.startsWith(`..${pathSeparator}`) ||
    isAbsolute(releasePathFromRoot)
  ) {
    throw new TypeError("RELEASE_DIR must be a child of the repository root");
  }

  await mkdir(releaseDirectory, { recursive: true });
  await cp(resolve(packageRoot, "dist"), resolve(releaseDirectory, "dist"), { recursive: true });
  await cp(resolve(repositoryRoot, "LICENSE"), resolve(releaseDirectory, "LICENSE"));
  await cp(resolve(repositoryRoot, "README.md"), resolve(releaseDirectory, "README.md"));
  await writeFile(
    resolve(releaseDirectory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`Prepared imgfmt@${version} from ${gitHead}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
