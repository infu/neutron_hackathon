/**
 * What a season costs, measured rather than estimated.
 *
 * Every other file in this suite asks whether the canister is *right*. This one
 * asks what it *weighs*: two hundred apps, each carrying an icon, six
 * screenshots and a `.neutron` build at the published caps, played through all
 * six weeks on the timer. Nothing here is a unit test — it is one long run with
 * `memory()` sampled at the moments a human would want a number, printed as a
 * table, and then a handful of assertions about the *relationships* between
 * those numbers. Byte counts move whenever a row gains a field; the shape of
 * the curve does not, and the shape is the claim `Slab` makes.
 *
 * ## The scale, and why
 *
 * | | | |
 * | --- | --- | --- |
 * | 200 apps | 50 in each of the four qualifier weeks | one entry per hacker per week (the Build section of the Rules page) |
 * | 200 hackers | one app each | so every file sits in its own `/u/<id>/` namespace |
 * | 20 judges | two votes a week, six weeks | the Judging section of the Rules page |
 * | 5 observers, 2 sponsors | | population that costs heap and no files |
 *
 * The files are at the caps in `Assets.mo`, not near them — an icon of
 * 100,000 B, six screenshots of 400,000 B and a build of 1,900,000 B, which is
 * 4.4 MB per app and 880 MB across the season. That is the whole point: a
 * memory test on ten-byte files measures the row layer and calls it storage.
 * 880 MB is also about the most that stays tractable — the uploads alone are
 * 1,600 ingress messages and take roughly a minute of wall clock, and the
 * numbers below are already unambiguous at this size.
 *
 * ## Why the bytes are read back
 *
 * Every number in the table is the canister describing itself: `stableLive` is
 * a counter a pool increments on write, `files` is a row count. A store that
 * reserved its regions, added up the sizes it was handed and never wrote a
 * single byte would produce this table exactly, and pass every assertion about
 * it. So one test in the middle asks for the files back over HTTP and checks
 * the length, the signature and a fill byte unique to each file, and another
 * re-adds the sizes off the asset rows — a different accumulator from the one
 * `stableLive` reports. That is what makes the rest of these numbers
 * measurements of storage rather than of bookkeeping.
 *
 * ## What the samples are for
 *
 * `heap` is *not* a quiet number. It is the used heap including garbage the
 * collector has not reached yet, so a single reading after a burst of 1.9 MB
 * messages can be anything from 25 MB to 190 MB depending on where in the GC
 * cycle it lands. Nothing here asserts on one `heap` reading. The load-bearing
 * number is `heapClaimed` — wasm main memory, which only ever grows — and the
 * claim being tested is that it *plateaus* while `stableReserved` climbs past
 * it. That is the difference between file bytes living in a `Region` and
 * living on the heap, and it is visible in the table below as a column that
 * stops moving next to one that does not.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";

import {
  bootstrap,
  hacker,
  identity,
  ok,
  phaseOf,
  register,
  DAY,
  SECOND,
  WEEK,
} from "../harness.mjs";

// ── The size of the thing ───────────────────────────────────────────────────

const HACKERS = 200;
const QUALIFIERS = 4;
const PER_WEEK = HACKERS / QUALIFIERS; // 50 apps a week
const JUDGES = 20;
const OBSERVERS = 5;
const SPONSORS = 2;

/** The published caps, from `Assets.mo` — `iconLimits`, `mediaLimits`, `packageLimits`. */
const ICON_BYTES = 100_000;
const SHOT_BYTES = 400_000;
const PKG_BYTES = 1_900_000;
const SHOTS = 6; // the ceiling in the Build section of the Rules page

/** `Slab.pagesFor`, in bytes. A file is put in the smallest class that holds it. */
const PAGE = 65_536;
const SLOT = { small: 2 * PAGE, image: 7 * PAGE, build: 32 * PAGE };
const slotFor = (size) =>
  size <= SLOT.small ? SLOT.small : size <= SLOT.image ? SLOT.image : SLOT.build;

const FILES_PER_APP = 1 + SHOTS + 1;
const BYTES_PER_APP = ICON_BYTES + SHOTS * SHOT_BYTES + PKG_BYTES;
const SLOTS_PER_APP = slotFor(ICON_BYTES) + SHOTS * slotFor(SHOT_BYTES) + slotFor(PKG_BYTES);

