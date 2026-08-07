/**
 * Nothing may be lost to an upgrade — and there is exactly one window in which
 * an upgrade can happen at all.
 *
 * The canister uses Motoko's enhanced orthogonal persistence, so "the heap
 * survives" is the claim; these tests are what turn that claim into evidence.
 * The method throughout is a full snapshot either side of an upgrade rather
 * than a handful of spot checks: every user, every role, every season row, the
 * asset store, the review queue and the moderation log. A field that quietly
 * resets is only caught by looking at all of them.
 *
 * The window is what shapes the file. `seal_canister` leaves exactly the
 * canister itself as controller and removes every external controller.
 * `start_season` refuses to run until that exact state is present, so the
 * former deployer cannot install code over a running season.
 *
 * An upgrade is therefore a setup-time operation and nothing else. What it has
 * to carry is what exists while one is still possible: profiles, roles,
 * wallets, sponsors, moderators, the handle index, the id counter, the config,
 * the asset store and its certification tree. Those are the first two suites.
 *
 * What used to be here and could not survive the change: every suite that
 * upgraded a canister with a season on it through the former deployer. The last
 * suite walks up to the seal, goes through it, and proves that external key is
 * shut out.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { IDL } from "@dfinity/candid";

import { bootstrap, identity, ok, register, walletFor, MINUTE } from "./harness.mjs";

/**
 * A stable string for anything the canister returns.
 *
 * `bigint`, `Principal` and `Uint8Array` all appear in these payloads and none
 * of them survive `JSON.stringify` on their own. Comparing rendered strings
 * rather than deep-equalling objects also gives a readable diff when a field
 * does move.
 */
const wire = (value) =>
  JSON.stringify(value, (_key, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v.toText === "function") return v.toText();
    if (v instanceof Uint8Array) return Array.from(v).join(",");
    return v;
  });

/**
 * Everything the canister will tell a moderator, in named pieces.
 *
 * Named rather than one blob so a failure says *which* part moved. The pieces
 * deliberately overlap — `season_week`, `season_map` and `entry_detail` read
 * the same rows through different indexes, and an index that came back wrong
 * would show up in only one of them.
 *
 * Read as the deployer throughout, which is not a shortcut: a snapshot is only
 * ever taken on a canister that can still be upgraded, an upgradeable canister
 * is one that still has controllers, and `Profiles.canModerate` counts a
 * controller as a moderator. On the far side of `seal_canister` the former
 * deployer has neither role nor upgrade authority, so there is no snapshot to
 * take through that identity.
 */
