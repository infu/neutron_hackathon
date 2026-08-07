/**
 * Nothing a hacker publishes reaches the bracket until a moderator agrees.
 *
 * The property that matters most here is the one that is easy to get wrong and
 * invisible when you do: a pending change must not alter what anybody else
 * sees. So most of these tests check the *entry* after a proposal, not the
 * revision — the revision going in is the easy half.
 *
 * Every decision below is made by a real moderator, never by the controller,
 * and by the time a season is running there is no external controller to make one. The
 * fixture creates a complete draft and then seals the canister before it starts:
 * `seal_canister()`
 * leaves the canister itself as sole controller and removes every external
 * controller. So `Principal.isController` is false for the
 * identity that installed the thing, the implicit moderator that
 * `Profiles.canModerate` used to grant it is gone, and it is gone for good.
 * That is the feature: the site claims the rules cannot change once entries
 * are in, and a controller who could still approve revisions — or ship a wasm
 * that approves them for him — would be a hole straight through it. The last
 * two blocks pin the seal itself, from both sides of it.
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
  MINUTE,
  WEEK,
} from "./harness.mjs";

/**
 * Every entry names a package — §3 says an entry *is* an app, so the row has to
 * point at a build. `cast` uploads one and closes over its key, which keeps
 * that plumbing out of the tests below: they are about review, not uploads.
 *
 * The slug is closed over for the same reason, and deliberately fixed per cast:
 * an app's id is chosen at its first submission and cannot move afterwards, so
 * every edit here has to hand the same one back or the call is refused with
 * "an app id cannot be changed once it is set".
 */
const entryFor = (scope, slug) => (over = {}) => ({
  title: "Beacon",
  summary: "",
  url: "",
  icon: [],
  shots: [],
  links: [],
  pkg: { key: `${scope}pkg/1.neutron` },
  slug,
  ...over,
});

const build = (key) => ({
  store: {
    key,
    contentType: "application/octet-stream",
    contentEncoding: "identity",
    chunks: 1n,
    content: new Uint8Array(64),
  },
});

const image = (key) => ({
  store: {
    key,
    contentType: "image/png",
    contentEncoding: "identity",
    chunks: 1n,
    content: new Uint8Array(64),
  },
});

const stateOf = (rev) => Object.keys(rev.state)[0];

/**
 * One hacker with a build, a moderator to judge them, a sealed canister, and a
 * season running.
 *
 * The order is not a preference; the launch checks force it into exactly this shape.
 * Appointing a moderator is controller-only, so it has to happen while there
 * still *is* a controller — which means before the seal, and the seal is
 * a one-way external-controller transition. The seal itself now requires the
 * launch draft and roster to be complete, while starting is refused until
 * the controller list is exactly self-only. Anybody else a test needs — a bystander, a
 * second author — therefore signs up before `cast` is called at all. Setup,
 * draft, point of no return, then start.
 *
 * The season is drawn up and started by `mod`, never by `env.actor`: those two
 * calls are moderator-gated precisely because after sealing a controller gate
 * would be a gate nobody could ever pass.
 *
 * The returned `mod` is who reviews. Nothing in this file reviews as
 * `env.actor`, because `env.actor` never may again.
 */
async function cast(env, ids, { authorModerator = false } = {}) {
  const hacker = await register(env.as, identity(ids.hacker), `h_${ids.hacker}`);
  // Registering is the whole acceptance — one agreement covering every role a
  // participant might later take — so the role itself is just a flag.
  ok(await hacker.set_hacker(true));
  // Somewhere to be paid, asked for before there is anything to pay for:
  // `Review.proposeEntry` refuses a hacker with no wallet with `#NoWallet`.
  ok(await hacker.set_wallet(walletFor(ids.hacker)), "a reward wallet");
  const id = (await hacker.me())[0].id;
  const scope = `/u/${id}/`;
  ok(await hacker.my_upload(build(`${scope}pkg/1.neutron`)), "upload a build");
  if (authorModerator) {
    ok(await env.actor.set_moderator(`h_${ids.hacker}`, true, []), "appoint the author moderator");
  }

  // The moderator's seed is offset far enough from the hacker's that it cannot
  // collide with the bystanders each block signs up at `hacker + 1`.
  const handle = `m_${ids.hacker}`;
  const mod = await register(env.as, identity(ids.hacker + 50), handle);
  ok(await env.actor.set_moderator(handle, true, []), "appoint a moderator");

  const draft = ok(await mod.create_season(), "a moderator drafts the season");
  // The last thing the controller ever does. Everything controller-gated is
  // already done above, because after this line none of it works again.
  ok(await env.seal(), "seal the canister");
  const season = ok(await mod.start_season(draft.id), "a moderator starts it");
  return { hacker, mod, season, id, scope, entry: entryFor(scope, ids.slug) };
}

