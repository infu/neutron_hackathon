#!/usr/bin/env node
/**
 * Upload a directory into the canister's certified asset store.
 *
 * Deliberately unhurried: one file at a time, chunks sequential within a file.
 * A frontend bundle is a few dozen files, so throughput does not matter and
 * serial uploads make failures trivial to read.
 *
 * Usually invoked by the guarded `sync` step in icp.yaml. A direct local
 * upload remains useful while developing; a direct mainnet upload is refused.
 * `ship-web.mjs` writes the target environment and rebuilds before this file
 * is allowed to publish through its checked internal handoff.
 *
 * Usage:
 *   node scripts/upload.mjs [--environment local] [--dir frontend/dist]
 *                           [--prefix /] [--id 0] [--grace-ms 30000] [--dry-run]
 *   node scripts/upload.mjs --whoami [-e ic]  print the uploader's principal
 *
 * Local identity setup remains convenient and may create the ordinary icblast
 * secret. Production uses icblast's hardened existing-key loader: it refuses
 * environment-provided secrets, symlinks, loose permissions, wrong ownership,
 * and missing keys, and never generates a replacement controller identity.
 */

import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Actor, HttpAgent } from "@dfinity/agent";
// icblast derives a deterministic Ed25519 identity per `--id` from
// ~/.config/blast/secret. We use it for the key only, and drive the calls with
// @dfinity/agent against the interface below: icblast's dynamic actor fetches
// the canister's `candid:service` metadata, which is controller-gated, so it
// cannot bootstrap the very permission it needs.
import { hashIdentity, loadExistingIdentity } from "icblast";

/**
 * Just the slice of the canister this script talks to. Declared inline rather
 * than imported from the generated bindings so the uploader has no build-order
 * dependency on declaration generation.
 */
const uploadInterface = ({ IDL: idl }) => {
  const File = idl.Record({
    key: idl.Text,
    content: idl.Vec(idl.Nat8),
    contentType: idl.Text,
    contentEncoding: idl.Text,
    chunks: idl.Nat,
  });
  const Cmd = idl.Variant({
    store: File,
    chunk: idl.Record({ key: idl.Text, index: idl.Nat, content: idl.Vec(idl.Nat8) }),
    delete: idl.Record({ key: idl.Text }),
    clear: idl.Record({ prefix: idl.Text }),
  });
  const Result = idl.Variant({ ok: idl.Null, err: idl.Text });
  return idl.Service({
    assets_upload: idl.Func([Cmd], [Result], []),
    assets_count: idl.Func([], [idl.Nat], ["query"]),
    frontend_asset_keys: idl.Func([], [idl.Vec(idl.Text)], ["query"]),
  });
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// One chunk per update call. Ingress messages cap out around 2 MiB; 1 MiB
// leaves comfortable room for the Candid envelope.
const CHUNK_BYTES = 1_000_000;

// Mirrors ../neutron/packages/neutron-compiler/src/install.ts:3809.
export const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  wasm: "application/wasm",
  xml: "application/xml",
  txt: "text/plain",
  md: "text/markdown",
  map: "application/json",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  neutron: "application/octet-stream",
};

export function mime(path) {
  return MIME[extname(path).slice(1).toLowerCase()] ?? "application/octet-stream";
}

// Images and fonts are already compressed; re-gzipping them wastes cycles and
// storage. Everything else compresses well.
export function shouldGzip(contentType) {
  return !contentType.startsWith("image/") && !contentType.startsWith("font/");
}

/** Gateway port for the managed local network; keep in sync with icp.yaml. */
const LOCAL_PORT = 8943;

