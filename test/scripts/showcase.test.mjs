import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  FINAL_FIXTURE_BALLOTS,
  SEMIFINAL_FIXTURE_BALLOTS,
  SHOWCASE_STEPS,
  applicantProblems,
  parseArgs,
  parseProfile,
  parseSeason,
  parseWeekTotals,
  replicaAdvanceTarget,
  roleTargetCandid,
  selfControlled,
} from "../../scripts/showcase.mjs";

describe("the staged interactive showcase", () => {
  it("keeps the human-visible stages explicit and extensible", () => {
    assert.deepEqual(
      SHOWCASE_STEPS.map(({ number, name }) => ({ number, name })),
      [
        { number: 1, name: "prepare" },
        { number: 2, name: "draft" },
        { number: 3, name: "start" },
        { number: 4, name: "week-two" },
        { number: 5, name: "week-three" },
        { number: 6, name: "week-four" },
        { number: 7, name: "semifinal" },
        { number: 8, name: "final" },
        { number: 9, name: "finish" },
      ],
    );
    assert.deepEqual(parseArgs(["step-1", "@sssdf", "--reset"]), {
      step: 1,
      handle: "sssdf",
      reset: true,
    });
    assert.deepEqual(parseArgs(["draft", "sssdf"]), {
      step: 2,
      handle: "sssdf",
      reset: false,
    });
    assert.deepEqual(parseArgs(["start", "@sssdf"]), {
      step: 3,
      handle: "sssdf",
      reset: false,
    });
    assert.deepEqual(parseArgs(["week-4", "@sssdf"]), {
      step: 6,
      handle: "sssdf",
      reset: false,
    });
    assert.deepEqual(parseArgs(["semi-final", "@sssdf"]), {
      step: 7,
      handle: "sssdf",
      reset: false,
    });
    assert.deepEqual(parseArgs(["final", "@sssdf"]), {
      step: 8,
      handle: "sssdf",
      reset: false,
    });
    assert.deepEqual(parseArgs(["finish", "@sssdf"]), {
      step: 9,
      handle: "sssdf",
      reset: false,
    });
    assert.deepEqual(
      SEMIFINAL_FIXTURE_BALLOTS.map(({ identity, handle, originWeeks }) => ({
        identity,
        handle,
        originWeeks: [...originWeeks],
      })),
      [
        { identity: 20, handle: "alan", originWeeks: [2, 4] },
        { identity: 21, handle: "katherine", originWeeks: [2] },
      ],
    );
    assert.deepEqual(
      FINAL_FIXTURE_BALLOTS.map(({ identity, handle, originWeeks }) => ({
        identity,
        handle,
        originWeeks: [...originWeeks],
      })),
      [
        { identity: 20, handle: "alan", originWeeks: [2, 4] },
        { identity: 21, handle: "katherine", originWeeks: [4] },
      ],
    );
  });

  it("makes destructive reset explicit and local to preparation", () => {
    assert.throws(() => parseArgs(["2", "sssdf", "--reset"]), /only valid.*step 1/);
    assert.throws(() => parseArgs(["3", "sssdf", "--reset"]), /only valid.*step 1/);
    assert.throws(() => parseArgs(["10", "sssdf"]), /unknown showcase step/);
    assert.throws(() => parseArgs(["1", "BadHandle"]), /3-32 characters/);
    assert.throws(() => parseArgs(["1", "sssdf", "another"]), /exactly one handle/);
    assert.throws(() => parseArgs([]), /usage:/);
  });

  it("moves a disposable replica only just past one round deadline", () => {
    const day = 24n * 60n * 60n * 1_000_000_000n;
    assert.equal(replicaAdvanceTarget(10n, 20n), 1_000_000_020n);
    assert.equal(replicaAdvanceTarget(30n, 20n), 30n);
    assert.throws(
      () => replicaAdvanceTarget(1n, 9n * day),
      /more than eight days/,
    );
    assert.throws(() => replicaAdvanceTarget(1n, 0n), /no valid deadline/);
  });

  it("waits for real hacker, judge, and sponsor state", () => {
    assert.deepEqual(applicantProblems(null, "sssdf"), ["register @sssdf"]);
    assert.deepEqual(
      applicantProblems(
        {
          hacker: true,
          moderator: false,
          judgeStatus: "pending",
          sponsorStatus: "pending",
          hasSponsorApplication: true,
        },
        "sssdf",
      ),
      [],
    );
    assert.deepEqual(
      applicantProblems(
        {
          hacker: false,
          moderator: false,
          judgeStatus: "no",
          sponsorStatus: "pending",
          hasSponsorApplication: false,
        },
        "sssdf",
      ),
      [
        "choose Hacker",
        "submit a Judge application",
        "submit a Sponsor application with an organisation and at least one ledger",
      ],
    );
  });

  it("reads the public role and season boundaries from CLI Candid", () => {
    assert.deepEqual(
      parseProfile(`(opt record {
        id = 17 : nat64;
        moderator = false;
        judgeStatus = variant { pending };
        sponsor = opt record { org = "Test" };
        hacker = true;
        sponsorStatus = variant { pending };
        updatedAt = 900_001 : nat64;
      })`),
      {
        id: 17n,
        updatedAt: 900_001n,
        hacker: true,
        moderator: false,
        judgeStatus: "pending",
        sponsorStatus: "pending",
        hasSponsorApplication: true,
      },
    );
    assert.equal(parseProfile("(null)"), null);
    assert.deepEqual(
      parseSeason(
        "(opt record { id = 7 : nat64; week = 2 : nat; phase = variant { running } })",
      ),
      { id: 7n, week: 2n, phase: "running" },
    );
    assert.deepEqual(
      [...parseWeekTotals(
        "(vec { record { total = 10 : nat; week = 1 : nat }; record { total = 10 : nat; week = 2 : nat } })",
      )],
      [[1, 10], [2, 10]],
    );
    assert.equal(selfControlled(["aaaaa-aa"], "aaaaa-aa"), true);
    assert.equal(selfControlled([], "aaaaa-aa"), false);
    assert.equal(selfControlled(["aaaaa-aa", "2vxsx-fae"], "aaaaa-aa"), false);
    assert.equal(selfControlled(["2vxsx-fae"], "aaaaa-aa"), false);
    assert.equal(
      roleTargetCandid(
        {
          id: 17n,
          updatedAt: 900_001n,
          moderator: false,
          judgeStatus: "pending",
          sponsorStatus: "pending",
        },
        "judge",
      ),
      "record { id = 17 : nat64; expectedStatus = variant { pending }; " +
        "expectedUpdatedAt = 900001 : nat64 }",
    );
  });

  it("contains no generated actor or alternate season lifecycle", () => {
    const scriptPath = resolve(import.meta.dirname, "..", "..", "scripts", "showcase.mjs");
    const sourcePath = resolve(import.meta.dirname, "..", "..", "backend", "main.mo");
    const script = readFileSync(scriptPath, "utf8");
    const production = readFileSync(sourcePath, "utf8");
    for (const forbidden of [
      /local_showcase/,
      /withTemporaryShowcaseWasm/,
      /build-backend\.mjs/,
      /canister",\s*"install/,
    ]) {
      assert.doesNotMatch(script, forbidden);
      assert.doesNotMatch(production, forbidden);
    }
    assert.doesNotMatch(script, /Season\.closeWeek/);
    assert.doesNotMatch(script, /local_showcase_close_week/);
  });

  it("stops at a draft, uses the guarded normal start, then advances normal timers", () => {
    const sourcePath = resolve(import.meta.dirname, "..", "..", "scripts", "showcase.mjs");
    const source = readFileSync(sourcePath, "utf8");

    assert.match(source, /phase: "awaiting-seal"/);
    assert.match(source, /--add-controller \$\{canister\}/);
    assert.match(source, /call hackathon seal_canister/);
    assert.doesNotMatch(source, /callCandid\("controllers"/);
    assert.match(source, /"--start-season", "--open", "1"/);
    assert.match(source, /ICP_CLI_ENVIRONMENT: "local"/);
    assert.match(source, /"scripts\/seed\.mjs",[\s\S]*?"--fund",[\s\S]*?"--fund-sponsor"/);
    assert.match(source, /phase: "week-1-running"/);
    assert.match(source, /"\/update\/set_time"/);
    assert.match(source, /actor\.clock_armed\(\)/);
    assert.match(source, /pocketControllers\(canister\)/);
    assert.match(source, /if \(!selfControlled\(held, canister\)\)/);
    assert.match(source, /"--fixture-votes"/);
    assert.match(source, /donePhase: "week-4-populated"/);
    assert.match(source, /donePhase: "semifinal-open"/);
    assert.match(source, /phase: "semifinal-voted"/);
    assert.match(source, /castSemifinalFixture\(currentCanister, actor, running\)/);
    assert.match(source, /donePhase: "final-open"/);
    assert.match(source, /castFinalFixture\(currentCanister, actor, running\)/);
    assert.match(source, /advanceThroughDeadline\(actor, currentCanister, FINAL_WEEK\)/);
    assert.match(source, /phase: "finished"/);
    assert.match(source, /actor\.funding_closing\(\)/);
    assert.match(source, /state\.seasonId === undefined[\s\S]*?running\?\.id/);
    assert.match(source, /http:\/\/hackathon\.local\.localhost:5174\/#\/register/);
    assert.match(source, /http:\/\/hackathon\.local\.localhost:5174\/#\/season/);
    assert.doesNotMatch(source, /8943\/#/);
  });
});
