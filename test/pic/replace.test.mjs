/**
 * When somebody replaces a file, does the old one actually go away?
 *
 * There are two ways to replace a file here, and only one of them was ever
 * handled. Uploading to the **same key** overwrites: `Assets.upload` frees the
 * old slot before it writes, and `churn.test.mjs` proves that holds under
 * repetition. Pointing a row at a **different key** is the other way, and it is
 * the one the UI actually takes — an avatar is written to a fresh timestamped
 * key every time, and a hacker swapping `icon/a.png` for `icon/b.png` is
 * choosing a new name, not overwriting an old one.
 *
 * Nothing noticed the second kind. The row stopped pointing at the old file and
 * the asset store kept serving it, because the store answers by key and has no
 * idea an entry or a profile exists. The file stayed online to anyone who had
 * the link, and stayed charged to its author, for ever.
 *
 * So these check the thing that is easy to get wrong and invisible when you do:
 * not that the new file is served — that never broke — but that the old one has
 * genuinely stopped being served, and that its bytes came back off the tally.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { bootstrap, hacker, identity, ok, register } from "./harness.mjs";

const store = (key, size, contentType = "image/png") => ({
  store: {
    key,
    contentType,
    contentEncoding: "identity",
    chunks: 1n,
    content: new Uint8Array(size),
  },
});

/** Is the canister still serving this key? */
async function served(env, key) {
  const res = await env.actor.http_request({
    url: key,
    method: "GET",
    body: new Uint8Array(),
    headers: [],
    certificate_version: [],
  });
  return res.status_code === 200;
}

const bytesOf = async (who) => Number((await who.me())[0].bytes);
const SMALL_SLOT_BYTES = 2 * 65_536;

