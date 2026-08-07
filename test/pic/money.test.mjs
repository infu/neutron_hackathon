/**
 * The money path, against real ICRC-1 ledgers.
 *
 * Every other suite proves the treasury against something that stands in for a
 * ledger. This installs the genuine DFINITY `ic-icrc1-ledger` build inside
 * PocketIC — twice, with different decimals and different fees — and drives the
 * whole path through it: a sponsor's deposit address, the sweep into the
 * treasury, the once-a-minute limit, and a season paying its winners.
 *
 * A distribution now lands in each winner's **own wallet**, in one hop, with no
 * human approving anything: the final week closing arms a timer that drafts the
 * plan and sends it. The canister-controlled custody accounts still exist and
 * `withdraw` still drains them, but nothing puts money in them any more — see
 * *still drains a balance that is sitting in custody* for what that path is now
 * for.
 *
 * Two ledgers rather than one because a fee is frozen per line at draft time
 * and a share is computed per pool; one ledger cannot tell a frozen fee from a
 * hard-coded one.
 *
 * Both fixtures below are shaped by the seal. `seal_canister()` leaves exactly
 * the canister itself as controller and removes every external controller.
 * `start_season` refuses until that exact state is present.
 *
 * What that costs the fixture: the identity that installed the canister gets
 * one window in which it is a controller, and after the seal closes it holds
 * nothing at all — no upgrade, no settings, no frontend, and not the implicit
 * moderator `Profiles.canModerate` used to hand a controller. So the moderators
 * are appointed inside that window, while there is still somebody who can
 * appoint them, and everything afterwards is theirs: approving a sponsor,
 * sweeping on somebody's behalf, drafting a plan, and starting the seasons
 * themselves. An ingress controller gate after the seal would be a gate no
 * external caller could pass.
 *
 * Approving is also *two* moderators' now (`Moderation.SECONDS_NEEDED`). The
 * one-caller shortcut in `Moderation.quorum` is for a controller with no
 * profile row, and after the seal there is no such caller — so both fixtures
 * seat a pair.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";

import {
  bootstrap,
  closeWeek,
  hacker,
  identity,
  ok,
  register,
  walletFor,
  MINUTE,
  SECOND,
} from "./harness.mjs";

// ── The ledger fixture ───────────────────────────────────────────────────────

/** A release artifact, so a copy on disk is as good as a download. */
const LEDGER_WASM = [
  "/srv/shared/code/neutron/.neutron/cache/fixtures/ledger-suite-icrc-2026-03-09/ic-icrc1-ledger.wasm.gz",
  "/srv/shared/code/neutron_backup/.neutron/cache/fixtures/ledger-suite-icrc-2026-03-09/ic-icrc1-ledger.wasm.gz",
].find((path) => existsSync(path));

/**
 * Nobody's key. Transfers *from* the minting account mint and transfers *to* it
 * burn, so parking it on the management canister keeps both out of reach and
 * makes every transfer here an ordinary, fee-paying one — which is the whole
 * point, since the fee is what the sweep and the payout have to reason about.
 */
const NOBODY = Principal.fromText("aaaaa-aa");

const ledgerIdl = ({ IDL }) => {
  const Subaccount = IDL.Vec(IDL.Nat8);
  const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(Subaccount) });
  const MetadataValue = IDL.Variant({
    Nat: IDL.Nat,
    Int: IDL.Int,
    Text: IDL.Text,
    Blob: IDL.Vec(IDL.Nat8),
  });
  const TransferArg = IDL.Record({
    from_subaccount: IDL.Opt(Subaccount),
    to: Account,
    amount: IDL.Nat,
    fee: IDL.Opt(IDL.Nat),
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
  });
  const TransferError = IDL.Variant({
    BadFee: IDL.Record({ expected_fee: IDL.Nat }),
    BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
    TemporarilyUnavailable: IDL.Null,
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  });
  const TransferResult = IDL.Variant({ Ok: IDL.Nat, Err: TransferError });
  return IDL.Service({
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc1_decimals: IDL.Func([], [IDL.Nat8], ["query"]),
    icrc1_fee: IDL.Func([], [IDL.Nat], ["query"]),
    icrc1_metadata: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, MetadataValue))], ["query"]),
    icrc1_symbol: IDL.Func([], [IDL.Text], ["query"]),
    icrc1_transfer: IDL.Func([TransferArg], [TransferResult], []),
  });
};

/**
 * The init argument, as `LedgerArg`.
 *
 * Only the `Init` tag is declared: a variant with fewer cases is a subtype of
 * one with more, so the ledger decodes this happily and there is no second
 * record to keep in step with upstream.
 */
const initArg = ({ symbol, name, decimals, fee, supply, holder, controller }) => {
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const InitArgs = IDL.Record({
    minting_account: Account,
    fee_collector_account: IDL.Opt(Account),
    transfer_fee: IDL.Nat,
    decimals: IDL.Opt(IDL.Nat8),
    max_memo_length: IDL.Opt(IDL.Nat16),
    token_symbol: IDL.Text,
    token_name: IDL.Text,
    metadata: IDL.Vec(
      IDL.Tuple(
        IDL.Text,
        IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) }),
      ),
    ),
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
  const LedgerArg = IDL.Variant({ Init: InitArgs });

  return IDL.encode(
    [LedgerArg],
    [
      {
        Init: {
          minting_account: { owner: NOBODY, subaccount: [] },
          fee_collector_account: [],
          transfer_fee: fee,
          decimals: [decimals],
          max_memo_length: [80],
          token_symbol: symbol,
          token_name: name,
          metadata: [],
          initial_balances: [[{ owner: holder, subaccount: [] }, supply]],
          feature_flags: [{ icrc2: false }],
          archive_options: {
            num_blocks_to_archive: 1_000n,
            max_transactions_per_response: [],
            trigger_threshold: 2_000n,
            max_message_size_bytes: [],
            cycles_for_archive_creation: [100_000_000_000_000n],
            node_max_memory_size_bytes: [],
            controller_id: controller,
            more_controller_ids: [],
          },
          index_principal: [],
        },
      },
    ],
  );
};

/**
 * Install one ledger and hand back the pieces a test needs: its id, the fee it
 * charges, an actor as the whale that holds the whole supply, and a reader.
 */
async function installLedger(pic, spec) {
  if (!LEDGER_WASM) throw new Error("no ic-icrc1-ledger.wasm.gz on this machine");
  const controller = spec.controller.getPrincipal();
  const { canisterId } = await pic.setupCanister({
    idlFactory: ledgerIdl,
    wasm: LEDGER_WASM,
    sender: controller,
    controllers: [controller],
    arg: initArg({ ...spec, holder: spec.holder.getPrincipal(), controller }),
  });

  const whale = pic.createActor(ledgerIdl, canisterId);
  whale.setIdentity(spec.holder);
  const reader = pic.createActor(ledgerIdl, canisterId);
  reader.setIdentity(spec.holder);

  return {
    id: canisterId,
    symbol: spec.symbol,
    decimals: spec.decimals,
    fee: spec.fee,
    pledge: { id: canisterId, sns: false },
    api: reader,
    balanceOf: (account) => reader.icrc1_balance_of(account),
    /** Whole-account read for `{ owner, subaccount }` shapes off the canister. */
    send: async (to, amount) => {
      const result = await whale.icrc1_transfer({
        from_subaccount: [],
        to,
        amount,
        fee: [],
        memo: [],
        created_at_time: [],
      });
      if ("Err" in result) throw new Error(`${spec.symbol} transfer: ${JSON.stringify(result.Err, bigints)}`);
      return result.Ok;
    },
  };
}

const bigints = (_, value) => (typeof value === "bigint" ? value.toString() : value);

/** Byte 0 tags what a derived subaccount is for — the Rewards section of the Rules page, *Custody*. */
const derive = (tag, userId) => {
  const bytes = new Uint8Array(32);
  bytes[0] = tag;
  new DataView(bytes.buffer).setBigUint64(24, BigInt(userId));
  return bytes;
};
const depositSubaccount = (userId) => derive(0x00, userId);

/**
 * The deposit account, worked out here rather than asked for.
 *
 * `my_deposit` withholds the address outside a running season — tokens sent
 * early cannot be swept, so an address you cannot act on is not shown. The
 * address itself is still perfectly well defined (the Funding section of the Rules page: tag byte, then
 * the user id), and a test that wants to put money there *before* a season
 * opens can derive it. A sponsor cannot, which is the point.
 */
const depositAccount = (canisterId, userId) =>
  account(canisterId, depositSubaccount(userId));
const rewardSubaccount = (userId) => derive(0x01, userId);

const account = (owner, subaccount) => ({
  owner,
  subaccount: subaccount ? [Array.from(subaccount)] : [],
});

/** An `Account` off the canister, retyped for the ledger's own IDL. */
const forLedger = (a) => ({
  owner: a.owner,
  subaccount: a.subaccount.length ? [Array.from(a.subaccount[0])] : [],
});

const application = (org, ledgers) => ({
  org,
  blurb: "",
  website: "",
  logo: [],
  ledgers,
});

/**
 * An entry now has to carry a build: `EntryInput.pkg` is required and the
 * canister refuses a key with no finished upload behind it, so `pkg` is the key
 * `uploadPackage` already put in the store.
 *
 * It also has to carry a `slug`, the app id. That is what the download is
 * named — `<slug>.neutron` — so it is settled once and `Season.checkSlug`
 * refuses an edit that moves it rather than quietly ignoring the change.
 */
