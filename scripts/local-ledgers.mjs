/**
 * Stand up real ICRC-1 ledgers on the local replica.
 *
 * The one ledger a local network gives you is the ICP ledger, which is not a
 * plain ICRC-1 canister — it carries a pile of ICP-specific endpoints, and
 * testing only against it leaves open whether the treasury works against the
 * ordinary ICRC-1 canisters that ck-tokens and every SNS actually run.
 *
 * So this installs the genuine DFINITY `ic-icrc1-ledger` wasm — the same build
 * ckBTC and the SNSes use — three times, with deliberately *different*
 * decimals and fees. Different fees are the interesting part: a fee is frozen
 * per line at draft time, so three ledgers means three different frozen fees
 * in one distribution.
 *
 *   npm run ledgers:local -- --fresh
 *   npm run ledgers:local -- --reinstall  # erases every fixture balance
 *
 * Re-runnable, but not idempotent, and the difference matters: a recorded id
 * is reused only after all recorded canisters answer with the exact expected
 * ledger metadata. It is then *reinstalled* — same canister, empty state,
 * every balance gone. Re-running after funding therefore throws the fixture
 * balances away. After a local-network reset, pass --fresh to create new ids;
 * the safety preflight refuses to reinstall stale ids that may now belong to
 * unrelated canisters.
 *
 * These canisters live outside icp.yaml on purpose, so `icp deploy` does not
 * reinstall them and wipe the balances behind your back.
 *
 * Local only — see ENVIRONMENT below, which is pinned rather than inherited.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ledgerIdentityMatches, parseLocalLedgerArgs } from "./ledger-allowlist.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const RECORD = join(ROOT, "local-ledgers.json");
const { fresh: FRESH, reinstall: REINSTALL } = parseLocalLedgerArgs(process.argv.slice(2));

/**
 * The upstream wasm, taken from whichever local checkout has it cached. It is
 * a release artifact, not something we build, so a copy on disk is as good as
 * a download and works offline.
 */
const SOURCES = [
  "/srv/shared/code/neutron/.neutron/cache/fixtures/ledger-suite-icrc-2026-03-09/ic-icrc1-ledger.wasm.gz",
  "/srv/shared/code/neutron_backup/.neutron/cache/fixtures/ledger-suite-icrc-2026-03-09/ic-icrc1-ledger.wasm.gz",
];

/**
 * Three tokens that are awkward in different ways.
 *
 * TESTB is six decimals with a tiny fee, like ckUSDC. TESTG is eighteen, like
 * ckETH — the one that finds any place still doing arithmetic in a JS number,
 * where 10^18 is already past Number.MAX_SAFE_INTEGER.
 *
 * This ledger build holds balances in a u64, so eighteen decimals leaves room
 * for about 18 whole tokens and no more. (ckETH itself runs the separate u256
 * build.) Ten is plenty to split five ways and still be exact.
 */
const U64_MAX = 2n ** 64n - 1n;

const TOKENS = [
  { key: "alpha", symbol: "TESTA", name: "Test Alpha", decimals: 8, fee: 10_000n, supply: 10n ** 14n },
  { key: "beta", symbol: "TESTB", name: "Test Beta", decimals: 6, fee: 1_000n, supply: 10n ** 12n },
  { key: "gamma", symbol: "TESTG", name: "Test Gamma", decimals: 18, fee: 2_000_000_000_000n, supply: 10n ** 19n },
];

for (const token of TOKENS) {
  if (token.supply > U64_MAX) {
    throw new Error(
      `${token.symbol}: an initial balance of ${token.supply} does not fit in the u64 this ` +
        `ledger build uses (max ${U64_MAX}). Lower the supply or the decimals.`,
    );
  }
}

/**
 * Nobody's key. Transfers *from* the minting account mint and transfers *to*
 * it burn, so parking it on the management canister keeps both out of reach
 * and makes every transfer in the test an ordinary, fee-paying one.
 */
const NOBODY = "aaaaa-aa";

