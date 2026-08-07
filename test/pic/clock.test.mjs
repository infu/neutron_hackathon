/**
 * The season runs itself, because by then there is no external controller.
 *
 * The canister is sealed once, before any season: setup happens first —
 * moderators appointed, frontend uploaded, allowance set — and then
 * `seal_canister()` removes every external controller while keeping the
 * canister itself as the sole controller.
 *
 * So a moderator, not a controller, starts the season — that is forced, since a
 * controller gate after sealing would be a gate no ingress caller could pass —
 * and `start_season` refuses until certified controller state is exactly self. After that
 * the canister closes each week at its own deadline, resolves it, carries the
 * winners forward and arms the next one with no external key-holder able to
 * intervene. These are the tests that cannot exist under `ash`, because they
 * are all about what happens when time passes.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AnonymousIdentity } from "@dfinity/agent";

import { idlFactory } from "../../frontend/src/declarations/hackathon.js";
import {
  bootstrap,
  hacker,
  identity,
  ok,
  phaseOf,
  register,
  DAY,
  WEEK,
} from "./harness.mjs";

/** An entry needs a `.neutron` package that has really been uploaded. */
const pkgUpload = (key) => ({
  store: {
    key,
    content: new Uint8Array(256),
    contentType: "application/octet-stream",
    contentEncoding: "identity",
    chunks: 1n,
  },
});

/** One moderator's `#approved`, recorded rather than applied. */
const NEEDS_SECOND = { err: { NeedsSecond: { votes: 1n, needed: 2n } } };

/**
 * The permanent app id for the hacker at index `i`.
 *
 * An entry now carries one, and it is narrow on purpose: 5 to 50 characters of
 * `a-z` and `_`, unique across users, fixed once chosen. The cast here is
 * numbered, so the number is spelled in letters — `app_a`, `app_b`, … — which
 * keeps one id per hacker with nothing outside the alphabet the canister takes.
 */
