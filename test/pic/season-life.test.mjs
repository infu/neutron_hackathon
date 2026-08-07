/**
 * A whole season, lived a day at a time.
 *
 * `clock.test.mjs` proves the canister closes its own rounds. This file asks
 * what those six rounds *contain*: fifteen hackers submitting on the days that
 * suit them, six judges voting on the days that suit them, projects reworked
 * mid-week, ballots changed before a week closes, judges who sit a week out —
 * and then the bracket that comes out of the far end.
 *
 * Nobody presses anything. Time moves in single days, thirty of them — four
 * qualifier weeks and then a day each for the semi-final and the final — so an
 * off-by-one at a round boundary has nowhere to hide; everything else — who
 * submitted what, who voted for whom — is bookkept here in JS and held against
 * what the canister says at the moment each round resolves.
 *
 * Two shorter seasons follow, about shape rather than timing: one where a
 * qualifier week is empty, and one where the same hacker wins two qualifiers.
 * They used to press `close_week` between rounds; there is no such call any
 * more, so they push the clock past each deadline instead and let the timer do
 * what it does in the full run above.
 *
 * Three things sit underneath all of that and are deliberately kept out of the
 * script's way. An entry is an *app*, so every submission names a `.neutron`
 * build that is already in the asset store *and* a permanent app id — each
 * hacker uploads a build when they join, and the id is fixed at first
 * submission and passed back unchanged on every edit. Every hacker also
 * arrives with a reward wallet, because an account with nowhere to be paid
 * cannot submit at all. And nothing a hacker asks for reaches the bracket by
 * itself: it is a revision until a moderator approves it, so `submit` and
 * `edit` below propose, approve as that moderator, and hand back the entry
 * that resulted.
 *
 * Which is why the cast has moderators in it at all. Before any season exists
 * the fixture calls `seal_canister()`, which leaves exactly the canister itself
 * as controller and removes every external controller. So the identity that
 * installed the canister keeps no powers whatsoever, and the implicit
 * moderator seat `Profiles.canModerate` hands a controller goes with them.
 * From the seal onwards the only people who can approve anything are people
 * with a profile row and the moderator flag on it, and `set_moderator` is
 * controller-only — so they have to be appointed *before* the seal. That
 * ordering is forced everywhere: `create_season` and `start_season` are
 * moderator calls now, because a controller gate on a sealed canister is a
 * gate no external ingress caller could pass.
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
  SECOND,
} from "./harness.mjs";

/** Principals compare as text, and a set of them compares sorted. */
const asText = (list) => list.map((who) => who.toText()).sort();

/** Candid `opt` is a 0-or-1 array; this is the value or nothing. */
const first = (opt) => (opt.length === 0 ? null : opt[0]);

/** A variant comes back as `{ rewarded: null }`; this is the name. */
const outcomeOf = (entry) => Object.keys(entry.outcome)[0];

/**
 * How many rounds of the season are qualifier weeks.
 *
 * `Season.QUALIFIERS`, and the line the bracket changes shape at: rounds 1 to 4
 * take submissions and run a week each, rounds 5 and 6 are carried into and run
 * a day each (`Season.roundNanos`). A season is therefore four weeks and two
 * days long, not six weeks.
 */
const QUALIFIERS = 4;

/** The same, for a revision's `#pending` / `#approved` / `#expired`. */
const stateOf = (revision) => Object.keys(revision.state)[0];

/**
 * The permanent app id for a project this file knows by `label`.
 *
 * An entry now carries one, and it is narrow on purpose: 5 to 50 characters of
 * `a-z` and `_`, unique across hackers, and fixed once chosen — an edit has to
 * pass the same id back or the canister refuses it rather than quietly
 * ignoring the change. The labels below are already one per project, so
 * deriving the id from the label gives uniqueness for free and gives an edit
 * the same id its submission used. The prefix is what lifts four-letter names
 * like `kite` over the minimum; digits become letters and anything else
 * becomes an underscore, so nothing outside the alphabet the canister takes
 * can reach it.
 */
const slugFor = (label) =>
  `app_${label
    .toLowerCase()
    .replace(/\d/g, (digit) => "abcdefghij"[Number(digit)])
    .replace(/[^a-z_]/g, "_")}`;

const entryInput = ({
  title,
  slug,
  summary = "",
  url = "",
  icon = null,
  shots = [],
  links = [],
  pkg = "",
}) => ({
  title,
  slug,
  summary,
  url,
  icon: icon === null ? [] : [icon],
  shots,
  links,
  pkg: { key: pkg },
});

/**
 * Put a build in the asset store under `who`'s namespace and hand back its key.
 *
 * The canister refuses an entry whose package is not already a finished upload,
 * so this has to happen before anything is submitted against it.
 */
async function packageFor(who, stamp, bytes = 96) {
  const key = `/u/${who.id}/pkg/${stamp}.neutron`;
  ok(
    await who.actor.my_upload({
      store: {
        key,
        contentType: "application/octet-stream",
        contentEncoding: "identity",
        chunks: 1n,
        content: new Uint8Array(bytes).fill(7),
      },
    }),
    `${who.handle} uploads a build`,
  );
  return key;
}

/**
 * A separate app gets a separate exact asset key, even when the fixture uses
 * identical bytes. Carried copies and edits keep the key already on their
 * lineage; only a genuinely new qualifier app calls this helper.
 */
async function freshPackageFor(who) {
  const stamp = who.nextPackageStamp ?? 2;
  who.nextPackageStamp = stamp + 1;
  who.pkg = await packageFor(who, stamp, 32);
  return who.pkg;
}

/**
 * Push a proposal through review and read back what it did.
 *
 * `submit_entry` and `publish_update` answer with a revision in `#pending`;
 * the bracket does not move until a moderator agrees. Every proposal in this
 * file is made after the canister was sealed, and a sealed canister has no
 * controllers at all — so `Principal.isController(env.actor)` is false for
 * good and `Profiles.canModerate` refuses it. `env.mod` is the moderator each
 * suite appointed while there was still somebody who could appoint one, and is
 * the only one who can decide anything from here. This approves and then reads
 * the entry off the table rather than believing the revision — a proposal and
 * an entry are different things now.
 */
async function land(env, who, proposal, what) {
  const revision = ok(proposal, what);
  assert.equal(stateOf(revision), "pending", `${what}: a proposal starts out pending`);
  // `approve` answers `#ok` for a revision it *expired* as well as one it
  // applied, so the decision has to be read rather than merely unwrapped:
  // `#approved` is the only state that moved the entry.
  const decided = ok(await env.mod.approve_revision(revision.id), `approve ${what}`);
  assert.equal(stateOf(decided), "approved", `${what}: the decision should have applied it`);
  const [entry] = await who.actor.my_entry();
  assert.ok(entry, `${what}: approving should have put it in the open week`);
  return entry;
}

const submitEntry = async (env, who, input, what) =>
  land(env, who, await who.actor.submit_entry(input), what);

const publishUpdate = async (env, who, input, what) => {
  const [target] = await who.actor.my_entry();
  assert.ok(target, `${what}: an update needs a current target`);
  const entry = await land(
    env,
    who,
    await who.actor.publish_update(target.id, input),
    what,
  );
  // Shipping replaces the build, and approving the replacement deletes the one
  // it replaced — the Build section of the Rules page says a withdrawn build stops resolving. So the
  // fixture's idea of "this hacker's package" has to move with it, or next
  // week's submission names a key that is no longer there.
  const current = first(entry.pkg)?.key;
  if (current) who.pkg = current;
  return entry;
};

/** Register somebody and hand back their actor, handle and canister-assigned id. */
async function join(env, n, handle, { hacker = false, judge = false } = {}) {
  const actor = await register(env.as, identity(n), handle);
  if (hacker) {
    // Somewhere to be paid, before there is anything to pay for: `submit_entry`
    // answers `#NoWallet` to a hacker who has not named one. It has to be a
    // different principal from the one they signed in with, which is exactly
    // what `walletFor` derives.
    ok(await actor.set_wallet(walletFor(n)), `${handle} names a reward wallet`);
    // Nothing else to collect: the one acceptance at registration covers every
    // role somebody later assumes (the canonical agreement on the Rules page), so taking the hacker seat is a
    // flag and not a second attestation.
    ok(await actor.set_hacker(true), `${handle} becomes a hacker`);
  }
  if (judge) ok(await actor.apply_as_judge(), `${handle} applies to judge`);
  const [me] = await actor.me();
  const who = { actor, handle, id: me.id };
  // Every entry has to name a build, so every hacker arrives with one. A
  // deliberately odd size, so a later assertion about a *shipped* package's
  // byte count cannot pass by accident on this one.
  if (hacker) who.pkg = await packageFor(who, 1, 32);
  return who;
}