export function parseArgs(argv, env = process.env) {
  const args = {
    // ICP_CLI_ENVIRONMENT is set when this runs as an icp.yaml sync step.
    environment: env.ICP_CLI_ENVIRONMENT ?? "local",
    dir: "frontend/dist",
    prefix: "/",
    id: 0,
    graceMs: 30_000,
    dryRun: false,
    whoami: false,
    // Only a sync step with no explicit target may inherit its canister id.
    canisterId: env.ICP_CLI_CID,
    canisterIdExplicit: false,
    prepared: false,
  };
  let explicitEnvironment = false;
  let explicitCanister = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--whoami") args.whoami = true;
    else if (arg === "--environment" || arg === "-e") {
      args.environment = argv[++i];
      explicitEnvironment = true;
    }
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--prefix") args.prefix = argv[++i];
    else if (arg === "--id") args.id = Number(argv[++i]);
    else if (arg === "--grace-ms") args.graceMs = Number(argv[++i]);
    else if (arg === "--canister-id") {
      args.canisterId = argv[++i];
      explicitCanister = true;
      args.canisterIdExplicit = true;
    }
    // Internal handoff from ship-web.mjs or the ordered icp.yaml sync. This
    // never skips the prepared-bundle checks below.
    else if (arg === "--prepared") args.prepared = true;
    else if (arg === "--clear") {
      throw new Error("--clear was removed: site publishing is rolling and never clears prefixes");
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (explicitEnvironment && !explicitCanister) args.canisterId = undefined;
  if (!args.environment) throw new Error("-e/--environment needs a value");
  if (args.environment !== "local" && args.environment !== "ic") {
    throw new Error(`unsupported environment "${args.environment}"; expected local or ic`);
  }
  if (explicitCanister && !args.canisterId) throw new Error("--canister-id needs a value");
  if (!Number.isSafeInteger(args.id) || args.id < 0 || args.id > 65_535) {
    throw new Error("--id must be an integer in [0,65535]");
  }
  if (!args.prefix.startsWith("/")) args.prefix = `/${args.prefix}`;
  if (!args.prefix.endsWith("/")) args.prefix += "/";
  if (args.prefix === "/u/" || args.prefix.startsWith("/u/")) {
    throw new Error("the /u/ namespace belongs to participant uploads and cannot be site-published");
  }
  if (!Number.isSafeInteger(args.graceMs) || args.graceMs < 0 || args.graceMs > 60_000) {
    throw new Error("--grace-ms must be an integer from 0 to 60000");
  }
  return args;
}

/** CLI calls get the explicit target, never a stale shell-selected one. */
function cliEnv() {
  const env = { ...process.env };
  delete env.ICP_ENVIRONMENT;
  delete env.ICP_NETWORK;
  for (const key of Object.keys(env)) {
    if (key.startsWith("ICP_CLI_")) delete env[key];
  }
  return env;
}

function icp(icpArgs) {
  return execFileSync("icp", icpArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: cliEnv(),
  }).trim();
}

/**
 * The upload identity must be a controller. Local networks are disposable, so
 * fix it automatically; mainnet is not, so explain and stop.
 */
function ensureController(principal, environment, canisterId) {
  let current = "";
  try {
    current = icp(["canister", "settings", "show", canisterId, "--environment", environment]);
  } catch {
    // If settings can't be read, let the upload itself produce the
    // authorization error rather than guessing.
    return;
  }
  if (current.includes(principal)) return;

  const command =
    `icp canister settings update ${canisterId} --environment ${environment} ` +
    `--add-controller ${principal} --force`;

  if (environment === "ic") {
    throw new Error(`${principal} is not a controller.\n\nRun:\n  ${command}\n`);
  }

  console.log(`adding upload identity as a controller\n  ${principal}`);
  try {
    icp([
      "canister", "settings", "update", canisterId,
      "--environment", environment,
      "--add-controller", principal,
      "--force",
    ]);
  } catch {
    console.log(`  could not add automatically - run:\n  ${command}`);
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function resolveCanisterId(args) {
  if (args.canisterId) return args.canisterId;
  try {
    return icp([
      "canister",
      "status",
      "hackathon",
      "--id-only",
      "--environment",
      args.environment,
    ]);
  } catch {
    throw new Error(
      `could not resolve the canister id for environment "${args.environment}".\n` +
        "Deploy it first (`icp deploy`), or pass --canister-id <id>.",
    );
  }
}

/** Read the generated Vite environment without letting shell exports merge in. */
function frontendEnv(path = join(ROOT, ".env")) {
  const values = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) values.set(match[1], match[2].trim());
  }
  return values;
}