describe("proposing an app", () => {
  let env, hacker, mod, season, entry, stranger;

  before(async () => {
    env = await bootstrap();
    // The bystander signs up first: registration shuts the moment `cast`
    // starts the season, so an account made afterwards would be refused.
    stranger = await register(env.as, identity(9001), "nosy");
    ({ hacker, mod, season, entry } = await cast(env, { hacker: 9000, slug: "beacon_propose" }));
  });
  after(async () => await env?.teardown());

  it("does not put anything in the bracket", async () => {
    const rev = ok(await hacker.submit_entry(entry()), "propose");
    assert.equal(stateOf(rev), "pending");
    assert.equal(rev.title, "Beacon");

    const week = await env.actor.season_week_view(season.id, season.week, 20n);
    assert.deepEqual(week, [], "an unreviewed app is not in the week");
    assert.deepEqual(await hacker.my_entry(), [], "not even to its author");
  });

  it("shows the author their own pending request", async () => {
    const mine = await hacker.my_revisions(10n);
    assert.equal(mine.length, 1);
    assert.equal(stateOf(mine[0]), "pending");
  });

  it("puts it in the moderator's queue and nobody else's view", async () => {
    assert.equal(await mod.review_pending(), 1n);
    assert.equal((await mod.review_queue(10n)).length, 1);

    assert.deepEqual(await stranger.review_queue(10n), [], "the queue is not public");
    assert.equal(await stranger.review_pending(), 0n);

    // Including the identity that installed the canister. The seal emptied the
    // controller list, so `Principal.isController` is false for it and
    // `canModerate` has nothing else to go on — the same empty answer a
    // stranger gets, and the same one it will get for ever.
    assert.deepEqual(await env.actor.review_queue(10n), [], "nor the sealed-out installer's");
    assert.equal(await env.actor.review_pending(), 0n);
  });

  it("refuses a proposal that could never be applied", async () => {
    // Checked at propose time so a hopeless request never reaches a human.
    const bad = await hacker.submit_entry(entry({ icon: ["/u/999/icon/x.png"] }));
    assert.ok("err" in bad, "somebody else's namespace is refused up front");
  });

  it("reaches the bracket only once approved", async () => {
    const [queued] = await mod.review_queue(10n);
    ok(await mod.approve_revision(queued.id), "approve");

    const week = await env.actor.season_week_view(season.id, season.week, 20n);
    assert.equal(week.length, 1, "now it is in the week");
    assert.equal(week[0].entry.title, "Beacon");
    assert.equal(await mod.review_pending(), 0n, "and out of the queue");
  });
});

describe("editing an approved app", () => {
  let env, hacker, mod, season, entry;

  before(async () => {
    env = await bootstrap();
    ({ hacker, mod, season, entry } = await cast(env, { hacker: 9100, slug: "beacon_edit" }));
    const first = ok(await hacker.submit_entry(entry({ title: "First" })));
    ok(await mod.approve_revision(first.id));
  });
  after(async () => await env?.teardown());

  it("leaves the approved version showing while the edit waits", async () => {
    ok(await hacker.submit_entry(entry({ title: "Second" })), "propose an edit");

    const week = await env.actor.season_week_view(season.id, season.week, 20n);
    assert.equal(week[0].entry.title, "First", "the public still sees what was approved");
    const [mine] = await hacker.my_entry();
    assert.equal(mine.title, "First", "and so does its author, for the live row");

    const pending = (await hacker.my_revisions(10n)).filter((r) => stateOf(r) === "pending");
    assert.equal(pending.length, 1, "but they can see what they asked for");
    assert.equal(pending[0].title, "Second");
  });

  it("swaps to the new version on approval", async () => {
    const [queued] = await mod.review_queue(10n);
    ok(await mod.approve_revision(queued.id));
    const week = await env.actor.season_week_view(season.id, season.week, 20n);
    assert.equal(week[0].entry.title, "Second");
  });

  it("keeps the old version on rejection", async () => {
    ok(await hacker.submit_entry(entry({ title: "Third" })));
    const [queued] = await mod.review_queue(10n);
    ok(await mod.reject_revision(queued.id, "The screenshots do not match the build."));

    const week = await env.actor.season_week_view(season.id, season.week, 20n);
    assert.equal(week[0].entry.title, "Second", "a rejection changes nothing");
  });
});