const entry = (title, pkg, slug) => ({
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
 * An app id for a member of the cast.
 *
 * A slug is 5 to 50 characters of `a-z` and `_` and nothing else — no digits —
 * so this suite's numbered handles have to be spelled out: `hack_1` enters as
 * `hack_one`. Derived from the handle rather than from a counter so that an id
 * names whoever holds it — an id is unique across users and fixed once chosen,
 * and a test reading one back off a payout row has to be able to say whose.
 */
const NUMERALS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const slugFor = (handle) => handle.replace(/_?(\d)/g, (_match, digit) => `_${NUMERALS[Number(digit)]}`);

/**
 * Put a `.neutron` build in somebody's own namespace and hand back its key.
 *
 * `checkEntry` calls `sizeOf` on the key an entry names and refuses one with
 * nothing complete behind it, so this has to happen before any `submit_entry`.
 */
async function uploadPackage(actor, userId, stamp = 1) {
  const key = `/u/${userId}/pkg/${stamp}.neutron`;
  ok(
    await actor.my_upload({
      store: {
        key,
        contentType: "application/octet-stream",
        contentEncoding: "identity",
        chunks: 1n,
        content: new Uint8Array(128).fill(7),
      },
    }),
    `upload ${key}`,
  );
  return key;
}

const errOf = (result) => {
  if (!("err" in result)) throw new Error(`expected an error, got ${JSON.stringify(result, bigints)}`);
  return Object.keys(result.err)[0];
};

const APPLICATION = { org: "Gilt Labs", blurb: "", website: "", logo: [] };

// ── 1. Deposits ──────────────────────────────────────────────────────────────

describe("sponsor deposits, on two real ICRC-1 ledgers", () => {
  let env;
  let alpha;
  let beta;
  let gilt; // the approved sponsor
  let bystander; // registered, not a sponsor at all
  let keeper; // a real moderator, because the controller stops being one
  let steward; // and a second, because approving takes two of them
  let draft; // the season drafted before the seal, started after it

  const SENT_A = 5_000_000_000n; // 50 TESTA at 8dp
  const SENT_B = 5_000_000n; //     5 TESTB at 6dp
  const sealedAsset = {
    store: {
      key: "/sealed.txt",
      contentType: "text/plain",
      contentEncoding: "identity",
      chunks: 1n,
      content: new Uint8Array(16).fill(3),
    },
  };

  before(async () => {
    env = await bootstrap();
    const holder = identity(2000);
    alpha = await installLedger(env.pic, {
      symbol: "TESTA",
      name: "Test Alpha",
      decimals: 8,
      fee: 10_000n,
      supply: 10n ** 14n,
      holder,
      controller: env.controller,
    });
    beta = await installLedger(env.pic, {
      symbol: "TESTB",
      name: "Test Beta",
      decimals: 6,
      fee: 1_000n,
      supply: 10n ** 12n,
      holder,
      controller: env.controller,
    });
    ok(
      await env.actor.set_ledger_allowlist([alpha.id, beta.id]),
      "configure the two real ledgers",
    );

    // Seated now because they cannot be seated later. `set_moderator` is
    // controller-only and the seal removes the external controller, so once it
    // runs the former deployer cannot appoint anybody. A sweep
    // on somebody's behalf is a moderator's call and so is starting a season,
    // so this is the first thing the fixture asks of the canister.
    //
    // Two of them, not one. Approving a sponsor needs `Moderation.SECONDS_NEEDED`
    // backers, and the shortcut that let a single caller through — a controller
    // with no profile row — is a caller that stops existing at the seal.
    keeper = await register(env.as, identity(2007), "keeper");
    ok(await env.actor.set_moderator("keeper", true, []), "appoint");
    steward = await register(env.as, identity(2008), "steward");
    ok(await env.actor.set_moderator("steward", true, []), "appoint a second");
  });

  after(async () => {
    await env?.teardown();
  });

  it("installs two ledgers that disagree about decimals and fees", async () => {
    // Read back through the interface rather than trusting what was sent: the
    // fee the canister will charge itself is the one these tests reason with,
    // and if both tokens behaved identically nothing below could tell a frozen
    // fee from a hard-coded one.
    for (const ledger of [alpha, beta]) {
      assert.equal(await ledger.api.icrc1_symbol(), ledger.symbol);
      assert.equal(await ledger.api.icrc1_fee(), ledger.fee);
      assert.equal(await ledger.api.icrc1_decimals(), ledger.decimals);
    }
    assert.notEqual(await alpha.api.icrc1_fee(), await beta.api.icrc1_fee());
    assert.notEqual(await alpha.api.icrc1_decimals(), await beta.api.icrc1_decimals());
    assert.equal(await alpha.balanceOf(account(identity(2000).getPrincipal())), 10n ** 14n);
    assert.equal(await beta.balanceOf(account(identity(2000).getPrincipal())), 10n ** 12n);
  });

  /**
   * The point of no return, and everything below this line depends on it.
   *
   * It runs as a test rather than inside `before` so that both halves are
   * visible: what the installer could do while it held the keys, and what
   * nobody can do once there are none. All `before` does to this canister is
   * seat the moderators — controller work, which is why it has to come first —
   * and the test above only reads the ledgers.
   */
  it("requires a complete launch and rejects unauthorized seal attempts", async () => {
    // Two controllers to start with: the human who installed it, and the
    // canister itself, which `bootstrap` adds because `update_settings` has no
    // self-exemption — a canister that is not one of its own controllers cannot
    // empty its own list.
    const atFirst = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      new Set(atFirst.map((who) => who.toText())),
      new Set([env.canisterId.toText(), env.controller.getPrincipal().toText()]),
      "the installer and the canister, which is what makes sealing possible",
    );

    // Whatever the site is going to serve has to be uploaded now. `assets_upload`
    // is controller-gated with no moderator fallback, so this is the last window
    // in which the frontend can be written at all.
    ok(await env.actor.assets_upload(sealedAsset), "the frontend goes up before the door closes");

    // A valid draft is part of the launch manifest, but it is not enough by
    // itself: registration, governance and funding are all settled before the
    // irreversible seal rather than being patched in afterwards.
    draft = ok(await keeper.create_season(), "draft");
    const early = await keeper.start_season(draft.id);
    assert.ok("err" in early && "Invalid" in early.err, JSON.stringify(early, bigints));
    assert.match(early.err.Invalid, /seal_canister/, early.err.Invalid);

    // Sealing is the controller's own last act. A moderator cannot do it for
    // them, and neither can a passer-by.
    assert.deepEqual(await keeper.seal_canister(), { err: "caller is not a controller" });
    assert.deepEqual(await env.as(identity(2009)).seal_canister(), {
      err: "caller is not a controller",
    });
  });

  it("withholds the deposit address until a season is running", async () => {
    gilt = await register(env.as, identity(2001), "gilt");
    ok(await gilt.apply_as_sponsor(application("Gilt Labs", [alpha.pledge, beta.pledge])), "apply");

    const me = (await gilt.me())[0];
    assert.deepEqual(me.sponsorStatus, { pending: null });

    // **[decided]** No address before a season is running. `Treasury.sweep`
    // refuses outside one, so tokens sent early would sit somewhere the
    // canister will not collect from — money in limbo, with the sponsor given
    // every reason to think it had arrived. Withholding the address is the
    // only honest answer to a question whose answer is not yet usable.
    assert.deepEqual(await gilt.my_deposit(), [], "no season, no address");
    assert.deepEqual(await env.actor.deposit_for("gilt"), [], "and not to anybody else either");

    const me2 = (await gilt.me())[0];
    const deposit = { account: depositAccount(env.canisterId, me2.id) };
    assert.equal(deposit.account.owner.toText(), env.canisterId.toText());

    // the Funding section of the Rules page: 32 bytes, big-endian user id in the last 8; §7 adds byte 0
    // as the tag, which is zero for a deposit.
    const sub = Uint8Array.from(deposit.account.subaccount[0]);
    assert.equal(sub.length, 32);
    assert.deepEqual(sub, depositSubaccount(me.id));
    assert.equal(new DataView(sub.buffer).getBigUint64(24), me.id);
  });

  it("refuses to collect for a sponsor nobody has approved", async () => {
    // Derived, not asked for: there is no season yet, so the canister will not
    // hand the address over. The tokens can still be sent there — that is
    // exactly the limbo the withholding exists to keep sponsors out of.
    const giltId = (await gilt.me())[0].id;
    await alpha.send(forLedger(depositAccount(env.canisterId, giltId)), SENT_A);

    const hopeful = await register(env.as, identity(2002), "hopeful");
    ok(await hopeful.apply_as_sponsor(application("Hopeful Ltd", [alpha.pledge])), "apply");
    assert.equal(errOf(await hopeful.notify_deposits()), "NotASponsor");

    bystander = await register(env.as, identity(2003), "bystander");
    assert.equal(errOf(await bystander.notify_deposits()), "NotASponsor");

    // And a caller the canister has never heard of gets no further.
    const stranger = env.as(identity(2004));
    assert.equal(errOf(await stranger.notify_deposits()), "NotRegistered");

    assert.equal(
      await alpha.balanceOf(forLedger(depositAccount(env.canisterId, giltId))),
      SENT_A,
      "the money that was sent is still sitting at the deposit address",
    );
    ok(await hopeful.withdraw_sponsor(), "decide the unused application before launch");
  });

  it("refuses to collect while no season is running", async () => {
    // Two moderators, and neither of them the installer: a sealed canister has
    // no controller, so `Moderation.quorum`'s single-caller shortcut has nobody
    // left to apply to and an approval is the two-backer decision it is
    // documented to be.
    const alone = await keeper.set_sponsor("gilt", { approved: null }, []);
    assert.ok("err" in alone && "NeedsSecond" in alone.err, JSON.stringify(alone, bigints));
    assert.deepEqual(alone.err.NeedsSecond, { votes: 1n, needed: 2n });
    ok(await steward.set_sponsor("gilt", { approved: null }, []), "approve");
    assert.deepEqual((await gilt.me())[0].sponsorStatus, { approved: null });

    // the Funding section of the Rules page: a sweep only runs while a season is running.
    assert.equal(errOf(await gilt.notify_deposit(alpha.id)), "NoSeason");
    assert.deepEqual(
      await gilt.notify_deposits(),
      { ok: [] },
      "the bulk call reports that nothing moved rather than why",
    );
    assert.deepEqual(await env.actor.prize_pool(), [
      [alpha.id, 0n],
      [beta.id, 0n],
    ]);
  });

  it("seals only after the complete launch is frozen, and there is no way back", async () => {
    // Fill only the missing governance seats and close registration. The real
    // sponsor, ledgers and draft above remain the launch manifest exercised by
    // this suite.
    await env.prepareLaunch();

    // With every data precondition satisfied, the remaining refusal is the
    // externally verifiable controller list. A recorded flag cannot fake it.
    const early = await keeper.start_season(draft.id);
    assert.ok("err" in early && "Invalid" in early.err, JSON.stringify(early, bigints));
    assert.match(early.err.Invalid, /seal_canister/, early.err.Invalid);

    ok(await env.seal(), "seal");

    // Exact self-only. Asked of the management canister rather than read out
    // of a row the canister wrote.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the canister itself is the sole controller",
    );
    assert.equal(await env.actor.is_controller(), false);

    // And the identity that installed it now holds nothing whatsoever. Every
    // one of these is permanent: there is no caller left who could pass any of
    // these gates, so this is the shape of the canister for the rest of its
    // life.
    assert.deepEqual(await env.actor.seal_canister(), { err: "caller is not a controller" });
    assert.ok("err" in (await env.actor.set_config("Renamed", false)), "nor the site config");
    assert.ok("err" in (await env.actor.assets_upload(sealedAsset)), "nor the frontend, ever again");
    assert.ok("err" in (await env.actor.set_instruction_cap(1_000_000n)), "nor the meter's cap");
    assert.equal(errOf(await env.actor.set_moderator("keeper", false, [])), "NotAllowed");

    // Including the code. Refused by the replica rather than by this canister.
    const refused = await env.upgrade().then(() => null, (error) => error);
    assert.ok(refused, "a sealed canister must never be upgradable");
    assert.match(String(refused), /controller/i, String(refused));

    assert.equal((await env.actor.moderation_log([], 10n)).total, 0n, "the installer may not read");
    assert.ok((await keeper.moderation_log([], 10n)).total > 0n, "and a moderator may");
    assert.equal(errOf(await env.actor.create_season()), "NotAllowed");
  });

  it("collects on every pledged ledger once a season is running", async () => {
    // The same draft that could not start an hour ago starts now, and it is a
    // moderator who starts it. Nothing about the draft changed; the canister
    // did.
    const started = ok(await keeper.start_season(draft.id), "start");
    assert.deepEqual(started.phase, { running: null });
    assert.equal(errOf(await gilt.start_season(draft.id)), "NotAllowed", "and only a moderator");

    const [deposit] = await gilt.my_deposit();
    await beta.send(forLedger(deposit.account), SENT_B);

    // The refused attempt above still spent the window: it is stamped before
    // the sweep, so a minute has to pass either way.
    await env.advance(MINUTE + SECOND);
    const moved = ok(await gilt.notify_deposits(), "notify");

    const byLedger = new Map(moved.map(([id, amount]) => [id.toText(), amount]));
    assert.equal(byLedger.size, 2, "both pledged ledgers are swept in one call");
    assert.equal(byLedger.get(alpha.id.toText()), SENT_A - alpha.fee);
    assert.equal(byLedger.get(beta.id.toText()), SENT_B - beta.fee);

    // The balance really moved: deposit emptied, treasury holds it.
    assert.equal(await alpha.balanceOf(forLedger(deposit.account)), 0n);
    assert.equal(await beta.balanceOf(forLedger(deposit.account)), 0n);
    assert.equal(await alpha.balanceOf(account(env.canisterId)), SENT_A - alpha.fee);
    assert.equal(await beta.balanceOf(account(env.canisterId)), SENT_B - beta.fee);
  });

  it("is still self-controlled now that there is money in it", async () => {
    // The seal happened before a unit had been swept, so this is the first
    // moment it is worth re-asking: with a treasury holding two tokens, who
    // could install code over it through the former deployer? Nobody, and the management canister is the
    // one that says so — a canister that recorded a seal it never applied would
    // sail through any weaker test.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "still exactly self-controlled with money in the canister",
    );
    assert.equal(await env.actor.is_controller(), false);

    // Which is why `keeper` had to be appointed in `before`, before the seal.
    // There is no route back to any of this: no method, no delay, no quorum.
    assert.equal(errOf(await env.actor.create_season()), "NotAllowed");
    assert.equal(errOf(await env.actor.set_moderator("keeper", false, [])), "NotAllowed");
    assert.ok("err" in (await env.actor.set_instruction_cap(1_000_000n)), "and the meter's cap");
    assert.equal((await env.actor.moderation_log([], 10n)).total, 0n, "the installer may not read");
    assert.ok((await keeper.moderation_log([], 10n)).total > 0n, "and a moderator may");
  });

  it("records the contribution as the balance less that ledger's own fee", async () => {
    const [me] = await env.actor.profile("gilt");
    const given = new Map(me.sponsor[0].given.map((g) => [g.ledger.toText(), g.amount]));
    assert.equal(given.get(alpha.id.toText()), SENT_A - alpha.fee);
    assert.equal(given.get(beta.id.toText()), SENT_B - beta.fee);

    assert.deepEqual(await env.actor.prize_pool(), [
      [alpha.id, SENT_A - alpha.fee],
      [beta.id, SENT_B - beta.fee],
    ]);
  });

  it("refuses a second collection inside the minute", async () => {
    const again = await gilt.notify_deposits();
    assert.ok("err" in again && "TooSoon" in again.err, JSON.stringify(again, bigints));
    const left = again.err.TooSoon;
    assert.ok(left > 0n && left <= 60n, `expected seconds remaining, got ${left}`);
  });

  it("lifts the limit once the minute is up, and not before", async () => {
    // Half a minute is not a minute. Without this leg the test would pass
    // against a canister that had no limit at all — `{ok: []}` is what an
    // unlimited call with nothing to sweep returns too.
    await env.advance(30 * SECOND);
    const early = await gilt.notify_deposits();
    assert.ok("err" in early && "TooSoon" in early.err, JSON.stringify(early, bigints));
    assert.ok(
      early.err.TooSoon > 0n && early.err.TooSoon <= 30n,
      `the window should have run down by half, got ${early.err.TooSoon}`,
    );

    await env.advance(31 * SECOND);
    assert.deepEqual(
      await gilt.notify_deposits(),
      { ok: [] },
      "allowed through, and found nothing left to move",
    );
  });

  it("accumulates a top-up into one running total per ledger", async () => {
    const TOP_UP = 2_000_000_000n;
    const [deposit] = await gilt.my_deposit();
    await alpha.send(forLedger(deposit.account), TOP_UP);

    await env.advance(MINUTE + SECOND);
    const moved = ok(await gilt.notify_deposits(), "notify");
    assert.deepEqual(
      moved.map(([id, amount]) => [id.toText(), amount]),
      [[alpha.id.toText(), TOP_UP - alpha.fee]],
      "only the ledger with a balance behind it contributes",
    );

    const [me] = await env.actor.profile("gilt");
    const alphaGifts = me.sponsor[0].given.filter((g) => g.ledger.toText() === alpha.id.toText());
    assert.equal(alphaGifts.length, 1, "one running total per ledger, not one row per sweep");
    assert.equal(alphaGifts[0].amount, SENT_A + TOP_UP - 2n * alpha.fee);
  });

  it("freezes the approved sponsor record and its audited contribution at launch", async () => {
    const before = await env.actor.prize_pool();
    assert.deepEqual(
      await gilt.apply_as_sponsor({
        ...APPLICATION,
        blurb: "we gave a great deal more than that",
        ledgers: [alpha.pledge, beta.pledge],
      }),
      { err: { Settling: null } },
    );
    assert.deepEqual(await env.actor.prize_pool(), before, "the refused edit cannot move the total");

    const [me] = await env.actor.profile("gilt");
    assert.equal(me.sponsor[0].blurb, "", "the published application is unchanged");
    assert.equal(me.sponsor[0].given.length, 2, "and its ledger evidence survives intact");
  });

  it("refuses to sweep a ledger the sponsor never pledged", async () => {
    // A sweep the caller can aim anywhere is a way to make this canister call
    // an arbitrary canister at somebody else's request.
    assert.equal(errOf(await gilt.notify_deposit(env.canisterId)), "NoLedger");
    assert.equal(errOf(await keeper.sweep_sponsor("gilt", env.canisterId)), "NoLedger");
  });

  it("keeps sweeping on somebody's behalf to moderators", async () => {
    // Refused, though the error the caller is handed says `NotRegistered` when
    // what is actually missing is the moderator role.
    assert.equal(errOf(await bystander.sweep_sponsor("gilt", alpha.id)), "NotRegistered");
    // And the identity that installed the canister is refused by the same gate,
    // in the same words: the seal took the keys, so it holds no role here at
    // all and never will again. It used to pass this on
    // `Principal.isController` alone.
    assert.equal(errOf(await env.actor.sweep_sponsor("gilt", alpha.id)), "NotRegistered");
    // The appointed moderator gets through, and there is nothing left to move.
    assert.equal(errOf(await keeper.sweep_sponsor("gilt", alpha.id)), "Nothing");

    // the Funding section of the Rules page: "A moderator can still sweep on somebody's behalf from the
    // CLI, for a sponsor who transferred and never came back." Passing the
    // authority gate is not that capability — so give them something to
    // collect and watch a moderator collect it, with the sponsor calling
    // nothing and their own once-a-minute window untouched.
    const STRANDED = 300_000_000n;
    const [deposit] = await gilt.my_deposit();
    await alpha.send(forLedger(deposit.account), STRANDED);

    const pools = async () =>
      new Map((await env.actor.prize_pool()).map(([id, amount]) => [id.toText(), amount]));
    const before = await pools();

    const swept = ok(await keeper.sweep_sponsor("gilt", alpha.id), "moderator sweep");
    assert.equal(swept, STRANDED - alpha.fee);
    assert.equal(await alpha.balanceOf(forLedger(deposit.account)), 0n, "the deposit address emptied");

    const after = await pools();
    assert.equal(
      after.get(alpha.id.toText()),
      before.get(alpha.id.toText()) + STRANDED - alpha.fee,
      "a moderator's sweep is credited to the sponsor, not to nobody",
    );
    assert.equal(after.get(beta.id.toText()), before.get(beta.id.toText()), "and moves no other token");

    // It is the sponsor's record that grew, which is what the board reads.
    const [me] = await env.actor.profile("gilt");
    const alphaGift = me.sponsor[0].given.find((g) => g.ledger.toText() === alpha.id.toText());
    assert.equal(alphaGift.amount, after.get(alpha.id.toText()));
  });

  // BUG: `notify_deposit` performs the very same sweep as `notify_deposits` and
  // is not rate-limited at all, so the once-a-minute window is one method call
  // away from being ignored. the Funding section of the Rules page ("One notification per sponsor per
  // minute") and §8 ("Collect a deposit — the sponsor themselves, once a
  // minute") are about the action, not about one of the two entry points to it.
  it("holds a sponsor to one collection a minute however they ask for it", async () => {
    await env.advance(MINUTE + SECOND);
    const [deposit] = await gilt.my_deposit();

    await alpha.send(forLedger(deposit.account), 1_000_000n);
    ok(await gilt.notify_deposits(), "first collection of the minute");

    // Same sponsor, same minute, same sweep — this must be refused.
    await alpha.send(forLedger(deposit.account), 1_000_000n);
    const second = await gilt.notify_deposit(alpha.id);
    assert.ok(
      "err" in second && "TooSoon" in second.err,
      `a second collection inside the minute went through: ${JSON.stringify(second, bigints)}`,
    );
  });

  // NOT a rules violation, though it reads like one at first.
  //
  // the Funding section of the Rules page does say a pledged id "is checked by reading `icrc1_metadata`
  // from it before it can be saved". But the very next [decided] in the same
  // section is narrower and binding on this canister: "The canister calls
  // exactly three ledger methods — `icrc1_balance_of`, `icrc1_fee`,
  // `icrc1_transfer` — and nothing else. That is the whole dependency." A
  // canister-side metadata call would break that. The check exists, on the
  // client — `frontend/src/tokens.ts` reads `icrc1_metadata` and
  // `LedgerPicker.tsx` refuses a pick that does not answer — which is where it
  // can be made without adding a fourth method to the dependency. And nothing
  // is at risk of being "sent to it" either: tokens go to the deposit address,
  // never to the pledged id.
  //
  // What is worth pinning is that pledging is *not* what bounds the calls.
  // It used to be: `withdraw` allowed any ledger in `treasury_ledgers`, a set
  // written by approved sponsors and editable after approval without going
  // back for review — so a sponsor could name an arbitrary principal and any
  // caller could then make this canister dial it. A metadata check would not
  // have closed that; a hostile canister answers `icrc1_metadata` happily.
  //
  // The bound is now per caller and written only by `Payout.draft` — by the
  // canister's own timer when a season ends, or by a moderator forcing a
  // redraft, never by the caller: a ledger you have actually been paid on. A
  // pledge widens nothing.
  it("does not let a post-launch pledge widen which canisters this one will call", async () => {
    const notALedger = identity(2005).getPrincipal();
    const somewhere = account(identity(2006).getPrincipal());

    // Not pledged: refused before the canister goes anywhere near it.
    assert.equal(errOf(await bystander.withdraw(notALedger, somewhere)), "BadDestination");

    assert.deepEqual(
      await gilt.apply_as_sponsor({
        ...APPLICATION,
        ledgers: [alpha.pledge, beta.pledge, { id: notALedger, sns: false }],
      }),
      { err: { Settling: null } },
    );

    // Launch freezes both the sponsor record and the controller-configured
    // allowlist, so the unreviewed principal never enters the funding set.
    assert.deepEqual((await gilt.me())[0].sponsorStatus, { approved: null });
    const inPlay = (await env.actor.treasury_ledgers()).map((id) => id.toText());
    assert.equal(inPlay.includes(notALedger.toText()), false, `treasury_ledgers: ${inPlay.join(", ")}`);

    // And it still goes nowhere. `BadDestination` is a refusal before any
    // message leaves — a `Transfer` error would be the reply to one that did,
    // which is what this returned before the allowlist moved off the pledges.
    const reached = await bystander.withdraw(notALedger, somewhere);
    assert.equal(errOf(reached), "BadDestination", JSON.stringify(reached, bigints));

    assert.equal(errOf(await bystander.withdraw(notALedger, somewhere)), "BadDestination");
  });

  /**
   * Last in the block, and it has to be: it runs the six-week calendar out and
   * there is no season afterwards to sweep into. Everything above happened on a
   * canister nobody controlled, and this is the check that finishing the season
   * did not change that — the seal is not a lease.
   */
  it("outlives the season it was sealed for", async () => {
    // Refused mid-season, and by the replica rather than by this canister —
    // `install_code` answers `CanisterInvalidController` to the identity that
    // installed it, because it is not one any more. That is the claim the whole
    // arrangement exists to make: the code cannot change while there is money
    // and a bracket riding on it.
    const midway = await env.upgrade().then(() => null, (error) => error);
    assert.ok(midway, "a sealed canister must not be upgradable by the human who installed it");
    assert.match(String(midway), /controller/i, String(midway));

    // So run the season out. Six weeks on the calendar — nobody may nudge one.
    // This season has no entries and so no winners, which is beside the point:
    // nothing about how a season ends, or whether anybody was paid, feeds back
    // into who controls the canister. There is no path from here to a
    // controller at all.
    for (let week = 1; week <= 6; week += 1) await closeWeek(env);
    assert.equal(await env.live(), null, "the season ran its course");
    const [finished] = await env.actor.season();
    assert.deepEqual(finished.phase, { finished: null });

    // The same answer as before the season, during it, and now after it.
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "a finished season restores no external controller",
    );
    assert.equal(await env.actor.is_controller(), false);

    // And the code still cannot change, so this is what runs for good.
    const after = await env.upgrade().then(() => null, (error) => error);
    assert.ok(after, "and it is no more upgradable now the season is over");
    assert.match(String(after), /controller/i, String(after));

    // The installer is not quietly a moderator again either: `canModerate` is
    // read live on every call and `Principal.isController` is false for
    // everybody now. The moderator appointed before the seal is still the only
    // one there is, and the refusal *they* get is about the season being over
    // rather than about who is asking.
    assert.equal((await env.actor.moderation_log([], 10n)).total, 0n, "never a moderator again");
    assert.equal(errOf(await env.actor.sweep_sponsor("gilt", alpha.id)), "NotRegistered");
    assert.equal(errOf(await keeper.sweep_sponsor("gilt", alpha.id)), "NoSeason");

    // What the sponsor gave is accounting and outlives the season it was given
    // for. Public funding admission, including the notification window, closes
    // atomically with the final and never reopens.
    await env.advance(MINUTE + SECOND);
    assert.equal(errOf(await gilt.notify_deposits()), "NoSeason");
    assert.equal(errOf(await gilt.notify_deposits()), "NoSeason");

    const [me] = await env.actor.profile("gilt");
    const given = new Map(me.sponsor[0].given.map((g) => [g.ledger.toText(), g.amount]));
    assert.deepEqual(await env.actor.prize_pool(), [
      [alpha.id, given.get(alpha.id.toText())],
      [beta.id, given.get(beta.id.toText())],
    ]);
  });
});
// ── 2. The payout ────────────────────────────────────────────────────────────