/**
 * Production's low-level upload is only reached after the target environment
 * has been written and built. Check the evidence again here: `--prepared` is a
 * routing marker, not a bypass token.
 */
export function assertPreparedProduction({
  args,
  canisterId,
  envPath = join(ROOT, ".env"),
  distDir = join(ROOT, "frontend", "dist"),
}) {
  if (args.environment !== "ic") return;
  if (!args.prepared) throw new Error("mainnet upload was not prepared by the guarded release path");
  if (resolve(ROOT, args.dir) !== resolve(distDir) || args.prefix !== "/") {
    throw new Error("mainnet publication must use the complete frontend/dist site at prefix /");
  }

  let values;
  try {
    values = frontendEnv(envPath);
  } catch {
    throw new Error("cannot read the generated .env; run the guarded frontend release path");
  }
  const expected = [
    ["VITE_ICP_ENVIRONMENT", "ic"],
    ["VITE_ICP_NETWORK", "ic"],
    ["VITE_CANISTER_ID_HACKATHON", canisterId],
    ["VITE_IDENTITY_PROVIDER", "https://id.ai"],
  ];
  const wrong = expected.filter(([key, value]) => values.get(key) !== value);
  if (wrong.length > 0) {
    throw new Error(
      `generated frontend environment does not match this mainnet upload: ${wrong
        .map(([key, value]) => `${key} must be ${value}`)
        .join(", ")}`,
    );
  }

  let bundles;
  try {
    bundles = readdirSync(join(distDir, "assets")).filter(
      (name) => name.startsWith("index-") && name.endsWith(".js"),
    );
  } catch {
    throw new Error("cannot read frontend/dist/assets; rebuild through the guarded release path");
  }
  if (bundles.length !== 1) {
    throw new Error(`expected one built index bundle, found ${bundles.length}`);
  }
  const bundle = readFileSync(join(distDir, "assets", bundles[0]), "utf8");
  for (const marker of [canisterId, "https://id.ai"]) {
    if (!bundle.includes(marker)) {
      throw new Error(`the built frontend does not contain its mainnet ${marker}`);
    }
  }
  for (const marker of ["Could not synchronize the local PocketIC agent clock.", `.localhost:${LOCAL_PORT}`]) {
    if (bundle.includes(marker)) {
      throw new Error(`the built frontend still contains local-only marker ${marker}`);
    }
  }
}

/** Production never invokes icblast's key-generating compatibility loader. */
export async function identityForEnvironment(
  environment,
  id,
  { localLoader = hashIdentity, productionLoader = loadExistingIdentity } = {},
) {
  if (environment === "ic") {
    const loaded = await productionLoader(id);
    return {
      identity: loaded.identity,
      principal: loaded.principal ?? loaded.identity.getPrincipal().toText(),
      label: `existing hardened icblast id ${id}`,
    };
  }
  const identity = await localLoader(id);
  return {
    identity,
    principal: identity.getPrincipal().toText(),
    label: `local icblast id ${id}`,
  };
}

export function productionUploadMode(args) {
  if (args.environment !== "ic" || args.whoami || args.dryRun) return "direct";
  return args.prepared ? "prepared" : "refuse";
}

/**
 * Key convention, matching the Neutron kernel's asset store:
 *   index.html          -> /  AND  /index.html
 *   assets/main-x.js    -> /assets/main-x.js
 *
 * The backend serves exact keys with no directory-index inference, so the root
 * document must be stored under "/" itself. It is stored a second time under
 * "/index.html" because response-verification v1 uses that exact path as the
 * fallback witness for unknown paths — that is what makes SPA deep links
 * verify instead of 503.
 */
export function assetKeys(relPath, prefix) {
  const normalized = relPath.split(sep).join(posix.sep);
  // `/` is the release pointer. Write the explicit fallback first and switch
  // the root last, after every dependency is already available.
  if (normalized === "index.html") return [`${prefix}index.html`, prefix];
  return [`${prefix}${normalized}`];
}