describe("a rejection", () => {
  let env, hacker, mod, entry;

  before(async () => {
    env = await bootstrap();
    ({ hacker, mod, entry } = await cast(env, { hacker: 9200, slug: "beacon_reject" }));
  });
  after(async () => await env?.teardown());

  it("carries a detailed, bounded explanation", async () => {
    const report = "Image 3 fails the check. ".repeat(70);
    assert.ok(report.length > 1_000, "a detailed review explanation");

    ok(await hacker.submit_entry(entry()));
    const [queued] = await mod.review_queue(10n);
    const done = ok(await mod.reject_revision(queued.id, report));

    assert.equal(stateOf(done), "rejected");
    assert.equal(done.reason.length, report.length, "stored whole, not truncated");
    assert.equal(done.reason, report);
  });

  it("is refused without a reason, and above the cap", async () => {
    ok(await hacker.submit_entry(entry({ title: "Again" })));
    const [queued] = await mod.review_queue(10n);
    assert.deepEqual(await mod.reject_revision(queued.id, ""), {
      err: { Invalid: "say why" },
    });
    assert.deepEqual(await mod.reject_revision(queued.id, "x".repeat(2_001)), {
      err: { Invalid: "that reason is too long" },
    });
  });

  it("lets the hacker fix it and ask again, keeping both on the record", async () => {
    const [queued] = await mod.review_queue(10n);
    ok(await mod.reject_revision(queued.id, "Try again."));
    ok(await hacker.submit_entry(entry({ title: "Fixed" })), "resubmitting is free");

    const mine = await hacker.my_revisions(20n);
    const states = mine.map(stateOf);
    assert.ok(states.includes("rejected"), "the rejection stays on the record");
    assert.ok(states.includes("pending"), "alongside the new attempt");
    assert.ok(
      mine.some((r) => r.reason.startsWith("Image 3 fails")),
      "and the full report is still readable",
    );
  });
});

describe("bounded private review history", () => {
  let env, hacker, mod, entry;

  before(async () => {
    env = await bootstrap();
    ({ hacker, mod, entry } = await cast(env, {
      hacker: 9250,
      slug: "beacon_bounded_history",
    }));
  });
  after(async () => await env?.teardown());

  it("keeps only the newest eight rows, including maximum multibyte reasons", async () => {
    const ids = [];
    const reason = "🧪".repeat(2_000);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const revision = ok(
        await hacker.submit_entry(entry({ title: `Attempt ${attempt + 1}` })),
      );
      ids.push(revision.id);
      ok(await mod.reject_revision(revision.id, reason));
    }

    const rows = await hacker.my_revisions(50n);
    assert.equal(rows.length, 8);
    assert.equal(rows.some((row) => row.id === ids[0]), false, "oldest row was pruned");
    assert.equal(rows[0].id, ids[8], "newest row remains first");
    assert.equal(Array.from(rows[0].reason).length, 2_000);
    assert.equal(new TextEncoder().encode(rows[0].reason).length, 8_000);
  });
});

