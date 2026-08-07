/**
 * Voting, and the ranking it feeds.
 *
 * the Judging section of the Rules page gives every judge two votes a week, on two different entries,
 * changeable until the final hour and final after it; unused votes remain open
 * until the deadline. §5 turns those tallies into outcomes: top five rewarded,
 * top one advanced, ties to the earliest submission, and a bracket that
 * shrinks rather than being padded when a week
 * is thin or empty.
 *
 * All of that is only observable with a clock, which is why it lives here: the
 * interesting cases are "what did the week look like once the timer closed it",
 * not "what does one function return".
 *
 * One thing shapes every fixture below. Before any season can start, the
 * canister is **sealed**: `seal_canister()` leaves exactly the canister itself
 * as controller and removes every external controller. No external upgrade,
 * frontend change or settings change is possible while it remains sealed.
 * `start_season` checks the exact self-only state rather than assuming it.
 *
 * `Profiles.canModerate` reads `isController(caller) or user.moderator`, so
 * `env.actor` — the identity that installed the canister — was an implicit
 * moderator right up to that call and is an ordinary caller with no profile and
 * no powers from it onwards, for the rest of the canister's life. So every
 * fixture below runs in one order: appoint the cast and create the validated
 * draft while a controller still exists, close registration, seal, then drive
 * the season through those moderators. Starting it is a moderator's call too,
 * and has to be — no external controller can pass an ingress controller gate.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  bigints,
  bootstrap,
  hacker,
  identity,
  ok,
  register,
  DAY,
  MINUTE,
  WEEK,
} from "./harness.mjs";

/** `#rewarded` / `#advanced` / `#won` / `#none`, as a string. */
const outcome = (entry) => Object.keys(entry.outcome)[0];
const ids = (rows) => rows.map((row) => row.id);
/** `origin_id` is an `opt nat64`; null when the entry was submitted, not carried. */
const origin = (entry) => entry.origin_id[0] ?? null;

/**
 * Appoint the two moderators this suite will run on, and hang them off `env`.
 *
 * `set_moderator` is controller-only, so this has to happen *before* the
 * canister is sealed — afterwards the installer is no longer a controller.
 * It also has to happen before the seal for a second reason: launch
 * readiness requires registration to be closed, and a moderator still needs a
 * profile row to have a vote.
 *
 * Stored on `env` rather than threaded through every call site because from the
 * seal onwards *every* privileged call in this file goes through these two —
 * approvals, and starting the season itself — and a parameter on each of them
 * would say the same thing fifteen times.
 */
async function seatModerators(env, seed, prefix) {
  const mods = [];
  for (const [i, suffix] of ["one", "two"].entries()) {
    const handle = `${prefix}_${suffix}`;
    mods.push(await register(env.as, identity(seed + i), handle));
    ok(await env.actor.set_moderator(handle, true, []), `appoint ${handle}`);
  }
  env.mods = mods;
  return mods;
}

/**
 * Put somebody on the judges: two moderators, because one is only a vote.
 *
 * `Moderation.SECONDS_NEEDED` is 2. The first `#approved` is recorded and comes
 * back `#NeedsSecond` with the tally; the second, from a different moderator,
 * applies it. The refusal is asserted rather than shrugged off — a canister
 * that approved on one signature would seat a judges this file then trusts.
 *
 * `Moderation.quorum` does still let a controller with no profile row through
 * alone, but that hatch is no use here and is dead code for good the moment the
 * canister is sealed: after that no external ingress caller is a controller, so the only path to an
 * approved judge that exists is two moderators. One way, permanently.
 */
async function approveJudge(env, handle) {
  const [first, second] = env.mods;
  const alone = await first.set_judge(handle, { approved: null }, []);
  assert.ok(
    alone.err && "NeedsSecond" in alone.err,
    `${handle}: one moderator should not be enough, got ${JSON.stringify(alone, bigints)}`,
  );
  return ok(await second.set_judge(handle, { approved: null }, []), `approve ${handle}`);
}

/** Register, apply, and approve — all of which must happen before the freeze. */
async function judge(env, n, handle) {
  const actor = await register(env.as, identity(n), handle);
  ok(await actor.apply_as_judge(), `apply ${handle}`);
  await approveJudge(env, handle);
  return actor;
}

// `hacker` comes from the harness: registering and setting the role is not
// enough on its own, because `Review.proposeEntry` refuses anybody without a
// reward wallet (`#NoWallet`) before it looks at the entry at all. The harness
// does register + `set_wallet` + `set_hacker`, with a wallet principal distinct
// from the one they sign in with. Nothing else: the agreement accepted at
// registration covers every role its holder later takes, so taking the hacker
// role asks for no second acceptance.

/** A counter, so every build lands on a key of its own. */
let builds = 0;

/**
 * Upload a `.neutron` build into the hacker's own namespace.
 *
 * An entry has to carry one: `checkEntry` reads the package's size out of the
 * asset store and refuses a key with nothing finished behind it. A fresh key
 * every time, because once a week closes the entry's assets freeze with it and
 * the key it points at can never be written again.
 *
 * `my_upload`, not `assets_upload`: this is the hacker writing under `/u/<id>/`
 * as themselves. The controller-gated store is shut for good by then.
 */
async function build(actor, me) {
  builds += 1;
  const key = `/u/${me.id}/pkg/${builds}.neutron`;
  ok(
    await actor.my_upload({
      store: {
        key,
        content: new Uint8Array(64),
        contentType: "application/octet-stream",
        contentEncoding: "identity",
        chunks: 1n,
      },
    }),
    `upload ${key}`,
  );
  return { key };
}