/** Dependencies first, secondary HTML next, and the root entrypoint last. */
export function deploymentOrder(files, sourceDir) {
  const phase = (file) => {
    const rel = relative(sourceDir, file).split(sep).join(posix.sep);
    if (rel === "index.html") return 2;
    return mime(file) === "text/html" ? 1 : 0;
  };
  return [...files].sort((left, right) => {
    const byPhase = phase(left) - phase(right);
    return byPhase || relative(sourceDir, left).localeCompare(relative(sourceDir, right));
  });
}

function chunk(buffer) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
    chunks.push(buffer.subarray(offset, offset + CHUNK_BYTES));
  }
  return chunks.length > 0 ? chunks : [Buffer.alloc(0)];
}

function check(result, context) {
  if (result && typeof result === "object" && "err" in result) {
    throw new Error(`${context}: ${result.err}`);
  }
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function gatewayUrl(key, environment, canisterId) {
  const base =
    environment === "ic"
      ? `https://${canisterId}.icp0.io`
      : `http://127.0.0.1:${LOCAL_PORT}`;
  const url = new URL(key, `${base}/`);
  if (environment !== "ic") url.searchParams.set("canisterId", canisterId);
  return url;
}

async function fetchExpected(url, expected, key, fetchImpl, delayImpl) {
  let failure = "no response";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        failure = `HTTP ${response.status}`;
      } else {
        const served = Buffer.from(await response.arrayBuffer());
        if (served.equals(expected)) return;
        failure = `${served.length} served bytes differ from ${expected.length} built bytes`;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 4) await delayImpl((attempt + 1) * 1_000);
  }
  throw new Error(`pre-prune verification failed for ${key}: ${failure}`);
}

/** Verify the switched release through the certified gateway before deleting its predecessor. */
export async function verifyDesiredSite({
  files,
  sourceDir,
  prefix,
  environment,
  canisterId,
  fetchImpl = fetch,
  delayImpl = delay,
}) {
  const checks = [];
  for (const file of files) {
    const expected = readFileSync(file);
    for (const key of assetKeys(relative(sourceDir, file), prefix)) {
      checks.push(
        fetchExpected(
          gatewayUrl(key, environment, canisterId),
          expected,
          key,
          fetchImpl,
          delayImpl,
        ),
      );
    }
  }
  await Promise.all(checks);
  return checks.length;
}

