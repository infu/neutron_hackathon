/** Reusable builders for whole-season PocketIC reward scenarios. */
import assert from "node:assert/strict";

import { idlFactory } from "../../frontend/src/declarations/hackathon.js";
import {
  bigints,
  identity,
  MINUTE,
  ok,
  register,
  SECOND,
  walletFor,
} from "./harness.mjs";
import { ledgerAccount } from "./payout-ledger.mjs";

const DIGITS = "abcdefghij";
export const RECOVERY_TOP_UP = 1_000_000;

export const variant = (value) => Object.keys(value)[0];

export function safeNumber(value) {
  return String(value).replace(/\d/g, (digit) => DIGITS[Number(digit)]);
}

export async function inBatches(items, size, job, { pace = null } = {}) {
  const out = [];
  for (let base = 0; base < items.length; base += size) {
    const settled = await Promise.allSettled(
      items.slice(base, base + size).map((item, offset) => job(item, base + offset)),
    );
    const failed = settled.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    out.push(...settled.map((result) => result.value));
    if (pace !== null) await pace();
  }
  return out;
}

/**
 * Give a long PocketIC workload ordinary wall-clock movement and an extra
 * replica round between ingress batches. Actor updates are already separate
 * Motoko/GC message boundaries; the added round lets queued timer and
 * inter-canister work settle without advancing a multi-hour fixture anywhere
 * near a weekly deadline.
 */
export function pocketIcPacer(env, { advanceMs = 1_000, ticks = 1 } = {}) {
  assert.ok(Number.isSafeInteger(advanceMs) && advanceMs > 0, "pacing time must be positive milliseconds");
  assert.ok(Number.isSafeInteger(ticks) && ticks > 0, "pacing ticks must be a positive integer");
  let steps = 0;

  const pace = async () => {
    await env.pic.advanceTime(advanceMs);
    await env.pic.tick(ticks);
    steps += 1;
  };
  pace.stats = () => ({
    steps,
    advanceMs,
    ticksPerStep: ticks,
    requestedAdvanceMs: steps * advanceMs,
    explicitTicks: steps * ticks,
  });
  return pace;
}

export async function join(env, seed, handle) {
  const who = identity(seed);
  const actor = await register(env.as, who, handle);
  const [profile] = await actor.me();
  return { actor, handle, id: profile.id, identity: who, seed };
}

export async function makeModerators(
  env,
  count,
  seedBase,
  prefix = "scale_mod",
  { pace = null } = {},
) {
  const moderators = [];
  for (let index = 0; index < count; index += 1) {
    const person = await join(env, seedBase + index, `${prefix}_${safeNumber(index)}`);
    ok(await env.actor.set_moderator(person.handle, true, []), `appoint ${person.handle}`);
    moderators.push(person);
    if (pace !== null) await pace();
  }
  return moderators;
}

/** Apply a two-moderator decision, excluding the subject from both signatures. */
export async function approveWithTwo(moderators, subject, decide, label) {
  const eligible = moderators.filter((moderator) => moderator.id !== subject.id);
  assert.ok(eligible.length >= 2, `${label}: two non-conflicted moderators are required`);
  const first = await decide(eligible[0].actor);
  assert.ok(
    first && "err" in first && "NeedsSecond" in first.err,
    `${label}: one signature unexpectedly decided it: ${JSON.stringify(first, bigints)}`,
  );
  return ok(await decide(eligible[1].actor), label);
}

export async function makeHackers(
  env,
  count,
  seedBase,
  { sharedWalletIndexes = [], pace = null } = {},
) {
  const sharedWallet = identity(seedBase + 800_000).getPrincipal();
  const shared = new Set(sharedWalletIndexes);
  return inBatches(Array.from({ length: count }, (_, index) => index), 10, async (index) => {
    const seed = seedBase + index;
    const person = await join(env, seed, `scale_hacker_${safeNumber(index)}`);
    person.wallet = shared.has(index) ? sharedWallet : walletFor(seed);
    ok(await person.actor.set_wallet(person.wallet), `wallet ${person.handle}`);
    ok(await person.actor.set_hacker(true), `hacker ${person.handle}`);
    return person;
  }, { pace });
}