describe("versions go through review too", () => {
  let env, hacker, mod, id, entry;

  before(async () => {
    env = await bootstrap();
    ({ hacker, mod, id, entry } = await cast(env, { hacker: 9300, slug: "beacon_version" }));
    const first = ok(await hacker.submit_entry(entry()));
    ok(await mod.approve_revision(first.id));
  });
  after(async () => await env?.teardown());

  it("does not publish until approved", async () => {
    // A second build, at its own key — the entry already carries the one it
    // was accepted with, so pointing the update at the same key would make
    // "nothing changed yet" and "the change landed" look identical.
    const next = `/u/${id}/pkg/2.neutron`;
    ok(await hacker.my_upload(build(next)));
    const [current] = await hacker.my_entry();
    ok(
      await hacker.publish_update(current.id, {
        version: "0.1",
        note: "first build",
        pkg: [{ key: next }],
      }),
    );

    const [mine] = await hacker.my_entry();
    assert.deepEqual(mine.updates, [], "the changelog is untouched");
    assert.equal(mine.pkg[0].key, `/u/${id}/pkg/1.neutron`, "still the build it was approved with");

    const [queued] = await mod.review_queue(10n);
    assert.equal(Object.keys(queued.kind)[0], "version");
    ok(await mod.approve_revision(queued.id));

    const [after] = await hacker.my_entry();
    assert.equal(after.updates.length, 1);
    assert.equal(after.updates[0].version, "0.1");
    assert.equal(after.pkg[0].key, next, "and now it is the new one");

    // The build it replaced is deleted, not merely unreferenced — the Build section of the Rules page
    // says a withdrawn build stops resolving, and its slot has to come back.
    assert.deepEqual(
      await env.actor.assets_list(`/u/${id}/pkg/1.neutron`, 10n),
      [],
      "the replaced build is gone",
    );
  });
});

describe("the final-hour app freeze", () => {
  let env, hacker, mod, season, id, scope, entry;

  before(async () => {
    env = await bootstrap();
    ({ hacker, mod, season, id, scope, entry } = await cast(env, {
      hacker: 9350,
      slug: "beacon_frozen",
    }));
    const first = ok(await hacker.submit_entry(entry({ title: "Approved" })));
    ok(await mod.approve_revision(first.id));
  });
  after(async () => await env?.teardown());

  it("expires queued metadata, screenshot, and package changes when ballots lock", async () => {
    const shot = `${scope}shots/locked.png`;
    const pkg = `${scope}pkg/2.neutron`;
    ok(await hacker.my_upload(image(shot)), "upload a screenshot");
    ok(await hacker.my_upload(build(pkg)), "upload a replacement package");

    const live = await env.live();
    // PocketIC sets milliseconds while the canister compares nanoseconds.
    // Round the deadline up exactly as the ballot-lock test does, then stand
    // one millisecond before the inclusive final-hour boundary.
    const deadlineMs = Number((live.weekEndsAt + 999_999n) / 1_000_000n);
    const cutoffMs = deadlineMs - 60 * MINUTE;
    await env.pic.setTime(cutoffMs - 1);

    const queued = ok(
      await hacker.submit_entry(
        entry({ title: "Locked change", shots: [shot], pkg: { key: pkg } }),
      ),
      "queue the edit before the lock",
    );

    await env.pic.setTime(cutoffMs);
    assert.deepEqual(await hacker.my_upload(build(`${scope}pkg/3.neutron`)), {
      err: "app uploads are closed for this round",
    });
    const done = ok(await mod.approve_revision(queued.id), "settle the now-locked edit");
    assert.equal(stateOf(done), "expired");
    assert.match(done.reason, /app-change window closed/);

    const [published] = await hacker.my_entry();
    assert.equal(published.title, "Approved", "metadata stays as judges saw it");
    assert.deepEqual(published.shots, [], "the screenshot stays off the ballot");
    assert.equal(published.pkg[0].key, `${scope}pkg/1.neutron`, "the package stays frozen too");
  });

  it("rejects direct full and package proposals at the same boundary", async () => {
    assert.deepEqual(await hacker.submit_entry(entry({ title: "Direct edit" })), {
      err: { Season: { WeekClosed: null } },
    });
    const [current] = await hacker.my_entry();
    assert.deepEqual(
      await hacker.publish_update(current.id, {
        version: "0.2",
        note: "direct package",
        pkg: [],
      }),
      { err: { Season: { WeekClosed: null } } },
    );
    assert.equal(await mod.review_pending(), 0n);
  });
});

