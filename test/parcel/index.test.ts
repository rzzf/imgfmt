import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Parcel } from "@parcel/core";
import { build as buildModule } from "esbuild";
import { afterEach, describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtureSource = fileURLToPath(new URL("./fixtures/basic", import.meta.url));
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { force: true, recursive: true })));
  temporaryRoots.clear();
});

describe("imgfmt/parcel", () => {
  it("runs after project PostCSS plugins and before Parcel collects image dependencies", async () => {
    const root = await mkdtemp(join(tmpdir(), "imgfmt-parcel-"));
    const outputDirectory = join(root, "dist");
    temporaryRoots.add(root);

    await cp(fixtureSource, root, { recursive: true });
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await installLocalImgfmtPackage(root);

    const bundler = new Parcel({
      defaultConfig: require.resolve("@parcel/config-default"),
      entries: [join(root, "index.html")],
      logLevel: "none",
      mode: "production",
      shouldDisableCache: true,
      targets: {
        web: {
          context: "browser",
          distDir: outputDirectory,
          publicUrl: "./",
          optimize: false,
          sourceMap: false,
        },
      },
    });

    const event = await bundler.run();
    expect(event.type).toBe("buildSuccess");

    const files = await listFiles(outputDirectory);
    const html = await readFile(join(outputDirectory, "index.html"), "utf8");
    const cssFile = requiredFile(files, (file) => file.endsWith(".css"), "CSS asset");
    const css = await readFile(join(outputDirectory, cssFile), "utf8");
    const runtime = requiredInlineRuntime(html);

    expect(css).not.toContain(".purge-me");
    expect(css).toContain(".imported");
    expect(css).toContain("data-imgcaps");
    expect(css).toContain("background-image");
    expect(css).toContain("-webkit-mask-image");
    expect(css).toContain("mask-image");
    expect(css).toContain(".webp");
    expect(css).toContain(".avif");
    expect(files.filter((file) => file.endsWith(".png"))).toHaveLength(2);
    expect(files.filter((file) => file.endsWith(".webp"))).toHaveLength(2);
    expect(files.filter((file) => file.endsWith(".avif"))).toHaveLength(2);
    expect(html).toContain('<html lang="en" data-imgcaps="pending">');
    expect(html).not.toMatch(/<script[^>]*data-imgfmt-runtime[^>]*(?:async|src=|type=)/);
    expect(runtime).toContain("new ImageConstructor()");
    expect(runtime).not.toContain("Promise");
  }, 30_000);
});

async function installLocalImgfmtPackage(root: string): Promise<void> {
  const packageRoot = join(root, "node_modules", "imgfmt");
  const outputFile = join(packageRoot, "dist", "parcel.cjs");
  const postcssPackageRoot = dirname(require.resolve("postcss/package.json"));
  const posthtmlPackageRoot = dirname(require.resolve("posthtml/package.json"));

  await mkdir(dirname(outputFile), { recursive: true });
  await buildModule({
    bundle: true,
    entryPoints: [join(repositoryRoot, "src", "parcel.ts")],
    format: "cjs",
    outfile: outputFile,
    platform: "node",
    target: "node20",
  });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      exports: {
        "./parcel": "./dist/parcel.cjs",
      },
      name: "imgfmt",
      type: "module",
      version: "0.0.0",
    }),
  );
  await symlink(
    postcssPackageRoot,
    join(root, "node_modules", "postcss"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await symlink(
    posthtmlPackageRoot,
    join(root, "node_modules", "posthtml"),
    process.platform === "win32" ? "junction" : "dir",
  );
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = join(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

function requiredFile(
  files: readonly string[],
  predicate: (file: string) => boolean,
  description: string,
): string {
  const file = files.find(predicate);

  if (file === undefined) {
    throw new Error(`Missing ${description}`);
  }

  return file;
}

function requiredInlineRuntime(html: string): string {
  const matches = [
    ...html.matchAll(/<script\b[^>]*data-imgfmt-runtime[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  const source = matches[0]?.[1];

  if (matches.length !== 1 || source === undefined) {
    throw new Error(`Expected one inline imgfmt runtime, found ${matches.length}`);
  }

  return source;
}