export async function makeJudges(env, moderators, extraCount, seedBase) {
  const extras = [];
  for (let index = 0; index < extraCount; index += 1) {
    extras.push(await join(env, seedBase + index, `scale_judge_${safeNumber(index)}`));
  }
  const judges = [...moderators, ...extras];
  for (const person of judges) {
    ok(await person.actor.apply_as_judge(), `${person.handle} applies as judge`);
    await approveWithTwo(
      moderators,
      person,
      (actor) => actor.set_judge(person.handle, { approved: null }, []),
      `approve judge ${person.handle}`,
    );
  }
  return judges;
}

const LEDGER_COMBINATIONS = [
  [0],
  [1],
  [2],
  [0, 1],
  [0, 2],
  [1, 2],
  [0, 1, 2],
];

export async function makeSponsors(
  env,
  moderators,
  hackers,
  ledgers,
  count,
  seedBase,
  { allLedgers = false, pace = null } = {},
) {
  if (!allLedgers) {
    assert.equal(ledgers.length, 3, "the reusable pledge matrix is defined for three ledgers");
  }
  const stacked = [...hackers.slice(0, 5), ...moderators.slice(0, 2)].slice(0, count);
  const sponsors = [...stacked];
  for (let index = stacked.length; index < count; index += 1) {
    sponsors.push(
      await join(env, seedBase + index, `scale_sponsor_${safeNumber(index)}`),
    );
    if (pace !== null) await pace();
  }

  for (const [index, person] of sponsors.entries()) {
    person.ledgers = allLedgers
      ? [...ledgers]
      : LEDGER_COMBINATIONS[index % LEDGER_COMBINATIONS.length].map(
        (ledgerIndex) => ledgers[ledgerIndex],
      );
    ok(
      await person.actor.apply_as_sponsor({
        org: `Scale Sponsor ${index + 1}`,
        website: "",
        logo: [],
        blurb: "PocketIC lifecycle fixture",
        ledgers: person.ledgers.map((ledger) => ({ id: ledger.id, sns: false })),
      }),
      `${person.handle} applies as sponsor`,
    );
    await approveWithTwo(
      moderators,
      person,
      (actor) => actor.set_sponsor(person.handle, { approved: null }, []),
      `approve sponsor ${person.handle}`,
    );
    if (pace !== null) await pace();
  }
  return sponsors;
}

export async function loadSponsorDeposits(sponsors, { pace = null } = {}) {
  for (const sponsor of sponsors) {
    const [deposit] = await sponsor.actor.my_deposit();
    assert.ok(deposit, `${sponsor.handle}: running season should expose a deposit`);
    sponsor.deposit = ledgerAccount(deposit.account);
    if (pace !== null) await pace();
  }
}

export function appSpec(owner, week, seat) {
  return {
    owner,
    week,
    seat,
    title: `Scale app ${week}-${seat + 1}`,
    slug: `scale_${safeNumber(week)}_${safeNumber(owner.id)}_${safeNumber(seat)}`,
  };
}

async function uploadPackage(spec) {
  const key = `/u/${spec.owner.id}/pkg/${spec.week}${String(spec.seat).padStart(2, "0")}.neutron`;
  ok(
    await spec.owner.actor.my_upload({
      store: {
        key,
        contentType: "application/octet-stream",
        contentEncoding: "identity",
        chunks: 1n,
        content: new Uint8Array(64).fill((spec.week + spec.seat) % 251),
      },
    }),
    `upload ${spec.title}`,
  );
  return key;
}

export async function submitWeek(env, moderator, seasonId, week, specs) {
  const proposed = await inBatches(specs, 10, async (spec) => {
    const key = await uploadPackage(spec);
    const revision = ok(
      await spec.owner.actor.submit_entry({
        title: spec.title,
        summary: "Scale payout scenario",
        url: "",
        icon: [],
        shots: [],
        links: [],
        pkg: { key },
        slug: spec.slug,
      }),
      `submit ${spec.title}`,
    );
    return { ...spec, revision };
  });

  // Approval order is deliberately deterministic because current tie-breaking
  // uses the resulting entry id.
  for (const spec of proposed) {
    ok(await moderator.actor.approve_revision(spec.revision.id), `approve ${spec.title}`);
  }

  const rows = await env.actor.season_week(seasonId, BigInt(week), 500n);
  assert.equal(rows.length, specs.length, `week ${week}: every proposal reached the bracket`);
  return proposed.map((spec) => {
    const entry = rows.find((row) => row.user_id === spec.owner.id);
    assert.ok(entry, `${spec.title}: approved entry is missing`);
    return { ...spec, entry };
  });
}

