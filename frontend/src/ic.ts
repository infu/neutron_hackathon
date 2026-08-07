/**
 * Internet Identity login + authenticated actor.
 *
 * The generated bindings from `ash build` are `idlFactory` + `_SERVICE` only —
 * unlike `dfx generate` there is no `createActor` wrapper, so we build the
 * agent ourselves.
 */

import { Actor, HttpAgent, type ActorSubclass, type Identity } from "@dfinity/agent";
import { AuthClient } from "@dfinity/auth-client";
import type { Principal } from "@dfinity/principal";

import { idlFactory } from "./declarations/hackathon.js";
import type { _SERVICE } from "./declarations/hackathon.d.ts";

export const ANONYMOUS_PRINCIPAL = "2vxsx-fae";

/**
 * All of these come from `.env`, written by `scripts/write-env.mjs` from
 * icp-cli's sync-step variables. Vite is configured to read that file
 * (see vite.config.ts `envDir`).
 */
const CANISTER_ID = import.meta.env.VITE_CANISTER_ID_HACKATHON ?? "";

/** The icp-cli managed local network; `ic` is mainnet. */
export const IS_LOCAL = (import.meta.env.VITE_ICP_NETWORK ?? "local") !== "ic";

/**
 * `https://id.ai` on mainnet — NOT the older `identity.ic0.app` — and our own
 * pinned II canister locally. Resolved at deploy time by write-env.mjs.
 */
export const IDENTITY_PROVIDER =
  import.meta.env.VITE_IDENTITY_PROVIDER ?? "https://id.ai";

const ONE_DAY_NS = BigInt(24 * 60 * 60 * 1_000_000_000);

let authClientPromise: Promise<AuthClient> | null = null;
let localAgentPromise: Promise<HttpAgent> | null = null;

async function localAgent(identity: Identity): Promise<HttpAgent> {
  // A showcase advances PocketIC by real seven-day rounds. These are the
  // agent's supported local-network options for keeping ingress expiries and
  // certificate freshness on that simulated clock. Share the synchronized
  // agent so one page load does not run the three-read clock probe per query.
  localAgentPromise ??= HttpAgent.create({
    host: window.location.origin,
    identity,
    verifyQuerySignatures: false,
    shouldFetchRootKey: true,
    shouldSyncTime: true,
  }).catch((cause) => {
    localAgentPromise = null;
    throw new Error("Could not synchronize the local PocketIC agent clock.", { cause });
  });
  const agent = await localAgentPromise;
  agent.replaceIdentity(identity);
  return agent;
}

export function canisterId(): string {
  if (!CANISTER_ID) {
    throw new Error(
      "VITE_CANISTER_ID_HACKATHON is not set. Run `npm run deploy` at the repo root first.",
    );
  }
  return CANISTER_ID;
}

/**
 * PocketIC's test clock can intentionally be ahead of the workstation clock.
 * Keep that offset separate from `Date` itself: production remains at zero,
 * uploads still use ordinary wall time, and only deadline displays opt in.
 */
let networkClockOffsetMs = 0;
let clockSync: Promise<void> | null = null;

export function networkNow(): number {
  return Date.now() + networkClockOffsetMs;
}

/**
 * Refresh the local replica clock offset once at an explicit page refresh.
 *
 * Reuse the agent's certified subnet-time offset. This neither calls the
 * hackathon canister nor exposes PocketIC's admin port through an SSH tunnel.
 * Mainnet uses the workstation clock and performs no extra request.
 */
export async function syncNetworkClock(): Promise<void> {
  if (!IS_LOCAL) {
    networkClockOffsetMs = 0;
    return;
  }
  clockSync ??= (async () => {
    const client = await getAuthClient();
    networkClockOffsetMs = (await localAgent(client.getIdentity())).getTimeDiffMsecs();
  })();
  try {
    await clockSync;
  } finally {
    clockSync = null;
  }
}

export function getAuthClient(): Promise<AuthClient> {
  authClientPromise ??= AuthClient.create({
    keyType: "Ed25519",
    idleOptions: { disableIdle: true },
  });
  return authClientPromise;
}

export async function login(): Promise<void> {
  const client = await getAuthClient();
  await new Promise<void>((resolve, reject) => {
    client.login({
      identityProvider: IDENTITY_PROVIDER,
      maxTimeToLive: ONE_DAY_NS * BigInt(30),
      onSuccess: () => resolve(),
      onError: (error) => reject(new Error(error ?? "login failed")),
    });
  });
}

export async function logout(): Promise<void> {
  const client = await getAuthClient();
  await client.logout();
}

export async function currentPrincipal(): Promise<Principal> {
  const client = await getAuthClient();
  return client.getIdentity().getPrincipal();
}

export async function isAuthenticated(): Promise<boolean> {
  const client = await getAuthClient();
  if (!(await client.isAuthenticated())) return false;
  return client.getIdentity().getPrincipal().toText() !== ANONYMOUS_PRINCIPAL;
}

export async function backend(): Promise<ActorSubclass<_SERVICE>> {
  const client = await getAuthClient();
  const identity = client.getIdentity();
  // Under `vite dev` the origin is localhost:5174 and /api is proxied to the
  // gateway; when served from the canister the origin *is* the gateway. Either
  // way, same-origin.
  let agent: HttpAgent;
  if (IS_LOCAL) {
    agent = await localAgent(identity);
  } else {
    // Keep production on the ordinary mainnet trust and wall-clock path.
    agent = await HttpAgent.create({
      host: window.location.origin,
      identity,
    });
  }
  const actor = Actor.createActor<_SERVICE>(idlFactory, {
    agent,
    canisterId: canisterId(),
  });
  return guardSession(actor);
}

/**
 * A delegation the browser still holds but the replica will no longer accept.
 *
 * `AuthClient.isAuthenticated()` can only check that the stored delegation has
 * not *expired*. It cannot know the delegation has been invalidated — which is
 * what happens whenever the Internet Identity canister is reinstalled, or a
 * local replica is started with fresh state. The session looks perfectly good
 * from here and every call is rejected at the boundary.
 *
 * Left alone, that is a dead end with no way out inside the app: the user is
 * "signed in", nothing works, and each attempt returns a wall of hex about an
 * Ed25519 signature. The only escape is knowing to clear site data by hand,
 * which is not something anybody should have to know.
 */
function isDeadSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Invalid signature") ||
    message.includes("Invalid delegation") ||
    message.includes("signature could not be verified") ||
    message.includes("Invalid basic signature")
  );
}

/** Guard against re-entering the recovery while a reload is already underway. */
let recovering = false;

/**
 * Wrap every canister call so a dead session ends the session.
 *
 * A proxy rather than a check at each call site: there are dozens of methods
 * and more arrive with every feature, and the one that is forgotten is the one
 * somebody hits. This way a method cannot be added without the guard.
 */
function guardSession(actor: ActorSubclass<_SERVICE>): ActorSubclass<_SERVICE> {
  return new Proxy(actor, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } catch (error) {
          if (isDeadSession(error) && !recovering) {
            recovering = true;
            // Clear the stored delegation, then reload: there is nothing worth
            // preserving in a session that cannot make a single call, and the
            // page comes back signed out with a working sign-in button.
            await logout().catch(() => {});
            window.location.reload();
          }
          throw error;
        }
      };
    },
  }) as ActorSubclass<_SERVICE>;
}
