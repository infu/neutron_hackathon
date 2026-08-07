#!/usr/bin/env node
/**
 * Build the interactive local UI showcase without impersonating its human.
 *
 *   npm run showcase -- 1 @sssdf --reset
 *   # The human registers and applies in the browser.
 *   npm run showcase -- 2 @sssdf
 *   # Review the draft, then run the printed irreversible seal commands.
 *   npm run showcase -- 3 @sssdf
 *   # Each later step advances the local replica through the real deadline.
 *   npm run showcase -- 4 @sssdf   # week 2
 *   npm run showcase -- 5 @sssdf   # week 3
 *   npm run showcase -- 6 @sssdf   # week 4 + fixture ballots
 *   npm run showcase -- 7 @sssdf   # semi-final
 *   npm run showcase -- 8 @sssdf   # vote semi-final + open final
 *   npm run showcase -- 9 @sssdf   # vote final + finish season
 *
 * This script is intentionally local-only. Step 1 may reinstall the disposable
 * hackathon canister, but keeps Internet Identity and the local ledger fixtures.
 * Step 2 will not appoint or approve the target until their real, pending judge
 * and sponsor applications are visible on the canister. It then stops at a
 * draft. Step 3 uses the normal moderator start path, whose backend guard
 * requires the canister to be its sole controller, and funds through real
 * local ICRC transfers. Steps 4–9 only move PocketIC's disposable local test
 * clock past the deadline; the installed canister's normal timer still
 * performs every close. Step 8 first casts ordinary ballots as the two seeded
 * judges. No showcase code generates, installs, or injects another actor.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { hashIdentity } from "icblast";

import { idlFactory } from "../frontend/src/declarations/hackathon.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = join(ROOT, ".icp", "showcase.json");
const LOCAL_DESCRIPTOR = join(ROOT, ".icp", "cache", "networks", "local", "descriptor.json");
// Use Vite for the time-travelling showcase. The certified gateway correctly
// rejects a certificate dated weeks ahead of the workstation, while the local
// frontend agent explicitly synchronizes to PocketIC's simulated clock.
const APP_URL = "http://hackathon.local.localhost:5174/#/register";
const SEASON_URL = "http://hackathon.local.localhost:5174/#/season";
const WEEK_ONE_APPS = 15;
const ROUND_FIXTURES = Object.freeze({
  2: { apps: 12, publicApps: 10, mixed: true, fixtureVotes: false },
  3: { apps: 7, publicApps: 7, mixed: false, fixtureVotes: false },
  4: { apps: 7, publicApps: 7, mixed: false, fixtureVotes: true },
});
const ONE_SECOND_NANOS = 1_000_000_000n;
const FINAL_WEEK = 6;
const MAX_ROUND_JUMP_NANOS = 8n * 24n * 60n * 60n * ONE_SECOND_NANOS;
const USAGE =
  "usage: npm run showcase -- <1..9|prepare|draft|start|week-2|week-3|week-4|semifinal|final|finish> @handle [--reset for step 1]";

export const SHOWCASE_STEPS = Object.freeze([
  { number: 1, name: "prepare", aliases: ["1", "step-1", "prepare"] },
  { number: 2, name: "draft", aliases: ["2", "step-2", "draft"] },
  { number: 3, name: "start", aliases: ["3", "step-3", "start"] },
  { number: 4, name: "week-two", aliases: ["4", "step-4", "week-2"] },
  { number: 5, name: "week-three", aliases: ["5", "step-5", "week-3"] },
  { number: 6, name: "week-four", aliases: ["6", "step-6", "week-4"] },
  { number: 7, name: "semifinal", aliases: ["7", "step-7", "semifinal", "semi-final"] },
  { number: 8, name: "final", aliases: ["8", "step-8", "final"] },
  { number: 9, name: "finish", aliases: ["9", "step-9", "finish", "close-final"] },
]);

export function parseArgs(argv) {
  let step = null;
  let handle = null;
  let reset = false;

  for (const arg of argv) {
    if (arg === "--reset") {
      reset = true;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    if (step === null) {
      step = SHOWCASE_STEPS.find((candidate) => candidate.aliases.includes(arg))?.number ?? null;
      if (step === null) throw new Error(`unknown showcase step: ${arg}`);
      continue;
    }
    if (handle !== null) throw new Error("provide exactly one handle");
    handle = arg.startsWith("@") ? arg.slice(1) : arg;
  }

  if (step === null || handle === null) throw new Error(USAGE);
  if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
    throw new Error("handle must be 3-32 characters of a-z, 0-9 or _");
  }
  if (reset && step !== 1) throw new Error("--reset is only valid for showcase step 1");
  return { step, handle, reset };
}

/** Read only the public role state needed at the step boundary. */
export function parseProfile(candid) {
  if (!/\bopt\s+record\s*\{/.test(candid)) return null;
  const state = (field) =>
    new RegExp(`\\b${field}\\s*=\\s*variant\\s*\\{\\s*(approved|pending|no)\\b`).exec(
      candid,
    )?.[1] ?? null;
  const number = (field) => {
    const raw = new RegExp(`\\b${field}\\s*=\\s*([0-9_]+)(?:\\s*:\\s*nat64)?\\b`).exec(
      candid,
    )?.[1];
    return raw ? BigInt(raw.replaceAll("_", "")) : null;
  };
  return {
    id: number("id"),
    updatedAt: number("updatedAt"),
    hacker: /\bhacker\s*=\s*true\b/.test(candid),
    moderator: /\bmoderator\s*=\s*true\b/.test(candid),
    judgeStatus: state("judgeStatus"),
    sponsorStatus: state("sponsorStatus"),
    hasSponsorApplication: /\bsponsor\s*=\s*opt\s+record\s*\{/.test(candid),
  };
}

/** Encode the exact public row a role action was reviewed against. */
export function roleTargetCandid(profile, role) {
  if (profile?.id === null || profile?.id === undefined) {
    throw new Error("the profile has no immutable account id");
  }
  if (profile.updatedAt === null || profile.updatedAt === undefined) {
    throw new Error("the profile has no update generation");
  }
  const expected = switchRole(profile, role);
  return (
    "record { " +
    `id = ${profile.id} : nat64; ` +
    `${expected.field} = ${expected.value}; ` +
    `expectedUpdatedAt = ${profile.updatedAt} : nat64 ` +
    "}"
  );
}

function switchRole(profile, role) {
  if (role === "judge") {
    if (!profile.judgeStatus) throw new Error("the profile has no judge state");
    return {
      field: "expectedStatus",
      value: `variant { ${profile.judgeStatus} }`,
    };
  }
  if (role === "sponsor") {
    if (!profile.sponsorStatus) throw new Error("the profile has no sponsor state");
    return {
      field: "expectedStatus",
      value: `variant { ${profile.sponsorStatus} }`,
    };
  }
  if (role === "moderator") {
    return { field: "expectedOn", value: String(profile.moderator) };
  }
  throw new Error(`unknown role target: ${role}`);
}

export function applicantProblems(profile, handle) {
  if (profile === null) return [`register @${handle}`];
  const problems = [];
  if (!profile.hacker) problems.push("choose Hacker");
  if (profile.judgeStatus !== "pending") problems.push("submit a Judge application");
  if (profile.sponsorStatus !== "pending" || !profile.hasSponsorApplication) {
    problems.push("submit a Sponsor application with an organisation and at least one ledger");
  }
  return problems;
}

export function parseSeason(candid) {
  if (!/\bopt\s+record\s*\{/.test(candid)) return null;
  const number = (field) => {
    const raw = new RegExp(`\\b${field}\\s*=\\s*([0-9_]+)`).exec(candid)?.[1];
    return raw ? BigInt(raw.replaceAll("_", "")) : null;
  };
  const phase = /\bphase\s*=\s*variant\s*\{\s*(draft|running|finished)\b/.exec(candid)?.[1] ?? null;
  return { id: number("id"), week: number("week"), phase };
}

export function parseWeekTotals(candid) {
  const totals = new Map();
  const rows = candid.matchAll(
    /\btotal\s*=\s*([0-9_]+)\s*:\s*nat\s*;\s*week\s*=\s*([0-9_]+)\s*:\s*nat\b/g,
  );
  for (const row of rows) {
    totals.set(Number(row[2].replaceAll("_", "")), Number(row[1].replaceAll("_", "")));
  }
  return totals;
}

/** The sealed state has exactly one controller: the canister itself. */
export function selfControlled(held, canister) {
  return held.length === 1 && held[0] === canister;
}

/**
 * Move just far enough past one published round deadline.
 *
 * The eight-day ceiling catches a stale descriptor, a wrong season, or a bad
 * unit before a local test clock is moved irreversibly into the distant
 * future. PocketIC, like the IC, does not permit time to move backwards.
 */
export function replicaAdvanceTarget(currentNanos, deadlineNanos) {
  const current = BigInt(currentNanos);
  const deadline = BigInt(deadlineNanos);
  if (deadline <= 0n) throw new Error("the open week has no valid deadline");
  if (current >= deadline) return current;
  const target = deadline + ONE_SECOND_NANOS;
  if (target - current > MAX_ROUND_JUMP_NANOS) {
    throw new Error("refusing to move the local replica clock by more than eight days");
  }
  return target;
}

function phaseOf(season) {
  return season ? Object.keys(season.phase)[0] ?? null : null;
}

async function localActor(id, identity) {
  const agent = await HttpAgent.create({
    host: "http://127.0.0.1:8943",
    ...(identity ? { identity } : {}),
    shouldFetchRootKey: true,
    shouldSyncTime: true,
    verifyQuerySignatures: false,
  });
  return Actor.createActor(idlFactory, { agent, canisterId: id });
}

async function publicActor(id) {
  return localActor(id);
}

async function fixtureActor(id, identityNumber) {
  return localActor(id, await hashIdentity(identityNumber));
}

function localPocketIc() {
  const descriptor = JSON.parse(readFileSync(LOCAL_DESCRIPTOR, "utf8"));
  if (descriptor.network !== "local" || resolve(descriptor["project-dir"] ?? "") !== ROOT) {
    throw new Error("the PocketIC descriptor does not belong to this local project");
  }
  const port = descriptor["pocketic-config-port"];
  const instance = descriptor["pocketic-instance-id"];
  if (!Number.isInteger(port) || port < 1 || !Number.isInteger(instance) || instance < 0) {
    throw new Error("the local PocketIC descriptor has no usable server or instance id");
  }
  return {
    base: `http://127.0.0.1:${port}`,
    instancePath: `/instances/${instance}`,
  };
}

const pocketPause = () => new Promise((resolvePause) => setTimeout(resolvePause, 25));

async function pocketPayload(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error(`PocketIC returned HTTP ${response.status}: ${raw.slice(0, 240)}`);
  }
}

async function pollPocketOperation(base, state) {
  const url = `${base}/read_graph/${encodeURIComponent(state.state_label)}/${encodeURIComponent(state.op_id)}`;
  const expires = Date.now() + 30_000;
  while (Date.now() < expires) {
    const response = await fetch(url);
    const payload = await pocketPayload(response);
    if (response.ok && !("state_label" in payload) && !("message" in payload)) return payload;
    await pocketPause();
  }
  throw new Error("PocketIC did not finish the clock operation within 30 seconds");
}

async function pocketRequest(path, { method = "GET", body } = {}) {
  const { base, instancePath } = localPocketIc();
  const expires = Date.now() + 30_000;
  while (Date.now() < expires) {
    const response = await fetch(`${base}${instancePath}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await pocketPayload(response);
    if (response.status === 409) {
      await pocketPause();
      continue;
    }
    if (response.status === 202 && "state_label" in payload && "op_id" in payload) {
      return pollPocketOperation(base, payload);
    }
    if (!response.ok || "message" in payload) {
      throw new Error(payload.message ?? `PocketIC returned HTTP ${response.status}`);
    }
    return payload;
  }
  throw new Error("PocketIC remained busy for 30 seconds");
}

async function pocketControllers(canister) {
  const rows = await pocketRequest("/read/get_controllers", {
    method: "POST",
    body: {
      canister_id: Buffer.from(Principal.fromText(canister).toUint8Array()).toString("base64"),
    },
  });
  if (!Array.isArray(rows)) throw new Error("PocketIC returned no controller list");
  return rows.map((row) => {
    if (typeof row?.principal_id !== "string") {
      throw new Error("PocketIC returned a malformed controller");
    }
    return Principal.fromUint8Array(Buffer.from(row.principal_id, "base64")).toText();
  });
}

async function advanceThroughDeadline(actor, canister, expectedWeek) {
  const [held, live, due, armed] = await Promise.all([
    pocketControllers(canister),
    actor.season_running(),
    actor.week_ends_at(),
    actor.clock_armed(),
  ]);
  if (!selfControlled(held, canister)) {
    throw new Error("refusing to advance: the canister is not its sole controller");
  }
  const season = live[0];
  if (!season || phaseOf(season) !== "running" || Number(season.week) !== expectedWeek) {
    throw new Error(
      `expected running week ${expectedWeek}, got ${season ? `${phaseOf(season)} week ${season.week}` : "no season"}`,
    );
  }
  if (!armed) throw new Error(`week ${expectedWeek} has no armed close timer`);
  const deadline = due[0];
  if (deadline === undefined || deadline !== season.weekEndsAt) {
    throw new Error("the public deadline does not match the running season");
  }

  const clock = await pocketRequest("/read/get_time");
  if (typeof clock.nanos_since_epoch !== "number") {
    throw new Error("PocketIC returned no local clock value");
  }
  const current = BigInt(Math.trunc(clock.nanos_since_epoch));
  const target = replicaAdvanceTarget(current, deadline);
  if (target > current) {
    await pocketRequest("/update/set_time", {
      method: "POST",
      // JSON has no uint64 type. One second of headroom makes the harmless
      // sub-microsecond rounding of this number immaterial.
      body: { nanos_since_epoch: Number(target) },
    });
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await pocketRequest("/update/tick", { method: "POST", body: {} });
    const after = (await actor.season_running())[0];
    if (after && phaseOf(after) === "running" && Number(after.week) === expectedWeek + 1) {
      return after;
    }
    if (expectedWeek === FINAL_WEEK && !after) {
      const finished = (await actor.seasons(10n)).find((row) => row.id === season.id);
      if (finished && phaseOf(finished) === "finished") return finished;
    }
  }
  throw new Error(
    expectedWeek === FINAL_WEEK
      ? "the normal timer did not finish the final"
      : `the normal timer did not advance week ${expectedWeek}`,
  );
}

function localEnvironment() {
  for (const name of ["ICP_ENVIRONMENT", "ICP_CLI_ENVIRONMENT", "ICP_NETWORK"]) {
    const value = process.env[name];
    if (value && value !== "local") {
      throw new Error(`${name}=${value} is set; the showcase script is local-only`);
    }
  }
  const environment = {
    ...process.env,
    ICP_ENVIRONMENT: "local",
    ICP_CLI_ENVIRONMENT: "local",
  };
  delete environment.ICP_NETWORK;
  return environment;
}

let ENV;

function command(program, args, { capture = false, input = "" } = {}) {
  const result = spawnSync(program, args, {
    cwd: ROOT,
    env: ENV,
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${program} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return (result.stdout ?? "").trim();
}

function tryCommand(program, args) {
  const result = spawnSync(program, args, {
    cwd: ROOT,
    env: ENV,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ok: !result.error && result.status === 0, output: (result.stdout ?? "").trim() };
}

function icp(args, options = {}) {
  return command("icp", [...args, "--environment", "local"], options);
}

function canisterId(name) {
  return icp(["canister", "status", name, "--id-only"], { capture: true });
}

function canisterExists(name) {
  return tryCommand("icp", [
    "canister",
    "status",
    name,
    "--id-only",
    "--environment",
    "local",
  ]).ok;
}

function callCandid(method, args = "()", { query = false } = {}) {
  const raw = icp(
    ["canister", "call", "hackathon", method, args, ...(query ? ["--query"] : []), "--json"],
    { capture: true, input: "y\n" },
  );
  const candid = JSON.parse(raw).response_candid;
  if (typeof candid !== "string") throw new Error(`icp returned no Candid for ${method}`);
  return candid;
}

function requireOk(label, candid) {
  if (!/variant\s*\{\s*ok\s*=/.test(candid)) {
    throw new Error(`${label} was refused: ${candid.trim()}`);
  }
}

function statsUsers() {
  const candid = callCandid("stats", "()", { query: true });
  const raw = /\busers\s*=\s*([0-9_]+)/.exec(candid)?.[1];
  if (!raw) throw new Error("could not read stats().users");
  return Number(raw.replaceAll("_", ""));
}

function profile(handle) {
  return parseProfile(callCandid("profile", `(${JSON.stringify(handle)})`, { query: true }));
}

function currentRoleTarget(handle, role) {
  const current = profile(handle);
  if (current === null) throw new Error(`@${handle} is no longer registered`);
  return roleTargetCandid(current, role);
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      throw new Error("no showcase state is recorded; run step 1 first");
    }
    throw cause;
  }
}

function writeState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ version: 1, ...state }, null, 2) + "\n");
}

function ensureNetwork() {
  if (tryCommand("icp", ["network", "status"]).ok) return;
  console.log("Starting the local network...");
  command("icp", ["network", "start", "-d"]);
}

function ensureLedgers() {
  const check = tryCommand(process.execPath, ["scripts/ledger-allowlist.mjs", "--check"]);
  if (!check.ok) {
    console.log("Creating fresh local ledger fixtures...");
    command("npm", ["run", "ledgers:local", "--", "--fresh"]);
  } else if (check.output) {
    console.log(check.output);
  }
}

function prepare({ handle, reset }) {
  ensureNetwork();
  ensureLedgers();

  if (!canisterExists("internet_identity")) {
    console.log("Deploying local Internet Identity...");
    icp(["deploy", "internet_identity", "--mode", "install", "--yes"]);
  }

  const installed = canisterExists("hackathon");
  if (installed && !reset) {
    const users = statsUsers();
    if (users > 0) {
      throw new Error(
        `the local hackathon already has ${users} user(s); rerun step 1 with --reset to erase only that disposable canister`,
      );
    }
  }

  const mode = installed ? (reset ? "reinstall" : "upgrade") : "install";
  console.log(`${mode === "reinstall" ? "Resetting" : "Deploying"} the local hackathon...`);
  icp(["deploy", "hackathon", "--mode", mode, "--yes"]);
  command("npm", ["run", "ledgers:allow"]);

  if (statsUsers() !== 0) throw new Error("step 1 postcondition failed: the site is not empty");
  writeState({
    completedStep: 1,
    phase: "awaiting-applications",
    handle,
    canisterId: canisterId("hackathon"),
    preparedAt: new Date().toISOString(),
  });

  console.log(`\nStep 1 is ready for @${handle}.`);
  console.log(`Open ${APP_URL}`);
  console.log("  1. Sign in and register that exact handle.");
  console.log("  2. Choose Hacker and Judge.");
  console.log("  3. Choose Sponsor, fill in the organisation, and select at least one test ledger.");
  console.log("  4. Finish registration, then tell me you are done.");
  console.log(
    "Moderator is appointed rather than self-applied; step 2 will appoint the recorded handle only after both applications are pending.",
  );
  console.log(`\nThen run: npm run showcase -- 2 @${handle}`);
}

function approveApplicant(handle) {
  command("npm", ["run", "moderator", "--", `@${handle}`]);
  requireOk(
    `approve @${handle} as judge`,
    callCandid(
      "set_judge",
      `(${currentRoleTarget(handle, "judge")}, variant { approved }, opt "interactive local showcase")`,
    ),
  );
  requireOk(
    `approve @${handle} as sponsor`,
    callCandid(
      "set_sponsor",
      `(${currentRoleTarget(handle, "sponsor")}, variant { approved }, opt "interactive local showcase")`,
    ),
  );

  const after = profile(handle);
  if (
    after === null ||
    !after.hacker ||
    !after.moderator ||
    after.judgeStatus !== "approved" ||
    after.sponsorStatus !== "approved"
  ) {
    throw new Error(`@${handle} did not finish with all four roles`);
  }
}

function sealCommands(canister, handle) {
  return [
    `icp canister settings update hackathon --environment local --add-controller ${canister} --force`,
    "echo y | icp canister call hackathon seal_canister '()' --environment local",
    `npm run showcase -- 3 @${handle}`,
  ];
}

function verifyRoles(handle) {
  const roles = profile(handle);
  if (
    roles === null ||
    !roles.hacker ||
    !roles.moderator ||
    roles.judgeStatus !== "approved" ||
    roles.sponsorStatus !== "approved"
  ) {
    throw new Error(`showcase postcondition failed: @${handle} no longer has all four roles`);
  }
}

function draftShowcase({ handle }) {
  ensureNetwork();
  const state = readState();
  const currentCanister = canisterId("hackathon");
  if (state.completedStep !== 1 || state.phase !== "awaiting-applications") {
    throw new Error(`showcase step 2 cannot follow recorded phase ${state.phase ?? "unknown"}`);
  }
  if (state.handle !== handle) {
    throw new Error(`step 1 is waiting for @${state.handle}, not @${handle}`);
  }
  if (state.canisterId !== currentCanister) {
    throw new Error("the local hackathon canister changed after step 1; prepare it again");
  }

  const problems = applicantProblems(profile(handle), handle);
  if (problems.length > 0) {
    throw new Error(
      `step 2 is waiting for you to finish in the browser:\n  - ${problems.join("\n  - ")}\nOpen ${APP_URL}`,
    );
  }

  console.log(`Verified @${handle}: Hacker active, Judge pending, Sponsor pending.`);
  approveApplicant(handle);
  command(process.execPath, ["scripts/seed.mjs", "--season", "--scale", "10"]);

  const draft = parseSeason(callCandid("season", "()", { query: true }));
  if (draft?.id === null || draft?.id === undefined || draft.phase !== "draft") {
    throw new Error("the base fixture did not leave one draft season");
  }
  verifyRoles(handle);

  writeState({
    ...state,
    completedStep: 2,
    phase: "awaiting-seal",
    seasonId: String(draft.id),
    draftedAt: new Date().toISOString(),
  });
  console.log(`\nStep 2 is complete. Review the draft at ${SEASON_URL}`);
  console.log("\nWhen every code, asset, role, and ledger check is final, run these one-way commands:");
  for (const line of sealCommands(currentCanister, handle)) console.log(`  ${line}`);
  console.log("\nStep 3 will start only after the canister is its sole controller.");
}

function startShowcase({ handle }) {
  ensureNetwork();
  const state = readState();
  const currentCanister = canisterId("hackathon");
  if (state.completedStep !== 2 || state.phase !== "awaiting-seal") {
    throw new Error(`showcase step 3 cannot follow recorded phase ${state.phase ?? "unknown"}`);
  }
  if (state.handle !== handle) {
    throw new Error(`the showcase belongs to @${state.handle}, not @${handle}`);
  }
  if (state.canisterId !== currentCanister) {
    throw new Error("the local hackathon canister changed after step 2; prepare it again");
  }

  let running = parseSeason(callCandid("season_running", "()", { query: true }));
  if (running && (running.id !== BigInt(state.seasonId) || running.week !== 1n)) {
    throw new Error(
      `expected sealed season ${state.seasonId} at week 1, got season ${running.id} week ${running.week}`,
    );
  }

  let weekOneTotal = running
    ? (parseWeekTotals(
        callCandid("season_map", `(${running.id} : nat64, 50 : nat)`, { query: true }),
      ).get(1) ?? 0)
    : 0;
  if (weekOneTotal > 0 && weekOneTotal !== WEEK_ONE_APPS) {
    throw new Error(
      `refusing to hide a partial week-one fixture (${weekOneTotal}/${WEEK_ONE_APPS})`,
    );
  }
  if (!running || weekOneTotal === 0) {
    command(process.execPath, ["scripts/seed.mjs", "--start-season", "--open", "1"]);
    running = parseSeason(callCandid("season_running", "()", { query: true }));
  }

  if (running?.id !== BigInt(state.seasonId) || running.phase !== "running" || running.week !== 1n) {
    throw new Error("normal start_season did not leave the sealed draft running at week 1");
  }
  weekOneTotal =
    parseWeekTotals(
      callCandid("season_map", `(${running.id} : nat64, 50 : nat)`, { query: true }),
    ).get(1) ?? 0;
  if (weekOneTotal !== WEEK_ONE_APPS) {
    throw new Error(`expected ${WEEK_ONE_APPS} week-one apps, got ${weekOneTotal}`);
  }

  command(process.execPath, ["scripts/seed.mjs", "--fund", "--fund-sponsor", handle]);
  verifyRoles(handle);

  writeState({
    ...state,
    completedStep: 3,
    phase: "week-1-running",
    startedAt: new Date().toISOString(),
    fundedAt: new Date().toISOString(),
  });
  console.log(`\nStep 3 is complete. The sealed season is running at week 1 with ${weekOneTotal} apps.`);
  console.log("The installed canister has no close method. Step 4 advances only PocketIC's local");
  console.log("test clock; the normal canister timer still resolves and carries the round.");
  console.log(`Next: npm run showcase -- 4 @${handle}`);
  console.log(`Open ${SEASON_URL}`);
}

/**
 * Ordinary seeded-judge ballots for the semi-final.
 *
 * The week-2 seat wins the Sable-v-Sable first duel, which proves the two
 * carried entries are genuinely independent. Atlas wins the other duel. Alan
 * uses both votes and Katherine uses one: voting is optional, and the unequal
 * 2/1 totals make this round visibly different from the qualifier fixtures.
 */
export const SEMIFINAL_FIXTURE_BALLOTS = Object.freeze([
  Object.freeze({
    identity: 20,
    handle: "alan",
    originWeeks: Object.freeze([2, 4]),
  }),
  Object.freeze({
    identity: 21,
    handle: "katherine",
    originWeeks: Object.freeze([2]),
  }),
]);

/** Atlas wins the final 2–1; both finalists receive a real vote. */
export const FINAL_FIXTURE_BALLOTS = Object.freeze([
  Object.freeze({
    identity: 20,
    handle: "alan",
    originWeeks: Object.freeze([2, 4]),
  }),
  Object.freeze({
    identity: 21,
    handle: "katherine",
    originWeeks: Object.freeze([4]),
  }),
]);

async function semifinalField(actor, seasonId) {
  const rows = await actor.season_week_view(seasonId, 5n, 50n);
  if (rows.length !== 4) {
    throw new Error(`expected four qualifier winners in the semi-final, got ${rows.length}`);
  }

  const byOriginWeek = new Map();
  for (const row of rows) {
    const originId = row.entry.origin_id[0];
    if (originId === undefined) {
      throw new Error(`semi-final entry ${row.entry.id} has no qualifier origin`);
    }
    const origin = (await actor.entry_detail(originId))[0];
    if (!origin) throw new Error(`could not read qualifier origin ${originId}`);
    const originWeek = Number(origin.entry.week);
    if (originWeek < 1 || originWeek > 4 || byOriginWeek.has(originWeek)) {
      throw new Error(`semi-final has an invalid or repeated week-${originWeek} origin`);
    }
    byOriginWeek.set(originWeek, row);
  }
  return { rows, byOriginWeek };
}

async function finalField(actor, seasonId) {
  const [semi, rows] = await Promise.all([
    semifinalField(actor, seasonId),
    actor.season_week_view(seasonId, 6n, 50n),
  ]);
  if (rows.length !== 2) {
    throw new Error(`expected two semi-final winners in the final, got ${rows.length}`);
  }

  const weekBySemiId = new Map(
    [...semi.byOriginWeek].map(([originWeek, row]) => [String(row.entry.id), originWeek]),
  );
  const byOriginWeek = new Map();
  for (const row of rows) {
    const originId = row.entry.origin_id[0];
    const originWeek = originId === undefined ? undefined : weekBySemiId.get(String(originId));
    if (originWeek === undefined || byOriginWeek.has(originWeek)) {
      throw new Error(`final entry ${row.entry.id} has an invalid semi-final origin`);
    }
    byOriginWeek.set(originWeek, row);
  }
  return { rows, byOriginWeek };
}

async function castFixtureBallots(canister, loadField, ballots, round) {
  const { byOriginWeek } = await loadField();
  const prepared = [];

  // Validate both identities and their remaining room before making the first
  // update. A rerun after one accepted ballot remains safe: my_vote_on turns
  // that pick into a skip and only the missing picks consume room.
  for (const ballot of ballots) {
    const judge = await fixtureActor(canister, ballot.identity);
    const me = (await judge.me())[0];
    if (!me || me.handle !== ballot.handle || !("approved" in me.judgeStatus)) {
      throw new Error(`fixture identity ${ballot.identity} is not approved judge @${ballot.handle}`);
    }
    const picks = ballot.originWeeks.map((originWeek) => {
      const row = byOriginWeek.get(originWeek);
      if (!row) throw new Error(`the ${round} has no week-${originWeek} seat`);
      return { originWeek, row };
    });
    const already = await Promise.all(
      picks.map(({ row }) => judge.my_vote_on(row.entry.id)),
    );
    const missing = picks.filter((_, index) => !already[index]);
    const left = Number(await judge.my_votes_left());
    if (left < missing.length) {
      throw new Error(
        `@${ballot.handle} has ${left} vote(s) left but the fixture needs ${missing.length}`,
      );
    }
    prepared.push({ ...ballot, judge, missing });
  }

  for (const ballot of prepared) {
    for (const { originWeek, row } of ballot.missing) {
      const result = await ballot.judge.cast_vote(row.entry.id);
      if ("err" in result) {
        throw new Error(
          `@${ballot.handle} could not vote for ${row.entry.title}: ${Object.keys(result.err)[0] ?? "refused"}`,
        );
      }
      console.log(
        `  ok   @${ballot.handle} votes ${row.entry.title} (week ${originWeek} seat)`,
      );
    }
    if (ballot.missing.length === 0) {
      console.log(`  skip @${ballot.handle}'s ${round} ballot is already recorded`);
    }
  }

  const after = await loadField();
  const originById = new Map(
    [...after.byOriginWeek].map(([originWeek, row]) => [String(row.entry.id), originWeek]),
  );
  for (const row of after.rows) {
    console.log(
      `  ${String(row.entry.votes).padStart(2)} votes  ${row.entry.title} (week ${originById.get(String(row.entry.id)) ?? "?"} seat)`,
    );
  }
  return after;
}

function requireClearWinner(field, winnerWeek, otherWeek, round) {
  const winner = field.byOriginWeek.get(winnerWeek);
  const other = field.byOriginWeek.get(otherWeek);
  if (!winner || !other || winner.entry.votes <= other.entry.votes) {
    throw new Error(
      `${round} fixture has no clear week-${winnerWeek} winner over week ${otherWeek}`,
    );
  }
}

async function castSemifinalFixture(canister, actor, season) {
  const after = await castFixtureBallots(
    canister,
    () => semifinalField(actor, season.id),
    SEMIFINAL_FIXTURE_BALLOTS,
    "semi-final",
  );

  // Refuse to close on an accidental tie (for example if someone used the
  // interactive judge account between stages). The normal canister still
  // resolves the duels; this only proves the fixture will show the intended
  // two finalists before advancing the clock.
  for (const [winnerWeek, otherWeek] of [[2, 1], [4, 3]]) {
    requireClearWinner(after, winnerWeek, otherWeek, "semi-final");
  }
}

async function castFinalFixture(canister, actor, season) {
  const after = await castFixtureBallots(
    canister,
    () => finalField(actor, season.id),
    FINAL_FIXTURE_BALLOTS,
    "final",
  );
  requireClearWinner(after, 4, 2, "final");
}

const ROUND_STAGES = Object.freeze({
  4: {
    fromWeek: 1,
    toWeek: 2,
    before: ["week-1-running"],
    openPhase: "week-2-open",
    donePhase: "week-2-populated",
  },
  5: {
    fromWeek: 2,
    toWeek: 3,
    before: ["week-2-populated"],
    openPhase: "week-3-open",
    donePhase: "week-3-populated",
  },
  6: {
    fromWeek: 3,
    toWeek: 4,
    // `week-3-populated` is also the last state written by the older local
    // showcase. It can continue here, but only after the canister is sealed.
    before: ["week-3-populated"],
    openPhase: "week-4-open",
    donePhase: "week-4-populated",
  },
  7: {
    fromWeek: 4,
    toWeek: 5,
    before: ["week-4-populated"],
    openPhase: "semifinal-open",
    donePhase: "semifinal-open",
  },
  8: {
    fromWeek: 5,
    toWeek: 6,
    // `semifinal-voted` makes a partially completed step safely resumable.
    before: ["semifinal-open", "semifinal-voted"],
    openPhase: "final-open",
    donePhase: "final-open",
  },
});

async function progressShowcase({ handle }, stepNumber) {
  ensureNetwork();
  let state = readState();
  const stage = ROUND_STAGES[stepNumber];
  const currentCanister = canisterId("hackathon");
  if (state.handle !== handle) {
    throw new Error(`the showcase belongs to @${state.handle}, not @${handle}`);
  }
  if (state.canisterId !== currentCanister) {
    throw new Error("the local hackathon canister changed; prepare the showcase again");
  }

  const actor = await publicActor(currentCanister);
  let running = (await actor.season_running())[0];
  if (!running || phaseOf(running) !== "running") {
    throw new Error("no running showcase season was found");
  }

  const week = Number(running.week);
  if (week === stage.fromWeek) {
    if (!stage.before.includes(state.phase)) {
      throw new Error(
        `showcase step ${stepNumber} cannot close week ${stage.fromWeek} after recorded phase ${state.phase ?? "unknown"}`,
      );
    }
    console.log(
      `Advancing only the disposable local replica clock through week ${stage.fromWeek}'s published deadline...`,
    );
    if (stepNumber === 8) {
      console.log("Casting the seeded judges' ordinary semi-final ballots first...");
      await castSemifinalFixture(currentCanister, actor, running);
      state = {
        ...state,
        phase: "semifinal-voted",
        semifinalVotedAt: new Date().toISOString(),
      };
      writeState(state);
    }
    running = await advanceThroughDeadline(actor, currentCanister, stage.fromWeek);
    state = {
      ...state,
      phase: stage.openPhase,
      [`week${stage.toWeek}OpenedAt`]: new Date().toISOString(),
    };
    writeState(state);
  } else if (
    week === stage.toWeek &&
    [...stage.before, stage.openPhase, stage.donePhase].includes(state.phase)
  ) {
    if (stage.before.includes(state.phase)) {
      state = {
        ...state,
        phase: stage.openPhase,
        [`week${stage.toWeek}OpenedAt`]: new Date().toISOString(),
      };
      writeState(state);
    }
    console.log(`Week ${stage.toWeek} is already open; resuming its fixture check.`);
  } else {
    throw new Error(
      `showcase step ${stepNumber} expected week ${stage.fromWeek}, got week ${week} after recorded phase ${state.phase ?? "unknown"}`,
    );
  }

  if (stage.toWeek <= 4) {
    const fixture = ROUND_FIXTURES[stage.toWeek];
    let rows = await actor.season_week_view(running.id, BigInt(stage.toWeek), 50n);
    if (rows.length === 0) {
      const args = ["scripts/seed.mjs", "--advance", "--apps", String(fixture.apps)];
      if (fixture.mixed) args.push("--mixed");
      if (fixture.fixtureVotes) args.push("--fixture-votes");
      command(process.execPath, args);
      rows = await actor.season_week_view(running.id, BigInt(stage.toWeek), 50n);
    } else if (rows.length !== fixture.publicApps) {
      throw new Error(
        `refusing to hide a partial week-${stage.toWeek} fixture (${rows.length}/${fixture.publicApps})`,
      );
    }
    if (rows.length !== fixture.publicApps) {
      throw new Error(
        `expected ${fixture.publicApps} public apps in week ${stage.toWeek}, got ${rows.length}`,
      );
    }
    if (fixture.fixtureVotes) {
      const atlas = rows.find((row) => row.entry.title === "Atlas");
      if (!atlas || atlas.entry.votes < 2n) {
        throw new Error("week 4 did not finish with the explicit Atlas showcase ballots");
      }
    }
    console.log(`Week ${stage.toWeek} now has ${rows.length} public apps.`);
  } else if (stage.toWeek === 5) {
    await semifinalField(actor, running.id);
    console.log("The four qualifier winners are now carried into the semi-final.");
  } else {
    const [semi, finalists] = await Promise.all([
      semifinalField(actor, running.id),
      actor.season_week_view(running.id, 6n, 50n),
    ]);
    if (finalists.length !== 2) {
      throw new Error(`expected two semi-final winners in the final, got ${finalists.length}`);
    }
    const expectedOrigins = new Set([
      String(semi.byOriginWeek.get(2)?.entry.id),
      String(semi.byOriginWeek.get(4)?.entry.id),
    ]);
    if (
      finalists.some(
        (row) => row.entry.origin_id[0] === undefined || !expectedOrigins.has(String(row.entry.origin_id[0])),
      )
    ) {
      throw new Error("the final does not contain the two intended semi-final winners");
    }
    console.log(
      `The final is open: ${finalists.map((row) => row.entry.title).join(" vs ")}.`,
    );
  }

  const held = await pocketControllers(currentCanister);
  if (!selfControlled(held, currentCanister)) {
    throw new Error("controller list changed while the showcase advanced");
  }
  writeState({
    ...state,
    completedStep: stepNumber,
    phase: stage.donePhase,
    [`step${stepNumber}CompletedAt`]: new Date().toISOString(),
  });

  console.log(`\nStep ${stepNumber} is complete at week ${stage.toWeek}.`);
  if (stepNumber < 9) {
    console.log(`Next: npm run showcase -- ${stepNumber + 1} @${handle}`);
  }
  console.log(`Open ${SEASON_URL}`);
}

async function finishShowcase({ handle }) {
  ensureNetwork();
  let state = readState();
  const currentCanister = canisterId("hackathon");
  if (state.handle !== handle) {
    throw new Error(`the showcase belongs to @${state.handle}, not @${handle}`);
  }
  if (state.canisterId !== currentCanister) {
    throw new Error("the local hackathon canister changed; prepare the showcase again");
  }

  const actor = await publicActor(currentCanister);
  const running = (await actor.season_running())[0];
  const seasonId =
    state.seasonId === undefined
      ? (running?.id ?? (await actor.seasons(1n))[0]?.id)
      : BigInt(state.seasonId);
  if (seasonId === undefined) throw new Error("the showcase has no Season to finish");
  let finished;

  if (running) {
    if (
      running.id !== seasonId ||
      phaseOf(running) !== "running" ||
      Number(running.week) !== FINAL_WEEK ||
      !["final-open", "final-voted"].includes(state.phase)
    ) {
      throw new Error(
        `showcase step 9 expected the open final, got ${phaseOf(running)} week ${running.week} after ${state.phase ?? "unknown"}`,
      );
    }

    console.log("Casting the seeded judges' ordinary final ballots...");
    await castFinalFixture(currentCanister, actor, running);
    state = {
      ...state,
      phase: "final-voted",
      finalVotedAt: new Date().toISOString(),
    };
    writeState(state);
    console.log("Advancing only the disposable local replica clock through the final deadline...");
    finished = await advanceThroughDeadline(actor, currentCanister, FINAL_WEEK);
  } else {
    if (!["final-open", "final-voted", "finished"].includes(state.phase)) {
      throw new Error(`showcase step 9 cannot follow recorded phase ${state.phase ?? "unknown"}`);
    }
    finished = (await actor.seasons(10n)).find((row) => row.id === seasonId);
  }

  if (!finished || phaseOf(finished) !== "finished") {
    throw new Error("the normal final timer did not leave a finished season");
  }
  const field = await finalField(actor, seasonId);
  const winner = field.byOriginWeek.get(4);
  const other = field.byOriginWeek.get(2);
  requireClearWinner(field, 4, 2, "final");
  if (!winner || !("won" in winner.entry.outcome) || !other || !("none" in other.entry.outcome)) {
    throw new Error("the final entries do not record Atlas as the sole winner");
  }

  const [held, armed, fundingClosing] = await Promise.all([
    pocketControllers(currentCanister),
    actor.clock_armed(),
    actor.funding_closing(),
  ]);
  if (!selfControlled(held, currentCanister)) {
    throw new Error("controller list changed while the final closed");
  }
  if (armed) throw new Error("the finished season still has a week-close timer armed");
  if (!fundingClosing) throw new Error("final funding reconciliation did not start");

  writeState({
    ...state,
    seasonId: String(seasonId),
    completedStep: 9,
    phase: "finished",
    finalWinner: winner.entry.title,
    step9CompletedAt: new Date().toISOString(),
  });
  console.log(`\nStep 9 is complete. ${winner.entry.title} won the final ${winner.entry.votes}–${other.entry.votes}.`);
  console.log("The Season is finished and its automatic funding-reconciliation window has begun.");
  console.log(`Open ${SEASON_URL}`);
}

async function main() {
  ENV = localEnvironment();
  const options = parseArgs(process.argv.slice(2));
  const step = SHOWCASE_STEPS.find((candidate) => candidate.number === options.step);
  console.log(`Interactive showcase · step ${step.number}: ${step.name}\n`);
  if (options.step === 1) prepare(options);
  else if (options.step === 2) draftShowcase(options);
  else if (options.step === 3) startShowcase(options);
  else if (options.step === 9) await finishShowcase(options);
  else await progressShowcase(options, options.step);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((cause) => {
    console.error(`\nshowcase failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  });
}