/**
 * The environment these ledgers are installed into, pinned rather than
 * inherited — because inheriting it can send them to mainnet.
 *
 * `icp` resolves its target from `-e/--environment`, falling back to the
 * ICP_ENVIRONMENT variable. Every script in this repo reads a *different*
 * variable, ICP_CLI_ENVIRONMENT, which is the one icp-cli sets during sync
 * steps. The two names can disagree completely, and nothing here would notice:
 * `ICP_ENVIRONMENT=ic npm run ledgers:local` would create and install three
 * canisters on mainnet — real cycles, permanently orphaned, since their ids
 * land in a file called local-ledgers.json — while every line printed below
 * still said local. The confirmations are pre-answered (`input: "y\n"`, and
 * `--yes` on the install), so nothing would stop to ask either.
 *
 * So: an explicit `--environment` on every call, and a shell that cannot say
 * otherwise.
 */
const ENVIRONMENT = "local";

for (const name of ["ICP_ENVIRONMENT", "ICP_NETWORK"]) {
  const value = process.env[name];
  if (value && value !== ENVIRONMENT) {
    throw new Error(
      `${name}=${value} is set, but this script only ever installs to "${ENVIRONMENT}". ` +
        "Unset it before running, rather than have it quietly ignored.",
    );
  }
}

const ENV = { ...process.env, ICP_ENVIRONMENT: ENVIRONMENT };
delete ENV.ICP_NETWORK;

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", input: "y\n", env: ENV }).trim();

/**
 * Every network-facing call goes through here, so the environment is in the
 * argv and not merely in the ambient state. An explicit flag beats
 * ICP_ENVIRONMENT, which is the point. (`icp identity list` is not
 * network-scoped and takes no --environment, so it uses `run` directly.)
 */
const icp = (args) => run("icp", [...args, "--environment", ENVIRONMENT]);

const holder = run("icp", ["identity", "list"])
  .split("\n")
  .find((line) => line.trim().startsWith("*"))
  ?.trim()
  .split(/\s+/)
  .at(-1);
if (!holder) throw new Error("could not read the active identity from `icp identity list`");

const wasm = SOURCES.find(existsSync);
if (!wasm) {
  throw new Error(
    `No ic-icrc1-ledger.wasm.gz found. Looked in:\n  ${SOURCES.join("\n  ")}\n` +
      "Fetch one from https://download.dfinity.systems/ic/<rev>/canisters/ic-icrc1-ledger.wasm.gz",
  );
}

const scratch = mkdtempSync(join(tmpdir(), "ledgers-"));
const local = join(scratch, "ic-icrc1-ledger.wasm.gz");
copyFileSync(wasm, local);

const existing = !FRESH && existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : {};
const out = {};
const hasRecordedFixtures = TOKENS.some((token) => existing[token.key]?.id);

if (hasRecordedFixtures && !REINSTALL) {
  throw new Error(
    "Recorded local ledgers already exist. Use --reinstall to erase and reset their balances, " +
      "or --fresh to create new canisters.",
  );
}