async function snapshot(env) {
  const parts = {
    config: await env.actor.config(),
    stats: await env.actor.stats(),
    users: await env.actor.users_page({ all: null }, [], [], 200n),
    letters: await env.actor.letter_counts({ all: null }),
    "newest season": await env.actor.season(),
    "moderation log": await env.actor.moderation_log([], 100n),
    "pending judges": await env.actor.pending_judges(200n),
    moderators: await env.actor.moderators(200n),
    "recent users": await env.actor.recent_users(200n),
    assets: await env.actor.assets_list("/", 500n),
    "asset count": await env.actor.assets_count(),
    "treasury ledgers": await env.actor.treasury_ledgers(),
    "prize pool": await env.actor.prize_pool(),
    "judges frozen": await env.actor.judges_frozen(),
    "week ends at": await env.actor.week_ends_at(),
    "running season": await env.actor.season_running(),
    "withdrawals locked": await env.actor.withdrawals_locked(),
    // The review queue is durable state of its own: an app that nobody has
    // looked at yet exists only as a revision row, and losing one loses a
    // hacker's submission without anybody being told.
    "review queue": await env.actor.review_queue(100n),
    "reviews pending": await env.actor.review_pending(),
  };

  // The handle indexes are separate state from the row store and are reached
  // by three different paths — a cursor walk, a seek into one A-Z bucket, and
  // a prefix search. Reading only the unfiltered first page would miss an
  // index that came back empty, so all three are taken, and the letter and the
  // prefix are derived from a handle that actually exists rather than being
  // hard-coded (a hard-coded one is empty in half these suites, which asserts
  // nothing).
  const head = await env.actor.users_page({ all: null }, [], [], 1n);
  parts["users first"] = head;
  parts["users next"] = await env.actor.users_page({ all: null }, [], head.next, 1n);
  const handle = head.rows[0]?.handle ?? "";
  parts["users by letter"] = handle
    ? await env.actor.users_page({ all: null }, [handle[0].toUpperCase()], [], 200n)
    : null;
  parts["users search"] = handle
    ? await env.actor.users_search(handle.slice(0, 2), { all: null }, 200n)
    : null;
  parts["user entries"] = handle ? await env.actor.user_entries(handle, 50n) : null;

  for (const season of await env.actor.seasons(50n)) {
    const n = Number(season.number);
    parts[`season ${n}`] = season;
    const details = [];
    for (let week = 1n; week <= 6n; week += 1n) {
      const entries = await env.actor.season_week(season.id, week, 200n);
      parts[`season ${n} week ${week}`] = entries;
      for (const entry of entries) details.push(await env.actor.entry_detail(entry.id));
    }
    parts[`season ${n} entry detail`] = details;
    parts[`season ${n} map`] = await env.actor.season_map(season.id, 50n);
    parts[`season ${n} payout plan`] = await env.actor.payout_plan(season.id);
    parts[`season ${n} payout progress`] = await env.actor.payout_progress(season.id);
  }
  return parts;
}

/** Assert two snapshots are the same, naming the part that is not. */
function unchanged(first, second) {
  assert.deepEqual(
    Object.keys(second),
    Object.keys(first),
    "the upgrade added or dropped a whole table",
  );
  for (const key of Object.keys(first)) {
    assert.equal(wire(second[key]), wire(first[key]), `${key} changed across the upgrade`);
  }
}

/** Bytes that are not an image but are stored as if they were one. */
const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 11) % 251);

const store = (key, content, contentType = "image/png") => ({
  store: { key, contentType, contentEncoding: "identity", chunks: 1n, content },
});

/**
 * Register, and hand back the actor, the row, the `/u/<id>/` scope and the
 * wallet they would be paid at.
 *
 * One acceptance, taken at registration, and that is the whole of it — the
 * agreement covers the common rules and the rules for every role its signer
 * later assumes, so there is nothing further to collect from anybody here.
 */
async function person(env, n, handle) {
  const actor = await register(env.as, identity(n), handle);
  const [row] = await actor.me();
  return { actor, user: row, scope: `/u/${row.id}/`, wallet: walletFor(n) };
}

