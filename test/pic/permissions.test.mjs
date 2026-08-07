/**
 * Who may call what.
 *
 * the Trust section of the Rules page is a nine-row table; the canister is thirty-odd update methods.
 * This file is the join: one of every principal the format distinguishes —
 * anonymous, an unregistered key, observer, hacker, pending judge, approved
 * judge, pending sponsor, approved sponsor, moderator, controller — put in
 * front of every state-changing method, both ways round. A permission bug is
 * almost never a method that refuses the right person; it is a method that
 * forgets to ask, and the only way to see that is to try everybody.
 *
 * Two things this leans on. `Profiles.canModerate` reads
 * `Principal.isController(caller) or user.moderator`, so "moderator or
 * controller" is one check and "controller only" is a second, separate one —
 * the interesting cases are the methods where a moderator must be turned away.
 * And an error tag is evidence of *where* a call stopped: `#NotAllowed` means
 * the gate refused it, anything else means the gate let it through and the
 * business rule underneath spoke. Several tests below assert the second kind,
 * because "authorised but there is nothing to do" is the only way to prove a
 * gate opened without moving state.
 *
 * A third thing, newer than the other two, and it reaches into every describe:
 * **the canister is sealed.** `seal_canister` leaves exactly the canister
 * itself as controller and removes every external controller. So the identity
 * that installed this canister stops being a controller
 * the moment it seals, for good, and `canModerate`, having no controller to be
 * lenient about, stops treating it as a moderator. Every controller-only method
 * (`assets_upload`, `set_config`, `set_instruction_cap`, `set_moderator`, and
 * `seal_canister` itself) and every `canModerate`-gated one goes dark, and
 * nothing in the ordinary season flow brings any of them back. That is the feature:
 * the claim the site makes is that the rules cannot change once entries are in,
 * and a controller who could still moderate — or still ship a different wasm —
 * would be a hole straight through it.
 *
 * Which forces the season controls the other way round. `create_season` and
 * `start_season` are **moderator** calls now, not controller ones: sealing
 * comes before the season and leaves no external controllers, so an ingress
 * controller gate there would be a gate nobody could pass and the canister could never
 * run the one season it exists for.
 * `start_season` additionally refuses unless controller state is exactly self-only — the
 * seal is checked on every start rather than assumed, because a season that
 * began while somebody still held the keys would look identical from outside to
 * one that could not.
 *
 * So every fixture below does its appointing, uploading, configuring and draft
 * first. Launch readiness then closes registration, resolves every application,
 * verifies the minimum moderator/judge bench and sponsor ledger, and only then
 * seals. A real moderator starts the already-frozen draft afterwards.
 *
 * `run_payout` follows the same moderator rule as the other manual automation
 * recovery calls. Automatic timers need no ingress authority, while a current
 * moderator can nudge a distribution after a frozen canister is topped up.
 *
 * A fourth: approving a judge or a sponsor takes two moderators. `#NeedsSecond`
 * is therefore an *authorised* answer — the gate opened, the vote was recorded,
 * and the decision is waiting for somebody else — so the cast carries a second
 * moderator whose only job is to co-sign. It is deliberately kept out of
 * `EVERYBODY`: it is a moderator, so every "nobody but a moderator" loop below
 * would let it through for the right reason and learn nothing from it.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { AnonymousIdentity } from "@dfinity/agent";

import {
  bootstrap,
  closeWeek,
  hacker,
  identity,
  ok,
  register,
  walletFor,
  bigints,
  MINUTE,
  SECOND,
} from "./harness.mjs";

/**
 * The err tag of a Result, or null when it succeeded.
 *
 * `submit_entry` and `publish_update` go through the review queue now, so they
 * answer with `Review.Error` — which carries the season's own refusal inside a
 * `#Season` wrapper. The gate that turned the caller away is unchanged; only
 * the envelope moved, so the wrapper is peeled here rather than at forty call
 * sites. Every other tag is reported exactly as the canister sent it.
 */
const errOf = (res) => {
  if (!(res && typeof res === "object" && "err" in res)) return null;
  if (typeof res.err === "string") return res.err;
  const tag = Object.keys(res.err)[0];
  if (tag === "Season" && res.err.Season && typeof res.err.Season === "object") {
    return Object.keys(res.err.Season)[0];
  }
  return tag;
};

const show = (res) => JSON.stringify(res, bigints);

const refused = (res, tag, what) =>
  assert.equal(errOf(res), tag, `${what}: expected ${tag}, got ${show(res)}`);

const allowed = (res, what) =>
  assert.equal(errOf(res), null, `${what}: should have been allowed, got ${show(res)}`);

/**
 * The gate opened even though the call could not succeed.
 *
 * A moderator drafting a payout for a season with no money in it is refused
 * for want of money, not for want of standing — and that difference is the
 * whole point of the row in §8.
 */
const passedGate = (res, gate, what) =>
  assert.notEqual(errOf(res), gate, `${what}: refused as ${gate}, but this caller is authorised`);

/**
 * Whoever PocketIC says controls this canister, sorted, as text. Production
 * participants can independently check the same certified state on the IC
 * dashboard.
 */
async function controllersOf(env) {
  const held = await env.pic.getControllers(env.canisterId);
  return held.map((who) => who.toText()).sort();
}

/** The exact self-only controller state a sealed canister exposes. */
const sealed = async (env, what) =>
  assert.deepEqual(
    await controllersOf(env),
    [env.canisterId.toText()],
    `${what}: only the canister itself should control this canister`,
  );

/** The installer and the canister — the state every fixture starts in. */
const keysHeld = async (env, what) =>
  assert.deepEqual(
    await controllersOf(env),
    [env.canisterId.toText(), env.controller.getPrincipal().toText()].sort(),
    `${what}: the installer and the canister should still hold it`,
  );

/**
 * The point of no return, and the last controller-only call a fixture makes.
 *
 * Everything a season needs has to be arranged before this: moderators
 * appointed, the frontend uploaded, the allowance set. Afterwards the only
 * authority that exists is the one the installed code grants, which is why the
 * season control below is a moderator's and not this identity's.
 *
 * Replica state is the check that matters rather than the `#ok`: a call
 * answering happily while the replica still lists somebody is exactly the
 * failure the seal exists to rule out.
 */
async function seal(env) {
  ok(await env.seal(), "seal_canister");
  await sealed(env, "after seal_canister");
}

const HANDLES = {
  observer: "observer_o",
  hacker: "hacker_h",
  pendingJudge: "judge_pending",
  judge: "judge_ok",
  pendingSponsor: "sponsor_pending",
  sponsor: "sponsor_ok",
  moderator: "moderator_m",
  seconder: "moderator_two",
  spare: "spare_s",
};

const EVERYBODY = [
  "anonymous",
  "stranger",
  "observer",
  "hacker",
  "pendingJudge",
  "judge",
  "pendingSponsor",
  "sponsor",
  "moderator",
  "spare",
];

/**
 * Every principal in the cast bar the ones named. The controller is never in
 * it, and neither is `seconder` — a second moderator would pass every
 * moderator-gated call in these loops, which is the answer they exist to rule
 * out for everybody else.
 */
const everyoneBut = (cast, ...except) =>
  EVERYBODY.filter((name) => !except.includes(name)).map((name) => [name, cast[name]]);

/**
 * Approving a judge or a sponsor takes two moderators.
 *
 * `Moderation.SECONDS_NEEDED` is 2. The first moderator's call records their
 * backing and answers `#NeedsSecond` carrying the tally; a *different*
 * moderator's call meets the bar and applies it. Rejecting, resetting and
 * revoking are untouched and still take one — the asymmetry is deliberate, so
 * that removing somebody already through the door never needs a quorum.
 *
 * A controller holding no profile row has no vote to cast and applies on its
 * own, which is why the `env.actor.set_judge` / `set_sponsor` calls that stand
 * the fixtures up are single calls. That hatch closes for good the moment the
 * canister is sealed: `Moderation.quorum` still offers it, but no external
 * ingress caller is a controller, so both moderators have to vote.
 */
async function approvedByTwo(cast, method, handle, what) {
  const alone = await cast.moderator[method](handle, { approved: null }, []);
  refused(alone, "NeedsSecond", `${what}: one moderator`);
  assert.deepEqual(
    { votes: Number(alone.err.NeedsSecond.votes), needed: Number(alone.err.NeedsSecond.needed) },
    { votes: 1, needed: 2 },
    `${what}: the tally should say one of the two it needs`,
  );
  allowed(
    await cast.seconder[method](handle, { approved: null }, []),
    `${what}: the second moderator`,
  );
}

/**
 * A well-formed package key in a namespace nobody in the cast owns.
 *
 * Every submission below that is *meant* to be refused is refused before the
 * package is ever looked at — no season, not registered, not a hacker — so the
 * field only has to exist for the call to encode. Where a submission is meant
 * to succeed the test uploads a real `.neutron` first and names its key.
 */
const NO_PACKAGE = "/u/0/pkg/1.neutron";

/** `/u/<id>/pkg/<digits>.neutron`, the only shape `checkEntry` accepts. */
const pkgKey = (userId, n = 1) => `/u/${userId}/pkg/${n}.neutron`;

/**
 * An app id nobody in the cast will ever be filed under.
 *
 * An entry now carries a required `slug` — 5 to 50 characters of `a-z` and `_`,
 * unique across hackers, and fixed forever once an entry has one, because it
 * names the `<slug>.neutron` file people download. It does for the id what
 * `NO_PACKAGE` does for the build: every submission below that is *meant* to be
 * refused is refused long before `checkSlug` runs, so the field only has to
 * exist for the call to encode. The submissions that are meant to land name
 * themselves.
 */
const NO_SLUG = "never_lands";

const entry = (title, pkg = NO_PACKAGE, slug = NO_SLUG) => ({
  title,
  summary: "",
  url: "",
  icon: [],
  shots: [],
  links: [],
  pkg: { key: pkg },
  slug,
});

/**
 * A registration form, for the tests that care about who may fill one in.
 *
 * One acceptance and nothing else: `Profiles.Input` carries `terms` alone, and
 * the agreement it accepts says it covers every role the signer later assumes.
 */
const signup = (handle) => ({
  handle,
  displayName: "late",
  title: [],
  bio: "",
  links: [],
  terms: true,
});

const store = (key, bytes = 8) => ({
  store: {
    key,
    content: new Uint8Array(bytes),
    contentType: "application/octet-stream",
    chunks: 1n,
    contentEncoding: "identity",
  },
});

/**
 * Put a real build in somebody's namespace and hand back its key.
 *
 * An entry now carries a required `.neutron`, and `checkEntry` asks the asset
 * store how big it is — a key with nothing finished behind it is refused. So a
 * submission that is supposed to be *allowed* has to upload first; there is no
 * way to test the permission gate on `submit_entry` without getting past it.
 */
