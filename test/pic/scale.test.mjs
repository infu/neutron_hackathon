/**
 * Scale, and the paging that has to survive it.
 *
 * Everything here is about size. A few hundred registered users spread across
 * the whole alphabet, a qualifier week with more entrants than any listing
 * will return in one call, and an audit log longer than one page. Those are
 * the conditions under which a cursor that repeats a row, a ceiling that lies
 * about itself, or a ranking that is truncated before it is ordered stop being
 * theoretical.
 *
 * Each `describe` boots its own canister, so the identity numbers repeat
 * between them; they never collide inside one replica.
 *
 * Building a week at this size is now four steps per hacker, not one: give them
 * a reward wallet, because there is no proposing an entry without one, upload
 * the `.neutron` package the entry has to name, propose the entry, and have a
 * moderator approve it. Only the approvals run serially — that is the order the
 * entries are created in, and therefore the order the bracket section of the Rules page breaks ties by.
 *
 * "A moderator" is now meant literally. Before any season can start,
 * `seal_canister()` removes every external controller and retains only the
 * canister's own principal. So from the seal onwards the identity that
 * installed the canister is not a controller, and
 * `Profiles.canModerate`'s "a controller is an implicit moderator" covers
 * no external caller. The hundred and twenty, and the thousand-entry boundary,
 * approvals below are made by somebody with a real `moderator` flag.
 *
 * That puts every controller-only call under one ordering constraint, the same
 * one the judges is already under. Appointing a moderator is controller-only and
 * the seal removes the installer, exactly as `start_season` freezes
 * `set_judge` — so both are normally completed before the seal. Every
 * season suite here seats its moderator alongside its judges, drafts the
 * complete season, seals, and only then starts it *as that moderator*:
 * `create_season` and
 * `start_season` are moderator calls now, because a controller gate on a
 * self-only canister is a gate no external caller could pass.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  bootstrap,
  identity,
  ok,
  phaseOf,
  register,
  walletFor,
  DAY,
  WEEK,
} from "./harness.mjs";

// ── The cast ────────────────────────────────────────────────────────────────

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const NON_ALPHA = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "_"];
const BUCKETS = ["#", ...LETTERS.map((l) => l.toUpperCase())];
const FILTERS = [
  "all",
  "hackers",
  "observers",
  "judges",
  "pending",
  "sponsors",
  "sponsorsPending",
  "moderators",
];

/** Candid variant from a tag name. */
const v = (tag) => ({ [tag]: null });

/**
 * The one `.neutron` build every entry in this file ships.
 *
 * An entry now carries a required package, and `Season.checkEntry` asks the
 * asset store whether there is a finished upload behind the key — so a
 * submission has to be preceded by a real one. The bytes are not the point at
 * this scale; the key existing is.
 */
const pkgKey = (userId) => `/u/${userId}/pkg/1.neutron`;

const uploadPackage = async (actor, userId) =>
  ok(
    await actor.my_upload({
      store: {
        key: pkgKey(userId),
        contentType: "application/octet-stream",
        contentEncoding: "identity",
        chunks: 1n,
        content: new Uint8Array(64),
      },
    }),
    `upload ${pkgKey(userId)}`,
  );

/**
 * The permanent app id an entry is filed under.
 *
 * `slug` is required now, and `Season.validSlug` allows only `a-z` and `_`,
 * 5 to 50 characters. It has to be unique across hackers and can never be
 * changed once set, because it names the `<slug>.neutron` file people
 * download. The handles in this file carry digits, which an id may not, so
 * each digit is transliterated to its own letter rather than dropped:
 * `hack_17` becomes `hack_bh`. One handle, one id, and still legible in a
 * failure message. Every handle that submits here is `hack_<n>` or `mass_<n>`,
 * so the result is never shorter than the five-character minimum.
 */
const DIGIT_LETTERS = "abcdefghij";

const slugOf = (handle) => handle.replace(/[0-9]/g, (d) => DIGIT_LETTERS[Number(d)]);

/**
 * Run `job` over `items` in parallel batches, keeping the results in order.
 * `job` is handed the item and its index in the whole list, not in the batch.
 */
async function inBatches(items, size, job) {
  const out = [];
  for (let base = 0; base < items.length; base += size) {
    out.push(
      ...(await Promise.all(items.slice(base, base + size).map((item, k) => job(item, base + k)))),
    );
  }
  return out;
}

/**
 * Handles of differing lengths inside one bucket, so ordering is decided by
 * the comparison and not by every handle being the same shape.
 */
const TAILS = [
  "ada", "bea", "cyd", "dot", "eve", "fox", "gus",
  "hal", "ivy", "jun", "kit", "lou", "moe",
];

const handlesFor = (prefix, count) =>
  Array.from(
    { length: count },
    (_, j) => `${prefix}${TAILS[j % TAILS.length]}${j >= TAILS.length ? j : ""}`,
  );

/**
 * Roles by registration order, not by handle — so every role is scattered
 * through the alphabet and a filtered listing genuinely has to seek rather
 * than read a contiguous run.
 *
 * The proportions are chosen so more than a hundred judges are left pending:
 * the unpaged CLI helpers claim a ceiling of 200 and that only means anything
 * once there are more than a hundred rows to hand back.
 */
const roleOf = (n) => ({
  hacker: n % 4 === 0,
  judge: n % 5 === 0 ? "approved" : n % 2 === 1 ? "pending" : "no",
  sponsor: n % 21 === 0 ? "approved" : n % 7 === 3 ? "pending" : "no",
  // The production bench is capped at eight. Registration order is shuffled
  // against handle order, so these eight still exercise paging across the
  // alphabet without asking the fixture to violate the real limit.
  moderator: n % 13 === 5 && n < 13 * 8,
});

function population() {
  const handles = [];
  LETTERS.forEach((letter, i) => handles.push(...handlesFor(letter, 9 + ((i * 5) % 7))));
  NON_ALPHA.forEach((prefix) => handles.push(...handlesFor(prefix, prefix === "_" ? 6 : 3)));

  // Registration order is deliberately not alphabetical order: a handle index
  // that quietly fell back to insertion order would otherwise still pass.
  let seed = 20260801;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = handles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [handles[i], handles[j]] = [handles[j], handles[i]];
  }

  return handles.map((handle, n) => ({ handle, n, ...roleOf(n) }));
}

const PEOPLE = population();
const FIRST_ID = 2200;