describe("an upgrade with people on the books", () => {
  let env;
  const cast = {};

  before(async () => {
    env = await bootstrap();

    cast.keeper = await person(env, 3000, "keeper");
    ok(
      await cast.keeper.actor.update_profile({
        handle: "keeper",
        displayName: "The Keeper",
        title: ["archivist"],
        bio: "keeps things",
        links: [{ kind: "x", url: "https://example.com/keeper" }],
        // An edit takes the same input as a registration and runs the same
        // validation, so the acceptance is restated every time. It is the only
        // thing on the input that is not a matter of taste, and not something
        // a profile edit can quietly withdraw.
        terms: true,
      }),
      "profile",
    );

    cast.hammer = await person(env, 3001, "hammer");
    // Role and wallet. Taking a role asks for nothing beyond registration now
    // — the one acceptance covers every role, so `set_hacker` has nothing left
    // of its own to check. The wallet is included because it is a field on the
    // user row like any other, and one that resets to `null` across an upgrade
    // is a winner who cannot be paid.
    ok(await cast.hammer.actor.set_hacker(true), "hacker");
    ok(await cast.hammer.actor.set_wallet(cast.hammer.wallet), "wallet");
    const avatar = `${cast.hammer.scope}avatar/face.png`;
    ok(await cast.hammer.actor.my_upload(store(avatar, bytes(2048))), "avatar upload");
    ok(await cast.hammer.actor.set_avatar([avatar]), "set avatar");

    cast.arbiter = await person(env, 3002, "arbiter");
    ok(await cast.arbiter.actor.apply_as_judge(), "apply");
    ok(await env.actor.set_judge("arbiter", { approved: null }, ["knows the field"]), "approve");

    cast.hopeful = await person(env, 3003, "hopeful");
    ok(await cast.hopeful.actor.apply_as_judge(), "apply");

    cast.patron = await person(env, 3004, "patron");
    // Sponsoring means sending money, which used to want a declaration of its
    // own before the role could be taken. It does not any more: one acceptance
    // at registration covers every role, so `apply_as_sponsor` asks whether
    // they are registered and nothing else.
    ok(
      await cast.patron.actor.apply_as_sponsor({
        org: "Patron Labs",
        blurb: "we fund things",
        website: "https://example.com",
        logo: [],
        ledgers: [{ id: env.launchLedger, sns: false }],
      }),
      "sponsor",
    );
    ok(await env.actor.set_sponsor("patron", { approved: null }, []), "approve sponsor");

    cast.warden = await person(env, 3006, "warden");
    ok(await env.actor.set_moderator("warden", true, ["trusted"]), "moderator");

    // Approved and then revoked: the audit log should carry both, and the
    // profile should carry only the second.
    cast.ousted = await person(env, 3007, "ousted");
    ok(await cast.ousted.actor.apply_as_judge(), "apply");
    ok(await env.actor.set_judge("ousted", { approved: null }, []), "approve");
    ok(await env.actor.set_judge("ousted", { no: null }, ["changed their mind"]), "revoke");
  });

  after(async () => {
    await env?.teardown();
  });

  it("keeps every profile, role, avatar and audit entry", async () => {
    const log = await env.actor.moderation_log([], 100n);
    assert.ok(log.rows.length >= 5, "the cast above should have written a real audit trail");
    assert.equal((await env.actor.profile("ousted"))[0].judgeStatus.no, null);

    const first = await snapshot(env);
    await env.upgrade();
    unchanged(first, await snapshot(env));
  });

  it("changes nothing at all when upgraded twice with nothing in between", async () => {
    const first = await snapshot(env);
    await env.upgrade();
    await env.upgrade();
    unchanged(first, await snapshot(env));
  });

  it("still knows who each principal is", async () => {
    // `me()` goes through the by-principal index rather than the row store, so
    // it checks that the *indexes* came back and not merely the tables.
    //
    // The upgrade is done here rather than leaned on from the test above: a
    // test in this file that never upgrades is a test of the canister, not of
    // an upgrade, and it would quietly become one if the order ever changed.
    await env.upgrade();

    for (const [name, who] of Object.entries(cast)) {
      const [seen] = await who.actor.me();
      assert.ok(seen, `${name} should still be recognised`);
      assert.equal(seen.handle, who.user.handle);
      assert.equal(seen.id, who.user.id);
    }
    assert.equal(await env.as(identity(3006)).am_moderator(), true, "warden moderates");
    assert.equal(await env.as(identity(3000)).am_moderator(), false, "keeper does not");
    // And the deployer moderates without a row of their own, because
    // `Profiles.canModerate` reads `isController(caller) or user.moderator`.
    // That holds only for as long as they are a controller at all, which is to
    // say until somebody seals the canister — nothing in this suite does, so
    // the implicit moderator is part of what an upgrade must carry unchanged.
    // The last suite is where the other half of the sentence is pinned, and
    // there it is permanent.
    assert.equal(await env.actor.am_moderator(), true, "and so does whoever holds the keys");
  });

  it("still refuses a handle that was taken before the upgrade", async () => {
    // The unique index on handles is separate state from the row itself; had it
    // been rebuilt empty this would succeed and produce two `hammer`s.
    await env.upgrade();

    const clash = await env.as(identity(3008)).register({
      handle: "hammer",
      displayName: "impostor",
      title: [],
      bio: "",
      links: [],
      // Accepted. `Profiles.validate` runs before the handle is looked up, so
      // an impostor who left it off would be turned away for the wrong reason
      // and this test would pass without ever touching the index.
      terms: true,
    });
    assert.deepEqual(clash, { err: { HandleTaken: null } });
  });

  it("hands the next registration an id nobody already has", async () => {
    // The id counter is the state most likely to be silently reset, and a reset
    // one hands a new user somebody else's asset namespace `/u/<id>/`.
    const highest = (await env.actor.users_page({ all: null }, [], [], 200n)).rows.reduce(
      (max, row) => (row.id > max ? row.id : max),
      0n,
    );

    await env.upgrade();

    const fresh = await person(env, 3009, "latecomer");
    assert.ok(
      fresh.user.id > highest,
      `new id ${fresh.user.id} should be past every existing id (${highest})`,
    );
  });

  it("still serves an uploaded file, still certified", async () => {
    const url = `${cast.hammer.scope}avatar/face.png`;
    const request = {
      method: "GET",
      url,
      headers: [],
      body: new Uint8Array(),
      certificate_version: [],
    };

    const first = await env.actor.http_request(request);
    assert.equal(first.status_code, 200);

    await env.upgrade();

    const second = await env.actor.http_request(request);
    assert.equal(second.status_code, 200, "the asset should still be servable");
    assert.equal(wire(second.body), wire(first.body), "and byte-identical");

    // The witness comes from the certification tree and the certificate from
    // the canister's certified data. Losing either leaves a file that is served
    // but that no gateway will accept.
    //
    // "not empty" is far too weak on its own: an emptied tree still encodes a
    // pruned witness, and that witness is still non-empty base64 — so the
    // regex below would pass against a certification tree that had been wiped.
    // The load-bearing assertion is the one after it. The witness is a pure
    // function of the tree, so it must come back *byte-identical*; the
    // certificate must not, because it is stamped with the time it was read.
    const witnessOf = (response) => {
      const header = response.headers.find(([name]) => name.toLowerCase() === "ic-certificate");
      assert.ok(header, "an ic-certificate header should still be attached");
      assert.match(header[1], /certificate=:[^:]+:/, "the certificate should not be empty");
      assert.match(header[1], /tree=:[^:]+:/, "the witness should not be empty");
      return header[1].match(/tree=:([^:]*):/)[1];
    };

    assert.equal(
      witnessOf(second),
      witnessOf(first),
      "the certification tree must survive, not merely be present",
    );
  });

  it("keeps a sponsor's deposit address exactly where it was", async () => {
    // Derived from the user id, so this is really a check that ids did not
    // move: a shifted id sends the next donation to somebody else's address.
    const first = await env.actor.deposit_for("patron");
    await env.upgrade();
    assert.equal(wire(await env.actor.deposit_for("patron")), wire(first));
  });

  // Last, because it shuts the door behind it.
  it("keeps registration shut once it has been shut", async () => {
    // The config singleton is seeded with defaults on every `db()` call, and
    // the defaults say registration is open. If the seeding ever stopped being
    // "only when empty", an upgrade would quietly reopen a closed door.
    ok(await env.actor.set_config("Closed For Now", false), "config");

    await env.upgrade();

    const config = await env.actor.config();
    assert.equal(config.registrationOpen, false, "an upgrade must not reopen registration");
    assert.equal(config.siteTitle, "Closed For Now");
    const late = await env.as(identity(3010)).register({
      handle: "toolate",
      displayName: "too late",
      title: [],
      bio: "",
      links: [],
      terms: true,
    });
    assert.deepEqual(late, { err: { Closed: null } });
  });
});

