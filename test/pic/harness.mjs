/**
 * Shared setup for the PocketIC suite.
 *
 * `ash test` and this run against the same canister but answer different
 * questions. `ash` calls the Motoko libraries directly: fast, precise about a
 * single function, and it reports instruction counts — which is what makes it
 * the place for correctness-of-a-unit and for watching performance drift. It
 * cannot advance the clock, and its replica gains a nanosecond per call, so a
 * timer with a real deadline never comes due there.
 *
 * Here the canister is installed for real and driven through its actual
 * interface by many identities, with a clock that can be pushed forward.
 * That makes it the place for anything about *behaviour over time* — a season
 * closing its own weeks, a judges voting across six of them, a payout running —
 * and for anything that only goes wrong at scale.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { PocketIc, PocketIcServer } from "@dfinity/pic";
import { Ed25519KeyIdentity } from "@dfinity/identity";

import { idlFactory } from "../../frontend/src/declarations/hackathon.js";
import { runMoc } from "../../scripts/motoko-toolchain.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
/**
 * The gzipped module, not the raw one.
 *
 * `install_code` sent as ingress is capped at 2 MiB including the module, and
 * this canister's raw wasm is past that. The replica sniffs the gzip magic
 * bytes and inflates it, so a compressed module is a documented input rather
 * than a workaround. `npm run pic:prep` writes it via scripts/build-backend.mjs;
 * for what the failure looks like when it is missing, because it is extremely
 * unobvious — every test fails at once for no visible reason.
 */
export const WASM = resolve(ROOT, ".build", "hackathon.wasm.gz");
const LAUNCH_LEDGER_SOURCE = resolve(import.meta.dirname, "launch-ledger.mo");
const LAUNCH_LEDGER_WASM = resolve(ROOT, ".build", "pic-launch-ledger.wasm");

const launchLedgerIdl = ({ IDL }) => {
  const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  return IDL.Service({
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc1_fee: IDL.Func([], [IDL.Nat], ["query"]),
  });
};

/** Compile the public zero-balance ICRC fixture once per checkout. */
function launchLedgerWasm() {
  const stale =
    !existsSync(LAUNCH_LEDGER_WASM) ||
    statSync(LAUNCH_LEDGER_WASM).mtimeMs < statSync(LAUNCH_LEDGER_SOURCE).mtimeMs;
  if (stale) {
    mkdirSync(resolve(ROOT, ".build"), { recursive: true });
    runMoc(["-c", "--release", "-o", LAUNCH_LEDGER_WASM, LAUNCH_LEDGER_SOURCE]);
  }
  return readFileSync(LAUNCH_LEDGER_WASM);
}

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const DAY = 24 * 60 * MINUTE;
export const WEEK = 7 * DAY;
const MISSING_USER_ID = (1n << 64n) - 1n;

export const judgeTarget = (user) => ({
  id: user.id,
  expectedStatus: user.judgeStatus,
  expectedUpdatedAt: user.updatedAt,
});

export const sponsorTarget = (user) => ({
  id: user.id,
  expectedStatus: user.sponsorStatus,
  expectedUpdatedAt: user.updatedAt,
});

export const moderatorTarget = (user) => ({
  id: user.id,
  expectedOn: user.moderator,
  expectedUpdatedAt: user.updatedAt,
});

/**
 * Keep the large PocketIC suite readable while the production API remains
 * strict. Existing fixtures name setup subjects by handle; this adapter
 * resolves that handle immediately before the call and sends the immutable
 * id/state/version tuple the canister now requires. Tests for stale snapshots
 * pass a target record directly and bypass the convenience lookup.
 */