describe("one pending revision slot", () => {
  let env, hacker, mod, id, entry;

  before(async () => {
    env = await bootstrap();
    ({ hacker, mod, id, entry } = await cast(env, {
      hacker: 9375,
      slug: "beacon_one_pending",
    }));
    const first = ok(await hacker.submit_entry(entry()));
    ok(await mod.approve_revision(first.id));
    ok(await hacker.my_upload(build(`/u/${id}/pkg/2.neutron`)));
  });
  after(async () => await env?.teardown());

  it("cannot be multiplied or bypassed with the other revision kind", async () => {
    ok(await hacker.submit_entry(entry({ title: "Waiting" })), "the first request");
    const alreadyPending = {
      err: { Invalid: "a revision for this week is already waiting for review" },
    };
    assert.deepEqual(await hacker.submit_entry(entry({ title: "Buried" })), alreadyPending);
    const [current] = await hacker.my_entry();
    assert.deepEqual(
      await hacker.publish_update(current.id, {
        version: "0.2",
        note: "also waiting",
        pkg: [],
      }),
      alreadyPending,
      "a package request cannot race a full request",
    );
    assert.equal(await mod.review_pending(), 1n);
    assert.equal((await mod.review_queue(200n)).length, 1);
  });

  it("releases the slot after a decision, then bounds the package kind too", async () => {
    const [full] = await mod.review_queue(10n);
    ok(await mod.reject_revision(full.id, "revise it"));

    const [current] = await hacker.my_entry();
    ok(
      await hacker.publish_update(current.id, {
        version: "0.2",
        note: "package request",
        pkg: [{ key: `/u/${id}/pkg/2.neutron` }],
      }),
    );
    assert.deepEqual(
      await hacker.publish_update(current.id, {
        version: "0.3",
        note: "duplicate",
        pkg: [],
      }),
      { err: { Invalid: "a revision for this week is already waiting for review" } },
    );
    assert.equal(await mod.review_pending(), 1n);
  });
});

describe("a revision the week left behind", () => {
  let env, hacker, mod, season, entry;

  before(async () => {
    env = await bootstrap();
    ({ hacker, mod, season, entry } = await cast(env, { hacker: 9400, slug: "beacon_late" }));
  });
  after(async () => await env?.teardown());

  it("expires rather than being applied to the wrong week", async () => {
    const queued = ok(await hacker.submit_entry(entry({ title: "Too late" })));
    // The week closes on its own timer while it sits in the queue.
    await env.advance(WEEK + DAY);

    assert.deepEqual(await mod.review_queue(10n), [], "stale work is omitted from the queue");
    assert.equal(await mod.review_pending(), 0n, "and from its actionable count");
    const done = ok(await mod.approve_revision(queued.id));
    assert.equal(stateOf(done), "expired");
    assert.match(done.reason, /app-change window closed before this was reviewed/);

    const closed = await env.actor.season_week_view(season.id, 1n, 20n);
    assert.deepEqual(closed, [], "nothing was written into the week that closed");

    const current = ok(await hacker.submit_entry(entry({ title: "Current week" })));
    assert.equal(stateOf(current), "pending", "the stale row does not occupy the new week's slot");
    assert.equal(await mod.review_pending(), 1n);
  });
});

describe("who may decide", () => {
  let env, hacker, mod, entry, stranger;

  before(async () => {
    env = await bootstrap();
    // Signed up ahead of the season, because starting one closes the door.
    stranger = await register(env.as, identity(9501), "outsider");
    ({ hacker, mod, entry } = await cast(env, { hacker: 9500, slug: "beacon_decide" }));
    ok(await hacker.submit_entry(entry()));
  });
  after(async () => await env?.teardown());

  it("is a moderator, and nobody else — not even the controller", async () => {
    const [queued] = await mod.review_queue(10n);

    assert.deepEqual(await stranger.approve_revision(queued.id), { err: { NotAllowed: null } });
    assert.deepEqual(await stranger.reject_revision(queued.id, "no"), { err: { NotAllowed: null } });
    assert.deepEqual(
      await hacker.approve_revision(queued.id),
      { err: { NotAllowed: null } },
      "not even its author",
    );

    // And not whoever installed the canister. A controller used to be an
    // implicit moderator; the seal removed the installer from the controller
    // list, so it is no longer implicitly anything. What the
    // bracket contains stops being anybody's to edit.
    assert.deepEqual(
      await env.actor.approve_revision(queued.id),
      { err: { NotAllowed: null } },
      "the installer is sealed out for good",
    );
    assert.deepEqual(
      await env.actor.reject_revision(queued.id, "no"),
      { err: { NotAllowed: null } },
      "in both directions",
    );
    // Nor can it appoint itself back in: `set_moderator` is controller-gated,
    // and the installer is no longer a controller.
    assert.deepEqual(await env.actor.set_moderator("outsider", true, []), {
      err: { NotAllowed: null },
    });
  });

  it("cannot decide the same thing twice", async () => {
    const [queued] = await mod.review_queue(10n);
    ok(await mod.approve_revision(queued.id));
    assert.deepEqual(await mod.approve_revision(queued.id), { err: { NotPending: null } });
    assert.deepEqual(await mod.reject_revision(queued.id, "changed my mind"), {
      err: { NotPending: null },
    });
  });
});

