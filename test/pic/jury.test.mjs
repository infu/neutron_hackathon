/**
 * The judge freeze.
 *
 * the Roles section of the Rules page calls it "the single most important integrity rule in the
 * format": the set of people who decide the outcome is fixed before any entry
 * is seen. It is enforced on the write path — `set_judge` refuses with
 * `JudgesFrozen` from the instant a season starts for the rest of this
 * one-season canister's life — so the
 * only way to know it holds is to drive the real interface for six weeks and
 * try every way round it.
 *
 * These tests are about *when* the judges become immutable, which makes them
 * the pic suite's business rather than `ash`'s: the clock starts the freeze,
 * and neither the clock nor a finished payout ever thaws it.
 *
 * ## The canister is sealed before any season
 *
 * `seal_canister()` removes every external controller and leaves exactly the
 * canister itself as controller. The freeze says the rules cannot change once
 * entries are in; `start_season` checks that exact self-only state on the way
 * in rather than trusting that somebody ran the right script.
 *
 * It reaches every fixture here. `Profiles.canModerate` treats a controller as
 * an implicit moderator, so from the seal on the identity that installed this
 * canister is nobody at all — no `set_judge`, no `approve_revision`, no
 * `set_moderator`, no `moderation_log`, no `create_season`, and no upgrade.
 * Every fixture below therefore
 * runs in the same order a real deployment must — appoint real moderators,
 * finish the roster, close registration, create the draft, and only then seal
 * and start the season *as a moderator*, which is the one authority the seal
 * leaves standing.
 *
 * Identities 1400-1599.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  bootstrap,
  closeWeek,
  hacker as newHacker,
  identity,
  ok,
  phaseOf,
  register,
  sponsorTarget,
  walletFor,
  DAY,
  WEEK,
} from "./harness.mjs";

const FROZEN = { err: { JudgesFrozen: null } };
/**
 * One moderator's approval — of a judge or of a sponsor — recorded but not
 * applied, with the tally that says how far off it is. See `approveJudge`.
 */
const NEEDS_SECOND = { err: { NeedsSecond: { votes: 1n, needed: 2n } } };
/** What every controller-gated method answers the former installer after sealing. */
const NO_CONTROLLER = { err: "caller is not a controller" };
const entry = (title, pkg, slug) => ({
  title,
  summary: "",
  url: "",
  icon: [],
  shots: [],
  links: [],
  pkg,
  // The app's permanent id: 5-50 characters of `a-z` and `_`, unique across
  // hackers, and refused if it ever changes. Every caller below derives it
  // from the handle so no two can collide, and so a re-entry in a later week
  // hands back exactly what was stored the first time.
  slug,
});
const statusOf = (user) => Object.keys(user.judgeStatus)[0];

/**
 * Upload a `.neutron` build into somebody's own namespace and hand back the
 * key to name it by.
 *
 * An entry must carry a package, and `Season.checkEntry` asks the asset store
 * how big the file at that key is — a key with nothing finished behind it is
 * refused. So a submission has to be preceded by a real upload; naming a path
 * is not enough. The namespace is keyed on the canister-assigned user id,
 * which is why this reads `me()` rather than using the handle.
 *
 * `my_upload` is the hacker's own door, not `assets_upload` — it survives the
 * seal, which is why a fixture may still build mid-season.
 */