// ── A real ICRC-1 ledger ─────────────────────────────────────────────────────
//
// A sponsor's collection reads a real balance and a real fee off a real
// canister, so the rate-limit test below cannot be run against a made-up
// principal: a sweep that never reaches a ledger is a sweep that never gets as
// far as stamping the window it is supposed to be limited by. So the genuine
// `ic-icrc1-ledger` build is installed alongside — the same wasm
// `npm run ledgers:local` uses, with real deduplication behind it.
//
// This used to carry far more: a whole finished season, drafted and paid out
// across a series of deployer upgrades. That is gone with the seal — a season
// cannot start until the controller list is exactly self-only, and the former
// deployer can no longer perform an upgrade. test/pic/money.test.mjs is where
// the distribution itself is proved.

const LEDGER_WASM = [
  "/srv/shared/code/neutron/.neutron/cache/fixtures/ledger-suite-icrc-2026-03-09/ic-icrc1-ledger.wasm.gz",
  "/srv/shared/code/neutron_backup/.neutron/cache/fixtures/ledger-suite-icrc-2026-03-09/ic-icrc1-ledger.wasm.gz",
].find((path) => existsSync(path));

const LEDGER_FEE = 10_000n;

const accountType = (IDL) =>
  IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });

const ledgerInit = ({ IDL }) => {
  const Account = accountType(IDL);
  const MetadataValue = IDL.Variant({
    Nat: IDL.Nat,
    Int: IDL.Int,
    Text: IDL.Text,
    Blob: IDL.Vec(IDL.Nat8),
  });
  const InitArgs = IDL.Record({
    minting_account: Account,
    fee_collector_account: IDL.Opt(Account),
    transfer_fee: IDL.Nat,
    decimals: IDL.Opt(IDL.Nat8),
    max_memo_length: IDL.Opt(IDL.Nat16),
    token_symbol: IDL.Text,
    token_name: IDL.Text,
    metadata: IDL.Vec(IDL.Tuple(IDL.Text, MetadataValue)),
    initial_balances: IDL.Vec(IDL.Tuple(Account, IDL.Nat)),
    feature_flags: IDL.Opt(IDL.Record({ icrc2: IDL.Bool })),
    archive_options: IDL.Record({
      num_blocks_to_archive: IDL.Nat64,
      max_transactions_per_response: IDL.Opt(IDL.Nat64),
      trigger_threshold: IDL.Nat64,
      max_message_size_bytes: IDL.Opt(IDL.Nat64),
      cycles_for_archive_creation: IDL.Opt(IDL.Nat64),
      node_max_memory_size_bytes: IDL.Opt(IDL.Nat64),
      controller_id: IDL.Principal,
      more_controller_ids: IDL.Opt(IDL.Vec(IDL.Principal)),
    }),
    index_principal: IDL.Opt(IDL.Principal),
  });
  return [IDL.Variant({ Init: InitArgs, Upgrade: IDL.Opt(IDL.Record({})) })];
};

