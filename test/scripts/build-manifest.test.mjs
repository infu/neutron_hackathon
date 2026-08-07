import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import {
  digestFrontendBundle,
  inspectBackendArtifact,
} from "../../scripts/build-manifest.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

describe("the reproducible build manifest", () => {
  it("records separate hashes for raw Wasm and the submitted gzip", () => {
    const dir = mkdtempSync(join(tmpdir(), "neutron-build-manifest-"));
    try {
      const path = join(dir, "hackathon");
      const wasm = Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d]), Buffer.from("test")]);
      const submitted = gzipSync(wasm, { level: 9, mtime: 0 });
      writeFileSync(path, submitted);

      assert.deepEqual(inspectBackendArtifact(path), {
        rawWasmSha256: sha256(wasm),
        rawWasmBytes: wasm.length,
        submittedGzipSha256: sha256(submitted),
        submittedGzipBytes: submitted.length,
      });

      writeFileSync(path, wasm);
      assert.throws(() => inspectBackendArtifact(path), /not the expected gzip/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hashes frontend paths and bytes independently of directory order", () => {
    const dir = mkdtempSync(join(tmpdir(), "neutron-frontend-manifest-"));
    try {
      const first = join(dir, "first");
      const second = join(dir, "second");
      mkdirSync(join(first, "assets"), { recursive: true });
      mkdirSync(join(second, "assets"), { recursive: true });
      writeFileSync(join(first, "index.html"), "index");
      writeFileSync(join(first, "assets", "app.js"), "app");
      writeFileSync(join(second, "assets", "app.js"), "app");
      writeFileSync(join(second, "index.html"), "index");

      assert.deepEqual(digestFrontendBundle(first), digestFrontendBundle(second));
      assert.equal(digestFrontendBundle(first).count, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
