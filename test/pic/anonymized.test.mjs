import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  bootstrap,
  closeWeek,
  hacker,
  identity,
  MINUTE,
  ok,
  register,
  SECOND,
  walletFor,
} from "./harness.mjs";
import { installPayoutLedger, ledgerAccount } from "./payout-ledger.mjs";

const signup = (handle) => ({
  handle,
  displayName: handle,
  title: [],
  bio: "",
  links: [],
  terms: true,
});

const errTag = (result) =>
  result && typeof result === "object" && "err" in result
    ? typeof result.err === "string"
      ? result.err
      : Object.keys(result.err)[0]
    : null;

describe("anonymized account terminality", () => {
  let env;
  let owner;
  let agent;
  let userId;
  let targetEntryId;

  before(async () => {
    env = await bootstrap({ controller: identity(7_100) });
    const moderator = await register(env.as, identity(7_103), "delete_mod");
    ok(await env.actor.set_moderator("delete_mod", true, []), "appoint moderator");
    const target = await hacker(env, 7_104, "delete_target");
    owner = await register(env.as, identity(7_101), "delete_owner");
    agent = env.as(identity(7_102));
    const [profile] = await owner.me();
    userId = profile.id;
    ok(await owner.set_wallet(walletFor(7_101)), "set reward wallet");
    ok(await owner.set_hacker(true), "take hacker role");
    ok(await owner.apply_as_judge(), "apply as judge");
    ok(await env.actor.set_judge("delete_owner", { approved: null }, []), "approve judge");
    ok(await owner.set_agent([identity(7_102).getPrincipal()]), "nominate agent");
    assert.equal((await agent.me())[0].id, userId, "agent initially resolves to its owner");

    const draft = ok(await moderator.create_season(), "create season");
    ok(await owner.delete_account(), "delete account");
    ok(await env.seal(), "seal canister");
    const season = ok(await moderator.start_season(draft.id), "start season");

    const [targetProfile] = await target.me();
    const key = `/u/${targetProfile.id}/pkg/1.neutron`;
    ok(
      await target.my_upload({
        store: {
          key,
          contentType: "application/octet-stream",
          contentEncoding: "identity",
          chunks: 1n,
          content: new Uint8Array(32).fill(7),
        },
      }),
      "upload target package",
    );
    const revision = ok(
      await target.submit_entry({
        title: "Vote target",
        summary: "",
        url: "",
        icon: [],
        shots: [],
        links: [],
        pkg: { key },
        slug: "vote_target",
      }),
      "submit target",
    );
    ok(await moderator.approve_revision(revision.id), "approve target");
    const [entry] = await env.actor.season_week(season.id, 1n, 10n);
    targetEntryId = entry.id;
  });

  after(async () => {
    await env?.teardown();
  });

  it("rejects the former owner and agent as authenticated callers", async () => {
    assert.deepEqual(await owner.me(), []);
    assert.deepEqual(await agent.me(), []);
    assert.equal(await owner.am_moderator(), false);

    assert.equal(
      errTag(await owner.update_profile(signup("cannot_return"))),
      "NotRegistered",
    );
    assert.deepEqual(
      await owner.my_upload({ delete: { key: `/u/${userId}/avatar/old.png` } }),
      { err: "not registered" },
    );
    assert.deepEqual(
      await agent.my_upload({ delete: { key: `/u/${userId}/avatar/old.png` } }),
      { err: "not registered" },
    );
  });

  it("rejects every role, delegation, submission and vote write after deletion", async () => {
    assert.deepEqual(await owner.set_hacker(false), { err: { NotRegistered: null } });
    assert.deepEqual(await owner.set_wallet(walletFor(7_105)), {
      err: { NotRegistered: null },
    });
    assert.deepEqual(await owner.set_agent([]), { err: { NotRegistered: null } });

    const input = {
      title: "Cannot return",
      summary: "",
      url: "",
      icon: [],
      shots: [],
      links: [],
      pkg: { key: `/u/${userId}/pkg/2.neutron` },
      slug: "cannot_return",
    };
    const notRegisteredForSeasonWrite = { err: { Season: { NotRegistered: null } } };
    assert.deepEqual(await owner.submit_entry(input), notRegisteredForSeasonWrite);
    assert.deepEqual(
      await owner.publish_update(targetEntryId, {
        version: "2.0.0",
        note: "cannot return",
        pkg: [],
      }),
      notRegisteredForSeasonWrite,
    );
    assert.deepEqual(await owner.cast_vote(targetEntryId), {
      err: { NotRegistered: null },
    });
    assert.deepEqual(await owner.withdraw_vote(targetEntryId), {
      err: { NotRegistered: null },
    });

    // Delegation used to resolve this principal to the owner's live user row.
    // Deletion must terminate that path as completely as the direct principal.
    assert.deepEqual(await agent.submit_entry(input), notRegisteredForSeasonWrite);
    assert.deepEqual(await agent.cast_vote(targetEntryId), {
      err: { NotRegistered: null },
    });
  });

  it("reserves the old principal while keeping the public historical row", async () => {
    assert.equal(errTag(await owner.register(signup("cannot_reregister"))), "AlreadyRegistered");

    assert.deepEqual(await env.actor.profile("delete_owner"), []);
    const [historical] = await env.actor.profile(`deleted-${userId}`);
    assert.equal(historical.id, userId);
    assert.equal(historical.anonymized, true);
    assert.equal(historical.displayName, "Deleted account");
  });
});