const ledgerService = ({ IDL }) => {
  const Account = accountType(IDL);
  const TransferError = IDL.Variant({
    BadFee: IDL.Record({ expected_fee: IDL.Nat }),
    BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    TemporarilyUnavailable: IDL.Null,
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  });
  return IDL.Service({
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc1_fee: IDL.Func([], [IDL.Nat], ["query"]),
    icrc1_transfer: IDL.Func(
      [
        IDL.Record({
          from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
          to: Account,
          amount: IDL.Nat,
          fee: IDL.Opt(IDL.Nat),
          memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
          created_at_time: IDL.Opt(IDL.Nat64),
        }),
      ],
      [IDL.Variant({ Ok: IDL.Nat, Err: TransferError })],
      [],
    ),
  });
};

/** Install a ledger that starts with everything in the controller's hands. */
async function installLedger(env) {
  assert.ok(LEDGER_WASM, "no ic-icrc1-ledger.wasm.gz on this machine");
  const holder = env.controller.getPrincipal();
  const arg = IDL.encode(ledgerInit({ IDL }), [
    {
      Init: {
        // Nobody's key. Transfers from the minting account mint and transfers
        // to it burn, so parking it on an identity that never calls anything
        // makes every transfer below an ordinary, fee-paying one.
        minting_account: { owner: identity(3199).getPrincipal(), subaccount: [] },
        fee_collector_account: [],
        transfer_fee: LEDGER_FEE,
        decimals: [8],
        max_memo_length: [80],
        token_symbol: "TESTA",
        token_name: "Test Alpha",
        metadata: [],
        initial_balances: [[{ owner: holder, subaccount: [] }, 1_000_000_000_000n]],
        feature_flags: [{ icrc2: false }],
        archive_options: {
          num_blocks_to_archive: 1_000n,
          max_transactions_per_response: [],
          trigger_threshold: 2_000n,
          max_message_size_bytes: [],
          cycles_for_archive_creation: [100_000_000_000_000n],
          node_max_memory_size_bytes: [],
          controller_id: holder,
          more_controller_ids: [],
        },
        index_principal: [],
      },
    },
  ]);

  const { actor, canisterId } = await env.pic.setupCanister({
    idlFactory: ledgerService,
    wasm: LEDGER_WASM,
    arg,
    sender: env.controller.getPrincipal(),
    controllers: [env.controller.getPrincipal()],
  });
  actor.setIdentity(env.controller);
  return { ledger: actor, ledgerId: canisterId };
}

