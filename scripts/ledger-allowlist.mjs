#!/usr/bin/env node
/**
 * Validate and apply the launch ledger allowlist.
 *
 *   npm run ledgers:allow                         # local fixtures
 *   npm run ledgers:allow -- --check -e ic        # live mainnet check
 *   npm run ledgers:allow -- -e ic --confirm ic   # mainnet write
 *
 * Mainnet IDs and identity metadata are committed in production-ledgers.json.
 * Local IDs are generated for one replica in ignored local-ledgers.json.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Principal } from "@dfinity/principal";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE =
  "usage: npm run ledgers:allow -- [--check] [-e local|ic] [--confirm environment]";

export function parseArgs(argv) {
  let environment = "local";
  let confirmation = null;
  let check = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      check = true;
    } else if (arg === "-e" || arg === "--environment") {
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
    } else {
      throw new Error(arg.startsWith("-") ? `unknown option: ${arg}` : USAGE);
    }
  }

  if (environment !== "local" && environment !== "ic") {
    throw new Error(`unsupported environment: ${environment}; use local or ic`);
  }
  if (!check && environment !== "local" && confirmation !== environment) {
    throw new Error(
      `refusing to change ${environment} without --confirm ${environment}`,
    );
  }

  return { environment, check };
}

export function parseLocalLedgerArgs(argv) {
  if (argv.length === 0) return { fresh: false, reinstall: false };
  if (argv.length !== 1 || !["--fresh", "--reinstall"].includes(argv[0])) {
    throw new Error(
      "usage: npm run ledgers:local -- [--fresh | --reinstall]",
    );
  }
  return { fresh: argv[0] === "--fresh", reinstall: argv[0] === "--reinstall" };
}

export function normalizeLedgerFile(raw, environment) {
  const rows = environment === "ic" ? raw?.ledgers : Object.values(raw ?? {});
  if (!Array.isArray(rows) || rows.length === 0) {
    const hint =
      environment === "local"
        ? "run `npm run ledgers:local -- --fresh` first"
        : "production-ledgers.json must contain a non-empty ledgers array";
    throw new Error(`no ${environment} ledgers found; ${hint}`);
  }
  if (rows.length > 7) throw new Error("the backend accepts at most 7 ledgers");
  if (environment === "ic" && raw.network !== "ic") {
    throw new Error("production-ledgers.json must declare network \"ic\"");
  }

  const ids = new Set();
  return rows.map((row, index) => {
    const label = `ledger ${index + 1}`;
    if (!row || typeof row !== "object") throw new Error(`${label} must be an object`);
    for (const field of ["id", "symbol", "name"]) {
      if (typeof row[field] !== "string" || row[field].length === 0) {
        throw new Error(`${label} needs a non-empty ${field}`);
      }
    }
    if (!Number.isInteger(row.decimals) || row.decimals < 0 || row.decimals > 255) {
      throw new Error(`${label} has invalid decimals`);
    }
    try {
      Principal.fromText(row.id);
    } catch {
      throw new Error(`${label} has an invalid principal: ${row.id}`);
    }
    if (ids.has(row.id)) throw new Error(`ledger is listed twice: ${row.id}`);
    ids.add(row.id);
    return {
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
      sns: Boolean(row.sns),
      ...(row.fee === undefined ? {} : { fee: String(row.fee) }),
    };
  });
}

export function ledgerIdentityMatches(expected, actual, { includeFee = false } = {}) {
  return (
    expected.symbol === actual.symbol &&
    expected.name === actual.name &&
    Number(expected.decimals) === Number(actual.decimals) &&
    (!includeFee || BigInt(expected.fee) === BigInt(actual.fee))
  );
}

export function parseCandidText(candid) {
  const match = /^\(\s*("(?:\\.|[^"\\])*")\s*\)$/.exec(candid.trim());
  if (!match) throw new Error(`expected one Candid text value, got: ${candid.trim()}`);
  return JSON.parse(match[1]);
}

export function parseCandidNat(candid) {
  const match = /^\(\s*([0-9_]+)(?:\s*:\s*nat(?:8|16|32|64)?)?\s*\)$/.exec(
    candid.trim(),
  );
  if (!match) throw new Error(`expected one Candid nat value, got: ${candid.trim()}`);
  return BigInt(match[1].replaceAll("_", ""));
}

export function buildAllowlistArgs(ledgers) {
  return `(vec { ${ledgers.map(({ id }) => `principal "${id}"`).join("; ")} })`;
}

export function parseConfig(candid) {
  const setMatch = /\bledgerAllowlistSet\s*=\s*(true|false)\b/.exec(candid);
  const listMatch = /\bledgerAllowlist\s*=\s*vec\s*\{([\s\S]*?)\};/.exec(candid);
  if (!setMatch || !listMatch) {
    throw new Error("could not read the ledger policy from config()");
  }
  const set = setMatch[1] === "true";
  const body = listMatch[1];
  const ledgers = [...body.matchAll(/principal\s+"([^"]+)"/g)].map((match) => match[1]);
  return { set, ledgers };
}

export function samePrincipalSet(left, right) {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((principal) => right.includes(principal))
  );
}

export function classifyAllowlistResult(candid) {
  if (/variant\s*\{\s*ok\s*=/.test(candid)) return { ok: true };
  const quoted = /variant\s*\{\s*err\s*=\s*("(?:\\.|[^"\\])*")/.exec(candid)?.[1];
  return { ok: false, error: quoted ? JSON.parse(quoted) : candid.trim() };
}

function callJson(args, environment, { input = "", inheritStderr = true } = {}) {
  const env = { ...process.env, ICP_ENVIRONMENT: environment };
  delete env.ICP_NETWORK;
  const output = execFileSync(
    "icp",
    [...args, "--environment", environment, "--json"],
    {
      cwd: ROOT,
      encoding: "utf8",
      input,
      env,
      stdio: ["pipe", "pipe", inheritStderr ? "inherit" : "pipe"],
    },
  );
  const candid = JSON.parse(output).response_candid;
  if (typeof candid !== "string") throw new Error("icp-cli returned no Candid response");
  return candid;
}

function ledgerMetadata(id, environment) {
  const query = (method) =>
    callJson(["canister", "call", id, method, "()", "--query"], environment, {
      inheritStderr: false,
    });
  return {
    name: parseCandidText(query("icrc1_name")),
    symbol: parseCandidText(query("icrc1_symbol")),
    decimals: Number(parseCandidNat(query("icrc1_decimals"))),
    fee: parseCandidNat(query("icrc1_fee")),
  };
}

function readLedgers(environment) {
  const filename = environment === "ic" ? "production-ledgers.json" : "local-ledgers.json";
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(ROOT, filename), "utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT" && environment === "local") {
      throw new Error("local-ledgers.json is missing; run `npm run ledgers:local -- --fresh` first");
    }
    throw cause;
  }
  return normalizeLedgerFile(raw, environment);
}

function config(environment) {
  return parseConfig(
    callJson(["canister", "call", "hackathon", "config", "()", "--query"], environment),
  );
}

function run(options) {
  const ledgers = readLedgers(options.environment);
  console.log(`Checking ${ledgers.length} ${options.environment} ledger(s)...`);

  for (const expected of ledgers) {
    let actual;
    try {
      actual = ledgerMetadata(expected.id, options.environment);
    } catch (cause) {
      throw new Error(`${expected.symbol} (${expected.id}) did not answer ICRC-1 metadata queries`, {
        cause,
      });
    }
    if (!ledgerIdentityMatches(expected, actual)) {
      throw new Error(
        `${expected.id} metadata differs: expected ${expected.symbol} / ${expected.name} / ` +
          `${expected.decimals} decimals, got ${actual.symbol} / ${actual.name} / ` +
          `${actual.decimals} decimals`,
      );
    }
    console.log(
      `  ok  ${expected.symbol.padEnd(6)} ${expected.id} · ${actual.decimals} decimals · ` +
        `live fee ${actual.fee.toLocaleString("en-US")} base units`,
    );
  }

  if (options.check) {
    console.log("Metadata check complete; the hackathon allowlist was not changed.");
    return;
  }

  const wanted = ledgers.map(({ id }) => id);
  const before = config(options.environment);
  if (before.set) {
    if (samePrincipalSet(before.ledgers, wanted)) {
      console.log(`The ${options.environment} allowlist already contains these ${wanted.length} ledgers.`);
      return;
    }
    console.log(`Replacing the open ${options.environment} allowlist with the catalogued set...`);
  }

  const result = classifyAllowlistResult(
    callJson(
      [
        "canister",
        "call",
        "hackathon",
        "set_ledger_allowlist",
        buildAllowlistArgs(ledgers),
      ],
      options.environment,
      { input: "y\n" },
    ),
  );
  if (!result.ok) throw new Error(`the canister refused the allowlist: ${result.error}`);

  const after = config(options.environment);
  if (!after.set || !samePrincipalSet(after.ledgers, wanted)) {
    throw new Error("the allowlist call succeeded but its postcondition did not match");
  }
  console.log(`Applied ${wanted.length} ledger(s) to the ${options.environment} hackathon.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  }
}