async function uploadPackage(who, n = 1) {
  const key = pkgKey(await idOf(who), n);
  ok(await who.my_upload(store(key, 512)), `upload ${key}`);
  return key;
}

/**
 * Propose an entry and have a moderator wave it through, so it reaches the
 * bracket.
 *
 * A *real* moderator, not the controller. Every call site is behind the seal,
 * and the sealed canister has no external controller — so `canModerate` does
 * not treat the former deployer as a moderator and `approve_revision` would answer
 * `#NotAllowed`. Hence the appointing in `assemble` and the seconder alongside
 * it: the review queue needs somebody who is a moderator by their profile row.
 */
async function submitAndApprove(mod, who, title, key, slug) {
  const proposed = await who.submit_entry(entry(title, key, slug));
  allowed(proposed, `${title}: submit_entry`);
  ok(await mod.approve_revision(proposed.ok.id), `${title}: approve_revision`);
  return proposed.ok;
}

/**
 * One of every principal, built the way a real deployment builds them.
 *
 * The pledged "ledger" is this canister's own id. It is a principal that
 * certainly exists — so it passes into `treasury_ledgers` and therefore into
 * the allowlist `withdraw` checks — and it implements none of ICRC-1, so any
 * call the canister makes to it fails loudly rather than quietly succeeding.
 * That is exactly what a permission test wants: the authorization answer, with
 * no money moving to confuse it.
 *
 * Every controller-only step in here — `set_judge` and `set_sponsor` applying
 * alone, both `set_moderator` calls — has a deadline it does not announce, and
 * it is not a deadline that comes round again: `seal_canister` empties the
 * controller list for good, so a cast assembled afterwards could not be
 * assembled at all. There is no later moment at which a forgotten moderator can
 * be appointed. The registrations have a deadline of their own — the season
 * start, which shuts the doors until the season finishes — so this runs in
 * `before`, entirely, in every describe.
 *
 * Nobody declares anything here beyond registering. Taking a role asks for
 * nothing further — the SRPPA is accepted once and covers every role its signer
 * assumes — so `apply_as_sponsor` follows `register` directly, and the two
 * per-role attestations that used to sit between them are gone from the
 * interface entirely.
 *
 * `base` keeps each describe's identities disjoint.
 */
async function assemble(env, base) {
  const ledger = env.launchLedger;
  const application = (org) => ({
    org,
    website: "",
    logo: [],
    blurb: "",
    ledgers: [{ id: ledger, sns: false }],
  });

  const cast = {
    ledger,
    controller: env.actor,
    anonymous: env.as(new AnonymousIdentity()),
    // A real key that simply never registered. Distinct from anonymous: the
    // canister rejects those two on different grounds and should say so.
    stranger: env.as(identity(base + 9)),
  };

  cast.observer = await register(env.as, identity(base + 1), HANDLES.observer);

  // `hacker` is register + a reward wallet + the role, because `submit_entry`
  // now refuses `#NoWallet` before it looks at anything else a hacker sends.
  // The wallet is also the destination: a prize goes straight to it, which is
  // why editing one is refused for as long as a season is settling.
  cast.hacker = await hacker(env, base + 2, HANDLES.hacker);

  cast.pendingJudge = await register(env.as, identity(base + 3), HANDLES.pendingJudge);
  ok(await cast.pendingJudge.apply_as_judge(), "apply_as_judge");

  cast.judge = await register(env.as, identity(base + 4), HANDLES.judge);
  ok(await cast.judge.apply_as_judge(), "apply_as_judge");
  ok(await env.actor.set_judge(HANDLES.judge, { approved: null }, []), "approve judge");
  // Roles stack, and one test below has the judge enter an app of their own to
  // prove they cannot vote for it. That needs somewhere to be paid, so it is
  // set here rather than mid-test — it is fixture, not the thing being asked.
  ok(await cast.judge.set_wallet(walletFor(base + 4)), "judge wallet");

  cast.pendingSponsor = await register(env.as, identity(base + 5), HANDLES.pendingSponsor);
  ok(await cast.pendingSponsor.apply_as_sponsor(application("Pending Ltd")), "apply_as_sponsor");

  cast.sponsor = await register(env.as, identity(base + 6), HANDLES.sponsor);
  ok(await cast.sponsor.apply_as_sponsor(application("Sponsor Ltd")), "apply_as_sponsor");
  ok(await env.actor.set_sponsor(HANDLES.sponsor, { approved: null }, []), "approve sponsor");

  cast.moderator = await register(env.as, identity(base + 7), HANDLES.moderator);
  ok(await env.actor.set_moderator(HANDLES.moderator, true, []), "grant moderator");

  // The second signature. Approving a judge or a sponsor takes two moderators
  // now, so without somebody to co-sign, "a moderator may approve a judge"
  // could not be expressed at all — only "a moderator may ask". Kept out of
  // `EVERYBODY` on purpose: see `everyoneBut`. Seeded well clear of the
  // `base + 1..9` block, which the numbered cast owns and the tests extend.
  cast.seconder = await register(env.as, identity(base + 100), HANDLES.seconder);
  ok(await env.actor.set_moderator(HANDLES.seconder, true, []), "grant second moderator");

  // Somebody to be done things to, so the tests above can mutate without
  // dismantling the cast they still need.
  cast.spare = await register(env.as, identity(base + 8), HANDLES.spare);

  return cast;
}

const idOf = async (who) => (await who.me())[0].id;

// ─────────────────────────────────────────────────────────────────────────────

