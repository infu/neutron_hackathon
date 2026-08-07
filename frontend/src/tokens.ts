/**
 * Reading an ICRC-1 ledger's own metadata.
 *
 * The catalogue in `ledgers.ts` says what a token is called; this says whether
 * the canister actually answers. A sponsor names a ledger, we ask it directly,
 * and only what it tells us is shown — so an id that is mistyped, retired, or
 * simply not a ledger fails at the moment it is entered rather than at the
 * moment somebody tries to send tokens to it.
 *
 * That is also where most logos come from. Baking dozens of base64 logos into
 * the bundle to draw a dropdown would be silly; five production tokens are the
 * small exception because their raster fallbacks are reviewed below.
 */

import { Actor, HttpAgent, type ActorSubclass } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";

import { IS_LOCAL } from "./ic";
import { LEDGER_BY_ID, type KnownLedger } from "./ledgers";

export type TokenMeta = {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Data URI or URL, when the ledger publishes one. */
  logo: string | null;
  fee: bigint | null;
  /** Launched through the SNS. Known from the catalogue, not from the ledger. */
  sns: boolean;
};

type MetaValue = { Nat: bigint } | { Int: bigint } | { Text: string } | { Blob: Uint8Array };

interface LedgerService {
  icrc1_metadata: () => Promise<[string, MetaValue][]>;
  icrc1_balance_of: (account: LedgerAccount) => Promise<bigint>;
}

/** An ICRC-1 account as candid hands it over. */
export type LedgerAccount = {
  owner: Principal;
  subaccount: [] | [Uint8Array | number[]];
};

const ledgerInterface: IDL.InterfaceFactory = ({ IDL: idl }) => {
  const Value = idl.Rec();
  Value.fill(
    idl.Variant({
      Nat: idl.Nat,
      Int: idl.Int,
      Text: idl.Text,
      Blob: idl.Vec(idl.Nat8),
    }),
  );
  const Account = idl.Record({
    owner: idl.Principal,
    subaccount: idl.Opt(idl.Vec(idl.Nat8)),
  });
  return idl.Service({
    icrc1_metadata: idl.Func([], [idl.Vec(idl.Tuple(idl.Text, Value))], ["query"]),
    icrc1_balance_of: idl.Func([Account], [idl.Nat], ["query"]),
  });
};

/**
 * Where to look a ledger up.
 *
 * Deployed, there is one answer: the gateway serving the app. Locally there
 * are two, and neither alone is right. A local replica has never heard of
 * ckBTC, so the catalogue ledgers have to come from the public gateway — but
 * mainnet has never heard of a test ledger someone just installed on their
 * replica, and those are the only ones a local deposit can actually move.
 *
 * So locally we try both, ordered by which is more likely: a catalogue id is
 * mainnet's, anything else is probably local. Query calls to a ledger are
 * read-only and anonymous, so neither needs an identity.
 */
const MAINNET = "https://icp-api.io";
const HERE = window.location.origin;

/**
 * Vetted raster fallbacks for five of this event's production tokens.
 *
 * NTN publishes a PNG already. The ck ledgers publish SVGs and ICP publishes
 * no logo, so relying only on arbitrary live metadata leaves four launch
 * tokens without a mark. Keep those untrusted SVGs rejected below and serve
 * these reviewed, same-origin PNGs instead.
 */
const TRUSTED_TOKEN_LOGOS = new Map<string, string>([
  ["f54if-eqaaa-aaaaq-aacea-cai", "/token-logos/ntn.png"],
  ["ryjl3-tyaaa-aaaaa-aaaba-cai", "/token-logos/icp.png"],
  ["mxzaz-hqaaa-aaaar-qaada-cai", "/token-logos/ckbtc.png"],
  ["xevnm-gaaaa-aaaar-qafnq-cai", "/token-logos/ckusdc.png"],
  ["cngnf-vqaaa-aaaar-qag4q-cai", "/token-logos/ckusdt.png"],
]);

const agents = new Map<string, Promise<HttpAgent>>();
function ledgerAgent(host: string): Promise<HttpAgent> {
  let agent = agents.get(host);
  if (!agent) {
    const localReplica = host === HERE && IS_LOCAL;
    agent = HttpAgent.create({
      host,
      ...(localReplica
        ? {
            shouldFetchRootKey: true,
            shouldSyncTime: true,
          }
        : {}),
    });
    agents.set(host, agent);
  }
  return agent;
}

/** Most likely host first. Deployed, there is only ever one. */
function hostsFor(id: string): string[] {
  if (!IS_LOCAL) return [HERE];
  return knownToken(id) ? [MAINNET, HERE] : [HERE, MAINNET];
}

/** Resolved metadata, kept for the session — a ledger's name does not move. */
const cache = new Map<string, TokenMeta>();

export function cachedToken(id: string): TokenMeta | null {
  return cache.get(id) ?? null;
}

/** What the catalogue knows, before anything is fetched. */
export function knownToken(id: string): KnownLedger | null {
  return LEDGER_BY_ID.get(id) ?? null;
}

export function trustedTokenLogo(id: string): string | null {
  return TRUSTED_TOKEN_LOGOS.get(id) ?? null;
}

export class TokenError extends Error {}