describe("a moderator reviewing their own work", () => {
  let env, author, reviewer, entry, id;

  before(async () => {
    env = await bootstrap();
    ({ hacker: author, mod: reviewer, entry, id } = await cast(
      env,
      { hacker: 9550, slug: "beacon_self_review" },
      { authorModerator: true },
    ));
  });
  after(async () => await env?.teardown());

  it("cannot approve or reject their own entry revision", async () => {
    const revision = ok(await author.submit_entry(entry()), "propose an entry");
    assert.deepEqual(await author.approve_revision(revision.id), { err: { NotAllowed: null } });
    assert.deepEqual(await author.reject_revision(revision.id, "self review"), {
      err: { NotAllowed: null },
    });
    assert.equal(await reviewer.review_pending(), 1n, "the refused decision leaves it pending");
    ok(await reviewer.approve_revision(revision.id), "a different moderator approves it");
  });

  it("cannot approve or reject their own version revision", async () => {
    const next = `/u/${id}/pkg/2.neutron`;
    ok(await author.my_upload(build(next)), "upload the next build");
    const [current] = await author.my_entry();
    const revision = ok(
      await author.publish_update(current.id, {
        version: "0.2",
        note: "review me",
        pkg: [{ key: next }],
      }),
      "propose a version",
    );
    assert.deepEqual(await author.approve_revision(revision.id), { err: { NotAllowed: null } });
    assert.deepEqual(await author.reject_revision(revision.id, "self review"), {
      err: { NotAllowed: null },
    });
    assert.equal(await reviewer.review_pending(), 1n, "the version still awaits an independent reviewer");
    ok(await reviewer.approve_revision(revision.id), "the independent moderator approves it");
  });
});

/**
 * The seal from the near side: what it costs, and what refuses until it is
 * paid.
 *
 * This is the only block in the file that gets to see the canister with its
 * controllers still on it, because `cast` spends them. It is worth pinning in
 * this direction rather than only inferring the seal from a later
 * `NotAllowed`: the claim a participant checks before entering is that no
 * season *can* begin while somebody still holds the keys, and that is a
 * refusal, not a permission.
 */
describe("sealing, and what waits on it", () => {
  let env, mod, draft;

  before(async () => {
    env = await bootstrap();
    mod = await register(env.as, identity(9700), "gatekeeper");
    // Controller-only, and there is exactly one window for it: now.
    ok(await env.actor.set_moderator("gatekeeper", true, []), "appoint a moderator");
    draft = ok(await mod.create_season(), "a moderator may draw one up unsealed");
  });
  after(async () => await env?.teardown());

  it("refuses to start a season before the exact self-only seal", async () => {
    const held = await env.pic.getControllers(env.canisterId);
    assert.ok(held.length > 0, "the fixture starts out controlled, like a real deployment");

    // Checked against the replica on every start, not against a flag the
    // canister set for itself — a canister that merely *recorded* a seal it
    // never applied has to fail this.
    const refused = await mod.start_season(draft.id);
    assert.ok("err" in refused, JSON.stringify(refused));
    assert.match(refused.err.Invalid, /not sealed/);
    assert.match(refused.err.Invalid, /seal_canister/, "and it says how to seal");
  });

  it("is not something a passer-by can do", async () => {
    const outsider = env.as(identity(9701));
    assert.deepEqual(await outsider.seal_canister(), { err: "caller is not a controller" });

    const held = await env.pic.getControllers(env.canisterId);
    assert.ok(held.length > 0, "and the list is untouched");
  });

  it("hands the season to the moderators the moment it lands", async () => {
    ok(await env.seal(), "the point of no return");

    // Straight from the management canister, not from a season row: this is
    // the answer a participant checks, and the canister cannot fake it.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the canister itself is the sole controller",
    );

    // The installer stops being an implicit moderator in the same instant, so
    // it cannot even draft the season.
    assert.deepEqual(
      await env.actor.create_season(),
      { err: { NotAllowed: null } },
      "the installer is not a moderator any more",
    );

    const season = ok(await mod.start_season(draft.id), "a moderator starts it");
    assert.equal(phaseOf(season), "running");
    assert.equal(season.week, 1n, "on week one, running on its own clock from here");
  });
});