function withRoleTargets(actor) {
  const missingRole = {
    id: MISSING_USER_ID,
    expectedStatus: { no: null },
    expectedUpdatedAt: 0n,
  };
  const missingModerator = {
    id: MISSING_USER_ID,
    expectedOn: false,
    expectedUpdatedAt: 0n,
  };
  const find = async (handle) => (await actor.profile(handle))[0] ?? null;
  const rawJudge = actor.set_judge.bind(actor);
  const rawSponsor = actor.set_sponsor.bind(actor);
  const rawModerator = actor.set_moderator.bind(actor);

  return new Proxy(actor, {
    get(target, property, receiver) {
      if (property === "set_judge") {
        return async (subject, status, note) => {
          if (typeof subject !== "string") return rawJudge(subject, status, note);
          const user = await find(subject);
          return rawJudge(user ? judgeTarget(user) : missingRole, status, note);
        };
      }
      if (property === "set_sponsor") {
        return async (subject, status, note) => {
          if (typeof subject !== "string") return rawSponsor(subject, status, note);
          const user = await find(subject);
          return rawSponsor(user ? sponsorTarget(user) : missingRole, status, note);
        };
      }
      if (property === "set_moderator") {
        return async (subject, on, note) => {
          if (typeof subject !== "string") return rawModerator(subject, on, note);
          const user = await find(subject);
          return rawModerator(user ? moderatorTarget(user) : missingModerator, on, note);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * A deterministic identity per number, so a test can name its cast and get the
 * same principals every run.
 */
export function identity(n) {
  const seed = new Uint8Array(32);
  new DataView(seed.buffer).setUint32(0, n);
  return Ed25519KeyIdentity.generate(seed);
}

/**
 * Install the canister with `controller` as its only controller.
 *
 * The controller matters for **setup and nothing else**. It appoints
 * moderators, uploads assets and sets the allowance — and then, once
 * `seal_canister()` leaves only the canister itself, the installer has no
 * powers at all and `Profiles.canModerate` stops treating it as a moderator.
 *
 * So a fixture that needs a season has to seat a moderator *before* sealing:
 * creating and starting a season are moderator calls, because no external
 * caller can invoke self-controller authority after the seal. There is no
 * closing a week early either — the bracket moves on its own deadline and
 * nobody may nudge it.
 */
export async function bootstrap({ controller = identity(0), launch = true } = {}) {
  if (!readFileSync(WASM).length) throw new Error(`empty wasm at ${WASM}`);

  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  const fixture = await pic.setupCanister({
    idlFactory,
    wasm: WASM,
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });

  const { actor: rawActor, canisterId } = fixture;
  const actor = withRoleTargets(rawActor);
  actor.setIdentity(controller);

  // The canister has to be one of its own controllers before a season can
  // start: `start_season` seals, and `update_settings` has no self-exemption,
  // so a canister that is not already a controller cannot change its own
  // settings. On a real deployment a human does this once by hand; here it is
  // part of standing the fixture up, and it is the same step.
  await pic.updateCanisterSettings({
    canisterId,
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal(), canisterId],
  });

  /** The same canister seen as somebody else. */
  const actors = [];
  const as = (who) => {
    const rawView = pic.createActor(idlFactory, canisterId);
    rawView.setIdentity(who);
    const view = withRoleTargets(rawView);
    actors.push(view);
    return view;
  };

  let launchLedger = null;
  if (launch) {
    const installed = await pic.setupCanister({
      idlFactory: launchLedgerIdl,
      wasm: launchLedgerWasm(),
      sender: controller.getPrincipal(),
      controllers: [controller.getPrincipal()],
    });
    launchLedger = installed.canisterId;
    ok(await actor.set_ledger_allowlist([launchLedger]), "configure launch ledger allowlist");
  }

  /**
   * Finish the production launch invariants before the irreversible seal.
   *
   * Every season now needs a validated immutable ledger, an approved sponsor
   * that pledged it, and no applications left pending.  Reuse a registered
   * fixture participant so the common setup does not perturb user ids or user
   * totals; roles deliberately stack in the real canister too.  Suites about
   * actual money can configure and approve their own sponsor first, in which
   * case this only clears any remaining applications.
   */
  const prepareLaunch = async () => {
    if (!launchLedger) {
      throw new Error("bootstrap({ launch: false }) requires an explicit launch setup before sealing");
    }

    const draft = await actor.season();
    if (!draft) {
      throw new Error("create the draft season before env.seal(); production seals only a complete launch");
    }

    let stats = await actor.stats();

    // A sealed fixture must have the same minimum independent bench as a
    // production launch. Most suites care about another invariant and create
    // only the actors they exercise, so fill only the missing seats with
    // isolated fixture accounts. One account may hold both roles in the real
    // canister; using it for both here keeps the fixture small as well.
    const missingGovernors = Math.max(
      0,
      Number(3n - (stats.moderators < 3n ? stats.moderators : 3n)),
      Number(3n - (stats.judges < 3n ? stats.judges : 3n)),
    );
    for (let i = 0; i < missingGovernors; i += 1) {
      const handle = `launch_guard_${i}`;
      const guard = await register(as, identity(4_000_000_000 + i), handle);
      ok(await actor.set_moderator(handle, true, []), `appoint ${handle}`);
      ok(await guard.apply_as_judge(), `${handle} applies to judge`);
      ok(await actor.set_judge(handle, { approved: null }, []), `approve ${handle}`);
    }
    stats = await actor.stats();

    // Readiness deliberately rejects unresolved applications. They are not
    // part of the launch roster, so the shared fixture closes them before the
    // irreversible operation instead of silently carrying them into a run.
    if (stats.pending > 0n) {
      const pending = await actor.users_admin_page({ pending: null }, [], [], 200n);
      for (const profile of pending.rows) {
        ok(await actor.set_judge(profile.handle, { no: null }, []), `decide judge ${profile.handle}`);
      }
      stats = await actor.stats();
    }

    if (stats.sponsors === 0n) {
      const profiles = [];
      for (const view of actors) {
        const [profile] = await view.me();
        if (profile) profiles.push({ view, profile });
      }
      const candidate =
        profiles.find(({ profile }) => profile.moderator && "no" in profile.sponsorStatus) ??
        profiles.find(({ profile }) => "no" in profile.sponsorStatus);
      if (!candidate) throw new Error("launch needs one registered participant to sponsor the season");

      ok(
        await candidate.view.apply_as_sponsor({
          org: "PocketIC Launch Sponsor",
          website: "",
          logo: [],
          blurb: "Zero-balance fixture used only to satisfy launch invariants.",
          ledgers: [{ id: launchLedger, sns: false }],
        }),
        "apply launch sponsor",
      );
      ok(
        await actor.set_sponsor(candidate.profile.handle, { approved: null }, []),
        "approve launch sponsor",
      );
      stats = await actor.stats();
    }

    if (stats.sponsorsPending > 0n) {
      const pending = await actor.users_admin_page({ sponsorsPending: null }, [], [], 200n);
      for (const profile of pending.rows) {
        ok(await actor.set_sponsor(profile.handle, { no: null }, []), `decide sponsor ${profile.handle}`);
      }
    }

    const config = await actor.config();
    if (config.registrationOpen) {
      ok(await actor.set_config(config.siteTitle, false), "close registration for launch");
    }
  };

  const seal = async () => {
    await prepareLaunch();
    return actor.seal_canister();
  };

  /**
   * Move the clock and let the replica catch up.
   *
   * `advanceTime` only sets the time; nothing runs until a round is produced,
   * and a timer that fires makes a call of its own that needs another round to
   * land. Two ticks is the documented amount for a message to be processed —
   * this takes a few more, cheaply, so a chain of timer-then-close-then-rearm
   * settles before the caller looks at the result.
   */
  const advance = async (ms, rounds = 5) => {
    await pic.advanceTime(ms);
    await pic.tick(rounds);
  };

  /**
   * Upgrade in place, keeping the heap.
   *
   * The canister uses Motoko's enhanced orthogonal persistence, where the whole
   * heap survives — so the platform insists the intent is stated rather than
   * inferred. `keep` is the ordinary upgrade; `replace` would discard
   * everything not in a stable variable, which here is everything.
   */
  const upgrade = async () => {
    await pic.upgradeCanister({
      canisterId,
      wasm: WASM,
      sender: controller.getPrincipal(),
      upgradeModeOptions: {
        skip_pre_upgrade: [],
        wasm_memory_persistence: [{ keep: null }],
      },
    });
    await pic.tick(3);
  };

  /** The running season, if any — not merely the newest row. */
  const live = async () => (await actor.season_running())[0] ?? null;

  const teardown = async () => {
    await pic.tearDown();
    await server.stop();
  };

  return {
    pic,
    actor,
    as,
    canisterId,
    controller,
    launchLedger,
    prepareLaunch,
    seal,
    advance,
    upgrade,
    live,
    teardown,
  };
}

/** Unwrap a `Result`, throwing what the canister said rather than "undefined". */
export function ok(result, what = "call") {
  if (result && typeof result === "object" && "err" in result) {
    throw new Error(`${what}: ${JSON.stringify(result.err, bigints)}`);
  }
  return result.ok;
}

export const bigints = (_, value) => (typeof value === "bigint" ? value.toString() : value);

/** Register `handle` under a fresh identity and hand back both. */
export async function register(as, who, handle, over = {}) {
  const actor = as(who);
  ok(
    await actor.register({
      handle,
      displayName: handle,
      title: [],
      bio: "",
      links: [],
      // The one acceptance, and it covers every role. `Profiles.validate`
      // refuses a registration without it, so there is no such thing as a
      // stored account that agreed to nothing.
      terms: true,
      ...over,
    }),
    `register ${handle}`,
  );
  return actor;
}

/**
 * Let the open week run out.
 *
 * There is no `close_week` any more — a controller cannot advance the bracket
 * by hand, which is the point: the calendar is the same for everybody and is
 * not somebody's to nudge. So a test that wants the next week does what a real
 * season does and waits for the deadline.
 *
 * Returns the season as it stands afterwards, which for the last week of a
 * season is `#finished`.
 */
export async function closeWeek(env) {
  await env.advance(WEEK + SECOND);
  const [season] = await env.actor.season();
  return season;
}

/**
 * A reward wallet, derived from the identity seed so it is stable per test.
 *
 * A hacker cannot submit without one — see `Review.proposeEntry`. It must not
 * be the principal they signed in with, so this deliberately uses a different
 * seed from the caller's.
 */
export const walletFor = (seed) => identity(seed + 900_000).getPrincipal();

/** Register, and give them somewhere to be paid. */
export async function hacker(env, seed, handle) {
  const actor = await register(env.as, identity(seed), handle);
  ok(await actor.set_wallet(walletFor(seed)), `wallet ${handle}`);
  // Nothing further to accept: the agreement taken at registration covers
  // every role, so taking one is just taking it.
  ok(await actor.set_hacker(true), `hacker ${handle}`);
  return actor;
}

export const phaseOf = (season) => Object.keys(season.phase)[0];
