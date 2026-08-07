#!/usr/bin/env node
/**
 * Bind the irreversible production seal to one reviewed, fully tested commit.
 *
 * This script deliberately does not deploy, seal, or change controllers. The
 * operator runs three explicit steps around the one-way `seal_canister` call:
 *
 *   npm run release:full -- --reviewed-commit <40-char git sha>
 *   npm run release:attest -- prepare --reviewed-commit <sha> --canister-id <id>
 *   # call seal_canister() exactly as printed by prepare
 *   npm run release:attest -- verify
 *
 * Generated receipts live under ignored `.build/`. Archive the final JSON in
 * the release record; committing it would itself change the reviewed commit.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Actor, CanisterStatus, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";

import {
  normalizeLedgerFile,
  parseConfig,
  samePrincipalSet,
} from "./ledger-allowlist.mjs";
import { inspectBackendArtifact } from "./build-manifest.mjs";
import { digestOf, verifyGateway } from "./verify-web.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "frontend", "dist");
const PRODUCTION_LEDGERS = join(ROOT, "production-ledgers.json");
const DEFAULT_WASM = join(ROOT, ".icp", "cache", "artifacts", "hackathon");
const DEFAULT_RECEIPT = join(ROOT, ".build", "release-checks.json");
const DEFAULT_RECORD = join(ROOT, ".build", "production-release-attestation.json");
const RECORD_SCHEMA = "neutron-production-release-attestation/v1";
const RECEIPT_SCHEMA = "neutron-full-release-checks/v1";

export const REQUIRED_FULL_CHECKS = Object.freeze([
  "npm test",
  "npm run test:logic",
  "npm run test:public",
  "npm run test:memory",
  "npm run test:capacity",
]);

const CHECK_COMMANDS = Object.freeze([
  ["npm test", "npm", ["test"]],
  ["npm run test:logic", "npm", ["run", "test:logic"]],
  ["npm run test:public", "npm", ["run", "test:public"]],
  ["npm run test:memory", "npm", ["run", "test:memory"]],
  ["npm run test:capacity", "npm", ["run", "test:capacity"]],
]);

const USAGE = `usage:
  npm run release:full -- --reviewed-commit <full git sha>
  npm run release:attest -- prepare --reviewed-commit <full git sha> --canister-id <principal> [--identity <name>]
  npm run release:attest -- verify [--canister-id <principal>]`;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function needValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} needs a value`);
  return value;
}

export function parseAttestationArgs(argv) {
  const command = argv[0];
  if (!command || !["checks", "prepare", "verify"].includes(command)) {
    throw new Error(USAGE);
  }
  const options = {
    command,
    reviewedCommit: null,
    canisterId: null,
    identity: null,
    environment: "ic",
    record: DEFAULT_RECORD,
    receipt: DEFAULT_RECEIPT,
    wasm: DEFAULT_WASM,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--reviewed-commit") options.reviewedCommit = needValue(argv, i++, arg);
    else if (arg === "--canister-id") options.canisterId = needValue(argv, i++, arg);
    else if (arg === "--identity") options.identity = needValue(argv, i++, arg);
    else if (arg === "-e" || arg === "--environment") {
      options.environment = needValue(argv, i++, arg);
    } else throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
  }

  invariant(options.environment === "ic", "production attestation only supports -e ic");
  if (command !== "verify") {
    invariant(options.reviewedCommit !== null, "--reviewed-commit is required");
  }
  if (command === "prepare") invariant(options.canisterId !== null, "--canister-id is required");
  if (command !== "prepare") invariant(options.identity === null, "--identity is only valid for prepare");
  if (command === "checks") {
    invariant(options.canisterId === null, "checks does not accept --canister-id");
  }
  return options;
}

function commandEnv(environment = "ic") {
  const env = { ...process.env, ICP_ENVIRONMENT: environment };
  delete env.ICP_NETWORK;
  for (const key of Object.keys(env)) {
    if (key.startsWith("ICP_CLI_") || key.startsWith("VITE_") || key.startsWith("GIT_")) {
      delete env[key];
    }
  }
  env.GIT_NO_REPLACE_OBJECTS = "1";
  return env;
}

function capture(command, args, environment = "ic") {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: commandEnv(environment),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function run(command, args, environment = "ic") {
  execFileSync(command, args, {
    cwd: ROOT,
    env: commandEnv(environment),
    stdio: "inherit",
  });
}

export function assertCleanStatus(status) {
  invariant(
    status.trim() === "",
    `release checkout is not clean:\n${status.trim()}\nCommit or remove every change before continuing`,
  );
}

function cleanStatus() {
  return capture("git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
}

export function assertReviewedCommit(reviewedCommit, head) {
  invariant(
    typeof reviewedCommit === "string" && /^[0-9a-f]{40}$/.test(reviewedCommit),
    "--reviewed-commit must be the full lowercase 40-character Git commit",
  );
  invariant(reviewedCommit === head, `reviewed commit ${reviewedCommit} is not checked out HEAD ${head}`);
}

function requireReviewedCheckout(reviewedCommit) {
  assertCleanStatus(cleanStatus());
  const head = capture("git", ["rev-parse", "--verify", "HEAD"]);
  assertReviewedCommit(reviewedCommit, head);
  return head;
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, jsonBytes(value), { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") throw new Error(`${label} is missing: ${path}`);
    throw new Error(`${label} is not valid JSON: ${path}`, { cause });
  }
}

function canonicalPath(path) {
  return relative(ROOT, path);
}

function validIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateChecksReceipt(receipt, reviewedCommit) {
  invariant(receipt?.schema === RECEIPT_SCHEMA, `full-check receipt must use ${RECEIPT_SCHEMA}`);
  invariant(receipt.reviewedCommit === reviewedCommit, "full-check receipt belongs to another commit");
  invariant(validIsoDate(receipt.passedAt), "full-check receipt has no valid passedAt time");
  invariant(
    JSON.stringify(receipt.commands) === JSON.stringify(REQUIRED_FULL_CHECKS),
    "full-check receipt does not contain every required command in order",
  );
  return receipt;
}

function loadChecksReceipt(path, reviewedCommit) {
  const receipt = validateChecksReceipt(readJson(path, "full-check receipt"), reviewedCommit);
  return { receipt, sha256: sha256Bytes(jsonBytes(receipt)) };
}

function normalizePrincipal(value, label) {
  try {
    return Principal.fromText(value).toText();
  } catch {
    throw new Error(`${label} is not a valid principal: ${value}`);
  }
}

function normalizeHash(value, label) {
  invariant(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), `${label} is not a SHA-256`);
  return value;
}

function sortedPrincipals(values, label) {
  invariant(Array.isArray(values), `${label} must be a principal list`);
  const normalized = values.map((value) => normalizePrincipal(value, label)).sort();
  invariant(new Set(normalized).size === normalized.length, `${label} contains a duplicate principal`);
  return normalized;
}

function readProductionLedgers() {
  const bytes = readFileSync(PRODUCTION_LEDGERS);
  const raw = JSON.parse(bytes);
  return {
    catalogSha256: sha256Bytes(bytes),
    verifiedAt: raw.verifiedAt,
    rows: normalizeLedgerFile(raw, "ic"),
  };
}

function resolveNamedCanister() {
  return normalizePrincipal(
    capture("icp", ["canister", "status", "hackathon", "--id-only", "--environment", "ic"]),
    "configured hackathon canister id",
  );
}

function resolveSealIdentity(requested) {
  const name = requested ?? capture("icp", ["identity", "default"]);
  invariant(name.length > 0, "icp-cli has no selected seal identity");
  const principal = normalizePrincipal(
    capture("icp", ["identity", "principal", "--identity", name]),
    `icp identity ${name}`,
  );
  return { name, principal };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function readLiveLedgerPolicy(canisterId) {
  const output = capture("icp", [
    "canister",
    "call",
    canisterId,
    "config",
    "()",
    "--query",
    "--environment",
    "ic",
    "--json",
  ]);
  const response = JSON.parse(output)?.response_candid;
  invariant(typeof response === "string", "icp-cli returned no Candid config() response");
  return parseConfig(response);
}

const releaseInterface = ({ IDL }) =>
  IDL.Service({
    frontend_hash: IDL.Func([], [IDL.Text], ["query"]),
    launch_latched: IDL.Func([], [IDL.Bool], ["query"]),
  });

async function publicAgent() {
  return HttpAgent.create({
    host: "https://icp-api.io",
    shouldSyncTime: true,
  });
}

async function readCertifiedControllers(canisterId) {
  const principal = Principal.fromText(canisterId);
  const agent = await publicAgent();
  const status = await CanisterStatus.request({
    agent,
    canisterId: principal,
    paths: ["controllers"],
  });
  const controllers = status.get("controllers");
  invariant(Array.isArray(controllers), "certified state tree returned no controller list");
  return sortedPrincipals(
    controllers.map((controller) => controller.toText()),
    "controllers",
  );
}

async function readPublicReleaseState(canisterId) {
  const principal = Principal.fromText(canisterId);
  const agent = await publicAgent();
  const actor = Actor.createActor(releaseInterface, { agent, canisterId: principal });
  const [status, frontendHash, launchLatched] = await Promise.all([
    CanisterStatus.request({ agent, canisterId: principal, paths: ["controllers", "module_hash"] }),
    actor.frontend_hash(),
    actor.launch_latched(),
  ]);
  const controllers = status.get("controllers");
  const moduleHash = status.get("module_hash");
  invariant(Array.isArray(controllers), "certified state tree returned no controller list");
  invariant(typeof moduleHash === "string", "certified state tree returned no module hash");
  invariant(typeof launchLatched === "boolean", "canister returned no launch latch witness");
  return {
    controllers: sortedPrincipals(controllers.map((controller) => controller.toText()), "controllers"),
    moduleHash: normalizeHash(moduleHash, "deployed module hash"),
    frontendHash: normalizeHash(frontendHash, "frontend certified hash"),
    launchLatched,
  };
}

function buildReviewedArtifacts() {
  console.log("\n▸ rebuilding production artifacts from the reviewed commit");
  rmSync(DEFAULT_WASM, { force: true });
  run("icp", ["build", "hackathon", "--environment", "ic"]);
  run("node", ["scripts/write-env.mjs", "ic"]);
  run("npm", ["run", "build:web"]);
}

async function collectFacts(options, reviewedCommit, includeSealCaller = false) {
  const explicitCanister = normalizePrincipal(options.canisterId, "--canister-id");
  const configuredCanister = resolveNamedCanister();
  invariant(
    explicitCanister === configuredCanister,
    `--canister-id ${explicitCanister} does not match hackathon in the ic environment (${configuredCanister})`,
  );

  buildReviewedArtifacts();
  requireReviewedCheckout(reviewedCommit);

  const backend = inspectBackendArtifact(options.wasm);
  const frontend = digestOf(DIST);
  const catalog = readProductionLedgers();
  console.log("\n▸ verifying every production ledger against live ICRC-1 metadata");
  run("node", ["scripts/ledger-allowlist.mjs", "--check", "-e", "ic"]);
  const livePolicy = readLiveLedgerPolicy(explicitCanister);
  invariant(livePolicy.set, "the production canister ledger allowlist is not fixed");
  const expectedIds = catalog.rows.map(({ id }) => id);
  invariant(
    samePrincipalSet(livePolicy.ledgers, expectedIds),
    "the production canister ledger allowlist differs from production-ledgers.json",
  );

  const live = await readPublicReleaseState(explicitCanister);
  invariant(
    live.moduleHash === backend.submittedGzipSha256,
    `deployed module ${live.moduleHash} does not match locally built deploy artifact ${backend.submittedGzipSha256}`,
  );
  invariant(
    live.frontendHash === frontend.hash,
    `certified frontend ${live.frontendHash} does not match reviewed build ${frontend.hash}`,
  );

  const gatewayPaths = await verifyGateway({
    distDir: DIST,
    canisterId: explicitCanister,
    environment: "ic",
  });

  // A concurrent edit during the network checks must not sneak into a record
  // that claims to describe the clean reviewed commit.
  requireReviewedCheckout(reviewedCommit);

  const sealIdentity = includeSealCaller ? resolveSealIdentity(options.identity) : null;

  return {
    canisterId: explicitCanister,
    productionWasmSha256: backend.rawWasmSha256,
    submittedGzipSha256: backend.submittedGzipSha256,
    deployedModuleSha256: live.moduleHash,
    frontendCertifiedSha256: live.frontendHash,
    frontendFiles: frontend.count,
    certifiedGatewayPaths: gatewayPaths,
    ledgerCatalogSha256: catalog.catalogSha256,
    ledgerCatalogVerifiedAt: catalog.verifiedAt,
    ledgers: catalog.rows,
    liveLedgerPrincipals: sortedPrincipals(livePolicy.ledgers, "live ledger allowlist"),
    controllers: live.controllers,
    launchLatched: live.launchLatched,
    sealIdentity,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validatePreparedRecord(record) {
  invariant(record?.schema === RECORD_SCHEMA, `attestation must use ${RECORD_SCHEMA}`);
  invariant(["prepared", "sealed"].includes(record.phase), "attestation has an invalid phase");
  assertReviewedCommit(record.reviewedCommit, record.reviewedCommit);
  normalizePrincipal(record.canisterId, "attested canister id");
  normalizePrincipal(record.sealCaller, "attested seal caller");
  invariant(typeof record.sealIdentity === "string" && record.sealIdentity.length > 0, "attestation has no seal identity");
  normalizeHash(record.productionWasmSha256, "attested production Wasm hash");
  normalizeHash(record.submittedGzipSha256, "attested submitted gzip hash");
  normalizeHash(record.deployedModuleSha256, "attested deployed module hash");
  normalizeHash(record.frontendCertifiedSha256, "attested frontend hash");
  normalizeHash(record.ledgerCatalogSha256, "attested ledger catalog hash");
  normalizeHash(record.releaseChecksReceiptSha256, "attested release-check receipt hash");
  invariant(validIsoDate(record.preparedAt), "attestation has no valid preparedAt time");
  invariant(validIsoDate(record.ledgerCatalogVerifiedAt), "attestation has no valid ledger catalog date");
  validateChecksReceipt(record.releaseChecks, record.reviewedCommit);
  invariant(
    sha256Bytes(jsonBytes(record.releaseChecks)) === record.releaseChecksReceiptSha256,
    "embedded release-check receipt does not match its attested hash",
  );
  normalizeLedgerFile({ network: "ic", ledgers: record.ledgers }, "ic");
  sortedPrincipals(record.liveLedgerPrincipals, "attested live ledger allowlist");
  const before = sortedPrincipals(record.controllersBeforeSeal, "controllersBeforeSeal");
  invariant(before.length > 0, "prepared attestation recorded no pre-seal controllers");
  invariant(before.includes(record.canisterId), "canister is not its own controller in prepared attestation");
  invariant(before.includes(record.sealCaller), "seal caller is not a controller in prepared attestation");
  invariant(record.launchLatchedBeforeSeal === false, "prepared attestation must record an open launch latch");
  if (record.phase === "sealed") {
    invariant(
      sameJson(record.controllers, [record.canisterId]),
      "sealed attestation must record the canister as its only controller",
    );
    invariant(record.launchLatched === true, "sealed attestation must record the durable launch latch");
    invariant(validIsoDate(record.verifiedAt), "sealed attestation has no valid verifiedAt time");
  }
  return record;
}

function assertSamePreparedFacts(record, facts, receiptSha256) {
  const comparisons = [
    ["canister id", facts.canisterId, record.canisterId],
    ["production Wasm hash", facts.productionWasmSha256, record.productionWasmSha256],
    ["submitted gzip hash", facts.submittedGzipSha256, record.submittedGzipSha256],
    ["deployed module hash", facts.deployedModuleSha256, record.deployedModuleSha256],
    ["frontend certified hash", facts.frontendCertifiedSha256, record.frontendCertifiedSha256],
    ["ledger catalog hash", facts.ledgerCatalogSha256, record.ledgerCatalogSha256],
    ["release-check receipt hash", receiptSha256, record.releaseChecksReceiptSha256],
  ];
  for (const [label, actual, expected] of comparisons) {
    invariant(actual === expected, `${label} changed after the pre-seal attestation`);
  }
  invariant(sameJson(facts.ledgers, record.ledgers), "production ledger catalog changed after prepare");
  invariant(
    sameJson(facts.liveLedgerPrincipals, record.liveLedgerPrincipals),
    "live ledger allowlist changed after prepare",
  );
}

export function assertSealState(
  command,
  canisterId,
  controllers,
  launchLatched,
  sealCaller = null,
) {
  invariant(typeof launchLatched === "boolean", "launch latch witness is unavailable");
  if (command === "prepare") {
    invariant(controllers.length > 0, "canister has no controllers; prepare must run before sealing");
    invariant(
      controllers.includes(canisterId),
      "the canister is not its own controller; seal_canister() cannot complete",
    );
    invariant(
      sealCaller !== null && controllers.includes(sealCaller),
      "the selected icp identity is not a controller; it cannot call seal_canister()",
    );
    invariant(!launchLatched, "launch sealing has already begun; prepare must run first");
  } else {
    invariant(
      sameJson(controllers, [canisterId]),
      `seal verification failed: ${canisterId} must be the only controller`,
    );
    invariant(
      launchLatched,
      "controller list is self-only but launch latch is false; seal_canister() was bypassed",
    );
  }
}

async function runFullChecks(options) {
  const reviewedCommit = requireReviewedCheckout(options.reviewedCommit);
  rmSync(options.receipt, { force: true });

  for (const [label, command, args] of CHECK_COMMANDS) {
    console.log(`\n▸ ${label}`);
    run(command, args);
  }

  requireReviewedCheckout(reviewedCommit);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    reviewedCommit,
    commands: [...REQUIRED_FULL_CHECKS],
    passedAt: new Date().toISOString(),
  };
  writeJsonAtomic(options.receipt, receipt);
  console.log(`\nAll full release checks passed from clean commit ${reviewedCommit}.`);
  console.log(`Receipt: ${canonicalPath(options.receipt)}\n`);
}

async function prepare(options) {
  const reviewedCommit = requireReviewedCheckout(options.reviewedCommit);
  const { receipt, sha256: receiptSha256 } = loadChecksReceipt(options.receipt, reviewedCommit);
  const facts = await collectFacts(options, reviewedCommit, true);
  assertSealState(
    "prepare",
    facts.canisterId,
    facts.controllers,
    facts.launchLatched,
    facts.sealIdentity.principal,
  );

  const record = {
    schema: RECORD_SCHEMA,
    phase: "prepared",
    reviewedCommit,
    canisterId: facts.canisterId,
    sealIdentity: facts.sealIdentity.name,
    sealCaller: facts.sealIdentity.principal,
    productionWasmPath: canonicalPath(options.wasm),
    productionWasmSha256: facts.productionWasmSha256,
    submittedGzipSha256: facts.submittedGzipSha256,
    deployedModuleSha256: facts.deployedModuleSha256,
    frontendCertifiedSha256: facts.frontendCertifiedSha256,
    frontendFiles: facts.frontendFiles,
    certifiedGatewayPaths: facts.certifiedGatewayPaths,
    ledgerCatalog: "production-ledgers.json",
    ledgerCatalogSha256: facts.ledgerCatalogSha256,
    ledgerCatalogVerifiedAt: facts.ledgerCatalogVerifiedAt,
    ledgers: facts.ledgers,
    liveLedgerPrincipals: facts.liveLedgerPrincipals,
    releaseChecks: receipt,
    releaseChecksReceiptSha256: receiptSha256,
    controllersBeforeSeal: facts.controllers,
    launchLatchedBeforeSeal: false,
    preparedAt: new Date().toISOString(),
  };
  validatePreparedRecord(record);
  writeJsonAtomic(options.record, record);

  console.log(`\nPrepared attestation: ${canonicalPath(options.record)}`);
  console.log("Review and archive it, then make the one irreversible call:");
  console.log(
    `  icp canister call ${facts.canisterId} seal_canister '()' --environment ic --identity ${shellQuote(facts.sealIdentity.name)}`,
  );
  console.log("Then verify the same release facts and the exact self-only controller list:");
  console.log("  npm run release:attest -- verify\n");
}

async function verify(options) {
  const record = validatePreparedRecord(readJson(options.record, "prepared attestation"));
  if (options.reviewedCommit !== null) {
    invariant(options.reviewedCommit === record.reviewedCommit, "--reviewed-commit differs from the attestation");
  }
  requireReviewedCheckout(record.reviewedCommit);
  const receiptSha256 = sha256Bytes(jsonBytes(record.releaseChecks));

  const canisterId = options.canisterId === null
    ? record.canisterId
    : normalizePrincipal(options.canisterId, "--canister-id");
  invariant(canisterId === record.canisterId, "--canister-id differs from the prepared attestation");
  // This read must precede every release-owned fact. A sealed release has the
  // canister itself as its sole controller, with no external controller.
  const sealedControllers = await readCertifiedControllers(canisterId);
  invariant(
    sameJson(sealedControllers, [canisterId]),
    `seal verification failed: ${canisterId} must be the only controller`,
  );

  const facts = await collectFacts({ ...options, canisterId }, record.reviewedCommit);
  assertSamePreparedFacts(record, facts, receiptSha256);
  assertSealState("verify", facts.canisterId, facts.controllers, facts.launchLatched);

  const sealed = {
    ...record,
    phase: "sealed",
    controllers: [canisterId],
    launchLatched: true,
    verifiedAt: record.verifiedAt ?? new Date().toISOString(),
  };
  validatePreparedRecord(sealed);
  writeJsonAtomic(options.record, sealed);
  console.log(`\nVerified self-controlled sealed release: ${canonicalPath(options.record)}`);
  console.log(JSON.stringify(sealed, null, 2));
  console.log("\nArchive this JSON with the protected CI run and deployment record.\n");
}

async function main() {
  const options = parseAttestationArgs(process.argv.slice(2));
  if (options.command === "checks") await runFullChecks(options);
  else if (options.command === "prepare") await prepare(options);
  else await verify(options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (cause) {
    console.error(`\nRelease attestation refused: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  }
}