/** bronze 250, silver 2 000, gold 3 500 — the Rewards section of the Rules page, *A thin season*. */
const WEIGHT = { bronze: 250n, silver: 2_000n, gold: 3_500n };

describe("paying a finished season out", () => {
  let env;
  let alpha;
  let beta;
  let gilt;
  let mod; // a real moderator, not the controller — see `before`
  let reeve; // a second, because approving a sponsor takes two
  let anyone; // a caller the canister has never heard of, used to prove the gate
  let bystander; // registered before launch, but never a winner
  let judges;
  let hackers; // h1 … h6
  let ids; // handle → user id
  let wallets; // handle → the principal their prize is sent to
  let packages; // handle → the key of the build they entered with
  let draft;
  let season;
  let stamps; // payout row id → the `created_at_time` frozen at draft

  const SENT_A = 5_000_000_000n;
  const SENT_B = 5_000_000n;
  const POOL_A = SENT_A - 10_000n;
  const POOL_B = SENT_B - 1_000n;

  /**
   * Who the pool is actually split between, and on what.
   *
   * Six hackers place — h1 gold, h6 silver, h2…h5 bronze — but `Payout.claims`
   * drops anyone with no wallet or with `rewardOptOut` set, and h6 opts out in
   * `before`. The split is normalised over the weight *actually claimed*, so
   * h6's silver is not stranded in the treasury: it is divided among the five
   * who are left. That is why this list, and not the podium, is the
   * denominator every expected amount below is computed from.
   */
  const AWARD = {
    hack_1: "gold",
    hack_2: "bronze",
    hack_3: "bronze",
    hack_4: "bronze",
    hack_5: "bronze",
  };
  const CLAIMS = Object.keys(AWARD);
  const TOTAL_WEIGHT = CLAIMS.reduce((sum, handle) => sum + WEIGHT[AWARD[handle]], 0n);

  const share = (pool, award) => (pool * WEIGHT[award]) / TOTAL_WEIGHT;

  /**
   * What integer division could not place — and which is no longer left behind.
   *
   * `Payout.plan` picks exactly one row per ledger to carry it: the largest
   * payable share, ties broken by the lowest user id, which in an ordinary
   * season is the grand prize. Largest rather than smallest because the carrier
   * must not be a row that gets skipped for failing to cover its own fee.
   */
  const remainderOf = (pool) =>
    pool - CLAIMS.reduce((sum, handle) => sum + share(pool, AWARD[handle]), 0n);
  const CARRIER = "hack_1";
  const grossFor = (pool, handle) =>
    share(pool, AWARD[handle]) + (handle === CARRIER ? remainderOf(pool) : 0n);
  /** What actually lands: the fee comes out of the payee's share. */
  const netFor = (pool, handle, fee) => grossFor(pool, handle) - fee;

  const outside = identity(2040).getPrincipal();
  const elsewhere = identity(2041).getPrincipal();

  const stop = (ledger) =>
    env.pic.stopCanister({ canisterId: ledger.id, sender: env.controller.getPrincipal() });
  const start = (ledger) =>
    env.pic.startCanister({ canisterId: ledger.id, sender: env.controller.getPrincipal() });

  /** What a hacker's own wallet holds on one ledger. */
  const held = (ledger, handle) => ledger.balanceOf(account(wallets.get(handle)));
  /** What is sitting in the canister's custody account for them. */
  const custodyOf = (handle) => account(env.canisterId, rewardSubaccount(ids.get(handle)));

  /**
   * Put tokens straight into somebody's custody account.
   *
   * Nothing the canister does lands money there any more — a season pays the
   * winner's wallet in one hop. `withdraw` survives as the drain for balances
   * that are *already* in custody, so a test of that path has to put one there
   * itself, and the whale that holds the supply is the only thing that can.
   */
  const seedCustody = (ledger, handle, amount) => ledger.send(custodyOf(handle), amount);

  before(async () => {
    env = await bootstrap();
    const holder = identity(2000);
    alpha = await installLedger(env.pic, {
      symbol: "TESTA",
      name: "Test Alpha",
      decimals: 8,
      fee: 10_000n,
      supply: 10n ** 14n,
      holder,
      controller: env.controller,
    });
    beta = await installLedger(env.pic, {
      symbol: "TESTB",
      name: "Test Beta",
      decimals: 6,
      fee: 1_000n,
      supply: 10n ** 12n,
      holder,
      controller: env.controller,
    });
    ok(
      await env.actor.set_ledger_allowlist([alpha.id, beta.id]),
      "configure the two real ledgers",
    );

    // The judge freezes the moment a season starts, so the whole cast has to
    // exist first (the Roles section of the Rules page) — and the moderation has to be arranged even
    // earlier than that. Everything in this hook that reads
    // `Principal.isController` is being done for the last time: the seal at the
    // bottom removes every external controller, and `set_sponsor`,
    // `set_judge`, `set_moderator`, `set_config` and `assets_upload` all stop
    // working at that instant, permanently.
    gilt = await register(env.as, identity(2001), "gilt");
    ok(await gilt.apply_as_sponsor(application("Gilt Labs", [alpha.pledge, beta.pledge])), "apply");
    ok(await env.actor.set_sponsor("gilt", { approved: null }, []), "approve sponsor");

    // The one the rest of this file leans on, and a second beside it. A
    // controller with no profile row approves alone (`Moderation.quorum`),
    // which is what makes the two approvals above one call each — but that
    // caller is about to stop existing, and re-approving a sponsor after the
    // seal takes `Moderation.SECONDS_NEEDED` moderators who do have profile
    // rows. Nothing after the seal can appoint a third, so this pair is every
    // moderator this canister will ever have.
    mod = await register(env.as, identity(2030), "warden");
    ok(await env.actor.set_moderator("warden", true, []), "appoint");
    reeve = await register(env.as, identity(2031), "reeve");
    ok(await env.actor.set_moderator("reeve", true, []), "appoint a second");

    // Nobody at all: never registered, holds no role, owns nothing here.
    // Manual payout recovery must stop this caller before it scans the plan.
    anyone = env.as(identity(2050));
    bystander = await register(env.as, identity(2003), "bystander");

    judges = [];
    for (let i = 0; i < 3; i += 1) {
      const judge = await register(env.as, identity(2010 + i), `judge_${i}`);
      ok(await judge.apply_as_judge(), "apply");
      ok(await env.actor.set_judge(`judge_${i}`, { approved: null }, []), "approve judge");
      judges.push(judge);
    }

    hackers = [];
    ids = new Map();
    wallets = new Map();
    packages = new Map();
    for (let i = 1; i <= 6; i += 1) {
      // Registering and taking the role is no longer enough to enter: a hacker
      // with no reward wallet is refused with `#NoWallet`, because the money
      // has to have somewhere to go before there is anything to pay. The
      // harness's `hacker` does all three — register, wallet, role — and the
      // wallet it picks is deliberately not the principal they signed in with.
      //
      // The wallet is now also the *destination*: a payout row freezes it at
      // draft and the transfer goes straight there, so what is recorded here is
      // the account each prize will land in.
      const who = await hacker(env, 2020 + i, `hack_${i}`);
      hackers.push(who);
      const id = (await who.me())[0].id;
      ids.set(`hack_${i}`, id);
      wallets.set(`hack_${i}`, walletFor(2020 + i));
      packages.set(`hack_${i}`, await uploadPackage(who, id));
    }

    // Two payees, one wallet — nothing forbids it, and two people sharing a
    // hardware wallet or an exchange deposit address is ordinary. h3 and h4
    // both take bronze, on the same ledgers, from the same pool, and the whole
    // plan is stamped with one `created_at_time`: their transfers are identical
    // in amount, fee, destination and nonce. Only the memo — the row id — keeps
    // them apart, and without it the ledger would collapse the second into a
    // `#Duplicate` and one of them would be paid nothing.
    ok(await hackers[3].set_wallet(walletFor(2023)), "hack_4 shares hack_3's wallet");
    wallets.set("hack_4", walletFor(2023));

    // h6 stands out of the prize money. Their silver is still earned and still
    // shows in the bracket; what changes is that `Payout.claims` drops the
    // claim, and because `shares` normalises over the weight actually present
    // that silver is redistributed among the other five rather than left in the
    // treasury. Opting out is the reachable half of a rule that also covers a
    // payee with no wallet at all — there is no way through this interface to
    // clear a wallet, so this is the branch a test can reach.
    ok(await hackers[5].set_reward_opt_out(true), "hack_6 opts out");

    // Freeze the exact draft alongside the cast and funding manifest. Nothing
    // launch-sensitive can be filled in after the controller list is emptied.
    draft = ok(await mod.create_season(), "create");
    ok(await env.seal(), "seal");
    assert.deepEqual(
      (await env.pic.getControllers(env.canisterId)).map((who) => who.toText()),
      [env.canisterId.toText()],
      "the canister itself is the sole controller from here",
    );
  });

  /**
   * Enter an app and get it into the bracket.
   *
   * `submit_entry` only proposes now — it answers with a `#pending` revision
   * and nothing is in the week until a moderator approves it. That reviewer
   * has to be `mod`: the canister is sealed, so `env.actor` is not a controller
   * and `canModerate` no longer waves it through. Who reviews is not what this
   * suite is about — that a real one had to be appointed before the seal is.
   */
  const enter = async (index, title) => {
    const handle = `hack_${index + 1}`;
    const revision = ok(
      await hackers[index].submit_entry(entry(title, packages.get(handle), slugFor(handle))),
      "submit",
    );
    ok(await mod.approve_revision(revision.id), `approve ${title}`);
  };

  after(async () => {
    await env?.teardown();
  });

  it("fills the treasury from a sponsor while the season runs", async () => {
    // A moderator's call, both halves of it. The installer sealed the canister
    // in `before` and is nobody here now, which is precisely why these two are
    // not controller-gated: a controller gate after the seal would mean this
    // canister could never hold a season at all.
    assert.equal(errOf(await env.actor.start_season(draft.id)), "NotAllowed", "not the installer's");
    season = ok(await mod.start_season(draft.id), "start");

    // And the season starting changed nothing about who controls it. The
    // season row does not write down whose
    // keys were taken either — that field is gone with the restoration it
    // existed for.
    const sealed = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      sealed.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the treasury remains exactly self-controlled",
    );
    assert.equal(season.controllers, undefined, "and no list to hand anything back to");
    assert.equal(await env.actor.is_controller(), false, "the installer is not a controller now");

    const [deposit] = await gilt.my_deposit();
    await alpha.send(forLedger(deposit.account), SENT_A);
    await beta.send(forLedger(deposit.account), SENT_B);
    ok(await gilt.notify_deposits(), "notify");

    assert.deepEqual(await env.actor.prize_pool(), [
      [alpha.id, POOL_A],
      [beta.id, POOL_B],
    ]);
    // A season still being played has no reconciled funding cutoff to pay out.
    assert.equal(errOf(await mod.propose_payout(season.id)), "WrongPhase");
  });

  it("plays a season that hands out a gold, a silver and four bronze", async () => {
    // Week 1: five entries, judges back the first two, so h1 advances and all
    // five are inside the top five (the bracket section of the Rules page — the ceiling is not a quota).
    for (let i = 0; i < 5; i += 1) await enter(i, `App ${i + 1}`);
    const week1 = await env.actor.season_week(season.id, 1n, 50n);
    assert.equal(week1.length, 5);
    for (const judge of judges) {
      ok(await judge.cast_vote(week1[0].id), "vote");
      ok(await judge.cast_vote(week1[1].id), "vote");
    }
    // A controller cannot close a week by hand any more — `close_week` is
    // gone, and a week ends when its deadline passes and the canister's own
    // timer resolves it. So the way to the next round is to wait out the
    // calendar, which is what the harness's `closeWeek` does.
    await closeWeek(env);

    // Week 2 empty, week 3 has h6 alone, week 4 empty. That puts one survivor
    // in each half of the bracket: weeks 1–2 are duel A, weeks 3–4 duel B.
    await closeWeek(env);
    await enter(5, "App 6");
    await closeWeek(env);
    await closeWeek(env);

    const semi = await env.actor.season_week(season.id, 5n, 50n);
    assert.equal(semi.length, 2, "one from each half");
    // Nobody votes in the semi: both are walkovers, and the bracket section of the Rules page says a
    // walkover advances on zero votes and still pays silver.
    await closeWeek(env);

    const final = await env.actor.season_week(season.id, 6n, 50n);
    assert.equal(final.length, 2);
    const h1Final = final.find((row) => row.user_id === ids.get("hack_1"));
    for (const judge of judges) ok(await judge.cast_vote(h1Final.id), "vote");

    // The final week closing starts funding reconciliation, not transfers.
    // Keep both ledgers unavailable through the first pass to prove that no
    // partial plan can become visible. Once they return, the final pass must
    // freeze one complete snapshot before it exposes `fundingReady`.
    await stop(alpha);
    await stop(beta);
    await closeWeek(env);

    const [finished] = await env.actor.season_by_number(season.number);
    assert.deepEqual(finished.phase, { finished: null });
    assert.equal(await env.live(), null);

    // h1 holds bronze, silver and gold; h6 holds bronze and silver.
    const outcome = (rows, handle) =>
      Object.keys(rows.find((row) => row.user_id === ids.get(handle)).outcome)[0];
    assert.equal(outcome(await env.actor.season_week(season.id, 1n, 50n), "hack_1"), "advanced");
    assert.equal(outcome(await env.actor.season_week(season.id, 3n, 50n), "hack_6"), "advanced");
    assert.equal(outcome(await env.actor.season_week(season.id, 5n, 50n), "hack_1"), "advanced");
    assert.equal(outcome(await env.actor.season_week(season.id, 5n, 50n), "hack_6"), "advanced");
    assert.equal(outcome(await env.actor.season_week(season.id, 6n, 50n), "hack_1"), "won");
    assert.equal(outcome(await env.actor.season_week(season.id, 6n, 50n), "hack_6"), "none");
  });

  it("reconciles final funding before it arms any payout", async () => {
    // Nobody asked for this. Final close first enters persisted funding
    // reconciliation; payout must remain dark while either frozen ledger is
    // unreachable.
    await env.pic.tick(15);
    assert.deepEqual(await env.actor.payout_plan(season.id), [], "no line can be drafted blind");
    const [tried] = await env.actor.season_by_number(season.number);
    assert.deepEqual(tried.payout, { none: null }, "an empty plan is not written at all");
    assert.equal(tried.fundingReady, false);
    assert.ok(tried.fundingAttempts >= 1n, "the first full reconciliation pass ran");
    assert.equal(await env.actor.funding_closing(), true);
    assert.equal(await env.actor.payout_armed(), false, "payout cannot race the funding cutoff");

    // Give the ledgers back. Handing them back is not enough to restart it:
    // reconciliation retries on its one-minute schedule rather than spinning.
    await start(alpha);
    await start(beta);
    await env.pic.tick(10);
    assert.deepEqual(await env.actor.payout_plan(season.id), [], "it backed off, it did not spin");
  });

  it("drafts one line per payee per ledger, paying only the best finish", async () => {
    // the Trust section of the Rules page: drafting is a moderator's, not a stranger's — and not the
    // installer's either, which is the whole reason `mod` exists. The seal
    // removed the former deployer, so `Principal.isController` is false for
    // that caller and the implicit moderator that came with it is gone
    // for good. Somebody who could still redraft a plan on the strength of
    // having deployed the code would be a hole straight through "the rules
    // cannot change once the entries are in".
    assert.equal(errOf(await hackers[0].propose_payout(season.id)), "NotAllowed");
    assert.equal(errOf(await env.actor.propose_payout(season.id)), "NotAllowed");
    assert.equal(
      errOf(await mod.propose_payout(season.id)),
      "WrongPhase",
      "manual payout stays closed until final funding reconciliation completes",
    );
    const reconciled = await finishFunding(env, season.number);
    assert.equal(reconciled.fundingReady, true);
    assert.deepEqual(reconciled.fundingFailures, []);
    assert.deepEqual(reconciled.payout, { approved: null });

    const plan = await env.actor.payout_plan(season.id);
    assert.equal(plan.length, 10, "the complete plan exists at the funding-ready boundary");
    for (const handle of CLAIMS) {
      assert.equal(await held(alpha, handle), 0n, `@${handle} was paid before the boundary`);
      assert.equal(await held(beta, handle), 0n, `@${handle} was paid before the boundary`);
    }

    // Stop one ledger in the narrow boundary between the funding cutoff and
    // the one-second payout timer. It has already reconciled successfully, but
    // its transfers must now remain retryable while the other ledger settles.
    await stop(beta);
    assert.equal(
      errOf(await mod.propose_payout(season.id)),
      "WrongPhase",
      "manual payout cannot re-read or replace the reconciled plan",
    );

    const awardFor = (handle) => {
      const rows = plan.filter((row) => row.user_id === ids.get(handle));
      assert.equal(rows.length, 2, `@${handle} should be paid once per ledger`);
      const awards = new Set(rows.map((row) => Object.keys(row.award)[0]));
      assert.equal(awards.size, 1);
      return [...awards][0];
    };
    // Awards do not stack: h1 earned all three and is paid gold (the Rewards section of the Rules page,
    // *Only your best finish is paid*).
    assert.equal(awardFor("hack_1"), "gold");
    for (const handle of ["hack_2", "hack_3", "hack_4", "hack_5"]) assert.equal(awardFor(handle), "bronze");

    // h6 earned a silver and has no line at all. A claim is dropped at the
    // source, not planned and then skipped — see the next test for where the
    // silver went.
    assert.equal(plan.filter((row) => row.user_id === ids.get("hack_6")).length, 0);
  });

  it("shares an opted-out hacker's award among everybody else", async () => {
    // The point of `Payout.claims` dropping the claim rather than `Payout.send`
    // skipping the transfer. `shares` divides by the weight actually claimed,
    // so with h6 out the denominator is 4 500 and not 6 500 — every remaining
    // payee is paid *more*, and the pool still empties. Skipping later would
    // have left h6's silver sitting in the treasury forever, which is the
    // opposite of what standing out of the prize money is for.
    const plan = await env.actor.payout_plan(season.id);
    const goldOn = (ledger) =>
      plan.find((row) => row.ledger.toText() === ledger.id.toText() && "gold" in row.award).gross;

    assert.equal(TOTAL_WEIGHT, 4_500n, "gold plus four bronze, with the silver stood down");
    assert.equal(goldOn(alpha), grossFor(POOL_A, "hack_1"));
    assert.notEqual(
      goldOn(alpha),
      (POOL_A * WEIGHT.gold) / (TOTAL_WEIGHT + WEIGHT.silver),
      "the silver's weight must not still be in the denominator",
    );
  });

  it("freezes each ledger's own fee and spends the whole of its pool", async () => {
    const plan = await env.actor.payout_plan(season.id);
    for (const [ledger, pool] of [
      [alpha, POOL_A],
      [beta, POOL_B],
    ]) {
      const rows = plan.filter((row) => row.ledger.toText() === ledger.id.toText());
      assert.equal(rows.length, 5);
      for (const row of rows) {
        assert.equal(row.fee, ledger.fee, `${ledger.symbol}: a line froze the wrong fee`);
        assert.equal(row.gross, grossFor(pool, row.handle));
        // The fee comes out of the payee's share, so the treasury is debited
        // exactly `gross` and the last transfer is affordable by construction.
        assert.equal(row.net, row.gross - row.fee);
        assert.deepEqual(row.state, { planned: null });
        assert.equal(row.attempts, 0n);
        // Frozen at draft from `user.wallet`, and never read from the user row
        // again. A destination that could move between attempts would make a
        // retry a different transfer, the ledger's deduplication would not
        // fire, and the winner would be paid twice.
        assert.equal(row.to.toText(), wallets.get(row.handle).toText());
      }

      // **No dust.** The pool is spent to the unit: the sum of every line is
      // the pool exactly, not the pool less whatever integer division dropped.
      const planned = rows.reduce((sum, row) => sum + row.gross, 0n);
      assert.equal(planned, pool, `${ledger.symbol}: the plan must spend the pool exactly`);

      // One line carries the remainder, and it says so. Which line is settled
      // here at drafting and never at send time — processing order is not
      // stable across retries, and choosing a carrier later would mean
      // recomputing an amount on a frozen plan.
      const carrying = rows.filter((row) => row.dust > 0n);
      assert.equal(carrying.length, 1, `${ledger.symbol}: exactly one line carries the remainder`);
      assert.equal(carrying[0].handle, CARRIER, "the largest payable share, which is the gold");
      assert.equal(carrying[0].dust, remainderOf(pool));
      assert.ok(carrying[0].dust > 0n, `${ledger.symbol}: a remainder worth carrying`);
      assert.equal(carrying[0].note, "carries the remainder of the pool");
      for (const row of rows.filter((r) => r.dust === 0n)) assert.equal(row.note, "");

      // And the ratio between awards is the published one — with the carried
      // remainder taken back off first, since it is not part of any share.
      const gold = rows.find((row) => "gold" in row.award).gross - carrying[0].dust;
      const bronze = rows.find((row) => "bronze" in row.award).gross;
      assert.equal(gold / bronze, 14n, "3 500 : 250");
    }
  });

  it("needs no approval, and offers none", async () => {
    assert.equal(errOf(await mod.propose_payout(season.id)), "WrongPhase");

    // **[decided]** Drafted is approved. There is no human sign-off between the
    // plan and the money, because there is no external controller in the
    // ordinary flow to give it: a controller-gated
    // approval would be a gate nobody could open. The method is not merely
    // refused, it is gone from the interface.
    const [drafted] = await env.actor.season_by_number(season.number);
    assert.ok(
      "approved" in drafted.payout || "paying" in drafted.payout,
      `the automatic sender saw an approved plan: ${JSON.stringify(drafted.payout)}`,
    );
    assert.equal(env.actor.approve_payout, undefined, "approve_payout is not on the canister");
    assert.equal(mod.approve_payout, undefined);

    // And there is no throwing one away either, for the same reason from the
    // other side. `discard` only ever applied to a *proposal*, it was
    // controller-only, and both of those are now empty categories — so rather
    // than leave a gate that no caller could ever pass, the method went with
    // them. An approved plan is auditable, by `payout_plan`, rather than
    // blockable.
    assert.equal(env.actor.discard_payout, undefined, "discard_payout is not on the canister");
    assert.equal(mod.discard_payout, undefined);
    assert.equal((await env.actor.payout_plan(season.id)).length, 10, "and nothing was deleted");

    // Sending is a moderator recovery action. Timers still settle normally
    // without an ingress caller, while a moderator can resume the same worker
    // after a canister freeze. Unregistered and former-controller callers are
    // stopped before any payout work.
    assert.equal(errOf(await anyone.run_payout(season.id)), "NotAllowed");
    assert.equal(errOf(await env.actor.run_payout(season.id)), "NotAllowed");
    //
    // Atomic drafting left its one-second observation boundary before the
    // first send; the preceding test inspected both online ledgers inside it.
  });

  it("pays what it can when a ledger stops answering, and locks withdrawals", async () => {
    // The failure a real distribution actually meets: one ledger unreachable
    // partway through. Calls to a stopped canister are rejected rather than
    // answered, so the loop has to catch that and carry on.
    //
    // Stopped, rather than scripted to return a deterministic error: a rejected
    // inter-canister call is ambiguous, so the row remains claimed with its
    // original arguments and is deferred to the shared hourly retry.
    // Driven by an approved moderator through the same worker the timer uses.
    // Nothing here is the caller's to choose: the frozen plan fixes every
    // amount, destination and transfer identity.
    // Make the frozen plan's one-second observation boundary due without
    // executing a round. The moderator fallback and installed timer may race, but
    // both enter the same lease-protected path and report the same progress.
    await env.pic.advanceTime(SECOND);
    const progress = ok(await mod.run_payout(season.id), "moderator run");
    assert.equal(progress.paid, 5n, "the reachable ledger settled");
    assert.equal(progress.left, 5n, "the unreachable one stayed claimed");
    assert.equal(progress.failed, 0n);

    // Straight into each winner's own wallet, one hop, no custody in between.
    for (const handle of ["hack_1", "hack_2"]) {
      assert.equal(
        await held(alpha, handle),
        netFor(POOL_A, handle, alpha.fee),
        `@${handle} should hold their share less the fee`,
      );
      assert.equal(await alpha.balanceOf(custodyOf(handle)), 0n, "and nothing sits in custody");
    }

    // The claimed rows keep the arguments they were drafted with; the retry
    // below has to send the same ones.
    const claimed = await env.actor.payout_plan(season.id);
    stamps = new Map(
      claimed
        .filter((row) => row.ledger.toText() === beta.id.toText())
        .map((row) => [row.id, row.createdAtTime]),
    );
    const betaRows = claimed.filter((row) => row.ledger.toText() === beta.id.toText());
    assert.equal(
      betaRows.filter((row) => "sending" in row.state).length,
      5,
      "every independently ambiguous row is retained",
    );
    assert.equal(
      betaRows.filter((row) => "planned" in row.state).length,
      0,
      "the scheduler probes beyond earlier deferrals instead of starving later rows",
    );

    // A rejected inter-canister call is ambiguous: that row stays `#sending`
    // with its original transfer arguments. The first failure gets the
    // conservative whole-pass circuit break. Later passes isolate each failed
    // row, so an outage cannot strand a payable row behind several deferrals;
    // every row is tried once, then left to the shared hourly retry.
    const attempts = (ledger) =>
      claimed.filter((row) => row.ledger.toText() === ledger.id.toText()).map((row) => row.attempts);
    assert.deepEqual(attempts(alpha), Array(5).fill(1n), "paid on the first sweep, then left alone");
    assert.deepEqual(
      attempts(beta).toSorted(),
      Array(5).fill(1n),
      "an outage attempts each row once without retrying it in the same run",
    );

    // the Rewards section of the Rules page: withdrawals are refused while a distribution is in flight.
    assert.equal(await env.actor.withdrawals_locked(), true);
    assert.equal(errOf(await hackers[0].withdraw(alpha.id, account(outside))), "Locked");
  });

  it("resumes without paying anyone a second time", async () => {
    await start(beta);

    const before = new Map();
    for (const handle of CLAIMS) before.set(handle, await held(alpha, handle));

    // Restoring a ledger does not bypass the shared one-hour retry window. A
    // moderator nudge inside it is cheap and leaves every frozen row untouched.
    assert.deepEqual(ok(await mod.run_payout(season.id), "early resume"), {
      paid: 5n,
      skipped: 0n,
      failed: 0n,
      left: 5n,
    });
    const waiting = await env.actor.payout_plan(season.id);
    assert.deepEqual(
      waiting
        .filter((row) => row.ledger.toText() === beta.id.toText())
        .map((row) => row.attempts)
        .toSorted(),
      Array(5).fill(1n),
      "the cooldown performed no ledger I/O",
    );

    // Once due, the same moderator can drive the retry. Every attempt re-sends
    // the arguments frozen at draft, so who asks changes nothing about what is
    // sent. The timer may win the due-time race; either path reaches the same
    // persisted progress.
    await env.pic.advanceTime(60 * MINUTE + SECOND);
    let progress;
    for (let i = 0; i < 20; i += 1) {
      progress = ok(await mod.run_payout(season.id), "moderator resume");
      if (progress.left === 0n) break;
      await env.pic.tick(3);
    }
    assert.equal(progress.paid, 10n);
    assert.equal(progress.left, 0n);
    assert.equal(progress.failed, 0n);

    for (const handle of CLAIMS) {
      assert.equal(
        await held(alpha, handle),
        before.get(handle),
        `the resume moved ${handle}'s already-paid ${alpha.symbol} again`,
      );
    }

    const plan = await env.actor.payout_plan(season.id);
    for (const row of plan) {
      assert.deepEqual(row.state, { paid: null }, `${row.handle} on ${row.ledger.toText()}`);
      // These rows were already attempted, so their `created_at_time` is never
      // re-stamped — that would make a retry a second payment.
      if (stamps.has(row.id)) assert.equal(row.createdAtTime, stamps.get(row.id));
    }

    // Every wallet holds exactly the sum of the rows pointing at it, which is
    // two rows on each ledger for the wallet h3 and h4 share.
    const owed = new Map();
    for (const row of plan) {
      const key = `${row.ledger.toText()}|${row.to.toText()}`;
      owed.set(key, (owed.get(key) ?? 0n) + row.net);
    }
    for (const [key, amount] of owed) {
      const [ledgerId, wallet] = key.split("|");
      const ledger = ledgerId === alpha.id.toText() ? alpha : beta;
      assert.equal(await ledger.balanceOf(account(Principal.fromText(wallet))), amount);
    }

    // A row already paid was never touched again. Every ambiguous row on the
    // casualty was retried with its original identity.
    //
    // Alpha was paid once and never revisited. Every Beta row has one ambiguous
    // outage call plus one successful retry.
    const attempts = (ledger) =>
      plan.filter((row) => row.ledger.toText() === ledger.id.toText()).map((row) => row.attempts);
    assert.deepEqual(attempts(alpha), Array(5).fill(1n));
    assert.deepEqual(attempts(beta), Array(5).fill(2n));

    assert.equal(await env.actor.withdrawals_locked(), false);
  });

  it("keeps two payees who name the same wallet apart", async () => {
    // The reason every transfer carries a memo. h3 and h4 named the same
    // wallet and took the same award on the same ledger, so their transfers
    // agree on amount, fee, destination *and* `created_at_time` — the whole
    // plan is stamped with one `now`. ICRC-1 deduplicates on the argument
    // record, so without the row id as a memo the second would come back
    // `#Duplicate`, be marked paid, and move nothing: the shared wallet would
    // hold one bronze instead of two.
    const plan = await env.actor.payout_plan(season.id);
    for (const ledger of [alpha, beta]) {
      const twins = plan.filter(
        (row) =>
          row.ledger.toText() === ledger.id.toText() &&
          row.to.toText() === wallets.get("hack_3").toText(),
      );
      assert.equal(twins.length, 2, `${ledger.symbol}: two rows, one wallet`);
      assert.equal(twins[0].net, twins[1].net, "identical amount");
      assert.equal(twins[0].fee, twins[1].fee, "identical fee");
      assert.equal(twins[0].createdAtTime, twins[1].createdAtTime, "identical nonce");
      assert.notEqual(twins[0].id, twins[1].id, "and only the row id — the memo — to tell them apart");

      assert.equal(
        await ledger.balanceOf(account(wallets.get("hack_3"))),
        twins[0].net + twins[1].net,
        `${ledger.symbol}: both payments landed, so both were distinct transactions`,
      );
    }
  });

  it("leaves nothing at all in the treasury, and says so", async () => {
    // The other half of the no-dust rule. The plan spends the pool exactly, so
    // once every line is `#paid` the treasury is empty — not "empty but for a
    // few units", which is what it held every season before.
    for (const ledger of [alpha, beta]) {
      assert.equal(
        await ledger.balanceOf(account(env.canisterId)),
        0n,
        `${ledger.symbol}: a settled season leaves nothing behind`,
      );
    }
    // Bookkeeping and the ledgers agree — `prize_pool` never asks a ledger.
    assert.deepEqual(await env.actor.prize_pool(), [
      [alpha.id, 0n],
      [beta.id, 0n],
    ]);
  });

  it("returns settled progress on another run without paying twice", async () => {
    // `run_payout` is idempotent after settlement for authorised callers, and
    // rejected callers still cannot make it inspect or resend a row.
    const before = await held(alpha, "hack_1");
    assert.equal(errOf(await anyone.run_payout(season.id)), "NotAllowed");
    assert.equal(errOf(await env.actor.run_payout(season.id)), "NotAllowed");
    assert.deepEqual(ok(await mod.run_payout(season.id)), {
      paid: 10n,
      skipped: 0n,
      failed: 0n,
      left: 0n,
    });
    assert.deepEqual(ok(await reeve.run_payout(season.id)), {
      paid: 10n,
      skipped: 0n,
      failed: 0n,
      left: 0n,
    });
    assert.equal(await held(alpha, "hack_1"), before);
  });

  it("pays the winner's own wallet, not an account they have to drain", async () => {
    // What the rewrite changed. The money never passed through custody: it went
    // from the treasury to the principal h1 set as their wallet, in one hop, so
    // there is nothing left for them to withdraw.
    const mine = await hackers[0].my_payouts();
    assert.equal(mine.length, 2, "one settled line per ledger");
    assert.ok(mine.every((row) => "gold" in row.award && "paid" in row.state));
    for (const row of mine) {
      assert.equal(row.to.toText(), wallets.get("hack_1").toText(), "the row names the wallet");
    }
    assert.equal(await held(alpha, "hack_1"), netFor(POOL_A, "hack_1", alpha.fee));
    assert.equal(await held(beta, "hack_1"), netFor(POOL_B, "hack_1", beta.fee));

    // The custody address is still published and still derived the same way —
    // it is simply not where a season pays any more, so it is empty and
    // `withdraw` has nothing to move.
    const [published] = await hackers[0].my_reward_account();
    assert.deepEqual(Uint8Array.from(published.subaccount[0]), rewardSubaccount(ids.get("hack_1")));
    assert.equal(await alpha.balanceOf(custodyOf("hack_1")), 0n);
    assert.equal(errOf(await hackers[0].withdraw(alpha.id, account(outside))), "Nothing");
  });

  it("still drains a balance that is sitting in custody", async () => {
    // `withdraw` is now a drain path for balances already held in custody —
    // an earlier season's rewards, or anything else that landed there — rather
    // than the way a season pays. Nothing the canister does puts money there,
    // so this puts some there itself and watches it come out.
    const SITTING = 400_000_000n;
    await seedCustody(alpha, "hack_1", SITTING);

    const treasuryBefore = await alpha.balanceOf(account(env.canisterId));
    const out = ok(await hackers[0].withdraw(alpha.id, account(outside)), "withdraw");
    assert.equal(out, SITTING - alpha.fee);
    assert.equal(await alpha.balanceOf(account(outside)), SITTING - alpha.fee);
    assert.equal(await alpha.balanceOf(custodyOf("hack_1")), 0n);
    assert.equal(
      await alpha.balanceOf(account(env.canisterId)),
      treasuryBefore,
      "a withdrawal must not touch the pool",
    );
  });

  it("moves nothing on a second withdrawal", async () => {
    const landed = await alpha.balanceOf(account(outside));
    assert.equal(errOf(await hackers[0].withdraw(alpha.id, account(outside))), "Nothing");
    assert.equal(await alpha.balanceOf(account(outside)), landed);
  });

  it("gives a non-winner nothing and a stranger nothing", async () => {
    // `BadDestination` rather than `Nothing`: since the allowlist became the
    // caller's own payout rows, "a ledger you were never paid on" and "not a
    // ledger we would call for you" are the same fact, and both are refused
    // before any message leaves. Nobody meets this in the UI — `myRewards`
    // only offers ledgers the caller actually holds rewards on.
    assert.equal(errOf(await bystander.withdraw(alpha.id, account(outside))), "BadDestination");
    assert.equal(errOf(await env.as(identity(2004)).withdraw(alpha.id, account(outside))), "NotRegistered");

    // h6 opted out, so they hold no payout row on any ledger — and the
    // allowlist is exactly "a ledger you have been paid on".
    assert.equal(errOf(await hackers[5].withdraw(alpha.id, account(outside))), "BadDestination");
  });

  it("gives a winner no way to name somebody else's custody", async () => {
    // `withdraw` derives its source from the caller, so the only thing an
    // attacker can aim is the destination — and the canister's own accounts are
    // refused outright (the Rewards section of the Rules page).
    const SITTING = 250_000_000n;
    await seedCustody(alpha, "hack_5", SITTING);
    await seedCustody(alpha, "hack_2", SITTING);

    assert.equal(errOf(await hackers[1].withdraw(alpha.id, custodyOf("hack_5"))), "BadDestination");
    assert.equal(errOf(await hackers[1].withdraw(alpha.id, account(env.canisterId))), "BadDestination");
    // A ledger nobody pledged is not somewhere this canister will call.
    assert.equal(errOf(await hackers[1].withdraw(env.canisterId, account(outside))), "BadDestination");
    assert.equal(await alpha.balanceOf(custodyOf("hack_5")), SITTING, "h5 still holds every unit");

    // And h2's own withdrawal takes h2's balance and nothing more.
    assert.equal(ok(await hackers[1].withdraw(alpha.id, account(elsewhere)), "withdraw"), SITTING - alpha.fee);
    assert.equal(await alpha.balanceOf(account(elsewhere)), SITTING - alpha.fee);
    assert.equal(await alpha.balanceOf(custodyOf("hack_5")), SITTING);
  });

  it("never restores the former deployer's keys", async () => {
    // The season is over and the money has landed, which used to be the moment
    // the canister opened up again. There is no such moment now: the seal was
    // not a lease on the length of a season, and the season being finished is
    // not an event that gives anybody anything.
    const stillSealed = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      stillSealed.map((who) => who.toText()),
      [env.canisterId.toText()],
      "paid out, wound up, and still self-controlled",
    );

    // Not "refused for now" — absent. There is no date to wait for, no caller
    // to be, and no argument to pass through these legacy hand-back methods.
    assert.equal(env.actor.release_controllers, undefined, "no release_controllers");
    assert.equal(env.actor.controllers_due_at, undefined, "and no date it would be due");
    assert.equal(anyone.release_controllers, undefined, "not for a stranger either");

    // `Principal.isController` is read live on every call, so if the keys had
    // come back the implicit moderator would come back with them. Neither does.
    // `propose_payout` is refused at the authority gate and not for the phase,
    // which is the sharper of the two answers it could give.
    assert.equal(await env.actor.is_controller(), false);
    assert.equal((await env.actor.moderation_log([], 10n)).total, 0n, "not a moderator again");
    assert.equal(errOf(await env.actor.propose_payout(season.id)), "NotAllowed", "stopped at the gate");
    assert.equal(errOf(await mod.propose_payout(season.id)), "WrongPhase", "and a moderator is not");

    // Nor can the code that decided all of this be replaced now that it has.
    const refused = await env.upgrade().then(() => null, (error) => error);
    assert.ok(refused, "a settled season does not make the canister upgradable");
    assert.match(String(refused), /controller/i, String(refused));
  });

  it("keeps custody reachable while the sponsor record stays permanently frozen", async () => {
    // `withdraw` used to bound which ledgers this canister may call to the ones
    // an *approved* sponsor currently pledged — and a sponsor can leave that
    // set on their own, with `withdraw_sponsor`. Doing so after the season was
    // paid stranded every balance held in custody on the tokens that sponsor
    // funded: there was no longer any ledger argument `withdraw` would accept
    // for it. An ordinary moderation decision — setting the sponsor to #no or
    // #pending — did it too. Nothing in the Rewards section of the Rules page makes a winner's access to
    // their own money contingent on a sponsor staying.
    //
    // The allowlist is now per caller: a ledger they hold a payout row on.
    const held5 = await alpha.balanceOf(custodyOf("hack_5"));
    assert.ok(held5 > 0n);

    // Neither a moderator nor the sponsor can rewrite the frozen funding
    // record after launch, even after every payout has settled.
    assert.deepEqual(await mod.set_sponsor("gilt", { no: null }, []), {
      err: { SponsorsFrozen: null },
    });
    assert.deepEqual(await gilt.withdraw_sponsor(), { err: { Settling: null } });
    assert.deepEqual(await env.actor.treasury_ledgers(), [alpha.id, beta.id]);

    const landed = ok(
      await hackers[4].withdraw(alpha.id, account(outside)),
      "a winner reaching their own custody with the funding record frozen",
    );
    assert.equal(landed, held5 - alpha.fee);
    assert.equal(await alpha.balanceOf(custodyOf("hack_5")), 0n, "the custody account emptied");

    assert.deepEqual((await gilt.me())[0].sponsorStatus, { approved: null });
  });

});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A season with one entrant and almost no money.
 *
 * A second canister rather than a second season, because a second season on one
 * canister is not a thing that happens: `Season.create` refuses once a season
 * row exists, and the next season anybody runs is a fresh canister with a fresh
 * treasury of its own. So the fixture above cannot be reused — its season is
 * spent and so is its pool — and standing a second canister up is not a way
 * around that rule, it is what a second season *is*.
 *
 * It is worth the second `bootstrap` because six placed hackers and a pool
 * worth splitting are the wrong shape for either case here. One is the Rewards section of the Rules page,
 * *A thin season*: "A lone winner takes all of it", with no remainder to carry
 * because there is nobody to carry it past. The other is a pool that cannot pay
 * from itself at all — a share smaller than the ledger's own transfer fee is
 * written off with a reason, rather than retried until the timer gives up.
 */