/**
 * The permanent app id, derived from the submitter's own user id.
 *
 * `Season.validSlug` allows only `a-z` and `_`, 5 to 50 characters, so the
 * digits are mapped onto letters rather than trimmed. Deriving it from the id
 * — which the canister assigns and never changes — buys both properties the
 * rules demand at once: it cannot collide with another hacker's (`slugTaken`
 * refuses those), and it is the same string every time the same hacker submits,
 * which matters because an edit has to pass its existing id back or
 * `checkSlug` refuses with "an app id cannot be changed once it is set".
 */
const slugFor = (me) => `app_${String(me.id).replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;

/**
 * Propose an entry and have a moderator approve it, so that it reaches the week.
 *
 * `submit_entry` files a revision and writes nothing to the bracket; the entry
 * only exists once `approve_revision` applies it. Everything below votes on
 * entries, so the row is read back off `my_entry` — the approval returns the
 * revision, not what it wrote.
 *
 * Approved by a moderator, never by `env.actor`. This is the call the seal
 * bites hardest: `approve_revision` is `canModerate`-gated, and on a sealed
 * canister the `isController` arm is false for the former deployer, so an
 * appointed moderator is the only reviewer there is.
 */
async function submit(env, actor, title) {
  const [me] = await actor.me();
  const pkg = await build(actor, me);
  const revision = ok(
    await actor.submit_entry({
      title,
      summary: "",
      url: "",
      icon: [],
      shots: [],
      links: [],
      pkg,
      // The same id on every submission this hacker makes: an edit in the open
      // week must match what is stored, and entering again in a later week is
      // the same project under the same name.
      slug: slugFor(me),
    }),
    `submit ${title}`,
  );
  ok(await env.mods[0].approve_revision(revision.id), `approve ${title}`);
  const [entry] = await actor.my_entry();
  assert.ok(entry, `${title} reached the week`);
  return entry;
}

/**
 * Seal the canister, then start a season on it — in that order, because there
 * is no other one.
 *
 * `start_season` asks the management canister who controls this canister and
 * refuses unless the answer is exactly self-only. That refusal is exercised here rather
 * than in one test, because it is the load-bearing half of the arrangement: a
 * season that began while somebody still held the keys would look identical
 * from outside to one that could not be rewritten halfway through.
 *
 * Both calls that shape the season are a moderator's. `create_season` and
 * `start_season` are `canModerate`-gated for the same forced reason — after
 * sealing there is no external controller, so an ingress controller gate would make a season
 * impossible to start at all, first one or fiftieth.
 */
async function season(env) {
  const [mod] = env.mods;
  const draft = ok(await mod.create_season(), "create");

  // While the installer still holds the keys, the canister will not start.
  const early = await mod.start_season(draft.id);
  assert.ok(
    early.err && "Invalid" in early.err,
    `an unsealed canister must refuse to start, got ${JSON.stringify(early, bigints)}`,
  );
  assert.match(early.err.Invalid, /seal_canister/, "and it says what is missing");

  // Shared fixture setup closes registration, fills only missing governance
  // seats, and resolves pending applications before calling the production
  // readiness gate for the irreversible seal.
  ok(await env.seal(), "seal");
  const held = await env.pic.getControllers(env.canisterId);
  assert.deepEqual(
    held.map((who) => who.toText()),
    [env.canisterId.toText()],
    "sealed means the canister is its sole controller",
  );

  const row = ok(await mod.start_season(draft.id), "start");
  assert.equal(
    await env.actor.am_moderator(),
    false,
    "the seal took the installer's keys, and with them its implicit moderator powers",
  );
  return row;
}

/**
 * Try to upgrade, and insist the platform refuses.
 *
 * `env.upgrade()` rejects rather than returning a `Result`, because nothing in
 * this canister's interface is involved: `install_code` is checked by the
 * replica against the controller list before the target is consulted at all, so
 * the former deployer is refused a layer below the code. That is what makes the seal
 * worth anything — the guarantee is the platform's, not a promise the canister
 * makes about itself.
 */
async function refusedUpgrade(env) {
  const failed = await env.upgrade().then(() => null, (e) => e);
  assert.ok(failed, "the former deployer must not upgrade a sealed canister");
  assert.match(
    String(failed),
    /install_code/,
    "and the replica, not the canister, is what refuses it",
  );
}

describe("a judge's two votes", () => {
  let env;
  let judges = {};
  let hackers = {};
  let seasonId;
  let week1 = [];

  before(async () => {
    env = await bootstrap();

    // First of all, because everything else needs them and it is the last thing
    // a controller will ever get to do: two moderators to run the season with.
    await seatModerators(env, 1815, "vmod");

    // Everything role-shaped happens before the season starts: §2 freezes the
    // judges at that moment, so an approval afterwards would be refused — and
    // there is no external controller to fall back on, because the seal
    // removed it. Two moderators is the only path there is.
    judges.one = await judge(env, 1810, "vjudge_one");
    judges.two = await judge(env, 1811, "vjudge_two");

    // Applied but never approved — §8 lets *approved* judges vote and nobody else.
    judges.pending = await register(env.as, identity(1812), "vjudge_pending");
    ok(await judges.pending.apply_as_judge(), "apply pending");

    // Registered, no roles at all.
    judges.observer = await register(env.as, identity(1813), "vobserver");

    for (const [i, n] of [1800, 1801, 1802, 1803].entries()) {
      hackers[i] = await hacker(env, n, `vhacker_${i}`);
    }
    // Roles stack (§3), so this one both hacks and judges — the case §4 singles
    // out as needing an explicit refusal rather than a silent no-op. Taking the
    // second role asks for nothing: one acceptance at registration covers every
    // role its holder assumes.
    hackers.judge = await hacker(env, 1814, "vhackjudge");
    ok(await hackers.judge.apply_as_judge(), "apply hackjudge");
    await approveJudge(env, "vhackjudge");

    const row = await season(env);
    seasonId = row.id;

    week1 = [];
    for (const i of [0, 1, 2, 3]) week1.push(await submit(env, hackers[i], `Entry ${i}`));
    week1.push(await submit(env, hackers.judge, "Entry by a judge"));
  });

  after(async () => {
    await env?.teardown();
  });

  it("has no external controller, so the installer cannot change the rules mid-run", async () => {
    // The claim §1 makes is that the rules cannot change once entries are in.
    // Controllers can replace the code, so while a human holds them that claim
    // rests on trust; the exact self-only list turns it into something a participant
    // checks independently from certified IC state, for example on the IC
    // dashboard.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the canister itself is the only controller",
    );
    assert.equal(await env.actor.is_controller(), false, "including whoever installed it");

    // `Profiles.canModerate` is `isController(caller) or user.moderator`, so a
    // controller was always an implicit moderator. For the former deployer,
    // that arm is false after sealing — which is why every approval in this file
    // goes through `env.mods`.
    assert.equal(await env.actor.am_moderator(), false, "the installer moderates nothing");
    assert.equal(await env.mods[0].am_moderator(), true, "the appointed ones still do");

    // Controller-only admin is not shut for the season — it is shut for ever,
    // so the code, the frontend and the shape of the season cannot be edited
    // underneath the entries that are already in it.
    assert.deepEqual(await env.actor.set_moderator("vmod_one", false, []), {
      err: { NotAllowed: null },
    });
    assert.deepEqual(await env.actor.set_config("Something else", true), {
      err: "caller is not a controller",
    });
    assert.deepEqual(await env.actor.set_instruction_cap(1_000_000n), {
      err: "caller is not a controller",
    });
    // The frontend included: whatever `/index.html` is now, it is that for
    // good, which is why the upload had to happen before the seal.
    assert.deepEqual(
      await env.actor.assets_upload({
        store: {
          key: "/index.html",
          content: new Uint8Array(8),
          contentType: "text/html",
          contentEncoding: "identity",
          chunks: 1n,
        },
      }),
      { err: "caller is not a controller" },
    );
    // Sealing is not a door that can be knocked on twice, either: the method
    // that emptied the list is itself controller-gated, so it locked behind
    // itself on the way out.
    assert.deepEqual(await env.actor.seal_canister(), { err: "caller is not a controller" });

    // Drafting a season is a moderator's call now. The installer is refused not
    // because a season is running but because it is nobody: no profile row, and
    // no keys to stand in for one.
    assert.deepEqual(await env.actor.create_season(), { err: { NotAllowed: null } });

    // The two answers below are the whole seal in one pair. A moderator is
    // told the judges are frozen — a rule about *when*. The installer is told it
    // is not allowed at all, because `canModerate` refused it before
    // `setJudge` ever reached the freeze: it is not a moderator, it is nobody.
    assert.deepEqual(await env.mods[0].set_judge("vjudge_pending", { approved: null }, []), {
      err: { JudgesFrozen: null },
    });
    assert.deepEqual(await env.actor.set_judge("vjudge_pending", { approved: null }, []), {
      err: { NotAllowed: null },
    });
    // Not `#NotFound` for an id that cannot exist: it never gets that far.
    assert.deepEqual(await env.actor.approve_revision(99_999n), { err: { NotAllowed: null } });

    // And the last of it: the code that is running is the code that will run
    // for the rest of this canister's life. Nothing in the season below can be
    // rewritten by anyone, including the people who wrote it.
    await refusedUpgrade(env);
  });

  it("gives an approved judge exactly two, and refuses the third", async () => {
    assert.equal(await judges.one.my_votes_left(), 2n);

    ok(await judges.one.cast_vote(week1[0].id), "first vote");
    assert.equal(await judges.one.my_votes_left(), 1n);

    ok(await judges.one.cast_vote(week1[1].id), "second vote");
    assert.equal(await judges.one.my_votes_left(), 0n);

    assert.deepEqual(await judges.one.cast_vote(week1[2].id), { err: { VoteLimit: null } });
    assert.equal(await judges.one.my_votes_left(), 0n);
  });

  it("refuses to let a judge stack both votes on one entry", async () => {
    ok(await judges.two.cast_vote(week1[0].id), "first vote");
    assert.deepEqual(await judges.two.cast_vote(week1[0].id), { err: { AlreadyVoted: null } });

    // Refused, not silently swallowed: the second vote is still available.
    assert.equal(await judges.two.my_votes_left(), 1n);
    const [entry] = (await env.actor.season_week(seasonId, 1n, 50n)).filter(
      (row) => row.id === week1[0].id,
    );
    assert.equal(entry.votes, 2n, "two judges, one vote each — the rejected one added nothing");
  });

  it("refuses a judge who is also a hacker a vote for their own entry", async () => {
    const own = week1[4];
    assert.equal(own.user_id, (await hackers.judge.me())[0].id);

    assert.deepEqual(await hackers.judge.cast_vote(own.id), { err: { OwnEntry: null } });
    assert.equal(await hackers.judge.my_votes_left(), 2n, "the attempt cost them nothing");

    // And they can still judge everybody else's.
    ok(await hackers.judge.cast_vote(week1[0].id), "vote on another entry");
    assert.equal(await hackers.judge.my_votes_left(), 1n);
  });

  it("tells the voting queue which entry a judge may not vote for", async () => {
    // §4 refuses a vote on your own entry, so the queue has to be able to say
    // so before the click rather than after. Both flags come off `weekView`.
    const queue = await hackers.judge.season_week_view(seasonId, 1n, 50n);
    const own = queue.find((view) => view.entry.id === week1[4].id);
    assert.equal(own.mine, true, "their own entry is marked");
    assert.equal(own.voted, false);

    const voted = queue.find((view) => view.entry.id === week1[0].id);
    assert.equal(voted.mine, false);
    assert.equal(voted.voted, true, "the one they already spent a vote on");

    // The same rows, read by somebody with no stake, are neither. Pin the
    // length first: both sides of the comparison below are derived from
    // `outside`, so an empty read would satisfy it without proving anything.
    const outside = await judges.observer.season_week_view(seasonId, 1n, 50n);
    assert.equal(outside.length, queue.length, "the observer sees the same rows");
    assert.equal(outside.length, 5, "five entries in week one");
    assert.deepEqual(
      outside.map((view) => [view.mine, view.voted]),
      outside.map(() => [false, false]),
    );
  });

  it("lets a judge withdraw and re-cast while the week is open", async () => {
    // Judge one is at their limit from the first test; §4 says that is not a
    // dead end while the week is open.
    assert.equal(await judges.one.my_vote_on(week1[1].id), true);
    const before = (await env.actor.season_week(seasonId, 1n, 50n)).find(
      (row) => row.id === week1[1].id,
    );

    const withdrawn = ok(await judges.one.withdraw_vote(week1[1].id), "withdraw");
    assert.equal(withdrawn.votes, before.votes - 1n, "the tally moves with the ballot");
    assert.equal(await judges.one.my_vote_on(week1[1].id), false);
    assert.equal(await judges.one.my_votes_left(), 1n);

    const recast = ok(await judges.one.cast_vote(week1[2].id), "re-cast");
    assert.equal(recast.votes, 1n);
    assert.equal(await judges.one.my_votes_left(), 0n);

    // And back again onto the entry they had abandoned: withdrawing is not a
    // one-way door, so long as the week is open.
    ok(await judges.one.withdraw_vote(week1[2].id), "withdraw the re-cast");
    const restored = ok(await judges.one.cast_vote(week1[1].id), "re-cast onto the original");
    assert.equal(restored.votes, before.votes, "the tally is back where it started");
    ok(await judges.one.withdraw_vote(week1[1].id), "settle back onto entry two");
    ok(await judges.one.cast_vote(week1[2].id), "settle back onto entry two");
  });

  it("keeps votes already cast when the hacker edits the entry underneath them", async () => {
    // §3: "A hacker may edit or replace their entry freely while the week is
    // open" — and §4 gives no way to un-cast a ballot except withdrawing it.
    // An edit that reset the tally, or that moved the row, would let a hacker
    // launder a bad score by retitling; one that dropped the vote rows would
    // hand the judge a third vote.
    const before = (await env.actor.season_week(seasonId, 1n, 50n)).find(
      (row) => row.id === week1[0].id,
    );
    assert.ok(before.votes > 0n, "the entry being edited is one that was voted for");

    const edited = await submit(env, hackers[0], "Entry 0, retitled");
    assert.equal(edited.id, week1[0].id, "an edit reuses the row rather than making a new one");
    assert.equal(edited.title, "Entry 0, retitled");
    assert.equal(edited.votes, before.votes, "the tally survives the edit");

    assert.equal(await judges.one.my_vote_on(week1[0].id), true, "the ballot is still theirs");
    assert.equal(await judges.one.my_votes_left(), 0n, "and still spent");
  });

  it("refuses a withdrawal of a vote that was never cast", async () => {
    assert.deepEqual(await judges.two.withdraw_vote(week1[3].id), { err: { NotFound: null } });
    // An entry that does not exist is the same answer, not a trap.
    assert.deepEqual(await judges.two.withdraw_vote(99_999n), { err: { NotFound: null } });
    assert.deepEqual(await judges.two.cast_vote(99_999n), { err: { NotFound: null } });
  });

  it("refuses everyone who is not an approved judge", async () => {
    // Applied, not approved: §8's "an approved judge" is the whole gate.
    assert.deepEqual(await judges.pending.cast_vote(week1[0].id), { err: { NotAJudge: null } });
    assert.equal(await judges.pending.my_votes_left(), 0n);

    assert.deepEqual(await judges.observer.cast_vote(week1[0].id), { err: { NotAJudge: null } });

    // A hacker is not a judge either — roles stack, they do not imply.
    assert.deepEqual(await hackers[1].cast_vote(week1[0].id), { err: { NotAJudge: null } });

    const stranger = env.as(identity(1899));
    assert.deepEqual(await stranger.cast_vote(week1[0].id), { err: { NotRegistered: null } });
    // Withdrawing does not check `judgeStatus` — the vote row is the real gate
    // — but it does still have to know who is asking.
    assert.deepEqual(await stranger.withdraw_vote(week1[0].id), { err: { NotRegistered: null } });
    assert.equal(await stranger.my_votes_left(), 0n);
  });

  it("locks existing ballots for the final hour but leaves unused votes open", async () => {
    const live = await env.live();
    // PocketIC accepts milliseconds while the canister stores nanoseconds.
    // Round upward so the "locked" sample is definitely on the inclusive
    // side even when the stored deadline has a sub-millisecond remainder.
    const deadlineMs = Number((live.weekEndsAt + 999_999n) / 1_000_000n);
    const cutoffMs = deadlineMs - 60 * MINUTE;

    // Immediately before the boundary, withdrawing and restoring the same
    // ballot still works. PocketIC's wall clock is set directly so this pins
    // the boundary without asking the season timer to run.
    await env.pic.setTime(cutoffMs - 1);
    ok(await judges.one.withdraw_vote(week1[2].id), "withdraw just before the lock");
    ok(await judges.one.cast_vote(week1[2].id), "restore just before the lock");

    await env.pic.setTime(cutoffMs);
    assert.deepEqual(await judges.one.withdraw_vote(week1[2].id), {
      err: { VoteLocked: null },
    });
    assert.equal(await judges.one.my_vote_on(week1[2].id), true, "the locked ballot remains");

    // Judge two still has one unused slot. The final hour is not a shortened
    // voting window; it only prevents last-second reshuffling.
    ok(await judges.two.cast_vote(week1[3].id), "cast an unused vote in the final hour");
    assert.equal(await judges.two.my_votes_left(), 0n);
  });

  it("makes votes final once the timer closes the week", async () => {
    const before = await env.actor.season_week(seasonId, 1n, 50n);
    const tallies = new Map(before.map((row) => [row.id, row.votes]));

    // Nobody presses anything. The deadline arrives (§1).
    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 2);

    assert.deepEqual(await judges.one.withdraw_vote(week1[2].id), { err: { WeekClosed: null } });
    assert.deepEqual(await judges.two.cast_vote(week1[1].id), { err: { WeekClosed: null } });

    const settled = await env.actor.season_week(seasonId, 1n, 50n);
    // The loop below asserts nothing at all over an empty or shortened read,
    // and "kept its tally" means nothing if every tally were zero.
    assert.equal(settled.length, before.length, "the close kept every row");
    assert.ok(
      [...tallies.values()].some((votes) => votes > 0n),
      "there were real votes for the close to preserve",
    );
    for (const row of settled) {
      assert.equal(row.votes, tallies.get(row.id), `entry ${row.id} kept its tally`);
    }
  });

  it("refuses a vote on an entry carried into a week that is not open", async () => {
    // Week 1's winner now sits in week 5 with a fresh row and no votes. It is
    // not the open week, so it is not votable yet.
    const semi = await env.actor.season_week(seasonId, 5n, 50n);
    assert.equal(semi.length, 1, "one qualifier winner carried forward");
    assert.equal(semi[0].votes, 0n, "carried with a clean slate");
    assert.deepEqual(await judges.one.cast_vote(semi[0].id), { err: { WeekClosed: null } });

    // Re-read. `semi[0]` was fetched *before* the attempt, so asserting on it
    // afterwards would hold even if the refusal had counted the vote anyway.
    const after = await env.actor.season_week(seasonId, 5n, 50n);
    assert.equal(after[0].votes, 0n, "the refused vote left no trace on the tally");
    assert.equal(await judges.one.my_votes_left(), 2n, "and cost the judge nothing");
  });

  it("hands every judge two fresh votes in the new week", async () => {
    // §4: two votes *per week*. Both judges spent theirs in week 1.
    assert.equal(await judges.one.my_votes_left(), 2n);
    assert.equal(await judges.two.my_votes_left(), 2n);

    const a = await submit(env, hackers[0], "Week two, one");
    const b = await submit(env, hackers[1], "Week two, two");

    ok(await judges.one.cast_vote(a.id), "week two, first vote");
    ok(await judges.one.cast_vote(b.id), "week two, second vote");
    assert.equal(await judges.one.my_votes_left(), 0n);
    assert.deepEqual(await judges.one.cast_vote(a.id), { err: { AlreadyVoted: null } });

    const rows = await env.actor.season_week(seasonId, 2n, 50n);
    assert.deepEqual(
      rows.map((row) => row.votes),
      [1n, 1n],
      "week two counts only week two's ballots",
    );
  });
});

