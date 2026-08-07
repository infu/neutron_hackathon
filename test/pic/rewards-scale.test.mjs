/**
 * A realistic self-controlled season from sponsor deposits to wallet balances.
 *
 * This deliberately combines the sizes that older suites tested separately:
 * 50 hackers, 60 qualifier submissions, 20 sponsors, five moderators, twelve
 * judges, three ledgers, repeated top-ups, six overdue round recoveries, final
 * reconciliation, and a payout interrupted by a 25-hour execution gap.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bootstrap,
  identity,
  ok,
  SECOND,
} from "./harness.mjs";
import {
  installPayoutLedger,
  principalAccount,
} from "./payout-ledger.mjs";
import {
  appSpec,
  assertDepositBalances,
  assertSponsorAccounting,
  castQualifierBallots,
  castRoundBallots,
  collectSponsors,
  creditSponsors,
  expectFinalReconciliation,
  fundingModel,
  loadSponsorDeposits,
  makeHackers,
  makeJudges,
  makeModerators,
  makeSponsors,
  recoverAutomationAt,
  recoverDueRound,
  submitWeek,
  variant,
  waitOneSweepWindow,
} from "./scenario.mjs";

const FUNDING_GRACE_NANOS = 300_000_000_000n;
const AWARD_WEIGHTS = { bronze: 250n, silver: 2_000n, gold: 3_500n };

const controllers = async (env) => {
  const held = await env.pic.getControllers(env.canisterId);
  return held.map((principal) => principal.toText());
};

const byUser = (rows, person) => {
  const row = rows.find((entry) => entry.user_id === person.id);
  assert.ok(row, `${person.handle}: expected bracket seat is missing`);
  return row;
};

const countVariants = (rows, field) => {
  const counts = new Map();
  for (const row of rows) {
    const tag = variant(row[field]);
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
};

const appKey = (app) => `${app.owner.id}|${app.slug}`;

function rememberClaim(claims, app, entryId, award) {
  const weight = AWARD_WEIGHTS[award];
  const current = claims.get(appKey(app));
  if (!current || weight > current.weight) {
    claims.set(appKey(app), {
      user: app.owner,
      entryId,
      award,
      weight,
    });
  }
}

/** Derive the expected plan without using any payout row as an oracle. */
function expectedPlanFor(claims, ledgers, funding) {
  const totalWeight = claims.reduce((sum, claim) => sum + claim.weight, 0n);
  assert.ok(totalWeight > 0n);
  const rows = [];
  for (const ledger of ledgers) {
    const pool = funding.pools.get(ledger.id.toText());
    const shares = claims.map((claim) => (pool * claim.weight) / totalWeight);
    assert.ok(shares.every((share) => share > ledger.fee), "fixture shares must cover every fee");

    let carrier = 0;
    for (let index = 1; index < claims.length; index += 1) {
      if (
        shares[index] > shares[carrier] ||
        (shares[index] === shares[carrier] &&
          (claims[index].user.id < claims[carrier].user.id ||
            (claims[index].user.id === claims[carrier].user.id &&
              claims[index].entryId < claims[carrier].entryId)))
      ) {
        carrier = index;
      }
    }
    const remainder = pool - shares.reduce((sum, share) => sum + share, 0n);
    for (const [index, claim] of claims.entries()) {
      const gross = shares[index] + (index === carrier ? remainder : 0n);
      rows.push({
        ...claim,
        ledger,
        gross,
        fee: ledger.fee,
        net: gross - ledger.fee,
        dust: index === carrier ? remainder : 0n,
      });
    }
  }
  return rows;
}

function assertPlanMatches(actual, expected, state) {
  assert.equal(actual.length, expected.length, "the plan has the exact independent entitlement set");
  const actualByKey = new Map();
  for (const row of actual) {
    const key = `${row.ledger.toText()}|${row.entry_id}`;
    assert.equal(actualByKey.has(key), false, `duplicate plan key ${key}`);
    actualByKey.set(key, row);
  }
  for (const line of expected) {
    const key = `${line.ledger.id.toText()}|${line.entryId}`;
    const row = actualByKey.get(key);
    assert.ok(row, `missing expected payout ${key}`);
    assert.equal(row.user_id, line.user.id, `${key}: owner`);
    assert.equal(row.handle, line.user.handle, `${key}: handle`);
    assert.equal(row.to.toText(), line.user.wallet.toText(), `${key}: owner-selected wallet`);
    assert.equal(variant(row.award), line.award, `${key}: award`);
    assert.equal(row.gross, line.gross, `${key}: weighted gross`);
    assert.equal(row.fee, line.fee, `${key}: ledger fee`);
    assert.equal(row.net, line.net, `${key}: wallet net`);
    assert.equal(row.dust, line.dust, `${key}: carrier remainder`);
    if (state) assert.equal(variant(row.state), state, `${key}: state`);
  }
}