describe("a season with one entrant and almost no money", () => {
  let env;
  let alpha;
  let beta;
  let gilt;
  let mod;
  let winner;
  let draft;
  let season;

  /** Enough to split, if there were anybody to split it with. */
  const TOP_UP = 1_000_000_000n;
  /** The wallet the prize is owed to — set by `hacker`, and not the signing key. */
  const wallet = walletFor(2121);

  before(async () => {
    env = await bootstrap();
    const holder = identity(2100);
    alpha = await installLedger(env.pic, {
      symbol: "TESTA",
      name: "Test Alpha",
      decimals: 8,
      fee: 10_000n,
      supply: 10n ** 14n,
      holder,
      controller: env.controller,
    });
    beta = await installLedger(env.pic, {
      symbol: "TESTB",
      name: "Test Beta",
      decimals: 6,
      fee: 1_000n,
      supply: 10n ** 12n,
      holder,
      controller: env.controller,
    });
    ok(
      await env.actor.set_ledger_allowlist([alpha.id, beta.id]),
      "configure the two real ledgers",
    );

    // The same order the fixture above runs in, and for the same reason: every
    // line here reads `Principal.isController`, and the seal at the bottom is
    // the last moment there is one to read. One moderator is enough for this
    // suite — the sponsor is approved on the controller exception while it
    // still exists, and nothing after the seal needs a second signature.
    gilt = await register(env.as, identity(2101), "gilt");
    ok(await gilt.apply_as_sponsor(application("Gilt Labs", [alpha.pledge, beta.pledge])), "apply");
    ok(await env.actor.set_sponsor("gilt", { approved: null }, []), "approve sponsor");

    mod = await register(env.as, identity(2130), "warden");
    ok(await env.actor.set_moderator("warden", true, []), "appoint");

    // The entire field. Registration closes when the season opens, so a season
    // with one entrant is a season that had one *registered* hacker before it
    // started — there is no thinning it out afterwards.
    winner = await hacker(env, 2121, "hack_1");

    draft = ok(await mod.create_season(), "create");
    ok(await env.seal(), "seal");
  });

  after(async () => {
    await env?.teardown();
  });

  it("pays a lone winner the whole pool, and skips what cannot cover its fee", async () => {
    season = ok(await mod.start_season(draft.id), "start");
    assert.deepEqual(
      (await env.pic.getControllers(env.canisterId)).map((who) => who.toText()),
      [env.canisterId.toText()],
      "on an exactly self-controlled canister",
    );

    // Beta gets a sum that survives its own sweep fee but cannot survive a
    // transfer fee afterwards: 1 500 in, 500 into the treasury. That is the one
    // way a pool too small to pay out arises, now that a settled season leaves
    // no dust behind.
    const CRUMB = beta.fee + 500n;
    const [deposit] = await gilt.my_deposit();
    await alpha.send(forLedger(deposit.account), TOP_UP);
    await beta.send(forLedger(deposit.account), CRUMB);
    await env.advance(MINUTE + SECOND);
    ok(await gilt.notify_deposits(), "notify");

    const poolA = await alpha.balanceOf(account(env.canisterId));
    const poolB = await beta.balanceOf(account(env.canisterId));
    assert.equal(poolA, TOP_UP - alpha.fee, "the sweep costs one fee per ledger");
    assert.equal(poolB, CRUMB - beta.fee);

    // Nobody votes on it. An uncontested entry is carried through the whole
    // bracket on nothing, which is what makes this a thin season rather than a
    // small one — the prize is not for beating anybody.
    const id = (await winner.me())[0].id;
    const revision = ok(
      await winner.submit_entry(
        entry("Alone", await uploadPackage(winner, id), slugFor("hack_1")),
      ),
      "submit",
    );
    ok(await mod.approve_revision(revision.id), "approve");

    // Read before the last round closes, because closing it is what pays: the
    // timer is armed by the close and can be finished before the call that
    // advanced the clock has even returned.
    const before = await alpha.balanceOf(account(wallet));
    for (let round = 1; round <= 6; round += 1) await closeWeek(env);

    // Nobody drafts and nobody signs: the last round first reconciles every
    // frozen deposit at the five-minute cutoff, then arms the payout timer.
    const reconciled = await finishFunding(env, season.number);
    assert.equal(reconciled.fundingReady, true);
    const progress = await settle(env, season.id);
    assert.equal(progress.left, 0n);
    assert.equal(await env.actor.payout_armed(), false, "and it stands down once it has finished");

    const plan = await env.actor.payout_plan(season.id);
    assert.equal(plan.length, 2);
    const line = (ledger) => plan.find((row) => row.ledger.toText() === ledger.id.toText());
    assert.equal(line(alpha).gross, poolA, "one claim, so the whole pool");
    assert.equal(line(alpha).dust, 0n, "and nothing for it to carry — it already has all of it");
    assert.deepEqual(line(alpha).award, { gold: null });
    // The other pool cannot cover its own fee, so it is written off rather than
    // attempted forever (the Rewards section of the Rules page).
    assert.equal(line(beta).gross, poolB);
    assert.deepEqual(line(beta).state, { skipped: null });
    assert.equal(line(beta).note, "share does not cover the transfer fee");

    assert.equal(
      await alpha.balanceOf(account(wallet)),
      before + line(alpha).net,
      "and it lands in the winner's own wallet, in one hop",
    );
    assert.equal(
      await alpha.balanceOf(account(env.canisterId)),
      0n,
      "a lone winner leaves the treasury empty on that ledger",
    );
    assert.equal(await beta.balanceOf(account(env.canisterId)), poolB, "the skipped share stayed put");
  });

  it("has no next season to roll the skipped pool into", async () => {
    // The write-off above is final on this canister, and that is the point of
    // recording a reason for it rather than leaving the line pending. There is
    // no later distribution here to sweep it up: one canister, one season, so
    // what a season cannot pay it does not pay, and the row says why.
    const next = await mod.create_season();
    assert.match(next.err?.Invalid ?? "", /already has one/, "no second season to carry it");
    assert.equal(await env.actor.payout_armed(), false, "and nothing armed to try again");

    // Still readable, which is what makes the write-off auditable rather than
    // merely quiet — the plan outlives the season that produced it.
    const plan = await env.actor.payout_plan(season.id);
    assert.deepEqual(plan.find((row) => row.ledger.toText() === beta.id.toText()).state, {
      skipped: null,
    });
  });
});