describe("authorization with no season running", () => {
  let env;
  let cast;
  /**
   * The draft the seal tests hand between them.
   *
   * Drafted before the seal and started after it, in two tests rather than
   * one, because those are two separate rules: a moderator may draft, and
   * `start_season` refuses until the controller list is exactly self-only. Neither can be
   * seen if the pair runs as a single call.
   */
  let draft;

  before(async () => {
    env = await bootstrap({ controller: identity(1200) });
    cast = await assemble(env, 1200);
  });

  after(async () => {
    await env?.teardown();
  });

  // ── The anonymous principal ────────────────────────────────────────────────

  it("will not let the anonymous principal register", async () => {
    // Every other refusal below follows from this one: if anonymous can never
    // hold a profile, then every method that starts by looking a profile up is
    // closed to it for free. That makes this the load-bearing check.
    refused(
      await cast.anonymous.register({
        handle: "nobody_at_all",
        displayName: "nobody",
        title: [],
        bio: "",
        links: [],
        // The one acceptance there is, made, so the refusal below can only be
        // about who is calling: `Profiles.register` asks whether the caller is
        // anonymous before it validates anything, and this pins that order.
        terms: true,
      }),
      "Anonymous",
      "anonymous register",
    );
    assert.deepEqual(await env.actor.profile("nobody_at_all"), []);
  });

  it("gives the anonymous principal no profile and no roles", async () => {
    assert.deepEqual(await cast.anonymous.me(), []);
    assert.equal(await cast.anonymous.am_moderator(), false);
    assert.equal(await cast.anonymous.is_controller(), false);
    assert.deepEqual(await cast.anonymous.my_deposit(), []);
    // A season pays a winner's own wallet in one hop now, so the custody
    // address is a drain path for whatever is already sitting there rather
    // than where a prize lands. It is still derived from a profile, which is
    // the only reason it belongs in this list: no profile, no address.
    assert.deepEqual(await cast.anonymous.my_reward_account(), []);
    assert.deepEqual(await cast.anonymous.my_payouts(), []);
  });

  it("refuses every profile write from anonymous and from a stranger", async () => {
    const input = {
      handle: "whoever",
      displayName: "x",
      title: [],
      bio: "",
      links: [],
      terms: true,
    };
    for (const name of ["anonymous", "stranger"]) {
      // These callers have no profile at all, so every line below is refused
      // with `NotRegistered` long before anything looks at what they sent.
      const who = cast[name];
      refused(await who.update_profile(input), "NotRegistered", `${name} update_profile`);
      refused(await who.set_hacker(true), "NotRegistered", `${name} set_hacker`);
      refused(await who.apply_as_judge(), "NotRegistered", `${name} apply_as_judge`);
      refused(
        await who.apply_as_sponsor({ org: "X", website: "", logo: [], blurb: "", ledgers: [] }),
        "NotRegistered",
        `${name} apply_as_sponsor`,
      );
      refused(await who.withdraw_sponsor(), "NotRegistered", `${name} withdraw_sponsor`);
      refused(await who.set_avatar(["/u/1/avatar/a.png"]), "NotRegistered", `${name} set_avatar`);
      refused(await who.my_upload(store("/u/1/avatar/a.png")), "not registered", `${name} my_upload`);
    }
  });

  // ── Self-service roles ─────────────────────────────────────────────────────

  it("lets a registered user take and drop the hacker role themselves", async () => {
    // §8 does not list hacking because there is nobody to ask: `set_hacker`
    // takes no handle, so the only profile it can reach is the caller's.
    //
    // And nothing else is asked either. The SRPPA is accepted once, at
    // registration, and says in as many words that it covers the rules for
    // every role its signer assumes — so there is no second checkbox between
    // being registered and taking a role. The strongest form of that is that
    // the calls which used to collect one are not on the interface at all: a
    // route cannot forget to show a modal that does not exist.
    assert.equal(typeof cast.spare.declare, "undefined", "no per-role declaration to make");
    assert.equal(typeof cast.spare.set_install_consent, "undefined", "and no second one either");
    allowed(await cast.spare.set_hacker(true), "spare set_hacker on");
    assert.equal((await cast.spare.me())[0].hacker, true);
    allowed(await cast.spare.set_hacker(false), "spare set_hacker off");
    assert.equal((await cast.spare.me())[0].hacker, false);
  });

  it("lets anyone apply to judge, and gives applying no powers", async () => {
    allowed(await cast.spare.apply_as_judge(), "spare apply_as_judge");
    assert.deepEqual((await cast.spare.me())[0].judgeStatus, { pending: null });
    // A pending judge is not a judge: they cannot approve themselves through.
    refused(
      await cast.spare.set_judge(HANDLES.spare, { approved: null }, []),
      "NotAllowed",
      "pending judge self-approving",
    );
    assert.deepEqual((await cast.spare.me())[0].judgeStatus, { pending: null });
  });

  it("lets a moderator reject a judge application", async () => {
    allowed(await cast.moderator.set_judge(HANDLES.spare, { no: null }, []), "moderator rejects");
    assert.deepEqual((await cast.spare.me())[0].judgeStatus, { no: null });
  });

  // ── Moderation: the judges and the sponsors ──────────────────────────────────

  it("lets nobody but a moderator or the controller touch the judges", async () => {
    for (const [name, who] of everyoneBut(cast, "moderator")) {
      refused(
        await who.set_judge(HANDLES.pendingJudge, { approved: null }, []),
        "NotAllowed",
        `${name} set_judge`,
      );
    }
    // And none of that got through.
    assert.deepEqual((await env.actor.profile(HANDLES.pendingJudge))[0].judgeStatus, {
      pending: null,
    });
  });

  it("lets two moderators and the still-unsealed controller change the judges", async () => {
    assert.equal(await env.actor.judges_frozen(), false);
    // Seating a judge takes two moderators: the first is authorised and is
    // told so — `#NeedsSecond`, not `#NotAllowed` — and the second applies it.
    await approvedByTwo(cast, "set_judge", HANDLES.pendingJudge, "moderators approve a judge");
    assert.deepEqual((await env.actor.profile(HANDLES.pendingJudge))[0].judgeStatus, {
      approved: null,
    });
    // Putting one back is a one-moderator action, and the controller is one —
    // until it seals. The title says "still-unsealed" because that is now
    // load-bearing and permanent: after `seal_canister` this half of the test
    // would answer `#NotAllowed` and would keep answering it for the life of
    // the canister. See the running-season describe, which asserts exactly
    // that, and note that no describe can assert the reverse.
    allowed(
      await env.actor.set_judge(HANDLES.pendingJudge, { pending: null }, []),
      "controller resets a judge",
    );
    assert.deepEqual((await env.actor.profile(HANDLES.pendingJudge))[0].judgeStatus, {
      pending: null,
    });
  });

  it("lets nobody but a moderator or the controller approve a sponsor", async () => {
    for (const [name, who] of everyoneBut(cast, "moderator")) {
      refused(
        await who.set_sponsor(HANDLES.pendingSponsor, { approved: null }, []),
        "NotAllowed",
        `${name} set_sponsor`,
      );
    }
    assert.deepEqual((await env.actor.profile(HANDLES.pendingSponsor))[0].sponsorStatus, {
      pending: null,
    });
    // A sponsor's pledged canister id is one this canister will be asked to
    // call, so approving one takes two moderators as well.
    await approvedByTwo(cast, "set_sponsor", HANDLES.pendingSponsor, "moderators approve a sponsor");
    allowed(
      await cast.moderator.set_sponsor(HANDLES.pendingSponsor, { pending: null }, []),
      "moderator resets a sponsor",
    );
  });

  it("keeps appointing moderators with the controller alone", async () => {
    // "Moderators appointing moderators has no floor" — so the one power a
    // moderator must not have is the power to make more of themselves.
    //
    // Which puts a deadline on the whole role, and it is a final one.
    // `set_moderator` is controller-only and sealing removes the external
    // controller, so every moderator needed at launch must be
    // seated before it seals — not before this season, before all of them.
    // That is why `assemble` appoints two in `before` rather than where they
    // are used, and why one of them exists only to co-sign.
    for (const [name, who] of everyoneBut(cast)) {
      refused(await who.set_moderator(HANDLES.spare, true, []), "NotAllowed", `${name} set_moderator`);
    }
    assert.equal((await cast.spare.me())[0].moderator, false);

    allowed(await env.actor.set_moderator(HANDLES.spare, true, []), "controller grants");
    assert.equal((await cast.spare.me())[0].moderator, true);
    allowed(await env.actor.set_moderator(HANDLES.spare, false, []), "controller revokes");
    assert.equal((await cast.spare.me())[0].moderator, false);
  });

  it("shows the moderation log to moderators only", async () => {
    const asModerator = await cast.moderator.moderation_log([], 25n);
    assert.ok(asModerator.rows.length > 0, "the log should have rows by now");
    // The per-user log needs its own witness: without one, "an outsider sees
    // []" holds just as well when nobody has a trail at all, and the check
    // proves nothing about who is being turned away.
    const spareTrail = await cast.moderator.moderation_log_for(HANDLES.spare, [], 25n);
    assert.ok(spareTrail.rows.length > 0, "spare has been moderated, so there is a trail to hide");
    assert.ok(Number(spareTrail.total) > 0, "and its total is non-zero");

    for (const [name, who] of everyoneBut(cast, "moderator")) {
      const page = await who.moderation_log([], 25n);
      assert.deepEqual(page.rows, [], `${name} should see no moderation log`);
      assert.equal(Number(page.total), 0, `${name} should not even learn how big the log is`);
      const forOne = await who.moderation_log_for(HANDLES.spare, [], 25n);
      assert.deepEqual(forOne.rows, [], `${name} should see no log for a user`);
      assert.equal(Number(forOne.total), 0, `${name} should not learn spare's trail length`);
    }
  });

  // ── Season control ─────────────────────────────────────────────────────────

  it("gives nobody below a moderator any season controls", async () => {
    // the Season section of the Rules page used to read "a moderator has no season controls at all; the
    // calendar is not theirs", and the calendar half still holds — nobody
    // advances a week, see the bottom of this test. The other half inverted,
    // and the seal is what inverted it: `create_season` and `start_season` are
    // `canModerate`-gated because after sealing there is no external controller
    // to gate them on, so a controller-only season control would be a control that
    // could be used exactly once, by the identity that installed the canister,
    // before it sealed — and never again by anybody.
    //
    // So the row this test can still assert is the floor: a moderator and
    // nobody below. The moderator's own half is asserted below the seal, where
    // it is the only way a season can begin at all.
    const before = (await env.actor.seasons(10n)).length;
    for (const [name, who] of everyoneBut(cast, "moderator")) {
      refused(await who.create_season(), "NotAllowed", `${name} create_season`);
      refused(await who.start_season(1n), "NotAllowed", `${name} start_season`);
    }
    assert.equal((await env.actor.seasons(10n)).length, before, "no draft should exist");
    assert.equal(await env.actor.clock_armed(), false);

    // `close_week` was the third call in that loop. It is not that a moderator
    // is refused it any more — it is not on the interface at all, for anybody,
    // the controller included: the bracket advances when its deadline passes
    // and at no other time. The strongest form of the old row is that there is
    // nothing left to call, so assert exactly that rather than dropping it.
    assert.equal(typeof env.actor.close_week, "undefined", "nobody closes a week by hand");
  });

  // ── Site configuration and site-owned assets ───────────────────────────────
  //
  // Both of these run before the seal, and they have to: the whole section is
  // controller-only, and sealing removes the external controller. This is
  // the only window in the canister's life in which either can be proved from
  // the allowed side, which is also why the `/site/index.html` uploaded below
  // is the frontend this canister serves for the rest of its life.

  it("keeps set_config and assets_upload to the controller", async () => {
    const before = await env.actor.config();

    for (const [name, who] of everyoneBut(cast)) {
      assert.ok(
        "err" in (await who.set_config("hijacked", false)),
        `${name} should not be able to set_config`,
      );
      assert.ok(
        "err" in (await who.assets_upload(store("/site/index.html"))),
        `${name} should not be able to assets_upload`,
      );
      // The destructive one: clearing a prefix is not a user operation and it
      // is not a moderator one either.
      assert.ok(
        "err" in (await who.assets_upload({ clear: { prefix: "/" } })),
        `${name} should not be able to clear the asset store`,
      );
    }

    assert.deepEqual(await env.actor.config(), before, "config should be untouched");
    allowed(await env.actor.assets_upload(store("/site/index.html")), "controller assets_upload");
  });

  it("keeps registration in the controller's gift until the canister seals", async () => {
    // Nobody presses a `set_registration` any more — it is gone, and
    // `Season.start` shuts the doors itself. What survives is a field on the
    // config, and the config is the controller's alone: the loop above proves
    // the gate, this proves the field behind it still decides who may sign up.
    //
    // "Until the canister seals" is the load-bearing half of the title, and it
    // is the last time this override can be exercised at all. After the seal
    // the former deployer is no longer a controller able to touch the field, as asserted at the
    // bottom of this describe — so the positive form of this rule can only be
    // shown here, once, before it.
    const before = await env.actor.config();
    assert.equal(before.registrationOpen, true, "registration is open by default");

    allowed(await env.actor.set_config(before.siteTitle, false), "controller closes registration");
    // Against a key that has never registered, so `#AlreadyRegistered` cannot
    // stand in for `#Closed` and prove nothing.
    const early = env.as(identity(1213));
    refused(await early.register(signup("too_early_now")), "Closed", "register while closed");

    allowed(await env.actor.set_config(before.siteTitle, true), "controller reopens");
    allowed(await early.register(signup("too_early_now")), "register once reopened");

    assert.deepEqual(await env.actor.config(), before, "and the config is back as it was");
  });

  // ── The per-user namespace ─────────────────────────────────────────────────

  it("confines a user's uploads to their own /u/<id>/ namespace", async () => {
    const mine = await idOf(cast.hacker);
    const theirs = await idOf(cast.observer);

    allowed(await cast.hacker.my_upload(store(`/u/${mine}/icon/1.png`)), "own icon");
    allowed(await cast.hacker.my_upload(store(`/u/${mine}/avatar/1.png`)), "own avatar");

    // Somebody else's namespace, in every command that names a key.
    assert.ok(
      "err" in (await cast.observer.my_upload(store(`/u/${mine}/icon/2.png`))),
      "observer should not write into the hacker's namespace",
    );
    assert.ok(
      "err" in (await cast.observer.my_upload({ delete: { key: `/u/${mine}/icon/1.png` } })),
      "observer should not delete the hacker's file",
    );
    assert.ok(
      "err" in (await cast.observer.my_upload({ chunk: { key: `/u/${mine}/icon/1.png`, content: new Uint8Array(4), index: 0n } })),
      "observer should not append to the hacker's file",
    );
    // And clearing a prefix is not a user operation whatever the prefix.
    for (const prefix of ["/", `/u/${theirs}/`, `/u/${mine}/`]) {
      assert.ok(
        "err" in (await cast.observer.my_upload({ clear: { prefix } })),
        `observer should not clear ${prefix}`,
      );
    }

    assert.deepEqual(
      await env.actor.assets_list(`/u/${mine}/icon/`, 10n),
      [],
      "a participant namespace is not a public directory index",
    );
    const still = await env.actor.http_request({
      url: `/u/${mine}/icon/1.png`,
      method: "GET",
      body: new Uint8Array(),
      headers: [],
      certificate_version: [],
    });
    assert.equal(still.status_code, 200, "the hacker's exact icon URL survived all of that");
  });

  it("refuses an upload into a folder nobody named", async () => {
    // The size cap comes from the folder, so an unknown folder has no cap and
    // is refused rather than defaulted to the loosest one.
    const mine = await idOf(cast.hacker);
    assert.ok(
      "err" in (await cast.hacker.my_upload(store(`/u/${mine}/whatever/1.bin`))),
      "an unlisted folder should be refused",
    );
  });

  it("only lets an avatar point at the owner's own upload", async () => {
    const mine = await idOf(cast.hacker);
    const theirs = await idOf(cast.observer);

    refused(
      await cast.observer.set_avatar([`/u/${mine}/avatar/1.png`]),
      "Invalid",
      "observer claiming the hacker's avatar",
    );
    allowed(await cast.observer.set_avatar([`/u/${theirs}/avatar/1.png`]), "own avatar key");
    allowed(await cast.observer.set_avatar([]), "clearing an avatar");
  });

  // ── Money, with nothing to move ────────────────────────────────────────────

  it("keeps sweeping on somebody's behalf to moderators", async () => {
    // §6: collecting is the sponsor's own action; a moderator can still do it
    // for a sponsor who transferred and never came back. Nobody else can.
    for (const [name, who] of everyoneBut(cast, "moderator")) {
      refused(
        await who.sweep_sponsor(HANDLES.sponsor, cast.ledger),
        "NotRegistered",
        `${name} sweep_sponsor`,
      );
    }
    passedGate(
      await cast.moderator.sweep_sponsor(HANDLES.sponsor, cast.ledger),
      "NotRegistered",
      "moderator sweep_sponsor",
    );
  });

  it("refuses a withdrawal to a ledger the caller was never paid on", async () => {
    // The allowlist is per caller — a ledger they hold a payout row on — so
    // the caller has to be resolved before it can be applied at all. Anyone
    // without a profile therefore hears `NotRegistered` first; the test below
    // covers them.
    const elsewhere = { owner: identity(1211).getPrincipal(), subaccount: [] };
    const unknown = identity(1212).getPrincipal();
    for (const [name, who] of everyoneBut(cast, "anonymous", "stranger")) {
      refused(await who.withdraw(unknown, elsewhere), "BadDestination", `${name} withdraw`);
    }
  });

  it("refuses a withdrawal from anyone without a profile", async () => {
    const elsewhere = { owner: identity(1211).getPrincipal(), subaccount: [] };
    for (const name of ["anonymous", "stranger"]) {
      refused(
        await cast[name].withdraw(cast.ledger, elsewhere),
        "NotRegistered",
        `${name} withdraw on a pledged ledger`,
      );
    }
  });

  it("refuses a withdrawal aimed at the canister itself", async () => {
    // The derivation already makes the treasury unreachable; this is the one
    // honest mistake a UI can make, and it should not look like a success.
    refused(
      await cast.observer.withdraw(cast.ledger, { owner: env.canisterId, subaccount: [] }),
      "BadDestination",
      "observer withdraw to the canister",
    );
  });

  it("gives no deposit address to anybody while no season is running", async () => {
    // **[decided]** Two conditions, and this describe is the one where the
    // second fails. Being a sponsor is not enough — the address only exists
    // while a season is open, because `Treasury.sweep` refuses outside one and
    // tokens sent early would sit somewhere the canister will not collect
    // from. A sponsor shown an address they cannot yet use is a sponsor whose
    // money goes into limbo believing it arrived.
    assert.deepEqual(await env.actor.deposit_for(HANDLES.observer), []);
    assert.deepEqual(await cast.observer.my_deposit(), []);
    assert.deepEqual(await cast.sponsor.my_deposit(), [], "not even an approved sponsor");
    assert.deepEqual(await cast.pendingSponsor.my_deposit(), []);
    assert.deepEqual(await env.actor.deposit_for(HANDLES.pendingSponsor), []);
    // The other half — that a non-sponsor gets nothing even once a season is
    // running — is pinned in the describe below, which has one.
  });

  // ── Payout control ─────────────────────────────────────────────────────────

  it("keeps manual distribution recovery to moderators, and leaves nothing to sign or throw away", async () => {
    // §7 used to read draft, approve, run, with a human between the plan and
    // the money. Both of the human steps are gone, and for the same reason.
    //
    // The approval went because `Payout.draft` writes `#approved` itself: the
    // canister has no external controllers by the time a season is running, so a
    // controller-gated signature would be a gate nobody could ever open and no
    // season could ever settle. Discarding a plan went with it — it was the
    // same signature pointing the other way, and a plan nobody can block is
    // audited by `payout_plan` instead.
    //
    // Manual sending uses the same `canModerate` authority as the rest of the
    // recovery panel. Automatic settlement remains timer-driven; this method
    // exists for a current moderator to resume it after a canister freeze.
    for (const [name, who] of everyoneBut(cast, "moderator")) {
      refused(await who.run_payout(1n), "NotAllowed", `${name} run_payout`);
    }
    passedGate(await cast.moderator.run_payout(1n), "NotAllowed", "moderator run_payout");
    passedGate(await cast.seconder.run_payout(1n), "NotAllowed", "second moderator run_payout");
    // Before the seal, `canModerate` also admits the still-current controller.
    passedGate(await env.actor.run_payout(1n), "NotAllowed", "controller run_payout");

    // Not "a moderator is refused an approval" — there is no approval and no
    // discard, for anybody, the controller included. Same shape as the
    // `close_week` row above: the strongest form of the old rule is that
    // nothing is left to call, so assert exactly that rather than dropping it.
    assert.equal(typeof env.actor.approve_payout, "undefined", "nobody signs a distribution off");
    assert.equal(typeof env.actor.discard_payout, "undefined", "and nobody throws one away");
    assert.equal(typeof cast.moderator.approve_payout, "undefined");
    assert.equal(typeof cast.moderator.discard_payout, "undefined");
  });

  it("lets a moderator draft a distribution but nobody below one", async () => {
    // Drafting is not how a season pays out any more — the clock does that by
    // itself when the final week closes. `propose_payout` survives as the
    // manual nudge for a season that reached no ledger at all, and §8 still
    // keeps it to a moderator.
    for (const [name, who] of everyoneBut(cast, "moderator")) {
      refused(await who.propose_payout(1n), "NotAllowed", `${name} propose_payout`);
    }
    passedGate(await cast.moderator.propose_payout(1n), "NotAllowed", "moderator propose_payout");
  });

  // ── The seal, and the season a moderator starts behind it ──────────────────
  //
  // Last, and everything above depends on it being last. From here the
  // controller identity is a principal with no standing at all — permanently,
  // for the rest of the canister's life — so every controller-only row proved
  // above would answer `#NotAllowed` if it ran after this point, and there is
  // no later point at which it would stop doing so.

  it("will not start a season while anybody still holds the keys", async () => {
    // Drafting is a moderator's call now, and this is the first place that can
    // be shown from the allowed side: `env.actor` would pass `canModerate` here
    // for being a controller, which proves nothing about the moderator row.
    draft = ok(await cast.moderator.create_season(), "moderator create_season");
    await keysHeld(env, "before the seal");

    // `start_season` asks the replica who controls the canister and refuses
    // unless the answer is exactly self-only. Checked on every start rather than assumed,
    // because a season begun while somebody still held the keys is a season
    // whose bracket could be rewritten halfway through — and from outside it
    // would look exactly like one that could not.
    refused(await cast.moderator.start_season(draft.id), "Invalid", "start_season unsealed");
    assert.equal(await env.live(), null, "and nothing started");
    assert.equal(await env.actor.clock_armed(), false, "so nothing is scheduled either");
  });

  it("removes external controllers and leaves exactly self", async () => {
    // Sealing is itself a controller action — the last one there will be. It
    // has to be: `update_settings` has no self-exemption, so a canister that
    // is not already among its own controllers cannot change its own settings,
    // which is why `bootstrap` adds it during setup.
    for (const [name, who] of everyoneBut(cast)) {
      assert.ok("err" in (await who.seal_canister()), `${name} should not be able to seal`);
    }
    await keysHeld(env, "after everybody else asked");

    ok(await env.seal(), "controller seal_canister");
    // The management canister must report one principal, exactly this
    // canister. That externally verifiable shape is the seal.
    await sealed(env, "sealed");
    assert.equal(await env.actor.is_controller(), false, "the installer is not one any more");

    // And the door closed behind the installer. The same call that removed it is
    // now refused to the identity that made it, which is what "there is no way
    // back" looks like from the caller's side.
    assert.ok("err" in (await env.actor.seal_canister()), "no controller is left to seal again");
  });

  it("lets a moderator start the season, and leaves the week to the clock", async () => {
    // The authority that survives sealing is the one the installed code
    // grants, and this is it. Nobody outside the moderator row can reach it:
    // the loop proving that is above, before the seal, and it runs again in the
    // finished-season describe with the installer standing in it.
    ok(await cast.moderator.start_season(draft.id), "moderator start_season");
    assert.equal(Number((await env.live()).week), 1);
    // Starting is the last thing anybody presses: from here the timer runs it.
    assert.equal(await env.actor.clock_armed(), true, "starting a season arms the clock");
    await sealed(env, "a season started behind the seal");

    // There is no early close for anybody, so what used to be "nobody but the
    // controller may close a week" is now "the calendar is the same for
    // everybody". Waiting is the only way through.
    await closeWeek(env);
    assert.equal(Number((await env.live()).week), 2);
  });

  it("takes the whole controller-only column away, permanently", async () => {
    // The claim the site makes is that the rules cannot change once entries
    // are in. Controllers can replace the code, so while a human holds them
    // that claim rests on trust. The exact self-only list turns it into
    // something a participant can check for themselves: ask the replica who
    // controls it, and the answer is the canister itself alone.
    await sealed(env, "mid-season");

    // The whole controller-only column of §8, refused to the identity that
    // installed the canister. This is the feature: a controller who could
    // still reach any of these would be a hole straight through the claim
    // above, and unlike a season this state has no end.
    const config = await env.actor.config();
    refused(await env.actor.create_season(), "NotAllowed", "the installer create_season");
    refused(await env.actor.start_season(1n), "NotAllowed", "the installer start_season");
    refused(
      await env.actor.set_moderator(HANDLES.spare, true, []),
      "NotAllowed",
      "the installer set_moderator",
    );
    assert.ok("err" in (await env.actor.set_config("hijacked", true)), "the installer set_config");
    assert.ok(
      "err" in (await env.actor.assets_upload(store("/site/index.html"))),
      "the installer assets_upload",
    );
    assert.ok(
      "err" in (await env.actor.assets_upload({ clear: { prefix: "/" } })),
      "the installer clearing the asset store",
    );
    assert.ok(
      "err" in (await env.actor.set_instruction_cap(1n)),
      "the installer set_instruction_cap",
    );

    // None of which moved anything.
    assert.equal((await cast.spare.me())[0].moderator, false, "no moderator was appointed");
    assert.deepEqual(await env.actor.config(), config, "the config is exactly as it was");
    assert.equal((await env.actor.assets_list("/site/", 10n)).length, 1, "the site survived");

    // And the one that the rest of the column rests on: replacing the code.
    // Every refusal above is a rule the *installed wasm* enforces, so a
    // controller who could install a different wasm could delete all of them
    // at once — which is why "the rules cannot change" and "there are no
    // controllers" are the same sentence. This goes through the management
    // canister rather than the interface, so it throws rather than answering
    // an `err`, and no `#NotAllowed` anywhere in this file is worth as much.
    //
    // Matched on the reason rather than merely on throwing: `install_code` has
    // its own rate limit and fails for that too, which would make a bare
    // `rejects` pass on an unsealed canister and prove nothing at all.
    await assert.rejects(
      () => env.upgrade(),
      /controller/i,
      "the former installer cannot upgrade the sealed canister",
    );
    assert.equal((await env.live()).number, 1n, "and the season it is running is untouched");
  });

  it("keeps registration closed from launch sealing through the season", async () => {
    // Readiness requires the doors to be closed before the irreversible seal,
    // and `Season.start` preserves that state. An account created in week four
    // would otherwise have all of the vote and none of the work.
    const before = await env.actor.config();
    assert.equal(before.registrationOpen, false, "registration stayed closed through start");

    const shutOut = env.as(identity(1210));
    refused(await shutOut.register(signup("too_late_now")), "Closed", "register while closed");

    // The override still exists as a field on the config, and the config is
    // still controller-only — but there is no external controller to exercise
    // it during the ordinary season flow. "The rules cannot change
    // once entries are in" with the last person who could have changed them
    // removed, rather than merely asked not to.
    assert.ok(
      "err" in (await env.actor.set_config(before.siteTitle, true)),
      "no controller is left to reopen registration",
    );
    refused(await shutOut.register(signup("too_late_now")), "Closed", "still shut");
    assert.equal((await env.actor.config()).registrationOpen, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("authorization while a season is running", () => {
  let env;
  let cast;
  let season;
  /**
   * A *second approved* judge, seated before the freeze.
   *
   * Without one there is no way to ask the question the withdraw_vote test is
   * named after: mid-season the judges are frozen, so a judge registered after
   * the start can never be approved, and "another judge" degenerates into
   * "another registered user".
   */
  let judgeTwo;
  /**
   * A second hacker, and a hacker who enters nothing.
   *
   * Both used to be made where they are used, halfway through their tests.
   * They cannot be any more: starting a season shuts registration and it stays
   * shut until the season finishes, so *every* participant in a running season
   * has to exist before it starts — the same deadline `judgeTwo` above has,
   * for a different reason. `hacker` is register + reward wallet + role,
   * and it is the register that has nowhere else to go.
   */
  let hackerTwo;
  let idle;

  before(async () => {
    // Every line here is in the order it has to be in, and two different
    // deadlines set that order. The two moderators inside `assemble` need a
    // controller to appoint them and the judge below needs a controller to
    // seat him, so both come before `seal_canister` — which is the last moment
    // in this canister's life at which a controller exists. The registrations
    // need open doors, so they come before `start_season`, which shuts them.
    // And the season itself is started by a moderator, because by then there
    // is nobody else who could. Nothing here can be deferred into the tests.
    env = await bootstrap({ controller: identity(1220) });
    cast = await assemble(env, 1220);
    judgeTwo = await register(env.as, identity(1231), "judge_two");
    ok(await judgeTwo.apply_as_judge(), "judge_two apply_as_judge");
    ok(await env.actor.set_judge("judge_two", { approved: null }, []), "seat the second judge");
    hackerTwo = await hacker(env, 1230, "hacker_two");
    idle = await hacker(env, 1235, "hacker_idle");
    const draft = ok(await cast.moderator.create_season(), "create_season");
    await seal(env);
    season = ok(await cast.moderator.start_season(draft.id), "start_season");
  });

  after(async () => {
    await env?.teardown();
  });

  it("has no external controller, which leaves the installer without standing", async () => {
    // `Profiles.canModerate` is `Principal.isController(caller) or
    // user.moderator`, so a controller has always been an implicit moderator
    // through it. Sealing takes the first half away and cannot give it back,
    // and the installer has no profile row to satisfy the second: `env.actor`
    // is a principal with no standing of any kind, now and from now on. Every
    // `canModerate`-gated method below is dark to it for good.
    //
    // This is the feature, not a bug to work around. A controller who could
    // still moderate would be a hole straight through the claim that the rules
    // cannot change once the entries are in — moderation reaches the bracket.
    await sealed(env, "mid-season");
    assert.equal(await env.actor.am_moderator(), false, "not a moderator either");
    assert.equal(await cast.moderator.am_moderator(), true, "a real moderator still is");

    refused(
      await env.actor.set_sponsor(HANDLES.pendingSponsor, { approved: null }, []),
      "NotAllowed",
      "the installer set_sponsor",
    );
    refused(await env.actor.approve_revision(1n), "NotAllowed", "the installer approve_revision");
    refused(await env.actor.reject_revision(1n, "no"), "NotAllowed", "the installer reject_revision");
    refused(await env.actor.propose_payout(season.id), "NotAllowed", "the installer propose_payout");
    // `sweep_sponsor` spells its refusal `#NotRegistered`, which is the same
    // gate saying the same thing in the treasury's vocabulary.
    refused(
      await env.actor.sweep_sponsor(HANDLES.sponsor, cast.ledger),
      "NotRegistered",
      "the installer sweep_sponsor",
    );
    assert.ok("err" in (await env.actor.thaw_user(HANDLES.spare, false)), "the installer thaw_user");

    // The read side too. These answer with an empty page rather than an error,
    // so an installer that quietly kept its powers would be indistinguishable
    // from a canister with nothing to show — which is why a real moderator's
    // non-empty answer is asserted alongside. `assemble` has been moderating
    // all through `before`, so there is a log to be shut out of.
    assert.deepEqual(await env.actor.review_queue(50n), [], "the installer review_queue");
    assert.deepEqual(await env.actor.notices(50n), [], "the installer notices");
    assert.deepEqual(await env.actor.costliest({ instructions: null }, 10n), [], "the installer costliest");
    assert.deepEqual((await env.actor.moderation_log([], 25n)).rows, [], "the installer moderation_log");
    assert.ok(
      (await cast.moderator.moderation_log([], 25n)).rows.length > 0,
      "and a real moderator does see the log",
    );
  });

  it("freezes the judges against a moderator, against two of them, and past the installer", async () => {
    assert.equal(await env.actor.judges_frozen(), true);
    refused(
      await cast.moderator.set_judge(HANDLES.pendingJudge, { approved: null }, []),
      "JudgesFrozen",
      "moderator set_judge mid-season",
    );
    // The freeze is the format's integrity rule, so it admits no override, and
    // the strongest form of that is that a quorum cannot beat it either.
    // `Moderation.setJudge` asks about the freeze before it counts votes, so a
    // second signature never even gets recorded.
    refused(
      await cast.seconder.set_judge(HANDLES.pendingJudge, { approved: null }, []),
      "JudgesFrozen",
      "a second moderator set_judge mid-season",
    );
    // The controller used to be the interesting override to rule out here, and
    // it was turned away on the freeze rather than on standing. It no longer
    // reaches the freeze at all: the canister is sealed, so `canModerate` stops
    // it one rule earlier. Two refusals deep instead of one.
    refused(
      await env.actor.set_judge(HANDLES.pendingJudge, { approved: null }, []),
      "NotAllowed",
      "the installer set_judge mid-season",
    );
    assert.deepEqual(
      (await env.actor.profile(HANDLES.pendingJudge))[0].judgeStatus,
      { no: null },
      "launch readiness resolved the application before the irreversible seal",
    );
  });

  it("freezes sponsor decisions with the funding roster at launch", async () => {
    for (const moderator of [cast.moderator, cast.seconder]) {
      refused(
        await moderator.set_sponsor(HANDLES.pendingSponsor, { approved: null }, []),
        "SponsorsFrozen",
        "moderator set_sponsor mid-season",
      );
    }
    assert.deepEqual(
      (await cast.pendingSponsor.me())[0].sponsorStatus,
      { no: null },
      "the pre-launch decision remains unchanged",
    );
  });

  it("lets only hackers submit an entry", async () => {
    for (const name of ["anonymous", "stranger"]) {
      refused(await cast[name].submit_entry(entry("Nope")), "NotRegistered", `${name} submit_entry`);
    }
    // Registered, but holding no hacker role — including the moderator, who
    // gets no submission rights from moderating.
    for (const name of ["observer", "pendingJudge", "judge", "pendingSponsor", "sponsor", "moderator", "spare"]) {
      refused(await cast[name].submit_entry(entry("Nope")), "NotAHacker", `${name} submit_entry`);
    }
    // `errOf` peels one `#Season` wrapper so every tag above reads as it always
    // did. Pin the envelope itself once, here, so that peel can never absorb a
    // later change to the shape without a test noticing.
    assert.deepEqual(
      await cast.observer.submit_entry(entry("Nope")),
      { err: { Season: { NotAHacker: null } } },
      "submit_entry answers Review.Error with the season's own refusal inside it",
    );

    const key = await uploadPackage(cast.hacker);
    allowed(
      await cast.hacker.submit_entry(entry("The Hacker's App", key, "the_hackers_app")),
      "hacker submit_entry",
    );

    // Nothing reaches the bracket unreviewed now, so the queue is where a
    // refusal that failed to refuse would show up: the week below is drawn
    // from what a moderator approved, and approving one revision would hide
    // seven others. Both counts, so neither can cover for the other.
    //
    // Read and approved as the moderator, not the installer: the canister is
    // sealed, so the identity that installed it sees an empty queue and is
    // refused every approval — which is what the first test in this describe
    // asserts directly.
    const queue = await cast.moderator.review_queue(50n);
    assert.equal(queue.length, 1, "exactly one proposal should have got past the gate");
    ok(await cast.moderator.approve_revision(queue[0].id), "approve the hacker's entry");

    const week = await env.actor.season_week(season.id, 1n, 50n);
    assert.equal(week.length, 1, "exactly one entry should exist");
  });

  it("lets a hacker only ever edit their own entry", async () => {
    // New qualifier details still resolve the caller's own one slot. Version
    // updates name an exact row, and the backend binds that id back to the
    // caller before writing it.
    const before = await env.actor.season_week(season.id, 1n, 50n);
    await submitAndApprove(
      cast.moderator,
      hackerTwo,
      "A Second App",
      await uploadPackage(hackerTwo),
      "a_second_app",
    );
    const after = await env.actor.season_week(season.id, 1n, 50n);
    assert.equal(after.length, before.length + 1, "a new row, not an edit of the first");

    const mine = after.find((row) => row.title === "The Hacker's App");
    assert.ok(mine, "the first hacker's entry should be untouched");
  });

  it("lets only the entry's owner publish an update against it", async () => {
    const [owned] = await cast.hacker.my_entry();
    assert.ok(owned, "the owner has an exact update target");
    for (const name of ["anonymous", "stranger"]) {
      refused(
        await cast[name].publish_update(owned.id, { version: "1.0", note: "hi", pkg: [] }),
        "NotRegistered",
        `${name} publish_update`,
      );
    }
    // Registered, but publishing a version is editing an entry and §8 gives
    // that to "the hacker who owns it" — so the role is the first thing asked
    // for, the moderator included.
    for (const name of ["observer", "judge", "sponsor", "moderator"]) {
      refused(
        await cast[name].publish_update(owned.id, { version: "1.0", note: "hi", pkg: [] }),
        "NotAHacker",
        `${name} publish_update`,
      );
    }
    // The role is only the first half of that row; ownership is the other, and
    // a refusal at the role never reaches it. So take the role away as the
    // reason — it is self-service, so each of them can have it for a moment —
    // and ask again. None of them owns the named current row, so the refusal
    // has to move from the role to the exact-target lookup rather than
    // disappear.
    for (const name of ["observer", "judge", "sponsor", "moderator"]) {
      // Nothing to accept on the way in: the one acceptance they made when
      // they registered covers whatever role they take afterwards.
      ok(await cast[name].set_hacker(true), `${name} takes the hacker role`);
      refused(
        await cast[name].publish_update(owned.id, { version: "1.0", note: "hi", pkg: [] }),
        "NotFound",
        `${name} publish_update while hacking but owning nothing`,
      );
      ok(await cast[name].set_hacker(false), `${name} drops the hacker role again`);
      assert.equal((await cast[name].me())[0].hacker, false, `${name} is back as they were`);
    }
    // And the same thing for somebody who never held any other role: a hacker
    // who has entered nothing this week. This is the case the test is named
    // for — the loop at the top stops at the role and never reaches the lookup,
    // so on its own it proves nothing about ownership. Seated in `before`,
    // because the doors shut when the season started.
    refused(
      await idle.publish_update(owned.id, { version: "1.0", note: "hi", pkg: [] }),
      "NotFound",
      "a hacker with no entry publish_update",
    );
    allowed(
      await cast.hacker.publish_update(owned.id, {
        version: "1.0",
        note: "first cut",
        pkg: [],
      }),
      "hacker publish_update",
    );
  });

  it("lets only an approved judge vote", async () => {
    const [target] = await env.actor.season_week(season.id, 1n, 50n);

    for (const name of ["anonymous", "stranger"]) {
      refused(await cast[name].cast_vote(target.id), "NotRegistered", `${name} cast_vote`);
    }
    // Applying is not being approved — the whole point of the judge freeze is
    // that the approved set is what decides.
    for (const name of ["observer", "hacker", "pendingJudge", "pendingSponsor", "sponsor", "moderator", "spare"]) {
      refused(await cast[name].cast_vote(target.id), "NotAJudge", `${name} cast_vote`);
    }
    assert.equal(Number((await env.actor.season_week(season.id, 1n, 50n))[0].votes), 0);

    allowed(await cast.judge.cast_vote(target.id), "approved judge cast_vote");
  });

  it("will not let a judge vote on their own entry", async () => {
    // Roles stack, so a judge may also hack — but not score themselves. And
    // stacking one on costs nothing: the agreement they accepted at
    // registration says it covers the rules for every role they assume.
    ok(await cast.judge.set_hacker(true), "judge takes the hacker role");
    await submitAndApprove(
      cast.moderator,
      cast.judge,
      "The Judge's Own App",
      await uploadPackage(cast.judge),
      "the_judges_own_app",
    );
    // The revision is what `submit_entry` answers with; the entry it became is
    // what a ballot names, and only the author's own view resolves one to the
    // other without searching the week.
    const [own] = await cast.judge.my_entry();
    assert.ok(own, "the judge's app is in the bracket, so it can be voted on");
    refused(await cast.judge.cast_vote(own.id), "OwnEntry", "judge voting on own entry");
    assert.equal(Number((await env.actor.entry_detail(own.id))[0].entry.votes), 0);
  });

  it("will not let one judge withdraw another judge's vote", async () => {
    const week = await env.actor.season_week(season.id, 1n, 50n);
    const voted = week.find((row) => Number(row.votes) > 0);
    assert.ok(voted, "the approved judge's vote should be on the board");

    // The one that gives the test its name: a *seated, approved* judge, who
    // has every voting power the owner of this ballot has, reaching for a
    // ballot that is not theirs. `Season.unvote` keys the lookup on the
    // caller's own id, so there is no argument that names somebody else's.
    refused(await judgeTwo.withdraw_vote(voted.id), "NotFound", "another approved judge withdraw_vote");
    assert.deepEqual((await judgeTwo.me())[0].judgeStatus, { approved: null }, "and they really are one");

    for (const name of ["observer", "hacker", "moderator", "sponsor", "spare"]) {
      refused(await cast[name].withdraw_vote(voted.id), "NotFound", `${name} withdraw_vote`);
    }
    for (const name of ["anonymous", "stranger"]) {
      refused(await cast[name].withdraw_vote(voted.id), "NotRegistered", `${name} withdraw_vote`);
    }

    const still = await env.actor.entry_detail(voted.id);
    assert.equal(Number(still[0].entry.votes), 1, "the vote should still be there");

    // And the judge who cast it can take it back while the week is open.
    allowed(await cast.judge.withdraw_vote(voted.id), "judge withdraw_vote");
    assert.equal(Number((await env.actor.entry_detail(voted.id))[0].entry.votes), 0);
  });

  it("refuses a sweep of a ledger the sponsor never pledged", async () => {
    const unpledged = identity(1232).getPrincipal();
    refused(
      await cast.moderator.sweep_sponsor(HANDLES.sponsor, unpledged),
      "NoLedger",
      "moderator sweeping an unpledged ledger",
    );
  });

  it("refuses a sweep of somebody who is not an approved sponsor", async () => {
    for (const handle of [HANDLES.observer, HANDLES.hacker, HANDLES.pendingSponsor]) {
      refused(
        await cast.moderator.sweep_sponsor(handle, cast.ledger),
        "NotASponsor",
        `moderator sweeping ${handle}`,
      );
    }
  });

  it("lets only an approved sponsor collect their own deposits", async () => {
    for (const name of ["anonymous", "stranger"]) {
      refused(await cast[name].notify_deposits(), "NotRegistered", `${name} notify_deposits`);
    }
    for (const name of ["observer", "hacker", "judge", "moderator", "spare"]) {
      refused(await cast[name].notify_deposits(), "NotASponsor", `${name} notify_deposits`);
    }
    // Pending is not approved: money is only collected once a moderator has
    // checked who the organisation is.
    refused(await cast.pendingSponsor.notify_deposits(), "NotASponsor", "pending sponsor notify_deposits");
  });

  it("holds an approved sponsor to one notification a minute", async () => {
    // §6: a sweep is three inter-canister calls per pledged ledger and the
    // caller decides when it happens, so the window is the abuse control.
    allowed(await cast.sponsor.notify_deposits(), "first notify_deposits");
    refused(await cast.sponsor.notify_deposits(), "TooSoon", "second notify_deposits");

    await env.advance(MINUTE + SECOND);
    passedGate(await cast.sponsor.notify_deposits(), "TooSoon", "notify_deposits after the window");
  });

  it("notify_deposit skips the once-a-minute limit notify_deposits enforces", async () => {
    // the Funding section of the Rules page and §8: "Collect a deposit — the sponsor themselves, once a
    // minute." `notify_deposits` stamps and checks `notifiedAt`; `notify_deposit`
    // does not consult it at all, so a sponsor refused on one method walks
    // straight through the other and keeps the canister talking to ledgers.
    refused(await cast.sponsor.notify_deposits(), "TooSoon", "the window is closed");

    const answers = [];
    for (let i = 0; i < 4; i += 1) {
      answers.push(errOf(await cast.sponsor.notify_deposit(cast.ledger)));
    }
    assert.deepEqual(
      answers,
      ["TooSoon", "TooSoon", "TooSoon", "TooSoon"],
      "every one of these is inside the same closed window and should have been refused",
    );
  });

  it("still refuses notify_deposit from anyone without a profile", async () => {
    for (const name of ["anonymous", "stranger"]) {
      refused(
        await cast[name].notify_deposit(cast.ledger),
        "NotRegistered",
        `${name} notify_deposit`,
      );
    }
  });

  it("refuses notify_deposit from every registered caller who is not an approved sponsor", async () => {
    // `notify_deposit` has no `sponsorStatus` check of its own — the whole row
    // of §8 rests on `Treasury.sweep` re-deriving the caller's standing from
    // their handle. The singular method was only ever tested against callers
    // with no profile at all, which is the one group a *missing* status check
    // would still turn away. This is the group that would walk through.
    for (const name of ["observer", "hacker", "pendingJudge", "judge", "moderator", "spare"]) {
      refused(
        await cast[name].notify_deposit(cast.ledger),
        "NotASponsor",
        `${name} notify_deposit`,
      );
    }
    // Applied but not approved: §6 says money is only collected once a
    // moderator has checked who the organisation is.
    refused(
      await cast.pendingSponsor.notify_deposit(cast.ledger),
      "NotASponsor",
      "pending sponsor notify_deposit",
    );
    // And an approved sponsor still cannot name a ledger they never pledged.
    refused(
      await cast.sponsor.notify_deposit(identity(1234).getPrincipal()),
      "NoLedger",
      "sponsor notify_deposit on an unpledged ledger",
    );
  });

  it("keeps the sponsor funding set frozen without changing anybody else's withdrawal", async () => {
    // One principal's housekeeping used to close a *different* principal's
    // `withdraw`. The allowlist came from `Treasury.ledgersInPlay`, which walks
    // the `#approved` bucket of `bySponsorHandle` — so the moment the last
    // approved sponsor of a token stopped being approved, that token left the
    // allowlist and `withdraw` answered `#BadDestination` to every holder of
    // rewards in it. the Trust section of the Rules page makes withdrawing "the winner, from their own
    // account only", and §7 is explicit that the only thing a caller chooses is
    // where their own money goes; nothing conditions it on who is sponsoring.
    //
    // The allowlist is now the caller's own payout rows, so the answer here
    // must not move when somebody else acts. `money.test.mjs` carries the other
    // half — an actual winner reaching an actual balance with no sponsor left.
    const elsewhere = { owner: identity(1233).getPrincipal(), subaccount: [] };
    assert.equal((await env.actor.treasury_ledgers()).length, 1, "the pledged ledger is in play");

    const before = await cast.hacker.withdraw(cast.ledger, elsewhere);
    refused(await cast.sponsor.withdraw_sponsor(), "Settling", "sponsor withdraws sponsorship");
    const ledgersAfter = (await env.actor.treasury_ledgers()).length;
    const after = await cast.hacker.withdraw(cast.ledger, elsewhere);

    assert.equal(ledgersAfter, 1, "the sponsor remains in the frozen approved set");
    assert.deepEqual((await cast.sponsor.me())[0].sponsorStatus, { approved: null });
    assert.deepEqual(
      after,
      before,
      "somebody else's sponsorship changed this caller's answer: " +
        `${show(before)} before, ${show(after)} after`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("authorization once a season has finished", () => {
  let env;
  let cast;
  let season;

  before(async () => {
    env = await bootstrap({ controller: identity(1240) });
    // Before the seal, and it has to be: `seal_canister` removes the external
    // controller, so the two moderators `assemble` appoints must exist first.
    cast = await assemble(env, 1240);
    const draft = ok(await cast.moderator.create_season(), "create_season");
    // The draft and complete launch cast are prerequisites for throwing away
    // the only authority that could repair them. Starting remains a moderator
    // action after the seal.
    await seal(env);
    season = ok(await cast.moderator.start_season(draft.id), "start_season");
    // Six weeks of calendar. There is no early close for anybody any more, so
    // the only way to a finished season is to let each deadline pass — which
    // is what `closeWeek` does, and it answers with the season rather than a
    // Result because nothing was asked of the canister.
    //
    // The sixth close does one more thing: it arms the distribution. Nobody
    // proposes it and nobody approves it. Here it can never finish — the only
    // pledged "ledger" is this canister, which answers no ICRC-1 call, so
    // `draftFor` leaves it out of the plan and there is nothing to write. That
    // is the state the whole describe runs in, and it is what makes the settle
    // lock observable at all: `Season.settling` stays true for as long as the
    // payout has not landed.
    //
    // Nothing about finishing changes who controls the canister, because
    // nothing in the ordinary flow can: everything below runs against the
    // exact self-only controller list.
    for (let week = 0; week < 6; week += 1) await closeWeek(env);
  });

  after(async () => {
    await env?.teardown();
  });

  it("has finished, with its historical judge roster still frozen", async () => {
    assert.equal(await env.live(), null);
    assert.equal(await env.actor.judges_frozen(), true);
    const [row] = await env.actor.season_by_number(1n);
    assert.deepEqual(row.phase, { finished: null });
  });

  it("refuses every entry and every vote once the season is over", async () => {
    refused(await cast.hacker.submit_entry(entry("Too late")), "NoSeason", "hacker submit_entry");
    refused(await cast.judge.cast_vote(1n), "NoSeason", "judge cast_vote");
    refused(
      await cast.hacker.publish_update(0n, { version: "2.0", note: "late", pkg: [] }),
      "NoSeason",
      "hacker publish_update",
    );
  });

  it("starts final funding reconciliation before any distribution", async () => {
    // The last week first closes public funding and reconciles every frozen
    // sponsor/ledger pair. Payout stays unarmed until that persisted cutoff is
    // complete.
    //
    // What it found here was a "ledger" that is this canister, which answers
    // no ICRC-1 call. `draftFor` leaves a ledger it cannot read out of the
    // plan entirely rather than planning it at zero, so it had no pool to
    // divide and wrote nothing at all.
    await env.pic.tick(10);
    assert.deepEqual(await env.actor.payout_plan(season.id), [], "no line can be drafted blind");
    const [row] = await env.actor.season_by_number(1n);
    assert.deepEqual(row.payout, { none: null }, "an empty plan is not written at all");
    assert.equal(row.fundingReady, false);
    assert.ok(row.fundingAttempts >= 1n, "the first reconciliation pass ran");
    assert.equal(await env.actor.funding_closing(), true);
    assert.equal(await env.actor.payout_armed(), false, "payout cannot race reconciliation");
  });

  it("is still sealed once the season is over, with nothing to wait for", async () => {
    // A season ending used to be the event that started a clock on handing the
    // external keys back. There is no hand-back clock: the list became
    // self-only before the first season, and a finished season is simply a
    // later moment at which it is still self-only. The distribution here can never settle
    // — see `before` — and that no longer bears on anybody's standing, which is
    // worth pinning precisely because the two used to be entangled.
    await sealed(env, "settling");
    assert.equal(await env.actor.is_controller(), false, "the installer is still shut out");
    assert.equal(await env.actor.am_moderator(), false, "and still not a moderator");

    // The strongest form of "the keys do not come back" is that there is
    // nothing to ask for and no date to wait for — not a hand-back that
    // refuses, but no hand-back on the interface at all. Same shape as the
    // `close_week` and `approve_payout` rows above.
    assert.equal(
      typeof env.actor.release_controllers,
      "undefined",
      "there is no hand-back to ask for, early or late",
    );
    assert.equal(typeof env.actor.controllers_due_at, "undefined", "and no deadline to wait for");
    // The only door on the interface is the one already walked through, and it
    // is refused now because the former installer is not a controller.
    assert.ok("err" in (await env.actor.seal_canister()), "sealing is the one-way door it was");
  });

  it("permanently freezes participant writes after the season", async () => {
    // `Season.settling` is true from the moment the final week closes until the
    // money has gone out — paid, or definitively failed. That is the whole of
    // it now; there is no second condition about controllers coming back,
    // because they do not. It is a money rule rather than tidiness: a payout
    // row freezes its destination at draft
    // so every attempt is byte-identical and the ledger's own deduplication
    // collapses a retry into one payment. A wallet edited between attempt one
    // and attempt two would make the second a *different* transfer, dedup
    // would not fire, and the winner would be paid twice. So the wallet stops
    // moving, and with it everything else that describes the account.
    //
    // Nothing here can ever settle — see `before` — which is what lets this
    // suite ask the question at all.
    const input = {
      // Deliberately a handle somebody already holds: if the lock ever came
      // off, the two callers below would be refused for that instead of
      // renaming themselves, so a regression cannot quietly mutate the cast.
      handle: HANDLES.spare,
      displayName: "renamed",
      title: [],
      bio: "",
      links: [],
      terms: true,
    };
    refused(await cast.spare.update_profile(input), "Settling", "spare update_profile");
    refused(await cast.spare.set_wallet(walletFor(1248)), "Settling", "spare set_wallet");
    refused(await cast.spare.set_agent([]), "Settling", "spare set_agent");
    refused(await cast.spare.set_reward_opt_out(true), "Settling", "spare set_reward_opt_out");
    refused(await cast.spare.set_hacker(true), "Settling", "spare set_hacker");
    refused(await cast.spare.set_avatar([]), "Settling", "spare set_avatar");
    refused(await cast.spare.apply_as_judge(), "Settling", "spare apply_as_judge");
    refused(await cast.sponsor.withdraw_sponsor(), "Settling", "sponsor withdraw_sponsor");
    refused(
      await cast.spare.delete_account(),
      "an account cannot be deleted until the season's rewards have gone out",
      "spare delete_account",
    );
    // The files are locked with the rows, and for the same reason the rest of
    // it is: a settled season's record is what the plan was computed from.
    refused(
      await cast.hacker.my_upload(store(`/u/${await idOf(cast.hacker)}/icon/9.png`)),
      "uploads are permanently closed after the season finishes",
      "hacker my_upload",
    );

    // No override, and the ordering is the evidence. The installer holds no
    // profile row at all, so `update_profile` would ordinarily answer
    // `#NotRegistered` — hearing `#Settling` instead means the lock is asked
    // about before standing is, exactly as the judge freeze is. And it is not a
    // controller either, which is what makes "no override" a fact about the
    // canister rather than a promise about a person.
    refused(await cast.moderator.update_profile(input), "Settling", "moderator update_profile");
    refused(await env.actor.update_profile(input), "Settling", "the installer update_profile");

    // A write lock, not a blackout: everything is still readable while the
    // distribution is worked out, which is what makes it auditable.
    assert.equal((await cast.spare.me())[0].handle, HANDLES.spare, "and they can still read");
    assert.equal((await cast.spare.me())[0].displayName, HANDLES.spare, "nothing was renamed");
  });

  it("keeps manual distribution closed until funding reconciliation is ready", async () => {
    for (const [name, who] of everyoneBut(cast, "moderator")) {
      refused(await who.propose_payout(season.id), "NotAllowed", `${name} propose_payout`);
    }
    // Authorised: the refusal is about the persisted funding cutoff, not standing.
    refused(await cast.moderator.propose_payout(season.id), "WrongPhase", "moderator propose_payout");
    // And the installer is on the other side of that line, for good.
    // `propose_payout` is `canModerate`-gated and the former installer is no
    // longer a controller, so the identity that installed this
    // canister is refused on standing exactly like the observer in the loop
    // above, and will be for the whole life of the one season it runs.
    refused(await env.actor.propose_payout(season.id), "NotAllowed", "the installer propose_payout");
  });

  it("keeps manual distribution recovery to current moderators", async () => {
    // One rule where there used to be two, and the seal is why. Both of the
    // controller-gated steps — signing a plan off and throwing one away — are
    // gone from the interface rather than refused, because a sealed canister
    // has no external ingress controller and a gate nobody can pass is a season that
    // can never settle.
    //
    // `run_payout` is the moderator fallback for a distribution whose timer
    // stopped while the canister was frozen. Amounts and destinations still
    // come only from the immutable plan; the gate prevents arbitrary callers
    // from making the canister spend cycles on a due payout pass.
    for (const [name, who] of everyoneBut(cast, "anonymous", "stranger", "moderator")) {
      refused(await who.run_payout(season.id), "NotAllowed", `${name} run_payout`);
    }
    refused(await cast.anonymous.run_payout(season.id), "NotAllowed", "anonymous run_payout");
    refused(await cast.stranger.run_payout(season.id), "NotAllowed", "stranger run_payout");
    // After sealing, the former installer also has no standing.
    refused(await env.actor.run_payout(season.id), "NotAllowed", "the installer run_payout");
    passedGate(
      await cast.moderator.run_payout(season.id),
      "NotAllowed",
      "moderator run_payout",
    );
    passedGate(
      await cast.seconder.run_payout(season.id),
      "NotAllowed",
      "second moderator run_payout",
    );

    // Neither missing step is refused, both are absent — `Payout.draft` marks a
    // plan `#approved` the moment it writes it, so there is no `#proposed`
    // phase for anybody to sign, and nothing for a discard to find. A plan is
    // auditable by `payout_plan` rather than blockable.
    assert.equal(typeof env.actor.approve_payout, "undefined", "nobody signs a distribution off");
    assert.equal(typeof env.actor.discard_payout, "undefined", "and nobody throws one away");
    assert.equal(typeof cast.moderator.discard_payout, "undefined", "a moderator least of all");

    // Honest about its own weight: no plan could be drafted here (no ledger
    // answers, so `propose_payout` said `#Empty`), which means this line is a
    // tautology and not evidence that any of the refusals above held. The
    // refusals are the evidence; whether money can move against an approved
    // plan — and that a plan arrives approved — belongs to money.test.mjs,
    // which has real ledgers.
    assert.deepEqual(await env.actor.payout_plan(season.id), [], "nothing was drafted");
  });

  it("refuses the next season to everybody, the moderator included", async () => {
    // The last standing question this canister ever answers, and the two
    // refusals below are not the same refusal. Everybody without standing is
    // stopped at the gate — `canModerate` runs before anything looks at the
    // season table, as it does everywhere in this file. The moderator gets
    // past the gate and is stopped by the rule: one canister, one season, so
    // the season that has just finished is the only one there will ever be
    // here and the next one belongs to a canister nobody has deployed yet.
    for (const [name, who] of everyoneBut(cast, "moderator")) {
      refused(await who.create_season(), "NotAllowed", `${name} create_season`);
    }
    // The identity that installed the canister is in with them rather than
    // above them, and it is the interesting member of the group: this is the
    // principal that sealed the canister in `before`.
    refused(await env.actor.create_season(), "NotAllowed", "the installer create_season");
    const theirs = await cast.moderator.create_season();
    refused(theirs, "Invalid", "moderator create_season");
    assert.match(theirs.err.Invalid, /already has one/, "refused by the rule, not by standing");

    // Nor is the finished season something to run again. `Season.start` takes
    // drafts only, and after this there is no draft on the canister to find —
    // so a decided bracket has no route back into being an open one, for the
    // single authority the seal left standing least of all.
    for (const [name, who] of everyoneBut(cast, "moderator")) {
      refused(await who.start_season(season.id), "NotAllowed", `${name} start_season`);
    }
    refused(await env.actor.start_season(season.id), "NotAllowed", "the installer start_season");
    refused(await cast.moderator.start_season(season.id), "Invalid", "moderator start_season");

    assert.equal(await env.live(), null, "so nothing is running, and nothing can be");
    await sealed(env, "a canister with its one season behind it");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("an automation principal has participant authority and narrowly delegated app review", () => {
  let env;
  let owner;
  let robot;
  let second;
  let hackerActor;
  let ownerId;
  let pendingRevisionId;
  let targetEntryId;
  let agentEntryId;

  before(async () => {
    env = await bootstrap();

    owner = await register(env.as, identity(1900), "auto_mod");
    ownerId = (await owner.me())[0].id;
    ok(await env.actor.set_moderator("auto_mod", true, []), "appoint");
    ok(await owner.set_wallet(walletFor(1900)), "wallet");
    ok(await owner.set_hacker(true), "hacker role");
    ok(await owner.apply_as_judge(), "judge application");
    ok(await env.actor.set_judge("auto_mod", { approved: null }, []), "approve judge");

    // The agent is a second key for ordinary project automation. It resolves
    // to this account for builds, entries, votes, and the narrow app-review
    // workflow, but never supplies the owner's principal to any other
    // privilege- or money-bearing method.
    robot = env.as(identity(1901));
    ok(await owner.set_agent([identity(1901).getPrincipal()]), "nominate the agent");

    second = await register(env.as, identity(1902), "auto_mod_two");
    ok(await env.actor.set_moderator("auto_mod_two", true, []), "appoint a second");

    hackerActor = await hacker(env, 1903, "auto_hacker");
    const packageKey = await uploadPackage(hackerActor);

    const draft = ok(await owner.create_season(), "create");
    ok(await env.seal(), "seal");
    ok(await owner.start_season(draft.id), "start");

    pendingRevisionId = ok(
      await hackerActor.submit_entry(entry("Automated target", packageKey, "auto_hacker_app")),
      "submit target",
    ).id;
  });

  after(async () => await env?.teardown());

  it("reviews a foreign app with one decision but does not inherit the moderator flag", async () => {
    const ordinaryAgent = env.as(identity(1904));
    ok(
      await hackerActor.set_agent([identity(1904).getPrincipal()]),
      "nominate a non-moderator agent",
    );
    assert.deepEqual(await ordinaryAgent.review_queue(10n), []);
    assert.equal(await ordinaryAgent.review_pending(), 0n);
    refused(
      await ordinaryAgent.approve_revision(pendingRevisionId),
      "NotAllowed",
      "an ordinary account's agent cannot review",
    );

    assert.equal((await robot.me())[0].handle, "auto_mod");
    assert.equal(await robot.am_moderator(), false, "the agent is not a general moderator");
    assert.deepEqual(
      (await robot.review_queue(10n)).map(({ id }) => id),
      [pendingRevisionId],
      "the delegated reviewer sees the ordinary app queue",
    );
    assert.equal(await robot.review_pending(), 1n);
    assert.deepEqual(await robot.notices(10n), []);
    assert.deepEqual(await robot.costliest({ instructions: null }, 5n), []);
    refused(await robot.wake_automation(), "NotAllowed", "agent wake_automation");

    const decided = ok(
      await robot.approve_revision(pendingRevisionId),
      "one delegated review approves the app",
    );
    assert.deepEqual(decided.state, { approved: null });
    assert.deepEqual(decided.reviewer, [ownerId], "the decision belongs to the moderator account");
    assert.equal(await robot.review_pending(), 0n, "the one decision settles the queue item");
    refused(
      await robot.approve_revision(pendingRevisionId),
      "NotPending",
      "a second approval is neither required nor accepted",
    );
    refused(
      await robot.set_judge("auto_hacker", { approved: null }, []),
      "NotAllowed",
      "agent set_judge",
    );

    targetEntryId = (await hackerActor.my_entry())[0].id;
  });

  it("can upload, submit and revise the owner's project", async () => {
    const first = await uploadPackage(robot, 1);
    const proposed = ok(
      await robot.submit_entry(entry("Agent-built project", first, "auto_mod_app")),
      "agent submit",
    );
    refused(
      await robot.approve_revision(proposed.id),
      "NotAllowed",
      "the moderator agent cannot approve its owner's app",
    );
    refused(
      await robot.reject_revision(proposed.id, "self review"),
      "NotAllowed",
      "the moderator agent cannot reject its owner's app",
    );
    ok(await second.approve_revision(proposed.id), "approve agent submission");
    agentEntryId = (await robot.my_entry())[0].id;

    const secondBuild = await uploadPackage(robot, 2);
    const revision = ok(
      await robot.publish_update(agentEntryId, {
        version: "1.1.0",
        note: "built by the nominated automation key",
        pkg: [{ key: secondBuild }],
      }),
      "agent publish_update",
    );
    refused(
      await robot.approve_revision(revision.id),
      "NotAllowed",
      "the moderator agent cannot approve its owner's update",
    );
    refused(
      await robot.reject_revision(revision.id, "self review"),
      "NotAllowed",
      "the moderator agent cannot reject its owner's update",
    );
    ok(await second.approve_revision(revision.id), "approve agent update");
    const [detail] = await env.actor.entry_detail(agentEntryId);
    assert.equal(detail.entry.pkg[0].key, secondBuild);
  });

  it("can reject a foreign update with one decision", async () => {
    const revision = ok(
      await hackerActor.publish_update(targetEntryId, {
        version: "1.1.0",
        note: "send this foreign update through the bot review path",
        pkg: [],
      }),
      "foreign update",
    );
    const reason = "the automated review found a problem";
    const decided = ok(await robot.reject_revision(revision.id, reason));
    assert.deepEqual(decided.state, { rejected: null });
    assert.deepEqual(decided.reviewer, [ownerId], "the decision belongs to the moderator account");
    assert.equal(decided.reason, reason);
    assert.equal(await robot.review_pending(), 0n, "the one decision settles the queue item");
    refused(
      await robot.reject_revision(revision.id, "a second vote"),
      "NotPending",
      "one rejection settles the review",
    );
  });

  it("casts the owner's vote without creating a second voting identity", async () => {
    allowed(await robot.cast_vote(targetEntryId), "agent cast_vote");
    refused(await owner.cast_vote(targetEntryId), "AlreadyVoted", "owner repeats agent vote");
    refused(await robot.cast_vote(agentEntryId), "OwnEntry", "agent votes on owner entry");
    assert.equal(await robot.my_votes_left(), 1n);
  });

  it("cannot change roles, profile, delegation or money settings", async () => {
    refused(await robot.set_hacker(false), "NotRegistered", "agent set_hacker");
    refused(await robot.set_wallet(walletFor(1901)), "NotRegistered", "agent set_wallet");
    refused(await robot.set_agent([]), "NotRegistered", "agent set_agent");
    refused(await robot.set_reward_opt_out(true), "NotRegistered", "agent reward opt-out");
    refused(
      await robot.update_profile(signup("auto_mod")),
      "NotRegistered",
      "agent update_profile",
    );
    refused(
      await robot.apply_as_sponsor({
        org: "Robot Ltd",
        blurb: "",
        website: "",
        logo: [],
        ledgers: [{ id: env.launchLedger, sns: false }],
      }),
      "NotRegistered",
      "agent apply_as_sponsor",
    );
    refused(
      await robot.withdraw(env.launchLedger, { owner: walletFor(1901), subaccount: [] }),
      "NotRegistered",
      "agent withdraw",
    );
    assert.deepEqual(await robot.my_reward_account(), []);
    refused(await robot.delete_account(), "not registered", "agent delete_account");

    const [unchanged] = await owner.me();
    assert.equal(unchanged.hacker, true, "the owner's roles did not move");
    assert.equal(
      unchanged.agent[0].toText(),
      identity(1901).getPrincipal().toText(),
      "the agent could not replace its own delegation",
    );
  });

  it("loses review access immediately when the owner removes the delegation", async () => {
    ok(await owner.set_agent([]), "stand down the agent");
    assert.deepEqual(await robot.review_queue(10n), []);
    assert.equal(await robot.review_pending(), 0n);
    refused(await robot.approve_revision(0n), "NotAllowed", "former agent approve_revision");
    refused(
      await robot.reject_revision(0n, "no longer delegated"),
      "NotAllowed",
      "former agent reject_revision",
    );
  });
});