describe("replacing a file at a different key", () => {
  let env, who, id, mod;

  before(async () => {
    env = await bootstrap();
    // A moderator, appointed before any season: approving is what applies an
    // entry, and a sealed season leaves the controller unable to do it.
    mod = await register(env.as, identity(8801), "swap_mod");
    ok(await env.actor.set_moderator("swap_mod", true, []), "appoint");
    who = await hacker(env, 8800, "swapper");
    id = (await who.me())[0].id;
  });
  after(async () => await env?.teardown());

  it("deletes the avatar it replaced", async () => {
    const first = `/u/${id}/avatar/1000.png`;
    const second = `/u/${id}/avatar/2000.png`;

    ok(await who.my_upload(store(first, 4_000)), "upload the first");
    ok(await who.set_avatar([first]), "wear it");
    assert.equal(await served(env, first), true);
    const withOne = await bytesOf(who);

    ok(await who.my_upload(store(second, 4_000)), "upload a replacement");
    ok(await who.set_avatar([second]), "wear the replacement");

    assert.equal(await served(env, second), true, "the new picture is served");
    assert.equal(await served(env, first), false, "and the old one is not");
    assert.equal(
      await bytesOf(who),
      withOne,
      "two uploads and one deletion should net out to one picture's worth",
    );
  });

  it("deletes the avatar when it is taken off entirely", async () => {
    const only = `/u/${id}/avatar/3000.png`;
    ok(await who.my_upload(store(only, 2_000)));
    ok(await who.set_avatar([only]));
    ok(await who.set_avatar([]), "no picture at all");
    assert.equal(await served(env, only), false);
  });

  it("deletes an icon and a screenshot an approved edit dropped", async () => {
    // The complete draft comes before the irreversible seal; a moderator then
    // starts it after `seal_canister` has removed every controller.
    const draft = ok(await mod.create_season(), "create");
    ok(await env.seal(), "seal the canister");
    ok(await mod.start_season(draft.id), "start");

    const iconA = `/u/${id}/icon/a.png`;
    const shotA = `/u/${id}/shots/a.png`;
    const pkgA = `/u/${id}/pkg/1.neutron`;
    for (const [key, size, type] of [
      [iconA, 3_000, "image/png"],
      [shotA, 5_000, "image/png"],
      [pkgA, 7_000, "application/octet-stream"],
    ]) {
      ok(await who.my_upload(store(key, size, type)), `upload ${key}`);
    }

    const entry = {
      title: "Swap",
      summary: "",
      url: "",
      icon: [iconA],
      shots: [shotA],
      links: [],
      pkg: { key: pkgA },
      slug: "swapper_app",
    };
    const first = ok(await who.submit_entry(entry), "submit");
    ok(await mod.approve_revision(first.id), "approve");

    // A second set of art, at new keys — which is what the form does when
    // somebody picks different files.
    const iconB = `/u/${id}/icon/b.png`;
    const shotB = `/u/${id}/shots/b.png`;
    const pkgB = `/u/${id}/pkg/2.neutron`;
    for (const [key, size, type] of [
      [iconB, 3_000, "image/png"],
      [shotB, 5_000, "image/png"],
      [pkgB, 7_000, "application/octet-stream"],
    ]) {
      ok(await who.my_upload(store(key, size, type)), `upload ${key}`);
    }

    const edit = ok(
      await who.submit_entry({ ...entry, icon: [iconB], shots: [shotB], pkg: { key: pkgB } }),
      "edit",
    );

    // Still all six on disk: the proposal has not been applied yet, and until
    // it is the entry still points at the first three.
    for (const key of [iconA, shotA, pkgA]) {
      assert.equal(await served(env, key), true, `${key} before approval`);
    }

    ok(await mod.approve_revision(edit.id), "approve the edit");

    for (const key of [iconB, shotB, pkgB]) {
      assert.equal(await served(env, key), true, `${key} should be the live one`);
    }
    for (const key of [iconA, shotA, pkgA]) {
      assert.equal(await served(env, key), false, `${key} was replaced and should be gone`);
    }
  });

  it("gives the bytes back, so a swap does not spend the allowance twice", async () => {
    // The tally is what freezes an account, so a replacement that kept charging
    // for the file it replaced would eat somebody's season a picture at a time.
    const before = await bytesOf(who);
    const key = `/u/${id}/shots/c.png`;
    const next = `/u/${id}/shots/d.png`;

    ok(await who.my_upload(store(key, 6_000)));
    assert.equal(
      await bytesOf(who),
      before + SMALL_SLOT_BYTES,
      "an upload is charged for its allocator slot",
    );

    ok(await who.my_upload({ delete: { key } }));
    assert.equal(await bytesOf(who), before, "and a delete gives it back");

    // The same key twice is the other kind of replacement, and it must not
    // double-charge either.
    ok(await who.my_upload(store(next, 6_000)));
    ok(await who.my_upload(store(next, 6_000)));
    assert.equal(
      await bytesOf(who),
      before + SMALL_SLOT_BYTES,
      "overwriting is not a second slot",
    );
  });

  it("keeps a file a settled round was judged on, even when replaced", async () => {
    // the Build section of the Rules page: a closed week's record includes the art it was judged on.
    // The row's pointer may move; the file it was judged on stays.
    const [live] = await env.actor.season();
    const [mine] = await who.my_entry();
    assert.ok(mine, "there is an entry to freeze");
    const judged = mine.icon[0];
    assert.ok(judged, "and it has an icon");

    for (let week = Number(live.week); week <= 6; week += 1) {
      const [still] = await env.actor.season();
      if (!still) break;
      await env.advance(7 * 24 * 60 * 60 * 1000 + 1000);
    }

    assert.equal(
      await served(env, judged),
      true,
      "the art a closed week was judged on is part of that record",
    );
  });
});

