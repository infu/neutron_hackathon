import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyModeratorResult,
  parseArgs,
  parseModeratorTarget,
} from "../../scripts/moderator.mjs";

describe("the one-command moderator helper", () => {
  it("normalizes @handles and pins local by default", () => {
    assert.deepEqual(parseArgs(["@werwer"]), {
      handle: "werwer",
      environment: "local",
    });
    assert.deepEqual(parseArgs(["werwer", "-e", "local"]), {
      handle: "werwer",
      environment: "local",
    });
  });

  it("requires an exact confirmation outside local", () => {
    assert.throws(
      () => parseArgs(["werwer", "-e", "ic"]),
      /refusing to change ic without --confirm ic/,
    );
    assert.deepEqual(parseArgs(["@werwer", "-e", "ic", "--confirm", "ic"]), {
      handle: "werwer",
      environment: "ic",
    });
  });

  it("rejects missing, malformed, or extra handles", () => {
    assert.throws(() => parseArgs([]), /usage:/);
    assert.throws(() => parseArgs(["BadHandle"]), /3-32 characters/);
    assert.throws(() => parseArgs(["one", "two"]), /exactly one/);
    assert.throws(() => parseArgs(["werwer", "--wat"]), /unknown option/);
  });

  it("recognizes grants, idempotent grants, and canister errors", () => {
    assert.deepEqual(
      classifyModeratorResult(
        '(variant { ok = record { "principal" = principal "aaaaa-aa"; moderator = true } })',
      ),
      { kind: "granted", principal: "aaaaa-aa" },
    );
    assert.deepEqual(
      classifyModeratorResult("(variant { err = variant { NoChange } })"),
      { kind: "existing" },
    );
    assert.deepEqual(
      classifyModeratorResult("(variant { err = variant { NotRegistered } })"),
      { kind: "error", error: "NotRegistered" },
    );
    assert.deepEqual(
      classifyModeratorResult("(variant { err = variant { NotAllowed } })"),
      { kind: "error", error: "NotAllowed" },
    );
  });

  it("targets the immutable account generation read immediately before the grant", () => {
    assert.deepEqual(
      parseModeratorTarget(`(opt record {
        id = 42 : nat64;
        moderator = false;
        updatedAt = 1_234_567 : nat64;
      })`),
      {
        id: 42n,
        expectedOn: false,
        expectedUpdatedAt: 1_234_567n,
      },
    );
    assert.equal(parseModeratorTarget("(null)"), null);
    assert.throws(
      () => parseModeratorTarget("(opt record { moderator = false })"),
      /incomplete profile/,
    );
  });
});
