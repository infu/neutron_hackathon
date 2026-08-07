import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  buildAllowlistArgs,
  classifyAllowlistResult,
  ledgerIdentityMatches,
  normalizeLedgerFile,
  parseArgs,
  parseLocalLedgerArgs,
  parseCandidNat,
  parseCandidText,
  parseConfig,
  samePrincipalSet,
} from "../../scripts/ledger-allowlist.mjs";

const root = resolve(import.meta.dirname, "..", "..");
const production = JSON.parse(readFileSync(resolve(root, "production-ledgers.json"), "utf8"));
const localInstaller = readFileSync(resolve(root, "scripts", "local-ledgers.mjs"), "utf8");

describe("the reusable ledger allowlist", () => {
  it("pins local by default and double-confirms mainnet writes", () => {
    assert.deepEqual(parseArgs([]), { environment: "local", check: false });
    assert.deepEqual(parseArgs(["--check", "-e", "ic"]), {
      environment: "ic",
      check: true,
    });
    assert.throws(() => parseArgs(["-e", "ic"]), /without --confirm ic/);
    assert.deepEqual(parseArgs(["-e", "ic", "--confirm", "ic"]), {
      environment: "ic",
      check: false,
    });
    assert.throws(() => parseArgs(["-e", "staging"]), /unsupported environment/);
  });

  it("requires an explicit destructive local reinstall mode", () => {
    assert.deepEqual(parseLocalLedgerArgs([]), { fresh: false, reinstall: false });
    assert.deepEqual(parseLocalLedgerArgs(["--fresh"]), { fresh: true, reinstall: false });
    assert.deepEqual(parseLocalLedgerArgs(["--reinstall"]), {
      fresh: false,
      reinstall: true,
    });
    assert.throws(() => parseLocalLedgerArgs(["--frehs"]), /usage:/);
    assert.throws(() => parseLocalLedgerArgs(["--fresh", "--reinstall"]), /usage:/);

    const preflight = localInstaller.indexOf("if (REINSTALL)");
    const install = localInstaller.indexOf('"canister",\n    "install"');
    assert.ok(preflight > 0 && preflight < install, "all stale-id checks precede installation");
  });

  it("commits the seven verified production principals exactly once", () => {
    const rows = normalizeLedgerFile(production, "ic");
    assert.equal(production.verifiedAt, "2026-08-05");
    assert.deepEqual(
      rows.map(({ symbol, id }) => [symbol, id]),
      [
        ["NTN", "f54if-eqaaa-aaaaq-aacea-cai"],
        ["TOKO", "n5r46-eqaaa-aaaae-qfzba-cai"],
        ["cICP", "n6tkf-tqaaa-aaaal-qsneq-cai"],
        ["ICP", "ryjl3-tyaaa-aaaaa-aaaba-cai"],
        ["ckBTC", "mxzaz-hqaaa-aaaar-qaada-cai"],
        ["ckUSDC", "xevnm-gaaaa-aaaar-qafnq-cai"],
        ["ckUSDT", "cngnf-vqaaa-aaaar-qag4q-cai"],
      ],
    );
    assert.match(buildAllowlistArgs(rows), /^\(vec \{ principal "/);
    assert.throws(
      () => normalizeLedgerFile({ ...production, ledgers: [...rows.slice(0, 6), rows[0]] }, "ic"),
      /listed twice/,
    );
    assert.throws(
      () =>
        normalizeLedgerFile(
          { ...production, ledgers: [...rows, { ...rows[0], id: "aaaaa-aa" }] },
          "ic",
        ),
      /at most 7 ledgers/,
    );
  });

  it("parses live ICRC metadata and compares fixture identity strictly", () => {
    assert.equal(parseCandidText('(\n  "Neutrinite"\n)'), "Neutrinite");
    assert.equal(parseCandidNat("(10_000 : nat)"), 10_000n);
    assert.equal(parseCandidNat("(8 : nat8)"), 8n);
    const expected = { symbol: "NTN", name: "Neutrinite", decimals: 8, fee: "10000" };
    assert.equal(
      ledgerIdentityMatches(expected, { ...expected, fee: 10_000n }, { includeFee: true }),
      true,
    );
    assert.equal(
      ledgerIdentityMatches(expected, { ...expected, symbol: "OTHER", fee: 10_000n }),
      false,
    );
  });

  it("recognizes existing policies and Candid results", () => {
    const config = parseConfig(`(record {
      ledgerAllowlist = vec { principal "aaaaa-aa"; principal "2vxsx-fae" };
      ledgerAllowlistSet = true;
    })`);
    assert.deepEqual(config, { set: true, ledgers: ["aaaaa-aa", "2vxsx-fae"] });
    assert.equal(samePrincipalSet(config.ledgers, ["2vxsx-fae", "aaaaa-aa"]), true);
    assert.equal(samePrincipalSet(config.ledgers, ["aaaaa-aa"]), false);
    assert.throws(() => parseConfig("(record {})"), /could not read the ledger policy/);
    assert.deepEqual(classifyAllowlistResult("(variant { ok = vec {} })"), { ok: true });
    assert.deepEqual(classifyAllowlistResult('(variant { err = "frozen" })'), {
      ok: false,
      error: "frozen",
    });
  });
});