/**
 * How many decimal places a ledger says it has, held to a range we can draw.
 *
 * The list is not a whitelist — a sponsor may name any canister — so this
 * number is written by software nobody here controls, and it is used as an
 * exponent. ICRC-1 calls decimals a Nat, but the metadata variant carries an
 * Int as well, and the payload is taken as it comes: a ledger answering `-5`
 * reaches `10n ** BigInt(-5)`, which throws. A throw while a component renders
 * takes the whole tree down with it, so one hostile canister would blank every
 * page that so much as mentions it. A vast one does not throw — it pads each
 * amount out to that many characters instead, which is no better to look at.
 *
 * Anything outside what a real token uses is therefore read as not published
 * at all. ckETH has the most of any we know of, at eighteen.
 */
const MAX_DECIMALS = 30;
const DEFAULT_DECIMALS = 8;

/**
 * A ledger's logo, if it is one we are willing to draw.
 *
 * Same reasoning as `decimalsOf`, and the same source: a canister a sponsor
 * named. This string goes straight into an `<img src>`, so an `https://` logo
 * is a tracking pixel that fires at whichever moderator opens the review queue,
 * needing nothing more than a pending application. The backend refuses exactly
 * that for a sponsor's *own* logo, and the app's `img-src` policy blocks the
 * request — but neither is a reason to hand the URL to the browser and rely on
 * being saved further down.
 *
 * So: an inline image or nothing. No SVG — it will not execute inside an
 * `<img>`, but it is a document format with a parser attached, and a logo has
 * no use for one.
 */
const LOGO_TYPES = ["png", "jpeg", "jpg", "webp", "gif", "avif"];

export function logoOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const declared = /^data:image\/([a-z0-9+.-]+)[;,]/.exec(value);
  if (!declared) return null;
  return LOGO_TYPES.includes(declared[1]) ? value : null;
}

export function decimalsOf(value: unknown): number {
  if (typeof value !== "bigint" && typeof value !== "number") return DEFAULT_DECIMALS;
  // `Number` of a large enough bigint is Infinity rather than an error, and a
  // number from anywhere else may be fractional or NaN; `isInteger` is false
  // for all three.
  const places = Number(value);
  if (!Number.isInteger(places) || places < 0 || places > MAX_DECIMALS) {
    return DEFAULT_DECIMALS;
  }
  return places;
}

export async function fetchToken(id: string): Promise<TokenMeta> {
  const hit = cache.get(id);
  if (hit) return hit;

  let canisterId: Principal;
  try {
    canisterId = Principal.fromText(id.trim());
  } catch {
    throw new TokenError("That is not a canister id.");
  }

  let entries: [string, MetaValue][] | null = null;
  for (const host of hostsFor(id)) {
    try {
      const actor = Actor.createActor<LedgerService>(ledgerInterface, {
        agent: await ledgerAgent(host),
        canisterId,
      }) as ActorSubclass<LedgerService>;
      entries = await actor.icrc1_metadata();
      break;
    } catch {
      // Not there, not a ledger, or not reachable — indistinguishable from
      // here, and the next host may still have it.
    }
  }
  if (!entries) {
    throw new TokenError("That canister did not answer as an ICRC-1 ledger.");
  }

  const read = (key: string) => {
    const found = entries.find(([name]) => name === key);
    if (!found) return null;
    return Object.values(found[1])[0] as string | bigint | Uint8Array;
  };

  const symbol = read("icrc1:symbol");
  if (typeof symbol !== "string" || symbol === "") {
    throw new TokenError("That ledger does not publish a symbol.");
  }
  const name = read("icrc1:name");
  const decimals = read("icrc1:decimals");
  const logo = read("icrc1:logo");
  const fee = read("icrc1:fee");

  const meta: TokenMeta = {
    id,
    symbol,
    name: typeof name === "string" && name !== "" ? name : symbol,
    decimals: decimalsOf(decimals),
    logo: logoOf(logo) ?? trustedTokenLogo(id),
    fee: typeof fee === "bigint" ? fee : null,
    sns: knownToken(id)?.sns ?? false,
  };
  cache.set(id, meta);
  return meta;
}

/**
 * An amount in a token's own units.
 *
 * Trailing zeros are dropped — ckETH has eighteen decimals, and "1.500000…"
 * says nothing that "1.5" does not.
 */
export function formatAmount(amount: bigint, decimals: number): string {
  // Checked again rather than trusted. Every figure that reaches here has been
  // through `decimalsOf` once already, at the boundary where it was read — but
  // this runs during render, where the penalty for a bad exponent is a blank
  // page rather than a wrong number, and that is too much to stake on every
  // future caller having got its number from the right place.
  const places = decimalsOf(decimals);
  if (places === 0) return amount.toLocaleString();
  const base = 10n ** BigInt(places);
  const whole = amount / base;
  const rest = (amount % base).toString().padStart(places, "0").replace(/0+$/, "");
  return rest === "" ? whole.toLocaleString() : `${whole.toLocaleString()}.${rest}`;
}

/**
 * A balance, read straight from the ledger by the browser.
 *
 * Deliberately not asked of our canister. A canister method that takes a
 * ledger id and calls it lets any caller spend the canister's cycles on a
 * canister of their choosing — so the address comes from us and the balance
 * comes from the ledger. `icrc1_balance_of` is a public anonymous query, so
 * this needs no identity and costs nobody anything.
 */
export async function fetchBalance(
  ledger: string,
  account: LedgerAccount,
): Promise<bigint | null> {
  for (const host of hostsFor(ledger)) {
    try {
      const actor = Actor.createActor<LedgerService>(ledgerInterface, {
        agent: await ledgerAgent(host),
        canisterId: Principal.fromText(ledger),
      }) as ActorSubclass<LedgerService>;
      return await actor.icrc1_balance_of(account);
    } catch {
      // Try the next host; a local ledger is not on mainnet and vice versa.
    }
  }
  return null;
}
