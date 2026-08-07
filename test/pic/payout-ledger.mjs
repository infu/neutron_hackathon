/**
 * Reusable PocketIC wrapper for the small stateful ICRC-1 payout ledger.
 *
 * The fixture implements the parts load-bearing for recovery tests: balances,
 * fees, a 24-hour `created_at_time` window, duplicate recognition, and one
 * definite temporary-failure hook. It is test-only Motoko and is never part of
 * the hackathon canister or its public Candid interface.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { IDL } from "@dfinity/candid";

import { mopsPackageArgs, runMoc } from "../../scripts/motoko-toolchain.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const LEDGER_SOURCE = resolve(import.meta.dirname, "payout-ledger.mo");
const LEDGER_WASM = resolve(ROOT, ".build", "pic-payout-ledger.wasm");

export const payoutLedgerIdl = ({ IDL: Candid }) => {
  const Account = Candid.Record({
    owner: Candid.Principal,
    subaccount: Candid.Opt(Candid.Vec(Candid.Nat8)),
  });
  return Candid.Service({
    credit: Candid.Func([Account, Candid.Nat], [], []),
    fail_next: Candid.Func([Candid.Nat], [], []),
    icrc1_balance_of: Candid.Func([Account], [Candid.Nat], ["query"]),
    icrc1_fee: Candid.Func([], [Candid.Nat], ["query"]),
    transfer_count: Candid.Func([], [Candid.Nat], ["query"]),
  });
};

function payoutLedgerWasm() {
  const stale =
    !existsSync(LEDGER_WASM) || statSync(LEDGER_WASM).mtimeMs < statSync(LEDGER_SOURCE).mtimeMs;
  if (stale) {
    mkdirSync(resolve(ROOT, ".build"), { recursive: true });
    runMoc([
      ...mopsPackageArgs(),
      "-c",
      "--release",
      "-o",
      LEDGER_WASM,
      LEDGER_SOURCE,
    ]);
  }
  return readFileSync(LEDGER_WASM);
}

export async function installPayoutLedger(env, fee) {
  const installed = await env.pic.setupCanister({
    idlFactory: payoutLedgerIdl,
    wasm: payoutLedgerWasm(),
    sender: env.controller.getPrincipal(),
    controllers: [env.controller.getPrincipal()],
    arg: IDL.encode([IDL.Nat], [fee]),
  });
  installed.actor.setIdentity(env.controller);
  return { id: installed.canisterId, actor: installed.actor, fee };
}

/** Convert a hackathon `Account` value to the fixture ledger's account shape. */
export const ledgerAccount = (account) => ({
  owner: account.owner,
  subaccount: account.subaccount.length ? [Array.from(account.subaccount[0])] : [],
});

export const principalAccount = (owner) => ({ owner, subaccount: [] });

export function derivedSubaccount(tag, userId) {
  const bytes = new Uint8Array(32);
  bytes[0] = tag;
  new DataView(bytes.buffer).setBigUint64(24, BigInt(userId));
  return bytes;
}

export const sponsorDepositAccount = (canisterId, userId) => ({
  owner: canisterId,
  subaccount: [Array.from(derivedSubaccount(0, userId))],
});