/**
 * The seal from the far side: it takes every external controller power.
 *
 * This is the mechanism every block above depends on, so it is pinned from the
 * outside rather than inferred from a `NotAllowed`. The queue seeded here is
 * left pending on purpose — it is the probe that tells "the installer may not
 * look" apart from "there is nothing to look at", and it is still the probe
 * after the season has run itself out.
 */
describe("what the seal takes, for good", () => {
  let env, hacker, mod, entry;

  before(async () => {
    env = await bootstrap();
    ({ hacker, mod, entry } = await cast(env, { hacker: 9600, slug: "beacon_sealed" }));
    ok(await hacker.submit_entry(entry()), "something to leave in the queue");
  });
  after(async () => await env?.teardown());

  it("leaves the canister itself as the sole controller", async () => {
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the list is exactly self-only",
    );
  });

  it("takes every power the installer had, all at once", async () => {
    // The probe first: a row that demonstrably exists, that `mod` can see and
    // the installer cannot. Without it, "may not look" and "nothing to look
    // at" are the same empty array.
    assert.equal((await mod.review_queue(10n)).length, 1, "a real row is waiting");
    assert.deepEqual(await env.actor.review_queue(10n), [], "and the installer cannot see it");

    // Everything else that was ever controller-gated, in one place, because
    // the failure that matters is one of them quietly still working.
    assert.deepEqual(await env.actor.set_moderator("m_9600", false, []), {
      err: { NotAllowed: null },
    });
    assert.deepEqual(await env.actor.set_config("Anything At All", true), {
      err: "caller is not a controller",
    });
    assert.deepEqual(await env.actor.set_instruction_cap(1n), {
      err: "caller is not a controller",
    });
    // Which is why the frontend has to be uploaded before the seal: after it,
    // the site serves whatever bytes it was holding, for ever.
    assert.deepEqual(await env.actor.assets_upload(build("/index.html")), {
      err: "caller is not a controller",
    });
  });

  it("cannot be upgraded, so the code judging the bracket is the code entered against", async () => {
    // Not a refusal from the canister — a refusal from the replica. There is
    // no external controller to authorise `install_code`, so the call never reaches the
    // canister at all and the client sees a rejection rather than a `Result`.
    //
    // The reason is asserted, not just the throw. An `install_code` can be
    // refused for reasons that have nothing to do with the seal — a freshly
    // installed canister is rate limited on it for a while, with an entirely
    // different message — and a bare `rejects` would happily pass on one of
    // those, which is precisely the case where the seal had silently failed.
    await assert.rejects(
      () => env.upgrade(),
      /Only controllers of canister .* install_code/,
      "the former installer cannot upgrade the sealed canister",
    );
  });

  it("outlasts the season that depended on it", async () => {
    // Run the season out. Six weeks, each closing on its own timer. Nothing
    // about finishing gives anything back: there is no grace period, no
    // deadline, no method to call. The seal is not a loan.
    let season;
    for (let i = 0; i < 6; i++) {
      season = await closeWeek(env);
      if (phaseOf(season) === "finished") break;
    }
    assert.equal(phaseOf(season), "finished", "the season ran its course");

    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "and it is still exactly self-controlled",
    );

    // The same row still exists in the author's bounded history, but finished
    // seasons never expose stale paperwork as actionable moderation work.
    assert.deepEqual(await mod.review_queue(10n), [], "the stale row is no longer queue work");
    assert.deepEqual(
      await env.actor.review_queue(10n),
      [],
      "and the installer never becomes a moderator again",
    );
  });
});
