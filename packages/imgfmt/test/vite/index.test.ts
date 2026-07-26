import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build, createServer, type Plugin } from "vite-official";
import { describe, expect, it } from "vite-plus/test";

import { createDevelopmentRuntimeMiddleware } from "../../src/unplugin";
import imgfmt from "../../src/vite";

const fixtureRoot = fileURLToPath(new URL("../fixtures/vite-basic", import.meta.url));

describe("imgfmt/vite", () => {
  it("builds CSS candidates and an asynchronous external capability runtime", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "imgfmt-vite-"));
    const outputDirectory = join(temporaryRoot, "dist");

    try {
      await build({
        base: "./",
        build: {
          assetsInlineLimit: 0,
          outDir: outputDirectory,
        },
        logLevel: "silent",
        plugins: [createImgfmtVitePlugin()],
        root: fixtureRoot,
      });

      const html = await readFile(join(outputDirectory, "index.html"), "utf8");
      const assets = await readdir(join(outputDirectory, "assets"));
      const cssFile = requiredFile(assets, (file) => file.endsWith(".css"), "CSS asset");
      const runtimeFile = requiredFile(
        assets,
        (file) => file.startsWith("imgfmt-runtime-") && file.endsWith(".js"),
        "imgfmt runtime asset",
      );
      const css = await readFile(join(outputDirectory, "assets", cssFile), "utf8");
      const runtime = await readFile(join(outputDirectory, "assets", runtimeFile), "utf8");
      const runtimeTag = html.match(/<script[^>]*data-imgfmt-runtime[^>]*><\/script>/)?.[0];

      expect(html).toContain('<html data-imgcaps="pending"');
      expect(runtimeTag).toContain(" async");
      expect(runtimeTag).toContain(`src="./assets/${runtimeFile}"`);
      expect(css).toContain("data-imgcaps");
      expect(css).toContain("no-avif");
      expect(css).toContain("no-webp");
      expect(assets.some((file) => file.endsWith(".avif"))).toBe(true);
      expect(assets.some((file) => file.endsWith(".webp"))).toBe(true);
      expect(assets.some((file) => file.endsWith(".png"))).toBe(true);
      expect(runtime).toContain("new I()");
      expect(runtime).not.toContain("Promise");
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("computes a relative runtime URL for nested HTML output", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "imgfmt-vite-nested-"));
    const outputDirectory = join(temporaryRoot, "dist");

    try {
      await build({
        base: "./",
        build: {
          outDir: outputDirectory,
          rolldownOptions: {
            input: join(fixtureRoot, "nested/index.html"),
          },
        },
        logLevel: "silent",
        plugins: [createImgfmtVitePlugin()],
        root: fixtureRoot,
      });

      const html = await readFile(join(outputDirectory, "nested/index.html"), "utf8");
      const assets = await readdir(join(outputDirectory, "assets"));
      const runtimeFile = requiredFile(
        assets,
        (file) => file.startsWith("imgfmt-runtime-") && file.endsWith(".js"),
        "imgfmt runtime asset",
      );

      expect(html).toContain(`src="../assets/${runtimeFile}"`);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("serves the non-blocking runtime under Vite's development base", async () => {
    const server = await createServer({
      base: "/app/",
      logLevel: "silent",
      plugins: [createImgfmtVitePlugin()],
      root: fixtureRoot,
      server: {
        middlewareMode: true,
      },
    });

    try {
      const sourceHtml = await readFile(join(fixtureRoot, "index.html"), "utf8");
      const transformedHtml = await server.transformIndexHtml("/app/", sourceHtml);
      const headers = new Map<string, string>();
      let body: string | undefined;
      let nextCalled = false;
      const middleware = createDevelopmentRuntimeMiddleware("/app/", "runtime source");

      middleware(
        { method: "GET", originalUrl: "/app/@imgfmt/runtime.js?direct" },
        {
          statusCode: 0,
          end(value): void {
            body = value;
          },
          setHeader(name, value): void {
            headers.set(name.toLowerCase(), value);
          },
        },
        (): void => {
          nextCalled = true;
        },
      );

      expect(nextCalled).toBe(false);
      expect(headers.get("content-type")).toContain("text/javascript");
      expect(body).toBe("runtime source");
      expect(transformedHtml).toContain('data-imgcaps="pending"');
      expect(transformedHtml).toContain('src="/app/@imgfmt/runtime.js"');
      expect(transformedHtml).toMatch(/<script[^>]*async[^>]*data-imgfmt-runtime/);
      await expect(
        server.transformIndexHtml(
          "/app/",
          '<html data-imgcaps="ready"><head></head><body></body></html>',
        ),
      ).rejects.toThrow("owns the data-imgcaps attribute");
      await expect(
        server.transformIndexHtml(
          "/app/",
          '<html data-imgcaps="pending" data-imgcaps="pending"><head></head></html>',
        ),
      ).rejects.toThrow("owns the data-imgcaps attribute");
      await expect(
        server.transformIndexHtml(
          "/app/",
          '<html><head><script data-imgfmt-runtime src="other.js"></script></head></html>',
        ),
      ).rejects.toThrow("owns the data-imgfmt-runtime attribute");
    } finally {
      await server.close();
    }
  });

  it("normalizes a relative development base before injecting the runtime URL", async () => {
    const server = await createServer({
      base: "./",
      logLevel: "silent",
      plugins: [createImgfmtVitePlugin()],
      root: fixtureRoot,
      server: {
        middlewareMode: true,
      },
    });

    try {
      const sourceHtml = await readFile(join(fixtureRoot, "index.html"), "utf8");
      const transformedHtml = await server.transformIndexHtml("/", sourceHtml);

      expect(transformedHtml).toContain('src="/@imgfmt/runtime.js"');
    } finally {
      await server.close();
    }
  });

  it("rejects library builds that cannot install the document bootstrap", async () => {
    await expect(
      build({
        build: {
          lib: {
            entry: join(fixtureRoot, "src/main.js"),
            formats: ["es"],
          },
          write: false,
        },
        logLevel: "silent",
        plugins: [createImgfmtVitePlugin()],
        root: fixtureRoot,
      }),
    ).rejects.toThrow("requires an HTML application build");
  });

  it("rejects SSR builds that cannot install the document bootstrap", async () => {
    await expect(
      build({
        build: {
          ssr: join(fixtureRoot, "src/main.js"),
          ssrEmitAssets: true,
          write: false,
        },
        logLevel: "silent",
        plugins: [createImgfmtVitePlugin()],
        root: fixtureRoot,
      }),
    ).rejects.toThrow("supports document/client builds only");
  });

  it("rejects JavaScript-only builds that cannot install the document bootstrap", async () => {
    await expect(
      build({
        build: {
          rolldownOptions: {
            input: join(fixtureRoot, "src/main.js"),
          },
          write: false,
        },
        logLevel: "silent",
        plugins: [createImgfmtVitePlugin()],
        root: fixtureRoot,
      }),
    ).rejects.toThrow("requires at least one HTML entry");
  });

  it("rejects duplicate runtime ownership", async () => {
    await expect(
      build({
        build: { write: false },
        logLevel: "silent",
        plugins: [
          createImgfmtVitePlugin({ postcss: "manual" }),
          createImgfmtVitePlugin({ postcss: "manual" }),
        ],
        root: fixtureRoot,
      }),
    ).rejects.toThrow(/data-imgfmt-runtime|runtime asset/);
  });

  it("requires manual mode when Vite would load an external PostCSS config", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "imgfmt-postcss-config-"));

    try {
      await writeFile(join(temporaryRoot, "postcss.config.mjs"), "export default {};\n");

      await expect(
        createServer({
          logLevel: "silent",
          plugins: [createImgfmtVitePlugin()],
          root: temporaryRoot,
        }),
      ).rejects.toThrow('add imgfmt/postcss there and set postcss: "manual"');
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("does not scan for PostCSS config above Vite's workspace boundary", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "imgfmt-workspace-boundary-"));
    const workspaceRoot = join(temporaryRoot, "workspace");
    const applicationRoot = join(workspaceRoot, "app");

    try {
      await mkdir(applicationRoot, { recursive: true });
      await writeFile(join(temporaryRoot, "postcss.config.mjs"), "export default {};\n");
      await writeFile(join(workspaceRoot, "pnpm-workspace.yaml"), "packages:\n  - app\n");
      await writeFile(join(applicationRoot, "package.json"), '{"private":true}\n');

      const server = await createServer({
        logLevel: "silent",
        plugins: [createImgfmtVitePlugin()],
        root: applicationRoot,
        server: {
          middlewareMode: true,
        },
      });

      await server.close();
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});

function createImgfmtVitePlugin(options?: Parameters<typeof imgfmt>[0]): Plugin {
  // The workspace installs Vite+ core as `vite` and official Vite under an alias.
  // Avoid recursively comparing the two otherwise compatible Plugin identities.
  return imgfmt(options) as unknown as Plugin;
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