describe("anonymized account history", () => {
  let env;

  before(async () => {
    env = await bootstrap({ controller: identity(7_200) });
  });

  after(async () => {
    await env?.teardown();
  });

  it("keeps bracket and payout joins attached to the retained user id", async () => {
    const ledger = await installPayoutLedger(env, 10n);
    ok(await env.actor.set_ledger_allowlist([ledger.id]), "allow payout ledger");

    const moderator = await register(env.as, identity(7_201), "history_mod");
    ok(await env.actor.set_moderator("history_mod", true, []), "appoint moderator");
    const sponsor = await register(env.as, identity(7_202), "history_sponsor");
    ok(
      await sponsor.apply_as_sponsor({
        org: "History Sponsor",
        website: "",
        logo: [],
        blurb: "",
        ledgers: [{ id: ledger.id, sns: false }],
      }),
      "apply sponsor",
    );
    ok(await env.actor.set_sponsor("history_sponsor", { approved: null }, []), "approve sponsor");

    const winner = await hacker(env, 7_203, "history_winner");
    const [winnerProfile] = await winner.me();
    const winnerId = winnerProfile.id;
    const key = `/u/${winnerId}/pkg/1.neutron`;
    ok(
      await winner.my_upload({
        store: {
          key,
          contentType: "application/octet-stream",
          contentEncoding: "identity",
          chunks: 1n,
          content: new Uint8Array(32).fill(8),
        },
      }),
      "upload winning package",
    );

    const draft = ok(await moderator.create_season(), "create history season");
    ok(await env.seal(), "seal history canister");
    const season = ok(await moderator.start_season(draft.id), "start history season");

    const [deposit] = await sponsor.my_deposit();
    assert.ok(deposit, "approved sponsor receives a deposit account");
    await ledger.actor.credit(ledgerAccount(deposit.account), 1_000_000n);
    ok(await sponsor.notify_deposits(), "sweep sponsor deposit");

    const revision = ok(
      await winner.submit_entry({
        title: "Historical winner",
        summary: "",
        url: "",
        icon: [],
        shots: [],
        links: [],
        pkg: { key },
        slug: "history_winner",
      }),
      "submit winning entry",
    );
    ok(await moderator.approve_revision(revision.id), "approve winning entry");

    for (let week = 0; week < 6; week += 1) await closeWeek(env);
    await env.advance(5 * MINUTE + SECOND, 20);

    let [settled] = await env.actor.season_by_number(season.number);
    for (let attempt = 0; settled.payout.paid === undefined && attempt < 5; attempt += 1) {
      await env.advance(2 * SECOND, 8);
      ok(await moderator.run_payout(season.id), `settle payout ${attempt}`);
      [settled] = await env.actor.season_by_number(season.number);
    }
    assert.deepEqual(settled.payout, { paid: null }, "reward distribution settled");

    const before = await env.actor.payout_plan(season.id);
    assert.equal(before.length, 1, "the winning app produced one payout row");
    assert.equal(before[0].user_id, winnerId);

    ok(await winner.delete_account(), "delete settled winner");

    const weekOne = await env.actor.season_week_view(season.id, 1n, 10n);
    const bracket = weekOne.find((row) => row.entry.user_id === winnerId);
    assert.ok(bracket, "the public bracket keeps the historical row");
    assert.equal(bracket.handle, `deleted-${winnerId}`);
    assert.equal(bracket.displayName, "Deleted account");

    const payout = await env.actor.payout_plan(season.id);
    assert.equal(payout.length, 1, "the public payout record is retained");
    assert.equal(payout[0].user_id, winnerId);
    assert.equal(payout[0].handle, `deleted-${winnerId}`);
    assert.equal(payout[0].displayName, "Deleted account");
    assert.deepEqual(await winner.my_payouts(), [], "the deleted principal cannot reclaim the row");
  });
});