const bucketOf = (handle) => (/^[a-z]/.test(handle) ? handle[0].toUpperCase() : "#");

const matches = (p, filter) =>
  ({
    all: true,
    hackers: p.hacker,
    observers: !p.hacker && p.judge === "no" && p.sponsor === "no" && !p.moderator,
    judges: p.judge === "approved",
    pending: p.judge === "pending",
    sponsors: p.sponsor === "approved",
    sponsorsPending: p.sponsor === "pending",
    moderators: p.moderator,
  })[filter];

/** What the canister ought to return, straight off the model. */
const expected = (filter, letter = null) =>
  PEOPLE.filter((p) => matches(p, filter) && (letter === null || bucketOf(p.handle) === letter))
    .map((p) => p.handle)
    .sort();

/**
 * Page a listing to exhaustion, following `next` exactly as a client would.
 *
 * Returns everything it saw plus the shape of the walk, so a caller can tell
 * a repeated row from a missing one and a wrong `total` from a wrong page.
 */
async function walk(actor, filter, letter, pageSize) {
  const handles = [];
  const totals = new Set();
  const pageSizes = [];
  let after = [];

  for (let guard = 0; ; guard += 1) {
    assert.ok(guard < 2000, `users_page(${filter}) never reached the end`);
    const page = await actor.users_page(v(filter), letter === null ? [] : [letter], after, BigInt(pageSize));
    totals.add(Number(page.total));
    pageSizes.push(page.rows.length);
    handles.push(...page.rows.map((u) => u.handle));
    if (page.next.length === 0) break;
    after = page.next;
  }

  return { handles, pageSizes, totals: [...totals] };
}

async function buildPopulation(env) {
  const CHUNK = 40;
  for (let base = 0; base < PEOPLE.length; base += CHUNK) {
    await Promise.all(
      PEOPLE.slice(base, base + CHUNK).map(async (p) => {
        const who = await register(env.as, identity(FIRST_ID + p.n), p.handle);
        // No reward wallet for this cast: the hacker flag is all the listings
        // and indexes read, and a wallet is only demanded at `submit_entry`,
        // which nobody in this fixture ever reaches — there is no season here.
        // One acceptance, taken at registration, covering every role — so
        // taking a role asks for nothing further. `set_hacker` wants a
        // registered caller and nothing else.
        if (p.hacker) ok(await who.set_hacker(true), `hacker ${p.handle}`);
        if (p.judge !== "no") ok(await who.apply_as_judge(), `apply judge ${p.handle}`);
        if (p.sponsor !== "no") {
          // Sponsoring means sending money, and it is still only the one
          // acceptance behind it: `apply_as_sponsor` checks the application,
          // not a second attestation the applicant might have skipped.
          ok(
            await who.apply_as_sponsor({
              org: `Org ${p.n}`,
              website: "",
              logo: [],
              blurb: "",
              ledgers: [{ id: env.launchLedger, sns: false }],
            }),
            `apply sponsor ${p.handle}`,
          );
        }
      }),
    );
  }

  // Moderator decisions run serially and all land in one audit log; that log's
  // order is what the paging test below reads back. Approving a judge or a
  // sponsor now takes two moderators, but `env.actor` is the controller and
  // has no profile row of its own — `Moderation.quorum` lets it through alone,
  // so each approval is still exactly one decision and one log row.
  //
  // That hatch is only open because this suite never seals. `seal_canister`
  // empties the controller list for good, and an identity that is no longer a
  // controller gets neither the quorum exemption nor `canModerate`. The two
  // season suites below have to seal before they may start anything, so they
  // appoint real moderators — above the seal, the only place it can be done.
  for (const p of PEOPLE) {
    if (p.judge === "approved") ok(await env.actor.set_judge(p.handle, v("approved"), []), `approve ${p.handle}`);
    if (p.sponsor === "approved") ok(await env.actor.set_sponsor(p.handle, v("approved"), []), `sponsor ${p.handle}`);
    if (p.moderator) ok(await env.actor.set_moderator(p.handle, true, []), `moderator ${p.handle}`);
  }
}

// ── A few hundred users ─────────────────────────────────────────────────────

