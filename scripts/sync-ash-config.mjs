#!/usr/bin/env node
/**
 * Regenerate the `mo` package-alias map in the developer-only Ash test config from
 * `mops sources`.
 *
 * `ash` does not understand mops; it needs every alias spelled out. Rather than
 * hand-maintaining that list (and letting it drift every time a transitive
 * dependency version changes), derive it. Run after `mops install`.
 *
 * Two path shapes are in play and they are NOT the same:
 *   mops.toml   ->  package root      (mops appends /src itself)
 *   .ash.json   ->  package SOURCE dir
 * `mops sources` already prints the source dir, so we just rebase it relative
 * to the config file.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Production builds and Candid generation use moc/didc directly. Ash remains
// only as the unit-test runner, where it calls each zero-argument test method.
const CONFIGS = ["test/hackathon.ash.json"];

// `ash` synthesizes mo:test itself at test time (src/test-harness.ts). Mapping
// it ourselves would pass --package test twice.
const SYNTHESIZED = new Set(["test"]);
const VENDORED = [["ashroot", resolve(root, "vendor/ashroot/src")]];

const raw = execFileSync("mops", ["sources"], { cwd: root, encoding: "utf8" });

const packages = [];
for (const line of raw.split("\n")) {
  const match = line.trim().match(/^--package\s+(\S+)\s+(\S+)$/);
  if (!match) continue;
  const [, alias, sourceDir] = match;
  if (SYNTHESIZED.has(alias)) continue;
  // `ash` validates aliases against ^[A-Za-z][A-Za-z0-9_-]*$, so mops'
  // versioned aliases (base@0, sha2@0, cbor@4) can never appear in a
  // .ash.json. If one shows up, a dependency has to be vendored instead —
  // see backend/lib/certification/README.md.
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(alias)) {
    console.error(`error: mops alias "${alias}" is not valid in a .ash.json.`);
    console.error("       Vendor that package, or drop the dependency.");
    process.exit(1);
  }
  packages.push([alias, resolve(root, sourceDir)]);
}
packages.push(...VENDORED);

if (packages.length === 0) {
  console.error("mops sources produced no packages - run `mops install` first");
  process.exit(1);
}

for (const configRelPath of CONFIGS) {
  const configPath = resolve(root, configRelPath);
  const configDir = dirname(configPath);
  const mo = Object.fromEntries(
    packages.map(([alias, absDir]) => [alias, relative(configDir, absDir)]),
  );
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.mo = mo;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`${configRelPath}: ${packages.length} package aliases`);
}