describe("the ranking a closing week is settled by", () => {
  let env;
  let judges = [];
  let hackers = [];
  let seasonId;
  let qualifier = [];
  let thin = [];

  before(async () => {
    env = await bootstrap();
    // Before the judges, because seating the judges now needs them, and before the
    // seal, because appointing them is controller-only and the seal ends every
    // controller-only call there will ever be.
    await seatModerators(env, 1836, "rmod");
    for (let i = 0; i < 6; i += 1) judges.push(await judge(env, 1830 + i, `rjudge_${i}`));
    for (let i = 0; i < 6; i += 1) hackers.push(await hacker(env, 1820 + i, `rhacker_${i}`));

    const row = await season(env);
    seasonId = row.id;

    // Submitted in order, so ids ascend in submission order — which is the
    // whole basis of the §5 tie-break.
    for (const [i, who] of hackers.entries()) {
      qualifier.push(await submit(env, who, `Project ${i}`));
    }
    assert.deepEqual(
      ids(qualifier),
      [...ids(qualifier)].sort((a, b) => (a < b ? -1 : 1)),
      "ids should ascend with submission",
    );
  });

  after(async () => {
    await env?.teardown();
  });

  it("BUG: a limited week read returns the newest tied entries, not the ranked top", async () => {
    // Six entries, none voted on yet, so every one of them is tied and §5's
    // tie-break is the only thing ordering them: earliest first. A caller
    // asking for three should get the first three of that order.
    //
    // `Season.week` truncates to `limit` while walking `byRank` *before* it
    // applies the tie-break, and that index walk runs backwards — so within a
    // tie it keeps the LAST rows and then sorts those. The bracket asks for
    // twelve per week and `closeWeek` for five hundred, so a week with more
    // entries than the map draws shows a top that the close will not honour.
    // the bracket section of the Rules page is explicit: "There is no way to see one order on screen and
    // get another when the week closes."
    //
    // Worth knowing what this costs now: the former deployer cannot patch this
    // canister while it remains sealed.
    const all = await env.actor.season_week(seasonId, 1n, 500n);
    assert.equal(all.length, 6);
    assert.deepEqual(ids(all), ids(qualifier), "unvoted, the ranking is submission order");

    const three = await env.actor.season_week(seasonId, 1n, 3n);
    const map = await env.actor.season_map(seasonId, 3n);
    assert.deepEqual(
      { week: ids(three), bracket: map[0].entries.map((view) => view.entry.id) },
      { week: ids(all).slice(0, 3), bracket: ids(all).slice(0, 3) },
      "a capped read must be the head of the ranking closeWeek settles on",
    );
  });

  it("ranks by votes, and breaks ties to the earliest submission", async () => {
    // 3/3, 2/2, 1/1 — a tie at the top (who advances) and a tie straddling the
    // fifth place (who is the last rewarded).
    const plan = [
      [0, 1],
      [0, 1],
      [0, 1],
      [2, 3],
      [2, 3],
      [4, 5],
    ];
    for (const [j, pair] of plan.entries()) {
      for (const target of pair) ok(await judges[j].cast_vote(qualifier[target].id), "vote");
    }

    const ranked = await env.actor.season_week(seasonId, 1n, 500n);
    assert.deepEqual(
      ranked.map((row) => Number(row.votes)),
      [3, 3, 2, 2, 1, 1],
    );
    assert.deepEqual(ids(ranked), ids(qualifier), "each tie held by the earlier submission");
  });

  it("rewards the top five and advances the top one, ties included", async () => {
    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 2);

    const closed = await env.actor.season_week(seasonId, 1n, 500n);
    assert.deepEqual(
      closed.map(outcome),
      ["advanced", "rewarded", "rewarded", "rewarded", "rewarded", "none"],
      "tied at three votes the earlier entry advances; tied at one it takes the last place",
    );

    // The pair that matters: same votes, opposite fates, decided by id alone.
    const fifth = closed[4];
    const sixth = closed[5];
    assert.equal(fifth.votes, sixth.votes);
    assert.ok(fifth.id < sixth.id, "the earlier submission took the last rewarded place");

    const semi = await env.actor.season_week(seasonId, 5n, 500n);
    assert.equal(semi.length, 1);
    assert.equal(origin(semi[0]), qualifier[0].id, "the earlier of the two tied leaders");
  });

  it("closes an empty week, contributing nobody and promoting nothing", async () => {
    // Week 2: nobody submits at all.
    assert.equal((await env.actor.season_week(seasonId, 2n, 500n)).length, 0);

    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 3);

    assert.equal((await env.actor.season_week(seasonId, 2n, 500n)).length, 0, "still nothing");

    // §5: no backfilling. Week 1's runner-up is not pulled up into week 2's slot.
    const semi = await env.actor.season_week(seasonId, 5n, 500n);
    assert.equal(semi.length, 1, "the semi still holds only week one's winner");
    assert.equal(origin(semi[0]), qualifier[0].id);

    const map = await env.actor.season_map(seasonId, 12n);
    assert.deepEqual(
      map.map((week) => Number(week.week)),
      [1, 2, 3, 4, 5, 6],
      "the map still draws all six weeks",
    );
    assert.equal(Number(map[1].total), 0);
  });

  it("rewards every entry of a week that has fewer than five", async () => {
    // Three hackers who were not selected in week 1 enter again — §3 says that
    // is exactly what they do. Deliberately *not* week 1's winner: a project
    // that wins two qualifiers only ever occupies one semi-final slot, which
    // would make this a test of something else.
    thin = [];
    for (let i = 3; i < 6; i += 1) thin.push(await submit(env, hackers[i], `Thin ${i}`));

    // 2 / 1 / 1: a winner and a tie underneath it, all three inside the ceiling.
    ok(await judges[0].cast_vote(thin[0].id), "vote");
    ok(await judges[0].cast_vote(thin[1].id), "vote");
    ok(await judges[1].cast_vote(thin[0].id), "vote");
    ok(await judges[1].cast_vote(thin[2].id), "vote");

    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 4);

    const closed = await env.actor.season_week(seasonId, 3n, 500n);
    assert.equal(closed.length, 3);
    assert.deepEqual(
      closed.map(outcome),
      ["advanced", "rewarded", "rewarded"],
      "top five is a ceiling, not a quota",
    );
    assert.ok(
      closed[1].id < closed[2].id && closed[1].votes === closed[2].votes,
      "the tie under the winner still breaks to the earlier submission",
    );
  });

  it("pairs the semi by origin week, and a lone entrant walks over", async () => {
    // Week 4: empty again. Weeks 1 and 3 produced the only two survivors, so
    // each is alone in its half (§5) — duel A holds week 1's, duel B week 3's.
    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 5);

    const semi = await env.actor.season_week(seasonId, 5n, 500n);
    assert.equal(semi.length, 2);
    assert.deepEqual(
      new Set(semi.map(origin)),
      new Set([qualifier[0].id, thin[0].id]),
      "one from each half, and nothing invented to fill the other slots",
    );

    // Not a single vote is cast in the semi. §5's sharpest edge: a walkover
    // advances on zero votes because §4 sets no quorum.
    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 6);

    const settled = await env.actor.season_week(seasonId, 5n, 500n);
    assert.deepEqual(settled.map(outcome), ["advanced", "advanced"]);
    for (const row of settled) assert.equal(row.votes, 0n);

    const final = await env.actor.season_week(seasonId, 6n, 500n);
    assert.equal(final.length, 2, "one survivor from each half");
  });

  it("crowns the final on votes, not on submission order", async () => {
    const final = await env.actor.season_week(seasonId, 6n, 500n);
    // Tied at zero, the earlier id would win. One vote for the later one shows
    // the tie-break is only ever reached on equal votes.
    const later = final[1];
    ok(await judges[0].cast_vote(later.id), "vote in the final");

    await env.advance(WEEK + DAY);
    assert.equal(await env.live(), null, "the final closing finishes the season");

    const closed = await env.actor.season_week(seasonId, 6n, 500n);
    assert.equal(closed[0].id, later.id);
    assert.deepEqual(closed.map(outcome), ["won", "none"]);
  });
});