export async function castQualifierBallots(judges, entries) {
  assert.ok(entries.length >= 5);
  await Promise.all(judges.map(async (judge, index) => {
    ok(await judge.actor.cast_vote(entries[0].entry.id), `${judge.handle} votes for winner`);
    ok(
      await judge.actor.cast_vote(entries[1 + (index % 4)].entry.id),
      `${judge.handle} votes for a runner-up`,
    );
  }));
}

export async function castRoundBallots(judges, first, second, secondVotes) {
  await Promise.all(judges.map(async (judge, index) => {
    ok(await judge.actor.cast_vote(first.id), `${judge.handle} votes for ${first.title}`);
    if (index < secondVotes) {
      ok(await judge.actor.cast_vote(second.id), `${judge.handle} votes for ${second.title}`);
    }
  }));
}

async function deferredWakes(env, moderators) {
  const executions = [];
  for (const moderator of moderators) {
    const actor = env.pic.createDeferredActor(idlFactory, env.canisterId);
    actor.setIdentity(moderator.identity);
    executions.push(await actor.wake_automation());
  }
  const answers = await Promise.all(executions.map((execute) => execute()));
  for (const [index, answer] of answers.entries()) {
    ok(answer, `automation wake ${index + 1}`);
    assert.notEqual(variant(answer.ok), "idle", `automation wake ${index + 1} did no work`);
  }
  assert.ok(
    answers.some((answer) => variant(answer.ok) === "ran"),
    "at least one recovery caller must durably run the overdue stage before the stale timer ticks",
  );
  return answers;
}

/**
 * Cross a stored round deadline without producing a replica round, add cycles
 * as the top-up marker, and race the production recovery path with the stale
 * timer. PocketIC cannot remove cycles or literally delete a blackholed timer;
 * this models the observable post-top-up state without a production test hook.
 */
export async function recoverDueRound(env, moderators, { onTopUp = null } = {}) {
  const before = await env.live();
  assert.ok(before, "a round must be running");
  await env.pic.setTime(Number(before.weekEndsAt / 1_000_000n) + 1);
  await env.pic.addCycles(env.canisterId, RECOVERY_TOP_UP);
  if (onTopUp !== null) onTopUp(RECOVERY_TOP_UP);
  await deferredWakes(env, moderators);
  await env.pic.tick(12);

  const [after] = await env.actor.season();
  if (before.week < 6n) {
    assert.equal(after.week, before.week + 1n, "recovery must advance exactly one round");
    assert.deepEqual(after.phase, { running: null });
  } else {
    assert.deepEqual(after.phase, { finished: null });
  }
  return after;
}

export async function recoverAutomationAt(
  env,
  moderators,
  timeMs,
  { settleTicks = 12, onTopUp = null } = {},
) {
  await env.pic.setTime(timeMs);
  await env.pic.addCycles(env.canisterId, RECOVERY_TOP_UP);
  if (onTopUp !== null) onTopUp(RECOVERY_TOP_UP);
  const answers = await deferredWakes(env, moderators);
  if (settleTicks > 0) await env.pic.tick(settleTicks);
  return answers;
}

export function fundingModel(ledgers) {
  return {
    pending: new Map(),
    given: new Map(),
    pools: new Map(ledgers.map((ledger) => [ledger.id.toText(), 0n])),
  };
}

const pairKey = (sponsor, ledger) => `${sponsor.id}|${ledger.id.toText()}`;

