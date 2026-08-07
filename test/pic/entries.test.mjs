/**
 * Entries — one hacker's project for one week, and the files it points at.
 *
 * the Build section of the Rules page is the specification here. An entry is a row of *keys* into the
 * certified store, so the interesting rules are all about which key a row may
 * name, who may write the bytes behind it, and when both stop being writable.
 * None of that can be checked without a real asset store and a clock, which is
 * why it lives in the PocketIC suite rather than under `ash`.
 *
 * Four things shape every test below:
 *
 *  * `submit_entry` and `publish_update` no longer write to the bracket. They
 *    answer with a **revision** in `#pending`, and nothing is visible until a
 *    moderator calls `approve_revision`. Anything asserting about the *entry*
 *    therefore walks both halves; anything asserting a *refusal* stops at the
 *    proposal, which is where the refusal happens.
 *  * An entry must name a `.neutron` package that has already been uploaded, so
 *    every input carries a real key and every block uploads one first.
 *  * A hacker with no reward wallet cannot submit at all (`#NoWallet`), so each
 *    block's cast is registered *and* made payable before it does anything.
 *  * Every entry carries a permanent app id — `a-z` and `_`, unchangeable once
 *    set — so each hacker's input factory is built with one and keeps it.
 *  * The final week closing **freezes every participant write** until the
 *    season's rewards have gone out: `my_upload` answers "files are locked
 *    until the season's rewards have been distributed" and a profile write
 *    answers `#Settling`. Nothing in this file sponsors a season, so no ledger
 *    is ever read and no plan is ever drafted — which makes that lock the
 *    terminal state of the last block rather than a moment to wait out.
 *
 * Registration also shuts the moment a season starts and does not reopen until
 * it finishes, and no interface advances a week by hand any more, so anybody a
 * block needs signs up in its `before` and the bracket moves by the clock.
 *
 * And the ordering constraint that shapes every block here: **the complete
 * draft and launch cast exist before sealing, but the season starts only
 * afterwards, and the canister stays self-only.**
 * `seal_canister()` leaves exactly the canister itself as controller and
 * removes every external controller. So the
 * site's central claim, that the rules did not change once the entries were
 * in, is something a participant checks by asking the replica who controls the
 * canister rather than something they take on trust. `start_season` checks the
 * same thing on the way in and refuses while anybody still holds a key.
 *
 * `Profiles.canModerate` is `Principal.isController(caller) or user.moderator`,
 * so the bootstrap controller is an implicit moderator right up to the seal and
 * nothing at all afterwards — it has no profile row, so the second half is
 * false too — and `approve_revision`, which every entry in this file has to go
 * through, refuses it for good. Everything else gated on `isController` goes
 * dark with it: `set_moderator`, `set_config`, `set_instruction_cap`,
 * `assets_upload`. So each block's `before` does the irreversible things in the
 * only order that works — appoint the review desk, upload what the tests need,
 * *then* `seal_canister()` — and drafts and starts its season as a **moderator**,
 * which is the only authority left once the keys are gone.
 *
 * Identities 1600-1799.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  bootstrap,
  closeWeek,
  identity,
  ok,
  phaseOf,
  register,
  walletFor,
  DAY,
  SECOND,
  WEEK,
} from "./harness.mjs";

/** A blob of `n` bytes — the only property an upload limit looks at. */
const bytes = (n) => new Uint8Array(n).fill(0x61);

/**
 * A whole upload in one command. Every user-facing folder caps `maxChunks` at
 * one, so a user asset always arrives complete or not at all.
 */
const store = (key, size, contentType = "image/png") => ({
  store: {
    key,
    contentType,
    contentEncoding: "identity",
    chunks: 1n,
    content: bytes(size),
  },
});

const del = (key) => ({ delete: { key } });

/** `/u/<id>/` — keyed on the id the canister assigns, never on the handle. */
const scopeOf = (user) => `/u/${user.id}/`;

const meOf = async (actor) => (await actor.me())[0];

/** Fetch one exact asset without reopening `/u/` as a public directory index. */
const fetchAsset = (env, key) =>
  env.actor.http_request({
    url: key,
    method: "GET",
    body: new Uint8Array(),
    headers: [],
    certificate_version: [],
  });

const assetExists = async (env, key) => (await fetchAsset(env, key)).status_code === 200;

/**
 * The maker of entry inputs for one hacker.
 *
 * `pkg` is not optional: §3 says an entry is an app, so the row has to name a
 * build and `checkEntry` refuses a key with no finished upload behind it. Each
 * block uploads `<name>.neutron` into its hacker's own `pkg/` and builds its
 * inputs against that key, so a test about titles is not also a test about
 * packages.
 *
 * `slug` is the app's permanent id: 5 to 50 characters of `a-z` and `_`, and
 * nothing else — no digits, no capitals, no hyphens. It is baked into the
 * factory rather than passed per call because `Season.checkSlug` refuses an
 * edit that names a different one ("an app id cannot be changed once it is
 * set"), so every input one hacker ever builds has to carry the same one. It
 * must also be unique across users, so each is derived from its owner's
 * handle.
 */
const entriesFor = (scope, name, slug) => (over = {}) => ({
  title: "A project",
  summary: "",
  url: "",
  icon: [],
  shots: [],
  links: [],
  pkg: { key: `${scope}pkg/${name}.neutron` },
  slug,
  ...over,
});

/** Put a real build behind `<scope>pkg/<name>.neutron`. */
const uploadPkg = async (who, scope, name, size = 64) =>
  ok(
    await who.my_upload(store(`${scope}pkg/${name}.neutron`, size, "application/octet-stream")),
    `upload ${name}.neutron`,
  );

/**
 * Propose something and have a moderator agree to it.
 *
 * `desk` is a real moderator's actor and never `env.actor`. The controller used
 * to be an implicit moderator and so used to be the review desk, but the
 * canister is sealed before the drafted season starts and `canModerate` reads
 * `isController` live, so from the first entry to the last the controller is
 * refused `approve_revision` outright. Every block below appoints its desk in
 * `before`, ahead of `seal_canister()`, because `set_moderator` is
 * controller-only and afterwards there is no external controller.
 *
 * Returns the revision; the entry it produced is read back through `my_entry`,
 * which is the only thing that proves it reached the bracket.
 */
const land = async (desk, proposal, what = "propose") => {
  const rev = ok(await proposal, what);
  ok(await desk.approve_revision(rev.id), `approve ${what}`);
  return rev;
};

/**
 * `submit_entry` and `publish_update` answer with `Review.Error`, which wraps
 * everything the entry rules themselves refuse under `Season`.
 */
const refused = (e) => ({ err: { Season: e } });

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The seal itself, which every other block in this file takes as given.
 *
 * Its own canister because the interesting half is the *before* — a state no
 * other block that runs a season can be in, since each of them seals in its
 * `before` hook and there is no undoing it.
 */