const UPLOADED = HACKERS * BYTES_PER_APP; // 880,000,000
const SLOTTED = HACKERS * SLOTS_PER_APP; // 996,147,200
const FILES = HACKERS * FILES_PER_APP; // 1,600

// ── Identities: 40000–40999, and nothing that calls from outside it ─────────

const CONTROLLER = 40_000;
const HACKER_0 = 40_001; // …40200
const JUDGE_0 = 40_301; // …40320
const OBSERVER_0 = 40_401; // …40405
const SPONSOR_0 = 40_501; // …40502
const MODERATOR = 40_601;

// Each hacker also owns a reward wallet, which `walletFor` derives from their
// seed at +900,000. Those principals never make a call — a wallet is a field on
// a row and deliberately not the principal its owner signed in with — so they
// cost nothing here beyond the pointer, and the band above stays the whole cast.

// ── Small helpers ───────────────────────────────────────────────────────────

const MB = (n) => (Number(n) / 1e6).toFixed(1);
const pct = (part, whole) => (100 * (Number(part) / Number(whole))).toFixed(2);
const pad = (text, width) => String(text).padStart(width);

/** Candid `opt` is a 0-or-1 array. */
const first = (opt) => (opt.length === 0 ? null : opt[0]);
const outcomeOf = (entry) => Object.keys(entry.outcome)[0];

/**
 * The app id for hacker `n`.
 *
 * `Season.validSlug` takes `a-z` and `_` and nothing else, so the index cannot
 * be spelled the way the handles spell it — each digit becomes the letter at
 * its own position instead. The map is injective, so two hundred hackers get
 * two hundred distinct ids, which is what `slugTaken` insists on: an id is
 * unique across the event and fixed for the life of the app, because it is the
 * name of the `.neutron` a judge downloads.
 */
const DIGIT = "abcdefghij";
const slugFor = (n) => `app_${String(n).padStart(3, "0").replace(/\d/g, (d) => DIGIT[Number(d)])}`;

/**
 * A file of `size` bytes that at least starts like the thing it claims to be.
 * The content type is derived from the extension and nothing reads the body,
 * but a store full of files whose first eight bytes are a PNG signature is a
 * more honest fixture than one full of zeroes.
 */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function fileOf(size, seed) {
  const bytes = new Uint8Array(size);
  bytes.fill(seed & 0xff);
  bytes.set(PNG, 0);
  return bytes;
}

/** Run `jobs` (thunks) `width` at a time, so the replica has work every round. */
async function inFlight(jobs, width) {
  for (let base = 0; base < jobs.length; base += width) {
    await Promise.all(jobs.slice(base, base + width).map((job) => job()));
  }
}

// ── The season ──────────────────────────────────────────────────────────────

