#!/usr/bin/env node
/** Describe the exact backend and frontend artifacts produced by a release build. */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

import { digestOf } from "./verify-web.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const BACKEND = join(ROOT, ".icp", "cache", "artifacts", "hackathon");
const FRONTEND = join(ROOT, "frontend", "dist");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function wasmMagic(bytes) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d
  );
}

export function inspectBackendArtifact(path = BACKEND) {
  invariant(existsSync(path), `ICP CLI backend artifact is missing: ${path}`);
  const submitted = readFileSync(path);
  invariant(
    submitted.length >= 2 && submitted[0] === 0x1f && submitted[1] === 0x8b,
    `${path} is not the expected gzip deploy artifact`,
  );

  let wasm;
  try {
    wasm = gunzipSync(submitted);
  } catch (cause) {
    throw new Error(`${path} is not a valid gzip stream`, { cause });
  }
  invariant(wasmMagic(wasm), `${path} does not contain WebAssembly`);

  return {
    rawWasmSha256: sha256(wasm),
    rawWasmBytes: wasm.length,
    submittedGzipSha256: sha256(submitted),
    submittedGzipBytes: submitted.length,
  };
}

function filesUnder(path) {
  const files = [];
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) files.push(...filesUnder(child));
    else files.push(child);
  }
  return files;
}

function lengthOf(bytes) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  return length;
}

/** Hash the built files themselves, without upload-time gzip choices. */
export function digestFrontendBundle(path = FRONTEND) {
  const digest = createHash("sha256");
  const files = filesUnder(path).sort((left, right) => left.localeCompare(right));
  for (const file of files) {
    const name = Buffer.from(relative(path, file).split(sep).join(posix.sep), "utf8");
    const bytes = readFileSync(file);
    digest.update(lengthOf(name));
    digest.update(name);
    digest.update(lengthOf(bytes));
    digest.update(bytes);
  }
  return { hash: digest.digest("hex"), count: files.length };
}

function requiredEnv(name) {
  const value = process.env[name];
  invariant(typeof value === "string" && value.length > 0, `${name} is required`);
  return value;
}

export function createBuildManifest() {
  invariant(existsSync(FRONTEND), `frontend build is missing: ${FRONTEND}`);
  const frontend = digestOf(FRONTEND);
  const bundle = digestFrontendBundle(FRONTEND);
  return {
    schema: "neutron-reproducible-build/v1",
    backend: inspectBackendArtifact(),
    frontend: {
      builtFilesSha256: bundle.hash,
      certifiedContentSha256: frontend.hash,
      files: bundle.count,
      certifiedAssetKeys: frontend.count,
    },
    publicBuildConfig: {
      environment: requiredEnv("VITE_ICP_ENVIRONMENT"),
      network: requiredEnv("VITE_ICP_NETWORK"),
      canisterId: requiredEnv("VITE_CANISTER_ID_HACKATHON"),
      identityProvider: requiredEnv("VITE_IDENTITY_PROVIDER"),
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  if (process.argv.length > 3) {
    console.error("usage: node scripts/build-manifest.mjs [output.json]");
    process.exitCode = 1;
  } else {
    try {
      const json = `${JSON.stringify(createBuildManifest(), null, 2)}\n`;
      const output = process.argv[2];
      if (output) {
        const path = resolve(output);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, json);
      }
      process.stdout.write(json);
    } catch (cause) {
      console.error(`build manifest failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exitCode = 1;
    }
  }
}
