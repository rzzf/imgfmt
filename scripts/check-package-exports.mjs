import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packages = [
  ["@imgfmt-internal/core", "../packages/core/"],
  ["imgfmt", "../packages/imgfmt/"],
  ["@imgfmt-internal/parcel", "../packages/parcel/"],
  ["@imgfmt-internal/postcss", "../packages/postcss/"],
  ["@imgfmt-internal/runtime", "../packages/runtime/"],
  ["@imgfmt-internal/unplugin", "../packages/unplugin/"],
];

for (const [packageName, relativeDirectory] of packages) {
  const cwd = fileURLToPath(new URL(relativeDirectory, import.meta.url));

  runNode(
    cwd,
    "commonjs",
    `const value=require(${JSON.stringify(packageName)});if(!value||typeof value!=="object")process.exit(1);`,
  );
  runNode(
    cwd,
    "module",
    `const value=await import(${JSON.stringify(packageName)});if(!value||typeof value!=="object")process.exit(1);`,
  );
}

console.log(
  `Verified import and require(ESM) for ${packages.length} package entries on ${process.version}.`,
);

function runNode(cwd, inputType, source) {
  const result = spawnSync(process.execPath, [`--input-type=${inputType}`, "--eval", source], {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`Package export smoke test failed in ${cwd}:\n${details}`);
  }
}