describe("a few hundred users", () => {
  let env;

  before(async () => {
    env = await bootstrap();
    await buildPopulation(env);
  });

  after(async () => {
    await env?.teardown();
  });

  it("registers the whole cast and counts it correctly", async () => {
    const stats = await env.actor.stats();
    for (const filter of FILTERS) {
      const key = filter === "all" ? "users" : filter;
      assert.equal(
        Number(stats[key]),
        expected(filter).length,
        `stats().${key} should match the cast`,
      );
    }
    assert.ok(Number(stats.users) >= 300, "the point of this file is a few hundred users");

    // The unsealed baseline the two season suites are measured against. This
    // suite never calls `seal_canister` — it has no season to start, and the
    // upgrade test at the bottom needs a canister that can still be upgraded —
    // so the human still holds the keys beside the canister and `canModerate`
    // still reads a controller as an implicit moderator. That is the only
    // reason the whole cast above could be approved by `env.actor` with no
    // moderator in sight.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((p) => p.toText()).sort(),
      [env.controller.getPrincipal().toText(), env.canisterId.toText()].sort(),
      "the controller and the canister, exactly as the fixture was stood up",
    );
    assert.equal(await env.actor.is_controller(), true, "the human still holds the keys");
    assert.equal(await env.actor.am_moderator(), true, "and moderates by holding them");
  });

  for (const filter of FILTERS) {
    it(`users_page walks every ${filter} exactly once`, async () => {
      const want = expected(filter);
      // 7 divides nothing here, so every page boundary lands mid-run.
      const { handles, pageSizes, totals } = await walk(env.actor, filter, null, 7);

      assert.equal(new Set(handles).size, handles.length, "a handle came back twice");
      assert.deepEqual(handles, want, "the walk should be the whole set, in handle order");
      assert.deepEqual(totals, [want.length], "`total` should be the filter's size on every page");
      for (const size of pageSizes.slice(0, -1)) {
        assert.equal(size, 7, "only the last page may be short");
      }
    });
  }

  it("ends the walk cleanly when the last page is exactly full", async () => {
    // The end-of-listing signal is "the iterator had nothing after the page",
    // which is the case a size that divides the set exactly would expose.
    const total = expected("all").length;
    const size = [...Array(100).keys()].map((i) => i + 1).filter((n) => total % n === 0).pop();
    assert.ok(size > 1 && size <= 100, `no usable page size for ${total} rows`);

    const { handles, pageSizes } = await walk(env.actor, "all", null, size);
    assert.deepEqual(handles, expected("all"));
    assert.equal(pageSizes.length, total / size, "no empty page should be needed to finish");
    assert.ok(
      pageSizes.every((n) => n === size),
      "every page of an exactly divided listing is full",
    );
  });

  it("letter_counts agrees with what paging actually yields", async () => {
    for (const filter of FILTERS) {
      const counts = await env.actor.letter_counts(v(filter));
      assert.deepEqual(
        counts.map((c) => c.letter),
        BUCKETS,
        "the A-Z strip is # then A-Z",
      );

      const sum = counts.reduce((n, c) => n + Number(c.count), 0);
      assert.equal(sum, expected(filter).length, `letter_counts(${filter}) should sum to the filter`);

      const seen = [];
      for (const { letter, count } of counts) {
        const want = expected(filter, letter);
        assert.equal(Number(count), want.length, `${filter} bucket ${letter}`);
        // A small page size so the buckets that do exist take several pages.
        const { handles, totals } = await walk(env.actor, filter, letter, 5);
        assert.deepEqual(handles, want, `${filter} bucket ${letter} paged`);
        assert.deepEqual(totals, [want.length], `${filter} bucket ${letter} total`);
        seen.push(...handles);
      }
      assert.deepEqual(seen.sort(), expected(filter), `${filter}: the buckets should partition it`);
    }
  });

  it("seeks straight to a bucket without dragging the alphabet with it", async () => {
    // "#" is everything before "a" — digits and underscore — and it must not
    // pick up the letters that follow it in the same index.
    const hash = await env.actor.users_page(v("all"), ["#"], [], 100n);
    assert.ok(hash.rows.length > 0, "the cast includes handles starting with a digit or _");
    for (const user of hash.rows) {
      assert.ok(!/^[a-z]/.test(user.handle), `${user.handle} is not a # handle`);
    }
    assert.deepEqual(hash.rows.map((u) => u.handle), expected("all", "#"), "and all of them");
    assert.ok(
      hash.rows.some((u) => u.handle.startsWith("_")),
      "underscore sorts below the digits, not above the letters",
    );

    // The last bucket has nothing above it to run into.
    const z = await env.actor.users_page(v("all"), ["Z"], [], 100n);
    assert.deepEqual(z.rows.map((u) => u.handle), expected("all", "Z"));
  });

  it("returns nothing for a bucket or cursor that does not exist", async () => {
    const empty = await env.actor.users_page(v("all"), ["Q"], ["zzzzzzzz"], 25n);
    assert.deepEqual(empty.rows, [], "a cursor past the end of a bucket yields no rows");
    assert.deepEqual(empty.next, [], "and no way to keep going");

    const beyond = await env.actor.users_page(v("all"), [], ["zzzzzzzz"], 25n);
    assert.deepEqual(beyond.rows, [], "nothing sorts above the whole listing");
  });

  it("keeps a letter bucket to its own letter whatever cursor it is handed", async () => {
    // The test above only tries a cursor that sorts *above* the bucket, where
    // the range inverts and the answer is empty however the bounds are built.
    // The other direction is the one that matters: `Profiles.handleRange`
    // drops the bucket's lower bound the moment a cursor is present — "a
    // cursor is always inside the bucket" — leaving only `gt = after` and
    // `lt = successor(letter)`. A cursor from a lower bucket then *widens* the
    // page instead of narrowing it. `groupRange` has the identical shape, so
    // the filtered listings go the same way.
    //
    // Whatever the intended reading of an out-of-bucket cursor — honour the
    // bucket, or return nothing — a page for letter L may only contain L, and
    // a page can never be longer than the `total` it reports beside itself.
    const belowD = expected("all", "B")[0];
    assert.ok(belowD, "the fixture needs a bucket below D to take a stale cursor from");

    for (const filter of ["all", "hackers"]) {
      const page = await env.actor.users_page(v(filter), ["D"], [belowD], 100n);
      assert.deepEqual(
        page.rows.map((u) => u.handle).filter((h) => bucketOf(h) !== "D"),
        [],
        `${filter}: a page for bucket D returned rows from other buckets`,
      );
      assert.ok(
        page.rows.length <= Number(page.total),
        `${filter}: the page holds ${page.rows.length} rows but reports total ${Number(page.total)}`,
      );
    }

    // The sequence a client actually performs: page one bucket, then click a
    // different letter while still holding the `next` the first one handed it.
    const first = await env.actor.users_page(v("all"), ["B"], [], 3n);
    assert.equal(first.rows.length, 3, "B needs more than one page for this to mean anything");
    assert.notDeepEqual(first.next, [], "and it has to hand back a cursor");

    const carried = await env.actor.users_page(v("all"), ["D"], first.next, 100n);
    assert.deepEqual(
      carried.rows.map((u) => u.handle).filter((h) => bucketOf(h) !== "D"),
      [],
      "a cursor left over from bucket B must not drag B and C into bucket D",
    );
  });

  it("searches by handle prefix, case-folded and filtered", async () => {
    const prefix = "bada";
    const want = PEOPLE.map((p) => p.handle).filter((h) => h.startsWith(prefix)).sort();
    assert.ok(want.length > 1, "the prefix should match more than one handle to mean anything");

    const hits = await env.actor.users_search(prefix, v("all"), 50n);
    assert.deepEqual(hits.map((u) => u.handle).sort(), want);

    const upper = await env.actor.users_search(prefix.toUpperCase(), v("all"), 50n);
    assert.deepEqual(
      upper.map((u) => u.handle).sort(),
      want,
      "handles are lowercase, so a typed capital must still match",
    );

    // A whole bucket by its letter, which is the widest prefix there is.
    const bucket = await env.actor.users_search("m", v("all"), 100n);
    assert.deepEqual(bucket.map((u) => u.handle).sort(), expected("all", "M"));

    // The same prefix, narrowed by role.
    const wantHackers = expected("hackers", "M");
    assert.ok(wantHackers.length > 0, "the M bucket should contain hackers");
    const hackers = await env.actor.users_search("m", v("hackers"), 100n);
    assert.deepEqual(
      hackers.map((u) => u.handle).sort(),
      wantHackers,
      "a filtered search should still find every hacker in the bucket",
    );

    assert.deepEqual(await env.actor.users_search("", v("all"), 50n), [], "an empty prefix is not a search");
    assert.deepEqual(await env.actor.users_search("qqzz", v("all"), 50n), []);
  });

  it("holds its listing ceilings and honours anything under them", async () => {
    const total = expected("all").length;

    const huge = await env.actor.users_page(v("all"), [], [], 100_000_000n);
    assert.ok(huge.rows.length <= 100, `users_page returned ${huge.rows.length} rows`);
    assert.equal(huge.rows.length, 100, "and should fill the page it does allow");
    assert.equal(Number(huge.total), total, "`total` reports the whole set, not the page");

    const modest = await env.actor.users_page(v("all"), [], [], 37n);
    assert.equal(modest.rows.length, 37, "a request under the ceiling is honoured exactly");

    // `users_search`'s own ceiling is 100, but no prefix in this fixture can
    // match anywhere near that — the largest letter bucket holds 15 — so
    // `search.length <= 100` would hold with the ceiling deleted entirely.
    // Assert instead what this data can actually prove: a greedy request
    // returns the whole match set rather than a truncated slice of it, and a
    // small request is honoured exactly *and* is the first N of that set.
    // Reaching the 100-row cut needs a prefix with more than a hundred hits,
    // which this cast does not have.
    const searchAll = await env.actor.users_search("a", v("all"), 100_000_000n);
    assert.deepEqual(
      searchAll.map((u) => u.handle).sort(),
      expected("all", "A"),
      "a greedy search returns every match, not a truncated prefix of them",
    );
    const searchFew = await env.actor.users_search("a", v("all"), 4n);
    assert.deepEqual(
      searchFew.map((u) => u.handle),
      expected("all", "A").slice(0, 4),
      "a limit under the ceiling is honoured exactly, and takes the first four in order",
    );

    const recentAll = await env.actor.recent_users(100_000_000n);
    assert.ok(recentAll.length <= 200, `recent_users returned ${recentAll.length}`);
    assert.equal(recentAll.length, 200, "recent_users' own ceiling is 200");
    assert.equal(
      new Set(recentAll.map((u) => u.handle)).size,
      recentAll.length,
      "newest-first must not repeat a row",
    );
    let previous = null;
    for (const user of recentAll) {
      if (previous !== null) assert.ok(user.createdAt <= previous, "recent_users is newest first");
      previous = user.createdAt;
    }

    const recentSome = await env.actor.recent_users(150n);
    assert.equal(recentSome.length, 150, "a request under the ceiling is honoured exactly");
  });

  // Named for what it requires, not for the defect it currently finds: a test
  // called after the bug reads as a lie the day the bug is fixed.
  it("hands back every pending judge up to its documented ceiling of 200", async () => {
    // `MAX_PEOPLE = 200` in main.mo, and `Profiles.atMost` promises that "a
    // smaller number is honoured exactly". `recent_users` keeps that promise
    // under the same constant; `pending_judges` and `moderators` go through
    // `Profiles.page`, whose own MAX_LIMIT of 100 cuts them down again. These
    // are unpaged helpers with no cursor, so the rows past 100 are simply not
    // reachable through this method at all.
    const pending = expected("pending");
    assert.ok(pending.length > 100, "the fixture needs more than a page of pending judges");

    // The rows are not missing, only unreachable: the paged listing finds all
    // of them, so nothing but the helper's own cap is in the way.
    const paged = await walk(env.actor, "pending", null, 100);
    assert.deepEqual(paged.handles, pending, "users_page can still see every one");

    const asked = await env.actor.pending_judges(150n);
    assert.equal(
      asked.length,
      pending.length,
      `pending_judges(150) should hand back all ${pending.length} pending judges`,
    );
  });

  it("pages the whole audit log exactly once, and caps a greedy request", async () => {
    const written = PEOPLE.filter((p) => p.judge === "approved").length
      + PEOPLE.filter((p) => p.sponsor === "approved").length
      + PEOPLE.filter((p) => p.moderator).length;
    assert.ok(written > 50, "the log has to be longer than two 25-row pages");

    const greedy = await env.actor.moderation_log([], 100_000_000n);
    assert.ok(greedy.rows.length <= 100, `moderation_log returned ${greedy.rows.length} rows`);
    assert.equal(Number(greedy.total), written, "`total` is the whole log");

    const ids = [];
    let after = [];
    for (let guard = 0; ; guard += 1) {
      assert.ok(guard < 200, "moderation_log never reached the end");
      const page = await env.actor.moderation_log(after, 25n);
      ids.push(...page.rows.map((row) => Number(row.id)));
      if (page.next.length === 0) break;
      after = page.next;
    }

    assert.equal(new Set(ids).size, ids.length, "a log row came back twice");
    assert.equal(ids.length, written, "every moderation action should be reachable by paging");
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a), "the log reads newest first");
  });

  // Last in this suite: it rewrites the cast, so anything after it would be
  // asserting against a fixture that has moved.
  it("keeps every index straight when roles are taken away again", async () => {
    // The role listings are sparse indexes computed from the row, so a user
    // who stops being a hacker has to leave `byHackerHandle` and rejoin
    // `byObserverHandle` on the same write, and a revoked judge has to move
    // out of a two-stage index rather than change stage. At three hundred
    // rows a missed removal shows as a listing that disagrees with its count.
    const unhack = PEOPLE.filter((p) => p.hacker && p.n % 3 === 0);
    const unjudge = PEOPLE.filter((p) => p.judge === "approved" && p.n % 15 === 0);
    const unsponsor = PEOPLE.filter((p) => p.sponsor === "pending" && p.n % 2 === 0);
    const undo = PEOPLE.filter((p) => p.moderator && p.n % 2 === 1);
    for (const [name, set] of Object.entries({ unhack, unjudge, unsponsor })) {
      assert.ok(set.length > 5, `${name} should churn enough rows to matter`);
    }
    assert.ok(undo.length >= 3, "the bounded moderator bench should still churn several rows");

    for (const p of unhack) {
      ok(await env.as(identity(FIRST_ID + p.n)).set_hacker(false), `unhack ${p.handle}`);
      p.hacker = false;
    }
    for (const p of unjudge) {
      ok(await env.actor.set_judge(p.handle, v("no"), []), `revoke judge ${p.handle}`);
      p.judge = "no";
    }
    for (const p of unsponsor) {
      ok(await env.actor.set_sponsor(p.handle, v("no"), []), `reject sponsor ${p.handle}`);
      p.sponsor = "no";
    }
    for (const p of undo) {
      ok(await env.actor.set_moderator(p.handle, false, []), `demote ${p.handle}`);
      p.moderator = false;
    }

    const stats = await env.actor.stats();
    for (const filter of FILTERS) {
      const key = filter === "all" ? "users" : filter;
      const want = expected(filter);
      assert.equal(Number(stats[key]), want.length, `stats().${key} after churn`);

      const { handles, totals } = await walk(env.actor, filter, null, 11);
      assert.deepEqual(handles, want, `${filter} listing after churn`);
      assert.deepEqual(totals, [want.length], `${filter} total after churn`);

      const counts = await env.actor.letter_counts(v(filter));
      assert.equal(
        counts.reduce((n, c) => n + Number(c.count), 0),
        want.length,
        `letter_counts(${filter}) after churn`,
      );
    }

    // Nobody was dropped from the table itself, only from the role listings.
    assert.equal(Number(stats.users), PEOPLE.length);
  });

  it("carries the whole table and every index through an upgrade", async () => {
    // All of it lives on the heap under enhanced orthogonal persistence — the
    // user table, its role indexes and the audit log. An upgrade is where a
    // table that has grown past toy size gets tested.
    const before = await env.actor.stats();
    const log = await env.actor.moderation_log([], 100n);

    await env.upgrade();

    assert.deepEqual(await env.actor.stats(), before, "nothing should be lost across an upgrade");
    assert.equal(
      Number((await env.actor.moderation_log([], 100n)).total),
      Number(log.total),
      "and the audit log is the same length",
    );
    for (const filter of FILTERS) {
      const { handles } = await walk(env.actor, filter, null, 13);
      assert.deepEqual(handles, expected(filter), `${filter} listing after an upgrade`);
    }
  });
});