/**
 * Register somebody, appoint them a moderator, and hand them back.
 *
 * Must be called before `seal_canister()`. `set_moderator` is controller-only
 * and sealing removes the external controller, so this is not merely
 * "before the season" — it is the last moment in the canister's entire life
 * that a moderator can be appointed at all. A canister sealed with no
 * moderator on it could never approve an entry, and could never start a
 * season either, because `start_season` is a moderator's call now.
 */
async function seatModerator(env, n, handle) {
  const who = await join(env, n, handle);
  ok(await env.actor.set_moderator(handle, true, []), `appoint ${handle}`);
  return who;
}

/** Rank the way the bracket section of the Rules page says: votes descending, ties to the earliest id. */
const byRule = (rows) =>
  [...rows].sort((a, b) => {
    if (a.votes !== b.votes) return a.votes > b.votes ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

/**
 * Let the open week run out, and say which week that left open.
 *
 * Nothing closes a week but its own deadline any more — `close_week` is gone,
 * and on a sealed canister there is nobody privileged left who could have
 * pressed it anyway — and `closeWeek` from the
 * harness does the only thing left: it moves the clock past the deadline and
 * lets the canister's timer fire. The week number is checked here because
 * `close_week` used to be unwrapped with `ok`, and a close that silently did
 * not happen should still fail at the close rather than three assertions later.
 */
const closeInto = async (env, weekNo) => {
  const season = await closeWeek(env);
  assert.equal(
    Number(season.week),
    weekNo,
    `the open week should have closed into week ${weekNo}`,
  );
  return season;
};

describe("a season played out a day at a time", () => {
  let env;
  let season;

  /** The cast, by the name they are known as in the script below. */
  const H = {}; // hackers
  const J = {}; // approved judges
  const cast = {}; // everybody else — moderators, sponsors, observers, and a rejected judge

  /** Project label → entry id, and back, so the script never handles raw ids. */
  const ids = new Map();
  const names = new Map();
  /** Entry id → the number of votes this file believes it cast on it. */
  const tally = new Map();
  /** The day each week closed on. */
  const closes = [];

  const idOf = (label) => {
    const found = ids.get(label);
    assert.ok(found !== undefined, `no entry called ${label} has been submitted`);
    return found;
  };
  const nameOf = (row) => names.get(row.id) ?? `entry ${row.id}`;

  const remember = (label, entry) => {
    ids.set(label, entry.id);
    names.set(entry.id, label);
    tally.set(entry.id, 0);
    return entry;
  };

  const submit = async (who, label, input) => {
    const pkg = await freshPackageFor(who);
    const entry = await submitEntry(
      env,
      who,
      entryInput({ pkg, slug: slugFor(label), ...input }),
      `submit ${label}`,
    );
    return remember(label, entry);
  };

  /** A hacker reworking their pitch mid-week. Replaces the row, keeps the id. */
  const edit = async (who, label, input) => {
    // An edit resubmits the whole row, the build and the app id included — so
    // it carries whatever package the entry already holds, which is what a form
    // showing the current state sends back. The id has to come back untouched:
    // `slugFor` is a function of the label, so this is the same string the
    // submission chose, and anything else would be refused with "an app id
    // cannot be changed once it is set".
    const [before] = await who.actor.my_entry();
    const held = first(before.pkg)?.key ?? who.pkg;
    const entry = await submitEntry(
      env,
      who,
      entryInput({ pkg: held, slug: slugFor(label), ...input }),
      `edit ${label}`,
    );
    assert.equal(entry.id, idOf(label), "an edit must replace the row, not open a second one");
    return entry;
  };

  const votes = async (judge, ...labels) => {
    for (const label of labels) {
      ok(await judge.actor.cast_vote(idOf(label)), `${judge.handle} votes for ${label}`);
      tally.set(idOf(label), tally.get(idOf(label)) + 1);
    }
  };

  const unvotes = async (judge, ...labels) => {
    for (const label of labels) {
      ok(await judge.actor.withdraw_vote(idOf(label)), `${judge.handle} takes back ${label}`);
      tally.set(idOf(label), tally.get(idOf(label)) - 1);
    }
  };

  const weekRows = async (weekNo) => env.actor.season_week(season.id, BigInt(weekNo), 500n);

  /** The week's ranking by label, and every tally matching what we cast. */
  const ranking = async (weekNo, order) => {
    const rows = await weekRows(weekNo);
    for (const row of rows) {
      assert.equal(row.votes, BigInt(tally.get(row.id)), `${nameOf(row)} holds the wrong tally`);
    }
    // Twice over: the order the canister returned is the one written down
    // here, and that order is also what the bracket section of the Rules page produces from the tallies.
    assert.deepEqual(rows.map(nameOf), order, `week ${weekNo} came back in the wrong order`);
    assert.deepEqual(
      byRule(rows).map(nameOf),
      order,
      `week ${weekNo} is not votes-descending, ties to the earliest id`,
    );
    return rows;
  };

  const marks = async (weekNo) =>
    Object.fromEntries((await weekRows(weekNo)).map((row) => [nameOf(row), outcomeOf(row)]));

  /** Attach the carried rows of a bracket week to labels, via their origin. */
  const adopt = async (weekNo, pairs) => {
    const rows = await weekRows(weekNo);
    for (const [label, from] of pairs) {
      const row = rows.find((candidate) => first(candidate.origin_id) === idOf(from));
      assert.ok(row, `${from} should have been carried into week ${weekNo}`);
      assert.equal(row.votes, 0n, "a carried entry starts the round on nobody's vote");
      assert.equal(outcomeOf(row), "none", "and with nothing decided about it yet");
      remember(label, row);
    }
    return rows;
  };

  /**
   * What happens on each day of the season, indexed by how many days have
   * passed since it started. Day 0 is the day a moderator starts it; the
   * canister closes week 1 during the advance to day 7, so day 7's entries are
   * week 2's.
   *
   * The season is four weeks and two days, not six weeks: the qualifiers close
   * on days 7, 14, 21 and 28, and the semi-final and the final each run for a
   * single day after that. So days 28 and 29 carry a whole round apiece — the
   * field arriving, every ballot in it, and the round resolving — where a
   * qualifier week has six days to spread the same thing over.
   */
  const script = {
    1: async () => {
      await submit(H.gus, "halo", { title: "Halo", summary: "Ambient light for the desk." });
      await submit(H.hana, "ion", { title: "Ion", summary: "A charge tracker." });
    },

    2: async () => {
      // The first judges in. Nobody has to vote on any particular day.
      await votes(J.a, "cinder", "drift");
      await votes(J.b, "beacon", "cinder");

      const key = await packageFor(H.alia, 1700000001);
      const shipped = await publishUpdate(
        env,
        H.alia,
        { version: "0.1.0", note: "First build.", pkg: [{ key }] },
        "alia ships",
      );
      assert.equal(first(shipped.pkg).key, key);
      // Read off the entry: the stored id carries a suffix the canister assigns,
      // so predicting it would assert this test's arithmetic rather than that
      // the file is named after the app.
      assert.equal(first(shipped.pkg).name, `${shipped.slug}.neutron`, "the canister names the build after the app");
      assert.equal(first(shipped.pkg).size, 96n, "and measures it off the asset store");
    },

    3: async () => {
      await submit(H.iris, "jetty", { title: "Jetty", summary: "A dock for side projects." });

      // A hacker sharpening the pitch four days in. Votes already cast stay,
      // and the build shipped yesterday is not part of what an edit replaces.
      const beforeEdit = first(await H.alia.actor.my_entry());
      const reworked = await edit(H.alia, "beacon", {
        title: "Beacon",
        summary: "A lighthouse for your inbox. Now with rules.",
        url: "https://example.com/beacon",
        icon: `/u/${H.alia.id}/icon/beacon.png`,
        shots: [`/u/${H.alia.id}/shots/1.png`, `/u/${H.alia.id}/shots/2.png`, `/u/${H.alia.id}/shots/3.png`],
        links: [
          { kind: "demo", url: "https://example.com/beacon/demo" },
          { kind: "x", url: "https://x.com/beacon" },
        ],
      });
      assert.equal(reworked.votes, 1n, "an edit does not disturb the votes already cast");
      // The whole record, not merely a build of the same name: still stamped
      // `0.1.0` at the moment it shipped, rather than re-measured and reset to
      // the default version by the resubmission that named it again.
      assert.deepEqual(reworked.pkg, beforeEdit.pkg, "nor the build");
      assert.equal(first(reworked.pkg).name, `${reworked.slug}.neutron`);
      assert.equal(first(reworked.pkg).version, "0.1.0", "the shipped version is not restamped");
      assert.equal(reworked.updates.length, 1, "nor the changelog");
    },

    4: async () => {
      await votes(J.c, "beacon", "drift");
      await votes(J.d, "beacon", "ember");

      // A judge who has thought better of it, with the week still open.
      assert.equal(await J.a.actor.my_votes_left(), 0n);
      await unvotes(J.a, "cinder", "drift");
      assert.equal(await J.a.actor.my_votes_left(), 2n, "withdrawing gives the votes back");
      await votes(J.a, "beacon", "flux");
      assert.equal(await J.a.actor.my_votes_left(), 0n);
    },

    5: async () => {
      await votes(J.e, "halo", "cinder");

      // Both decision sets are accounting truth once the season starts.
      assert.equal(await env.actor.judges_frozen(), true);
      assert.deepEqual(
        await cast.warden.actor.set_judge(cast.late.handle, { approved: null }, []),
        { err: { JudgesFrozen: null } },
        "no judge may be added once the season is under way (the Roles section of the Rules page)",
      );
      assert.deepEqual(
        await cast.warden.actor.set_sponsor(cast.sponsorY.handle, { approved: null }, []),
        { err: { SponsorsFrozen: null } },
        "the sponsor/ledger set cannot change after launch",
      );
      assert.deepEqual(
        await cast.late.actor.cast_vote(idOf("beacon")),
        { err: { NotAJudge: null } },
        "an unapproved applicant is not a judge",
      );
    },

    6: async () => {
      // The last day of the week: still nine entries, still nothing decided.
      const rows = await weekRows(1);
      assert.equal(rows.length, 9);
      assert.deepEqual(new Set(rows.map(outcomeOf)), new Set(["none"]));
      // Paired deliberately: on its own "the judge who never voted has two
      // left" is true of a canister that never counted anything. Held against
      // a judge who spent both on the same day, it says the allowance is per
      // judge rather than a constant.
      assert.equal(await J.a.actor.my_votes_left(), 0n, "a judge who spent both has none");
      assert.equal(await J.f.actor.my_votes_left(), 2n, "one judge sat week one out entirely");
    },

    7: async () => {
      // Week 1 has just resolved on its own. Everything below is week 2.
      await ranking(1, ["beacon", "cinder", "drift", "ember", "flux", "halo", "glint", "ion", "jetty"]);
      assert.deepEqual(await marks(1), {
        beacon: "advanced",
        cinder: "rewarded",
        drift: "rewarded",
        ember: "rewarded",
        // Flux and Halo both finished on one vote. The fifth and last rewarded
        // place goes to whoever submitted first — the bracket section of the Rules page, exactly.
        flux: "rewarded",
        halo: "none",
        glint: "none",
        ion: "none",
        jetty: "none",
      });

      const fresh = await submit(H.bex, "cinder_ii", {
        title: "Cinder II",
        summary: "Rewritten after week one.",
      });
      assert.equal(fresh.week, 2n, "an entry made after a week closes belongs to the new week");
      assert.equal((await weekRows(1)).length, 9, "and does not join the closed one");

      await submit(H.eli, "flux_two", { title: "Flux Two", summary: "Second attempt." });
      await submit(H.joss, "kite", { title: "Kite", summary: "Share a build in one link." });

      assert.deepEqual(
        await J.a.actor.cast_vote(idOf("beacon")),
        { err: { WeekClosed: null } },
        "week one's entries are past voting",
      );
      assert.deepEqual(
        await J.b.actor.withdraw_vote(idOf("beacon")),
        { err: { WeekClosed: null } },
        "and a ballot cast in week one cannot be taken back in week two (the Judging section of the Rules page)",
      );
      assert.equal(await J.a.actor.my_votes_left(), 2n, "every judge starts the new week with two");
    },

    8: async () => {
      await submit(H.kai, "lumen", { title: "Lumen", summary: "Reading light for docs." });
      await submit(H.lena, "mote", { title: "Mote", summary: "Tiny notes." });
    },

    9: async () => {
      await votes(J.a, "kite", "lumen");
      await votes(J.b, "kite", "mote");
      await votes(J.c, "kite", "cinder_ii");
    },

    10: async () => {
      // Last week's winner enters again with a different project. The row
      // carried into the semi-final is a separate thing entirely.
      await submit(H.alia, "beacon_two", { title: "Beacon Two", summary: "A spin-off." });
      const renamed = await edit(H.joss, "kite", {
        title: "Kite Mail",
        summary: "Share a build in one link. Now with mail.",
        links: [{ kind: "demo", url: "https://example.com/kite" }],
      });
      assert.equal(renamed.title, "Kite Mail");
    },

    11: async () => {
      await votes(J.d, "kite", "lumen");
      await votes(J.e, "lumen", "beacon_two");
      await votes(J.f, "kite", "flux_two");
    },

    12: async () => {
      await unvotes(J.b, "mote");
      await votes(J.b, "lumen");
      // The closed week is untouched by any of this.
      await ranking(1, ["beacon", "cinder", "drift", "ember", "flux", "halo", "glint", "ion", "jetty"]);
    },

    14: async () => {
      await ranking(2, ["kite", "lumen", "cinder_ii", "flux_two", "beacon_two", "mote"]);
      assert.deepEqual(await marks(2), {
        kite: "advanced",
        lumen: "rewarded",
        cinder_ii: "rewarded",
        flux_two: "rewarded",
        beacon_two: "rewarded",
        mote: "none",
      });

      await submit(H.coen, "drift_three", { title: "Drift Three", summary: "Back again." });
      await submit(H.mo, "nomad", { title: "Nomad", summary: "Offline-first everything." });
      await submit(H.nils, "onyx", { title: "Onyx", summary: "A very dark theme." });
    },

    15: async () => {
      await submit(H.fen, "glint_three", { title: "Glint Three", summary: "Third time." });
    },

    16: async () => {
      await votes(J.a, "nomad", "onyx");
      await votes(J.b, "nomad", "drift_three");
    },

    17: async () => {
      const key = await packageFor(H.mo, 1700000002);
      await publishUpdate(
        env,
        H.mo,
        { version: "1.0.0", note: "Sync engine.", pkg: [{ key }] },
        "mo ships",
      );
      await edit(H.mo, "nomad", {
        title: "Nomad",
        summary: "Offline-first everything, now with sync.",
        url: "https://example.com/nomad",
        icon: `/u/${H.mo.id}/icon/nomad.png`,
        shots: [`/u/${H.mo.id}/shots/a.png`],
        links: [{ kind: "docs", url: "https://example.com/nomad/docs" }],
      });
    },

    18: async () => {
      await votes(J.c, "nomad", "glint_three");
      await votes(J.d, "onyx", "drift_three");
      await votes(J.e, "nomad", "onyx");
    },

    19: async () => {
      await unvotes(J.d, "drift_three");
      await votes(J.d, "nomad");
      // Week three has the same shape as week one: judge_f sits it out, so the
      // week resolves on five ballots rather than six.
      assert.equal(await J.d.actor.my_votes_left(), 0n, "judge_d has spent both again");
      assert.equal(await J.f.actor.my_votes_left(), 2n, "judge_f sat week three out as well");
    },

    21: async () => {
      await ranking(3, ["nomad", "onyx", "drift_three", "glint_three"]);
      assert.deepEqual(await marks(3), {
        // Four entries, four rewards: top five is a ceiling, not a quota.
        nomad: "advanced",
        onyx: "rewarded",
        drift_three: "rewarded",
        glint_three: "rewarded",
      });

      await submit(H.ora, "pillar", { title: "Pillar", summary: "Load-bearing infrastructure." });
      await submit(H.dara, "ember_four", { title: "Ember Four", summary: "One more go." });
    },

    22: async () => {
      await submit(H.gus, "halo_four", { title: "Halo Four", summary: "Now for the wall." });
    },

    24: async () => {
      await votes(J.a, "pillar", "ember_four");
      await votes(J.b, "pillar", "halo_four");
      await votes(J.c, "pillar", "ember_four");
    },

    25: async () => {
      await votes(J.d, "pillar", "halo_four");
      await votes(J.e, "pillar", "ember_four");
      await votes(J.f, "pillar", "halo_four");
    },

    26: async () => {
      await unvotes(J.e, "ember_four");
      await votes(J.e, "halo_four");
    },

    28: async () => {
      await ranking(4, ["pillar", "halo_four", "ember_four"]);
      assert.deepEqual(await marks(4), {
        pillar: "advanced",
        halo_four: "rewarded",
        ember_four: "rewarded",
      });

      // The semi-final field, assembled by the canister over four weeks.
      const semi = await adopt(5, [
        ["beacon@5", "beacon"],
        ["kite@5", "kite"],
        ["nomad@5", "nomad"],
        ["pillar@5", "pillar"],
      ]);
      assert.equal(semi.length, 4, "exactly the four qualifier winners, and nobody else");

      // And the whole of the semi-final happens today, because the semi-final
      // is one day long. Every ballot, the refusal a late submission gets and
      // the one edit a carried row still allows have to land inside it: unlike
      // a qualifier week, there is no second day to spread them over.
      await votes(J.a, "beacon@5", "kite@5");
      await votes(J.b, "beacon@5", "kite@5");
      await votes(J.c, "beacon@5", "kite@5");
      await votes(J.d, "beacon@5", "kite@5");
      await votes(J.e, "beacon@5", "nomad@5");
      await votes(J.f, "nomad@5", "pillar@5");

      assert.deepEqual(
        await H.alia.actor.submit_entry(
          entryInput({ title: "A late idea", slug: slugFor("late_idea"), pkg: H.alia.pkg }),
        ),
        { err: { Season: { WeekClosed: null } } },
        "the bracket rounds are carried into, never submitted into",
      );

      // A carried entry is the owner's open entry, and `editable` says so —
      // but only its art and its build can move (the Build section of the Rules page). The row itself
      // is a clone the canister made and cannot be resubmitted over.
      const [mine] = await H.joss.actor.entry_detail(idOf("kite@5"));
      assert.equal(mine.versionsEditable, true, "a build can still be shipped against it");
      assert.equal(mine.detailsEditable, false, "but the row itself cannot be replaced");
      assert.deepEqual(
        await H.joss.actor.submit_entry(
          entryInput({ title: "Kite Mail", slug: slugFor("kite"), pkg: H.joss.pkg }),
        ),
        { err: { Season: { WeekClosed: null } } },
        "the semi-final row is not something a hacker submits over",
      );

      const shipped = await publishUpdate(
        env,
        H.joss,
        { version: "1.1.0", note: "Semi-final polish.", pkg: [] },
        "joss publishes against the carried row",
      );
      assert.equal(shipped.updates.length, 1);
      assert.equal(shipped.id, idOf("kite@5"), "published against the semi-final row, not the origin");
      // Read back off the table rather than believing the value the call
      // handed back: "landed on the right row" and "landed nowhere" look the
      // same from the return value alone.
      const carried = (await weekRows(5)).find((row) => nameOf(row) === "kite@5");
      assert.equal(carried.updates.length, 1, "and the changelog is on the row when it is read again");
      const week2 = (await weekRows(2)).find((row) => nameOf(row) === "kite");
      assert.equal(week2.updates.length, 0, "and week two's changelog is not rewritten behind it");
    },

    29: async () => {
      await ranking(5, ["beacon@5", "kite@5", "nomad@5", "pillar@5"]);
      assert.deepEqual(await marks(5), {
        // Kite is second on votes across the whole round and still goes out:
        // it met Beacon in duel A. Nomad survives duel B on two (the bracket section of the Rules page).
        "beacon@5": "advanced",
        "kite@5": "none",
        "nomad@5": "advanced",
        "pillar@5": "none",
      });

      const final = await adopt(6, [
        ["beacon@6", "beacon@5"],
        ["nomad@6", "nomad@5"],
      ]);
      assert.equal(final.length, 2, "one survivor from each duel");

      // The final, in the one day it also gets. Judge A spends both votes on
      // the two finalists, which is legal and cancels out; the other five
      // decide it four to three.
      await votes(J.a, "beacon@6", "nomad@6");
      await votes(J.b, "nomad@6");
      await votes(J.c, "nomad@6");
      await votes(J.d, "nomad@6");
      await votes(J.e, "beacon@6");
      await votes(J.f, "beacon@6");
    },
  };

  before(async () => {
    env = await bootstrap({ controller: identity(1000) });

    const hackers = [
      ["alia", 1001],
      ["bex", 1002],
      ["coen", 1003],
      ["dara", 1004],
      ["eli", 1005],
      ["fen", 1006],
      ["gus", 1007],
      ["hana", 1008],
      ["iris", 1009],
      ["joss", 1010],
      ["kai", 1011],
      ["lena", 1012],
      ["mo", 1013],
      ["nils", 1014],
      ["ora", 1015],
    ];
    for (const [name, n] of hackers) {
      H[name] = await join(env, n, `hacker_${name}`, { hacker: true });
    }

    // Six judges, approved before anything is submitted — the judges are fixed
    // before any entry is seen (the Roles section of the Rules page).
    const judges = [
      ["a", 1021],
      ["b", 1022],
      ["c", 1023],
      ["d", 1024],
      ["e", 1025],
      ["f", 1026],
    ];
    for (const [name, n] of judges) {
      J[name] = await join(env, n, `judge_${name}`, { judge: true });
      ok(await env.actor.set_judge(J[name].handle, { approved: null }, []), `approve judge_${name}`);
    }

    // An unsuccessful application stays unsuccessful when the roster freezes.
    cast.late = await join(env, 1027, "judge_late", { judge: true });

    // Two moderators, because approving a judge or a sponsor now takes two of
    // them (`Moderation.SECONDS_NEEDED`). `Moderation.quorum` still lets a
    // controller with no profile row through alone — which is how the judges
    // above was seated in one call each — but that exception lasts exactly as
    // long as there is a controller, and the seal below ends it for good. So
    // both of these are appointed now, in the only window there will ever be,
    // and everything from the first submission onwards is reviewed as the
    // warden.
    cast.warden = await seatModerator(env, 1041, "warden");
    cast.deputy = await seatModerator(env, 1042, "deputy");
    env.mod = cast.warden.actor;

    for (const [key, n, org] of [
      ["sponsorX", 1031, "Northwind"],
      ["sponsorY", 1032, "Halcyon"],
    ]) {
      cast[key] = await join(env, n, `sponsor_${key.slice(-1).toLowerCase()}`);
      // Applying takes nothing beyond being registered: the acceptance made at
      // registration already covers the prize-contributor role (agreement §3 on the Rules page),
      // so there is no second gate here for a route to forget to show.
      ok(
        await cast[key].actor.apply_as_sponsor({
          org,
          blurb: "Backing the season.",
          website: "https://example.com",
          logo: [],
          ledgers: [{ id: env.launchLedger, sns: false }],
        }),
        `${key} applies`,
      );
    }
    // The first vote is recorded and refused, and the second applies it.
    assert.deepEqual(
      await cast.warden.actor.set_sponsor(cast.sponsorX.handle, { approved: null }, []),
      { err: { NeedsSecond: { votes: 1n, needed: 2n } } },
      "the warden alone is one of the two an approval needs",
    );
    ok(await cast.deputy.actor.set_sponsor(cast.sponsorX.handle, { approved: null }, []), "approve X");

    // The launch gate admits no unresolved role applications. These two are
    // kept as rejected applicants so the running-season tests can still prove
    // that a frozen roster cannot approve them later.
    ok(await env.actor.set_judge(cast.late.handle, { no: null }, []), "reject late judge");
    ok(await env.actor.set_sponsor(cast.sponsorY.handle, { no: null }, []), "reject sponsor Y");

    for (const [key, n] of [
      ["lurkerA", 1051],
      ["lurkerB", 1052],
      ["lurkerC", 1053],
    ]) {
      cast[key] = await join(env, n, `lurker_${key.slice(-1).toLowerCase()}`);
    }

    // The point of no return, and everything above it is here because it has
    // to be above it. Moderators appointed, the judges seated on the controller
    // exception, sponsors approved: `seal_canister` leaves the canister
    // self-controlled and every external controller-only door in the interface
    // shuts the moment it returns.
    season = ok(await cast.warden.actor.create_season(), "create the season");
    ok(await env.seal(), "seal the canister");
  });

  after(async () => {
    await env?.teardown();
  });

  it("is sealed self-only before the first season", async () => {
    // The check a participant can make for themselves, and the reason the
    // canister does the sealing rather than a human doing it from a CLI: ask
    // the management canister who controls this one and the answer is exactly
    // the canister itself, with no external controller.
    assert.deepEqual(
      asText(await env.pic.getControllers(env.canisterId)),
      [env.canisterId.toText()],
      "a sealed canister is controlled only by itself",
    );

    // Every controller-only door in the interface, tried by the identity that
    // installed the canister. There is no season running yet, so nothing here
    // is a season rule — it is the seal, and it never lifts.
    assert.deepEqual(
      await env.actor.set_moderator(cast.deputy.handle, false, []),
      { err: { NotAllowed: null } },
      "who moderates was fixed before the seal and can never change again",
    );
    assert.deepEqual(
      await env.actor.set_config("Renamed", true),
      { err: "caller is not a controller" },
      "the site cannot be reconfigured",
    );
    assert.deepEqual(
      await env.actor.set_instruction_cap(1n),
      { err: "caller is not a controller" },
      "nor the instruction allowance widened",
    );
    assert.deepEqual(
      await env.actor.assets_upload({
        store: {
          key: "/index.html",
          contentType: "text/html",
          contentEncoding: "identity",
          chunks: 1n,
          content: new Uint8Array(8).fill(1),
        },
      }),
      { err: "caller is not a controller" },
      "and the frontend is whatever was uploaded before the seal, for good",
    );
    assert.deepEqual(
      await env.actor.seal_canister(),
      { err: "caller is not a controller" },
      "even sealing again is refused to the former controller",
    );

    // And with the keys goes the implicit moderator seat: `Profiles.canModerate`
    // reads `isController(caller) or user.moderator`, and the first half is
    // false for every principal alive. Same call, same argument, and only the
    // caller differs — the warden gets as far as looking the revision up.
    assert.deepEqual(
      await env.actor.approve_revision(0n),
      { err: { NotAllowed: null } },
      "the former controller has no implicit moderator role either",
    );
    assert.deepEqual(
      await cast.warden.actor.approve_revision(0n),
      { err: { NotFound: null } },
      "whereas a real moderator is refused by the id and not by the caller",
    );
    assert.deepEqual(
      await env.actor.create_season(),
      { err: { NotAllowed: null } },
      "and drafting a season is a moderator's business now, not a controller's",
    );
  });

  it("takes nothing at all while the season is still a draft", async () => {
    assert.equal(phaseOf(season), "draft");
    assert.equal(await env.live(), null);
    assert.equal(await env.actor.judges_frozen(), false);

    const counts = await env.actor.stats();
    assert.equal(
      Number(counts.users),
      30,
      "fifteen hackers, judges, the launch-ready moderator bench, sponsors, and lurkers",
    );
    assert.equal(Number(counts.hackers), 15);
    assert.equal(Number(counts.pending), 0, "nothing unresolved crossed the launch seal");

    assert.deepEqual(
      await H.alia.actor.submit_entry(
        entryInput({ title: "Too early", slug: slugFor("beacon"), pkg: H.alia.pkg }),
      ),
      { err: { Season: { NoSeason: null } } },
      "a draft season takes no entries (the Season section of the Rules page)",
    );
  });

  it("opens week one and lets the first hackers in", async () => {
    // A moderator presses this, because after the seal there is nobody else
    // who could. That is a limited protocol action and nothing more — the
    // warden gains no say over the code, the bracket or the prize money by
    // making it (agreement §3 on the Rules page).
    season = ok(await cast.warden.actor.start_season(season.id), "start the season");
    assert.equal(Number(season.week), 1);
    assert.equal(phaseOf(season), "running");
    assert.equal(await env.actor.judges_frozen(), true);
    assert.equal(await env.actor.clock_armed(), true);

    // `start_season` re-reads the controller list on every call rather than
    // trusting that somebody sealed it earlier, so a season that is running is
    // a season that was verified self-only at the moment it opened. Asked
    // again here, with entries about to go in: still no external controller. Nothing that
    // happens over the next six weeks can be rewritten by anyone.
    assert.deepEqual(
      asText(await env.pic.getControllers(env.canisterId)),
      [env.canisterId.toText()],
      "the season opened self-controlled and remains so",
    );

    // A settling second, so the week deadline sits inside a day rather than
    // exactly on the boundary: the canister reads a clock a few nanoseconds
    // ahead of the one the test advances, and a tie there is not the thing
    // under test.
    await env.advance(SECOND);

    await submit(H.alia, "beacon", {
      title: "Beacon",
      summary: "A lighthouse for your inbox.",
      icon: `/u/${H.alia.id}/icon/beacon.png`,
      shots: [`/u/${H.alia.id}/shots/1.png`, `/u/${H.alia.id}/shots/2.png`],
      links: [{ kind: "demo", url: "https://example.com/beacon/demo" }],
    });
    await submit(H.bex, "cinder", { title: "Cinder", summary: "Burns down your backlog." });
    await submit(H.coen, "drift", { title: "Drift", summary: "Notes that move with you." });
    await submit(H.dara, "ember", { title: "Ember", summary: "Small fires, kept alight." });
    await submit(H.eli, "flux", { title: "Flux", summary: "Change tracking for prose." });
    await submit(H.fen, "glint", { title: "Glint", summary: "Highlights, shared." });

    assert.equal(first(await H.alia.actor.my_entry()).title, "Beacon");
    assert.deepEqual(
      await cast.lurkerA.actor.submit_entry(
        entryInput({
          title: "An observer's idea",
          slug: slugFor("observer"),
          pkg: `/u/${cast.lurkerA.id}/pkg/1.neutron`,
        }),
      ),
      { err: { Season: { NotAHacker: null } } },
      "only hackers submit (the Build section of the Rules page)",
    );
    assert.deepEqual(
      await cast.lurkerA.actor.cast_vote(idOf("beacon")),
      { err: { NotAJudge: null } },
      "only approved judges vote (the Judging section of the Rules page)",
    );
  });

  it("runs all six rounds unattended, advancing one day at a time", async () => {
    for (let day = 1; day <= 30; day += 1) {
      const opening = await env.live();
      assert.ok(opening, `day ${day}: the season should still be running`);
      assert.equal(await env.actor.clock_armed(), true, `day ${day}: an open week is armed`);
      const due = first(await env.actor.week_ends_at());
      const weekBefore = Number(opening.week);

      await env.advance(DAY);

      // PocketIC produces rounds a second apart, so "the deadline has passed"
      // is a question about seconds, not nanoseconds.
      //
      // `getTime()` answers in milliseconds and is not always a whole one —
      // ticking advances by fractions — so it has to be rounded before it can
      // be a BigInt at all. `Math.floor` rather than `round`: the comparison
      // below adds a second of slack, and erring early would make a week look
      // closed before the canister thinks so.
      const now = BigInt(Math.floor(await env.pic.getTime())) * 1_000_000n;
      const passed = now + BigInt(SECOND) * 1_000_000n >= due;
      const running = await env.live();

      if (!passed) {
        assert.ok(running, `day ${day}: the season should still be running`);
        assert.equal(
          Number(running.week),
          weekBefore,
          `day ${day}: week ${weekBefore} moved on before its deadline`,
        );
        assert.equal(
          first(await env.actor.week_ends_at()),
          due,
          `day ${day}: the deadline moved without a week closing`,
        );
      } else if (weekBefore === 6) {
        assert.equal(running, null, `day ${day}: closing the final should finish the season`);
        closes.push(day);
      } else {
        assert.ok(running, `day ${day}: week ${weekBefore} should have closed into the next`);
        assert.equal(
          Number(running.week),
          weekBefore + 1,
          `day ${day}: week ${weekBefore} did not close on its deadline`,
        );
        // Rounds are not all the same length: the four qualifiers run a week
        // each, the semi-final and the final a day each (`Season.roundNanos`).
        // The deadline written at a close belongs to the round being *opened*,
        // so closing qualifier four opens a one-day semi-final rather than
        // extending the week that just ended.
        //
        // Note what this cannot show: every round here runs its full term, so
        // a deadline measured from the close and one computed from the season
        // start land within a second of each other and both fall inside the
        // window below. The suite at the bottom of the file closes a week
        // late, which is the only way to tell the Judging section of the Rules page's stored deadline
        // from a derived one.
        //
        // A window either side of the figure, not a hard ceiling. `now` is a
        // floored millisecond read from the test's clock while `weekEndsAt` is
        // a nanosecond stamped inside the canister, so the difference overshoots
        // by whatever sub-millisecond remainder was thrown away — plus a few
        // hundred nanoseconds of the messages the close itself costs. Asserting
        // an exact length made the test fail the moment `start_season` grew an
        // inter-canister call to check the seal, which says nothing about the
        // schedule.
        const opened = weekBefore + 1;
        const term = opened <= QUALIFIERS ? 604_800_000_000_000n : 86_400_000_000_000n;
        const next = first(await env.actor.week_ends_at()) - now;
        const SLACK = 2_000_000_000n; // two seconds, in nanoseconds
        assert.ok(
          next > term - SLACK && next < term + SLACK,
          `day ${day}: round ${opened} was given ${next}ns rather than ${term}ns`,
        );
        closes.push(day);
      }

      await (script[day] ?? (async () => {}))();
    }

    assert.deepEqual(
      closes,
      [7, 14, 21, 28, 29, 30],
      "four qualifier weeks and then a day each for the semi-final and the final",
    );
  });

  it("finishes into a season nothing is armed for", async () => {
    assert.equal(await env.live(), null);
    const [row] = await env.actor.season_by_number(1n);
    assert.equal(phaseOf(row), "finished");
    assert.equal(Number(row.week), 6, "the season rests on the round it ended in");
    assert.ok(row.endedAt > row.startedAt);
    assert.equal(row.weekEndsAt, 0n, "and holds no deadline it can be pressed on");
    assert.equal(await env.actor.clock_armed(), false);
    assert.deepEqual(await env.actor.week_ends_at(), []);
    assert.equal(await env.actor.judges_frozen(), true, "the recorded judges remain frozen for good");

    // "finished — everything decided and immutable" (the Season section of the Rules page).
    assert.deepEqual(
      await H.alia.actor.submit_entry(
        entryInput({ title: "After the whistle", slug: slugFor("beacon"), pkg: H.alia.pkg }),
      ),
      { err: { Season: { NoSeason: null } } },
    );
    assert.deepEqual(await J.a.actor.cast_vote(idOf("nomad@6")), { err: { NoSeason: null } });
    assert.deepEqual(await J.a.actor.withdraw_vote(idOf("nomad@6")), { err: { NoSeason: null } });
    assert.deepEqual(
      await H.mo.actor.publish_update(0n, {
        version: "2.0.0",
        note: "After the fact.",
        pkg: [],
      }),
      { err: { Season: { NoSeason: null } } },
    );
  });

  it("keeps every week's votes attached to that week", async () => {
    // Nothing cast in week 5 or 6 leaked backwards, and nothing that was cast
    // in a qualifier moved when the project was carried forward.
    for (const weekNo of [1, 2, 3, 4, 5, 6]) {
      for (const row of await weekRows(weekNo)) {
        assert.equal(
          row.votes,
          BigInt(tally.get(row.id)),
          `${nameOf(row)} in week ${weekNo} holds the wrong tally after the season`,
        );
        assert.equal(Number(row.week), weekNo);
      }
    }

    // The same hacker, two projects, one season: week 1's four votes stayed
    // with week 1's entry and week 2's one vote with week 2's.
    const beacon = (await weekRows(1)).find((row) => nameOf(row) === "beacon");
    const beaconTwo = (await weekRows(2)).find((row) => nameOf(row) === "beacon_two");
    assert.equal(beacon.votes, 4n);
    assert.equal(beaconTwo.votes, 1n);
    assert.equal(beacon.user_id, beaconTwo.user_id);
  });

  it("pairs the semi-final by origin week rather than by position", async () => {
    const semi = await weekRows(5);
    const advanced = semi.filter((row) => outcomeOf(row) === "advanced");
    assert.equal(advanced.length, 2, "one survivor from each duel (the bracket section of the Rules page)");

    // Duel A is weeks 1 and 2, duel B is weeks 3 and 4. Walking each survivor
    // back to the qualifier it came from is what proves the split held: the
    // global top two here were Beacon (5) and Kite (4), both out of duel A.
    const originWeek = async (row) => {
      const [origin] = await env.actor.entry_detail(first(row.origin_id));
      return Number(origin.entry.week);
    };
    const halves = await Promise.all(advanced.map(originWeek));
    assert.deepEqual(halves.sort(), [1, 3]);

    const kite = semi.find((row) => nameOf(row) === "kite@5");
    assert.equal(kite.votes, 4n);
    assert.equal(
      outcomeOf(kite),
      "none",
      "second across the whole week is nothing if the first is on your side of the bracket",
    );
    const nomad = semi.find((row) => nameOf(row) === "nomad@5");
    assert.equal(nomad.votes, 2n);
    assert.equal(outcomeOf(nomad), "advanced", "duel B is won on duel B's votes");
  });

  it("puts the two duel survivors in the final and crowns one of them", async () => {
    const final = await weekRows(6);
    assert.equal(final.length, 2);
    assert.deepEqual(final.map(nameOf), ["nomad@6", "beacon@6"]);
    assert.deepEqual(await marks(6), { "nomad@6": "won", "beacon@6": "none" });

    let won = 0;
    for (const weekNo of [1, 2, 3, 4, 5, 6]) {
      won += (await weekRows(weekNo)).filter((row) => outcomeOf(row) === "won").length;
    }
    assert.equal(won, 1, "one grand prize in a season");
  });

  it("carries a project forward intact, pointing back at where it came from", async () => {
    const qualifier = (await weekRows(3)).find((row) => nameOf(row) === "nomad");
    const semi = (await weekRows(5)).find((row) => nameOf(row) === "nomad@5");
    const final = (await weekRows(6)).find((row) => nameOf(row) === "nomad@6");

    for (const [round, carried, origin] of [
      ["semi-final", semi, qualifier],
      ["final", final, semi],
    ]) {
      assert.equal(first(carried.origin_id), origin.id, `the ${round} row should name its origin`);
      assert.equal(carried.user_id, origin.user_id);
      for (const field of ["title", "summary", "url", "icon", "shots", "links", "pkg", "updates"]) {
        assert.deepEqual(
          carried[field],
          origin[field],
          `${field} did not survive the carry into the ${round}`,
        );
      }
    }

    // The whole chain: the winner of the final started life in week 3.
    assert.equal(first(qualifier.origin_id), null, "a submitted entry has no origin");
    assert.equal(first(semi.pkg).name, `${semi.slug}.neutron`, "the build travelled with it");
    assert.equal(first(final.pkg).name, `${final.slug}.neutron`);

    // And the same for the other finalist, whose art was edited mid-week 1.
    const beacon = (await weekRows(1)).find((row) => nameOf(row) === "beacon");
    const beaconSix = (await weekRows(6)).find((row) => nameOf(row) === "beacon@6");
    assert.equal(beacon.shots.length, 3);
    assert.deepEqual(beaconSix.shots, beacon.shots);
    assert.deepEqual(beaconSix.icon, beacon.icon);
    assert.deepEqual(beaconSix.links, beacon.links);
    assert.equal(first(beaconSix.pkg).name, `${beaconSix.slug}.neutron`);
  });

  it("shows every reader the same order it closed the week on", async () => {
    // the bracket section of the Rules page: the bracket, the voting queue and `closeWeek` all read one
    // ranking. Week 1 is the sharp case — four entries tied on a single vote.
    const raw = (await weekRows(1)).map(nameOf);
    const view = await env.actor.season_week_view(season.id, 1n, 500n);
    const [firstWeek] = await env.actor.season_map(season.id, 50n);
    assert.deepEqual(view.map((row) => names.get(row.entry.id)), raw);
    assert.deepEqual(firstWeek.entries.map((row) => names.get(row.entry.id)), raw);

    // The same week seen by two different people.
    const asJudge = await J.a.actor.season_week_view(season.id, 1n, 500n);
    assert.deepEqual(
      asJudge.filter((row) => row.voted).map((row) => names.get(row.entry.id)).sort(),
      ["beacon", "flux"],
      "judge_a's week-one ballot, as the voting queue draws it",
    );
    const beaconToJudge = asJudge.find((row) => names.get(row.entry.id) === "beacon");
    assert.equal(beaconToJudge.handle, H.alia.handle);
    assert.equal(beaconToJudge.mine, false);

    const asAuthor = await H.alia.actor.season_week_view(season.id, 1n, 500n);
    assert.equal(asAuthor.find((row) => names.get(row.entry.id) === "beacon").mine, true);
    assert.equal(asAuthor.find((row) => names.get(row.entry.id) === "beacon").voted, false);
  });

  it("draws all six weeks with their true totals", async () => {
    const map = await env.actor.season_map(season.id, 12n);
    assert.deepEqual(
      map.map((weekView) => [Number(weekView.week), Number(weekView.total)]),
      [
        [1, 9],
        [2, 6],
        [3, 4],
        [4, 3],
        [5, 4],
        [6, 2],
      ],
    );

    // A hacker's record across the season: two projects entered, one of them
    // carried twice.
    const history = await env.actor.user_entries(H.alia.handle, 100n);
    assert.deepEqual(
      history.map((row) => Number(row.week)).sort(),
      [1, 2, 5, 6],
      "the week-1 project appears once per round it reached",
    );
  });

  it("is still self-only when it is all over, and the former deployer cannot upgrade it", async () => {
    // Nothing about the end of a season loosens the seal, because the seal was
    // never a season's to hold: external controllers were removed before any
    // of this. A day later, the answer is the same one.
    await env.advance(DAY + MINUTE);
    assert.deepEqual(
      asText(await env.pic.getControllers(env.canisterId)),
      [env.canisterId.toText()],
      "a finished season does not restore an external controller",
    );
    assert.deepEqual(
      await env.actor.set_moderator(cast.deputy.handle, false, []),
      { err: { NotAllowed: null } },
      "and the identity that installed it has no more say than it had mid-season",
    );

    // The sharp end of it. `install_code` is a controller's call, so the
    // replica refuses this outright — the record of these six weeks, and the
    // code that produced it, are now the same permanent thing. This is the
    // assertion that would break first if the seal ever became conditional.
    await assert.rejects(
      env.upgrade(),
      () => true,
      "the former deployer cannot upgrade the sealed canister",
    );
    assert.deepEqual(
      asText(await env.pic.getControllers(env.canisterId)),
      [env.canisterId.toText()],
      "and the refused attempt changed nothing",
    );
    const [row] = await env.actor.season_by_number(1n);
    assert.equal(phaseOf(row), "finished", "the season is where the refused upgrade left it");
  });
});

describe("a season with a week nobody entered", () => {
  let env;
  let season;
  const H = {};
  const J = {};

  const weekRows = async (weekNo) => env.actor.season_week(season.id, BigInt(weekNo), 500n);
  const submit = async (who, title) => {
    const pkg = await freshPackageFor(who);
    return submitEntry(
      env,
      who,
      entryInput({ title, slug: slugFor(title), pkg }),
      `submit ${title}`,
    );
  };

  before(async () => {
    env = await bootstrap({ controller: identity(1000) });
    for (const [name, n] of [
      ["una", 1060],
      ["vic", 1061],
      ["wren", 1062],
      ["yara", 1063],
    ]) {
      H[name] = await join(env, n, `hacker_${name}`, { hacker: true });
    }
    for (const [name, n] of [
      ["a", 1070],
      ["b", 1071],
    ]) {
      J[name] = await join(env, n, `judge_${name}`, { judge: true });
      ok(await env.actor.set_judge(J[name].handle, { approved: null }, []), "approve");
    }
    // Somebody has to be able to approve an entry once the canister is sealed,
    // and only a controller can appoint them — so this is the last moment
    // there will ever be to do it. It is also the only way a season gets
    // started at all: `start_season` is this warden's call from here on.
    const warden = await seatModerator(env, 1065, "warden");
    env.mod = warden.actor;
    season = ok(await warden.actor.create_season(), "create");
    ok(await env.seal(), "seal");
    season = ok(await warden.actor.start_season(season.id), "start");
  });

  after(async () => {
    await env?.teardown();
  });

  it("sends nobody forward from the week nobody entered", async () => {
    // Week 1: Una beats Vic.
    const alpha = await submit(H.una, "Alpha");
    await submit(H.vic, "Bravo");
    ok(await J.a.actor.cast_vote(alpha.id), "vote");
    ok(await J.b.actor.cast_vote(alpha.id), "vote");
    await closeInto(env, 2);

    // Week 2: nothing at all.
    assert.equal((await weekRows(2)).length, 0);
    await closeInto(env, 3);

    // Week 3 ties at the top, so the earlier submission takes it (the bracket section of the Rules page).
    const charlie = await submit(H.wren, "Charlie");
    const delta = await submit(H.yara, "Delta");
    ok(await J.a.actor.cast_vote(charlie.id), "vote");
    ok(await J.b.actor.cast_vote(delta.id), "vote");
    await closeInto(env, 4);
    assert.deepEqual(
      (await weekRows(3)).map((row) => [row.title, Number(row.votes), outcomeOf(row)]),
      [
        ["Charlie", 1, "advanced"],
        ["Delta", 1, "rewarded"],
      ],
      "on equal votes the earlier submission advances",
    );

    // Week 4: Yara alone, and nobody votes at all.
    await submit(H.yara, "Echo");
    await closeInto(env, 5);

    const semi = await weekRows(5);
    assert.deepEqual(
      semi.map((row) => row.title).sort(),
      ["Alpha", "Charlie", "Echo"],
      "three qualifier winners, and the empty week sends nobody (the bracket section of the Rules page)",
    );
    assert.equal(
      semi.some((row) => row.title === "Bravo"),
      false,
      "week 1's runner-up is not pulled up to fill week 2's place",
    );
  });

  it("walks a lone duel entrant over on no votes at all", async () => {
    // Duel B gets every vote cast in the semi; duel A has only Alpha in it.
    const semi = await weekRows(5);
    const echo = semi.find((row) => row.title === "Echo");
    const charlie = semi.find((row) => row.title === "Charlie");
    ok(await J.a.actor.cast_vote(echo.id), "vote");
    ok(await J.a.actor.cast_vote(charlie.id), "vote");
    ok(await J.b.actor.cast_vote(echo.id), "vote");
    await closeInto(env, 6);

    const closed = await weekRows(5);
    const alpha = closed.find((row) => row.title === "Alpha");
    assert.equal(alpha.votes, 0n);
    assert.equal(
      outcomeOf(alpha),
      "advanced",
      "the only entry in a duel is carried forward unopposed, votes or none (the bracket section of the Rules page)",
    );
    assert.equal(outcomeOf(closed.find((row) => row.title === "Echo")), "advanced");
    assert.equal(
      outcomeOf(charlie),
      "none",
      "the split is by origin week: Charlie lost duel B despite beating Alpha",
    );

    const final = await weekRows(6);
    assert.deepEqual(final.map((row) => row.title).sort(), ["Alpha", "Echo"]);
  });

  it("still hands the grand prize to exactly one entry", async () => {
    const final = await weekRows(6);
    const alpha = final.find((row) => row.title === "Alpha");
    ok(await J.a.actor.cast_vote(alpha.id), "vote");
    // The last week of a season closes into `#finished` rather than into a
    // seventh, so this one is checked on the phase instead of the week number.
    assert.equal(phaseOf(await closeWeek(env)), "finished", "the final closes the season");

    const closed = await weekRows(6);
    assert.deepEqual(
      closed.map((row) => [row.title, outcomeOf(row)]),
      [
        ["Alpha", "won"],
        ["Echo", "none"],
      ],
      "a walkover finalist can take the gold",
    );
    assert.equal(await env.live(), null, "and the season is over");
  });
});

describe("a hacker who wins two qualifier weeks", () => {
  let env;
  let season;
  const H = {};
  const J = {};

  const weekRows = async (weekNo) => env.actor.season_week(season.id, BigInt(weekNo), 500n);
  const submit = async (who, title) => {
    const pkg = await freshPackageFor(who);
    return submitEntry(
      env,
      who,
      entryInput({ title, slug: slugFor(title), pkg }),
      `submit ${title}`,
    );
  };

  before(async () => {
    env = await bootstrap({ controller: identity(1000) });
    for (const [name, n] of [
      ["zed", 1080],
      ["ash", 1081],
      ["brin", 1082],
      ["cyd", 1083],
    ]) {
      H[name] = await join(env, n, `hacker_${name}`, { hacker: true });
    }
    for (const [name, n] of [
      ["a", 1090],
      ["b", 1091],
    ]) {
      J[name] = await join(env, n, `judge_${name}`, { judge: true });
      ok(await env.actor.set_judge(J[name].handle, { approved: null }, []), "approve");
    }
    // The reviewer for the whole run below, appointed while there is still a
    // controller to appoint one: after the seal `env.actor` can approve
    // nothing, draft nothing and start nothing.
    const warden = await seatModerator(env, 1085, "warden");
    env.mod = warden.actor;
    season = ok(await warden.actor.create_season(), "create");
    ok(await env.seal(), "seal");
    season = ok(await warden.actor.start_season(season.id), "start");

    // Zed wins week 1 and week 3. Ash takes week 2, Cyd takes week 4, so all
    // four qualifiers have a winner and the bracket should be full.
    const one = await submit(H.zed, "One");
    await submit(H.ash, "Two");
    ok(await J.a.actor.cast_vote(one.id), "vote");
    await closeInto(env, 2);

    await submit(H.ash, "Three");
    await closeInto(env, 3);

    // A second project from the same hacker, so a second app id: an id belongs
    // to an app for good, and reusing `app_one` here would enter One again.
    const four = await submit(H.zed, "Four");
    await submit(H.brin, "Five");
    ok(await J.a.actor.cast_vote(four.id), "vote");
    await closeInto(env, 4);

    await submit(H.cyd, "Six");
    await closeInto(env, 5);
  });

  after(async () => {
    await env?.teardown();
  });

  it("marks the second win as advanced", async () => {
    const week3 = await weekRows(3);
    const four = week3.find((row) => row.title === "Four");
    assert.equal(four.votes, 1n);
    assert.equal(outcomeOf(four), "advanced", "top of a qualifier advances (the bracket section of the Rules page)");
  });

  it("carries the second win as well, so duel B keeps the entrant it had", async () => {
    const four = (await weekRows(3)).find((row) => row.title === "Four");
    const semi = await weekRows(5);

    // `Season.carry` refuses to carry the same row twice, so that a second
    // close of one week — which `closeDueWeek` retries five minutes after a
    // failure — cannot duplicate a seat. The guard is keyed on the *origin
    // row* rather than on the hacker: keyed on the hacker it also swallowed
    // the second, legitimate carry of somebody who won two qualifiers, and
    // the bracket section of the Rules page says the top entry of every qualifier is "additionally
    // marked advanced and carried into week 5". Weeks 3 and 4 both produced a
    // winner, so duel B is a duel and not a walkover.
    assert.ok(
      semi.some((row) => first(row.origin_id) === four.id),
      `week 3's winner is marked advanced but no week-5 entry names it; the semi holds ${JSON.stringify(
        semi.map((row) => row.title),
      )}`,
    );

    const originWeek = async (row) => {
      const [origin] = await env.actor.entry_detail(first(row.origin_id));
      return Number(origin.entry.week);
    };
    assert.deepEqual(
      (await Promise.all(semi.map(originWeek))).sort(),
      [1, 2, 3, 4],
      "every qualifier that had a winner should be represented in the semi-final",
    );
  });
});

/**
 * The order the whole arrangement rests on.
 *
 * Everything above starts its season on a canister that was already sealed, so
 * none of it can show what happens to one that is not. `start_season` reads
 * the controller list on every call and refuses while anybody is on it — which
 * is the load-bearing check: a season begun with a controller still holding
 * the keys is a season whose rules could be rewritten halfway through, and
 * from outside it would look exactly like one that could not.
 *
 * Checked rather than remembered, too. A canister that believed it was sealed
 * because a deployment script said so would pass a stored flag and fail the
 * only question a participant can actually ask the replica.
 */
describe("a season that will not start until the keys are gone", () => {
  let env;
  let warden;
  let draft;

  before(async () => {
    env = await bootstrap({ controller: identity(1200) });
    warden = await seatModerator(env, 1201, "warden");
    draft = ok(await warden.actor.create_season(), "create");
  });

  after(async () => {
    await env?.teardown();
  });

  it("refuses to open before the list is exactly self-only", async () => {
    // The fixture's controller and the canister itself, which is what a
    // deployment looks like the moment before it is sealed.
    assert.equal(
      (await env.pic.getControllers(env.canisterId)).length,
      2,
      "the fixture has not sealed yet, so somebody still holds the keys",
    );

    const refused = await warden.actor.start_season(draft.id);
    assert.ok("err" in refused, `a season opened on an unsealed canister: ${JSON.stringify(refused)}`);
    assert.ok(
      "Invalid" in refused.err && refused.err.Invalid.includes("seal_canister"),
      `the refusal should name the way forward: ${JSON.stringify(refused.err)}`,
    );
    const [row] = await env.actor.season_by_number(1n);
    assert.equal(phaseOf(row), "draft", "the draft it refused is exactly where it was");
    assert.equal(await env.live(), null, "and nothing is running");
    assert.equal(await env.actor.clock_armed(), false, "and no clock was armed by the attempt");
  });

  it("opens the same draft once the list is exactly self-only", async () => {
    ok(await env.seal(), "seal");
    assert.deepEqual(
      asText(await env.pic.getControllers(env.canisterId)),
      [env.canisterId.toText()],
      "only the canister itself holds the controller key now",
    );

    const started = ok(await warden.actor.start_season(draft.id), "start");
    assert.equal(Number(started.week), 1, "the same draft, opened on the second attempt");
    assert.equal(phaseOf(started), "running");
    assert.equal(await env.actor.clock_armed(), true);

    // The controller that installed it never regains anything by the season
    // running or by it ending; it lost everything at the seal, one call ago.
    assert.deepEqual(
      await env.actor.start_season(draft.id),
      { err: { NotAllowed: null } },
      "and the identity that installed the canister could not have pressed it",
    );
  });
});

/**
 * The one thing thirty orderly days cannot show.
 *
 * the Judging section of the Rules page says the deadline is **stored on the season and reset whenever a
 * week closes**, "rather than computed from the season start". Every round in
 * the suite above runs its full term, and a round that does puts the two
 * schemes within a second of each other — so nothing up there distinguishes
 * them.
 *
 * A week used to be cut short here to separate them — the controller closed
 * week one on day two, and the next deadline could then only be day nine or
 * day fourteen. `close_week` is gone: the calendar is the same for everybody
 * and is nobody's to nudge, so the separation is made from the other side
 * instead. The replica produces no rounds for ten days, which is what a
 * canister stopped or upgrading through its own deadline looks like, and the
 * close lands three days late. A stored deadline reset at the close puts week
 * two seven days after the moment it really closed; one computed from the
 * season start would still say day fourteen — three days earlier, and already
 * behind us by the time the second test below looks.
 */
describe("a week closed late takes the calendar with it", () => {
  let env;
  let openedAt;

  before(async () => {
    env = await bootstrap({ controller: identity(1100) });
    // No entries are submitted here, so no moderator would be needed for
    // review — but one is needed anyway, because nothing but a moderator can
    // draft or start a season on a sealed canister, and nothing but a
    // controller can appoint a moderator before it is sealed.
    const warden = await seatModerator(env, 1101, "warden");
    const draft = ok(await warden.actor.create_season(), "create");
    ok(await env.seal(), "seal");
    ok(await warden.actor.start_season(draft.id), "start");
    openedAt = first(await env.actor.week_ends_at());
  });

  after(async () => {
    await env?.teardown();
  });

  it("resets the deadline from the close rather than the season start", async () => {
    // `advanceTime` moves the clock and makes no round, so ten days pass with
    // nothing running: the day-seven deadline goes by unnoticed and the timer
    // only gets to fire when the replica next ticks.
    await env.pic.advanceTime(10 * DAY);
    const closedAt = BigInt(await env.pic.getTime()) * 1_000_000n;
    await env.pic.tick(5);
    assert.equal(
      Number((await env.live()).week),
      2,
      "a deadline that passed while nothing was running is closed at the first opportunity",
    );

    const next = first(await env.actor.week_ends_at());
    const WEEK_NS = 604_800_000_000_000n;
    const DAY_NS = 86_400_000_000_000n;

    // A schedule derived from the season start would still say day 14, three
    // days short of where a close-relative one lands.
    assert.ok(
      next > openedAt + WEEK_NS + 2n * DAY_NS,
      `week two snapped back to a season-start schedule: ${next} rather than about ${closedAt + WEEK_NS}`,
    );
    // What it should say is seven days from the moment of the close. That
    // moment is somewhere inside the handful of rounds `tick` just produced,
    // and PocketIC spaces those a second apart, so this is a window and not an
    // equality — a narrow one beside the three days it is telling apart.
    const span = next - closedAt;
    assert.ok(
      span >= WEEK_NS && span < WEEK_NS + 60_000_000_000n,
      `week two was given ${span}ns from the close rather than seven days`,
    );
    assert.equal(await env.actor.clock_armed(), true, "and the close re-arms the clock");
  });

  it("then closes the shifted week on its own deadline, three days behind the old calendar", async () => {
    const due = first(await env.actor.week_ends_at());
    const dueMs = Number(due / 1_000_000n);

    // A minute short of the deadline the late close set — nothing yet. Day
    // fourteen, where the original calendar put the end of week two, is three
    // days behind us by now, so a season-start schedule would have closed this
    // week already.
    await env.advance(dueMs - (await env.pic.getTime()) - MINUTE);
    assert.equal(Number((await env.live()).week), 2, "week two is not over until its own deadline");

    // A minute past it, and the timer that was re-armed by the close fires.
    await env.advance(2 * MINUTE);
    assert.equal(
      Number((await env.live()).week),
      3,
      "the timer follows the deadline the late close stored, not the original calendar",
    );

    // Seventeen days into a season whose fourteenth day is long gone.
    const elapsed = BigInt(await env.pic.getTime()) * 1_000_000n - (openedAt - 604_800_000_000_000n);
    assert.ok(
      elapsed > 16n * 86_400_000_000_000n && elapsed < 18n * 86_400_000_000_000n,
      `two weeks resolved in ${elapsed}ns, which is not the seventeen days a late close should have taken`,
    );
  });
});
