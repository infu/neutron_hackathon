import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  advanceBallotIndexes,
  parseArgs,
  projectsForWeek,
  requireLocalTarget,
  reusablePublishedAsset,
} from "../../scripts/seed.mjs";

const source = readFileSync(resolve(import.meta.dirname, "..", "..", "scripts", "seed.mjs"), "utf8");

describe("the disposable season seed contract", () => {
  it("has no flag or ambient escape hatch from the local fixture target", () => {
    assert.doesNotThrow(() => requireLocalTarget(parseArgs([], {})));
    assert.throws(
      () => requireLocalTarget(parseArgs(["-e", "ic"], {})),
      /refusing to seed non-local environment "ic"/,
    );
    assert.throws(
      () => requireLocalTarget(parseArgs([], { ICP_CLI_ENVIRONMENT: "staging" })),
      /refusing to seed non-local environment "staging"/,
    );
    assert.throws(
      () => parseArgs(["-e", "ic", "--confirm", "ic"], {}),
      /unknown argument: --confirm/,
    );
  });

  it("keeps drafting and post-seal starting as separate modes", () => {
    assert.deepEqual(
      { season: parseArgs(["--season"]).season, start: parseArgs(["--season"]).startSeason },
      { season: true, start: false },
    );
    assert.deepEqual(
      {
        season: parseArgs(["--start-season"]).season,
        start: parseArgs(["--start-season"]).startSeason,
      },
      { season: false, start: true },
    );
    assert.throws(() => parseArgs(["--season", "--start-season"]), /choose one lifecycle action/);
    assert.throws(() => parseArgs(["--season", "--fund"]), /draft cannot accept funding/);
  });

  it("can include one recorded human in local showcase funding", () => {
    const args = parseArgs(["--fund", "--fund-sponsor", "@sssdf"]);
    assert.equal(args.fund, true);
    assert.equal(args.fundSponsor, "sssdf");
    assert.throws(
      () => parseArgs(["--fund-sponsor", "sssdf"]),
      /only valid with --fund/,
    );
    assert.throws(
      () => parseArgs(["--fund", "--fund-sponsor", "BadHandle"]),
      /valid handle/,
    );
  });

  it("makes the mixed review fixture explicit and large enough to be useful", () => {
    const args = parseArgs(["--advance", "--apps", "12", "--mixed"]);
    assert.equal(args.advance, true);
    assert.equal(args.apps, 12);
    assert.equal(args.mixed, true);
    assert.throws(() => parseArgs(["--mixed"]), /only valid with --advance/);
    assert.throws(
      () => parseArgs(["--advance", "--apps", "6", "--mixed"]),
      /needs at least 7 apps/,
    );
    assert.throws(() => parseArgs(["--advance", "--apps", "16"]), /whole number/);
  });

  it("only adds later-round ballots when the showcase asks explicitly", () => {
    const args = parseArgs(["--advance", "--apps", "7", "--fixture-votes"]);
    assert.equal(args.fixtureVotes, true);
    assert.deepEqual(advanceBallotIndexes(3, 7, true), []);
    assert.deepEqual(advanceBallotIndexes(4, 7, false), []);
    assert.deepEqual(advanceBallotIndexes(4, 7, true), [[6, 1], [6, 2]]);
    assert.throws(
      () => parseArgs(["--fixture-votes"]),
      /only valid with --advance/,
    );
    assert.throws(
      () => parseArgs(["--advance", "--apps", "2", "--fixture-votes"]),
      /at least 3 apps/,
    );
  });

  it("varies each qualifier roster and leaves the live week unseeded", () => {
    const names = (week, count) => projectsForWeek(week, count).map((project) => project.title);
    assert.deepEqual(names(1, 5), ["Sable", "Rewind", "Tilecast", "Lantern", "Prism"]);
    assert.deepEqual(names(2, 5), ["Orbit", "Relay", "Forge", "Mosaic", "Beacon"]);
    assert.deepEqual(names(3, 7), [
      "Tilecast",
      "Lantern",
      "Prism",
      "Orbit",
      "Relay",
      "Forge",
      "Mosaic",
    ]);
    assert.deepEqual(names(4, 7), [
      "Prism",
      "Orbit",
      "Relay",
      "Forge",
      "Mosaic",
      "Beacon",
      "Atlas",
    ]);
    assert.match(source, /week === 1[\s\S]*?Lantern wins week 1/);
    assert.match(source, /week === 2[\s\S]*?Beacon wins week 2/);
    assert.match(source, /week === 4 && fixtureVotes/);
  });

  it("reuses immutable demo art when an app enters another qualifier", () => {
    assert.equal(
      reusablePublishedAsset(
        "that file is referenced by a published entry or pending review",
      ),
      true,
    );
    assert.equal(reusablePublishedAsset("that upload would exceed the account limit"), false);
    assert.match(source, /if \(!reusablePublishedAsset\(stored\.err\)\)/);
    assert.match(source, /throw new Error\(`could not prepare all art for \$\{project\.title\}`\)/);
  });

  it("never hides the irreversible seal inside the script", () => {
    assert.doesNotMatch(source, /await\s+\w+\.seal_canister\s*\(/);
    assert.match(source, /DRAFT ONLY — the demo has not sealed or started the canister/);
    assert.doesNotMatch(source, /await\s+\w+\.controllers\s*\(/);
    assert.match(source, /await ada\.start_season\(draft\.id\)/);
    assert.match(source, /normal[\s\S]*start call verifies that \$\{canisterId\} is its sole controller/);
  });

  it("keeps a shifted PocketIC clock inside the disposable seed process", () => {
    assert.match(source, /if \(local\) await alignLocalProcessClock\(\)/);
    assert.match(source, /class ReplicaDate extends WallDate/);
    assert.match(source, /globalThis\.Date = ReplicaDate/);
    assert.match(source, /local \? \{ verifyQuerySignatures: false \} : \{\}/);
  });

  it("fixes the verified ledger policy before the first sponsor application", () => {
    const configured = source.indexOf("await configureLedgerAllowlist(admin)");
    const applied = source.indexOf("await canister.apply_as_sponsor");
    assert.ok(configured > 0 && configured < applied, "allowlist configuration precedes applications");
    assert.match(source, /args\.season \? LOCAL_LEDGERS/);
  });

  it("reports funded pools from the canister's prize accounting query", () => {
    assert.match(source, /await admin\.prize_pool\(\)/);
    assert.doesNotMatch(source, /admin\.treasury_balance/);
    assert.match(source, /info\?\.given/);
    assert.match(source, /await admin\.sweep_sponsor/);
    assert.match(source, /not an approved sponsor; refusing to transfer/);
    assert.match(
      source,
      /token\.decimals >= 18[\s\S]*?10n \*\* BigInt\(token\.decimals - 1\)/,
      "the finite u64 high-decimal fixture survives repeated showcase runs",
    );
  });
});