describe("sealing the canister self-only", () => {
  let env;
  let mod;
  let draftId;

  before(async () => {
    env = await bootstrap();
    // Appointed while there is still somebody who can appoint: `set_moderator`
    // is controller-only and the seal is minutes away. Everything a season will
    // ever need has to be arranged in this window — moderators, the frontend,
    // the instruction allowance — because afterwards the only authority that
    // exists is what the installed code already grants.
    mod = await register(env.as, identity(1640), "seal_mod");
    ok(await env.actor.set_moderator("seal_mod", true, []), "appoint the review desk");
  });

  after(async () => {
    await env?.teardown();
  });

  it("refuses to start a season before the exact self-only seal", async () => {
    // The fixture installed with two controllers — the deployer and the
    // canister itself, the second so that `update_settings` on itself is
    // permitted at all. Before sealing both remain external evidence that the
    // launch transition has not happened.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()).sort(),
      [env.canisterId.toText(), env.controller.getPrincipal().toText()].sort(),
      "the deployer and the canister, which is what setup leaves behind",
    );

    // Drafting is already a moderator's call — it has to be, since after the
    // seal a controller gate would be a gate nobody could ever pass, and this
    // canister's one season would never be drafted at all.
    const draft = ok(await mod.create_season(), "draft");
    draftId = draft.id;

    const early = await mod.start_season(draftId);
    assert.ok("err" in early && "Invalid" in early.err, `refused, got ${JSON.stringify(early)}`);
    // Named, not generic: the caller is being told the one thing they have to
    // do next and that it cannot be taken back.
    assert.match(early.err.Invalid, /not sealed/);
    assert.match(early.err.Invalid, /seal_canister/);
    // And it really did not start — a refusal that half-started a season would
    // be worse than no check at all.
    assert.equal(phaseOf((await env.actor.seasons(1n))[0]), "draft");
  });

  it("takes a controller to seal, and there is exactly one chance to do it", async () => {
    // A moderator may start a season but may not decide the canister's fate.
    assert.deepEqual(await mod.seal_canister(), { err: "caller is not a controller" });

    ok(await env.seal(), "seal");

    // The whole point, read from PocketIC's replica state rather than a field
    // this canister wrote about itself.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the canister itself is the sole controller",
    );

    // And no second chance to do anything with it: `seal_canister` is
    // controller-gated like everything else, so the former deployer can no
    // longer reach it.
    assert.deepEqual(await env.actor.seal_canister(), { err: "caller is not a controller" });
  });

  it("takes every controller-only power with it, permanently", async () => {
    // `Principal.isController` is read live on every call, so nothing had to be
    // recorded and nothing can be un-recorded: the identity that installed this
    // canister is a stranger to it from here on.
    assert.deepEqual(await env.actor.set_config("Sealed", true), {
      err: "caller is not a controller",
    });
    assert.deepEqual(await env.actor.set_instruction_cap(1_000_000n), {
      err: "caller is not a controller",
    });
    assert.deepEqual(await env.actor.set_moderator("seal_mod", false, []), {
      err: { NotAllowed: null },
    });
    // The frontend is frozen with the code: `assets_upload` is how site-owned
    // bytes get in, and the former deployer is no longer a controller. Whatever was
    // uploaded before the seal is what this canister serves for the rest of its
    // life, which is why the upload has to come first.
    assert.deepEqual(
      await env.actor.assets_upload(store("/assets/late.js", 16, "text/javascript")),
      { err: "caller is not a controller" },
    );

    // The implicit moderator goes too, by the same live read. A controller who
    // could still moderate a sealed season would be a hole straight through the
    // claim: the rules could not change, but who applies them could.
    assert.equal(await env.actor.am_moderator(), false, "the deployer moderates nothing");
    assert.equal(await mod.am_moderator(), true, "the appointed desk is untouched");
    assert.deepEqual(await env.actor.create_season(), { err: { NotAllowed: null } });
  });

  it("can never be upgraded again", async () => {
    // The consequence that is not a method on this interface and so cannot be
    // asserted through one: `install_code` is a management call gated on the
    // controller list, and the former deployer has been removed. The replica refuses it outright,
    // which surfaces here as a rejected call rather than an `err`.
    const failed = await env.upgrade().then(() => null, (err) => err);
    assert.ok(failed, "the former deployer must not upgrade a sealed canister");
    // For the reason that matters, not merely for some reason: an upgrade that
    // failed on a bad module or a transient replica error would look identical
    // here and would say nothing at all about the seal.
    assert.match(String(failed?.message ?? failed), /controller/i);
    // Still alive and still itself afterwards — a refused upgrade is a refusal,
    // not damage.
    assert.equal(await env.actor.am_moderator(), false);
  });

  it("lets a moderator start the season the controller no longer can", async () => {
    // The gate the seal forces. `start_season` asks the management canister
    // again on this call rather than trusting that it asked earlier, so what is
    // being checked is the state of the world now.
    assert.deepEqual(await env.actor.start_season(draftId), { err: { NotAllowed: null } });
    const season = ok(await mod.start_season(draftId), "start");
    assert.equal(Number(season.week), 1);
    assert.equal(phaseOf(season), "running");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("submitting an entry", () => {
  let env;
  let alice, bob, watcher, judge, mod;
  let aliceScope, bobScope;
  let entryInput, bobInput;
  let season;
  let draftId;

  before(async () => {
    env = await bootstrap();

    // A hacker has to say where they would be paid before they may submit at
    // all: `Review.proposeEntry` answers `#NoWallet` otherwise, on the grounds
    // that finding out a winner never filled it in on distribution day is too
    // late. `walletFor` is a principal other than the one they signed in with,
    // which is the one thing `setWallet` insists on.
    alice = await register(env.as, identity(1600), "hack_alice");
    ok(await alice.set_wallet(walletFor(1600)), "alice is payable");
    // Nothing else to accept. Registration carries one `terms` box covering
    // the common rules and the rules of every role, so taking the hacker role
    // asks for no second signature — `setHacker` reads the row and writes it.
    ok(await alice.set_hacker(true), "alice hacks");
    bob = await register(env.as, identity(1601), "hack_bob");
    ok(await bob.set_wallet(walletFor(1601)), "bob is payable");
    ok(await bob.set_hacker(true), "bob hacks");
    // Payable, but not a hacker — so the refusal the watcher gets below can
    // only be about the role and not about a wallet they never set.
    watcher = await register(env.as, identity(1602), "watcher");
    ok(await watcher.set_wallet(walletFor(1602)), "watcher is payable");

    // The judge freezes the instant the season starts, so approve first. The
    // controller can still do this alone *here* and only here: it is still a
    // controller until `seal_canister()` empties the list, and `Moderation.
    // quorum` lets a controller with no profile row through without a second
    // signature. Sealing closes that escape hatch for good, which is why
    // everything else this block needs is set up now.
    judge = await register(env.as, identity(1604), "hack_judge");
    ok(await judge.apply_as_judge(), "apply");
    ok(await env.actor.set_judge("hack_judge", { approved: null }, []), "approve");

    // The review desk for the rest of the block. Every entry below is a
    // proposal that somebody has to approve, and after the seal the controller
    // is not that somebody — so a real moderator is appointed while there is
    // still a controller to appoint one. There is no appointing one later.
    mod = await register(env.as, identity(1605), "hack_mod");
    ok(await env.actor.set_moderator("hack_mod", true, []), "appoint the review desk");

    aliceScope = scopeOf(await meOf(alice));
    bobScope = scopeOf(await meOf(bob));

    // The build every entry below points at. Uploaded once, so the tests are
    // about the rest of the row.
    await uploadPkg(alice, aliceScope, 100);
    await uploadPkg(bob, bobScope, 100);
    entryInput = entriesFor(aliceScope, 100, "hack_alice_app");
    bobInput = entriesFor(bobScope, 100, "hack_bob_app");

    // A production seal accepts only a complete launch: the immutable draft,
    // full moderator/judge bench, decided applications, sponsor/ledger roster,
    // and closed registration all have to exist before the controller list is
    // discarded. Everything
    // above had to happen first because none of it is possible afterwards —
    // there is no appointing a moderator, no approving a judge, no changing a
    // setting and no new code, for the rest of this canister's life.
    const draft = ok(await mod.create_season(), "create");
    draftId = draft.id;
    ok(await env.seal(), "seal the canister");
  });

  after(async () => {
    await env?.teardown();
  });

  it("refuses everybody while the season is still a draft", async () => {
    assert.equal(phaseOf((await env.actor.season())[0]), "draft");
    // A draft is not running, so there is no open week to submit into.
    assert.deepEqual(await alice.submit_entry(entryInput()), refused({ NoSeason: null }));
  });

  it("opens week one", async () => {
    // The moderator again, and it goes through only because `before` sealed:
    // `start_season` asks the management canister who controls this canister
    // and refuses unless the answer is exactly the canister itself.
    season = ok(await mod.start_season(draftId), "start");
    assert.equal(Number(season.week), 1);
  });

  it("runs with no external controller, so the deployer moderates nothing", async () => {
    // The claim the whole season rests on, checked from outside rather than
    // asserted: PocketIC exposes the replica's controller state directly. The
    // exact expected answer is self only.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the canister itself is the only controller",
    );

    // And the consequence that runs through the whole file. `canModerate` is
    // `Principal.isController(caller) or user.moderator`, and the first half
    // went false for the identity that installed the canister the moment the
    // list emptied; it has no profile row, so the second half is false too. A
    // controller who could still moderate a sealed season would be a hole
    // straight through the claim above — the rules could not change, but who
    // applies them could.
    //
    // `approve_revision` first, because it is the gate every entry in this
    // file has to pass. Asked of an id that does not exist, so the *shape* of
    // the refusal is the whole answer: `canModerate` is checked before the
    // revision is looked up, so the controller cannot even find out whether
    // there is one, while the appointed moderator gets as far as `NotFound`.
    assert.deepEqual(await env.actor.approve_revision(999_999n), { err: { NotAllowed: null } });
    assert.deepEqual(await mod.approve_revision(999_999n), { err: { NotFound: null } });

    assert.deepEqual(await env.actor.set_judge("hack_judge", { pending: null }, []), {
      err: { NotAllowed: null },
    });
    // Not the refusal a real moderator gets, and the difference is the point:
    // `Moderation.setJudge` checks `canModerate` before `Season.judgesFrozen`,
    // so `NotAllowed` here is about the seal while `JudgesFrozen` there is about
    // the format. A single generic error would let one hide behind the other.
    assert.deepEqual(await mod.set_judge("hack_judge", { pending: null }, []), {
      err: { JudgesFrozen: null },
    });
    // The controller-only methods went dark alongside them, by the same
    // `isController` that used to let them through — and unlike everything
    // above, they do not come back when the season ends. See the last block.
    assert.deepEqual(await env.actor.set_config("Sealed", true), {
      err: "caller is not a controller",
    });
  });

  it("refuses a caller who never registered", async () => {
    const nobody = env.as(identity(1603));
    assert.deepEqual(await nobody.submit_entry(entryInput()), refused({ NotRegistered: null }));
  });

  it("refuses a registered user who does not hold the hacker role", async () => {
    assert.deepEqual(await watcher.submit_entry(entryInput()), refused({ NotAHacker: null }));
  });

  it("gives a hacker exactly one entry for the week, however often they submit", async () => {
    const first = await land(mod, alice.submit_entry(entryInput({ title: "Draft one" })), "submit");
    const one = (await alice.my_entry())[0];
    const second = await land(mod, alice.submit_entry(entryInput({ title: "Draft two" })), "resubmit");
    const two = (await alice.my_entry())[0];

    assert.notEqual(second.id, first.id, "two requests, reviewed separately");
    // The unique index on (season, week, hacker) means the second call edits
    // the first row rather than adding another.
    assert.equal(two.id, one.id, "the same row, not a second entry");
    assert.equal(two.title, "Draft two");

    const view = await env.actor.season_week_view(season.id, 1n, 50n);
    assert.equal(view.length, 1, "one hacker, one entry");
    const [map] = await env.actor.season_map(season.id, 12n);
    assert.equal(Number(map.total), 1, "and the map counts the same");
  });

  it("lets a hacker edit freely while the week is open, keeping votes already cast", async () => {
    const mine = (await alice.my_entry())[0];
    ok(await judge.cast_vote(mine.id), "vote");

    await land(
      mod,
      alice.submit_entry(entryInput({ title: "Renamed", summary: "now with words" })),
      "edit",
    );
    const edited = (await alice.my_entry())[0];
    assert.equal(edited.title, "Renamed");
    assert.equal(edited.summary, "now with words");
    // Editing is not resubmitting: the row survives, so the ballot does too.
    assert.equal(Number(edited.votes), 1, "an edit must not discard votes");
  });

  it("gives each hacker their own row", async () => {
    await land(mod, bob.submit_entry(bobInput({ title: "Bob's thing" })), "submit");
    const mine = (await bob.my_entry())[0];
    const hers = (await alice.my_entry())[0];
    assert.notEqual(mine.id, hers.id);
    assert.equal((await env.actor.season_week_view(season.id, 1n, 50n)).length, 2);
  });

  it("refuses an entry with no title, or one too long to draw", async () => {
    assert.deepEqual(
      await alice.submit_entry(entryInput({ title: "" })),
      refused({ Invalid: "a title is required" }),
    );
    assert.deepEqual(
      await alice.submit_entry(entryInput({ title: "x".repeat(81) })),
      refused({ Invalid: "title is too long" }),
    );
  });

  it("refuses a url that is not http(s)", async () => {
    assert.deepEqual(
      await alice.submit_entry(entryInput({ url: "javascript:alert(1)" })),
      refused({ Invalid: "url must be http(s)" }),
    );
    const accepted = ok(
      await alice.submit_entry(entryInput({ url: "https://example.com" })),
      "https is fine",
    );
    ok(await mod.reject_revision(accepted.id, "test cleanup"), "clear accepted URL proposal");
  });

  it("caps screenshots at six and links at six", async () => {
    const shot = (n) => `${aliceScope}shots/${n}.png`;
    assert.deepEqual(
      await alice.submit_entry(entryInput({ shots: [0, 1, 2, 3, 4, 5, 6].map(shot) })),
      refused({ Invalid: "too many screenshots" }),
    );
    const accepted = ok(
      await alice.submit_entry(entryInput({ shots: [0, 1, 2, 3, 4, 5].map(shot) })),
      "six is fine",
    );
    ok(await mod.reject_revision(accepted.id, "test cleanup"), "clear accepted shots proposal");

    const link = { kind: "docs", url: "https://example.com" };
    assert.deepEqual(
      await alice.submit_entry(entryInput({ links: Array(7).fill(link) })),
      refused({ Invalid: "too many links" }),
    );
    assert.deepEqual(
      await alice.submit_entry(entryInput({ links: [{ kind: "x", url: "ftp://example.com" }] })),
      refused({ Invalid: "links must be http(s)" }),
    );
  });

  it("keeps screenshots in the order the hacker arranged them", async () => {
    // §3: "up to six screenshots, in the order the hacker arranges them" — the
    // row must not sort or dedupe them on the way in.
    const shots = [3, 1, 2].map((n) => `${aliceScope}shots/${n}.png`);
    await land(mod, alice.submit_entry(entryInput({ shots })), "submit");
    const saved = (await alice.my_entry())[0];
    assert.deepEqual(saved.shots, shots, "stored in submission order");
  });

  it("bounds every free-text field an entry carries", async () => {
    const accepted = ok(
      await alice.submit_entry(entryInput({ summary: "x".repeat(600) })),
      "600 is fine",
    );
    ok(await mod.reject_revision(accepted.id, "test cleanup"), "clear accepted summary proposal");
    assert.deepEqual(
      await alice.submit_entry(entryInput({ summary: "x".repeat(601) })),
      refused({ Invalid: "summary is too long" }),
    );
    assert.deepEqual(
      await alice.submit_entry(entryInput({ url: `https://${"x".repeat(250)}` })),
      refused({ Invalid: "url is too long" }),
    );
    const link = (over) =>
      entryInput({ links: [{ kind: "docs", url: "https://example.com", ...over }] });
    assert.deepEqual(await alice.submit_entry(link({ url: "" })), refused({ Invalid: "a link needs a url" }));
    assert.deepEqual(
      await alice.submit_entry(link({ url: `https://${"x".repeat(250)}` })),
      refused({ Invalid: "link url is too long" }),
    );
    assert.deepEqual(
      await alice.submit_entry(link({ kind: "x".repeat(25) })),
      refused({ Invalid: "link label is too long" }),
    );
  });

  it("refuses an entry that points at another hacker's namespace", async () => {
    // §3: an entry may only point at an upload in its own owner's namespace.
    // Without this one hacker could display another's file as their own.
    assert.deepEqual(
      await alice.submit_entry(entryInput({ icon: [`${bobScope}icon/stolen.png`] })),
      refused({ Invalid: `icon must live under ${aliceScope}` }),
    );
    assert.deepEqual(
      await alice.submit_entry(entryInput({ shots: [`${bobScope}shots/stolen.png`] })),
      refused({ Invalid: `screenshot must live under ${aliceScope}` }),
    );
    // Not the site's own assets either.
    assert.deepEqual(
      await alice.submit_entry(entryInput({ icon: ["/assets/index-abc.js"] })),
      refused({ Invalid: `icon must live under ${aliceScope}` }),
    );
    // And the package goes through the same rule as the art.
    assert.deepEqual(
      await alice.submit_entry(entryInput({ pkg: { key: `${bobScope}pkg/100.neutron` } })),
      refused({ Invalid: `package must live under ${aliceScope}` }),
    );
  });

  it("BUG: `..` in an entry key walks straight out of the namespace above", async () => {
    // §3: "An entry may only point at an upload in its own owner's namespace,
    // so one hacker cannot attach another's file. That covers *every* key an
    // entry carries — icon, screenshots and package alike — and the same rule
    // governs an avatar."
    //
    // `Season.checkKey` used to test `Text.startsWith(key, scope)` and the
    // length, nothing else, and `Profiles.setAvatar` was the same one line.
    // `Assets.inScope` rejects `..` outright — the asset layer knows a key is a
    // URL path, the row layer did not — and the row stores the string verbatim,
    // which `EntryModal.tsx:108` drops into `<img src>`. A browser removes
    // dot-segments before it fetches (RFC 3986 §5.2.4), so
    // `/u/1/../2/icon/x.png` resolves to `/u/2/icon/x.png`. Every refusal the
    // test above checks is reachable one `../` later.
    const bobId = bobScope.slice("/u/".length);
    const escaped = `${aliceScope}../${bobId}icon/stolen.png`;

    const accepted = [];
    const icon = await alice.submit_entry(entryInput({ icon: [escaped] }));
    if ("ok" in icon) accepted.push(`icon → ${icon.ok.icon[0]}`);
    const shot = await alice.submit_entry(entryInput({ shots: [escaped] }));
    if ("ok" in shot) accepted.push(`screenshot → ${shot.ok.shots[0]}`);
    const site = await alice.submit_entry(
      entryInput({ icon: [`${aliceScope}../../assets/index-abc.js`] }),
    );
    if ("ok" in site) accepted.push(`icon → ${site.ok.icon[0]}`);
    const pkg = await alice.submit_entry(
      entryInput({ pkg: { key: `${aliceScope}../${bobId}pkg/100.neutron` } }),
    );
    if ("ok" in pkg) accepted.push(`package → ${pkg.ok.pkgKey[0]}`);
    const avatar = await alice.set_avatar([`${aliceScope}../${bobId}avatar/face.png`]);
    if ("ok" in avatar) accepted.push(`avatar → ${avatar.ok.avatar[0]}`);

    assert.deepEqual(
      accepted,
      [],
      `no key an entry or a profile carries may contain "..": each of these leaves ${aliceScope}`,
    );
  });

  it("refuses every browser-normalized spelling of participant art", async () => {
    // The row, the lock, the takedown queue, and HTTP must all name the same
    // exact key. Browsers reinterpret these spellings before fetching them,
    // so none may become a persisted image reference.
    const bobId = bobScope.split("/")[2];
    const aliases = [
      `${aliceScope}icon/a.png?reviewed`,
      `${aliceScope}icon/a.png#reviewed`,
      `${aliceScope}icon/./a.png`,
      `${aliceScope}icon/%2e/a.png`,
      `${aliceScope}icon/%2e%2e/%2e%2e/${bobId}/icon/a.png`,
      `${aliceScope}icon/dir\\a.png`,
    ];
    for (const key of aliases) {
      assert.deepEqual(
        await alice.submit_entry(entryInput({ icon: [key] })),
        refused({ Invalid: `icon must live under ${aliceScope}` }),
        key,
      );
    }
    assert.deepEqual(await alice.set_avatar([`${aliceScope}avatar/a.png?reviewed`]), {
      err: { Invalid: `avatar must live under ${aliceScope}` },
    });
  });

  it("refuses an empty or absurdly long key", async () => {
    assert.deepEqual(
      await alice.submit_entry(entryInput({ icon: [""] })),
      refused({ Invalid: "an empty icon key" }),
    );
    assert.deepEqual(
      await alice.submit_entry(entryInput({ icon: [`${aliceScope}icon/${"a".repeat(200)}.png`] })),
      refused({ Invalid: "icon key is too long" }),
    );
  });

  it("BUG: an entry may point its icon at any folder, so the 2.5 MB art bound is not enforced", async () => {
    // §3 sizes an entry's art by the folder each key sits in — icon/ caps at
    // 100 KB and shots/ at 400 KB apiece, so one entry's art is bounded at
    // 2.5 MB. (the Rules page still publishes 400 KB and 2.8 MB; see the NOTE on
    // "caps an icon at 100 KB and a screenshot at 400 KB". Nothing here turns
    // on which figure is right — 500 KB is over both.)
    // `Season.checkKey` used to check only the /u/<id>/ prefix, so a
    // hacker uploaded into pkg/ (1.9 MB) and pointed the icon and every
    // screenshot there.
    const big = (n) => `${aliceScope}pkg/${n}.neutron`;
    ok(await alice.my_upload(store(big(1), 500_000)), "500 KB is fine in pkg/");
    ok(await alice.my_upload(store(big(2), 500_000)), "and again");
    const refusedIcon = await alice.my_upload(store(`${aliceScope}icon/big.png`, 500_000));
    assert.deepEqual(refusedIcon, { err: "chunk too large" }, "the same bytes are refused in icon/");

    const res = await alice.submit_entry(entryInput({ icon: [big(1)], shots: [big(2)] }));
    const drawn = "ok" in res ? [res.ok.icon[0], ...res.ok.shots] : [];
    // The folder, named — not merely "some error". A refusal for any other
    // reason would leave the 500 KB icon just as reachable.
    assert.deepEqual(
      res,
      refused({ Invalid: `icon must live under ${aliceScope}icon/` }),
      `art outside icon/ and shots/ should be refused; the entry now draws ${drawn.join(", ")}`
      + " — 500 KB apiece, past what the folder table sets",
    );
    ok(await alice.my_upload(del(big(1))), "remove unreferenced capacity fixture");
    ok(await alice.my_upload(del(big(2))), "remove second unreferenced capacity fixture");
  });

  // Kept last in this block: it drops alice's role and does not put it back.
  it("BUG: a hacker who resigns the role can still edit their entry", async () => {
    // §8: "Submit or edit an entry | the hacker who owns it, while the week is
    // open", and §3: "Only users holding the hacker role may submit."
    // Submitting enforces the role; publishing a version is the other way to
    // edit an entry, and it did not — so the same person, in the same week, was
    // refused one edit path and allowed the other, and the row stays in the
    // week's ranking, so a non-hacker could still ship a build and win with it.
    const target = (await alice.my_entry())[0];
    ok(await alice.set_hacker(false), "resign");
    assert.deepEqual(
      await alice.submit_entry(entryInput({ title: "still here" })),
      refused({ NotAHacker: null }),
    );
    // The *same* refusal submitting gave, not just any refusal: alice still
    // owns an entry in the open week, so `NotFound` here would mean the row
    // went out of reach rather than the role being enforced.
    assert.deepEqual(
      await alice.publish_update(target.id, { version: "1.0", note: "shipped anyway", pkg: [] }),
      refused({ NotAHacker: null }),
      "editing the row should need the same role submitting does",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("uploads: the folder decides, not the caller", () => {
  let env;
  let up, other, scope, otherScope;

  before(async () => {
    env = await bootstrap();
    up = await register(env.as, identity(1610), "up_alice");
    ok(await up.set_hacker(true), "app uploads require the hacker role");
    other = await register(env.as, identity(1611), "up_bob");
    scope = scopeOf(await meOf(up));
    otherScope = scopeOf(await meOf(other));
  });

  after(async () => {
    await env?.teardown();
  });

  it("refuses a caller who never registered", async () => {
    const nobody = env.as(identity(1612));
    assert.deepEqual(await nobody.my_upload(store("/u/1/icon/a.png", 10)), {
      err: "not registered",
    });
  });

  it("refuses a key in somebody else's namespace", async () => {
    const res = await up.my_upload(store(`${otherScope}icon/a.png`, 10));
    assert.ok("err" in res, "a user writes under their own id only");
    // Out of scope, not merely in an unlisted folder — the two are different
    // mistakes and say so, which matters when a real upload goes wrong.
    assert.match(res.err, /out of scope/);
  });

  it("refuses a folder that is not in the table", async () => {
    // §3: "Any other folder is refused rather than allowed at some default."
    const res = await up.my_upload(store(`${scope}docs/readme.pdf`, 10));
    assert.deepEqual(res, { err: `uploads go in ${scope}{avatar,icon,shots,pkg}/` });
  });

  it("refuses a command that is not an upload at all", async () => {
    // Clearing a whole prefix is not something a participant may do.
    assert.deepEqual(await up.my_upload({ clear: { prefix: scope } }), {
      err: "that is not an upload you can make",
    });
  });

  it("refuses traversal out of the namespace", async () => {
    // The folder is recognised (`icon/`), so this has to be refused by the
    // scope check itself rather than by falling off `kindFor` — assert the
    // message so a passing test cannot be the right answer for the wrong
    // reason. `Assets.inScope` rejects `..` and `//` before anything else.
    const key = `${scope}icon/../../1/icon/a.png`;
    assert.deepEqual(await up.my_upload(store(key, 10)), { err: `key out of scope: ${key}` });
    const doubled = `${scope}icon//a.png`;
    assert.deepEqual(await up.my_upload(store(doubled, 10)), {
      err: `key out of scope: ${doubled}`,
    });

    for (const alias of [
      `${scope}icon/a.png?reviewed`,
      `${scope}icon/a.png#reviewed`,
      `${scope}icon/./a.png`,
      `${scope}icon/%2e/a.png`,
      `${scope}icon/dir\\a.png`,
    ]) {
      assert.deepEqual(await up.my_upload(store(alias, 10)), {
        err: `key out of scope: ${alias}`,
      });
    }
  });

  it("caps an avatar at 100 KB — exactly, and not one byte more", async () => {
    ok(await up.my_upload(store(`${scope}avatar/face.png`, 100_000)), "100 KB exactly");
    const over = await up.my_upload(store(`${scope}avatar/face.png`, 100_001));
    assert.deepEqual(over, { err: "chunk too large" });
  });

  it("caps an icon at 100 KB and a screenshot at 400 KB", async () => {
    // NOTE — this follows the code, and the code and the spec disagree.
    // the Rules page §"An upload's size limit comes from the folder it goes into"
    // publishes `/u/<id>/icon/` at **400 KB** (line 131), and derives the
    // 2.8 MB art bound from it (line 140). `Assets.iconLimits` is 100 KB, on
    // the argument that the mark the bracket draws is shown at a few dozen
    // pixels and so belongs at the avatar's cap. Nothing propagated that:
    // `test/assets.test.mo:59` still asserts `kindFor(icon/) == ?#media` and
    // fails under `npm test`. Whichever number is meant to win, one published
    // figure is wrong — do not treat this test as the settled answer.
    ok(await up.my_upload(store(`${scope}icon/mark.png`, 100_000)), "100 KB exactly");
    assert.deepEqual(await up.my_upload(store(`${scope}icon/mark.png`, 100_001)), {
      err: "chunk too large",
    });
    ok(await up.my_upload(store(`${scope}shots/one.png`, 400_000)), "400 KB exactly");
    assert.deepEqual(await up.my_upload(store(`${scope}shots/one.png`, 400_001)), {
      err: "chunk too large",
    });
  });

  it("caps a package at 1.9 MB, which is what one ingress message carries", async () => {
    ok(
      await up.my_upload(store(`${scope}pkg/1.neutron`, 1_900_000, "application/octet-stream")),
      "1.9 MB exactly",
    );
    assert.deepEqual(
      await up.my_upload(store(`${scope}pkg/1.neutron`, 1_900_001, "application/octet-stream")),
      { err: "chunk too large" },
    );
  });

  it("takes the limit from the folder, never from the caller", async () => {
    // The whole point of reading the kind off the path: there is no argument
    // to this method that says "treat my avatar as a screenshot".
    const asAvatar = await up.my_upload(store(`${scope}avatar/huge.png`, 400_000));
    assert.deepEqual(asAvatar, { err: "chunk too large" });
    const asIcon = await up.my_upload(store(`${scope}icon/huge.png`, 400_000));
    assert.deepEqual(asIcon, { err: "chunk too large" });
    ok(await up.my_upload(store(`${scope}shots/huge.png`, 400_000)), "same bytes, different folder");
  });

  it("refuses a multi-chunk user upload", async () => {
    // One message per file, so there is never a half-written asset to clean up.
    const cmd = store(`${scope}pkg/2.neutron`, 10, "application/octet-stream");
    cmd.store.chunks = 2n;
    assert.deepEqual(await up.my_upload(cmd), { err: "too many chunks" });
  });

  it("holds an avatar to the same namespace rule an entry's art is held to", async () => {
    // §3: "the same rule governs an avatar."
    assert.deepEqual(await up.set_avatar([`${otherScope}avatar/face.png`]), {
      err: { Invalid: `avatar must live under ${scope}` },
    });
    ok(await up.set_avatar([`${scope}avatar/face.png`]), "own namespace");
  });

  it("records the size the store actually holds", async () => {
    ok(await up.my_upload(store(`${scope}shots/two.png`, 1_234)), "upload");
    assert.deepEqual(
      await env.actor.assets_list(`${scope}shots/two.png`, 5n),
      [],
      "participant folders are not publicly enumerable",
    );
    const res = await fetchAsset(env, `${scope}shots/two.png`);
    assert.equal(res.status_code, 200);
    assert.equal(res.body.length, 1_234, "the exact URL serves the stored bytes");
  });

  it("BUG: serves a participant's upload with the content type the participant chose", async () => {
    // `my_upload` bounds the folder and the size but used to take `contentType`
    // verbatim, and the asset is then served from the canister's own origin
    // with `x-content-type-options: nosniff` telling the browser to believe it.
    // Any registered user could therefore host HTML on the app's origin, which
    // is where the frontend's session lives.
    const key = `${scope}shots/evil.png`;
    ok(
      await up.my_upload({
        store: {
          key,
          contentType: "text/html",
          contentEncoding: "identity",
          chunks: 1n,
          content: new TextEncoder().encode("<script>document.title='pwned'</script>"),
        },
      }),
      "upload",
    );

    const res = await env.actor.http_request({
      url: key,
      method: "GET",
      body: new Uint8Array(),
      headers: [],
      certificate_version: [],
    });
    assert.equal(res.status_code, 200, "the canister serves it");
    const type = res.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
    assert.notEqual(
      type,
      "text/html",
      "a participant's upload must not be served as HTML from the app's own origin",
    );
  });

  it("hosts only numeric .neutron builds in pkg/", async () => {
    for (const key of [
      `${scope}pkg/setup.exe`,
      `${scope}pkg/build.neutron`,
      `${scope}pkg/1.zip`,
      `${scope}pkg/sub/1.neutron`,
      `${scope}pkg/1.neutron.neutron`,
    ]) {
      assert.deepEqual(await up.my_upload(store(key, 64, "application/octet-stream")), {
        err: `a package is ${scope}pkg/<digits>.neutron`,
      });
      assert.equal((await fetchAsset(env, key)).status_code, 404, `${key} was not hosted`);
    }

    const key = `${scope}pkg/1700000000000.neutron`;
    ok(await up.my_upload(store(key, 64, "application/octet-stream")), "numeric build stored");
    assert.equal((await fetchAsset(env, key)).status_code, 200);
  });

  it("still lets an owner delete a malformed file left by older code", async () => {
    const key = `${scope}pkg/legacy-setup.exe`;
    ok(
      await env.actor.assets_upload(store(key, 64, "application/octet-stream")),
      "controller creates the legacy fixture",
    );
    assert.equal((await fetchAsset(env, key)).status_code, 200);
    ok(await up.my_upload(del(key)), "owner removes it through the narrow cleanup path");
    assert.equal((await fetchAsset(env, key)).status_code, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("the changelog", () => {
  let env;
  let hacker, rival, mod, scope, rivalScope;
  let entryInput, entryId = 0n;

  before(async () => {
    env = await bootstrap();
    hacker = await register(env.as, identity(1620), "log_alice");
    // Nothing may be submitted without somewhere to be paid — `#NoWallet`.
    ok(await hacker.set_wallet(walletFor(1620)), "payable");
    // The role costs nothing beyond registration: one acceptance at sign-up
    // covers the common rules and every role a user later takes.
    ok(await hacker.set_hacker(true), "hacks");
    // The rival is here for their namespace, never to submit, so they need no
    // wallet of their own.
    rival = await register(env.as, identity(1621), "log_bob");
    ok(await rival.set_hacker(true), "hacks");
    scope = scopeOf(await meOf(hacker));
    rivalScope = scopeOf(await meOf(rival));

    // The build the entry is submitted with, before any version is published
    // against it.
    await uploadPkg(hacker, scope, 500);
    entryInput = entriesFor(scope, 500, "log_alice_app");

    // Every version below is a proposal a moderator has to approve, and the
    // former controller is not a moderator once the list is self-only. `set_moderator` is
    // controller-only and the former deployer cannot appoint one after the seal, so the
    // desk and draft come first; the seal comes next, and the start last, because
    // `start_season` refuses until controller state is exactly self-only and only a
    // moderator may call it by then.
    mod = await register(env.as, identity(1622), "log_mod");
    ok(await env.actor.set_moderator("log_mod", true, []), "appoint the review desk");

    const draft = ok(await mod.create_season(), "create");
    ok(await env.seal(), "seal the canister");
    ok(await mod.start_season(draft.id), "start");
  });

  after(async () => {
    await env?.teardown();
  });

  const publish = (who, version, note, key) =>
    who.publish_update(entryId, { version, note, pkg: key ? [{ key }] : [] });

  it("refuses an update from a hacker with no entry this week", async () => {
    assert.deepEqual(
      await publish(hacker, "0.1", "nothing to attach to"),
      refused({ NotFound: null }),
    );
  });

  it("needs both a version and a note — a build never lands unexplained", async () => {
    await land(mod, hacker.submit_entry(entryInput({ title: "Logged" })), "submit");
    entryId = (await hacker.my_entry())[0].id;
    assert.deepEqual(
      await publish(hacker, "  ", "said nothing"),
      refused({ Invalid: "a version is required" }),
    );
    assert.deepEqual(await publish(hacker, "0.1", "   "), refused({ Invalid: "say what changed" }));
  });

  it("bounds the version string and the note", async () => {
    // The changelog is drawn on the entry page, so neither field is free space.
    assert.deepEqual(
      await publish(hacker, "v".repeat(25), "long version"),
      refused({ Invalid: "version is too long" }),
    );
    assert.deepEqual(
      await publish(hacker, "0.1", "n".repeat(501)),
      refused({ Invalid: "note is too long" }),
    );
  });

  it("refuses a package key that is not under the caller's own pkg/", async () => {
    // Right namespace, wrong folder. The folder rule answers first and names
    // the folder; the `<digits>.neutron` rule is about the filename and only
    // applies once the key is in the right place.
    assert.deepEqual(
      await publish(hacker, "0.1", "wrong folder", `${scope}icon/1.neutron`),
      refused({ Invalid: `package must live under ${scope}pkg/` }),
    );
    // Somebody else's namespace entirely.
    assert.deepEqual(
      await publish(hacker, "0.1", "not mine", `${rivalScope}pkg/1.neutron`),
      refused({ Invalid: `package must live under ${scope}` }),
    );
  });

  it("refuses a name the uploader chose rather than the canister", async () => {
    const bad = `a package is ${scope}pkg/<digits>.neutron`;
    // §3: digits the uploader picks, an extension they do not.
    assert.deepEqual(
      await publish(hacker, "0.1", "named", `${scope}pkg/build.neutron`),
      refused({ Invalid: bad }),
    );
    assert.deepEqual(
      await publish(hacker, "0.1", "extension", `${scope}pkg/1.zip`),
      refused({ Invalid: bad }),
    );
    assert.deepEqual(
      await publish(hacker, "0.1", "installer", `${scope}pkg/setup.exe`),
      refused({ Invalid: bad }),
    );
    assert.deepEqual(
      await publish(hacker, "0.1", "nested", `${scope}pkg/sub/1.neutron`),
      refused({ Invalid: bad }),
    );
  });

  it("refuses an absent key and rejects a zero-byte upload at the storage boundary", async () => {
    assert.deepEqual(
      await publish(hacker, "0.1", "vapourware", `${scope}pkg/1000.neutron`),
      refused({ Invalid: "no finished upload at that key" }),
    );
    assert.deepEqual(
      await hacker.my_upload(store(`${scope}pkg/1001.neutron`, 0, "application/octet-stream")),
      { err: "empty files are not stored" },
    );
    assert.deepEqual(
      await publish(hacker, "0.1", "empty", `${scope}pkg/1001.neutron`),
      refused({ Invalid: "no finished upload at that key" }),
    );
  });

  it("refuses the same on the way into an entry, not only a version", async () => {
    // `submit_entry` reads the store too: an entry is an app, so a row may not
    // name a build that was never uploaded or one with no bytes in it.
    assert.deepEqual(
      await hacker.submit_entry(entryInput({ pkg: { key: `${scope}pkg/1000.neutron` } })),
      refused({ Invalid: "no finished upload at that key" }),
    );
    assert.deepEqual(
      await hacker.submit_entry(entryInput({ pkg: { key: `${scope}pkg/1001.neutron` } })),
      refused({ Invalid: "no finished upload at that key" }),
    );
    assert.deepEqual(
      await hacker.submit_entry(entryInput({ pkg: { key: `${scope}pkg/build.neutron` } })),
      refused({ Invalid: `a package is ${scope}pkg/<digits>.neutron` }),
    );
  });

  it("reads the package size off the store, and names it from the key", async () => {
    // A declared size was simply believed, so a three-byte file could present
    // itself as 1.9 MB. `PackageInput` carries the key and nothing else.
    //
    // The name here is the key's, not the app id's: `Season.buildOf` names the
    // Both paths name the file after the app. Submitting and shipping used to
    // disagree — `buildOf` used the slug and `applyVersion` used the upload
    // key's digits — which meant a hacker's download quietly renamed itself the
    // first time they shipped an update, breaking every link to it.
    // `applyVersion` now reads the name off the entry's own slug.
    ok(await hacker.my_upload(store(`${scope}pkg/1000.neutron`, 1_234, "application/octet-stream")));
    await land(mod, publish(hacker, "0.1", "first build", `${scope}pkg/1000.neutron`), "publish");
    const entry = (await hacker.my_entry())[0];
    const [pkg] = entry.pkg;
    assert.equal(pkg.key, `${scope}pkg/1000.neutron`);
    assert.equal(pkg.name, `${entry.slug}.neutron`);
    assert.equal(Number(pkg.size), 1_234);
    assert.equal(pkg.version, "0.1");

    // And the changelog records the upload itself, not just the words.
    assert.equal(entry.updates.length, 1);
    assert.deepEqual(entry.updates[0].upload, [{ name: `${entry.slug}.neutron`, size: 1_234n }]);
  });

  it("replaces the old build and deletes the file behind it", async () => {
    // §3: "A new package replaces the old one — the previous asset is deleted,
    // so a project holds exactly one build at a time."
    ok(await hacker.my_upload(store(`${scope}pkg/1002.neutron`, 99, "application/octet-stream")));
    await land(mod, publish(hacker, "0.2", "second build", `${scope}pkg/1002.neutron`), "publish");
    const entry = (await hacker.my_entry())[0];
    assert.equal(entry.pkg[0].key, `${scope}pkg/1002.neutron`);

    assert.equal(await assetExists(env, `${scope}pkg/1000.neutron`), false, "the replaced build is gone");
    assert.equal(await assetExists(env, `${scope}pkg/1002.neutron`), true, "the new one is there");
  });

  it("keeps the file when the same key is published again", async () => {
    await land(mod, publish(hacker, "0.3", "rebuilt in place", `${scope}pkg/1002.neutron`), "publish");
    const entry = (await hacker.my_entry())[0];
    assert.equal(entry.pkg[0].version, "0.3");
    assert.equal(
      await assetExists(env, `${scope}pkg/1002.neutron`),
      true,
      "publishing over itself must not delete it",
    );
  });

  it("writes the changelog newest first, with a note-only update carrying no upload", async () => {
    await land(mod, publish(hacker, "0.4", "just words"), "publish");
    const entry = (await hacker.my_entry())[0];
    const versions = entry.updates.map((u) => u.version);
    assert.deepEqual(versions, ["0.4", "0.3", "0.2", "0.1"], "read from the top");
    assert.deepEqual(entry.updates[0].upload, [], "no build shipped with this one");
    assert.deepEqual(entry.updates[1].upload, [{ name: `${entry.slug}.neutron`, size: 99n }]);
    // The pointer is untouched by a note-only update.
    assert.equal(entry.pkg[0].key, `${scope}pkg/1002.neutron`);
    assert.ok(entry.updates.every((u) => u.at > 0n), "every update is stamped");
  });

  it("refuses a package key with a doubled .neutron extension at upload and publication", async () => {
    // §3 fixes the key at `/u/<id>/pkg/<digits>.neutron`, and Season.mo's own
    // comment says "no second extension". `Text.trimEnd` strips *every*
    // trailing occurrence, so "1234.neutron.neutron" left the stem "1234",
    // passed the digits-only check, and was recorded under that name.
    const key = `${scope}pkg/1234.neutron.neutron`;
    assert.deepEqual(await hacker.my_upload(store(key, 64, "application/octet-stream")), {
      err: `a package is ${scope}pkg/<digits>.neutron`,
    });
    assert.deepEqual(
      await publish(hacker, "0.5", "doubled", key),
      refused({ Invalid: `a package is ${scope}pkg/<digits>.neutron` }),
    );
    // The same key on the way into an entry, where it is equally forbidden.
    assert.deepEqual(
      await hacker.submit_entry(entryInput({ pkg: { key } })),
      refused({ Invalid: `a package is ${scope}pkg/<digits>.neutron` }),
    );
  });

  it("caps the changelog at thirty entries", async () => {
    let n = (await hacker.my_entry())[0].updates.length;
    while (n < 30) {
      await land(mod, publish(hacker, `1.${n}`, `filler ${n}`), `filler ${n}`);
      n += 1;
    }
    const entry = (await hacker.my_entry())[0];
    assert.equal(entry.updates.length, 30);
    assert.deepEqual(
      await publish(hacker, "9.9", "one too many"),
      refused({ Invalid: "too many updates" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("a week that closed, and the bracket beyond it", () => {
  let env;
  let hacker, stranger, mod, scope, season;
  let entryInput;
  let weekOneId, semiId;

  const publish = (entryId, version, note, key) =>
    hacker.publish_update(entryId, { version, note, pkg: key ? [{ key }] : [] });

  before(async () => {
    env = await bootstrap();
    hacker = await register(env.as, identity(1630), "brk_alice");
    ok(await hacker.set_wallet(walletFor(1630)), "payable");
    // One acceptance, taken at registration and covering every role, so there
    // is nothing between a wallet and the hacker bit.
    ok(await hacker.set_hacker(true), "hacks");
    // Everybody this block needs signs up **before** the season does: starting
    // one closes registration until it finishes, so the gatecrasher who only
    // turns up in week five to be turned away could not register then. They
    // are payable too, so the refusal they get is about the week and nothing
    // else.
    stranger = await register(env.as, identity(1631), "brk_bob");
    ok(await stranger.set_wallet(walletFor(1631)), "payable");
    ok(await stranger.set_hacker(true), "hacks");
    scope = scopeOf(await meOf(hacker));
    // Week one's entry is submitted with the build it is judged on; the
    // versions below replace it.
    entryInput = entriesFor(scope, 1000, "brk_alice_app");

    // The review desk, seated under a harder deadline than registration's: the
    // canister is about to have no external controllers, `set_moderator` is
    // controller-only, and this block reviews entries in six different weeks.
    // Appointed after the seal it could never be appointed at all — not this
    // season, not any season, not ever.
    mod = await register(env.as, identity(1632), "brk_mod");
    ok(await env.actor.set_moderator("brk_mod", true, []), "appoint the review desk");

    const draft = ok(await mod.create_season(), "create");
    ok(await env.seal(), "seal the canister");
    season = ok(await mod.start_season(draft.id), "start");
  });

  after(async () => {
    await env?.teardown();
  });

  it("ships a project in week one", async () => {
    ok(await hacker.my_upload(store(`${scope}icon/a.png`, 1_000)), "icon");
    ok(await hacker.my_upload(store(`${scope}shots/s1.png`, 2_000)), "shot");
    ok(await hacker.my_upload(store(`${scope}pkg/1000.neutron`, 10, "application/octet-stream")));

    await land(
      mod,
      hacker.submit_entry(
        entryInput({ title: "Bracket runner", icon: [`${scope}icon/a.png`], shots: [`${scope}shots/s1.png`] }),
      ),
      "submit",
    );
    weekOneId = (await hacker.my_entry())[0].id;

    await land(
      mod,
      publish(weekOneId, "0.1", "first build", `${scope}pkg/1000.neutron`),
      "publish",
    );
    ok(await hacker.my_upload(store(`${scope}pkg/1001.neutron`, 20, "application/octet-stream")));
    await land(
      mod,
      publish(weekOneId, "0.2", "second build", `${scope}pkg/1001.neutron`),
      "publish",
    );
    const second = (await hacker.my_entry())[0];
    assert.equal(second.pkg[0].key, `${scope}pkg/1001.neutron`);

    // Nothing settled claims 1000 yet, so replacing it deletes it.
    assert.equal(await assetExists(env, `${scope}pkg/1000.neutron`), false);
    assert.equal(await assetExists(env, `${scope}pkg/1001.neutron`), true);
  });

  it("closes the week on its own deadline and carries the winner forward", async () => {
    // Only time passes here — and there is no other way for it to happen:
    // nothing on the interface advances the bracket by hand any more, so a
    // week ends on its own deadline or not at all. A day late still closes
    // exactly one week, which is the deadline doing the work rather than the
    // amount of time that went by.
    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 2);

    const [closed] = await env.actor.entry_detail(weekOneId);
    assert.deepEqual(closed.entry.outcome, { advanced: null });
    assert.equal(closed.detailsEditable, false, "a settled entry is not editable");
    assert.equal(closed.versionsEditable, false, "and nothing can be shipped against it");

    // The clone carries the whole project — icon, shots, package, changelog.
    const semi = await env.actor.season_week_view(season.id, 5n, 50n);
    assert.equal(semi.length, 1);
    semiId = semi[0].entry.id;
    const [detail] = await env.actor.entry_detail(semiId);
    assert.equal(detail.entry.icon[0], `${scope}icon/a.png`);
    assert.deepEqual(detail.entry.shots, [`${scope}shots/s1.png`]);
    assert.equal(detail.entry.pkg[0].key, `${scope}pkg/1001.neutron`);
    assert.equal(detail.entry.updates.length, 2, "the changelog belongs to the project");
    assert.deepEqual(detail.entry.origin_id, [weekOneId]);
  });

  it("freezes an image as soon as its entry is published", async () => {
    // §3: approval covers the files, not just the row — otherwise a project
    // can be approved with one set of screenshots and display another.
    const overwrite = await hacker.my_upload(store(`${scope}icon/a.png`, 1_500));
    assert.deepEqual(overwrite, {
      err: "that file is referenced by a published entry or pending review",
    });
    const removed = await hacker.my_upload(del(`${scope}shots/s1.png`));
    assert.deepEqual(removed, {
      err: "that file is referenced by a published entry or pending review",
    });
  });

  it("freezes a build as soon as its entry is published", async () => {
    assert.deepEqual(await hacker.my_upload(del(`${scope}pkg/1001.neutron`)), {
      err: "that file is referenced by a published entry or pending review",
    });
    assert.deepEqual(
      await hacker.my_upload(store(`${scope}pkg/1001.neutron`, 4_096, "application/octet-stream")),
      { err: "that file is referenced by a published entry or pending review" },
    );
    assert.equal(await assetExists(env, `${scope}pkg/1001.neutron`), true);
  });

  it("leaves a key nothing claims alone", async () => {
    ok(await hacker.my_upload(store(`${scope}icon/b.png`, 900)), "a fresh key is free");
    ok(await hacker.my_upload(store(`${scope}icon/b.png`, 950)), "and still free until claimed");
  });

  it("gives an update nowhere to land once the week it belongs to has closed", async () => {
    // The selected id names a settled week-one row while week two is open.
    // Exact targeting must reject it rather than silently finding some other
    // row owned by the same hacker.
    assert.deepEqual(
      await publish(weekOneId, "0.3", "sneaking one in"),
      refused({ NotFound: null }),
    );
  });

  it("starts week two from scratch rather than editing week one", async () => {
    // A fresh build for a fresh week: §3 makes the package part of the entry,
    // and nothing about week one comes with the new row.
    ok(await hacker.my_upload(store(`${scope}pkg/2000.neutron`, 15, "application/octet-stream")));
    await land(
      mod,
      hacker.submit_entry(
        entryInput({
          title: "Second attempt",
          icon: [`${scope}icon/b.png`],
          pkg: { key: `${scope}pkg/2000.neutron` },
        }),
      ),
      "submit",
    );
    const entry = (await hacker.my_entry())[0];
    assert.notEqual(entry.id, weekOneId, "a new week is a new row");
    assert.equal(Number(entry.week), 2);
    assert.equal(Number(entry.votes), 0);
    assert.deepEqual(entry.updates, [], "and it carries nothing forward on its own");
    assert.equal(
      entry.pkg[0].key,
      `${scope}pkg/2000.neutron`,
      "not even the build week one was judged on",
    );

    const [old] = await env.actor.entry_detail(weekOneId);
    assert.equal(old.entry.title, "Bracket runner", "week one is untouched");
    assert.equal(old.entry.icon[0], `${scope}icon/a.png`);
  });

  it("refuses a submission into the semi-final and the final", async () => {
    // §3: "Semi-final and final entries are not submitted." They are carried.
    // Asked of somebody with no place in the bracket — the hacker above already
    // holds a week-five row, so submitting as them would take the *edit* branch
    // and could not tell "you may not create one here" from "you may not edit
    // the one that was carried". That distinction is the test below.
    //
    // Weeks three, four and five, each of them reached by letting a deadline
    // run out. `closeWeek` answers with the season rather than a `Result` — it
    // is the clock, not a call, so there is nothing for it to refuse.
    for (const _ of [3, 4, 5]) await closeWeek(env);
    assert.equal(Number((await env.live()).week), 5);

    // The gatecrasher signed up in `before`: registration shut the moment the
    // season started, so week five is far too late to join.
    assert.deepEqual(
      await stranger.submit_entry(entryInput({ title: "Gatecrash" })),
      refused({ WeekClosed: null }),
    );
    // Two rows, and both of them carried. This hacker is the only entrant, so
    // they won week one and week two and hold **both** semi-final seats — a
    // final of them versus them. That is the intended reading of §5: the seat
    // belongs to the winning *entry*, not to the person. It used to hold one,
    // because `bySlot` keyed on `(season, week, user)` and the second `carry`
    // hit the unique constraint and was swallowed as "already here", quietly
    // taking an entrant out of duel B.
    const semi = await env.actor.season_week_view(season.id, 5n, 50n);
    assert.equal(semi.length, 2, "the semi-final holds what was carried into it");
    assert.deepEqual(
      semi.map((row) => row.entry.origin_id.length),
      [1, 1],
      "and every one of them was carried, not submitted",
    );
    assert.deepEqual(
      [...new Set(semi.map((row) => row.entry.origin_id[0]))].length,
      2,
      "from two different qualifier entries",
    );
  });

  it("publishes against the exact selected seat of a double winner", async () => {
    const semi = (await env.actor.season_week_view(season.id, 5n, 50n)).map(
      (view) => view.entry,
    );
    const appA = semi.find((entry) => entry.id === semiId);
    const appB = semi.find((entry) => entry.id !== semiId);
    assert.ok(appA && appB, "the fixture must expose both current semi-final seats");

    const detail = async (id) => (await env.actor.entry_detail(id))[0].entry;
    const beforeA = await detail(appA.id);
    const beforeB = await detail(appB.id);

    // A current row owned by somebody else and this hacker's own settled row
    // are both real ids. Neither may be silently replaced with seat zero.
    assert.deepEqual(
      await stranger.publish_update(appA.id, {
        version: "foreign",
        note: "not this hacker's app",
        pkg: [],
      }),
      refused({ NotFound: null }),
    );
    assert.deepEqual(
      await publish(weekOneId, "stale", "not the current carried row"),
      refused({ NotFound: null }),
    );

    const revisionB = ok(
      await publish(appB.id, "semi-b", "update only the second carried app"),
      "target app B",
    );
    assert.deepEqual(
      revisionB.targetEntryId,
      [appB.id],
      "the pending revision persists the clicked app id",
    );
    ok(await mod.approve_revision(revisionB.id), "approve app B");

    const afterBOnA = await detail(appA.id);
    const afterB = await detail(appB.id);
    assert.deepEqual(afterBOnA, beforeA, "approving app B must not change app A");
    assert.equal(afterB.updates.length, beforeB.updates.length + 1);
    assert.equal(afterB.updates[0].version, "semi-b");

    const revisionA = ok(
      await publish(appA.id, "semi-a", "update only the first carried app"),
      "target app A",
    );
    assert.deepEqual(
      revisionA.targetEntryId,
      [appA.id],
      "the second revision persists the other selected id",
    );
    ok(await mod.approve_revision(revisionA.id), "approve app A");

    const afterA = await detail(appA.id);
    assert.deepEqual(await detail(appB.id), afterB, "approving app A must not change app B");
    assert.equal(afterA.updates.length, beforeA.updates.length + 1);
    assert.equal(afterA.updates[0].version, "semi-a");
  });

  it("BUG: calls a bracket entry editable when no path can edit it", async () => {
    // Two answers to one question. Submitting bails on `week > QUALIFIERS`
    // before it looks for an existing row, which is right — §3 says semi-final
    // and final entries are not submitted, and `Profile.tsx:423` agrees,
    // locking the details form off `qualifierOpen`. But `Season.entryDetail`
    // used to derive `editable` from "the week is open and the row is yours"
    // alone, so it said true, and `EntryModal.tsx:209` draws an "Edit in Your
    // apps" button from that flag. The carried entry's title, icon, screenshots
    // and links are unchangeable for the rest of the season; only a version
    // still works. The flag is what is wrong, not the refusal.
    const res = await hacker.submit_entry(
      entryInput({ title: "Bracket runner", icon: [`${scope}icon/b.png`] }),
    );
    assert.deepEqual(res, refused({ WeekClosed: null }), "the edit is refused");

    // Seen by somebody who is not the owner. `entry_detail` compares the
    // caller against the row's user and nothing else, so the deployer's
    // identity is just another stranger here — permanently so, now that the
    // seal has stripped it of the controller status it used to carry.
    const [asOther] = await env.actor.entry_detail(semiId);
    assert.equal(asOther.mine, false, "not this caller's row");
    assert.equal(asOther.detailsEditable, false, "and offered no edit");
    assert.equal(asOther.versionsEditable, false, "nor a version to publish");

    const [mine] = await hacker.entry_detail(semiId);
    assert.equal(
      mine.detailsEditable,
      false,
      "entry_detail must not offer its owner an edit submit_entry will refuse",
    );
    // But it must still say what the owner *can* do here, which is the whole
    // reason one flag was not enough.
    assert.equal(mine.versionsEditable, true, "shipping a build against it still works");
  });

  it("accepts a fresh replacement build in the semi-final but keeps its art fixed", async () => {
    const build = `${scope}pkg/9002.neutron`;
    ok(
      await hacker.my_upload(store(build, 30, "application/octet-stream")),
      "upload a semi-final build",
    );
    assert.deepEqual(
      await hacker.my_upload(store(`${scope}icon/semi.png`, 30)),
      { err: "app uploads are closed for this round" },
      "carried art stays fixed",
    );
    await land(mod, publish(semiId, "0.3", "semi-final build", build), "publish");
    const entry = (await hacker.my_entry())[0];
    assert.equal(entry.id, semiId);
    assert.equal(entry.pkg[0].key, build);
    assert.equal(Number(entry.pkg[0].size), 30);
  });

  it("keeps the replaced build when a settled round still claims it", async () => {
    // §3: "a carried entry keeps the key it was cloned with — so the build
    // being replaced in week 5 may be the one week 4 was judged on. The row's
    // pointer moves either way; the file stays if a settled round still
    // claims it."
    for (const key of ["1001.neutron", "9002.neutron", "2000.neutron"]) {
      assert.equal(await assetExists(env, `${scope}pkg/${key}`), true, `${key} remains reachable`);
    }
    const [old] = await env.actor.entry_detail(weekOneId);
    assert.equal(old.entry.pkg[0].key, `${scope}pkg/1001.neutron`, "week one still points at its build");
  });

  it("does the same again between the semi-final and the final", async () => {
    await closeWeek(env);
    assert.equal(Number((await env.live()).week), 6);

    const build = `${scope}pkg/9003.neutron`;
    ok(
      await hacker.my_upload(store(build, 40, "application/octet-stream")),
      "upload a final build",
    );
    const entry = (await hacker.my_entry())[0];
    await land(mod, publish(entry.id, "0.4", "final build", build), "publish");
    const [updated] = await hacker.my_entry();
    assert.equal(Number(updated.week), 6);

    // 9002 is what the semi-final was judged on, so it survives its own
    // replacement; 1001 is week one's and has survived twice now, and 2000 is
    // week two's, which nothing has replaced at all.
    for (const key of ["1001.neutron", "9002.neutron", "9003.neutron", "2000.neutron"]) {
      assert.equal(await assetExists(env, `${scope}pkg/${key}`), true, `${key} remains reachable`);
    }
  });

  it("keeps every published winner asset frozen after the season finishes", async () => {
    const finished = await closeWeek(env);
    assert.equal(phaseOf(finished), "finished", "the final's deadline ends the season");
    assert.equal(await env.live(), null);

    // Two locks are on this store now, and this test is about the first: a key
    // a published entry names is frozen for good. `my_upload` checks the asset
    // lock before the finished-season and distribution locks, so these still
    // answer for their published record. Paying rewards will not unfreeze them.
    for (const key of [
      `${scope}icon/a.png`,
      `${scope}shots/s1.png`,
      `${scope}icon/b.png`,
      `${scope}pkg/1001.neutron`,
      `${scope}pkg/2000.neutron`,
      // The semi-final's build. It was replaced in week six, so only the
      // settled week-five row still names it — which is exactly the claim.
      `${scope}pkg/9002.neutron`,
      `${scope}pkg/9003.neutron`,
    ]) {
      assert.deepEqual(
        await hacker.my_upload(del(key)),
        { err: "that file is referenced by a published entry or pending review" },
        `${key} should be frozen`,
      );
    }
  });

  it("permanently closes new uploads and profile writes when the season finishes", async () => {
    // The second lock, and the wider one. Finishing the one allowed season
    // permanently closes participant writes. Published assets already have
    // their own record lock; fresh uploads and profile changes are refused by
    // the finished-season gate.
    //
    // It is a money rule. A payout row freezes the wallet it pays at draft time
    // so that a retry is byte-identical and the ledger's own deduplication
    // collapses it into one payment; a wallet edited between attempt one and
    // attempt two would defeat that and pay somebody twice. Freezing the row is
    // the first line of defence and this is the second, drawn wide enough to
    // cover the softer versions too — a rename, or an opt-out landing after the
    // split was computed.
    //
    // The launch fixture has the required approved sponsor and fixed ledger,
    // but its ledger balance is zero. There is no transfer plan or retry to
    // arm; the permanent one-season write closure does not depend on a timer.
    const [settling] = await env.actor.season();
    assert.deepEqual(settling.payout, { none: null }, "zero balance leaves no plan to send");
    assert.equal(await env.actor.payout_armed(), false, "there is nothing to retry");

    // A key no entry ever named cannot be added once the season is final. This
    // refusal is deliberately different from the published-asset lock above.
    assert.deepEqual(await hacker.my_upload(store(`${scope}icon/c.png`, 100)), {
      err: "uploads are permanently closed after the season finishes",
    });
    // Removing goes the same way as writing. The key names nothing — every
    // file this hacker uploaded is claimed by some settled round by now — which
    // is the point: the lock answers before the store is consulted at all.
    assert.deepEqual(await hacker.my_upload(del(`${scope}shots/never.png`)), {
      err: "files are locked until the season's rewards have been distributed",
    });

    // The same window, over the account rather than the store. The wallet is
    // the one that matters — it is the destination a drafted row would freeze —
    // but the opt-out moves the denominator every share is computed against,
    // and the avatar is here because the lock is not a money-fields whitelist.
    assert.deepEqual(await hacker.set_wallet(walletFor(1699)), { err: { Settling: null } });
    assert.deepEqual(await hacker.set_reward_opt_out(true), { err: { Settling: null } });
    assert.deepEqual(await hacker.set_avatar([`${scope}avatar/face.png`]), {
      err: { Settling: null },
    });

    // Entering and shipping are shut too, though not by this lock and not with
    // its error: `Review.proposeEntry` and `proposeVersion` both look for a
    // *running* season before they look at anything else, and a settling season
    // is finished. So a hacker who tries during the window hears `#NoSeason`,
    // and `#Distributing` — which the proposal layer does raise — is not what
    // reaches them here.
    assert.deepEqual(
      await hacker.submit_entry(entryInput({ title: "One more" })),
      refused({ NoSeason: null }),
    );
    assert.deepEqual(
      await publish(semiId, "0.5", "one more"),
      refused({ NoSeason: null }),
    );
  });

  it("keeps external keys gone once the season is over", async () => {
    // The seal has no other end, and this block is the only one that runs a
    // season to its finish and so the only place that can say so. The list was
    // made self-only before this season existed. So the state
    // asserted here is the canister's terminal state and not a phase of the
    // season: nothing that happens to the bracket, the payout or the clock
    // adds an external controller.
    //
    // A day past the final week, which is where the old arrangement handed the
    // keys back. Nothing is due, because nothing was lent.
    await env.advance(DAY + SECOND);
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "still exactly self-controlled",
    );

    // `Principal.isController` is read live on every call, so there is nothing
    // to un-do and equally nothing that could quietly come back. The identity
    // that installed this canister is a stranger to it, permanently.
    assert.deepEqual(await env.actor.set_config("Neutron", true), {
      err: "caller is not a controller",
    });
    assert.deepEqual(await env.actor.set_moderator("brk_bob", true, []), {
      err: { NotAllowed: null },
    });
    assert.equal(await env.actor.am_moderator(), false, "and it moderates nothing");
    // The desk appointed before the seal is the desk this canister has for the
    // rest of its life — the authority that survives is the one the installed
    // code granted while there was still somebody to grant it.
    assert.equal(await mod.am_moderator(), true);
  });
});
