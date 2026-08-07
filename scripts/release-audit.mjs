#!/usr/bin/env node
/** Production dependency audit: high and critical findings block release. */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

for (const [label, cwd] of [
  ["root tooling", ROOT],
  ["frontend", resolve(ROOT, "frontend")],
]) {
  console.log(`\n▸ ${label}`);
  execFileSync("npm", ["audit", "--omit=dev", "--audit-level=high"], {
    cwd,
    stdio: "inherit",
  });
}

console.log("\nNo high or critical production dependency advisories.\n");