describe("self-controlled rewards at realistic scale", () => {
  it("pays every eligible app through overdue round, funding, and payout recovery", async () => {
    const env = await bootstrap();
    try {
      const ledgers = [];
      for (const fee of [10n, 25n, 100n]) {
        ledgers.push(await installPayoutLedger(env, fee));
      }
      ok(await env.actor.set_ledger_allowlist(ledgers.map((ledger) => ledger.id)), "allow ledgers");

      const moderators = await makeModerators(env, 5, 30_000);
      const hackers = await makeHackers(env, 50, 31_000, { sharedWalletIndexes: [2, 3] });
      const judges = await makeJudges(env, moderators, 7, 32_000);
      const sponsors = await makeSponsors(env, moderators, hackers, ledgers, 20, 33_000);

      let stats = await env.actor.stats();
      assert.equal(stats.hackers, 50n);
      assert.equal(stats.moderators, 5n);
      assert.equal(stats.judges, 12n);
      assert.equal(stats.sponsors, 20n);
      assert.equal(stats.pending, 0n);
      assert.equal(stats.sponsorsPending, 0n);

      const draft = ok(await moderators[0].actor.create_season(), "create scale season");
      ok(await env.seal(), "seal scale canister");
      assert.deepEqual(
        await controllers(env),
        [env.canisterId.toText()],
        "the season starts with only the canister itself as controller",
      );
      const season = ok(await moderators[0].actor.start_season(draft.id), "start scale season");
      assert.deepEqual(season.phase, { running: null });
      await loadSponsorDeposits(sponsors);

      // Three credits before one notification pay exactly one sweep fee.
      // Later waves combine repeated notifications and balances deliberately
      // left for final reconciliation.
      const funding = fundingModel(ledgers);
      await creditSponsors(sponsors, funding, { repetitions: 3, base: 200_000n });
      await collectSponsors(sponsors, funding);

      const tooSoon = await sponsors[0].actor.notify_deposits();
      assert.ok("err" in tooSoon && "TooSoon" in tooSoon.err, "repeat notify is rate limited");

      await waitOneSweepWindow(env);
      await creditSponsors(sponsors, funding, { repetitions: 1, base: 300_000n });
      await collectSponsors(sponsors, funding, { select: (_sponsor, index) => index < 10 });

      await waitOneSweepWindow(env);
      await creditSponsors(sponsors, funding, {
        select: (_sponsor, index) => index < 5,
        repetitions: 1,
        base: 400_000n,
      });
      await collectSponsors(sponsors, funding, { select: (_sponsor, index) => index < 5 });

      // Every sponsor tops up once more and nobody notifies. These balances
      // are present before the deadline and must be caught by final close.
      await creditSponsors(sponsors, funding, { repetitions: 1, base: 500_000n });
      await assertDepositBalances(sponsors, funding);
      for (const ledger of ledgers) {
        assert.equal(
          await ledger.actor.icrc1_balance_of(principalAccount(env.canisterId)),
          funding.pools.get(ledger.id.toText()),
          "manual sweeps match the independent pool model",
        );
      }

      const allocation = [
        hackers.slice(0, 15),
        hackers.slice(15, 30),
        hackers.slice(30, 45),
        [hackers[45], ...hackers.slice(0, 4), ...hackers.slice(46, 50), ...hackers.slice(4, 10)],
      ];
      const qualifierApps = [];
      const qualifierWinners = [];
      const expectedClaimsByApp = new Map();
      let takenDownEntry = null;

      for (let week = 1; week <= 4; week += 1) {
        const specs = allocation[week - 1].map((owner, seat) => appSpec(owner, week, seat));
        if (week === 4) {
          // Hacker 0 enters the same chosen app again; hacker 1's later entry
          // remains a genuinely distinct app. Both paths must coexist.
          const repeated = specs.find((spec) => spec.owner.id === hackers[0].id);
          assert.ok(repeated, "week four must contain hacker 0's repeated app");
          repeated.slug = qualifierWinners[0].slug;
        }
        const apps = await submitWeek(env, moderators[0], season.id, week, specs);
        qualifierApps.push(...apps);
        qualifierWinners.push(apps[0]);

        if (week === 1) {
          const reason = "PocketIC takedown remains economically auditable";
          const first = await moderators[0].actor.takedown_app(apps[3].entry.id, reason);
          assert.ok("err" in first && "NeedsSecond" in first.err);
          takenDownEntry = ok(
            await moderators[1].actor.takedown_app(apps[3].entry.id, reason),
            "second takedown signature",
          );
          assert.ok(takenDownEntry.takedownAt > 0n);
        }

        await castQualifierBallots(judges, apps);
        await recoverDueRound(env, moderators);

        const closed = await env.actor.season_week(season.id, BigInt(week), 500n);
        const outcomes = countVariants(closed, "outcome");
        assert.equal(outcomes.get("advanced"), 1, `week ${week}: one app advances`);
        assert.equal(outcomes.get("rewarded"), 4, `week ${week}: four other apps place`);
        assert.equal(closed.length, 15);
        for (const app of apps.slice(0, 5)) {
          rememberClaim(expectedClaimsByApp, app, app.entry.id, "bronze");
        }
        if (week === 1) {
          const hidden = closed.find((entry) => entry.id === takenDownEntry.id);
          assert.ok(hidden.takedownAt > 0n, "takedown remains visible on the rewarded row");
          assert.equal(variant(hidden.outcome), "rewarded");
          ok(await hackers[4].actor.set_reward_opt_out(true), "one bronze winner opts out");
        }
      }

      assert.equal(qualifierApps.length, 60, "the fixture submitted exactly sixty apps");
      assert.deepEqual(
        await controllers(env),
        [env.canisterId.toText()],
        "lifecycle recovery did not add an external controller",
      );

      const semi = await env.actor.season_week(season.id, 5n, 50n);
      assert.equal(semi.length, 4, "one qualifier winner feeds each semifinal seat");
      const semiA = byUser(semi, hackers[15]);
      const semiB = byUser(semi, hackers[30]);
      await castRoundBallots(judges, semiA, semiB, judges.length);
      await recoverDueRound(env, moderators);

      const closedSemi = await env.actor.season_week(season.id, 5n, 50n);
      assert.equal(countVariants(closedSemi, "outcome").get("advanced"), 2);
      rememberClaim(expectedClaimsByApp, qualifierWinners[1], semiA.id, "silver");
      rememberClaim(expectedClaimsByApp, qualifierWinners[2], semiB.id, "silver");
      const final = await env.actor.season_week(season.id, 6n, 50n);
      assert.equal(final.length, 2);
      const finalistA = byUser(final, hackers[15]);
      const finalistB = byUser(final, hackers[30]);
      await castRoundBallots(judges, finalistA, finalistB, 5);

      // One moderator is enough to recover; the five-way races above already
      // proved stale callbacks and concurrent checks cannot double-advance.
      const finished = await recoverDueRound(env, [moderators[4]]);
      assert.deepEqual(finished.phase, { finished: null });
      const closedFinal = await env.actor.season_week(season.id, 6n, 50n);
      assert.equal(countVariants(closedFinal, "outcome").get("won"), 1);
      assert.equal(variant(byUser(closedFinal, hackers[15]).outcome), "won");
      rememberClaim(expectedClaimsByApp, qualifierWinners[1], finalistA.id, "gold");

      // Account for the last balances in the independent model, then run the
      // overdue funding stage only after its durable grace deadline.
      expectFinalReconciliation(sponsors, funding);
      const fundingDueMs =
        Number((finished.endedAt + FUNDING_GRACE_NANOS) / 1_000_000n) + 1;
      await recoverAutomationAt(env, moderators, fundingDueMs);
      let [funded] = await env.actor.season_by_number(season.number);
      for (let attempt = 0; !funded.fundingReady && attempt < 5; attempt += 1) {
        ok(await moderators[attempt].actor.wake_automation(), `finish funding pass ${attempt}`);
        [funded] = await env.actor.season_by_number(season.number);
      }
      assert.equal(funded.fundingReady, true, "moderator recovery froze the funding snapshot");
      assert.deepEqual(funded.fundingFailures, []);
      await assertDepositBalances(sponsors, funding);
      await assertSponsorAccounting(sponsors, funding);

      const expectedClaims = [...expectedClaimsByApp.values()].filter(
        (claim) => claim.user.id !== hackers[4].id,
      );
      assert.equal(expectedClaims.length, 18, "same-app dedup and one opt-out leave eighteen claims");
      const expectedPlan = expectedPlanFor(expectedClaims, ledgers, funding);
      const frozenPlan = await env.actor.payout_plan(season.id);
      assert.equal(frozenPlan.length, 54, "eighteen eligible apps across three ledgers");
      assertPlanMatches(frozenPlan, expectedPlan, "planned");
      const awards = countVariants(frozenPlan, "award");
      assert.equal(awards.get("gold"), 3);
      assert.equal(awards.get("silver"), 3);
      assert.equal(awards.get("bronze"), 48);
      assert.equal(
        frozenPlan.filter((row) => row.handle === hackers[0].handle).length,
        3,
        "the same app entered twice remains one bronze claim per ledger",
      );
      assert.equal(
        frozenPlan.filter((row) => row.handle === hackers[1].handle).length,
        6,
        "one owner keeps two genuinely distinct bronze-app claims per ledger",
      );
      assert.equal(
        frozenPlan.filter((row) => row.handle === hackers[4].handle).length,
        0,
        "the opted-out bronze app is redistributed, not paid",
      );
      assert.equal(
        frozenPlan.filter((row) => row.entry_id === takenDownEntry.id).length,
        3,
        "a taken-down placing remains a transparent reward claim",
      );

      for (const ledger of ledgers) {
        const rows = frozenPlan.filter((row) => row.ledger.toText() === ledger.id.toText());
        assert.equal(rows.reduce((sum, row) => sum + row.gross, 0n), funding.pools.get(ledger.id.toText()));
      }

      // Cross the first payout deadline without ticking the queued timer. One
      // online ledger gives one definite temporary response, leaving exactly
      // one planned row while every other reward lands. This is not an
      // ambiguous transfer.
      const transfersBeforePayout = await Promise.all(
        ledgers.map((ledger) => ledger.actor.transfer_count()),
      );
      await ledgers[0].actor.fail_next(1n);
      await recoverAutomationAt(env, moderators, (await env.pic.getTime()) + 2 * SECOND);
      const partial = await env.actor.payout_progress(season.id);
      assert.equal(partial.paid, 53n);
      assert.equal(partial.left, 1n);
      assert.equal(partial.failed, 0n);
      const afterFirstPass = await env.actor.payout_plan(season.id);
      const waiting = afterFirstPass.filter((row) => "planned" in row.state);
      assert.equal(waiting.length, 1);
      assert.equal(waiting[0].attempts, 1n);
      assert.ok(afterFirstPass.every((row) => row.attempts === 1n), "each row was claimed once");
      const transfersAfterPayout = await Promise.all(
        ledgers.map((ledger) => ledger.actor.transfer_count()),
      );
      for (const [index, ledger] of ledgers.entries()) {
        const expectedTransfers = expectedPlan.filter(
          (line) => line.ledger.id.toText() === ledger.id.toText(),
        ).length - (index === 0 ? 1 : 0);
        assert.equal(
          transfersAfterPayout[index] - transfersBeforePayout[index],
          BigInt(expectedTransfers),
          `ledger ${index}: exactly one accepted transfer per successful row`,
        );
      }
      const oldStamp = waiting[0].createdAtTime;

      // No replica rounds for 25 hours: the queued retry is overdue when the
      // external top-up marker is recorded. Moderator recovery must hit TooOld,
      // safely refresh the never-ambiguous row, and finish it.
      await env.pic.advanceTime(25 * 60 * 60 * SECOND);
      await env.pic.addCycles(env.canisterId, 1_000_000);
      const settled = ok(
        await moderators[4].actor.run_payout(season.id),
        "moderator payout recovery",
      );
      assert.equal(settled.paid, 54n);
      assert.equal(settled.left, 0n);
      assert.equal(settled.failed, 0n);
      await env.pic.tick(12);

      const paidPlan = await env.actor.payout_plan(season.id);
      assertPlanMatches(paidPlan, expectedPlan, "paid");
      const recovered = paidPlan.find((row) => row.id === waiting[0].id);
      assert.ok(recovered.createdAtTime > oldStamp, "TooOld refreshed the definitely-unsent stamp");
      assert.equal(recovered.attempts, 3n, "temporary, TooOld, then success");
      assert.ok(paidPlan.every((row) => "paid" in row.state && row.block.length === 1));

      const blocks = new Set();
      const expectedWallets = new Map();
      for (const row of paidPlan) {
        const blockKey = `${row.ledger.toText()}|${row.block[0]}`;
        assert.equal(blocks.has(blockKey), false, `duplicate payout receipt ${blockKey}`);
        blocks.add(blockKey);
      }
      for (const line of expectedPlan) {
        const walletKey = `${line.ledger.id.toText()}|${line.user.wallet.toText()}`;
        const grouped = expectedWallets.get(walletKey) ?? {
          ledger: line.ledger.id,
          wallet: line.user.wallet,
          amount: 0n,
        };
        grouped.amount += line.net;
        expectedWallets.set(walletKey, grouped);
      }

      const ledgerById = new Map(ledgers.map((ledger) => [ledger.id.toText(), ledger]));
      for (const grouped of expectedWallets.values()) {
        const ledger = ledgerById.get(grouped.ledger.toText());
        assert.equal(
          await ledger.actor.icrc1_balance_of(principalAccount(grouped.wallet)),
          grouped.amount,
          "wallet balance equals every payout row addressed to it",
        );
      }
      for (const ledger of ledgers) {
        assert.equal(await ledger.actor.icrc1_balance_of(principalAccount(env.canisterId)), 0n);
        assert.equal(await ledger.actor.icrc1_balance_of(principalAccount(hackers[49].wallet)), 0n);
        assert.equal(await ledger.actor.icrc1_balance_of(principalAccount(hackers[4].wallet)), 0n);
      }
      assert.deepEqual(
        await env.actor.prize_pool(),
        ledgers.map((ledger) => [ledger.id, 0n]),
      );
      const [paidSeason] = await env.actor.season_by_number(season.number);
      assert.deepEqual(paidSeason.payout, { paid: null }, "the season is exactly paid, not failed");
      assert.equal(await env.actor.payout_armed(), false, "no payout timer remains armed");
      assert.equal(await env.actor.withdrawals_locked(), false, "settlement releases withdrawals");

      // Terminal recovery is a pure no-op: no token, receipt, row, timer, or
      // controller changes on repeated moderator calls.
      const balancesBefore = new Map();
      for (const [key, grouped] of expectedWallets) {
        balancesBefore.set(
          key,
          await ledgerById.get(grouped.ledger.toText()).actor.icrc1_balance_of(
            principalAccount(grouped.wallet),
          ),
        );
      }
      const transfersBefore = await Promise.all(ledgers.map((ledger) => ledger.actor.transfer_count()));
      const planBefore = await env.actor.payout_plan(season.id);
      assert.equal(
        ok(await moderators[3].actor.run_payout(season.id), "settled moderator retry").left,
        0n,
      );
      for (const moderator of moderators) {
        assert.deepEqual(ok(await moderator.actor.wake_automation(), "settled moderator wake"), {
          settled: null,
        });
      }
      await env.pic.tick(12);
      assert.deepEqual(await env.actor.payout_plan(season.id), planBefore);
      assert.deepEqual(
        await Promise.all(ledgers.map((ledger) => ledger.actor.transfer_count())),
        transfersBefore,
      );
      for (const [key, grouped] of expectedWallets) {
        assert.equal(
          await ledgerById.get(grouped.ledger.toText()).actor.icrc1_balance_of(
            principalAccount(grouped.wallet),
          ),
          balancesBefore.get(key),
        );
      }
      const [stillPaid] = await env.actor.season_by_number(season.number);
      assert.deepEqual(stillPaid.payout, { paid: null }, "terminal retries cannot change paid state");
      assert.equal(await env.actor.payout_armed(), false, "terminal retries cannot re-arm payout");
      assert.equal(
        await env.actor.withdrawals_locked(),
        false,
        "terminal retries cannot relock withdrawals",
      );
      assert.deepEqual(
        await controllers(env),
        [env.canisterId.toText()],
        "normal settlement remains self-controlled and sealed",
      );
    } finally {
      await env.teardown();
    }
  });
});