export async function creditSponsors(
  sponsors,
  model,
  { select = () => true, repetitions = 1, base = 100_000n, pace = null } = {},
) {
  const credits = [];
  for (const [sponsorIndex, sponsor] of sponsors.entries()) {
    if (!select(sponsor, sponsorIndex)) continue;
    for (const [ledgerIndex, ledger] of sponsor.ledgers.entries()) {
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        credits.push({ sponsor, sponsorIndex, ledger, ledgerIndex, repetition });
      }
    }
  }
  await inBatches(credits, 20, async ({ sponsor, sponsorIndex, ledger, ledgerIndex, repetition }) => {
    const amount =
      base + BigInt((sponsorIndex + 1) * 1_000 + (ledgerIndex + 1) * 100 + repetition + 1);
    await ledger.actor.credit(sponsor.deposit, amount);
    const key = pairKey(sponsor, ledger);
    model.pending.set(key, (model.pending.get(key) ?? 0n) + amount);
  }, { pace });
}

function expectedSweep(sponsor, model) {
  const rows = [];
  for (const ledger of sponsor.ledgers) {
    const key = pairKey(sponsor, ledger);
    const held = model.pending.get(key) ?? 0n;
    if (held > ledger.fee) rows.push({ key, ledger, amount: held - ledger.fee });
  }
  return rows;
}

function commitSweep(sponsor, model, rows) {
  for (const row of rows) {
    const ledgerKey = row.ledger.id.toText();
    model.pending.set(row.key, 0n);
    model.pools.set(ledgerKey, (model.pools.get(ledgerKey) ?? 0n) + row.amount);
    model.given.set(row.key, (model.given.get(row.key) ?? 0n) + row.amount);
  }
}

export async function collectSponsors(
  sponsors,
  model,
  { select = () => true, pace = null } = {},
) {
  const selected = sponsors.filter(select);
  await inBatches(selected, 5, async (sponsor) => {
    const expected = expectedSweep(sponsor, model);
    const result = ok(await sponsor.actor.notify_deposits(), `collect ${sponsor.handle}`);
    const actual = new Map(result.map(([ledger, amount]) => [ledger.toText(), amount]));
    assert.equal(actual.size, expected.length, `${sponsor.handle}: moved ledger count`);
    for (const row of expected) {
      assert.equal(actual.get(row.ledger.id.toText()), row.amount, `${sponsor.handle}: swept amount`);
    }
    commitSweep(sponsor, model, expected);
  }, { pace });
}

/** Apply the healthy-ledger reconciliation that final close is expected to do. */
export function expectFinalReconciliation(sponsors, model) {
  for (const sponsor of sponsors) {
    commitSweep(sponsor, model, expectedSweep(sponsor, model));
  }
}

export async function assertSponsorAccounting(sponsors, model, { pace = null } = {}) {
  for (const sponsor of sponsors) {
    const [profile] = await sponsor.actor.me();
    const [info] = profile.sponsor;
    assert.ok(info, `${sponsor.handle}: approved sponsor details disappeared`);
    assert.equal(
      info.given.length,
      sponsor.ledgers.length,
      `${sponsor.handle}: one contribution row per pledged ledger`,
    );
    const pledged = new Set(sponsor.ledgers.map((ledger) => ledger.id.toText()));
    const ids = info.given.map((gift) => gift.ledger.toText());
    assert.equal(new Set(ids).size, ids.length, `${sponsor.handle}: duplicate contribution ledger`);
    assert.ok(ids.every((id) => pledged.has(id)), `${sponsor.handle}: unexpected contribution ledger`);
    const actual = new Map(info.given.map((gift) => [gift.ledger.toText(), gift.amount]));
    for (const ledger of sponsor.ledgers) {
      const expected = model.given.get(pairKey(sponsor, ledger)) ?? 0n;
      assert.equal(actual.get(ledger.id.toText()), expected, `${sponsor.handle}: accumulated gift`);
    }
    if (pace !== null) await pace();
  }
}

export async function assertDepositBalances(sponsors, model, { pace = null } = {}) {
  const checks = [];
  for (const sponsor of sponsors) {
    for (const ledger of sponsor.ledgers) checks.push({ sponsor, ledger });
  }
  await inBatches(checks, 20, async ({ sponsor, ledger }) => {
    assert.equal(
      await ledger.actor.icrc1_balance_of(sponsor.deposit),
      model.pending.get(pairKey(sponsor, ledger)) ?? 0n,
      `${sponsor.handle}: ${ledger.id.toText()} deposit balance`,
    );
  }, { pace });
}

export async function waitOneSweepWindow(env) {
  await env.advance(MINUTE + SECOND, 3);
}
