import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { idlFactory } from "../../frontend/src/declarations/hackathon.js";

import {
  bootstrap,
  closeWeek,
  hacker,
  identity,
  MINUTE,
  ok,
  register,
  SECOND,
} from "./harness.mjs";
import {
  installPayoutLedger as installLedger,
  ledgerAccount,
  principalAccount as treasury,
} from "./payout-ledger.mjs";

async function uploadPackage(actor, userId) {
  const key = `/u/${userId}/pkg/1.neutron`;
  ok(
    await actor.my_upload({
      store: {
        key,
        contentType: "application/octet-stream",
        contentEncoding: "identity",
        chunks: 1n,
        content: new Uint8Array(128).fill(7),
      },
    }),
    "upload package",
  );
  return key;
}

async function waitForFunding(env, seasonNumber) {
  await env.pic.advanceTime(5 * MINUTE + SECOND);
  for (let round = 0; round < 100; round += 1) {
    await env.pic.tick(1);
    const [season] = await env.actor.season_by_number(seasonNumber);
    if (season.fundingReady) return season;
  }
  throw new Error("funding reconciliation never reached its cutoff");
}

describe("atomic payout snapshot at the funding cutoff", () => {
  let env;

  before(async () => {
    env = await bootstrap();
  });

  after(async () => {
    await env?.teardown();
  });

  it("cannot omit a ledger that stops after fundingReady becomes observable", async () => {
    const alpha = await installLedger(env, 1_000n);
    const beta = await installLedger(env, 2_000n);
    ok(await env.actor.set_ledger_allowlist([alpha.id, beta.id]), "set ledger allowlist");

    const sponsor = await register(env.as, identity(6101), "cutoff_sponsor");
    ok(
      await sponsor.apply_as_sponsor({
        org: "Cutoff Sponsor",
        website: "",
        logo: [],
        blurb: "",
        ledgers: [
          { id: alpha.id, sns: false },
          { id: beta.id, sns: false },
        ],
      }),
      "apply sponsor",
    );
    ok(await env.actor.set_sponsor("cutoff_sponsor", { approved: null }, []), "approve sponsor");

    const moderatorIdentity = identity(6102);
    const moderator = await register(env.as, moderatorIdentity, "cutoff_mod");
    ok(await env.actor.set_moderator("cutoff_mod", true, []), "appoint moderator");
    const winner = await hacker(env, 6103, "cutoff_winner");
    const winnerId = (await winner.me())[0].id;
    const pkg = await uploadPackage(winner, winnerId);

    const draft = ok(await moderator.create_season(), "create season");
    ok(await env.seal(), "seal canister");
    const season = ok(await moderator.start_season(draft.id), "start season");

    const [deposit] = await sponsor.my_deposit();
    assert.ok(deposit, "running season exposes the sponsor deposit account");
    await alpha.actor.credit(ledgerAccount(deposit.account), 1_000_000n);
    await beta.actor.credit(ledgerAccount(deposit.account), 2_000_000n);
    ok(await sponsor.notify_deposits(), "sweep both deposits");

    const poolA = await alpha.actor.icrc1_balance_of(treasury(env.canisterId));
    const poolB = await beta.actor.icrc1_balance_of(treasury(env.canisterId));
    assert.equal(poolA, 1_000_000n - alpha.fee);
    assert.equal(poolB, 2_000_000n - beta.fee);

    const revision = ok(
      await winner.submit_entry({
        title: "Atomic Cutoff",
        summary: "",
        url: "",
        icon: [],
        shots: [],
        links: [],
        pkg: { key: pkg },
        slug: "atomic_cutoff",
      }),
      "submit entry",
    );
    ok(await moderator.approve_revision(revision.id), "approve entry");

    for (let week = 0; week < 6; week += 1) await closeWeek(env);

    // The first pass is normally started by the zero-delay final-close timer.
    // Moderator checks inside its one-minute window may replace the timer, but
    // they may not consume more attempts or pull the five-minute cutoff closer.
    const [closing] = await env.actor.season_by_number(season.number);
    assert.equal(closing.fundingReady, false);
    const attempts = closing.fundingAttempts;
    for (let check = 0; check < 3; check += 1) {
      const wake = ok(await moderator.wake_automation(), `funding wake ${check}`);
      assert.ok("armed" in wake || "busy" in wake, "funding is waiting or already in flight");
    }
    const [stillClosing] = await env.actor.season_by_number(season.number);
    assert.equal(stillClosing.fundingAttempts, attempts, "clicks cannot accelerate full passes");
    assert.equal(stillClosing.fundingReady, false, "clicks cannot bypass the grace period");
    assert.equal((await env.actor.payout_plan(season.id)).length, 0, "there is no early snapshot");

    const funded = await waitForFunding(env, season.number);

    // This was the lost-money window: fundingReady used to commit before a
    // zero-delay callback reread the ledgers. It is now impossible to observe
    // readiness without an approved/terminal result already frozen.
    assert.equal(funded.fundingReady, true);
    assert.notDeepEqual(funded.payout, { none: null });
    assert.deepEqual(funded.fundingFailures, []);

    const plan = await env.actor.payout_plan(season.id);
    assert.equal(plan.length, 2, "both central treasuries were frozen before readiness");
    const byLedger = new Map(plan.map((row) => [row.ledger.toText(), row]));
    assert.equal(byLedger.get(alpha.id.toText()).gross, poolA);
    assert.equal(byLedger.get(beta.id.toText()).gross, poolB);

    // The initial send is deliberately armed one second after the atomic
    // freeze, so this outage is deterministically after snapshot and before
    // transfer—not a race with the scheduler.
    await env.pic.stopCanister({
      canisterId: beta.id,
      sender: env.controller.getPrincipal(),
    });
    const deferred = env.pic.createDeferredActor(idlFactory, env.canisterId);
    deferred.setIdentity(moderatorIdentity);
    const executeWake = await deferred.wake_automation();
    await env.pic.advanceTime(2 * SECOND);
    ok(await executeWake(), "payout wake at first-send deadline");
    await env.pic.tick(12);

    const stalled = await env.actor.payout_progress(season.id);
    assert.equal(stalled.paid, 1n, "the reachable ledger continued");
    assert.equal(stalled.left, 1n, "the stopped ledger stayed retryable");
    const [paying] = await env.actor.season_by_number(season.number);
    assert.deepEqual(paying.payout, { paying: null });

    const attemptsBeforeRetry = new Map(
      (await env.actor.payout_plan(season.id)).map((row) => [row.ledger.toText(), row.attempts]),
    );
    const earlyRetry = ok(await moderator.wake_automation(), "early payout wake");
    assert.ok("armed" in earlyRetry || "busy" in earlyRetry);
    const attemptsAfterRetry = new Map(
      (await env.actor.payout_plan(season.id)).map((row) => [row.ledger.toText(), row.attempts]),
    );
    assert.deepEqual(attemptsAfterRetry, attemptsBeforeRetry, "wake respects payout cooldown");

    await env.pic.startCanister({
      canisterId: beta.id,
      sender: env.controller.getPrincipal(),
    });
    await env.advance(60 * MINUTE + SECOND, 12);

    const settled = await env.actor.payout_progress(season.id);
    assert.equal(settled.paid, 2n);
    assert.equal(settled.left, 0n);
    const [paid] = await env.actor.season_by_number(season.number);
    assert.deepEqual(paid.payout, { paid: null });
    assert.equal(await alpha.actor.icrc1_balance_of(treasury(env.canisterId)), 0n);
    assert.equal(await beta.actor.icrc1_balance_of(treasury(env.canisterId)), 0n);

    const planBeforeNoop = await env.actor.payout_plan(season.id);
    assert.deepEqual(ok(await moderator.wake_automation(), "settled wake"), { settled: null });
    await env.pic.tick(6);
    assert.deepEqual(await env.actor.payout_plan(season.id), planBeforeNoop);
    assert.equal(await env.actor.payout_armed(), false);
  });
});
