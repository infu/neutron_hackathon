#!/usr/bin/env node
/** Generate or verify the committed Candid and didc bindings. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  MAX_STABLE_PAGES,
  ROOT,
  mopsPackageArgs,
  runDidc,
  runMoc,
} from "./motoko-toolchain.mjs";

const DECLARATIONS = join(ROOT, "frontend", "src", "declarations");
const LEGACY_TS = join(DECLARATIONS, "hackathon.ts");
const TARGETS = Object.freeze({
  "hackathon.did": "did",
  "hackathon.js": "js",
  "hackathon.d.ts": "ts",
});

const withoutTrailingWhitespace = (text) => text.replace(/[ \t]+$/gm, "");

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  if (args.some((arg) => arg !== "--write" && arg !== "--check")) {
    throw new Error("usage: node scripts/bindings.mjs [--check|--write]");
  }

  const temp = mkdtempSync(join(tmpdir(), "neutron-bindings-"));
  try {
    const wasm = join(temp, "hackathon.wasm");
    const did = join(temp, "hackathon.did");
    runMoc([
      "-c",
      "--idl",
      "--release",
      "--public-metadata",
      "candid:service",
      "--max-stable-pages",
      MAX_STABLE_PAGES,
      ...mopsPackageArgs(),
      "-o",
      wasm,
      "backend/main.mo",
    ]);
    runDidc(["check", did], { stdio: "inherit" });

    const generated = {
      did: withoutTrailingWhitespace(readFileSync(did, "utf8")),
      js: runDidc(["bind", "-t", "js", did]),
      ts: runDidc(["bind", "-t", "ts", did]),
    };

    mkdirSync(DECLARATIONS, { recursive: true });
    if (write) {
      if (existsSync(LEGACY_TS)) {
        rmSync(LEGACY_TS);
        console.log("removed legacy frontend/src/declarations/hackathon.ts");
      }
      for (const [name, kind] of Object.entries(TARGETS)) {
        writeFileSync(join(DECLARATIONS, name), generated[kind]);
        console.log(`wrote frontend/src/declarations/${name}`);
      }
      return;
    }

    const stale = existsSync(LEGACY_TS) ? ["hackathon.ts (legacy shadow binding)"] : [];
    for (const [name, kind] of Object.entries(TARGETS)) {
      let current = null;
      try {
        current = readFileSync(join(DECLARATIONS, name), "utf8");
      } catch {}
      if (current !== generated[kind]) stale.push(name);
    }
    if (stale.length > 0) {
      throw new Error(
        `committed declarations are stale: ${stale.join(", ")}\n` +
          "Run `npm run bindings` and commit the result.",
      );
    }
    console.log("committed Candid declarations match backend/main.mo");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`bindings failed: ${error.message}`);
  process.exit(1);
}