/** The ordering invariant is unit-testable without an agent or replica. */
export async function pruneStaleAfterVerification({
  verify,
  stale,
  graceMs,
  remove,
  delayImpl = delay,
}) {
  await verify();
  if (stale.length > 0 && graceMs > 0) await delayImpl(graceMs);
  for (const key of stale) await remove(key);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (productionUploadMode(args) === "refuse") {
    throw new Error(
      "direct mainnet upload is disabled; run `npm run web -- -e ic` so the target is written, built and verified",
    );
  }

  const { identity, principal, label: identityLabel } = await identityForEnvironment(
    args.environment,
    args.id,
  );

  if (args.whoami) {
    console.log(principal);
    return;
  }

  const sourceDir = resolve(ROOT, args.dir);

  let files;
  try {
    files = walk(sourceDir).sort();
  } catch {
    throw new Error(`cannot read ${args.dir}. Build the frontend first.`);
  }
  if (files.length === 0) throw new Error(`${args.dir} is empty`);

  const canisterId = resolveCanisterId(args);
  if (!args.dryRun) assertPreparedProduction({ args, canisterId });
  const local = args.environment !== "ic";

  console.log(`environment  ${args.environment}`);
  console.log(`canister     ${canisterId}`);
  console.log(`identity     ${principal}  (${identityLabel})`);
  console.log(`source       ${args.dir}  (${files.length} files)`);
  console.log(`key prefix   ${args.prefix}`);

  const ordered = deploymentOrder(files, sourceDir);
  const desiredKeys = new Set(
    ordered.flatMap((file) => assetKeys(relative(sourceDir, file), args.prefix)),
  );

  if (args.dryRun) {
    let total = 0;
    for (const file of ordered) {
      const rel = relative(sourceDir, file);
      const body = readFileSync(file);
      const contentType = mime(file);
      const encoded = shouldGzip(contentType) ? gzipSync(body, { level: 9 }) : body;
      const keys = assetKeys(rel, args.prefix);
      total += encoded.length * keys.length;
      for (const key of keys) {
        console.log(
          `  ${key.padEnd(44)} ${contentType.padEnd(26)} ` +
            `${human(body.length)} -> ${human(encoded.length)} (${chunk(encoded).length} chunk(s))`,
        );
      }
    }
    console.log(`\ndry run - nothing uploaded. Total on-chain: ${human(total)}`);
    return;
  }

  ensureController(principal, args.environment, canisterId);

  const agent = await HttpAgent.create({
    identity,
    host: local ? `http://127.0.0.1:${LOCAL_PORT}` : "https://icp-api.io",
  });
  if (local) await agent.fetchRootKey();
  const canister = Actor.createActor(uploadInterface, { agent, canisterId });

  // Snapshot only complete, non-/u/ keys. Deleting from this snapshot after
  // upload means a failed publish never removes the bundle that was live when
  // it started, and it cannot sweep participant uploads.
  const existing = new Set(
    (await canister.frontend_asset_keys()).filter((key) => key.startsWith(args.prefix)),
  );
  const stale = [...existing].filter((key) => !desiredKeys.has(key)).sort();
  console.log(`inventory    ${existing.size} existing site keys; ${stale.length} stale`);

  console.log("");
  let uploadedBytes = 0;

  for (const file of ordered) {
    const rel = relative(sourceDir, file);
    const body = readFileSync(file);
    const contentType = mime(file);
    const gzip = shouldGzip(contentType);
    const encoded = gzip ? gzipSync(body, { level: 9 }) : body;
    const parts = chunk(encoded);

    for (const key of assetKeys(rel, args.prefix)) {
      // Chunk 0 declares the total; the asset is not certified or served until
      // the final chunk lands.
      check(
        await canister.assets_upload({
          store: {
            key,
            content: parts[0],
            contentType,
            contentEncoding: gzip ? "gzip" : "identity",
            chunks: parts.length,
          },
        }),
        `store ${key}`,
      );

      for (let index = 1; index < parts.length; index += 1) {
        check(
          await canister.assets_upload({ chunk: { key, index, content: parts[index] } }),
          `chunk ${index} of ${key}`,
        );
      }

      uploadedBytes += encoded.length;
      const note = parts.length > 1 ? ` in ${parts.length} chunks` : "";
      console.log(`  ok  ${key.padEnd(44)} ${human(encoded.length)}${note}`);
    }
  }

  console.log("\nverifying the switched site before pruning the previous bundle");
  await pruneStaleAfterVerification({
    verify: async () => {
      const checked = await verifyDesiredSite({
        files: ordered,
        sourceDir,
        prefix: args.prefix,
        environment: args.environment,
        canisterId,
      });
      console.log(`  ok  ${checked} desired gateway path(s) match the build`);
    },
    stale,
    graceMs: args.graceMs,
    delayImpl: async (milliseconds) => {
      console.log(`waiting ${milliseconds} ms before pruning`);
      await delay(milliseconds);
    },
    remove: async (key) => {
      // Defense in depth: the backend inventory already excludes `/u/`, but
      // the deployment client refuses such a delete even if that invariant
      // ever regresses.
      if (key.startsWith("/u/")) throw new Error(`refusing to prune participant key ${key}`);
      check(await canister.assets_upload({ delete: { key } }), `delete ${key}`);
      console.log(`  rm  ${key}`);
    },
  });

  const stored = await canister.assets_count();
  console.log(`\nuploaded ${files.length} files (${human(uploadedBytes)} stored).`);
  if (stale.length > 0) console.log(`pruned ${stale.length} stale site key(s).`);
  console.log(`canister now holds ${stored} assets.`);
  console.log(
    local
      ? `\n  http://${canisterId}.localhost:${LOCAL_PORT}/`
      : `\n  https://${canisterId}.icp0.io/`,
  );
}

// Importable: `scripts/verify-web.mjs` reuses the metadata helpers above so
// there is one definition of "what gets stored", not two that must agree.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\nupload failed: ${error.message}`);
    process.exit(1);
  });
}