async function build(actor, n = 1) {
  const [user] = await actor.me();
  assert.ok(user, "the uploader has to be registered to own a namespace");
  const key = `/u/${user.id}/pkg/${n}.neutron`;
  ok(
    await actor.my_upload({
      store: {
        key,
        content: new Uint8Array(512),
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
 * Get an app into the bracket the way an app now gets there: propose it, then
 * have a moderator apply it.
 *
 * `submit_entry` no longer writes to the bracket — it returns a `#pending`
 * revision that nothing can see until `approve_revision`. Every test below
 * that needs something to vote on therefore has to go the whole way, and `by`
 * has to be a real moderator: `approve_revision` is `canModerate`-gated, and
 * on a sealed canister the identity that installed it is not a moderator,
 * because it is not a controller and nothing ever made it one. Every caller
 * passes somebody appointed before the seal.
 */
async function enter(by, actor, title, pkg, slug) {
  const revision = ok(await actor.submit_entry(entry(title, pkg, slug)), `submit ${title}`);
  const applied = ok(await by.approve_revision(revision.id), `approve ${title}`);
  // `Review.approve` settles a stale revision `#expired` and still answers
  // `#ok`, so unwrapping it proves nothing about the bracket. Before review
  // existed, `submit_entry` wrote the row itself and `ok()` was proof that it
  // had; say the same thing here rather than letting a silent no-op surface as
  // a confusing failure three assertions later.
  assert.equal(Object.keys(applied.state)[0], "approved", `${title} should have been applied`);
  return revision;
}

/**
 * Put somebody on the judges the way it now has to be done: two moderators.
 *
 * `Moderation.SECONDS_NEEDED` is 2. One moderator's `#approved` is *recorded*
 * rather than applied and comes back as `#NeedsSecond` carrying the tally, so
 * the UI can say "1 of 2"; the second, from a different moderator, applies it
 * and is the call that writes the audit row. The first refusal is asserted
 * rather than shrugged off, because a canister that quietly approved on one
 * signature would sail through every freeze test below.
 *
 * Only approving is doubled. Rejecting, resetting and revoking stay
 * single-moderator and go through `set_judge` directly — the reversible
 * direction should not need a quorum.
 *
 * `Moderation.quorum` still lets a raw controller — one with no profile row and
 * so no vote to cast — apply alone. That hatch shuts for the former installer
 * at the seal. The one
 * `env.actor.set_judge` left in this file is on the near side of that line and
 * says so.
 */
async function approveJudge([first, second], handle, note = []) {
  assert.deepEqual(
    await first.set_judge(handle, { approved: null }, note),
    NEEDS_SECOND,
    `${handle}: one moderator is not enough`,
  );
  return ok(await second.set_judge(handle, { approved: null }, note), `approve ${handle}`);
}

/** `profile` returns an `opt User`; a missing handle is `[]`. */
async function judgeStatus(env, handle) {
  const [user] = await env.actor.profile(handle);
  assert.ok(user, `${handle} should be registered`);
  return statusOf(user);
}

/**
 * The approved judges, by handle, read the way the app lists it — through the
 * `#judges` filter rather than one profile row at a time.
 */
async function judges(env) {
  const page = await env.actor.users_page({ judges: null }, [], [], 50n);
  return page.rows.map((user) => user.handle);
}

/**
 * Who holds the keys to this canister, as sorted text, read directly from
 * PocketIC's replica state. Sorted because the replica's ordering is not ours
 * to depend on.
 */
async function keyholders(env) {
  const held = await env.pic.getControllers(env.canisterId);
  return held.map((who) => who.toText()).sort();
}

/** The two the harness installs with: a human, and the canister itself. */
const installedWith = (env) =>
  [env.canisterId.toText(), env.controller.getPrincipal().toText()].sort();

/**
 * Sealed: exactly the canister itself, with no external controller.
 */
const SELF_ONLY = (env) => [env.canisterId.toText()];

/**
 * The point of no return, checked rather than assumed.
 *
 * Every fixture calls this exactly once, after the launch roster and draft are
 * complete. The result is asserted here
 * rather than in each caller because a seal that silently did nothing would
 * surface far away, as `start_season` refusing with `#Invalid` for a reason
 * nobody reads.
 */
async function seal(env) {
  ok(await env.seal(), "seal the canister");
  assert.deepEqual(await keyholders(env), SELF_ONLY(env), "self-only before anything starts");
}

describe("sponsor approvals bind to one exact application generation", () => {
  it("drops an old vote and rejects its stale target after a same-clock edit", async () => {
    const env = await bootstrap();
    try {
      const first = await register(env.as, identity(1490), "stale_mod_one");
      const second = await register(env.as, identity(1491), "stale_mod_two");
      const sponsor = await register(env.as, identity(1492), "stale_sponsor");
      ok(await env.actor.set_moderator("stale_mod_one", true, []), "appoint first moderator");
      ok(await env.actor.set_moderator("stale_mod_two", true, []), "appoint second moderator");

      const application = (blurb) => ({
        org: "Generation Labs",
        website: "https://generation.example",
        logo: [],
        blurb,
        ledgers: [{ id: env.launchLedger, sns: false }],
      });
      ok(await sponsor.apply_as_sponsor(application("The application first reviewed.")), "apply");

      const [pending] = await env.actor.profile("stale_sponsor");
      assert.ok(pending, "the pending sponsor should be public");
      const stale = sponsorTarget(pending);
      assert.deepEqual(
        await first.set_sponsor(stale, { approved: null }, []),
        NEEDS_SECOND,
        "the first moderator should only record backing",
      );

      let [[subject, backing]] = await first.approval_tallies(
        { sponsor: null },
        [pending.id],
      );
      assert.equal(subject, pending.id);
      assert.equal(backing.votes, 1n);
      assert.equal(backing.mine, true);

      const oversized = await sponsor.apply_as_sponsor({
        ...application("This oversized edit must stop before the allowlist scan."),
        ledgers: [
          ...Array.from({ length: 7 }, () => ({ id: env.launchLedger, sns: false })),
          { id: identity(1493).getPrincipal(), sns: false },
        ],
      });
      assert.deepEqual(
        oversized,
        { err: { Invalid: "too many ledgers" } },
        "the seven-ledger shape limit runs before allowlist membership checks",
      );
      [[subject, backing]] = await first.approval_tallies({ sponsor: null }, [pending.id]);
      assert.equal(backing.votes, 1n, "an oversized edit keeps the reviewed application backing");
      assert.equal(backing.mine, true);
      const [afterOversized] = await env.actor.profile("stale_sponsor");
      assert.ok(afterOversized, "the oversized edit keeps the sponsor profile");
      assert.equal(afterOversized.updatedAt, pending.updatedAt, "an oversized edit mutates no profile");

      const invalid = await sponsor.apply_as_sponsor({
        ...application("This invalid edit must not consume review backing."),
        org: "x".repeat(81),
      });
      assert.ok(
        "err" in invalid && "Invalid" in invalid.err,
        "invalid pending edits return their typed validation error",
      );
      [[subject, backing]] = await first.approval_tallies({ sponsor: null }, [pending.id]);
      assert.equal(backing.votes, 1n, "an invalid edit keeps the reviewed application backing");
      assert.equal(backing.mine, true);
      const [afterInvalid] = await env.actor.profile("stale_sponsor");
      assert.ok(afterInvalid, "the invalid edit keeps the sponsor profile");
      assert.equal(afterInvalid.updatedAt, pending.updatedAt, "an invalid edit mutates no profile");

      const heldTime = await env.pic.getTime();
      const edited = ok(
        await sponsor.apply_as_sponsor(application("The edited application moderators must review.")),
        "edit pending application",
      );
      assert.equal(
        await env.pic.getTime(),
        heldTime,
        "the generation must advance even when PocketIC time does not",
      );
      assert.ok(edited.updatedAt > stale.expectedUpdatedAt, "the edit advances the generation");

      [[subject, backing]] = await first.approval_tallies({ sponsor: null }, [pending.id]);
      assert.equal(subject, pending.id);
      assert.equal(backing.votes, 0n, "editing clears the old application's backing");
      assert.equal(backing.mine, false);

      assert.deepEqual(
        await second.set_sponsor(stale, { approved: null }, []),
        {
          err: {
            Invalid: "the account or application changed; refresh and try again",
          },
        },
        "the old UI snapshot cannot vote for the replacement application",
      );
      const [afterStale] = await env.actor.profile("stale_sponsor");
      assert.ok(afterStale);
      assert.equal(Object.keys(afterStale.sponsorStatus)[0], "pending");
      assert.equal(afterStale.updatedAt, edited.updatedAt, "the stale call mutates no user state");
      assert.equal(
        afterStale.sponsor[0].blurb,
        "The edited application moderators must review.",
      );
      [, backing] = (await second.approval_tallies({ sponsor: null }, [pending.id]))[0];
      assert.equal(backing.votes, 0n, "the stale call records no approval backing");
      assert.equal(backing.mine, false);

      const fresh = sponsorTarget(afterStale);
      assert.deepEqual(
        await first.set_sponsor(fresh, { approved: null }, []),
        NEEDS_SECOND,
        "the replacement application starts a fresh quorum",
      );
      const approved = ok(
        await second.set_sponsor(fresh, { approved: null }, []),
        "approve the replacement application",
      );
      assert.equal(Object.keys(approved.sponsorStatus)[0], "approved");
      assert.equal(
        approved.sponsor[0].blurb,
        "The edited application moderators must review.",
      );
    } finally {
      await env.teardown();
    }
  });
});

describe("the judges before a season, and the seal that lets one start", () => {
  let env;
  let mod;
  let mod2;
  let draft;

  before(async () => {
    env = await bootstrap();
    mod = await register(env.as, identity(1400), "gapmod");
    ok(await env.actor.set_moderator("gapmod", true, []), "appoint moderator");
    // A second one, because putting anybody on the judges now takes two — see
    // `approveJudge`. Appointed here so the four transitions below are the
    // only thing the first test does.
    mod2 = await register(env.as, identity(1403), "gapmod2");
    ok(await env.actor.set_moderator("gapmod2", true, []), "appoint the second moderator");
    await register(env.as, identity(1401), "gapjudge");
    ok(await env.as(identity(1401)).apply_as_judge(), "apply");
  });

  after(async () => {
    await env?.teardown();
  });

  it("is not frozen before any season exists", async () => {
    assert.equal(await env.actor.judges_frozen(), false);
    assert.equal(await env.live(), null);
  });

  it("holds the keys it was installed with until it is sealed", async () => {
    // The baseline every assertion after the seal is read against: an ordinary
    // canister with an ordinary human controller, who is an implicit moderator
    // by `Profiles.canModerate`. The canister is in the set too — the harness
    // does that once, the way a human does it once by hand on a real
    // deployment, because `update_settings` has no self-exemption and a
    // canister that is not already a controller cannot empty its own list.
    assert.deepEqual(await keyholders(env), installedWith(env));
    assert.equal(await env.actor.is_controller(), true);
    assert.equal(await env.actor.am_moderator(), true, "a controller moderates while it is one");
  });

  it("lets moderators walk a judge through every status", async () => {
    // Approve, reset, revoke, re-approve. All four transitions are the ones
    // §2 names as blocked once a season starts, so all four have to work here
    // or the freeze tests below prove nothing.
    //
    // Approving takes two moderators and the other three take one, so this
    // also pins the asymmetry: the re-approve at the end has to find a second
    // signature again, because dropping out of `#approved` throws the earlier
    // votes away rather than leaving them banked.
    assert.equal(await judgeStatus(env, "gapjudge"), "pending");

    await approveJudge([mod, mod2], "gapjudge");
    assert.equal(await judgeStatus(env, "gapjudge"), "approved");

    ok(await mod.set_judge("gapjudge", { pending: null }, []), "reset");
    assert.equal(await judgeStatus(env, "gapjudge"), "pending");

    ok(await mod.set_judge("gapjudge", { no: null }, ["not this time"]), "reject");
    assert.equal(await judgeStatus(env, "gapjudge"), "no");

    await approveJudge([mod, mod2], "gapjudge");
    assert.equal(await judgeStatus(env, "gapjudge"), "approved");
  });

  it("writes every successful judges change into the audit log", async () => {
    // §2's positive half: the freeze does not remove the record, it stops the
    // writes — "the audit log still records every attempt that succeeded
    // before the freeze". Asserting only that a *refused* call leaves the
    // total alone (below) would also hold if nothing were ever logged.
    const page = await env.actor.moderation_log([], 25n);
    assert.equal(page.total, 6n, "two moderator grants plus four judges changes");

    // Four judge rows, not six: a held first approval is not an action. It
    // records a vote in the approvals table and returns before the writer, so
    // the log holds one row per *change*, naming the moderator who completed
    // it — which is what "who did what" has to mean once two people did it.
    //
    // Newest first. `#no` reached from `#pending` is a rejection, not a
    // revocation, and the two must not read the same in the history.
    assert.deepEqual(
      page.rows.map((row) => Object.keys(row.kind)[0]),
      [
        "judge_approved",
        "judge_rejected",
        "judge_reset",
        "judge_approved",
        "moderator_granted",
        "moderator_granted",
      ],
    );
    assert.deepEqual(
      page.rows.map((row) => row.subject[0]),
      ["gapjudge", "gapjudge", "gapjudge", "gapjudge", "gapmod2", "gapmod"],
    );
  });

  it("answers NoChange and NotRegistered while nothing is frozen", async () => {
    // The other half of "refuses before it looks anything up" in the next
    // suite. Without this baseline that test would pass on a canister that
    // answered `JudgesFrozen` to every unknown handle at every moment — it only
    // ever observes the frozen side.
    //
    // These also sit *above* the quorum: approving somebody already approved
    // is `NoChange` rather than `NeedsSecond`, and an unknown handle is
    // `NotRegistered` rather than a vote banked against a subject that does
    // not exist.
    assert.equal(await env.actor.judges_frozen(), false);
    assert.deepEqual(await mod.set_judge("gapjudge", { approved: null }, []), {
      err: { NoChange: null },
    });
    assert.deepEqual(await mod.set_judge("nosuchperson", { approved: null }, []), {
      err: { NotRegistered: null },
    });
  });

  it("still allows judges changes while a season is only a draft", async () => {
    // the Season section of the Rules page: "Until it is started it is a draft ... the judges can still
    // be changed." `season()` returns that draft, which is exactly why the
    // freeze reads `season_running()` instead.
    //
    // Drafted by a moderator, and drafted here rather than in `before` so the
    // suite reads in the order a deployment happens: the roster is arranged
    // while there are still controllers, and everything from `create_season`
    // on is a moderator's work.
    draft = ok(await mod.create_season(), "create");
    const [newest] = await env.actor.season();
    assert.equal(newest.id, draft.id);
    assert.equal(phaseOf(newest), "draft");

    assert.equal(await env.actor.judges_frozen(), false, "a draft freezes nothing");
    ok(await mod.set_judge("gapjudge", { pending: null }, []), "reset under a draft");
    assert.equal(await judgeStatus(env, "gapjudge"), "pending");
  });

  it("refuses a judges change from somebody who is not a moderator", async () => {
    const nobody = await register(env.as, identity(1402), "gapnobody");
    assert.deepEqual(await nobody.set_judge("gapjudge", { approved: null }, []), {
      err: { NotAllowed: null },
    });
  });

  it("refuses to start a season while anybody still holds the keys", async () => {
    // The seal is checked on the write path, on every start, rather than
    // assumed. A season that opened while a human still held the keys would
    // look identical from outside to one whose rules cannot be rewritten
    // halfway through — and telling those two apart is the entire point.
    const refused = await mod.start_season(draft.id);
    assert.ok(
      "err" in refused && "Invalid" in refused.err,
      `expected #Invalid, got ${JSON.stringify(refused)}`,
    );
    assert.match(refused.err.Invalid, /seal_canister/, "and it names the way through");

    assert.deepEqual(await keyholders(env), installedWith(env), "the attempt sealed nothing");
    assert.equal(await env.actor.judges_frozen(), false, "and started nothing");
    assert.equal(phaseOf((await env.actor.season())[0]), "draft");
  });

  it("leaves exactly self as controller, and the installer keeps nothing", async () => {
    await seal(env);

    // `canModerate` reads `Principal.isController` first, so the identity that
    // installed this canister stops being an implicit moderator in the same
    // message. There is no later window in which it is one again — that is
    // what "no way back" means here, and it is why every fixture in this file
    // appoints its moderators before this point.
    assert.equal(await env.actor.is_controller(), false, "the installer is not a controller now");
    assert.equal(await env.actor.am_moderator(), false, "so the implicit gavel is gone");

    // Every controller-gated door, shut permanently: the roster, the site
    // config, the instruction allowance, the frontend itself.
    assert.deepEqual(await env.actor.set_moderator("gapnobody", true, []), {
      err: { NotAllowed: null },
    });
    assert.deepEqual(await env.actor.set_config("Renamed", true), NO_CONTROLLER);
    assert.deepEqual(await env.actor.set_instruction_cap(1n), NO_CONTROLLER);
    assert.deepEqual(
      await env.actor.assets_upload({
        store: {
          key: "/index.html",
          content: new Uint8Array(1),
          contentType: "text/html",
          contentEncoding: "identity",
          chunks: 1n,
        },
      }),
      NO_CONTROLLER,
      "the site is what it is now",
    );
    // Including `seal_canister` itself. It is idempotent in `Controllers`, but
    // nobody can reach it to find that out.
    assert.deepEqual(await env.actor.seal_canister(), NO_CONTROLLER);

    // And no new code. Not "not while a season runs" — at all, for the rest of
    // the canister's life, which is the claim the whole arrangement rests on.
    await assert.rejects(env.upgrade(), /CanisterInvalidController/, "the code is final");

    // Sealing is not starting: the draft is still a draft. It is nevertheless
    // the point of no return, so launch-sensitive writes are latched shut as
    // soon as the irreversible management call begins.
    assert.equal(await env.actor.judges_frozen(), false);
    const locked = { err: { Invalid: "launch configuration is frozen because canister sealing has begun" } };
    assert.deepEqual(await mod.set_judge("gapjudge", { no: null }, []), locked);
    assert.equal(await judgeStatus(env, "gapjudge"), "no", "readiness settled the pending application");
  });

  it("lets a moderator start the season the installer no longer can", async () => {
    // The gate had to move, and this is why: a controller-gated start would be
    // a gate no ingress caller could pass, since the list has to be exactly
    // self-only before a start is allowed. The authority that survives sealing is the one the
    // installed code grants, and a moderator appointed beforehand is it.
    // the canonical agreement on the Rules page is explicit that this buys them nothing else — "triggering
    // `start` after the canister confirms that it is sealed is a limited
    // protocol action and gives the moderator no control over the canister or
    // prize assets" — which the rest of this suite is the evidence for.
    assert.deepEqual(await env.actor.start_season(draft.id), { err: { NotAllowed: null } });
    assert.equal(await env.actor.judges_frozen(), false, "and nothing started");

    const started = ok(await mod.start_season(draft.id), "a moderator starts it");
    assert.equal(phaseOf(started), "running");
    assert.equal(Number(started.week), 1);
    assert.equal(await env.actor.judges_frozen(), true, "and the judge freezes behind them");
    assert.deepEqual(await mod.set_judge("gapjudge", { approved: null }, []), FROZEN);
    assert.deepEqual(await keyholders(env), SELF_ONLY(env), "on a self-controlled canister");
  });
});

describe("the freeze while a season runs", () => {
  let env;
  let mod;
  let mod2;
  let mod3;
  let approved;
  let season;
  let launchJudges;

  before(async () => {
    env = await bootstrap();

    mod = await register(env.as, identity(1410), "runmod");
    ok(await env.actor.set_moderator("runmod", true, []), "appoint moderator");
    // The second signature every approval now needs, here and for the sponsor
    // below. Appointed before the seal: this suite is about what the freeze
    // blocks, not about who is allowed to vote.
    mod2 = await register(env.as, identity(1419), "runmod2");
    ok(await env.actor.set_moderator("runmod2", true, []), "appoint the second moderator");
    // A third, seated now because there is no seating anybody later at all:
    // `set_moderator` is controller-only and the seal below is the last moment
    // a controller exists. Used to show that a gavel held since before the
    // entries arrived still reaches nothing on the judges.
    mod3 = await register(env.as, identity(1417), "runmod3");
    ok(await env.actor.set_moderator("runmod3", true, []), "appoint the third moderator");

    // One judge in each of the three statuses, so every transition the freeze
    // is meant to block has a real starting point to be blocked from.
    approved = await register(env.as, identity(1411), "runapproved");
    ok(await approved.apply_as_judge(), "apply");
    await approveJudge([mod, mod2], "runapproved");
    // And the gavel, to a sitting judge, before the start. This used to be
    // done mid-season to show a fresh appointment bought no exemption; a
    // sealed canister has nobody who could make one at any point, so the dodge
    // is set up in advance instead — which is the harder case anyway. They
    // were already holding it when the field arrived.
    ok(await env.actor.set_moderator("runapproved", true, []), "give the judge the gavel");

    const pending = await register(env.as, identity(1412), "runpending");
    ok(await pending.apply_as_judge(), "apply");
    ok(await mod.set_judge("runpending", { no: null }, []), "settle before launch");

    const rejected = await register(env.as, identity(1413), "runrejected");
    ok(await rejected.apply_as_judge(), "apply");
    ok(await mod.set_judge("runrejected", { no: null }, []), "reject");

    // Registered before the start so the season only has to change one thing
    // at a time later on — and, since a season closes the doors behind it,
    // because there is no other moment they could sign up in. One acceptance
    // at registration covers every role they go on to take.
    await register(env.as, identity(1415), "runsponsor");
    await register(env.as, identity(1416), "runhacker");
    // These two are used mid-season below. They cannot register then: the
    // doors shut when the season opens, so the field is fixed for the run.
    // What they demonstrate is still mid-season behaviour — a stranger's
    // authority, and an application made after the freeze — because applying
    // to judge and casting a vote are both still reachable from here.
    await register(env.as, identity(1418), "runnobody");
    await register(env.as, identity(1414), "runlater");

    const draft = ok(await mod.create_season(), "create");
    // The point of no return, after the complete draft and roster exist.
    await seal(env);
    season = ok(await mod.start_season(draft.id), "start");
    launchJudges = await judges(env);
  });

  after(async () => {
    await env?.teardown();
  });

  it("freezes the judges at the moment the season starts", async () => {
    assert.equal(await env.actor.judges_frozen(), true);
    const live = await env.live();
    assert.equal(Number(live.week), 1);
    assert.equal(Number(live.id), Number(season.id));
  });

  it("runs on a canister with exactly itself as controller", async () => {
    // The freeze is a rule the code enforces; the exact self-only controller list is
    // what stops the code being replaced by code without it. Read from the
    // management canister, not from the season row: "only self controls this" is
    // a thing a participant can check for themselves, which is the entire
    // reason for doing it this way round.
    assert.deepEqual(await keyholders(env), SELF_ONLY(env), "the canister itself, and nobody else");

    // Nothing was borrowed, so there is nothing recorded to give back and no
    // date to publish. The season row does not remember a controller list
    // because there is no arrangement under which one returns — asserted
    // against the generated actor, because "the keys do not come back" is now
    // a structural property rather than a runtime one.
    assert.equal(env.actor.release_controllers, undefined, "no hand-back to ask for");
    assert.equal(env.actor.controllers_due_at, undefined, "and no date to wait out");
    assert.equal(season.controllers, undefined, "nor a list stashed on the season");
  });

  it("refuses an approval", async () => {
    assert.deepEqual(await mod.set_judge("runpending", { approved: null }, []), FROZEN);
    assert.equal(await judgeStatus(env, "runpending"), "no", "and changed nothing");
  });

  it("refuses a rejection", async () => {
    assert.deepEqual(await mod.set_judge("runpending", { no: null }, []), FROZEN);
    assert.equal(await judgeStatus(env, "runpending"), "no");
  });

  it("refuses a reset, from either direction", async () => {
    assert.deepEqual(await mod.set_judge("runapproved", { pending: null }, []), FROZEN);
    assert.equal(await judgeStatus(env, "runapproved"), "approved");

    // Putting a rejected applicant back in the queue is a judges change too:
    // do it mid-season and the only thing left is a second call to approve.
    assert.deepEqual(await mod.set_judge("runrejected", { pending: null }, []), FROZEN);
    assert.equal(await judgeStatus(env, "runrejected"), "no");
  });

  it("refuses a revocation", async () => {
    // The one that matters most: a moderator who can drop a judge mid-season
    // can decide the outcome by deciding who is left to vote.
    assert.deepEqual(await mod.set_judge("runapproved", { no: null }, []), FROZEN);
    assert.equal(await judgeStatus(env, "runapproved"), "approved");
  });

  it("locks the installer out altogether rather than exempting it", async () => {
    // This used to answer `JudgesFrozen`: `canModerate` treats a controller as a
    // moderator, so the identity that started the season reached the freeze
    // and was turned back by it — no owner's exemption.
    //
    // It is refused a step earlier now, and by a stronger rule. The canister
    // was sealed before the season could start, so the identity that installed
    // it is not a controller and not an implicit moderator either; `canModerate`
    // is simply false, and the answer is the one any stranger gets. It will
    // still be false after the season ends, and after the next one.
    assert.equal(await env.actor.is_controller(), false, "nobody holds the keys");
    assert.equal(await env.actor.am_moderator(), false, "so the implicit gavel is gone too");
    assert.deepEqual(await env.actor.set_judge("runpending", { approved: null }, []), {
      err: { NotAllowed: null },
    });
    assert.equal(await judgeStatus(env, "runpending"), "no", "and changed nothing");
  });

  it("refuses before it looks anything up, so nothing leaks", async () => {
    // A no-op change would answer `NoChange` and an unknown handle
    // `NotRegistered`; while frozen both answer `JudgesFrozen`, because the
    // freeze is checked first. That is the right order — a refused call should
    // not be a lookup oracle for who is on the judges.
    assert.deepEqual(await mod.set_judge("runapproved", { approved: null }, []), FROZEN);
    assert.deepEqual(await mod.set_judge("nosuchperson", { approved: null }, []), FROZEN);
  });

  it("still checks authority first: a stranger gets NotAllowed, not JudgesFrozen", async () => {
    const nobody = env.as(identity(1418));
    assert.deepEqual(await nobody.set_judge("runpending", { approved: null }, []), {
      err: { NotAllowed: null },
    });
  });

  it("records nothing in the audit log for a refused attempt", async () => {
    // §2: the log "still records every attempt that succeeded before the
    // freeze". A refusal never reaches the writer, so the total must not move.
    //
    // Read as a moderator, not as the identity that installed the canister:
    // `moderation_log` is `canModerate`-gated and answers a sealed canister's
    // ex-controller with an empty page, which would make this pass by counting
    // nothing twice.
    const before = (await mod.moderation_log([], 1n)).total;
    assert.deepEqual(await mod.set_judge("runpending", { approved: null }, []), FROZEN);
    const now = (await mod.moderation_log([], 1n)).total;
    assert.equal(now, before, "a refused judges change is not an action");
    assert.ok(before > 0n, "and there was a log to fail to move");
  });

  it("freezes sponsor applications and decisions at launch", async () => {
    const sponsor = env.as(identity(1415));
    assert.deepEqual(
      await sponsor.apply_as_sponsor({
        org: "Sponsor Ltd",
        blurb: "",
        website: "",
        logo: [],
        ledgers: [{ id: env.launchLedger, sns: false }],
      }),
      { err: { Settling: null } },
    );
    assert.equal(
      Object.keys((await env.actor.profile("runsponsor"))[0].sponsorStatus)[0],
      "no",
      "the refused application changed nothing",
    );
    assert.deepEqual(await mod.set_sponsor("runsponsor", { approved: null }, []), {
      err: { SponsorsFrozen: null },
    });
  });

  it("still lets somebody take the hacker role and enter", async () => {
    const hacker = env.as(identity(1416));
    // Straight to the role: `set_hacker` asks nothing further, because the one
    // acceptance at registration already covered it.
    ok(await hacker.set_hacker(true), "set_hacker mid-season");
    // A hacker cannot enter without somewhere to be paid (`#NoWallet`), and
    // naming one is self-service — the freeze reaches none of this.
    ok(await hacker.set_wallet(walletFor(1416)), "name a reward wallet mid-season");
    await enter(mod, hacker, "Mid-season entry", await build(hacker), "runhacker_app");
    assert.equal((await hacker.my_entry()).length, 1, "and it lands once reviewed");
  });

  it("fixes the moderator roster for good, alongside the judges", async () => {
    // This used to appoint somebody mid-season and show that a fresh gavel
    // bought them no way past the freeze. Nobody can be appointed now, or
    // through the ordinary flow: `set_moderator` is controller-only and there
    // is no external controller, so the roster is as fixed as the judges — and for a related reason, since
    // a moderator seated after the entries are in is one chosen by somebody
    // who already knows what they would be deciding.
    assert.deepEqual(await env.actor.set_moderator("runnobody", true, []), {
      err: { NotAllowed: null },
    });
    assert.equal(await env.as(identity(1418)).am_moderator(), false, "nobody was appointed");

    // The ones seated in time still hold it, and still reach nothing on the
    // judges: the freeze was never about when somebody was appointed.
    assert.equal(await mod3.am_moderator(), true);
    assert.deepEqual(await mod3.set_judge("runpending", { approved: null }, []), FROZEN);
  });

  it("refuses a sitting judge who also holds the gavel", async () => {
    // The nastiest shape of the dodge: somebody who is on the judges *and* a
    // moderator, picking their own company or stepping aside once they have
    // seen the field. The gavel was handed over before the seal — there has
    // been no controller since to hand one over — which makes this the sharper
    // version: they held it the whole time the entries were arriving.
    assert.equal(await approved.am_moderator(), true);
    assert.deepEqual(await approved.set_judge("runpending", { approved: null }, []), FROZEN);
    assert.deepEqual(await approved.set_judge("runapproved", { no: null }, []), FROZEN);
    assert.equal(await judgeStatus(env, "runapproved"), "approved");
  });

  it("refuses a mid-season judge application and leaves the caller voteless", async () => {
    const later = env.as(identity(1414));
    assert.deepEqual(await later.apply_as_judge(), { err: { Settling: null } });
    assert.equal(await judgeStatus(env, "runlater"), "no", "the refusal changed nothing");

    const queue = await env.actor.pending_judges(50n);
    assert.equal(
      queue.some((u) => u.handle === "runlater"),
      false,
      "the refused application did not enter the queue",
    );

    const [target] = await env.actor.season_week_view(
      (await env.live()).id,
      (await env.live()).week,
      50n,
    );
    assert.ok(target, "there is an entry to vote on");
    assert.deepEqual(await later.cast_vote(target.entry.id), { err: { NotAJudge: null } });
    assert.equal(await later.my_votes_left(), 0n);

    assert.deepEqual(await mod.set_judge("runlater", { approved: null }, []), FROZEN);
  });

  it("leaves the judges itself unchanged, not merely the handles sampled above", async () => {
    // Every test above reads one handle at a time through `profile`. The rule
    // in §2 is about the *set* of people who decide, so check the set — and
    // check it through the indexes the app actually lists the judges with, which
    // are a different read path from the row `profile` returns. An index that
    // drifted from the column would be invisible to a per-handle assertion.
    assert.deepEqual(await judges(env), launchJudges);
    assert.ok(launchJudges.includes("runapproved"), "the intended judge launched");
    assert.ok(!launchJudges.includes("runpending"), "the rejected applicant did not launch");
    assert.equal((await env.actor.stats()).judges, BigInt(launchJudges.length));
  });

  it("cannot be upgraded, during the season or after it", async () => {
    // This used to upgrade and check the freeze came straight back, because it
    // is derived from the season row rather than from anything transient. The
    // code cannot be replaced at all now: `install_code` answers the identity
    // that installed this canister `CanisterInvalidController`, because the
    // former installer is no longer on the controller list.
    //
    // That is the claim the seal exists to make, and it is stronger than the
    // one it replaces — "the rules did not change once the entries were in"
    // cannot rest on a freeze that whoever holds the keys could edit out
    // between two weeks and put back afterwards.
    await assert.rejects(env.upgrade(), /CanisterInvalidController/, "no new code, ever");

    // The refused ingress touched nothing, so the same season is still running
    // with the same judges under it.
    assert.equal(await env.actor.judges_frozen(), true);
    assert.deepEqual(await mod.set_judge("runpending", { approved: null }, []), FROZEN);
    assert.equal(await judgeStatus(env, "runapproved"), "approved");
    assert.deepEqual(await judges(env), launchJudges, "and the judges is where it was");
    assert.deepEqual(await keyholders(env), SELF_ONLY(env), "still self-controlled");
  });

  it("gives nobody a way to end the season early and thaw the judges", async () => {
    // A moderator who could close weeks could run the season out and then
    // change the judges. the Trust section of the Rules page: a moderator has no season controls that
    // touch the one that is running.
    //
    // `close_week` used to answer them `NotAllowed`; it is not in the
    // interface at all any more, so there is nothing to answer and nothing for
    // anybody else to reach for either — the calendar is the same for everyone
    // and only the clock moves it. Asserted against the generated actor rather
    // than dropped, because "a moderator cannot hand-close a week" is still
    // the property, now held structurally.
    assert.equal(mod.close_week, undefined, "no hand-cranked close for a moderator");
    assert.equal(env.actor.close_week, undefined, "nor for the identity that installed it");

    // Nor is there a next season to reach for instead. One canister, one
    // season: `Season.create` refuses on a season row *existing*, so the
    // roster frozen here is the only roster this canister will ever freeze,
    // and "sit the season out and seat your own judges for the next one" is
    // not a move that exists on this canister at all.
    const extra = await mod.create_season();
    assert.match(extra.err?.Invalid ?? "", /already has one/, "no next season to draft");
    // The identity that installed the canister does not get that far — it is
    // refused on standing, one gate earlier.
    assert.deepEqual(await env.actor.create_season(), { err: { NotAllowed: null } });
    // And the refusal really refused: `judgesFrozen` reads a *sparse* index of
    // running rows, so a `create` that answered `#err` while still inserting
    // would put a row where the freeze looks.
    assert.deepEqual(await env.actor.season_by_number(2n), [], "and wrote nothing");

    assert.equal(await env.actor.judges_frozen(), true);
    assert.equal(Number((await env.live()).id), Number(season.id), "the live one is unmoved");
    assert.deepEqual(await mod.set_judge("runpending", { approved: null }, []), FROZEN);
  });

  it("keeps the judge roster frozen after the season is finished", async () => {
    // Six deadlines, one at a time. Nobody closes a week here because nobody
    // can: the only way out of a running season is to let the clock reach the
    // end of it, and the week counter is checked before each one so a season
    // that skipped a week would fail here rather than merely finish early.
    for (let week = 1; week <= 6; week += 1) {
      assert.equal(Number((await env.live()).week), week);
      await closeWeek(env);
    }

    assert.equal(await env.live(), null);
    assert.equal(await env.actor.judges_frozen(), true);

    // The roster and controller list are both permanent records now. Neither
    // finishing the bracket nor reaching a terminal payout creates a new
    // authority that can rewrite who judged it.
    assert.deepEqual(await keyholders(env), SELF_ONLY(env), "still self-controlled afterwards");

    assert.deepEqual(await mod.set_judge("runpending", { approved: null }, []), FROZEN);
    assert.deepEqual(await mod.set_judge("runapproved", { no: null }, []), FROZEN);
    assert.equal(await judgeStatus(env, "runpending"), "no");
    assert.equal(await judgeStatus(env, "runapproved"), "approved");

    // Participant profile writes close permanently at the same terminal
    // boundary; an approved judge cannot edit the destination record either.
    assert.deepEqual(await approved.set_wallet(walletFor(1411)), { err: { Settling: null } });
  });
});

describe("a judge approved before the start votes all six weeks", () => {
  let env;
  let judge;
  let mod;
  let hackers;
  let builds;
  let season;

  // One permanent app id each. `sixhacker0` is a fine handle and an illegal
  // slug — digits are not in the alphabet — so these are lettered instead.
  // The same hacker enters four weeks running and has to hand back the id
  // they were given the first time, or the submission is refused.
  const appId = (i) => `sixhacker_${"abcd"[i]}`;

  before(async () => {
    env = await bootstrap();

    judge = await register(env.as, identity(1430), "sixjudge");
    ok(await judge.apply_as_judge(), "apply");
    // The controller, which has no profile row and so no vote to cast,
    // approves on its own — the second signature is asked of moderators, not
    // of somebody who could install a new canister instead. It has to happen
    // here: sealing shuts that hatch to the former deployer, because afterwards
    // it is no longer a controller.
    ok(await env.actor.set_judge("sixjudge", { approved: null }, []), "approve");

    // Somebody to apply the entries once the season is running, and to open it
    // in the first place. Appointed now because `set_moderator` is
    // controller-only and the seal below ends that for good.
    mod = await register(env.as, identity(1435), "sixmod");
    ok(await env.actor.set_moderator("sixmod", true, []), "appoint moderator");

    // Four, one per qualifier week. Each has to win a different week or the
    // semi is short: a hacker who wins two qualifiers reaches it once, for the
    // reason set out in the note at the foot of this file.
    hackers = [];
    builds = [];
    for (let i = 0; i < 4; i += 1) {
      // Registered, given a reward wallet and made a hacker in one go: without
      // the wallet every submission below would be `#NoWallet`.
      const actor = await newHacker(env, 1431 + i, `sixhacker${i}`);
      // One build each, uploaded once and named by every week's entry. The
      // asset is not consumed by a submission, only measured.
      builds.push(await build(actor));
      hackers.push(actor);
    }

    const draft = ok(await mod.create_season(), "create");
    await seal(env);
    season = ok(await mod.start_season(draft.id), "start");
  });

  after(async () => {
    await env?.teardown();
  });

  it("takes both votes in every one of the six weeks", async () => {
    let cast = 0;
    let limitRefused = 0;

    for (let week = 1; week <= 6; week += 1) {
      const live = await env.live();
      assert.equal(Number(live.week), week);
      assert.equal(await env.actor.judges_frozen(), true, `frozen in week ${week}`);
      // And unowned in every one of them, not merely at the start: the judges
      // the votes below come from is fixed *and* the code counting them cannot
      // be swapped between one week and the next by anybody.
      assert.deepEqual(await keyholders(env), SELF_ONLY(env), `self-only in week ${week}`);

      // Weeks 5 and 6 are carried forward, never submitted into (§3). A
      // different hacker submits first each week, and ties break to the
      // earliest entry (§5), so each qualifier sends a different winner on.
      //
      // Proposed and approved one at a time, in that order: review is what
      // now writes the row, so an entry takes its id — and with it its place
      // in the tie-break — when the moderator applies it, not when the hacker
      // asked. Approving the batch out of order would reshuffle the week.
      if (week <= 4) {
        for (let n = 0; n < hackers.length; n += 1) {
          const i = (n + week - 1) % hackers.length;
          await enter(mod, hackers[i], `Week ${week} app ${i}`, builds[i], appId(i));
        }
      }

      const rows = await env.actor.season_week_view(season.id, live.week, 50n);
      assert.ok(rows.length >= 2, `week ${week} should have two entries to choose between`);

      assert.equal(await judge.my_votes_left(), 2n, `two fresh votes in week ${week}`);
      ok(await judge.cast_vote(rows[0].entry.id), `vote a, week ${week}`);
      ok(await judge.cast_vote(rows[1].entry.id), `vote b, week ${week}`);
      cast += 2;
      assert.equal(await judge.my_votes_left(), 0n, `spent in week ${week}`);

      // A third is refused: two votes per judge per week (§4). Only possible
      // where a third entry exists — the final holds exactly two — and
      // `#AlreadyVoted` is checked before `#VoteLimit`, so re-using one of the
      // two would test a different rule. The count below keeps that skip
      // honest rather than letting it pass silently.
      if (rows.length > 2) {
        assert.deepEqual(await judge.cast_vote(rows[2].entry.id), {
          err: { VoteLimit: null },
        });
        limitRefused += 1;
      }

      await env.advance(WEEK + DAY);
    }

    assert.equal(limitRefused, 5, "the third vote was actually refused, in weeks 1-5");
    assert.equal(cast, 12, "two a week for six weeks");
    assert.equal(await env.live(), null, "and the season ran itself out");
    assert.equal(await env.actor.judges_frozen(), true, "the recorded roster stays frozen");
  });

  it("carried the bracket forward while it did so", async () => {
    // The semi and the final had entries to vote on because the closes carried
    // them, not because anybody submitted.
    const semi = await env.actor.season_week(season.id, 5n, 50n);
    const final = await env.actor.season_week(season.id, 6n, 50n);
    assert.equal(semi.length, 4, "one winner from each qualifier week");
    assert.equal(final.length, 2, "one survivor from each duel");
    assert.ok(final.every((row) => row.origin_id.length === 1), "both were carried");

    // The whole point of freezing the judges is that the judges which voted is the
    // judges which decided. Counting rows does not say that, so tie each carried
    // entry back to a ballot: every qualifier winner is an entry this one
    // frozen judge voted for, and the semi holds exactly those four.
    const winners = [];
    for (let week = 1; week <= 4; week += 1) {
      const rows = await env.actor.season_week(season.id, BigInt(week), 50n);
      const advanced = rows.filter((row) => Object.keys(row.outcome)[0] === "advanced");
      assert.equal(advanced.length, 1, `week ${week} sent exactly one`);
      assert.equal(advanced[0].votes, 1n, `week ${week}'s winner got there on a vote`);
      winners.push(advanced[0].id);
    }
    const byId = (a, b) => Number(a - b);
    assert.deepEqual(
      semi.map((row) => row.origin_id[0]).sort(byId),
      [...winners].sort(byId),
      "the semi is the four the judge voted up, and nobody else",
    );
  });
});

describe("the permanent freeze on the clock, day by day", () => {
  let env;
  let mod;

  before(async () => {
    env = await bootstrap();

    mod = await register(env.as, identity(1452), "daymod");
    ok(await env.actor.set_moderator("daymod", true, []), "appoint moderator");
    const mod2 = await register(env.as, identity(1454), "daymod2");
    ok(await env.actor.set_moderator("daymod2", true, []), "appoint the second moderator");

    await register(env.as, identity(1450), "daypending");
    ok(await env.as(identity(1450)).apply_as_judge(), "apply");
    ok(await mod.set_judge("daypending", { no: null }, []), "settle before launch");

    await register(env.as, identity(1451), "dayjudge");
    ok(await env.as(identity(1451)).apply_as_judge(), "apply");
    await approveJudge([mod, mod2], "dayjudge");

    const draft = ok(await mod.create_season(), "create");
    await seal(env);
    ok(await mod.start_season(draft.id), "start");
  });

  after(async () => {
    await env?.teardown();
  });

  it("stays frozen through every day of the season and after it", async () => {
    // Nobody closes anything here: the only thing that happens is the clock.
    // Each day the freeze flag and write path have to agree. The stored phase
    // is sampled separately so this proves that finishing the bracket does not
    // accidentally reopen its historical roster.
    let finishedOn = null;
    for (let day = 1; day <= 46; day += 1) {
      await env.advance(DAY);

      const [row] = await env.actor.season_by_number(1n);
      if (finishedOn === null && phaseOf(row) === "finished") {
        finishedOn = day;
      }
      assert.equal(await env.actor.judges_frozen(), true, `day ${day}: roster remains frozen`);
      assert.deepEqual(
        await mod.set_judge("daypending", { approved: null }, []),
        FROZEN,
        `day ${day}: the write path should refuse`,
      );
      assert.equal(await judgeStatus(env, "daypending"), "no");
    }

    // Thirty days: four qualifiers of a week each, then a semi-final and a
    // final of a day each (`Season.roundNanos`). The extra day of slack is
    // this loop's sampling, not drift — `weekEndsAt` is measured from the
    // *message* that opened the round, which PocketIC places a few nanoseconds
    // into its round, so a deadline can fall a hair beyond the day mark and be
    // caught on the next daily tick. The canister's own record below is the
    // exact claim.
    assert.ok(finishedOn === 30 || finishedOn === 31, `a whole season took ${finishedOn} days`);

    const [season] = await env.actor.season_by_number(1n);
    assert.equal(phaseOf(season), "finished");
    assert.ok(
      season.endedAt - season.startedAt >= BigInt(4 * WEEK + 2 * DAY) * 1_000_000n,
      "no round closed before its deadline",
    );
    assert.equal(await judgeStatus(env, "daypending"), "no");
    assert.deepEqual(
      await env.as(identity(1450)).update_profile({
        handle: "daypending",
        displayName: "too late",
        title: [],
        bio: "",
        links: [],
        terms: true,
      }),
      { err: { Settling: null } },
      "participant profile writes are permanently closed too",
    );
  });

  it("keeps a judge recorded after the season and never thaws again", async () => {
    assert.deepEqual(await mod.set_judge("dayjudge", { no: null }, ["stepping down"]), FROZEN);
    assert.equal(await judgeStatus(env, "dayjudge"), "approved");
    assert.equal(await env.actor.judges_frozen(), true);
    assert.deepEqual(await keyholders(env), SELF_ONLY(env), "and still self-controlled");

    // One canister, one season: there is no later draft whose roster needs to
    // differ, so this immutable set is the historical record of who judged.
    const next = await mod.create_season();
    assert.match(next.err?.Invalid ?? "", /already has one/, "no next season to freeze for");
    assert.equal(await env.actor.judges_frozen(), true, "the freeze is the last word");
  });
});

describe("ways round the freeze", () => {
  let env;
  let mod;
  let mod2;
  let season;

  before(async () => {
    env = await bootstrap();

    mod = await register(env.as, identity(1470), "dodgemod");
    ok(await env.actor.set_moderator("dodgemod", true, []), "appoint moderator");
    // Two of them, because an approval needs two signatures. Both are on the
    // outside of every dodge below: what is under test is what the *subject*
    // can do to their own status, not who can grant it.
    mod2 = await register(env.as, identity(1476), "dodgemod2");
    ok(await env.actor.set_moderator("dodgemod2", true, []), "appoint the second moderator");

    // Applied and rejected before the start.
    const rejected = await register(env.as, identity(1471), "dodgerejected");
    ok(await rejected.apply_as_judge(), "apply");
    ok(await mod.set_judge("dodgerejected", { no: null }, []), "reject");

    // An approved judge who will also take the hacker role.
    const both = await register(env.as, identity(1472), "dodgeboth");
    ok(await both.apply_as_judge(), "apply");
    await approveJudge([mod, mod2], "dodgeboth");

    const hacker = await newHacker(env, 1473, "dodgehacker");

    // An approved judge who will rename themselves mid-season.
    const renamer = await register(env.as, identity(1474), "dodgerenamer");
    ok(await renamer.apply_as_judge(), "apply");
    await approveJudge([mod, mod2], "dodgerenamer");

    // Registered before the start because the doors shut behind a season. The
    // application itself is attempted mid-season below, where the permanent
    // roster freeze must refuse it without changing the queue.
    await register(env.as, identity(1475), "dodgelate");

    const draft = ok(await mod.create_season(), "create");
    await seal(env);
    season = ok(await mod.start_season(draft.id), "start");
    // Applied by a moderator, not by the identity that installed the canister:
    // the seal took its implicit gavel along with the keys, for good.
    await enter(mod, hacker, "Dodge target", await build(hacker), "dodgehacker_app");
  });

  after(async () => {
    await env?.teardown();
  });

  it("a rejected applicant cannot re-apply after the roster freezes", async () => {
    const rejected = env.as(identity(1471));
    assert.deepEqual(await rejected.apply_as_judge(), { err: { Settling: null } });
    assert.equal(await judgeStatus(env, "dodgerejected"), "no");

    const [row] = await env.actor.season_week_view(season.id, season.week, 50n);
    assert.deepEqual(await rejected.cast_vote(row.entry.id), { err: { NotAJudge: null } });
    assert.deepEqual(await mod.set_judge("dodgerejected", { approved: null }, []), FROZEN);
  });

  it("an approved judge cannot shed the role from the inside either", async () => {
    // There is no `withdraw_judge`, so the question is whether any self-service
    // call resets the status as a side effect. The freeze fixes the judges in
    // both directions — a judge who could resign mid-season could change the
    // outcome as surely as one who could be appointed.
    const both = env.as(identity(1472));
    assert.equal(await env.actor.judges_frozen(), true, "this only means anything mid-season");
    assert.equal(await judgeStatus(env, "dodgeboth"), "approved");

    assert.deepEqual(
      await both.apply_as_judge(),
      { err: { Settling: null } },
      "even a no-op judge application is shut after launch",
    );
    // Straight into the role. Stacking a second one asks for no second
    // acceptance: the agreement they took at registration is the one that
    // covers "the rules for every role you assume".
    ok(await both.set_hacker(true), "take the hacker role");
    // Named here rather than in the setup because it is exactly the same kind
    // of self-service write as the rest of this list, and because the next
    // test needs it: without a reward wallet their entry would be `#NoWallet`.
    ok(await both.set_wallet(walletFor(1472)), "name a reward wallet");
    ok(await both.set_avatar([]), "clear the avatar");
    assert.deepEqual(
      await both.apply_as_sponsor({
        org: "Judge Ltd",
        blurb: "",
        website: "",
        logo: [],
        ledgers: [{ id: env.launchLedger, sns: false }],
      }),
      { err: { Settling: null } },
    );
    assert.deepEqual(await both.withdraw_sponsor(), { err: { Settling: null } });
    ok(
      await both.update_profile({
        handle: "dodgeboth",
        displayName: "still a judge",
        title: [],
        bio: "",
        links: [],
        // An edit goes through the same `Profiles.validate` a registration
        // does, so the acceptance has to be restated and has to still be true
        // — there is no way to hold an account that agreed to nothing.
        terms: true,
      }),
      "edit the profile",
    );

    assert.equal(await judgeStatus(env, "dodgeboth"), "approved", "still on the judges");
  });

  it("a judge who is also a hacker may not vote on their own entry", async () => {
    // Roles stack (§3), which is the one legitimate way the judges and the field
    // overlap. The freeze does not stop it; `#OwnEntry` does.
    const both = env.as(identity(1472));
    await enter(mod, both, "The judge's own project", await build(both), "dodgeboth_app");

    const rows = await env.actor.season_week_view(season.id, season.week, 50n);
    const mine = rows.find((row) => row.handle === "dodgeboth");
    const theirs = rows.find((row) => row.handle === "dodgehacker");
    assert.ok(mine && theirs, "both entries are in the week");

    assert.deepEqual(await both.cast_vote(mine.entry.id), { err: { OwnEntry: null } });
    ok(await both.cast_vote(theirs.entry.id), "voting on somebody else is fine");
  });

  it("a rename does not slip somebody off the judges", async () => {
    // The judges is a set of user ids; handles are editable. Renaming must not
    // change the status, and the freeze must refuse under either name — it is
    // checked before the handle is looked up at all.
    const renamer = env.as(identity(1474));
    ok(
      await renamer.update_profile({
        handle: "dodgerenamed",
        displayName: "renamed",
        title: [],
        bio: "",
        links: [],
        terms: true,
      }),
      "rename",
    );

    assert.deepEqual(await env.actor.profile("dodgerenamer"), [], "the old handle is free");
    assert.equal(await judgeStatus(env, "dodgerenamed"), "approved");

    assert.deepEqual(await mod.set_judge("dodgerenamed", { no: null }, []), FROZEN);
    assert.deepEqual(await mod.set_judge("dodgerenamer", { no: null }, []), FROZEN);

    const rows = await env.actor.season_week_view(season.id, season.week, 50n);
    ok(await renamer.cast_vote(rows[0].entry.id), "and they still vote under the new name");
  });

  it("keeps a refused application out through the whole season and after it", async () => {
    const late = env.as(identity(1475));
    assert.deepEqual(await late.apply_as_judge(), { err: { Settling: null } });
    assert.equal(await judgeStatus(env, "dodgelate"), "no");

    // Run the season out, a deadline at a time — there is no early close for
    // anybody any more, so the loop waits out each week rather than asking.
    // What is under test is what happens to the refusal while they pass, not the
    // clock itself, which the day-by-day suite above pins. Bounded at six
    // rather than looping until the season clears, so a week that refused to
    // close fails the assertion below instead of hanging the run.
    for (let week = 1; week <= 6 && (await env.live()) !== null; week += 1) {
      await closeWeek(env);
    }
    assert.equal(await env.actor.judges_frozen(), true);
    assert.equal(await judgeStatus(env, "dodgelate"), "no", "the refused call wrote nothing");

    // This used to wait out a grace day, ask for the controllers back and
    // upgrade, to show a queue survived that too. There is nothing to wait
    // for through the ordinary season flow: the list has been self-only since
    // before the season, so the queue's only
    // remaining test is time — and the upgrade is refused rather than skipped,
    // because "it cannot be replaced" is the stronger claim.
    assert.deepEqual(await keyholders(env), SELF_ONLY(env), "sealed self-only at the end");
    await assert.rejects(
      env.upgrade(),
      /CanisterInvalidController/,
      "no new code, season or no season",
    );

    // The season is over, but both the roster and participant profiles remain
    // immutable: finishing is not an after-the-fact moderation window.
    assert.deepEqual(await mod.set_judge("dodgelate", { approved: null }, []), FROZEN);
    assert.equal(await judgeStatus(env, "dodgelate"), "no");
    assert.deepEqual(
      await late.update_profile({
        handle: "dodgelate",
        displayName: "too late",
        title: [],
        bio: "",
        links: [],
        terms: true,
      }),
      { err: { Settling: null } },
    );
  });
});

/*
 * Removed: a `describe.skip` claiming "a hacker who wins two qualifier weeks
 * fills only one semi-final place", asserting `season_week(id, 5) === 2`.
 *
 * The mechanism it described is real — `Season.carry` (backend/lib/Season.mo:591)
 * returns `#ok` without cloning when the target week already holds an entry for
 * that hacker, and the dropped week's entry keeps its `#advanced` mark. But the
 * expectation was not. Duel A is "winner of week 1 v winner of week 2"
 * (the bracket section of the Rules page); when one hacker wins both, both sides of that duel are the same
 * project, and §3's unique index on `(season, week, hacker)` makes two week-5
 * rows for them impossible. §5 also rules out the only alternative — "There is
 * **no backfilling**" — so one entry in duel A is the sole rules-conformant
 * outcome, and §5's walkover clause already covers a duel with one entrant.
 * Reproduced independently: w1 `id=1 advanced`, w2 `id=4 advanced`, w5 holds
 * `id=3 origin=1`, w6 `id=6 won`. Nothing a *distinct* competitor earned was
 * lost, and §7 pays that hacker once for their highest finish either way.
 *
 * The reachable case that does contradict §5 is a different one, and belongs to
 * whoever owns the bracket: one hacker winning weeks 1 and 3 — opposite halves.
 * Then weeks 2 and 4's winners take both week-5 slots, both from half 0, duel B
 * is empty, and the final holds one entry even though §5 says "the final still
 * has two entries as long as each half produced one". Half 1 produced a winner
 * twice over. Verified: w5 `id=3 origin=1` and `id=5 origin=4`, w6 one entry.
 */