// ── A big week ──────────────────────────────────────────────────────────────

const HACKERS = 120;
const JUDGES = 35;
/** Votes per entry for the six that get any: 70 votes, 35 judges, two each. */
const VOTE_PLAN = [20, 15, 12, 10, 8, 5];

describe("a qualifier week at full size", () => {
  let env;
  let season;
  /** The moderator who approves all hundred and twenty entries. */
  let mod;
  const entryIds = [];
  /** Which entry each of the 70 vote slots goes to; judge j takes j and j+35. */
  const slots = VOTE_PLAN.flatMap((n, entry) => Array(n).fill(entry));

  before(async () => {
    env = await bootstrap();

    const judges = [];
    for (let base = 0; base < JUDGES; base += 40) {
      const slice = Array.from({ length: Math.min(40, JUDGES - base) }, (_, k) => base + k);
      judges.push(
        ...(await Promise.all(
          slice.map(async (i) => {
            const actor = await register(env.as, identity(2400 + i), `judges_${i}`);
            ok(await actor.apply_as_judge(), "apply");
            return actor;
          }),
        )),
      );
    }
    // The judges is approved before the season starts; after that it is frozen.
    // Putting somebody on it takes two moderators, but the canister is not
    // sealed yet and `env.actor` is a controller with no profile row of its
    // own, so `Moderation.quorum` applies its vote alone — thirty-five calls
    // rather than seventy. Nothing below the seal may rely on that.
    for (let i = 0; i < JUDGES; i += 1) {
      ok(await env.actor.set_judge(`judges_${i}`, v("approved"), []), "approve");
    }

    // The moderator who will approve the entries, seated *above the seal*.
    //
    // `set_moderator` is controller-only and `seal_canister` empties the
    // controller list permanently, so this is the last moment it can ever be
    // done: after the seal the identity making the call is not a controller
    // and cannot appoint anybody, now or ever after, and the hundred
    // and twenty `approve_revision` calls further down would have nobody to
    // come from. Same shape as the judges above, which `start_season` freezes
    // for the same reason: who decides is settled before any entry is seen,
    // and that includes who reviews.
    mod = await register(env.as, identity(2900), "bigmod");
    ok(await env.actor.set_moderator("bigmod", true, []), "appoint the moderator");

    const hackers = await inBatches(
      Array.from({ length: HACKERS }, (_, i) => i),
      40,
      async (i) => {
        const handle = `hack_${i}`;
        const actor = await register(env.as, identity(2200 + i), handle);
        // Somewhere to be paid, before there is anything to pay for:
        // `Review.proposeEntry` refuses with `#NoWallet` before it so much as
        // looks at the entry. `walletFor` hands back a stable principal that
        // is not the one they signed in with, which is the other half of what
        // `set_wallet` insists on.
        ok(await actor.set_wallet(walletFor(2200 + i)), "set_wallet");
        // Taking the role asks for nothing beyond being registered. The one
        // acceptance the harness gives `register` covers the hacker rules
        // along with every other role's, so there is no second checkbox here
        // and no state in which somebody holds a role having agreed to less.
        const user = ok(await actor.set_hacker(true), "set_hacker");
        return { actor, id: user.id, handle };
      },
    );

    // Every entry names a build, and the build has to be there before the
    // entry may name it. These are the one kind of upload the seal does not
    // constrain: `my_upload` writes into the caller's own namespace and asks
    // for a registration, not a controller. It is `assets_upload` — the
    // frontend, the site's own files — that has to be finished above the seal
    // or never, and this file never calls it.
    await inBatches(hackers, 40, ({ actor, id }) => uploadPackage(actor, id));

    // Drafted by the moderator, because `create_season` and `start_season` must
    // remain usable without any external controller caller.
    const draft = ok(await mod.create_season(), "create");

    // Starting is refused while anybody still holds the keys, and this is the
    // check that says so. `start_season` reads the live controller list on
    // every call rather than trusting a flag — a season that began while the
    // organisers could still upgrade the canister would be a season whose
    // rules could be rewritten halfway through, and from outside it would look
    // exactly like one that could not.
    const unsealed = await mod.start_season(draft.id);
    assert.ok("err" in unsealed, `an unsealed canister started a season: ${JSON.stringify(unsealed)}`);
    assert.match(
      unsealed.err.Invalid,
      /seal_canister/,
      "refused for still having controllers, and it says what to do about it",
    );

    // The normal seal boundary: the moderator is seated, the judges are
    // approved, and the packages are uploaded. The installer is removed and
    // only the canister principal remains.
    ok(await env.seal(), "seal");
    assert.deepEqual(
      (await env.pic.getControllers(env.canisterId)).map((principal) => principal.toText()),
      [env.canisterId.toText()],
      "sealing leaves the exact self-only list that anybody can check",
    );

    season = ok(await mod.start_season(draft.id), "start");

    // Proposing is now all a hacker does; the row appears when a moderator
    // approves it. Which is why the approvals below run serially in array
    // order and the proposals need not: entry ids ascend with the order they
    // are *applied* in, and the bracket section of the Rules page breaks ties by that order — this is
    // what makes it knowable.
    const revisions = await inBatches(hackers, 40, async ({ actor, id, handle }, k) =>
      ok(
        await actor.submit_entry({
          title: `App ${k}`,
          summary: "",
          url: "",
          icon: [],
          shots: [],
          links: [],
          pkg: { key: pkgKey(id) },
          slug: slugOf(handle),
        }),
        `submit ${k}`,
      ),
    );

    for (const [i, revision] of revisions.entries()) {
      ok(await mod.approve_revision(revision.id), `approve ${i}`);
    }

    entryIds.push(
      ...(await inBatches(hackers, 40, async ({ actor }) => (await actor.my_entry())[0].id)),
    );
    assert.equal(entryIds.length, HACKERS, "every proposal reached the bracket");
    assert.deepEqual(
      [...entryIds].sort((a, b) => Number(a - b)),
      entryIds,
      "approval order is submission order, so entry ids ascend with the array",
    );

    // Judge j takes slot j and slot j+35. The halves of the flattened plan
    // never share an entry, so no judge stacks both votes on one project.
    assert.equal(slots.length, JUDGES * 2);
    for (const [j, judge] of judges.entries()) {
      ok(await judge.cast_vote(entryIds[slots[j]]), `vote a ${j}`);
      ok(await judge.cast_vote(entryIds[slots[j + JUDGES]]), `vote b ${j}`);
    }
  });

  after(async () => {
    await env?.teardown();
  });

  it("leaves only the canister itself and removes the installer", async () => {
    // The claim the site makes is that the rules did not change once the
    // entries were in, and this is the form of it a participant can check
    // rather than trust: certified IC state says the canister controls itself
    // alone. No external caller can impersonate that principal.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((principal) => principal.toText()),
      [env.canisterId.toText()],
      "the sealed list contains exactly the canister itself",
    );

    // Which is exactly why this fixture seats a moderator above the seal. The
    // identity that installed the canister lost both halves of what it had:
    // the controller-only methods, and `Profiles.canModerate`'s
    // implicit-moderator clause. A controller who could still moderate would
    // be a hole straight through the claim above.
    assert.equal(await env.actor.is_controller(), false, "the keys are gone");
    assert.equal(await env.actor.am_moderator(), false, "and the moderator powers with them");
    assert.equal(await mod.am_moderator(), true, "only an appointed moderator moderates now");
    assert.deepEqual(
      await env.actor.set_moderator("hack_0", true, []),
      { err: { NotAllowed: null } },
      "and it cannot appoint itself a way back in",
    );
    assert.deepEqual(
      await env.actor.create_season(),
      { err: { NotAllowed: null } },
      "nor draft the next one — that is a moderator's call now, and it is not one",
    );

    // The rest of what a controller used to be, checked on one method that
    // stands for all of them: `set_config`, `set_instruction_cap` and
    // `assets_upload` are gated on `Principal.isController` and there is no
    // controller, so the site's own settings are frozen alongside its code.
    const renamed = await env.actor.set_config("Renamed mid-season", true);
    assert.ok("err" in renamed, `a sealed canister let its settings be rewritten: ${JSON.stringify(renamed)}`);
    assert.match(renamed.err, /not a controller/, "and it is the seal doing the refusing");
  });

  it("cannot be upgraded by the former installer while sealed", async () => {
    // The sharpest consequence of the seal, and the one a test can check
    // directly: `install_code` is a controller call, so the module running now
    // is the module that runs for the rest of this canister's life. The
    // replica refuses this, not the canister — `env.upgrade()` sends the
    // upgrade as the identity that installed it, which is precisely the
    // identity sealing removed.
    let refused = null;
    try {
      await env.upgrade();
    } catch (error) {
      refused = error;
    }
    assert.ok(refused, "a sealed canister accepted a new module from its former installer");
    assert.match(
      String(refused.message),
      /Only controllers .* install_code/,
      "refused for having no controller, not for some unrelated upgrade failure",
    );

    // And it is still there, still running the module it was sealed with,
    // with the season it started intact — a rejected upgrade changes nothing.
    const [live] = await env.actor.season();
    assert.equal(Number(live.id), Number(season.id), "the bracket is untouched");
    assert.deepEqual(
      (await env.pic.getControllers(env.canisterId)).map((principal) => principal.toText()),
      [env.canisterId.toText()],
      "and still sealed",
    );
  });

  it("returns the whole field when the app asks for 200", async () => {
    const view = await env.actor.season_week_view(season.id, season.week, 200n);
    assert.equal(view.length, HACKERS, "a 120-entry week must not be cut down");
    assert.equal(
      new Set(view.map((row) => Number(row.entry.id))).size,
      HACKERS,
      "and must not repeat an entry",
    );

    const counted = view.reduce((n, row) => n + Number(row.entry.votes), 0);
    assert.equal(counted, JUDGES * 2, "every vote cast should be on the board");
  });

  it("joins each of a hundred and twenty rows to the caller correctly", async () => {
    // The view resolves an author, an "is this mine" and a "did I vote for
    // this" per row. That is three lookups a row, and the only place the size
    // of the week meets the identity of the reader.
    const judge = env.as(identity(2400 + 3));
    const seen = await judge.season_week_view(season.id, season.week, 200n);
    const ascending = (a, b) => a - b;
    assert.deepEqual(
      seen.filter((row) => row.voted).map((row) => Number(row.entry.id)).sort(ascending),
      [entryIds[slots[3]], entryIds[slots[3 + JUDGES]]].map(Number).sort(ascending),
      "a judge sees exactly their own two votes",
    );
    assert.ok(seen.every((row) => !row.mine), "a judge who entered nothing owns nothing");

    const hacker = env.as(identity(2200 + 7));
    const theirs = await hacker.season_week_view(season.id, season.week, 200n);
    assert.deepEqual(
      theirs.filter((row) => row.mine).map((row) => row.entry.id),
      [entryIds[7]],
      "a hacker owns exactly one entry in the week",
    );
    assert.deepEqual(
      theirs.map((row) => row.handle).filter((h) => h === "hack_7"),
      ["hack_7"],
      "and the author join finds them among a hundred and twenty rows",
    );
  });

  it("caps season_week and season_map rather than believing the caller", async () => {
    const greedy = await env.actor.season_week(season.id, season.week, 100_000_000n);
    assert.ok(greedy.length <= 500, `season_week returned ${greedy.length}`);
    assert.equal(greedy.length, HACKERS, "500 is a ceiling, not a quota");

    const map = await env.actor.season_map(season.id, 100_000_000n);
    assert.equal(map.length, 6, "the map always draws six weeks");
    for (const week of map) {
      assert.ok(week.entries.length <= 50, `week ${week.week} returned ${week.entries.length}`);
    }
    assert.equal(Number(map[0].total), HACKERS, "the week reports its true size beside the page");
    assert.equal(map[0].entries.length, 50, "and shows as much of it as the ceiling allows");
  });

  it("shows the same top of the table that the week will close on", async () => {
    // the bracket section of the Rules page: entries rank by votes descending, ties to the lowest entry
    // id, and "the tie-break lives in one place ... there is no way to see one
    // order on screen and get another when the week closes".
    //
    // Six entries carry votes; the other 114 are tied on zero, so places 7-12
    // belong to the six earliest of those by id.
    const wantTop = [...entryIds]
      .map((id, i) => ({ id, votes: i < VOTE_PLAN.length ? VOTE_PLAN[i] : 0 }))
      .sort((a, b) => (b.votes - a.votes) || Number(a.id - b.id))
      .slice(0, 12)
      .map((e) => Number(e.id));

    const ranked = await env.actor.season_week(season.id, season.week, 12n);
    assert.deepEqual(ranked.map((e) => Number(e.id)), wantTop, "season_week's top 12");

    const map = await env.actor.season_map(season.id, 12n);
    assert.deepEqual(
      map[0].entries.map((row) => Number(row.entry.id)),
      wantTop,
      "the bracket draws the same twelve",
    );
  });

  it("closes on the timer, rewards exactly five and advances exactly one", async () => {
    await env.advance(WEEK + DAY);

    const live = await env.live();
    assert.equal(Number(live.week), 2, "nobody pressed anything");

    const closed = await env.actor.season_week(season.id, 1n, 500n);
    assert.equal(closed.length, HACKERS);

    const outcome = (entry) => Object.keys(entry.outcome)[0];
    const marked = closed.filter((entry) => outcome(entry) !== "none");
    assert.equal(marked.length, 5, "top five of a hundred and twenty");

    const advanced = marked.filter((entry) => outcome(entry) === "advanced");
    assert.equal(advanced.length, 1, "one advances");
    assert.equal(advanced[0].id, entryIds[0], "the most-voted entry");
    assert.equal(Number(advanced[0].votes), VOTE_PLAN[0]);

    assert.deepEqual(
      marked.map((entry) => Number(entry.id)),
      entryIds.slice(0, 5).map(Number),
      "the five rewarded are the five most-voted",
    );

    // Sixth on votes, and five is a ceiling — so it gets nothing.
    const sixth = closed.find((entry) => entry.id === entryIds[5]);
    assert.equal(Number(sixth.votes), VOTE_PLAN[5]);
    assert.equal(outcome(sixth), "none", "a rewarded sixth place would break the ceiling");
  });

  it("carries exactly the winner into the semi-final", async () => {
    const semi = await env.actor.season_week_view(season.id, 5n, 200n);
    assert.equal(semi.length, 1, "one qualifier, one survivor");
    assert.deepEqual(semi[0].entry.origin_id, [entryIds[0]], "and it links back to where it came from");
    assert.equal(Number(semi[0].entry.votes), 0, "the clone starts a fresh round");
  });

  // Last in this suite: it runs the clock to the end of the season, so anything
  // after it would be reading a bracket that has already finished.
  it("runs itself to the end, and is no less sealed afterwards", async () => {
    // Weeks 2 through 6 on their own deadlines — the three remaining qualifiers
    // are empty, the semi and the final hold the one survivor. Nobody presses
    // anything, and this is the size at which that stops being a convenience:
    // there is no controller left who *could* press, so a bracket that needed
    // a nudge would be a bracket that never finished.
    for (let week = 2; week <= 6; week += 1) await env.advance(WEEK + DAY);

    const [done] = await env.actor.season();
    assert.equal(phaseOf(done), "finished", "the season ran itself to the end");

    // Normal completion does not invoke emergency controller recovery. The
    // check a participant made in week one has the same answer after the final.
    assert.deepEqual(
      (await env.pic.getControllers(env.canisterId)).map((principal) => principal.toText()),
      [env.canisterId.toText()],
      "a normally finished season remains self-only and sealed",
    );
    assert.equal(await env.actor.is_controller(), false, "the keys never come back");
    assert.equal(await env.actor.am_moderator(), false, "nor the moderator powers with them");
    assert.equal(
      await mod.am_moderator(),
      true,
      "the appointed moderator outlasts the season — the only authority left is the granted kind",
    );
  });
});