describe("a half of the bracket that produced nobody", () => {
  let env;
  let judges = [];
  let seasonId;
  let winners = [];

  before(async () => {
    env = await bootstrap();
    await seatModerators(env, 1852, "hmod");
    judges.push(await judge(env, 1850, "hjudge_one"));
    judges.push(await judge(env, 1851, "hjudge_two"));
    const one = await hacker(env, 1840, "hhacker_one");
    const two = await hacker(env, 1841, "hhacker_two");

    const row = await season(env);
    seasonId = row.id;

    // Weeks 1 and 2 each send a winner — both from the *same* half, because
    // §5 pairs 1 v 2. Weeks 3 and 4 stay empty, so duel B has nobody at all.
    winners.push(await submit(env, one, "Half A, week one"));
    ok(await judges[0].cast_vote(winners[0].id), "vote");
    await env.advance(WEEK + DAY);

    winners.push(await submit(env, two, "Half A, week two"));
    ok(await judges[0].cast_vote(winners[1].id), "vote");
    await env.advance(WEEK + DAY);

    await env.advance(WEEK + DAY); // week 3, empty
    await env.advance(WEEK + DAY); // week 4, empty
  });

  after(async () => {
    await env?.teardown();
  });

  it("puts both survivors in the same duel", async () => {
    assert.equal(Number((await env.live()).week), 5);
    const semi = await env.actor.season_week(seasonId, 5n, 500n);
    assert.equal(semi.length, 2, "weeks 1 and 2 only");
    assert.deepEqual(new Set(semi.map(origin)), new Set(ids(winners)));

    const map = await env.actor.season_map(seasonId, 12n);
    assert.deepEqual(
      map.map((week) => Number(week.total)),
      [1, 1, 0, 0, 2, 0],
      "the map draws the empty weeks rather than reshaping the bracket",
    );
  });

  it("sends one survivor to a final of one, and it takes the grand prize", async () => {
    const semi = await env.actor.season_week(seasonId, 5n, 500n);
    // Both judges back the later entry, so the duel is decided on votes and the
    // outcome is not the one an id tie-break would have produced.
    const favourite = semi.find((row) => origin(row) === winners[1].id);
    for (const who of judges) ok(await who.cast_vote(favourite.id), "vote in the duel");

    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 6);

    const settled = await env.actor.season_week(seasonId, 5n, 500n);
    assert.equal(settled[0].id, favourite.id);
    assert.deepEqual(
      settled.map(outcome),
      ["advanced", "none"],
      "one silver from the contested duel; the loser of a duel takes nothing",
    );

    // §5: a half that produced nobody yields a final of one.
    const final = await env.actor.season_week(seasonId, 6n, 500n);
    assert.equal(final.length, 1);
    assert.equal(origin(final[0]), favourite.id);

    await env.advance(WEEK + DAY);
    assert.equal(await env.live(), null);
    const crowned = await env.actor.season_week(seasonId, 6n, 500n);
    assert.deepEqual(crowned.map(outcome), ["won"]);
  });

  it("has no votes left to give once the season is finished", async () => {
    // §1: a finished season is immutable. There is no open week to vote in and
    // no allowance to report.
    const final = await env.actor.season_week(seasonId, 6n, 500n);
    assert.deepEqual(await judges[0].cast_vote(final[0].id), { err: { NoSeason: null } });
    assert.deepEqual(await judges[0].withdraw_vote(final[0].id), { err: { NoSeason: null } });
    assert.equal(await judges[0].my_votes_left(), 0n);
  });

  it("is still self-controlled once the season is over", async () => {
    // The seal has no second half. It is not a loan of the keys for the length
    // of a season — there is no release, no due date, and no caller who could
    // bring one about through the ordinary season flow.
    //
    // The interface says the same thing by omission, which is worth pinning
    // because the absence is the design: there is no method to ask for the keys
    // back and none to ask when they are due.
    assert.equal(typeof env.actor.release_controllers, "undefined", "nothing to release");
    assert.equal(typeof env.actor.controllers_due_at, "undefined", "and no date to publish");

    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "a finished season adds no external controller",
    );
    assert.equal(await env.actor.am_moderator(), false, "the installer is still nobody");
    assert.deepEqual(await env.actor.set_moderator("hmod_one", false, []), {
      err: { NotAllowed: null },
    });
    await refusedUpgrade(env);

    // What survives is what the installed code grants, and on a canister whose
    // season is over that comes to nothing anybody can steer. The installer is
    // refused on standing; a moderator — the one authority the seal left
    // standing — is refused because there is no next season here to draft. One
    // canister, one season, so whoever runs the next one runs a different
    // canister and has no way back into this one's results.
    assert.deepEqual(await env.actor.create_season(), { err: { NotAllowed: null } });
    const next = await env.mods[0].create_season();
    assert.match(next.err?.Invalid ?? "", /already has one/, "not a moderator either");
  });
});