/**
 * Let the canister's own payout timer run to a standstill.
 *
 * Drafting reads a balance and a fee from every ledger and sending is one call
 * per line, so a distribution takes many rounds; `closeWeek` produces a
 * handful. The guard on `paid + skipped + failed` is what stops this returning
 * the all-zero progress of a plan that has not been written yet.
 */
/** Advance to the published five-minute cutoff, one replica round at a time. */
async function finishFunding(env, seasonNumber) {
  await env.pic.advanceTime(5 * MINUTE + SECOND);
  for (let i = 0; i < 80; i += 1) {
    await env.pic.tick(1);
    const [season] = await env.actor.season_by_number(seasonNumber);
    if (season.fundingReady) return season;
  }
  throw new Error("final funding reconciliation never completed");
}

async function settle(env, seasonId) {
  // Atomic drafting deliberately leaves a one-second observation boundary
  // before the first transfer, so tests can inspect or interrupt the plan.
  await env.pic.advanceTime(SECOND);
  for (let i = 0; i < 60; i += 1) {
    await env.pic.tick(3);
    const progress = await env.actor.payout_progress(seasonId);
    if (progress.left === 0n && progress.paid + progress.skipped + progress.failed > 0n) {
      return progress;
    }
  }
  throw new Error("the canister never finished paying by itself");
}