// ── A week larger than the ranking window ───────────────────────────────────

const MAX_QUALIFIER_ENTRIES = 1_000;
const OVERSIZE = MAX_QUALIFIER_ENTRIES + 5;

describe("a qualifier at and beyond its hard entry ceiling", () => {
  let env;
  let season;
  const entryIds = [];

  before(async () => {
    env = await bootstrap();

    const hackers = await inBatches(
      Array.from({ length: OVERSIZE }, (_, i) => i),
      50,
      async (i) => {
        const handle = `mass_${i}`;
        const actor = await register(env.as, identity(2200 + i), handle);
        // Everyone has to exist before launch closes registration. The hacker
        // role is taken in bounded batches below: production admits at most
        // 1,000 app-building accounts at once, while the season's independent
        // 1,000-entry ceiling must still refuse the five rows beyond it.
        const user = ok(await actor.set_wallet(walletFor(2200 + i)), "set_wallet");
        return { actor, id: user.id, handle };
      },
    );

    // One thousand and five approvals need somebody to make them, and once the
    // canister is sealed there is no controller left to fall back on — not
    // this season, not any season. `set_moderator` is controller-only, so a
    // moderator can only ever be seated above the seal.
    const mod = await register(env.as, identity(3300), "massmod");
    ok(await env.actor.set_moderator("massmod", true, []), "appoint the moderator");

    // Drafting is part of launch readiness now: the irreversible seal refuses
    // a deployment that has no exact season configuration to start.
    const draft = ok(await mod.create_season(), "create");

    // Everything the season needs is now in place, so external controllers can
    // be removed.
    ok(await env.seal(), "seal");
    assert.deepEqual(
      (await env.pic.getControllers(env.canisterId)).map((principal) => principal.toText()),
      [env.canisterId.toText()],
      "self-only, which is what `start_season` insists on before it will run",
    );

    // Started by the moderator, the only authority the sealed canister still
    // recognises, from the draft that was frozen by sealing.
    season = ok(await mod.start_season(draft.id), "start");

    const revisions = await inBatches(hackers, 50, async ({ actor, id, handle }, i) => {
      ok(await actor.set_hacker(true), `take hacker seat ${i}`);
      await uploadPackage(actor, id);
      const revision = ok(
        await actor.submit_entry({
          title: `Mass ${i}`,
          summary: "",
          url: "",
          icon: [],
          shots: [],
          links: [],
          pkg: { key: pkgKey(id) },
          slug: slugOf(handle),
        }),
        `submit ${i}`,
      );
      ok(await actor.set_hacker(false), `release hacker seat ${i}`);
      return revision;
    });

    // The seal from the fixture's side, pinned once before the loop leans on
    // it: `env.actor` emptied the controller list and is therefore no longer a
    // controller, so `approve_revision` — gated on `Profiles.canModerate` —
    // refuses it outright. Every one of the thousand and five below has to
    // come from the moderator appointed above, and always will.
    assert.deepEqual(
      await env.actor.approve_revision(revisions[0].id),
      { err: { NotAllowed: null } },
      "a sealed canister's controller must not be able to moderate",
    );
    assert.equal(await env.actor.am_moderator(), false, "it is neither controller nor moderator");

    // Approved one at a time and in array order. The first thousand become
    // entries; the five beyond the hard qualifier ceiling are refused without
    // creating a row.
    let capRefusals = 0;
    for (const [i, revision] of revisions.entries()) {
      const result = await mod.approve_revision(revision.id);
      if (i < MAX_QUALIFIER_ENTRIES) {
        ok(result, `approve ${i}`);
      } else {
        assert.deepEqual(result, {
          err: { Season: { Invalid: "this qualifier week has reached its 1,000-entry limit" } },
        });
        capRefusals += 1;
      }
    }
    assert.equal(capRefusals, 5, "all five entries beyond the ceiling were refused");

    entryIds.push(
      ...(await inBatches(
        hackers.slice(0, MAX_QUALIFIER_ENTRIES),
        50,
        async ({ actor }) => (await actor.my_entry())[0].id,
      )),
    );
    assert.equal(entryIds.length, MAX_QUALIFIER_ENTRIES, "the bracket stops at its hard ceiling");
    assert.deepEqual(
      await inBatches(hackers.slice(MAX_QUALIFIER_ENTRIES), 5, async ({ actor }) => actor.my_entry()),
      [[], [], [], [], []],
      "none of the five refused approvals created an entry",
    );
    assert.deepEqual(
      [...entryIds].sort((a, b) => Number(a - b)),
      entryIds,
      "approval order is submission order, so entry ids ascend with the array",
    );
    // No judge votes at all. the Judging section of the Rules page sets no quorum, so this is a week the
    // format explicitly allows, and it leaves every entry tied.
  });

  after(async () => {
    await env?.teardown();
  });

  it("hands back exactly the 200 entries the app asks for", async () => {
    const view = await env.actor.season_week_view(season.id, season.week, 200n);
    assert.equal(view.length, 200, "the UI's own page size must not be trimmed");
    assert.equal(new Set(view.map((row) => Number(row.entry.id))).size, 200, "with no repeats");
  });

  it("caps the legacy read at 1,000 and the paged read at 200", async () => {
    const greedy = await env.actor.season_week(season.id, season.week, 100_000_000n);
    assert.ok(greedy.length <= MAX_QUALIFIER_ENTRIES, `season_week returned ${greedy.length}`);
    assert.equal(greedy.length, MAX_QUALIFIER_ENTRIES, "legacy reads expose the full bounded field");

    const page = await env.actor.season_week_page(season.id, season.week, [], 100_000_000n);
    assert.equal(page.rows.length, 200, "the public page API enforces its response ceiling");
    assert.deepEqual(page.next, [200n]);
    assert.equal(Number(page.total), MAX_QUALIFIER_ENTRIES);

    const map = await env.actor.season_map(season.id, 100_000_000n);
    assert.equal(
      Number(map[0].total),
      MAX_QUALIFIER_ENTRIES,
      "the true bounded size is reported whatever the page holds",
    );
    assert.equal(map[0].entries.length, 50);
  });

  it("rewards the five entries the tie-break names at the maximum field size", async () => {
    // 1,000 entries, none with a vote, so the bracket section of the Rules page leaves one rule standing:
    // "on equal votes, the earlier submission places higher". The five lowest
    // entry ids should take the bronze places and the lowest of all should
    // advance. The same hard cap bounds writes and ranking, so every accepted
    // entry participates in that tie-break.
    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 2, "the timer closed it");

    const closed = await env.actor.season_week(season.id, 1n, 500n);
    const outcome = (entry) => Object.keys(entry.outcome)[0];
    const marked = closed
      .filter((entry) => outcome(entry) !== "none")
      .map((entry) => Number(entry.id))
      .sort((a, b) => a - b);
    assert.equal(marked.length, 5, "five bronze places whatever else is wrong");

    const earliest = [...entryIds].map(Number).sort((a, b) => a - b).slice(0, 5);
    assert.deepEqual(marked, earliest, "the five earliest submissions take the five places");

    const advanced = closed.filter((entry) => outcome(entry) === "advanced");
    assert.equal(advanced.length, 1);
    assert.equal(Number(advanced[0].id), earliest[0], "and the earliest of all advances");
  });
});
