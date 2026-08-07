import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  REQUIRED_FULL_CHECKS,
  assertCleanStatus,
  assertReviewedCommit,
  assertSealState,
  parseAttestationArgs,
  sha256Bytes,
  validateChecksReceipt,
  validatePreparedRecord,
} from "../../scripts/release-attestation.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COMMIT = "a".repeat(40);
const HASH = "b".repeat(64);

const receipt = () => ({
  schema: "neutron-full-release-checks/v1",
  reviewedCommit: COMMIT,
  commands: [...REQUIRED_FULL_CHECKS],
  passedAt: "2026-08-06T12:00:00.000Z",
});

const prepared = () => {
  const releaseChecks = receipt();
  return {
    schema: "neutron-production-release-attestation/v1",
    phase: "prepared",
    reviewedCommit: COMMIT,
    canisterId: "aaaaa-aa",
    sealIdentity: "production",
    sealCaller: "aaaaa-aa",
    productionWasmSha256: HASH,
    submittedGzipSha256: HASH,
    deployedModuleSha256: HASH,
    frontendCertifiedSha256: HASH,
    ledgerCatalogSha256: HASH,
    ledgerCatalogVerifiedAt: "2026-08-05",
    ledgers: [
      {
        id: "2vxsx-fae",
        symbol: "TEST",
        name: "Test Token",
        decimals: 8,
        sns: false,
      },
    ],
    liveLedgerPrincipals: ["2vxsx-fae"],
    releaseChecks,
    releaseChecksReceiptSha256: sha256Bytes(
      Buffer.from(`${JSON.stringify(releaseChecks, null, 2)}\n`),
    ),
    controllersBeforeSeal: ["aaaaa-aa"],
    launchLatchedBeforeSeal: false,
    preparedAt: "2026-08-06T12:30:00.000Z",
  };
};