describe("what an upgrade carries, and what it deliberately does not", () => {
  let env;
  let patron;

  // No season is started here: `start_season` refuses until the controller
  // list is exactly self-only, which removes this fixture's upgrade identity.
  // Both tests below need that identity to upgrade, so
  // both live on the near side of that door — which is the only side an
  // upgrade has ever been possible from.
  before(async () => {
    env = await bootstrap();
    const { ledgerId } = await installLedger(env);
    ok(await env.actor.set_ledger_allowlist([ledgerId]), "configure the real ledger");

    patron = await person(env, 3100, "quick_patron");
    // Nothing is asked of them beyond the acceptance their registration
    // already carried — one agreement, covering every role its signer takes.
    ok(
      await patron.actor.apply_as_sponsor({
        org: "Quick",
        blurb: "",
        website: "",
        logo: [],
        ledgers: [{ id: ledgerId, sns: false }],
      }),
      "sponsor",
    );
    ok(await env.actor.set_sponsor("quick_patron", { approved: null }, []), "approve");
  });

  after(async () => {
    await env?.teardown();
  });

  it("keeps a sponsor's one-a-minute notify window", async () => {
    // the Funding section of the Rules page caps a sponsor at one collection a minute. This used to be
    // transient, on the reasoning that a rate limit is abuse control rather
    // than accounting, so nothing is lost by resetting it.
    //
    // That reasoning is only sound if upgrades are rare, and the party who
    // decides how often this canister upgrades is not the party being limited.
    // A wiped window is an open window, and an upgrade is exactly the moment
    // nobody is reading the cycle balance. It costs one small entry per
    // approved sponsor ever.
    ok(await patron.actor.notify_deposits(), "first notify");
    const soon = await patron.actor.notify_deposits();
    assert.ok("err" in soon && "TooSoon" in soon.err, `expected TooSoon, got ${wire(soon)}`);

    await env.upgrade();

    const still = await patron.actor.notify_deposits();
    assert.ok(
      "err" in still && "TooSoon" in still.err,
      `an upgrade reopened the window: ${wire(still)}`,
    );

    // And it still expires on time — carried, not made permanent.
    await env.advance(2 * MINUTE);
    assert.ok("ok" in (await patron.actor.notify_deposits()), "the window still expires");
  });

  it("keeps an in-flight upload staged rather than dropping it", async () => {
    // A multi-chunk asset that has not finished arriving is neither certified
    // nor servable, but it must not vanish — the uploader would have no way to
    // know where to resume from.
    //
    // A second reason it has to be this suite and not a sealed one: both
    // chunks go through `assets_upload`, which is controller-only, and the
    // second is sent *after* the upgrade. A canister that had been sealed
    // between them could neither take the chunk nor have been upgraded.
    const key = "/assets/bundle.js";
    ok(
      await env.actor.assets_upload({
        store: {
          key,
          contentType: "text/javascript",
          contentEncoding: "identity",
          chunks: 2n,
          content: bytes(1000),
        },
      }),
      "first chunk",
    );
    const staged = (await env.actor.assets_list(key, 10n))[0];
    assert.equal(staged.complete, false);

    await env.upgrade();

    assert.equal(wire((await env.actor.assets_list(key, 10n))[0]), wire(staged));
    ok(
      await env.actor.assets_upload({ chunk: { key, index: 1n, content: bytes(1000) } }),
      "second chunk after the upgrade",
    );
    const done = (await env.actor.assets_list(key, 10n))[0];
    assert.equal(done.complete, true, "the upload resumes where it left off");
    assert.equal(done.size, 2000n);
  });
});