describe("the semi-final as two duels rather than a top two", () => {
  let env;
  let judges = [];
  let seasonId;
  let qualifiers = [];

  before(async () => {
    env = await bootstrap();
    await seatModerators(env, 1873, "dmod");
    for (let i = 0; i < 3; i += 1) judges.push(await judge(env, 1870 + i, `djudge_${i}`));

    const hackers = [];
    for (let i = 0; i < 4; i += 1) hackers.push(await hacker(env, 1860 + i, `dhacker_${i}`));

    const row = await season(env);
    seasonId = row.id;

    // One entry a week, so each qualifier has an unambiguous winner and the
    // semi is a full field: weeks 1 and 2 in duel A, weeks 3 and 4 in duel B.
    for (let i = 0; i < 4; i += 1) {
      qualifiers.push(await submit(env, hackers[i], `Qualifier ${i + 1}`));
      await env.advance(WEEK + DAY);
    }
  });

  after(async () => {
    await env?.teardown();
  });

  it("advances the best of each half, not the best two overall", async () => {
    assert.equal(Number((await env.live()).week), 5);
    const semi = await env.actor.season_week(seasonId, 5n, 500n);
    assert.equal(semi.length, 4);

    const from = (n) => semi.find((r) => origin(r) === qualifiers[n].id);
    const [a, b, c] = [from(0), from(1), from(2)];

    // 3 / 2 / 1 / 0. The global top two are both out of weeks 1 and 2 — the
    // same half — which §5 says must not both reach the final.
    ok(await judges[0].cast_vote(a.id), "vote");
    ok(await judges[0].cast_vote(b.id), "vote");
    ok(await judges[1].cast_vote(a.id), "vote");
    ok(await judges[1].cast_vote(b.id), "vote");
    ok(await judges[2].cast_vote(a.id), "vote");
    ok(await judges[2].cast_vote(c.id), "vote");

    const ranked = await env.actor.season_week(seasonId, 5n, 500n);
    assert.deepEqual(
      ranked.map((row) => Number(row.votes)),
      [3, 2, 1, 0],
      "globally, the top two are both from duel A",
    );

    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 6);

    const settled = await env.actor.season_week(seasonId, 5n, 500n);
    const outcomeOf = (id) => outcome(settled.find((row) => row.id === id));
    assert.equal(outcomeOf(a.id), "advanced", "duel A's winner");
    assert.equal(outcomeOf(b.id), "none", "second overall, but beaten in its own duel");
    assert.equal(outcomeOf(c.id), "advanced", "duel B's winner on a single vote");

    const final = await env.actor.season_week(seasonId, 6n, 500n);
    assert.deepEqual(
      new Set(final.map(origin)),
      new Set([a.id, c.id]),
      "one finalist from each half of the bracket",
    );
  });
});