describe("a season at scale, and what it costs", { concurrency: 1 }, () => {
  let env;
  let season;
  /// A moderator with the flag, not the installing controller.
  ///
  /// Everything the bracket needs reviewed happens *during* the season, and a
  /// season cannot start until the canister is sealed — at which point only
  /// the canister itself is controller and `canModerate` is true for this row.
  /// The installer can still do the setup below before the seal; it cannot
  /// approve anything afterwards.
  let mod;

  const hackers = [];
  const judges = [];
  const others = [];

  /** Every `memory()` reading taken, in the order taken. */
  const samples = [];
  /** Qualifier week number → the entry id that was marked `advanced`. */
  const winners = new Map();

  /**
   * The management canister's own view of the canister's size.
   *
   * Read as an independent check on `heapClaimed`: `memory()` is the canister
   * describing itself with `Prim.rts_memory_size`, and a number a thing reports
   * about itself is worth holding against one reported about it. Decoded
   * against a one-field record — candid record subtyping means the reply's
   * other fields are skipped, so this does not have to track the replica's
   * exact status shape.
   */
  async function canisterMemorySize() {
    try {
      const arg = IDL.encode(
        [IDL.Record({ canister_id: IDL.Principal })],
        [{ canister_id: env.canisterId }],
      );
      const reply = await env.pic.updateCall({
        canisterId: Principal.fromText("aaaaa-aa"),
        method: "canister_status",
        arg,
        sender: env.controller.getPrincipal(),
      });
      const [status] = IDL.decode([IDL.Record({ memory_size: IDL.Nat })], reply);
      return Number(status.memory_size);
    } catch {
      return null; // reported as "—"; never the reason a run fails
    }
  }

  async function sample(label) {
    const m = await env.actor.memory();
    const row = {
      label,
      files: Number(m.files),
      heap: Number(m.heap),
      heapClaimed: Number(m.heapClaimed),
      stableReserved: Number(m.stableReserved),
      stableLive: Number(m.stableLive),
      memorySize: await canisterMemorySize(),
    };
    samples.push(row);
    return row;
  }

  const at = (label) => {
    const found = samples.find((row) => row.label === label);
    assert.ok(found, `no sample called "${label}" was taken`);
    return found;
  };

  const entryInput = (h) => ({
    title: `App ${h.n}`,
    summary: `Week ${h.week} entry from ${h.handle}. `.repeat(4),
    url: `https://example.com/${h.handle}`,
    icon: [`/u/${h.id}/icon/mark.png`],
    shots: Array.from({ length: SHOTS }, (_, k) => `/u/${h.id}/shots/${k}.png`),
    links: [
      { kind: "demo", url: `https://example.com/${h.handle}/demo` },
      { kind: "docs", url: `https://example.com/${h.handle}/docs` },
    ],
    pkg: { key: `/u/${h.id}/pkg/1.neutron` },
    // Chosen at first submission and never movable afterwards — an edit has to
    // send the same one back. It is what the download is called, so it is
    // carried alongside the upload key rather than derived from it.
    slug: slugFor(h.n),
  });

  const weekRows = async (w) => env.actor.season_week(season.id, BigInt(w), 500n);

  before(async () => {
    env = await bootstrap({ controller: identity(CONTROLLER) });
  });

  after(async () => {
    await env?.teardown();
  });

  it("starts from nothing at all", async () => {
    const empty = await sample("installed, nobody registered");
    assert.equal(empty.files, 0, "a fresh canister holds no files");
    assert.equal(empty.stableReserved, 0, "and has not grown a region for any class");
    assert.ok(empty.heapClaimed > 0, "but has claimed some main memory for its own code");
  });

  it("registers a population that never touches stable memory", async () => {
    const enrol = [];
    for (let i = 0; i < HACKERS; i += 1) {
      enrol.push(async () => {
        const handle = `hacker_${String(i).padStart(3, "0")}`;
        // Register, set a reward wallet, take the hacker role. The wallet is
        // not paperwork that can wait: `Review.proposeEntry` refuses a
        // submission from an account with nowhere to be paid (`#NoWallet`), so
        // all two hundred are given one at signup rather than at prize time.
        const actor = await hacker(env, HACKER_0 + i, handle);
        const [me] = await actor.me();
        hackers.push({ actor, handle, id: me.id, n: i, week: Math.floor(i / PER_WEEK) + 1 });
      });
    }
    for (let i = 0; i < JUDGES; i += 1) {
      enrol.push(async () => {
        const handle = `judge_${String(i).padStart(2, "0")}`;
        const actor = await register(env.as, identity(JUDGE_0 + i), handle);
        ok(await actor.apply_as_judge(), `${handle} applies`);
        judges.push({ actor, handle });
      });
    }
    for (let i = 0; i < OBSERVERS; i += 1) {
      enrol.push(async () => {
        const handle = `watcher_${i}`;
        others.push({ actor: await register(env.as, identity(OBSERVER_0 + i), handle), handle });
      });
    }
    for (let i = 0; i < SPONSORS; i += 1) {
      enrol.push(async () => {
        const handle = `sponsor_${i}`;
        const actor = await register(env.as, identity(SPONSOR_0 + i), handle);
        ok(
          await actor.apply_as_sponsor({
            org: `Backer ${i}`,
            blurb: "Backing the season.",
            website: "https://example.com",
            logo: [],
            ledgers: [{ id: env.launchLedger, sns: false }],
          }),
          `${handle} applies to sponsor`,
        );
        others.push({ actor, handle });
      });
    }
    await inFlight(enrol, 20);

    // The judges are fixed before any entry exists (the Roles section of the Rules page), and one sponsor
    // is approved while that is still possible without a season in the way.
    // Approving either now wants two moderators — but a controller has no
    // profile row and therefore no vote to cast, and `Moderation.quorum` lets
    // it through alone on the grounds that it can install code anyway. So one
    // call each here, not two; a *registered* moderator would need a second.
    for (const judge of judges) {
      ok(await env.actor.set_judge(judge.handle, { approved: null }, []), `approve ${judge.handle}`);
    }
    ok(await env.actor.set_sponsor("sponsor_0", { approved: null }, []), "approve a sponsor");

    // Registration order is not deterministic across the batches above, so the
    // week each hacker submits in is read off `n`, not off arrival.
    hackers.sort((a, b) => a.n - b.n);

    const counts = await env.actor.stats();
    assert.equal(Number(counts.users), HACKERS + JUDGES + OBSERVERS + SPONSORS);
    assert.equal(Number(counts.hackers), HACKERS);

    const after = await sample(`${HACKERS + JUDGES + OBSERVERS + SPONSORS} users registered`);
    assert.equal(after.files, 0, "a profile is a row, not a file");
    assert.equal(after.stableReserved, 0, "so stable memory is still untouched");
  });

  it("takes 1,600 files at the published caps", async () => {
    const jobs = [];
    for (const h of hackers) {
      const put = (key, content) => () =>
        h.actor
          .my_upload({
            store: { key, content, contentType: "", contentEncoding: "identity", chunks: 1n },
          })
          .then((r) => ok(r, `upload ${key}`));

      jobs.push(put(`/u/${h.id}/pkg/1.neutron`, fileOf(PKG_BYTES, h.n)));
      jobs.push(put(`/u/${h.id}/icon/mark.png`, fileOf(ICON_BYTES, h.n + 1)));
      for (let k = 0; k < SHOTS; k += 1) {
        jobs.push(put(`/u/${h.id}/shots/${k}.png`, fileOf(SHOT_BYTES, h.n + k + 2)));
      }
    }
    assert.equal(jobs.length, FILES);

    // Sampled in quarters rather than only at the end: one reading cannot show
    // a plateau, and the plateau is the thing being claimed.
    const quarter = jobs.length / 4;
    for (let q = 1; q <= 4; q += 1) {
      await inFlight(jobs.slice((q - 1) * quarter, q * quarter), 16);
      await sample(`${q * 25}% of the files uploaded`);
    }

    const full = at("100% of the files uploaded");
    assert.equal(full.files, FILES, "every upload landed as its own asset row");
  });

  it("hands the bytes back, so the counters are not the only witness", async () => {
    // Everything else in this file takes the canister's word for it.
    // `stableLive` is a counter a pool increments on write and `files` is a row
    // count — a `Slab` that grew its regions, added up the sizes it was handed
    // and never called `Region.storeBlob` would satisfy every other assertion
    // here, and the table would look exactly the same. So the store is asked
    // for the bytes back before any of those numbers is believed.

    // `/u/` is intentionally not a public directory: exact URLs are served,
    // but abandoned drafts cannot be enumerated through `assets_list`. Keep
    // that privacy property intact and cross-check the known fixture against
    // the whole-store counters before reading representative bytes below.
    const full = at("100% of the files uploaded");
    assert.equal(await env.actor.assets_count(), BigInt(FILES), "every upload has an asset row");
    assert.equal(full.stableLive, UPLOADED, "the store accounts for every byte sent");

    // Then the bytes themselves, over HTTP, for one file of each class at both
    // ends of the population. Each fixture is filled with a byte of its own, so
    // a slot handed out twice — or a read that lands one slot over — comes back
    // as somebody else's fill rather than as a length that still adds up. The
    // first eight bytes are a PNG signature and the fill runs to the last byte,
    // which is what makes a truncated or partially-written slot visible.
    const get = (url) =>
      env.actor.http_request({
        url,
        method: "GET",
        body: new Uint8Array(),
        headers: [],
        certificate_version: [],
      });

    const probes = [];
    for (const h of [hackers[0], hackers[hackers.length - 1]]) {
      probes.push([`/u/${h.id}/icon/mark.png`, ICON_BYTES, (h.n + 1) & 0xff]);
      probes.push([`/u/${h.id}/shots/0.png`, SHOT_BYTES, (h.n + 2) & 0xff]);
      probes.push([`/u/${h.id}/shots/${SHOTS - 1}.png`, SHOT_BYTES, (h.n + SHOTS + 1) & 0xff]);
      probes.push([`/u/${h.id}/pkg/1.neutron`, PKG_BYTES, h.n & 0xff]);
    }
    for (const [key, size, fill] of probes) {
      const res = await get(key);
      assert.equal(res.status_code, 200, `GET ${key}`);
      assert.equal(res.streaming_strategy.length, 0, `${key} arrives whole: it was one chunk`);
      const body = Uint8Array.from(res.body);
      assert.equal(body.length, size, `${key} comes back the length it went in`);
      assert.deepEqual([...body.subarray(0, PNG.length)], PNG, `${key} kept its signature`);
      assert.equal(body[PNG.length], fill, `${key} is its own file and not another slot's`);
      assert.equal(body[size >> 1], fill, `${key} is intact in the middle`);
      assert.equal(body[size - 1], fill, `${key} is whole to its last byte`);
    }

    // A negative control: nothing was ever uploaded at version 2, and the
    // store says so rather than serving whatever is nearest.
    const missing = await get(`/u/${hackers[0].id}/pkg/2.neutron`);
    assert.equal(missing.status_code, 404, "a key nobody uploaded is a 404");
  });

  it("plays four qualifier weeks of fifty apps each, on the timer", async () => {
    // The moderator who will review this season's submissions, appointed while
    // there is still a controller to appoint one. After the seal below, nobody
    // can ever appoint another.
    mod = await register(env.as, identity(MODERATOR), "review_boss");
    ok(await env.actor.set_moderator("review_boss", true, []), "appoint the moderator");

    season = ok(await env.actor.create_season(), "create the season");
    // The complete draft comes before sealing, and sealing comes before start.
    // `start_season` checks that the canister is its own sole controller and
    // refuses otherwise, because a season that began while an external caller
    // still held the keys could have its rules rewritten halfway through. Everything
    // launch needs — the uploads, full cast, settled applications and closed
    // registration — has to be done by now.
    ok(await env.seal(), "seal the canister");
    // Readiness shut registration before the irreversible seal; starting
    // freezes the judges until the season finishes. That is why the whole cast
    // — hackers, judges, watchers, sponsors — is enrolled above and nobody
    // joins from here on.
    // The moderator starts it, not the controller: by now there is no
    // controller, and `canModerate` is true for this row alone.
    season = ok(await mod.start_season(season.id), "start the season");
    assert.equal(Number(season.week), 1);
    // A settling second so the deadline sits inside a day rather than on the
    // boundary; the canister's clock reads a hair ahead of the test's.
    await env.advance(SECOND);

    for (let w = 1; w <= QUALIFIERS; w += 1) {
      const cohort = hackers.filter((h) => h.week === w);
      assert.equal(cohort.length, PER_WEEK);

      await inFlight(
        cohort.map((h) => () => h.actor.submit_entry(entryInput(h)).then((r) => ok(r, h.handle))),
        10,
      );
      assert.equal(Number(await mod.review_pending()), PER_WEEK, `week ${w}: all pending`);
      assert.deepEqual(await weekRows(w), [], `week ${w}: nothing reaches the bracket unreviewed`);

      // Serially, because approval is what mints the entry id and the bracket section of the Rules page
      // breaks ties on it — a parallel queue would make the week's order a
      // race. The moderator here is the bootstrap controller.
      for (const revision of await mod.review_queue(BigInt(PER_WEEK * 2))) {
        ok(await mod.approve_revision(revision.id), `approve ${revision.id}`);
      }
      assert.equal(Number(await mod.review_pending()), 0, `week ${w}: queue drained`);

      const rows = await weekRows(w);
      assert.equal(rows.length, PER_WEEK, `week ${w}: fifty apps in the bracket`);
      if (w === QUALIFIERS) await sample(`all ${HACKERS} entries approved`);

      // Every judge spends both votes: one on the same entry, so the week has
      // an unambiguous winner, one spread so the tail is not all zeroes.
      const ballots = [];
      judges.forEach((judge, j) => {
        ballots.push(() => judge.actor.cast_vote(rows[0].id).then((r) => ok(r, "vote")));
        ballots.push(() =>
          judge.actor.cast_vote(rows[1 + (j % 10)].id).then((r) => ok(r, "second vote")),
        );
      });
      await inFlight(ballots, 20);

      await env.advance(WEEK + DAY);

      const closed = await weekRows(w);
      const advanced = closed.filter((row) => outcomeOf(row) === "advanced");
      assert.equal(advanced.length, 1, `week ${w}: exactly one entry advances (the bracket section of the Rules page)`);
      assert.equal(
        closed.filter((row) => outcomeOf(row) !== "none").length,
        5,
        `week ${w}: top five rewarded, and the ceiling is five`,
      );
      winners.set(w, advanced[0].id);

      const running = await env.live();
      assert.ok(running, `week ${w} should have closed into the next`);
      assert.equal(Number(running.week), w + 1, `week ${w} closed on its own deadline`);
    }
  });

  it("runs the semi-final and the final and crowns one winner", async () => {
    const semi = await weekRows(5);
    assert.equal(semi.length, QUALIFIERS, "four qualifier winners were carried in");

    const from = (rows, w) => {
      const row = rows.find((candidate) => first(candidate.origin_id) === winners.get(w));
      assert.ok(row, `week ${w}'s winner should have been carried forward`);
      return row;
    };
    // Duel A is week 1 v week 2, duel B is week 3 v week 4 (the bracket section of the Rules page). One
    // vote into each half, from every judge, so each duel has a clear survivor.
    const duelA = from(semi, 1);
    const duelB = from(semi, 3);
    await inFlight(
      judges.flatMap((judge) => [
        () => judge.actor.cast_vote(duelA.id).then((r) => ok(r, "semi A")),
        () => judge.actor.cast_vote(duelB.id).then((r) => ok(r, "semi B")),
      ]),
      20,
    );
    await env.advance(WEEK + DAY);
    assert.equal(Number((await env.live()).week), 6, "the semi-final closed into the final");

    const final = await weekRows(6);
    assert.equal(final.length, 2, "one survivor from each duel");
    const champion = final.find((row) => first(row.origin_id) === duelA.id);
    assert.ok(champion, "duel A's survivor should be in the final");
    // One vote each, not two: with two entries a judge who spends both votes
    // cancels themselves out.
    await inFlight(
      judges.map((judge) => () => judge.actor.cast_vote(champion.id).then((r) => ok(r, "final"))),
      20,
    );
    await env.advance(WEEK + DAY);

    assert.equal(await env.live(), null, "closing the final finishes the season");
    const [row] = await env.actor.season_by_number(1n);
    assert.equal(phaseOf(row), "finished");
    await sample("season finished");
  });

  // ── The answer ────────────────────────────────────────────────────────────

  it("prints what the season cost", async () => {
    const head = ["moment", "files", "heap MB", "claimed MB", "reserved MB", "live MB", "status MB"];
    const width = [34, 6, 9, 11, 12, 9, 10];
    const line = (cells) => cells.map((c, i) => pad(c, width[i])).join("  ");

    console.log("");
    console.log(`  A season of ${HACKERS} apps, ${JUDGES} judges, ${FILES} files, six weeks`);
    console.log("");
    console.log(line(head));
    console.log(line(width.map((w) => "-".repeat(w))));
    for (const s of samples) {
      console.log(
        line([
          s.label,
          s.files,
          MB(s.heap),
          MB(s.heapClaimed),
          MB(s.stableReserved),
          MB(s.stableLive),
          s.memorySize === null ? "—" : MB(s.memorySize),
        ]),
      );
    }

    const end = at("season finished");
    const perApp = end.stableReserved / HACKERS;
    const waste = end.stableReserved - end.stableLive;

    console.log("");
    console.log(`  uploaded            ${MB(UPLOADED)} MB in ${FILES} files, and the store agrees: ${MB(end.stableLive)} MB live`);
    console.log(`    per app           ${MB(BYTES_PER_APP)} MB — icon ${MB(ICON_BYTES)}, ${SHOTS} shots of ${MB(SHOT_BYTES)}, build ${MB(PKG_BYTES)}`);
    console.log(`  stable reserved     ${MB(end.stableReserved)} MB`);
    console.log(`    per app           ${MB(perApp)} MB`);
    console.log(`  fixed-slot waste    ${MB(waste)} MB — ${pct(waste, end.stableReserved)}% of what is reserved`);
    console.log(`    icons             ${pct(SLOT.small - ICON_BYTES, SLOT.small)}% of a ${MB(SLOT.small)} MB slot`);
    console.log(`    screenshots       ${pct(SLOT.image - SHOT_BYTES, SLOT.image)}% of a ${MB(SLOT.image)} MB slot`);
    console.log(`    builds            ${pct(SLOT.build - PKG_BYTES, SLOT.build)}% of a ${MB(SLOT.build)} MB slot`);
    // Deliberately not printed as a per-app number. Main memory ramps to a
    // working set and then stops; dividing the plateau by the app count would
    // read as a cost that scales, which is the opposite of what it does.
    const half = at("50% of the files uploaded");
    console.log(`  wasm main memory    ${MB(end.heapClaimed)} MB claimed, ${MB(end.heap)} MB in use`);
    console.log(`    ramps             ${MB(at("25% of the files uploaded").heapClaimed)} → ${MB(half.heapClaimed)} MB over the first ${MB(UPLOADED / 2)} MB of file`);
    console.log(`    then flat         +${MB(end.heapClaimed - half.heapClaimed)} MB over the next ${MB(UPLOADED / 2)} MB — a plateau, not a per-app cost`);
    if (end.memorySize !== null) {
      console.log(`  canister_status     ${MB(end.memorySize)} MB total`);
      console.log(`    per app           ${MB(end.memorySize / HACKERS)} MB — what the subnet charges for`);
    }
    console.log("");
  });

  it("does not put the file bytes on the heap", async () => {
    const empty = at("installed, nobody registered");
    const quarter = at("25% of the files uploaded");
    const end = at("100% of the files uploaded");

    // The claim, stated the way it can only be true of a store that is not the
    // heap: the canister's whole wasm main memory is smaller than the bytes it
    // is holding. Anything keeping file bytes on the heap would need at least
    // `UPLOADED` of main memory and would have hit the 4 GiB ceiling long
    // before a real event's worth of apps.
    // Three quarters rather than a half: the figure moves between runs (268 MB
    // and 336 MB have both been seen) because it is a garbage collector's
    // high-water mark, not a total. The bound has to leave room for that and
    // still be a statement — main memory below the file bytes is one.
    assert.ok(
      end.heapClaimed < UPLOADED * 0.75,
      `main memory is ${MB(end.heapClaimed)} MB for ${MB(UPLOADED)} MB of files — that is heap-shaped`,
    );

    // And the shape: between the quarter mark and the end, stable memory
    // roughly quadrupled while main memory barely moved. `heap` itself is not
    // asserted on — it is the used heap *including* uncollected garbage, so a
    // single reading is noise; `heapClaimed` only ever rises, so a flat one is
    // a real plateau.
    assert.ok(
      end.stableReserved > quarter.stableReserved * 3,
      "stable memory should have grown with the files",
    );
    assert.ok(
      end.heapClaimed < quarter.heapClaimed * 2,
      `main memory went ${MB(quarter.heapClaimed)} → ${MB(end.heapClaimed)} MB while stable memory went ` +
        `${MB(quarter.stableReserved)} → ${MB(end.stableReserved)} MB: it is tracking the file bytes`,
    );

    // The sharpest form of it compares the change in main memory with the
    // change in bytes actually held. `heapClaimed` is a high-water mark, so a
    // collector step can move it by one arena even though the live files never
    // touched it; allowing one quarter of the stable-file growth absorbs that
    // step while still rejecting a store that mirrors file bodies onto the
    // heap. The quarter-to-end interval is deliberately large enough to make
    // the two shapes unambiguous.
    const fileGrowth = end.stableLive - quarter.stableLive;
    const heapGrowth = end.heapClaimed - quarter.heapClaimed;
    assert.ok(
      heapGrowth < fileGrowth / 4,
      `main memory grew ${MB(heapGrowth)} MB while stable files grew ${MB(fileGrowth)} MB ` +
        "from 25% to 100% of the upload",
    );
    assert.ok(empty.heapClaimed < end.heapClaimed, "though it did claim more than it started with");
  });

  it("reserves what the fixed slots say it should, and no more", async () => {
    const end = at("season finished");

    // `Slab` is arithmetic, not a heuristic: every file lands in the smallest
    // class that holds it and every slot is a whole number of 64 KiB pages, so
    // the reserved total is predictable to the page. Held to 2% rather than to
    // the byte — the classes are a published table and may be retuned.
    assert.ok(
      Math.abs(end.stableReserved - SLOTTED) < SLOTTED * 0.02,
      `reserved ${MB(end.stableReserved)} MB against the ${MB(SLOTTED)} MB the slot table predicts`,
    );
    assert.ok(
      end.stableReserved >= end.stableLive,
      `reserved ${MB(end.stableReserved)} MB must cover the ${MB(end.stableLive)} MB held`,
    );

    // The gap between them is the whole price of fixed slots: an icon of
    // 100,000 B sitting in 131,072 B of region, and so on up. It is bounded
    // rather than pinned — the classes are sized to the caps, and files at the
    // caps are the best case a slot table has.
    const waste = (end.stableReserved - end.stableLive) / end.stableReserved;
    assert.ok(
      waste > 0.05 && waste < 0.25,
      `fixed-slot waste is ${pct(end.stableReserved - end.stableLive, end.stableReserved)}%, ` +
        `outside the 5–25% a slot table sized to these caps should produce`,
    );

    // Nothing was replaced or deleted all season, so no slot was ever freed
    // and no region ever grew twice for the same file.
    assert.equal(
      end.stableReserved,
      at("100% of the files uploaded").stableReserved,
      "playing six weeks moved no bytes: a carried entry clones keys, not files",
    );
    assert.equal(end.files, FILES, "and stored no new ones");
  });

  it("says it is holding the bytes that were actually sent", async () => {
    // `stableLive` is the store's own count of file bytes, and the test knows
    // independently what it put in — 4.4 MB an app, sent from here. The two
    // are held against each other at every quarter, not only at the end, so a
    // count that drifted (a file stored twice, a size taken from the request
    // rather than the blob) would show up as a slope rather than a fixed
    // offset. Each quarter is exactly fifty hackers' worth of uploads.
    for (let q = 1; q <= 4; q += 1) {
      const s = at(`${q * 25}% of the files uploaded`);
      const expected = (UPLOADED * q) / 4;
      assert.ok(
        Math.abs(s.stableLive - expected) < expected * 0.01,
        `"${s.label}": stableLive is ${MB(s.stableLive)} MB against the ${MB(expected)} MB sent`,
      );
      assert.equal(s.files, (FILES * q) / 4, `"${s.label}": and one asset row per upload`);
    }

    const end = at("season finished");
    assert.ok(
      Math.abs(end.stableLive - UPLOADED) < UPLOADED * 0.01,
      `${MB(end.stableLive)} MB held against ${MB(UPLOADED)} MB uploaded`,
    );
    assert.ok(
      end.stableLive === at("100% of the files uploaded").stableLive,
      "and six weeks of bracket play stored and freed nothing",
    );
  });

  it("agrees with what the management canister says the canister weighs", async () => {
    // Ask before the controller is irreversibly removed. PocketIC exposes
    // `canister_status` to that controller at this point; accepting `null`
    // would turn the independent cross-check into a test that can silently do
    // nothing on every run.
    const end = at("100% of the files uploaded");
    assert.notEqual(
      end.memorySize,
      null,
      "canister_status must be available for the memory cross-check",
    );

    // An independent number for the same thing: `memory()` is the canister
    // measuring itself with `Prim.rts_memory_size`, the status is the subnet
    // measuring it. The subnet counts main memory *and* stable memory, plus
    // the module and its globals, so it must sit above the sum — and not far
    // above it, or one of the two is counting something the other cannot see.
    const accounted = end.heapClaimed + end.stableReserved;
    assert.ok(
      end.memorySize >= accounted,
      `canister_status says ${MB(end.memorySize)} MB, below the ${MB(accounted)} MB ` +
        `heapClaimed + stableReserved already accounts for`,
    );
    // A flat 64 MB rather than a percentage of the total: what the subnet sees
    // and the canister does not is the module, its globals and the replica's
    // own per-canister overhead, and none of that grows with the season. A
    // proportional slack would have let a fifth of a gigabyte go unexplained at
    // this size and called it agreement. The gap measured here is ~14 MB.
    assert.ok(
      end.memorySize < accounted + 64e6,
      `canister_status says ${MB(end.memorySize)} MB against ${MB(accounted)} MB accounted for: ` +
        `${MB(end.memorySize - accounted)} MB is unexplained`,
    );
  });

  it("ends on one winner and six weeks that add up", async () => {
    const totals = [];
    let won = 0;
    for (let w = 1; w <= 6; w += 1) {
      const rows = await weekRows(w);
      totals.push(rows.length);
      won += rows.filter((row) => outcomeOf(row) === "won").length;
    }
    assert.deepEqual(totals, [PER_WEEK, PER_WEEK, PER_WEEK, PER_WEEK, 4, 2], "the whole bracket");
    assert.equal(won, 1, "one grand prize in a season (the bracket section of the Rules page)");
    assert.equal(await env.actor.clock_armed(), false, "and nothing is armed afterwards");
  });
});