describe("the seal and removal of external controller power", () => {
  let env;
  let mod;
  /** The season drafted before the seal and started after it. */
  let draft;

  /**
   * Everything controller-only, done first, because there is no second chance
   * at any of it.
   *
   * This is the ordering the real deployment has: appoint the moderators,
   * upload the frontend, set the allowance, configure the site — and only then
   * seal. Afterwards the only authority that exists is the one the installed
   * code grants, and a moderator who was never appointed can never be.
   */
  before(async () => {
    env = await bootstrap();

    mod = await person(env, 3200, "seal_mod");
    ok(await env.actor.set_moderator("seal_mod", true, []), "appoint a moderator");
    ok(
      await env.actor.assets_upload(store("/assets/app.js", bytes(512), "text/javascript")),
      "upload the frontend",
    );
    ok(await env.actor.set_instruction_cap(900_000_000_000n), "raise the allowance");
    ok(await env.actor.set_config("Sealed Site", true), "configure the site");
  });

  after(async () => {
    await env?.teardown();
  });

  it("refuses to start a season before the exact self-only seal", async () => {
    const held = await env.pic.getControllers(env.canisterId);
    assert.equal(held.length, 2, "the deployer and the canister, as `bootstrap` left them");

    // Drafting is a moderator's call and the deployer is an implicit one while
    // they are still a controller, so this is the last thing in the file they
    // do by virtue of holding the keys.
    draft = ok(await env.actor.create_season(), "create");
    const refused = await mod.actor.start_season(draft.id);
    assert.ok("err" in refused && "Invalid" in refused.err, `expected #Invalid, got ${wire(refused)}`);
    // The refusal names the way out and what it costs, because a season that
    // started on a canister somebody could still rewrite would look identical
    // from outside to one that could not.
    assert.match(refused.err.Invalid, /seal_canister/);
    assert.deepEqual(await env.actor.season_running(), [], "and nothing started");

    // The same fact from the other side: while there is a controller there is
    // an upgrade, and this is the last one this canister will ever take.
    await env.upgrade();
    assert.deepEqual(
      wire(await env.actor.seasons(10n)),
      wire([draft]),
      "the draft is still there afterwards",
    );
  });

  it("leaves exactly the canister itself as controller", async () => {
    ok(await env.seal(), "seal");

    // Asked of the management canister rather than of anything this canister
    // wrote down about itself, which is what makes it evidence rather than a
    // claim. `canister_status` about yourself needs no privilege, so it keeps
    // answering after the external controller has been removed.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the canister itself is the sole controller",
    );
    assert.equal(await env.actor.is_controller(), false, "least of all the deployer");

    // Not idempotent from outside, and it cannot be: the gate is
    // `isController`, and the former deployer no longer passes it.
    const again = await env.actor.seal_canister();
    assert.ok("err" in again, `a second seal should be refused, got ${wire(again)}`);
    assert.match(again.err, /not a controller/);
  });

  it("takes every controller-only power away from the former deployer", async () => {
    // The four things a deployment arranges beforehand, all refused now, all
    // refused for ever. This is the price of the guarantee rather than a hole
    // in it: no compute allocation, no frontend fix, no config change, no new
    // moderator, no rescue.
    const renamed = await env.actor.set_config("Renamed", false);
    assert.deepEqual(renamed, { err: "caller is not a controller" });
    const uploaded = await env.actor.assets_upload(store("/assets/app.js", bytes(8), "text/plain"));
    assert.deepEqual(uploaded, { err: "caller is not a controller" });
    const capped = await env.actor.set_instruction_cap(1n);
    assert.deepEqual(capped, { err: "caller is not a controller" });
    assert.deepEqual(await env.actor.set_moderator("seal_mod", false, []), {
      err: { NotAllowed: null },
    });

    // Refused rather than partly applied, which is the assertion that matters
    // for a config write that merges rather than replaces.
    const config = await env.actor.config();
    assert.equal(config.siteTitle, "Sealed Site", "the site keeps the name it was sealed with");
    assert.equal(config.instructionCap, 900_000_000_000n);
    assert.equal((await env.actor.assets_list("/assets/app.js", 10n))[0].size, 512n);

    // And the long shadow. `Profiles.canModerate` is
    // `isController(caller) or user.moderator`, so whoever held the keys was
    // always an implicit moderator; sealed, they are neither, and every
    // moderator-gated method is dark to them permanently. What survives is the
    // seat that was granted before the door shut.
    assert.equal(await env.actor.am_moderator(), false, "and the deployer cannot moderate");
    assert.equal(await mod.actor.am_moderator(), true, "the seated moderator still can");
    // Read both ways round, because "the log is empty" and "the log is closed
    // to you" are the same answer from a stranger's side and only one of them
    // is what is being claimed. The appointment in `before` is the row.
    const seated = await mod.actor.moderation_log([], 10n);
    assert.ok(seated.rows.length >= 1, "the moderator's own appointment is in the log");
    assert.deepEqual(
      await env.actor.moderation_log([], 10n),
      { rows: [], next: [], total: 0n },
      "and the deployer may not so much as read it",
    );
  });

  it("lets a moderator start the season the controller no longer can", async () => {
    // Which is forced rather than chosen: a controller gate here would be a
    // gate nobody could ever pass, and the season would never start.
    assert.deepEqual(
      await env.actor.create_season(),
      { err: { NotAllowed: null } },
      "the deployer cannot even draft one now",
    );

    const started = ok(await mod.actor.start_season(draft.id), "start");
    assert.equal(Number(started.number), 1);
    assert.equal(Number(started.week), 1, "the same call that seals the doors starts the clock");
    assert.equal(await env.actor.clock_armed(), true);
    assert.equal(await env.actor.judges_frozen(), true, "and freezes the judges");
    assert.equal(
      (await env.actor.config()).registrationOpen,
      false,
      "registration was already shut as a precondition of the seal",
    );
  });

  it("cannot be upgraded or stopped by the former deployer", async () => {
    // The claim in its strongest form — not "the bracket was not edited" on
    // trust, but "the code could not have been replaced", refused by the
    // replica rather than by anything in this canister's own control. It is
    // also why every test above this line had to happen above this line.
    await assert.rejects(
      () => env.upgrade(),
      /Only (?:the )?controllers/,
      "the deployer must not be able to replace the code",
    );

    // Nor taken out of service and reinstalled the long way round by that
    // former deployer, which is the same permission and the same answer.
    await assert.rejects(
      () =>
        env.pic.stopCanister({
          canisterId: env.canisterId,
          sender: env.controller.getPrincipal(),
        }),
      /Only (?:the )?controllers/,
      "the former deployer cannot stop a sealed canister",
    );

    assert.deepEqual(
      (await env.pic.getControllers(env.canisterId)).map((who) => who.toText()),
      [env.canisterId.toText()],
      "and the list is still exactly self-only",
    );
    assert.equal(Number((await env.live()).week), 1, "with the season running underneath it");
  });
});