const slugFor = (i) => `app_${String(i).replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;

/**
 * PocketIC exposes the replica's controller state directly. The exact
 * singleton self list means sealed; a test must not quietly accept another
 * shape and call it a pass.
 */
async function controllersOf(env) {
  const held = await env.pic.getControllers(env.canisterId);
  return held.map((who) => who.toText()).sort();
}

describe("the season clock", () => {
  let env;
  /** The moderator who starts seasons, seated while there is still a key. */
  let mod;
  let modIdentity;
  /** Drafted before the seal, started after it. The only one there will be. */
  let draft;

  before(async () => {
    env = await bootstrap();
  });

  after(async () => {
    await env?.teardown();
  });

  it("arms nothing, and starts out with the keys in a hand", async () => {
    assert.equal(await env.actor.clock_armed(), false);
    assert.deepEqual(await env.actor.week_ends_at(), []);

    // The keys are where the deploy left them: the human who installed it,
    // plus the canister, which the bootstrap seats as a controller of itself
    // because `update_settings` has no self-exemption — reading your own
    // status is unprivileged, changing your own settings is not, and sealing
    // is the canister changing its own settings.
    assert.deepEqual(
      await controllersOf(env),
      [env.canisterId.toText(), env.controller.getPrincipal().toText()].sort(),
    );
    assert.equal(await env.actor.am_moderator(), true, "a controller moderates, for now");
  });

  it("refuses to start a season while anybody still holds a key", async () => {
    // Everything gated on `isController` has to happen now, in this order,
    // because there is exactly one seal and nothing survives it. Seating a
    // moderator is the load-bearing step: afterwards moderators are the only
    // authority that exists, and there is no way to appoint another, ever.
    modIdentity = identity(150);
    mod = await register(env.as, modIdentity, "clockmod");
    ok(await env.actor.set_moderator("clockmod", true, []), "appoint a moderator");

    // Drafting is a moderator's call for the same reason starting is: the seal
    // comes before the season, so a controller gate would strand the one
    // season this canister exists to run.
    draft = ok(await mod.create_season(), "a moderator drafts");

    // And the seal is checked rather than assumed, on every start. A season
    // that began while somebody still held the keys would be a season whose
    // rules could be rewritten halfway through, and from outside it would look
    // identical to one that could not.
    const early = await mod.start_season(draft.id);
    assert.match(
      early.err?.Invalid ?? "",
      /not sealed/,
      "a moderator cannot start an unsealed canister",
    );
    assert.equal(await env.actor.clock_armed(), false, "and nothing was armed");
  });

  it("leaves exactly the canister itself as controller", async () => {
    ok(await env.seal(), "seal");

    // The question is asked of the management canister rather than of a row in
    // the database on purpose: the claim the site makes is that a participant
    // can go and check who controls this thing, and the answer has to be the
    // canister itself and nobody external.
    assert.deepEqual(
      await controllersOf(env),
      [env.canisterId.toText()],
      "the canister is its sole controller",
    );

    // The installer kept nothing at all. `Profiles.canModerate` reads
    // `Principal.isController(caller) or user.moderator`, and the first
    // disjunct is now false for the former external controller.
    assert.equal(await env.actor.am_moderator(), false, "not even implicitly");
    assert.deepEqual(
      await env.actor.set_moderator("clockmod", false, []),
      { err: { NotAllowed: null } },
      "the judges cannot be reshuffled from outside",
    );
    const config = await env.actor.set_config("Renamed", true);
    assert.match(config.err ?? "", /not a controller/, "the site cannot be reconfigured");
    const cap = await env.actor.set_instruction_cap(1n);
    assert.match(cap.err ?? "", /not a controller/, "the allowance is what it is");
    const upload = await env.actor.assets_upload(pkgUpload("/index.html"));
    assert.match(upload.err ?? "", /not a controller/, "and the frontend is frozen with it");

    // There is no second seal for the former installer to ask for either:
    // it is no longer a controller.
    assert.deepEqual(await env.actor.seal_canister(), { err: "caller is not a controller" });
  });

  it("arms a week when a moderator starts the season", async () => {
    ok(await mod.start_season(draft.id), "start");

    assert.equal(await env.actor.clock_armed(), true);
    const [due] = await env.actor.week_ends_at();
    assert.ok(due > 0n, "a deadline should be set");

    const season = await env.live();
    assert.equal(Number(season.week), 1);
    assert.equal(phaseOf(season), "running");

    // Starting changes nothing about who holds the canister. The seal is not
    // something a season does — it is the precondition for a season existing,
    // which is why `start_season` checks it rather than performs it.
    assert.deepEqual(
      await controllersOf(env),
      [env.canisterId.toText()],
      "still exactly self-controlled",
    );
  });

  it("refuses a second season, because the next one is a new canister", async () => {
    // One canister, one season. `Season.create` refuses the moment it finds any
    // season row at all, so there is no drafting the next one here — not
    // alongside this one and not after it. That is what makes a finished
    // season's canister a record rather than a thing still in use: it holds one
    // season, and whoever runs the next season runs a different canister.
    const second = await mod.create_season();
    assert.match(
      second.err?.Invalid ?? "",
      /already has one/,
      "not even a moderator gets a second season",
    );

    // A successful start consumes the durable launch latch only after the
    // running phase commits. A replay therefore stops at that one-shot gate;
    // it cannot reuse the proof that froze the launch manifest. The lower
    // `Season.start` phase guard remains the synchronous race barrier, but a
    // later ingress deliberately cannot reach it with a consumed latch.
    const restart = await mod.start_season(draft.id);
    assert.match(
      restart.err?.Invalid ?? "",
      /not sealed through seal_canister/,
      "the launch latch cannot be reused",
    );

    // The installer gets a different refusal, a step earlier, and it is the
    // more important one: not "there is already a season" but "you are nobody
    // here".
    assert.deepEqual(await env.actor.create_season(), { err: { NotAllowed: null } });
    assert.deepEqual(await env.actor.start_season(draft.id), { err: { NotAllowed: null } });
  });

  it("lets only a moderator re-arm the exact stored deadline, without advancing", async () => {
    const before = await env.live();
    const stranger = env.as(identity(152));
    const anonymous = env.as(new AnonymousIdentity());
    const delegatedIdentity = identity(153);
    ok(await mod.set_agent([delegatedIdentity.getPrincipal()]), "nominate moderator agent");
    const delegated = env.as(delegatedIdentity);

    assert.deepEqual(await env.actor.wake_automation(), { err: { NotAllowed: null } });
    assert.deepEqual(await stranger.wake_automation(), { err: { NotAllowed: null } });
    assert.deepEqual(await anonymous.wake_automation(), { err: { NotAllowed: null } });
    assert.deepEqual(
      await delegated.wake_automation(),
      { err: { NotAllowed: null } },
      "ordinary agent delegation never delegates moderator recovery",
    );

    const first = ok(await mod.wake_automation(), "moderator wake");
    const second = ok(await mod.wake_automation(), "repeat moderator wake");
    assert.deepEqual(first, {
      armed: { stage: { round: 1n }, at: before.weekEndsAt },
    });
    assert.deepEqual(second, first, "repeated checks keep the same absolute deadline");

    const afterWake = await env.live();
    assert.equal(afterWake.id, before.id);
    assert.equal(afterWake.week, before.week);
    assert.equal(afterWake.weekEndsAt, before.weekEndsAt);
    assert.equal(await env.actor.clock_armed(), true);
  });

  it("does not close the week early", async () => {
    await env.advance(6 * DAY);
    const season = await env.live();
    assert.equal(Number(season.week), 1, "six days in is still week one");
    assert.equal(await env.actor.clock_armed(), true);
  });

  it("advances exactly once when recovery and the old expiry meet", async () => {
    const before = await env.live();
    const deferred = env.pic.createDeferredActor(idlFactory, env.canisterId);
    deferred.setIdentity(modIdentity);

    // Move the replica clock without executing a round, then submit both due
    // paths at that same clock. Submitting before a one-day jump would expire
    // the ingress itself rather than exercise the timer race.
    await env.pic.setTime(Number(before.weekEndsAt / 1_000_000n) + 1);
    const executeWake = await deferred.wake_automation();
    ok(await executeWake(), "due wake");
    await env.pic.tick(12);

    const season = await env.live();
    assert.equal(Number(season.week), 2, "the canister should have moved on");
    assert.equal(phaseOf(season), "running");
    assert.equal(await env.actor.clock_armed(), true, "and armed the next week");
    assert.ok(season.weekEndsAt > before.weekEndsAt, "the replacement has a fresh full deadline");

    await env.pic.tick(12);
    assert.equal(Number((await env.live()).week), 2, "a stale callback cannot close the replacement");
  });

  it("keeps going, week after week, unattended", async () => {
    for (const expected of [3, 4, 5, 6]) {
      await env.advance(WEEK);
      const season = await env.live();
      assert.equal(Number(season.week), expected);
      assert.equal(phaseOf(season), "running");
    }
  });

  it("finishes the season and then arms nothing", async () => {
    await env.advance(WEEK);

    assert.equal(await env.live(), null, "no season should be running");
    const [season] = await env.actor.season_by_number(1n);
    assert.equal(phaseOf(season), "finished");
    assert.equal(
      await env.actor.clock_armed(),
      false,
      "a finished season should cost nothing to keep",
    );
    assert.deepEqual(await env.actor.week_ends_at(), []);

    // The end of a season is not an event that returns anything to anybody.
    // There is no grace period and no hand-over to wait out, because nothing
    // was ever held in trust by an external controller: the self-only list is
    // where this canister arrived on its first day, and the only thing finishing changes is that no timer is
    // armed. Checked here because "for the length of a season" would be a much
    // weaker claim than the one the site makes, and they look the same until
    // the final whistle.
    assert.deepEqual(
      await controllersOf(env),
      [env.canisterId.toText()],
      "still self-controlled after finishing",
    );
    assert.equal(await env.actor.am_moderator(), false, "and the installer is still nobody");
  });

  it("has nothing left to do, and no way to be given more", async () => {
    // The refusal outlives the season that caused it. `Season.create` refuses
    // on the *existence* of a row, not on one being live, so a finished
    // canister is as closed to a new season as a running one was — and this is
    // the reason the rule is worth having. The season above is now a sealed
    // record with no external controllers and no moderator's ordinary route back in, so the
    // people who run next season cannot restage this one's results, whatever
    // anybody decides later.
    const next = await mod.create_season();
    assert.match(next.err?.Invalid ?? "", /already has one/, "not even now it is over");

    assert.equal(await env.actor.clock_armed(), false, "so nothing is armed again");
    assert.deepEqual(await env.actor.week_ends_at(), []);
    assert.deepEqual(
      await controllersOf(env),
      [env.canisterId.toText()],
      "and it is still self-controlled",
    );
  });
});

describe("what the seal costs", () => {
  let env;

  before(async () => {
    env = await bootstrap();
  });

  after(async () => {
    await env?.teardown();
  });

  it("upgrades right up until the moment it is sealed, and never again", async () => {
    // The replica rate-limits `install_code` on the instructions recently spent
    // installing, and the fixture's own install has just spent them — so a
    // second one straight away is refused for a reason that has nothing to do
    // with anything here. A day of clock is enough for that budget to refill.
    await env.advance(DAY);

    // The control. Without it the refusal below could just as well be a broken
    // sender, a bad wasm path or that same rate limit, and the test would pass
    // while proving nothing.
    await env.upgrade();
    assert.equal(await env.actor.clock_armed(), false, "no season, so nothing to rebuild");

    const mod = await register(env.as, identity(149), "seal_cost_mod");
    ok(await env.actor.set_moderator("seal_cost_mod", true, []), "appoint launch moderator");
    ok(await mod.create_season(), "create launch draft");
    await env.prepareLaunch();
    ok(await env.actor.seal_canister(), "seal");
    assert.deepEqual(await controllersOf(env), [env.canisterId.toText()]);

    // `install_code` is controller-gated and the installer is no longer a
    // controller. Whatever is installed is not replaceable by that external
    // identity while the canister remains sealed.
    //
    // Matched on the error code rather than on prose, because the one wrong
    // answer this test must never accept is the rate limit above wearing the
    // seal's clothes.
    await assert.rejects(
      () => env.upgrade(),
      /CanisterInvalidController/,
      "the former installer cannot upgrade a sealed canister",
    );
  });

  it("cannot be stopped, or given a controller back", async () => {
    const holder = env.controller.getPrincipal();

    // Stopping is how you would park a canister in a state you could then
    // reinstall from, so it is worth pinning that that door is shut too. The
    // replica's refusal prints the list it checked the sender against, and
    // what it prints is nothing.
    await assert.rejects(
      () => env.pic.stopCanister({ canisterId: env.canisterId, sender: holder }),
      /Only (?:the )?controllers/,
      "the installer cannot stop it",
    );

    // And the obvious way out is closed by construction rather than by a
    // check: the former installer cannot add themselves to the exact self-only
    // list. This is the assertion the arrangement rests on.
    await assert.rejects(
      () =>
        env.pic.updateCanisterSettings({
          canisterId: env.canisterId,
          sender: holder,
          controllers: [holder],
        }),
      /CanisterInvalidController/,
      "and cannot write themselves back in",
    );

    assert.deepEqual(
      await controllersOf(env),
      [env.canisterId.toText()],
      "so the list is still exactly self-only",
    );
    // It still answers, which is the part that makes the seal checkable rather
    // than merely claimed: the interface spec exempts a canister asking about
    // itself, so `canister_status` keeps working with nobody in the list.
    assert.equal(await env.actor.clock_armed(), false, "and it is still alive and serving");
  });
});

describe("many judges", () => {
  let env;
  let mod;
  let mod2;

  before(async () => {
    env = await bootstrap();

    // Two moderators, seated before the seal, because `set_moderator` is
    // controller-only and the seal is about to remove every external
    // controller. Everything below that needs an authority needs one of these
    // two: once the list is self-only the installer cannot stand in for a
    // moderator either.
    mod = await register(env.as, identity(150), "clockmod");
    ok(await env.actor.set_moderator("clockmod", true, []), "appoint a moderator");
    mod2 = await register(env.as, identity(151), "clockmod2");
    ok(await env.actor.set_moderator("clockmod2", true, []), "appoint the second");

  });

  after(async () => {
    await env?.teardown();
  });

  it("runs a week with a real cast and closes it on time", async () => {
    const HACKERS = 12;
    const JUDGES = 8;

    // Approving a judge takes two moderators: one `#approved` is recorded and
    // answers `#NeedsSecond` with the tally, the second applies it. The escape
    // hatch in `Moderation.quorum` — a controller with no profile row applies
    // alone — is used only during launch setup. Once this fully staffed draft
    // passes readiness and is sealed, there is no external ingress controller
    // able to use it.
    const judges = [];
    for (let i = 0; i < JUDGES; i += 1) {
      const who = identity(100 + i);
      const actor = await register(env.as, who, `judge_${i}`);
      ok(await actor.apply_as_judge(), "apply");
      assert.deepEqual(
        await mod.set_judge(`judge_${i}`, { approved: null }, []),
        NEEDS_SECOND,
        `judge_${i}: one moderator is not enough`,
      );
      ok(await mod2.set_judge(`judge_${i}`, { approved: null }, []), "approve");
      judges.push(actor);
    }

    // Somewhere to be paid comes before there is anything to pay for: an entry
    // from an account with no reward wallet is refused with `#NoWallet`. The
    // `hacker` helper registers — one acceptance, at registration, covering
    // every role a person later takes — sets a wallet distinct from the signing
    // principal, and sets the role. Registration closes when the season opens,
    // so the cast has to be complete before the next two lines.
    const hackers = [];
    for (let i = 0; i < HACKERS; i += 1) {
      const actor = await hacker(env, 200 + i, `hacker_${i}`);
      hackers.push({ actor, id: (await actor.me())[0].id });
    }

    const draft = ok(await mod.create_season(), "a moderator drafts");
    ok(await env.seal(), "seal the canister");
    const season = ok(await mod.start_season(draft.id), "and starts it, the canister being sealed");

    for (const [i, { actor, id }] of hackers.entries()) {
      const key = `/u/${id}/pkg/1.neutron`;
      ok(await actor.my_upload(pkgUpload(key)), "upload package");
      const rev = ok(
        await actor.submit_entry({
          title: `App ${i}`,
          summary: "",
          url: "",
          icon: [],
          shots: [],
          links: [],
          pkg: { key },
          // The id the download is named after: chosen here, and the same on
          // every later edit of this entry.
          slug: slugFor(i),
        }),
        "submit",
      );
      // Nothing reaches the bracket until a moderator agrees, and it has to be
      // a real one: the canister is sealed, so the installer is not an implicit
      // moderator any more. Pinned once, on the first entry, because a
      // regression here would put "the rules did not change once the entries
      // were in" straight back on trust.
      if (i === 0) {
        assert.deepEqual(
          await env.actor.approve_revision(rev.id),
          { err: { NotAllowed: null } },
          "the installer cannot approve its way into a sealed season",
        );
      }
      ok(await mod.approve_revision(rev.id), "approve");
    }

    const entries = await env.actor.season_week_view(season.id, season.week, 50n);
    assert.equal(entries.length, HACKERS);

    // Every judge backs the first two apps, so the ranking is unambiguous.
    for (const judge of judges) {
      ok(await judge.cast_vote(entries[0].entry.id), "vote");
      ok(await judge.cast_vote(entries[1].entry.id), "vote");
    }

    await env.advance(WEEK + DAY);

    const after = await env.live();
    assert.equal(Number(after.week), 2, "the week should have closed on its own");

    const closed = await env.actor.season_week_view(season.id, 1n, 50n);
    const rewarded = closed.filter(
      (view) => Object.keys(view.entry.outcome)[0] !== "none",
    );
    assert.equal(rewarded.length, 5, "top five, of twelve");

    const advanced = closed.filter(
      (view) => Object.keys(view.entry.outcome)[0] === "advanced",
    );
    assert.equal(advanced.length, 1);
    assert.equal(Number(advanced[0].entry.votes), JUDGES);

    // And the winner was carried into the semi-final, unattended.
    const semi = await env.actor.season_week_view(season.id, 5n, 50n);
    assert.equal(semi.length, 1);
    assert.equal(semi[0].entry.title, advanced[0].entry.title);
  });
});