describe("taking an app's content down", () => {
  let env, who, id, survivor, survivorId, mod, mod2;

  before(async () => {
    env = await bootstrap();
    mod = await register(env.as, identity(8811), "down_mod");
    ok(await env.actor.set_moderator("down_mod", true, []), "appoint");
    // Two, because a takedown deletes files nobody can recover — one moderator
    // acting alone must not be able to erase an entry from a competition.
    mod2 = await register(env.as, identity(8812), "down_mod_two");
    ok(await env.actor.set_moderator("down_mod_two", true, []), "appoint a second");
    who = await hacker(env, 8810, "taker");
    id = (await who.me())[0].id;
    survivor = await hacker(env, 8813, "down_survivor");
    survivorId = (await survivor.me())[0].id;

    const draft = ok(await mod.create_season(), "create");
    ok(await env.seal(), "seal");
    ok(await mod.start_season(draft.id), "start");
  });
  after(async () => await env?.teardown());

  it("needs two moderators, and says so after the first", async () => {
    const archiveIcon = `/u/${id}/icon/a.png`;
    const targetIcon = `/u/${id}/icon/b.png`;
    const shot = `/u/${id}/shots/a.png`;
    const archivePkg = `/u/${id}/pkg/0.neutron`;
    const pkg = `/u/${id}/pkg/1.neutron`;
    const stalePendingIcon = `/u/${id}/icon/c.png`;
    const stalePendingPkg = `/u/${id}/pkg/2.neutron`;
    const pendingPkg = `/u/${id}/pkg/3.neutron`;
    for (const [key, size, type] of [
      [archiveIcon, 3_000, "image/png"],
      [targetIcon, 3_000, "image/png"],
      [shot, 5_000, "image/png"],
      [archivePkg, 6_000, "application/octet-stream"],
      [pkg, 7_000, "application/octet-stream"],
      [stalePendingIcon, 3_000, "image/png"],
      [stalePendingPkg, 8_000, "application/octet-stream"],
      [pendingPkg, 9_000, "application/octet-stream"],
    ]) {
      ok(await who.my_upload(store(key, size, type)), `upload ${key}`);
    }
    const archiveProposal = ok(
      await who.submit_entry({
        title: "Archive",
        summary: "",
        url: "",
        icon: [archiveIcon],
        shots: [],
        links: [],
        pkg: { key: archivePkg },
        slug: "archive_app",
      }),
      "submit unrelated archive",
    );
    ok(await mod.approve_revision(archiveProposal.id), "approve archive");
    const [archive] = await who.my_entry();

    // Exact keys belong to one app lineage. Otherwise a takedown could either
    // leave prohibited bytes online for the other app or break that app while
    // claiming to remove only this one.
    await env.advance(7 * 24 * 60 * 60 * 1000 + 1000);
    const shared = await who.submit_entry({
      title: "Borrowed",
      summary: "",
      url: "",
      icon: [archiveIcon],
      shots: [shot],
      links: [],
      pkg: { key: pkg },
      slug: "borrowed_app",
    });
    assert.ok(
      "err" in shared,
      "a separate app cannot claim an exact asset key already published by the archive",
    );

    const firstTarget = ok(await who.submit_entry({
      title: "Borrowed",
      summary: "",
      url: "",
      icon: [targetIcon],
      shots: [shot],
      links: [],
      pkg: { key: pkg },
      slug: "borrowed_app",
    }), "submit target in week two");
    ok(await mod.approve_revision(firstTarget.id), "approve week two target");
    const [weekTwo] = await who.my_entry();

    const staleQueued = ok(await who.submit_entry({
      title: "Borrowed stale edit",
      summary: "waiting from week two",
      url: "",
      icon: [stalePendingIcon],
      shots: [],
      links: [],
      pkg: { key: stalePendingPkg },
      slug: weekTwo.slug,
    }), "queue an edit in week two");

    // A second qualifier copy shares the target lineage and all its published
    // pointers. Both copies must be stripped by one terminal takedown.
    await env.advance(7 * 24 * 60 * 60 * 1000 + 1000);
    const repeated = ok(await who.submit_entry({
      title: "Borrowed",
      summary: "",
      url: "",
      icon: [targetIcon],
      shots: [shot],
      links: [],
      pkg: { key: pkg },
      slug: "borrowed_app",
    }), "submit target in week three");
    ok(await mod.approve_revision(repeated.id), "approve week three target");
    const [entry] = await who.my_entry();

    // Push the old week-two pending row beyond the ordinary eight-row history
    // window. Its files are still served, so history trimming must retain the
    // row until takedown can discover and delete those exact keys.
    for (let i = 0; i < 9; i += 1) {
      const churn = ok(
        await who.publish_update(entry.id, {
          version: `churn-${i}`,
          note: "bounded decided history",
          pkg: [],
        }),
        `queue decided history ${i}`,
      );
      ok(await mod.reject_revision(churn.id, "history-bound fixture"), `settle history ${i}`);
    }
    const staleBeforeTakedown = (await who.my_revisions(20n)).find(
      (row) => row.id === staleQueued.id,
    );
    assert.ok(staleBeforeTakedown, "asset-bearing stale pending work survives history trimming");
    assert.equal(
      Object.keys(staleBeforeTakedown.state)[0],
      "pending",
      "history trimming never settles or drops pending asset ownership",
    );

    // Queue an edit before the takedown. It must be expired atomically and can
    // never restore the package after the published pointers are stripped.
    const queued = ok(await who.submit_entry({
      title: "Borrowed restored",
      summary: "pending before takedown",
      url: "",
      icon: [targetIcon],
      shots: [],
      links: [],
      pkg: { key: pendingPkg },
      slug: entry.slug,
    }), "queue edit before takedown");

    const reason = "the artwork is somebody else's";
    const first = await mod.takedown_app(entry.id, `  ${reason}  `);
    assert.ok("err" in first && "NeedsSecond" in first.err, "one moderator is not enough");
    assert.equal(await served(env, pkg), true, "and nothing has been deleted yet");

    const disagrees = await mod2.takedown_app(entry.id, "the package contains malware");
    assert.ok(
      "err" in disagrees && "NeedsSecond" in disagrees.err,
      "different reasons do not combine into quorum",
    );
    ok(await mod2.withdraw_takedown(entry.id), "withdraw the conflicting vote");

    // The same moderator pressing again is still one moderator.
    const again = await mod.takedown_app(entry.id, reason);
    assert.ok("err" in again && "NeedsSecond" in again.err, "trying harder is not a second vote");

    const done = ok(
      await mod2.takedown_app(entry.id, reason),
      "second moderator",
    );
    assert.ok(done.takedownAt > 0n, "the entry records that it came down");
    assert.equal(done.takedownReason, reason, "the published reason is canonical");

    // Every published URL and every URL held only by a doomed pending revision
    // disappears. This includes the stale week-two proposal: expiring the row
    // without deleting its bytes would leave the exact package URL public.
    for (const key of [
      targetIcon,
      shot,
      pkg,
      stalePendingIcon,
      stalePendingPkg,
      pendingPkg,
    ]) {
      assert.equal(await served(env, key), false, `${key} should have stopped being served`);
    }
    assert.equal(await served(env, archiveIcon), true, "the unrelated archive icon remains served");
    assert.equal(await served(env, archivePkg), true, "the unrelated package remains served");
    assert.deepEqual(done.icon, [], "and the row points at nothing");
    assert.deepEqual(done.shots, []);
    assert.deepEqual(done.pkg, []);
    const restoredUrl = await who.my_upload(
      store(pkg, 7_000, "application/octet-stream"),
    );
    assert.ok("err" in restoredUrl, "a deleted takedown URL remains permanently locked");
    assert.equal(await served(env, pkg), false, "the locked URL cannot be made public again");
    for (const [key, size, type] of [
      [stalePendingIcon, 3_000, "image/png"],
      [stalePendingPkg, 8_000, "application/octet-stream"],
      [pendingPkg, 9_000, "application/octet-stream"],
    ]) {
      assert.ok(
        "err" in (await who.my_upload(store(key, size, type))),
        `pending-only takedown URL ${key} remains permanently locked`,
      );
      assert.equal(await served(env, key), false, `${key} cannot be restored`);
    }

    const [older] = await env.actor.entry_detail(weekTwo.id);
    assert.ok(older.entry.takedownAt > 0n, "the earlier target copy carries the same notice");
    assert.deepEqual(older.entry.icon, [], "and never advertises a removed image");
    const [untouched] = await env.actor.entry_detail(archive.id);
    assert.equal(untouched.entry.takedownAt, 0n, "the unrelated app is not marked down");
    assert.deepEqual(untouched.entry.icon, [archiveIcon], "its distinct pointer remains intact");

    const revisions = await who.my_revisions(20n);
    const expired = revisions.find((row) => row.id === queued.id);
    const staleExpired = revisions.find((row) => row.id === staleQueued.id);
    assert.ok(expired && staleExpired, "both queued revisions remain in the bounded audit trail");
    assert.equal(Object.keys(expired.state)[0], "expired", "the current queued restoration expired");
    assert.equal(Object.keys(staleExpired.state)[0], "expired", "the older queued restoration expired");
    assert.ok(
      "err" in (await mod.approve_revision(queued.id)),
      "expired work cannot be approved later",
    );
    const tally = (await mod.takedown_tally(entry.id, [reason]))[0];
    assert.equal(tally.votes, 0n, "successful takedown consumes every backing row");
  });

  it("keeps the entry, its author and its votes", async () => {
    // The point of the whole design: judges scored what was there, and deleting
    // the row would rewrite a week's arithmetic to cover for a moderation
    // decision. The entry stands and the judges decide what it is worth.
    const [entry] = await who.my_entry();
    assert.equal(entry.title, "Borrowed", "still in the bracket");
    assert.equal(entry.user_id, id, "still theirs");
    const week = await env.actor.season_week((await env.live()).id, entry.week, 50n);
    const publicRow = week.find((row) => row.id === entry.id);
    assert.ok(publicRow, "still one of the week's entries");
    assert.deepEqual(publicRow.icon, [], "raw public week queries hide key tombstones");
    assert.deepEqual(publicRow.pkg, [], "raw public week queries hide deleted builds");
  });

  it("rejects every later restoration path", async () => {
    const fresh = `/u/${id}/pkg/4.neutron`;
    ok(await who.my_upload(store(fresh, 4_000, "application/octet-stream")));
    const [entry] = await who.my_entry();
    const resubmit = await who.submit_entry({
      title: "Borrowed",
      summary: "mine this time",
      url: "",
      icon: [],
      shots: [],
      links: [],
      pkg: { key: fresh },
      slug: entry.slug,
    });
    assert.ok("err" in resubmit, "a full revision cannot restore a taken-down app");
    const update = await who.publish_update(entry.id, {
      version: "2",
      note: "try package-only restoration",
      pkg: [{ key: fresh }],
    });
    assert.ok("err" in update, "a package revision cannot restore a taken-down app");
  });

  it("keeps a stale pending key from becoming another app's takedown collateral", async () => {
    const baseIcon = `/u/${survivorId}/icon/base.png`;
    const sharedIcon = `/u/${survivorId}/icon/shared.png`;
    const survivorIcon = `/u/${survivorId}/icon/survivor.png`;
    const basePkg = `/u/${survivorId}/pkg/10.neutron`;
    const doomedPkg = `/u/${survivorId}/pkg/11.neutron`;
    const survivorPkg = `/u/${survivorId}/pkg/12.neutron`;
    for (const [key, size, type] of [
      [baseIcon, 3_000, "image/png"],
      [sharedIcon, 4_000, "image/png"],
      [survivorIcon, 4_500, "image/png"],
      [basePkg, 5_000, "application/octet-stream"],
      [doomedPkg, 6_000, "application/octet-stream"],
      [survivorPkg, 7_000, "application/octet-stream"],
    ]) {
      ok(await survivor.my_upload(store(key, size, type)), `upload ${key}`);
    }

    const targetProposal = ok(await survivor.submit_entry({
      title: "Old target",
      summary: "",
      url: "",
      icon: [baseIcon],
      shots: [],
      links: [],
      pkg: { key: basePkg },
      slug: "old_target",
    }), "submit the target");
    ok(await mod.approve_revision(targetProposal.id), "publish the target");
    const [target] = await survivor.my_entry();

    const stale = ok(await survivor.submit_entry({
      title: "Old target edit",
      summary: "",
      url: "",
      icon: [sharedIcon],
      shots: [],
      links: [],
      pkg: { key: doomedPkg },
      slug: target.slug,
    }), "queue files that will become stale");

    // Reusing the stale exact key on another app would make a takedown choose
    // between leaving target bytes online and expiring this current proposal.
    // Refuse the collision and let the current app use a fresh key instead.
    await env.advance(7 * 24 * 60 * 60 * 1000 + 1000);
    const collision = await survivor.submit_entry({
      title: "Live survivor",
      summary: "",
      url: "",
      icon: [sharedIcon],
      shots: [],
      links: [],
      pkg: { key: survivorPkg },
      slug: "live_survivor",
    });
    assert.ok(
      "err" in collision && "Invalid" in collision.err,
      "a different app cannot claim an exact key still held by stale pending work",
    );
    const survivorProposal = ok(await survivor.submit_entry({
      title: "Live survivor",
      summary: "",
      url: "",
      icon: [survivorIcon],
      shots: [],
      links: [],
      pkg: { key: survivorPkg },
      slug: "live_survivor",
    }), "submit the surviving app with its own key");
    ok(await mod.approve_revision(survivorProposal.id), "publish the surviving app");
    const [live] = await survivor.my_entry();

    const reason = "the old package must be removed";
    const first = await mod.takedown_app(target.id, reason);
    assert.ok(
      "err" in first && "NeedsSecond" in first.err,
      "the first moderator only records backing",
    );
    ok(await mod2.takedown_app(target.id, reason), "take down the old target");

    assert.equal(await served(env, sharedIcon), false, "the stale target icon is deleted");
    assert.equal(await served(env, survivorIcon), true, "the distinct live icon survives");
    assert.equal(await served(env, survivorPkg), true, "the surviving app's package remains");
    const [detail] = await env.actor.entry_detail(live.id);
    assert.ok(detail, "the surviving app remains readable");
    assert.equal(detail.entry.takedownAt, 0n, "the other app is not taken down");
    assert.deepEqual(detail.entry.icon, [survivorIcon], "its published icon remains intact");

    assert.equal(
      await served(env, doomedPkg),
      false,
      "an unshared stale pending package is still deleted",
    );
    assert.ok(
      "err" in (
        await survivor.my_upload(store(doomedPkg, 6_000, "application/octet-stream"))
      ),
      "the deleted pending-only package remains locked",
    );
    const revisions = await survivor.my_revisions(20n);
    const expired = revisions.find((row) => row.id === stale.id);
    assert.ok(expired, "the stale target revision remains in the audit trail");
    assert.equal(Object.keys(expired.state)[0], "expired", "the stale target revision expires");
  });
});