describe("the production release attestation", () => {
  it("requires an explicit reviewed commit and mainnet canister before prepare", () => {
    assert.throws(() => parseAttestationArgs([]), /usage:/);
    assert.throws(() => parseAttestationArgs(["checks"]), /reviewed-commit/);
    assert.throws(
      () => parseAttestationArgs(["prepare", "--reviewed-commit", COMMIT]),
      /canister-id/,
    );
    assert.throws(
      () =>
        parseAttestationArgs([
          "prepare",
          "--reviewed-commit",
          COMMIT,
          "--canister-id",
          "aaaaa-aa",
          "-e",
          "local",
        ]),
      /only supports -e ic/,
    );
    for (const option of ["--record", "--receipt", "--wasm"]) {
      assert.throws(
        () =>
          parseAttestationArgs([
            "prepare",
            "--reviewed-commit",
            COMMIT,
            "--canister-id",
            "aaaaa-aa",
            option,
            "/tmp/bypass-reviewed-build",
          ]),
        new RegExp(`unknown argument: ${option}`),
        "release evidence paths stay fixed under this checkout's ignored .build directory",
      );
    }

    const options = parseAttestationArgs([
      "prepare",
      "--reviewed-commit",
      COMMIT,
      "--canister-id",
      "aaaaa-aa",
    ]);
    assert.equal(options.command, "prepare");
    assert.equal(options.environment, "ic");
    assert.equal(options.reviewedCommit, COMMIT);
    assert.equal(options.canisterId, "aaaaa-aa");
    assert.match(options.wasm, /\.icp\/cache\/artifacts\/hackathon$/);

    const selected = parseAttestationArgs([
      "prepare",
      "--reviewed-commit",
      COMMIT,
      "--canister-id",
      "aaaaa-aa",
      "--identity",
      "production",
    ]);
    assert.equal(selected.identity, "production");
    assert.throws(
      () => parseAttestationArgs(["verify", "--identity", "production"]),
      /only valid for prepare/,
    );
  });

  it("fails closed on dirty trees, abbreviated commits, and another HEAD", () => {
    assert.doesNotThrow(() => assertCleanStatus("\n"));
    assert.throws(() => assertCleanStatus(" M backend/main.mo\n"), /not clean/);
    assert.throws(() => assertReviewedCommit("abc123", "abc123"), /full lowercase/);
    assert.throws(() => assertReviewedCommit(COMMIT, "c".repeat(40)), /not checked out HEAD/);
    assert.doesNotThrow(() => assertReviewedCommit(COMMIT, COMMIT));
  });

  it("pins the exact five mandatory full-suite commands to one commit", () => {
    assert.deepEqual(REQUIRED_FULL_CHECKS, [
      "npm test",
      "npm run test:logic",
      "npm run test:public",
      "npm run test:memory",
      "npm run test:capacity",
    ]);
    assert.doesNotThrow(() => validateChecksReceipt(receipt(), COMMIT));
    assert.throws(
      () => validateChecksReceipt({ ...receipt(), commands: REQUIRED_FULL_CHECKS.slice(0, 3) }, COMMIT),
      /every required command/,
    );
    assert.throws(
      () => validateChecksReceipt({ ...receipt(), reviewedCommit: "c".repeat(40) }, COMMIT),
      /another commit/,
    );
  });

  it("records the canister as the sole controller after sealing", () => {
    assert.doesNotThrow(() => validatePreparedRecord(prepared()));
    assert.throws(
      () => validatePreparedRecord({ ...prepared(), submittedGzipSha256: undefined }),
      /submitted gzip hash/,
    );
    assert.doesNotThrow(() =>
      assertSealState("prepare", "aaaaa-aa", ["aaaaa-aa"], false, "aaaaa-aa"),
    );
    assert.throws(
      () =>
        assertSealState("prepare", "aaaaa-aa", ["2vxsx-fae"], false, "2vxsx-fae"),
      /not its own controller/,
    );
    assert.throws(
      () =>
        assertSealState(
          "prepare",
          "aaaaa-aa",
          ["aaaaa-aa", "2vxsx-fae"],
          false,
          "rrkah-fqaaa-aaaaa-aaaaq-cai",
        ),
      /selected icp identity is not a controller/,
    );
    assert.throws(
      () => assertSealState("prepare", "aaaaa-aa", ["aaaaa-aa"], true, "aaaaa-aa"),
      /sealing has already begun/,
    );
    assert.throws(
      () => assertSealState("verify", "aaaaa-aa", [], true),
      /must be the only controller/,
    );
    assert.throws(
      () => assertSealState("verify", "aaaaa-aa", ["aaaaa-aa"], false),
      /seal_canister\(\) was bypassed/,
      "a self-only controller list without the durable latch is not a valid seal",
    );
    assert.throws(
      () => assertSealState("verify", "aaaaa-aa", ["aaaaa-aa", "2vxsx-fae"], true),
      /must be the only controller/,
    );
    assert.doesNotThrow(() => assertSealState("verify", "aaaaa-aa", ["aaaaa-aa"], true));

    const sealed = {
      ...prepared(),
      phase: "sealed",
      controllers: ["aaaaa-aa"],
      launchLatched: true,
      verifiedAt: "2026-08-06T12:35:00.000Z",
    };
    assert.doesNotThrow(() => validatePreparedRecord(sealed));
    assert.throws(
      () => validatePreparedRecord({ ...sealed, launchLatched: false }),
      /durable launch latch/,
    );
    assert.throws(
      () =>
        validatePreparedRecord({
          ...sealed,
          releaseChecks: { ...sealed.releaseChecks, passedAt: "2026-08-06T12:01:00.000Z" },
        }),
      /does not match its attested hash/,
    );
    assert.throws(
      () => validatePreparedRecord({ ...sealed, controllers: [] }),
      /only controller/,
    );
  });

  it("keeps the public release gate portable and the full host-fixture gate explicit", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts["release:full"], "node scripts/release-attestation.mjs checks");
    assert.equal(pkg.scripts["release:attest"], "node scripts/release-attestation.mjs");
    assert.match(pkg.scripts["release:check"], /verify:rewards:built/);
    assert.doesNotMatch(pkg.scripts["release:check"], /test:logic:built/);

    const attestation = readFileSync(
      resolve(ROOT, "scripts", "release-attestation.mjs"),
      "utf8",
    );
    assert.match(
      attestation,
      /run\("node", \["scripts\/ledger-allowlist\.mjs", "--check", "-e", "ic"\]\)/,
      "prepare and verify reuse the read-only live ICRC-1 metadata check",
    );
    assert.match(attestation, /key\.startsWith\("GIT_"\)/);
    assert.match(attestation, /env\.GIT_NO_REPLACE_OBJECTS = "1"/);
    assert.match(attestation, /run\("icp", \["build", "hackathon", "--environment", "ic"\]\)/);
    assert.doesNotMatch(
      attestation,
      /echo y \| icp canister call/,
      "the seal identity keeps its real stdin for password or reauthentication prompts",
    );
    const verify = attestation.slice(attestation.indexOf("async function verify(options)"));
    assert.ok(
      verify.indexOf("await readCertifiedControllers(canisterId)") <
        verify.indexOf("await collectFacts("),
      "verify certifies the exact self-only controller list before reading release facts",
    );
  });
});
