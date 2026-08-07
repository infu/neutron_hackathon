#!/usr/bin/env node
/**
 * Grant a registered participant the moderator role.
 *
 *   npm run moderator -- @handle
 *   npm run moderator -- @handle -e ic --confirm ic
 *
 * The canister remains the authority: this only succeeds while the selected
 * identity controls it. The handle is used only to find the account. The
 * subsequent update names that account's immutable id and the exact role
 * generation just read, so a rename or reclaimed handle cannot appoint
 * somebody else between the query and the update.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE =
  "usage: npm run moderator -- @handle [-e environment] [--confirm environment]";

export function parseArgs(argv) {
  let environment = "local";
  let confirmation = null;
  let rawHandle = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-e" || arg === "--environment") {
      environment = argv[++i];
      if (!environment) throw new Error(`${arg} needs an environment`);
    } else if (arg.startsWith("--environment=")) {
      environment = arg.slice("--environment=".length);
      if (!environment) throw new Error("--environment needs an environment");
    } else if (arg === "--confirm") {
      confirmation = argv[++i];
      if (!confirmation) throw new Error("--confirm needs an environment");
    } else if (arg.startsWith("--confirm=")) {
      confirmation = arg.slice("--confirm=".length);
      if (!confirmation) throw new Error("--confirm needs an environment");
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (rawHandle !== null) {
      throw new Error("provide exactly one handle");
    } else {
      rawHandle = arg;
    }
  }

  if (rawHandle === null) throw new Error(USAGE);
  const handle = rawHandle.startsWith("@") ? rawHandle.slice(1) : rawHandle;
  if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
    throw new Error("handle must be 3-32 characters of a-z, 0-9 or _");
  }
  if (environment !== "local" && confirmation !== environment) {
    throw new Error(
      `refusing to change ${environment} without --confirm ${environment}`,
    );
  }

  return { handle, environment };
}

/** Classify icp-cli's decoded Candid without depending on its display spacing. */
export function classifyModeratorResult(candid) {
  if (/variant\s*\{\s*ok\s*=/.test(candid)) {
    const principal = /"principal"\s*=\s*principal\s+"([^"]+)"/.exec(candid)?.[1] ?? null;
    return { kind: "granted", principal };
  }

  const error = /variant\s*\{\s*err\s*=\s*variant\s*\{\s*([A-Za-z][A-Za-z0-9_]*)/.exec(
    candid,
  )?.[1];
  if (error === "NoChange") return { kind: "existing" };
  return { kind: "error", error: error ?? candid.trim() };
}

/** Parse the exact account generation that `set_moderator` must still match. */
export function parseModeratorTarget(candid) {
  if (!/\bopt\s+record\s*\{/.test(candid)) return null;
  const number = (field) => {
    const raw = new RegExp(
      `\\b${field}\\s*=\\s*([0-9_]+)(?:\\s*:\\s*nat64)?\\b`,
    ).exec(candid)?.[1];
    return raw ? BigInt(raw.replaceAll("_", "")) : null;
  };
  const id = number("id");
  const expectedUpdatedAt = number("updatedAt");
  const on = /\bmoderator\s*=\s*(true|false)\b/.exec(candid)?.[1];
  if (id === null || expectedUpdatedAt === null || on === undefined) {
    throw new Error("icp-cli returned an incomplete profile");
  }
  return { id, expectedOn: on === "true", expectedUpdatedAt };
}

function call({ environment, method, args, query = false, confirm = false }) {
  const output = execFileSync(
    "icp",
    [
      "canister",
      "call",
      "hackathon",
      method,
      args,
      "--environment",
      environment,
      ...(query ? ["--query"] : []),
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      input: confirm ? "y\n" : "",
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const candid = JSON.parse(output).response_candid;
  if (typeof candid !== "string") throw new Error("icp-cli returned no Candid response");
  return candid;
}

function grant({ handle, environment }) {
  const target = parseModeratorTarget(
    call({
      environment,
      method: "profile",
      args: `(${JSON.stringify(handle)})`,
      query: true,
    }),
  );
  if (target === null) throw new Error(`@${handle} is not registered on ${environment}`);
  if (target.expectedOn) {
    console.log(`@${handle} is already a moderator on ${environment}`);
    return;
  }

  const exact =
    "record { " +
    `id = ${target.id} : nat64; ` +
    `expectedOn = ${target.expectedOn}; ` +
    `expectedUpdatedAt = ${target.expectedUpdatedAt} : nat64 ` +
    "}";
  const candid = call({
    environment,
    method: "set_moderator",
    args: `(${exact}, true, opt "appointed via npm run moderator")`,
    confirm: true,
  });

  const result = classifyModeratorResult(candid);
  if (result.kind === "granted") {
    const owner = result.principal ? ` (${result.principal})` : "";
    console.log(`@${handle} is now a moderator on ${environment}${owner}`);
    return;
  }
  if (result.kind === "existing") {
    console.log(`@${handle} is already a moderator on ${environment}`);
    return;
  }
  if (result.error === "NotRegistered") {
    throw new Error(`@${handle} is not registered on ${environment}`);
  }
  if (result.error === "NotAllowed") {
    throw new Error(
      `the current identity does not control ${environment}; the canister may already be sealed`,
    );
  }
  throw new Error(`the canister refused the grant: ${result.error}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    grant(parseArgs(process.argv.slice(2)));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  }
}
