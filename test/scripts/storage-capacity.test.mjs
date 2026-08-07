import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MAX_STABLE_PAGES, ROOT } from "../../scripts/motoko-toolchain.mjs";

test("the compiler stable ceiling stays above the cross-class reserve policy", () => {
  const assets = readFileSync(`${ROOT}/backend/lib/Assets.mo`, "utf8");
  const raw = assets.match(/MAX_RESERVED_BYTES\s*=\s*([\d_]+)/)?.[1];
  assert.ok(raw, "Assets.MAX_RESERVED_BYTES must remain a visible release constant");

  const policy = BigInt(raw.replaceAll("_", ""));
  const compiler = BigInt(MAX_STABLE_PAGES) * 65_536n;
  assert.equal(compiler, 80n * 1_073_741_824n, "production Wasm permits exactly 80 GiB");
  assert.equal(policy, 70_332_186_624n, "policy includes all class highs plus 1 GiB");
  assert.ok(compiler - policy >= 14n * 1_073_741_824n, "compiler retains a clean >14 GiB margin");
});