// A local replica may reuse canister ids after reset. Validate every recorded
// fixture before reinstalling any of them, so a stale record can never wipe an
// app (or wipe one real fixture before a later mismatch aborts the run).
if (REINSTALL) {
  const seen = new Set();
  const stale = [];
  for (const token of TOKENS) {
    const known = existing[token.key]?.id;
    if (!known) continue;
    if (seen.has(known)) {
      stale.push(`${token.key}: duplicate canister id ${known}`);
      continue;
    }
    seen.add(known);

    let actual = null;
    try {
      actual = inspect(known);
    } catch {
      // A missing canister or a non-ledger is stale either way.
    }
    if (!actual || !ledgerIdentityMatches(describe(token), actual, { includeFee: true })) {
      const found = actual
        ? `${actual.symbol} / ${actual.name} / ${actual.decimals} decimals / fee ${actual.fee}`
        : "not the recorded ICRC-1 ledger";
      stale.push(`${token.key}: ${known} is ${found}`);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Refusing to reinstall stale local ledger ids:\n  ${stale.join("\n  ")}\n` +
        "Run `npm run ledgers:local -- --fresh` to create new fixture canisters.",
    );
  }
}

console.log(`wasm     ${wasm}`);
console.log(`holder   ${holder}\n`);

for (const token of TOKENS) {
  const known = existing[token.key]?.id;
  const id = known ?? icp(["canister", "create", "--detached", "-q", "--cycles", "5t"]);

  // Record the id the moment it exists. A canister created and then failed to
  // install is invisible — `icp canister list` only knows about the manifest —
  // so losing the id here means leaking it for good.
  out[token.key] = { id, ...describe(token) };
  writeFileSync(RECORD, JSON.stringify({ ...existing, ...out }, null, 2) + "\n");

  // Reinstall rather than upgrade: this is a test fixture, and the point of
  // re-running is to get a ledger in a known state.
  const args = join(scratch, `${token.key}.did`);
  writeFileSync(args, initArgs(token, holder));
  icp([
    "canister",
    "install",
    id,
    "--mode",
    known ? "reinstall" : "install",
    "--wasm",
    local,
    "--args-file",
    args,
    "--yes",
  ]);

  // Read it back through the interface rather than trusting what we sent.
  const symbol = call(id, "icrc1_symbol");
  const decimals = call(id, "icrc1_decimals");
  const fee = call(id, "icrc1_fee");
  console.log(
    `${known ? "reinstalled" : "created    "} ${id}  ${symbol} · ${decimals} decimals · fee ${fee}`,
  );

}

writeFileSync(RECORD, JSON.stringify(out, null, 2) + "\n");
console.log(`\nRecorded in ${RECORD}`);
console.log("\nDisposable local judge demo:");
console.log("  npm run seed -- --season");
console.log("  then follow the one-way seal, verify, and start sequence it prints");
console.log("\nIndependent PocketIC money verification (does not use these deployed canisters):");
console.log("  npm run verify:money");

function describe(token) {
  return {
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    fee: token.fee.toString(),
  };
}

function call(id, method) {
  return icp(["canister", "call", id, method, "()"])
    .replace(/[()"]/g, "")
    .replace(/\s*:\s*nat\d*/, "")
    .trim();
}

function inspect(id) {
  return {
    name: call(id, "icrc1_name"),
    symbol: call(id, "icrc1_symbol"),
    decimals: Number(call(id, "icrc1_decimals").replaceAll("_", "")),
    fee: call(id, "icrc1_fee").replaceAll("_", ""),
  };
}

/**
 * The `LedgerArg` init record for ledger-suite-icrc.
 *
 * Every optional field is spelled out even when null — the CLI cannot always
 * fetch the candid interface to fill defaults in, and a record that is missing
 * a field it cannot infer fails at install with an unhelpful decode error.
 */
function initArgs(token, controller) {
  return `(variant { Init = record {
  decimals = opt (${token.decimals} : nat8);
  token_symbol = "${token.symbol}";
  token_name = "${token.name}";
  transfer_fee = ${token.fee} : nat;
  metadata = vec {};
  minting_account = record { owner = principal "${NOBODY}"; subaccount = null };
  initial_balances = vec {
    record { record { owner = principal "${controller}"; subaccount = null }; ${token.supply} : nat }
  };
  fee_collector_account = null;
  archive_options = record {
    num_blocks_to_archive = 1_000 : nat64;
    max_transactions_per_response = null;
    trigger_threshold = 2_000 : nat64;
    more_controller_ids = null;
    max_message_size_bytes = null;
    cycles_for_archive_creation = opt (100_000_000_000_000 : nat64);
    node_max_memory_size_bytes = null;
    controller_id = principal "${controller}";
  };
  max_memo_length = opt (80 : nat16);
  index_principal = null;
  feature_flags = opt record { icrc2 = true };
}})
`;
}
