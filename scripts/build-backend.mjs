#!/usr/bin/env node
/** Build the production actor with the pinned public Motoko toolchain. */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import { MAX_STABLE_PAGES, ROOT, mopsPackageArgs, runMoc } from "./motoko-toolchain.mjs";

const DEFAULT_OUTPUT = join(ROOT, ".build", "hackathon.wasm");
const DEFAULT_SOURCE = join(ROOT, "backend", "main.mo");

function parseArgs(argv) {
  const options = {
    check: false,
    replaceWithGzip: false,
    output: DEFAULT_OUTPUT,
    source: DEFAULT_SOURCE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--replace-with-gzip") options.replaceWithGzip = true;
    else if (arg === "--output" || arg === "-o") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a path`);
      options.output = resolve(ROOT, value);
    } else if (arg === "--source") {
      const value = argv[++i];
      if (!value) throw new Error("--source needs a path");
      options.source = resolve(ROOT, value);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.check && options.replaceWithGzip) {
    throw new Error("--check and --replace-with-gzip cannot be combined");
  }
  return options;
}

function deterministicGzip(source, destination) {
  // `-n` strips filename and timestamp fields. The same wasm now produces the
  // same deploy artifact regardless of checkout path or build time.
  const result = spawnSync("gzip", ["-n", "-9", "-c", source], {
    cwd: ROOT,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gzip failed: ${result.stderr?.toString().trim() || `exit ${result.status}`}`);
  }
  writeFileSync(destination, result.stdout);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packages = mopsPackageArgs();
  // moc records source names in the module. A repository-relative entrypoint
  // makes the same commit byte-for-byte reproducible in another checkout.
  const source = relative(ROOT, options.source);

  if (options.check) {
    runMoc(["--check", ...packages, source]);
    console.log(`${source} typechecks`);
    return;
  }

  mkdirSync(dirname(options.output), { recursive: true });
  const temp = options.replaceWithGzip
    ? mkdtempSync(join(tmpdir(), "neutron-wasm-"))
    : null;
  const rawOutput = temp ? join(temp, "hackathon.wasm") : options.output;

  try {
    runMoc([
      "-c",
      "--idl",
      "--release",
      "--public-metadata",
      "candid:service",
      "--max-stable-pages",
      MAX_STABLE_PAGES,
      ...packages,
      "-o",
      rawOutput,
      source,
    ]);

    if (options.replaceWithGzip) {
      deterministicGzip(rawOutput, options.output);
      console.log(`built deterministic gzip ${options.output}`);
    } else {
      deterministicGzip(rawOutput, `${options.output}.gz`);
      console.log(`built ${options.output} and ${options.output}.gz`);
    }
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`backend build failed: ${error.message}`);
  process.exit(1);
}