describe("repeated qualifier wins", () => {
  // One project may win more than one qualifier. Those are two earned bracket
  // seats, not one identity to deduplicate: each carried row points to the
  // qualifier entry that earned it, so duel A and duel B both retain the
  // winner they actually produced. This used to be a skipped bug repro for a
  // `(season, week, hacker)` carry key; keep it live so that shortcut cannot
  // silently collapse a double winner back to three semi-finalists.
  it("carries every qualifier seat when one hacker wins twice", async () => {
    // A season of its own: this one has already been played to week 5.
    const probe = await bootstrap();
    try {
      await seatModerators(probe, 1895, "smod");
      const one = await judge(probe, 1890, "sjudge_one");
      const two = await judge(probe, 1891, "sjudge_two");
      const h = await hacker(probe, 1892, "shacker_h");
      const a = await hacker(probe, 1893, "shacker_a");
      const b = await hacker(probe, 1894, "shacker_b");
      const id = (await season(probe)).id;

      // Week 1: H takes it two votes to one.
      const w1 = await submit(probe, h, "H, week one");
      const a1 = await submit(probe, a, "A, week one");
      ok(await one.cast_vote(w1.id), "vote");
      ok(await two.cast_vote(w1.id), "vote");
      ok(await one.cast_vote(a1.id), "vote");
      await probe.advance(WEEK + DAY);

      // Week 2: A, unopposed.
      const a2 = await submit(probe, a, "A, week two");
      ok(await one.cast_vote(a2.id), "vote");
      await probe.advance(WEEK + DAY);

      // Week 3: H again, two votes to one.
      const w3 = await submit(probe, h, "H, week three");
      const b3 = await submit(probe, b, "B, week three");
      ok(await one.cast_vote(w3.id), "vote");
      ok(await two.cast_vote(w3.id), "vote");
      ok(await one.cast_vote(b3.id), "vote");
      await probe.advance(WEEK + DAY);

      // Week 4: B, unopposed.
      const b4 = await submit(probe, b, "B, week four");
      ok(await one.cast_vote(b4.id), "vote");
      await probe.advance(WEEK + DAY);
      assert.equal(Number((await probe.live()).week), 5);

      const [winner] = await probe.actor.season_week(id, 3n, 500n);
      assert.equal(winner.id, w3.id, "H won week three");
      assert.equal(outcome(winner), "advanced", "and the row says so");

      const semi = await probe.actor.season_week(id, 5n, 500n);
      assert.equal(semi.length, 4, "one semi-final seat per qualifier winner");
      assert.deepEqual(
        new Set(semi.map(origin)),
        new Set([w1.id, a2.id, w3.id, b4.id]),
        "all four qualifier origins survive, including both seats held by H",
      );
    } finally {
      await probe.teardown();
    }
  });
});
