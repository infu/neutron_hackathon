/**
 * Thin typed layer over the raw Candid actor.
 *
 * Two Candid-isms are normalized here so components never deal with them:
 *   opt T          -> `[] | [T]`   becomes `T | null`
 *   variant Result -> `{ok} | {err}` becomes a thrown `ApiError`
 */

import { encodeIcrcAccount } from "@dfinity/ledger-icrc";
import { Principal as IcrcPrincipal } from "@icp-sdk/core/principal";
import { Principal } from "@dfinity/principal";

import { backend, canisterId } from "./ic";
import { fitToLimit } from "./imaging";
import { cachedToken, knownToken } from "./tokens";
import type { _SERVICE } from "./declarations/hackathon.d.ts";
import type {
  Counts,
  Cursor,
  Deposit,
  Cursor__1 as LogCursor,
  Detail as EntryDetail,
  Entry as SeasonEntry,
  Summary as SeasonSummary,
  EntryInput,
  Element as EntryLink,
  Element__2 as EntryUpdate,
  Pkg as EntryPackage,
  UpdateInput,
  EntryView as Entry,
  Filter,
  Info,
  Input,
  JudgeStatus,
  Kind,
  LetterCount,
  Outcome,
  Phase,
  Season,
  Sponsor,
  SponsorApplication,
  SponsorStatus,
  Line as PayoutLine,
  Revision,
  Link,
  LogPage,
  Progress,
  PublicPage,
  PublicUser,
  Store,
  User,
  View as SeasonView,
  WeekView,
} from "./declarations/hackathon.d.ts";

export type {
  Counts,
  Cursor,
  Deposit,
  Entry,
  Filter,
  Info,
  Input,
  JudgeStatus,
  Kind,
  LetterCount,
  EntryDetail,
  EntryInput,
  EntryLink,
  EntryPackage,
  EntryUpdate,
  UpdateInput,
  Outcome,
  Phase,
  Season,
  SeasonEntry,
  SeasonSummary,
  SeasonView,
  WeekView,
  Sponsor,
  SponsorApplication,
  SponsorStatus,
  Link,
  LogCursor,
  LogPage,
  PublicPage,
  PublicUser,
  PayoutLine,
  Progress,
  Revision,
  Store,
  User,
};

/** Candid `opt T` is `[]` or `[T]`; these keep that out of components. */
function toOpt<T>(value: T | null | undefined): [] | [T] {
  return value === null || value === undefined ? [] : [value];
}

export type FilterName =
  | "all"
  | "hackers"
  | "observers"
  | "judges"
  | "pending"
  | "sponsors"
  | "sponsorsPending"
  | "moderators";

export function filterOf(name: FilterName): Filter {
  return { [name]: null } as unknown as Filter;
}

/** Judging is a flag on the user, not a separate kind of user. */
export type JudgeState = "no" | "pending" | "approved";

export class ApiError extends Error {}
/** A successful state change that needs a brief explanation, not an error. */
export class ApiNotice extends ApiError {}

function unopt<T>(value: [] | [T]): T | null {
  return value.length === 0 ? null : value[0];
}

export type ProfileUser = User | PublicUser;

export function judgeState(user: ProfileUser): JudgeState {
  if ("approved" in user.judgeStatus) return "approved";
  if ("pending" in user.judgeStatus) return "pending";
  return "no";
}

export function isJudge(user: ProfileUser): boolean {
  return judgeState(user) === "approved";
}

export function sponsorState(user: ProfileUser): JudgeState {
  if ("approved" in user.sponsorStatus) return "approved";
  if ("pending" in user.sponsorStatus) return "pending";
  return "no";
}

export function isSponsor(user: ProfileUser): boolean {
  return sponsorState(user) === "approved";
}

export function sponsorInfo(user: ProfileUser): Sponsor | null {
  return unopt(user.sponsor);
}

/** The ICRC-1 ledger a sponsor nominated, as text. */
/**
 * Read off the sponsor record rather than from a generated `Element__N` alias:
 * those are positional and renumber whenever a variant is added, which is how
 * a type ends up quietly meaning something else.
 */
export type SponsorLedger = Sponsor["ledgers"][number];
export type SponsorGift = Sponsor["given"][number];

/** The ledgers a sponsor said they would pay in. */
export function sponsorLedgers(user: ProfileUser): SponsorLedger[] {
  return sponsorInfo(user)?.ledgers ?? [];
}

/** What has actually been swept in from them, per token. */
export function sponsorGifts(user: ProfileUser): SponsorGift[] {
  return sponsorInfo(user)?.given ?? [];
}

/** How many ledgers a sponsor may pledge. Mirrors Profiles.MAX_LEDGERS. */
export const MAX_LEDGERS = 7;

/** A token's symbol if we know it, otherwise its id — for confirm dialogs. */
export function tokenLabel(id: string): string {
  return cachedToken(id)?.symbol ?? knownToken(id)?.symbol ?? id;
}

/** Principals cross the wire as objects, not text; this is the one converter. */
export function toPrincipal(text: string): Principal {
  return Principal.fromText(text.trim());
}

export function parseLedger(text: string): [] | [Principal] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  try {
    return [Principal.fromText(trimmed)];
  } catch {
    throw new ApiError("That is not a valid canister principal.");
  }
}

export function sponsorLogo(user: ProfileUser): string | null {
  const info = sponsorInfo(user);
  return info ? unopt(info.logo) : null;
}

/**
 * Roles stack, so this is a list rather than a single value. "Observer" is
 * the absence of all of them, which is what makes it the default.
 */
export function rolesOf(user: ProfileUser): string[] {
  const roles: string[] = [];
  if (user.hacker) roles.push("hacker");
  if (isJudge(user)) roles.push("judge");
  if (isSponsor(user)) roles.push("sponsor");
  if (user.moderator) roles.push("moderator");
  return roles.length > 0 ? roles : ["observer"];
}

export function isObserver(user: ProfileUser): boolean {
  return rolesOf(user)[0] === "observer" && rolesOf(user).length === 1;
}

export type ActionKind =
  | "judge_approved"
  | "judge_rejected"
  | "judge_reset"
  | "judge_revoked"
  | "moderator_granted"
  | "moderator_revoked";

export function actionKind(entry: Entry): ActionKind {
  return Object.keys(entry.kind)[0] as ActionKind;
}

const ACTION_LABELS: Record<ActionKind, string> = {
  judge_approved: "approved as judge",
  judge_rejected: "judge application rejected",
  judge_reset: "put back to pending",
  judge_revoked: "judge status revoked",
  moderator_granted: "made a moderator",
  moderator_revoked: "moderator removed",
};

export function actionLabel(entry: Entry): string {
  return ACTION_LABELS[actionKind(entry)];
}

export function actionNote(entry: Entry): string | null {
  return unopt(entry.note);
}

export function title(user: ProfileUser): string | null {
  return unopt(user.title);
}

/**
 * Error shapes, derived from the service rather than the generated
 * `Error__N` aliases.
 *
 * Those aliases are positional: adding a method renumbers them, and the types
 * still compile while meaning something else entirely. Extracting from the
 * method signature cannot drift.
 */
type ErrOf<T> = Extract<T, { err: unknown }>["err"];
type OkOf<T> = Extract<T, { ok: unknown }>["ok"];

type ProfileError = ErrOf<Awaited<ReturnType<_SERVICE["register"]>>>;
type ModerationError = ErrOf<Awaited<ReturnType<_SERVICE["set_judge"]>>>;
type SeasonError = ErrOf<Awaited<ReturnType<_SERVICE["cast_vote"]>>>;
type ReviewError = ErrOf<Awaited<ReturnType<_SERVICE["submit_entry"]>>>;
type TreasuryError = ErrOf<Awaited<ReturnType<_SERVICE["sweep_sponsor"]>>>;
type PayoutError = ErrOf<Awaited<ReturnType<_SERVICE["run_payout"]>>>;
type AutomationError = ErrOf<Awaited<ReturnType<_SERVICE["wake_automation"]>>>;
type RawAutomationWake = OkOf<Awaited<ReturnType<_SERVICE["wake_automation"]>>>;
type RawAutomationStage = Extract<RawAutomationWake, { armed: unknown }>["armed"]["stage"];
type NoticeError = ErrOf<Awaited<ReturnType<_SERVICE["file_notice"]>>>;
type AnyError =
  | ProfileError
  | ModerationError
  | SeasonError
  | TreasuryError
  | PayoutError
  | AutomationError
  | ReviewError
  | NoticeError;

/**
 * Backend variants carry no message, so give them readable ones.
 *
 * The three error unions overlap heavily, so one describer covers all of
 * them; anything unrecognised falls through to its own tag rather than
 * "unknown error", which at least tells you what happened.
 */
function describe(error: AnyError): string {
  const has = (key: string) => key in (error as Record<string, unknown>);

  // Entry review methods wrap normal season errors in `#Season`. Unwrap that
  // layer so the form shows the useful cause (for example `#NoWallet`) rather
  // than the implementation detail "Season".
  if (has("Season")) {
    return describe((error as { Season: SeasonError }).Season);
  }
  if (has("Invalid")) return (error as { Invalid: string }).Invalid;
  if (has("HandleTaken")) return "That handle is already taken.";
  if (has("AlreadyRegistered")) return "This identity is already registered.";
  if (has("NotRegistered")) return "You are not registered yet.";
  if (has("Anonymous")) return "Sign in with Internet Identity first.";
  if (has("Closed")) return "Registration is currently closed.";
  if (has("Frozen")) {
    return (
      "This account has spent its instruction allowance for the season, so it " +
      "cannot write anything until a moderator restores it. Reading is unaffected."
    );
  }
  if (has("Empty")) return "Say what the problem is.";
  if (has("TooLong")) {
    return `A notice is at most ${Number((error as { TooLong: bigint }).TooLong)} characters.`;
  }
  if (has("Settling")) {
    return (
      "The season is settling up. Nothing can be changed until the rewards " +
      "have gone out or reached a terminal failure — a wallet or handle that " +
      "moved mid-distribution could mean somebody being paid twice."
    );
  }
  if (has("Terms")) return "You have to accept the Terms of Service.";
  if (has("Sanctions")) return "You have to make the sanctions declaration.";
  if (has("NeedsSecond")) {
    const tally = (error as { NeedsSecond: { votes: bigint; needed: bigint } }).NeedsSecond;
    return `Approving takes ${Number(tally.needed)} moderators. ${Number(tally.votes)} so far — a second has to agree.`;
  }
  if (has("NoProfile")) return "You need a registered profile to vote on this.";
  if (has("NoConsent")) {
    return (
      "Confirm the apps you submit are your own work and may be downloaded and " +
      "installed — the checkbox is on your profile, under Hacker."
    );
  }
  if (has("NoWallet")) {
    return "Set a reward wallet before submitting an app — there has to be somewhere to pay you.";
  }
  if (has("Distributing")) return "Apps are locked while the season's rewards are being distributed.";
  if (has("NotAllowed")) return "You are not allowed to do that.";
  if (has("Unavailable")) {
    return "Automation could not complete this check. Its guarded retry remains available.";
  }
  if (has("NoChange")) return "Already in that state.";
  if (has("JudgesFrozen")) return "The judge roster is permanently frozen once the season starts.";
  if (has("SponsorsFrozen")) return "The sponsor and ledger roster is permanently frozen once the season starts.";
  if (has("NoSeason")) return "No season is running.";
  if (has("SeasonRunning")) return "A season is already running.";
  if (has("WeekClosed")) return "This week is closed.";
  if (has("NotAHacker")) return "Switch on the hacker role first.";
  if (has("NotAJudge")) return "Only approved judges can vote.";
  if (has("OwnEntry")) return "You cannot vote for your own entry.";
  if (has("VoteLimit")) return "Both of your votes are spent this week.";
  if (has("AlreadyVoted")) return "You have already voted for this entry.";
  if (has("VoteLocked")) {
    return "Votes cannot be withdrawn during the final hour of a round.";
  }
  if (has("NotFound")) return "Not found.";
  if (has("NotASponsor")) return "That user is not an approved sponsor.";
  if (has("NoLedger")) return "No ICRC-1 ledger set on that sponsor.";
  if (has("Nothing")) return "Nothing to move — the balance is at or below the fee.";
  if (has("NotFinished")) return "The season has not finished yet.";
  if (has("TooSoon")) {
    const left = Number((error as { TooSoon: bigint }).TooSoon);
    return `Just a moment — try again in ${left} second${left === 1 ? "" : "s"}.`;
  }
  if (has("Empty")) return "Nothing to pay: no awards, or the treasury is empty.";
  if (has("Locked")) return "That treasury action is locked while distribution is running.";
  if (has("BadDestination")) return "That is not a valid destination account.";
  if (has("WrongPhase")) {
    return `Wrong stage: the distribution is ${(error as { WrongPhase: string }).WrongPhase}.`;
  }
  if (has("Transfer")) return `Ledger: ${(error as { Transfer: string }).Transfer}`;
  if (has("Db")) {
    const db = (error as { Db: Record<string, unknown> }).Db;
    if ("ConstraintViolation" in db) {
      const v = db.ConstraintViolation as { field: string; message: string };
      return `${v.field}: ${v.message}`;
    }
    if ("AlreadyExists" in db) return "That value must be unique.";
    if ("NotFound" in db) return "Record not found.";
    return String(db.Internal ?? "Database error");
  }
  return Object.keys(error as object)[0] ?? "Unknown error";
}

function unwrap<T>(result: { ok: T } | { err: AnyError }): T {
  if ("ok" in result) return result.ok;
  const message = describe(result.err);
  if (
    typeof result.err === "object" &&
    result.err !== null &&
    "NeedsSecond" in result.err
  ) {
    throw new ApiNotice(message);
  }
  throw new ApiError(message);
}

function unwrapUnit(result: { ok: null } | { err: string }): void {
  if ("err" in result) throw new ApiError(result.err);
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getConfig(): Promise<Store> {
  return (await backend()).config();
}

export async function termsInfo(): Promise<{ version: number; effectiveAt: Date }> {
  const info = await (await backend()).terms_info();
  return { version: Number(info.version), effectiveAt: toDate(info.effectiveAt) };
}

export async function getMe(): Promise<User | null> {
  return unopt(await (await backend()).me());
}

export async function getProfile(handle: string): Promise<PublicUser | null> {
  return unopt(await (await backend()).profile(handle));
}

/**
 * One page, always alphabetical.
 *
 * `letter` restricts to one A-Z bucket ("#" for handles starting with a digit
 * or underscore) and seeks straight to it — nothing before it is read, so the
 * index works without loading the table.
 */
export async function listPage(
  filter: FilterName,
  letter: string | null = null,
  after: Cursor | null = null,
  limit = 24,
): Promise<PublicPage> {
  return (await backend()).users_page(
    filterOf(filter),
    toOpt(letter),
    toOpt(after),
    BigInt(limit),
  );
}

/** Per-bucket counts for the A-Z strip. Costs no rows. */
export async function letterCounts(filter: FilterName): Promise<LetterCount[]> {
  return (await backend()).letter_counts(filterOf(filter));
}

/** Handle prefix search, scoped to the same filters. */
export async function searchUsers(
  prefix: string,
  filter: FilterName = "all",
  limit = 24,
): Promise<PublicUser[]> {
  const trimmed = prefix.trim().toLowerCase();
  if (trimmed === "") return [];
  return (await backend()).users_search(trimmed, filterOf(filter), BigInt(limit));
}

export async function stats(): Promise<Counts> {
  return (await backend()).stats();
}

export async function counts(): Promise<{ users: number; assets: number }> {
  const actor = await backend();
  const [s, assets] = await Promise.all([actor.stats(), actor.assets_count()]);
  return { users: Number(s.users), assets: Number(assets) };
}

/** The caller's own principal, as text. */
export async function whoami(): Promise<string> {
  return (await (await backend()).whoami()).toText();
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function register(input: Input): Promise<User> {
  return unwrap(await (await backend()).register(input));
}

/** Flags the caller's existing profile as a judge applicant. */
export async function applyAsJudge(): Promise<User> {
  return unwrap(await (await backend()).apply_as_judge());
}

/** Self-service — no approval involved. */
export async function setHacker(on: boolean): Promise<User> {
  return unwrap(await (await backend()).set_hacker(on));
}

/**
 * Submits or replaces a pending application. An approved sponsor must withdraw
 * before changing it so moderators review the replacement.
 *
 * Takes an application, not the stored sponsor record — contributions are not
 * something an applicant can send, so there is nothing here to carry forward.
 */
export async function applyAsSponsor(application: SponsorApplication): Promise<User> {
  return unwrap(await (await backend()).apply_as_sponsor(application));
}

export async function myDeposit(): Promise<Deposit | null> {
  return unopt(await (await backend()).my_deposit());
}

export async function withdrawSponsor(): Promise<User> {
  return unwrap(await (await backend()).withdraw_sponsor());
}

export async function setSponsor(
  user: ProfileUser,
  state: JudgeState,
  note?: string,
): Promise<User> {
  const variant = { [state]: null } as unknown as SponsorStatus;
  const trimmed = note?.trim();
  return unwrap(
    await (await backend()).set_sponsor(
      {
        id: user.id,
        expectedStatus: user.sponsorStatus,
        expectedUpdatedAt: user.updatedAt,
      },
      variant,
      toOpt(trimmed || null),
    ),
  );
}

export async function updateProfile(input: Input): Promise<User> {
  return unwrap(await (await backend()).update_profile(input));
}

export async function amModerator(): Promise<boolean> {
  return (await backend()).am_moderator();
}

/** Who is costing the canister most, by instructions or by stored bytes. */
export type CostOrder = "instructions" | "bytes";

export async function costliest(order: CostOrder, limit = 50): Promise<User[]> {
  const which = order === "bytes" ? { bytes: null } : { instructions: null };
  return (await backend()).costliest(which, BigInt(limit));
}

/**
 * Let a frozen account write again, and optionally clear what it has spent.
 *
 * There is no companion that freezes. Freezing is what the meter does when an
 * account crosses its instruction allowance — a measurement, not a judgement.
 * Moderators get the half that undoes it, so "frozen" never comes to mean two
 * different things.
 *
 * `reset` matters more than it looks: thawing an account that is still over
 * the allowance lasts exactly one call without it.
 */

/**
 * Where this account's rewards are sent.
 *
 * Not the identity you signed in with — an Internet Identity principal is a
 * per-origin pseudonym, not a ledger account, and tokens sent to one are
 * unspendable. The canister refuses it for that reason.
 */
export async function setWallet(wallet: string): Promise<User> {
  return unwrap(await (await backend()).set_wallet(Principal.fromText(wallet)));
}

/** Stand out of the prize money; your share goes to everybody else. */
export async function setRewardOptOut(out: boolean): Promise<User> {
  return unwrap(await (await backend()).set_reward_opt_out(out));
}

/** Nominate a principal that may drive this account, or stand it down. */
export async function setAgent(agent: string | null): Promise<User> {
  return unwrap(await (await backend()).set_agent(agent ? [Principal.fromText(agent)] : []));
}

/** Erase yourself: the row survives, everything personal on it does not. */
export async function deleteAccount(): Promise<User> {
  const result = await (await backend()).delete_account();
  if ("err" in result) throw new ApiError(result.err);
  return result.ok;
}

/** Erase one app, leaving the row the bracket counts on. */
export async function deleteApp(entryId: bigint): Promise<void> {
  const result = await (await backend()).delete_app(entryId);
  if ("err" in result) throw new ApiError(result.err);
}

// ── Takedown notices ─────────────────────────────────────────────────────────

export type Notice = Awaited<ReturnType<_SERVICE["notices"]>>[number];

/** Report content that should not be here. No account needed. */
export async function fileNotice(body: string): Promise<Notice> {
  return unwrap(await (await backend()).file_notice(body));
}

export async function listNotices(limit = 100): Promise<Notice[]> {
  return (await backend()).notices(BigInt(limit));
}

export async function noticesPending(): Promise<number> {
  return Number(await (await backend()).notices_pending());
}

export async function resolveNotice(id: bigint, reviewed: boolean): Promise<Notice> {
  return unwrap(
    await (await backend()).resolve_notice(id, reviewed ? { reviewed: null } : { dismissed: null }),
  );
}

// ── Verifiability ────────────────────────────────────────────────────────────

/**
 * A digest over every frontend file this canister serves.
 *
 * `npm run verify:web` recomputes the same number from `frontend/dist`. If they
 * agree, the page you are looking at is the build in the repository.
 */
export async function frontendHash(): Promise<string> {
  return (await backend()).frontend_hash();
}

export const NEUTRINITE_DAO_CONTROLLER = "extk7-gaaaa-aaaaq-aacda-cai";

/** Certified canister status, including controllers, is public on the IC dashboard. */
export function canisterDashboardUrl(): string {
  return `https://dashboard.internetcomputer.org/canister/${canisterId()}`;
}

export type ControllerRecovery = {
  votes: number;
  needed: number;
  mine: boolean;
  recovered: boolean;
};

const asControllerRecovery = (value: {
  votes: bigint;
  needed: bigint;
  mine: boolean;
  recovered: boolean;
}): ControllerRecovery => ({
  votes: Number(value.votes),
  needed: Number(value.needed),
  mine: value.mine,
  recovered: value.recovered,
});

export async function controllerRecoveryTally(): Promise<ControllerRecovery | null> {
  const [found] = await (await backend()).controller_recovery_tally();
  return found ? asControllerRecovery(found) : null;
}

export async function recoverCanister(): Promise<ControllerRecovery> {
  const result = await (await backend()).recover_canister();
  if ("err" in result) throw new ApiError(result.err);
  return asControllerRecovery(result.ok);
}

export async function thawUser(handle: string, reset: boolean): Promise<User> {
  // `thaw_user` answers with a plain string on failure, not a variant, so it
  // does not go through `describe`.
  const result = await (await backend()).thaw_user(handle, reset);
  if ("err" in result) throw new ApiError(result.err);
  return result.ok;
}

/** What this caller has spent of their allowance, and what it is. */
export async function myAllowance(): Promise<{ used: bigint; cap: bigint } | null> {
  const [found] = await (await backend()).my_allowance();
  return found ?? null;
}

export async function listModerators(limit = 100): Promise<PublicUser[]> {
  return (await backend()).moderators(BigInt(limit));
}

export async function moderationLog(
  after: LogCursor | null = null,
  limit = 25,
): Promise<LogPage> {
  return (await backend()).moderation_log(toOpt(after), BigInt(limit));
}

/** Approve, reject, reset to pending, or revoke. Always written to the log. */
export async function setJudge(
  user: ProfileUser,
  state: JudgeState,
  note?: string,
): Promise<User> {
  const variant = { [state]: null } as unknown as JudgeStatus;
  const trimmed = note?.trim();
  return unwrap(
    await (await backend()).set_judge(
      {
        id: user.id,
        expectedStatus: user.judgeStatus,
        expectedUpdatedAt: user.updatedAt,
      },
      variant,
      toOpt(trimmed || null),
    ),
  );
}

/** Max bytes the backend accepts for a user-scoped upload (Assets.avatarLimits). */
export const AVATAR_MAX_BYTES = 100_000;

/**
 * The extension the canister will accept for an image, from the file's type.
 *
 * Deliberately not `file.name`'s suffix: that is whatever the user called it,
 * and the canister reads the served content type off this. SVG is absent on
 * purpose — it is XML that can carry script, and the canister refuses it.
 */
function extensionOf(file: File): string {
  switch (file.type) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/avif":
      return ".avif";
    default:
      throw new ApiError(
        `${file.type || "That file"} cannot be used here — PNG, JPEG, WebP, GIF or AVIF.`,
      );
  }
}

/**
 * Upload an avatar into the caller's own `/u/<id>/` namespace, then point the
 * profile at it. Single chunk: the backend caps user uploads at one.
 */
export async function uploadAvatar(user: User, original: File): Promise<User> {
  // Scaled to fit rather than refused. A photo off a phone is twenty times the
  // cap, and "too big" is a useless thing to tell somebody who has no way to
  // fix it from here. An image already under the cap is left untouched.
  const { file } = await fitToLimit(original, AVATAR_MAX_BYTES, 512);

  const actor = await backend();
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The folder sets the size limit and the extension sets what it is served
  // as — the canister derives the content type from the key rather than
  // trusting what we declare, so an extensionless key is refused outright.
  // Timestamped so a replaced avatar is visible rather than cached.
  const key = `/u/${user.id}/avatar/${Date.now()}${extensionOf(file)}`;

  unwrapUnit(
    await actor.my_upload({
      store: {
        key,
        content: bytes,
        contentType: file.type,
        // Images are already compressed; storing them raw keeps the served
        // bytes identical to the certified bytes.
        contentEncoding: "identity",
        chunks: BigInt(1),
      },
    }),
  );

  const updated = unwrap(await actor.set_avatar([key]));

  // Best effort: drop the previous avatar so a user cannot accumulate blobs.
  const previous = unopt(user.avatar);
  if (previous && previous !== key) {
    await actor
      .my_upload({ delete: { key: previous } })
      .catch(() => undefined);
  }
  return updated;
}

export async function clearAvatar(): Promise<User> {
  return unwrap(await (await backend()).set_avatar([]));
}

export function avatarUrl(user: Pick<User, "avatar">): string | null {
  return unopt(user.avatar);
}

// ── Season ────────────────────────────────────────────────────────────────

/** Four qualifier weeks, a semi-final, a final. Mirrors Season.mo. */
export const QUALIFIERS = 4;
export const SEMI = 5;
export const FINAL = 6;
export const WEEKS = [1, 2, 3, 4, 5, 6];
export const VOTES_PER_JUDGE = 2;
/** Top five of a qualifier week are rewarded — and are what the map shows. */
export const REWARDED_PER_WEEK = 5;

export type PhaseName = "draft" | "running" | "finished";
export type OutcomeName = "none" | "rewarded" | "advanced" | "won";

export function phaseOf(season: Season): PhaseName {
  return Object.keys(season.phase)[0] as PhaseName;
}

export function outcomeOf(entry: Pick<SeasonEntry, "outcome">): OutcomeName {
  return Object.keys(entry.outcome)[0] as OutcomeName;
}

/** A week and a day, in milliseconds. Mirror Season.mo. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const VOTE_WITHDRAWAL_LOCK_MS = 60 * 60 * 1000;

/**
 * How long a round stays open. Mirrors `Season.roundNanos`.
 *
 * A qualifier runs a week because it is open for *building*. Nothing is
 * submitted to the semi-final or the final — the entrants are carried in
 * finished — so those are pure judging over four apps and two apps, and run a
 * day each. A season is four weeks and two days.
 */
export function roundMs(week: number): number {
  return week <= QUALIFIERS ? WEEK_MS : DAY_MS;
}

/** IC timestamps are nanoseconds since the epoch. */
export function toDate(nanos: bigint): Date {
  return new Date(Number(nanos / 1_000_000n));
}

/**
 * When a given round is due.
 *
 * Only the open round has a stored deadline; later ones are projected forward
 * from it, and closed ones have no retained date at all (see Judging on the
 * Rules page).
 *
 * Summed round by round rather than multiplied, because the rounds are no
 * longer the same length — projecting a week apart put the final five days
 * after it actually falls.
 */
export function deadlineFor(season: Season, week: number): Date | null {
  const live = Number(season.week);
  if (phaseOf(season) !== "running" || week < live) return null;
  let at = toDate(season.weekEndsAt).getTime();
  for (let w = live + 1; w <= week; w += 1) at += roundMs(w);
  return new Date(at);
}

/**
 * How long ago, in the largest unit that still reads honestly.
 *
 * Floors rather than rounds at every step: eighteen hours is "18 hours ago",
 * not "1 day ago". A changelog is a record, and rounding up past a boundary
 * makes it say something that did not happen.
 */
export function ago(nanos: bigint, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Number(nanos / 1_000_000n)) / 1000));
  if (seconds < 45) return "just now";

  const scale: [number, string][] = [
    [60, "minute"],
    [60, "hour"],
    [24, "day"],
    [7, "week"],
  ];
  let value = seconds;
  let unit = "second";
  for (const [step, next] of scale) {
    if (value < step) break;
    value = Math.floor(value / step);
    unit = next;
  }
  // Past a month, weeks stop being how anyone reads it.
  if (unit === "week" && value >= 5) {
    const months = Math.floor(seconds / 2_592_000);
    if (months >= 12) {
      const years = Math.floor(months / 12);
      return `${years} year${years === 1 ? "" : "s"} ago`;
    }
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

/** The exact moment, for a tooltip behind the rounded-off one. */
export function exactTime(nanos: bigint): string {
  return toDate(nanos).toLocaleString();
}

export function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "in 3 days" / "today" / "2 days ago" — coarse on purpose. */
export function relativeDay(date: Date, now = new Date()): string {
  const days = Math.round((date.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * The three cups.
 *
 * They fall straight out of the outcomes the backend already records, so
 * nothing extra is stored: placing in a qualifier week earns bronze, winning
 * your semi-final duel earns silver, and taking the final earns gold. A
 * project collects them on separate entry rows as it climbs, which is why a
 * single row only ever shows one.
 */
export type Medal = "gold" | "silver" | "bronze";

export function medalFor(entry: Pick<SeasonEntry, "outcome" | "week">): Medal | null {
  const outcome = outcomeOf(entry);
  if (outcome === "won") return "gold";
  const week = Number(entry.week);
  if (week === SEMI && outcome === "advanced") return "silver";
  if (week <= QUALIFIERS && outcome !== "none") return "bronze";
  return null;
}

/** Two survive the semi-final, one from each duel. */
export const FINALISTS = 2;

/**
 * How the prize pool is split.
 *
 * **Each app is paid once, for its best finish.** A project climbing the
 * bracket places in a qualifier week, then a duel, then the final, but collects
 * once — so the number of awards actually paid is not the number handed out:
 *
 * The collapse is per app, not per hacker: somebody who enters two apps in two
 * different qualifier weeks and wins both is paid two bronzes, which is what
 * the table below already counts.
 *
 * | Award | Placed | Paid | Why |
 * | --- | --- | --- | --- |
 * | Bronze | 20 | 18 | the two who reach the final are paid higher |
 * | Silver | 2 | 1 | the one who wins it is paid gold |
 * | Gold | 1 | 1 | |
 *
 * `share` is the slice of the pool a tier takes between it and `paid` is how
 * many are paid, so a per-award figure is `share / paid`. Kept as those two
 * inputs rather than a hard-coded percentage so the shares still total 100
 * when a count changes.
 *
 * This projection does not move funds; distribution is described under
 * Rewards on the Rules page.
 */
export const PRIZE_SPLIT: Record<Medal, { share: number; paid: number }> = {
  bronze: { share: 45, paid: REWARDED_PER_WEEK * QUALIFIERS - FINALISTS },
  silver: { share: 20, paid: FINALISTS - 1 },
  gold: { share: 35, paid: 1 },
};

/** What one award is worth, as a percentage of the whole pool. */
export function shareEach(medal: Medal): number {
  const { share, paid } = PRIZE_SPLIT[medal];
  return share / paid;
}

export function formatPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

/**
 * The shares must account for the whole pool. Checked here rather than left to
 * the reader: it is the one invariant that a change to any count can break.
 */
export const POOL_TOTAL = (Object.keys(PRIZE_SPLIT) as Medal[]).reduce(
  (sum, medal) => sum + PRIZE_SPLIT[medal].share,
  0,
);

/** Where each award is handed out, in the order the season hands them out. */
export const MEDALS: {
  medal: Medal;
  name: string;
  stage: string;
  short: string;
  won: string;
}[] = [
  {
    medal: "bronze",
    name: "Bronze",
    stage: "Every qualifier week",
    short: "Top 5 a week",
    won: `Top ${REWARDED_PER_WEEK} of the week, weeks 1 to ${QUALIFIERS}.`,
  },
  {
    medal: "silver",
    name: "Silver",
    stage: "Semi-final, week 5",
    short: "Reaches the final",
    won: "Wins a duel and goes through to the final.",
  },
  {
    medal: "gold",
    name: "Gold",
    stage: "Final, week 6",
    short: "Wins the final",
    won: "Takes the final. The grand prize.",
  },
];

export function weekName(week: number): string {
  if (week === FINAL) return "Final";
  if (week === SEMI) return "Semi-final";
  return `Week ${week}`;
}

/** Bracket weeks are carried into, never submitted to. */
export function isQualifier(week: number): boolean {
  return week >= 1 && week <= QUALIFIERS;
}

export async function getSeason(): Promise<Season | null> {
  return unopt(await (await backend()).season());
}

/** Every season, newest first. Short by construction — a season is a month. */
export async function listSeasons(limit = 50): Promise<Season[]> {
  return (await backend()).seasons(BigInt(limit));
}

export async function seasonByNumber(number: number): Promise<Season | null> {
  return unopt(await (await backend()).season_by_number(BigInt(number)));
}

export async function judgesFrozen(): Promise<boolean> {
  return (await backend()).judges_frozen();
}

/** The whole bracket in one call — all six rounds, each capped and counted. */
export async function seasonMap(seasonId: bigint, perWeek = 12): Promise<WeekView[]> {
  return (await backend()).season_map(seasonId, BigInt(perWeek));
}

export type SeasonWeekPage = {
  rows: SeasonView[];
  next: bigint | null;
  total: number;
};

/** Public open-week list. Rank-offset cursors keep each response bounded. */
export async function weekEntriesPage(
  seasonId: bigint,
  week: number,
  after: bigint | null = null,
  limit = 200,
): Promise<SeasonWeekPage> {
  const page = await (await backend()).season_week_page(
    seasonId,
    BigInt(week),
    toOpt(after),
    BigInt(Math.min(200, Math.max(1, limit))),
  );
  return { rows: page.rows, next: unopt(page.next), total: Number(page.total) };
}

/** How many of each an entry may carry. Mirrors Season.mo. */
export const MAX_SHOTS = 6;
export const MAX_LINKS = 6;

/** One `.neutron`, one ingress message. Mirrors Assets.packageLimits. */
export const PACKAGE_MAX_BYTES = 1_900_000;

/** An app's icon is drawn at a few dozen pixels; same cap as an avatar. */
export const ICON_MAX_BYTES = 100_000;
export const SHOT_MAX_BYTES = 400_000;

/** Mirrors `Assets.limitsFor`, so the two cannot drift. */
const LIMITS = {
  icon: ICON_MAX_BYTES,
  shots: SHOT_MAX_BYTES,
  pkg: PACKAGE_MAX_BYTES,
} as const;

/** Everything one person has entered, newest first. */
export async function userEntries(handle: string, limit = 100): Promise<SeasonSummary[]> {
  return (await backend()).user_entries(handle, BigInt(limit));
}

export async function entryDetail(id: bigint): Promise<EntryDetail | null> {
  return unopt(await (await backend()).entry_detail(id));
}

/**
 * Ask for a version to be published. It reaches the changelog only once a
 * moderator approves it — until then this is a request, and the entry keeps
 * showing what was approved before.
 */
export async function publishUpdate(entryId: bigint, input: UpdateInput): Promise<Revision> {
  return unwrap(await (await backend()).publish_update(entryId, input));
}

/**
 * Upload one file into the caller's own asset namespace and return its key.
 *
 * Single message by design — the canister caps every user upload at one chunk,
 * so there is never a half-written asset to clean up if a browser gives up.
 */
export async function uploadFile(
  user: Pick<User, "id">,
  original: File,
  /**
   * Which folder inside the caller's namespace. This is not cosmetic — the
   * canister reads the size limit off it, so `pkg` is the only one that gets
   * package room and the others are held to image size.
   */
  folder: "icon" | "shots" | "pkg",
): Promise<string> {
  const limit = LIMITS[folder];
  if (original.size === 0) throw new ApiError("That file is empty.");

  // A build is bytes we must not touch; an image over the cap is scaled to
  // fit. The two limits differ because an icon is drawn at a few dozen pixels
  // and a screenshot is looked at.
  const file =
    folder === "pkg"
      ? original
      : (await fitToLimit(original, limit, folder === "icon" ? 512 : 1600)).file;

  if (file.size > limit) {
    const kb = (n: number) => `${Math.round(n / 1000)} KB`;
    throw new ApiError(`That file is ${kb(file.size)} — the limit is ${kb(limit)}.`);
  }

  const actor = await backend();
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Timestamped so replacing a file is visible immediately rather than
  // sitting behind whatever the gateway cached for the old key.
  //
  // A package is named `<digits>.neutron` and nothing else: the browser takes
  // a download's filename from the last path segment, so letting the uploader
  // name it would let them ship a build that saves as `setup.exe`. The
  // canister enforces this; matching it here just gives a better error.
  const key =
    folder === "pkg"
      ? `/u/${user.id}/pkg/${Date.now()}.neutron`
      : `/u/${user.id}/${folder}/${Date.now()}${extensionOf(file)}`;

  unwrapUnit(
    await actor.my_upload({
        store: {
          key,
          content: bytes,
          contentType: file.type || "application/octet-stream",
          contentEncoding: "identity",
          chunks: BigInt(1),
        },
      },
    ),
  );
  return key;
}

export async function deleteFile(key: string): Promise<void> {
  unwrapUnit(await (await backend()).my_upload({ delete: { key } }));
}

/**
 * A deposit address in the ICRC-1 textual format.
 *
 * One string — `principal-checksum.subaccount` — rather than an owner and a
 * 64-character hex subaccount shown separately. That is the form wallets and
 * ledgers accept, it carries a checksum so a mistyped address is rejected
 * rather than sending tokens nowhere, and it drops the leading zeros that
 * make the raw subaccount unreadable.
 *
 * Encoding comes from `@dfinity/ledger-icrc` rather than being hand-rolled:
 * the checksum is CRC-32 over owner and subaccount, base32-encoded, and it is
 * not worth reimplementing something that must agree exactly with every
 * wallet.
 */
export function icrcAccount(deposit: Deposit): string {
  const subaccount = deposit.account.subaccount[0];
  return encodeIcrcAccount({
    // Two `Principal` classes are in play: the Candid bindings produce
    // `@dfinity/principal`, while `@dfinity/ledger-icrc` re-exports
    // `@icp-sdk/canisters` and wants that SDK's own. They behave identically,
    // but they are nominally different types — a round-trip through the text
    // form is exact and costs nothing, and beats casting past the mismatch.
    owner: IcrcPrincipal.fromText(deposit.account.owner.toText()),
    subaccount: subaccount === undefined ? undefined : Uint8Array.from(subaccount),
  });
}

export function formatBytes(bytes: bigint | number): string {
  const n = Number(bytes);
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${Math.round(n / 100_000) / 10} MB`;
}

export async function myEntry(): Promise<SeasonEntry | null> {
  return unopt(await (await backend()).my_entry());
}

export async function myEntries(): Promise<SeasonEntry[]> {
  return (await backend()).my_entries();
}

export async function myVotesLeft(): Promise<number> {
  return Number(await (await backend()).my_votes_left());
}

/**
 * Ask for an app to be entered or changed. Nothing reaches the bracket until a
 * moderator approves it.
 */
export async function submitEntry(input: EntryInput): Promise<Revision> {
  return unwrap(await (await backend()).submit_entry(input));
}

/** What this caller has asked for, and what came back — reasons included. */
export async function myRevisions(limit = 50): Promise<Revision[]> {
  return (await backend()).my_revisions(BigInt(limit));
}

export async function reviewQueue(limit = 50): Promise<Revision[]> {
  return (await backend()).review_queue(BigInt(limit));
}

export async function reviewPending(): Promise<number> {
  return Number(await (await backend()).review_pending());
}

export async function approveRevision(id: bigint): Promise<Revision> {
  return unwrap(await (await backend()).approve_revision(id));
}

/**
 * Take an app's content down. Two moderators, and it deletes files.
 *
 * The first call records a vote and throws `NeedsSecond` — `describe` turns
 * that into a sentence with the tally in it. The second, from a different
 * moderator, does it.
 */
export async function takedownApp(entryId: bigint, reason: string): Promise<SeasonEntry> {
  return unwrap(await (await backend()).takedown_app(entryId, reason));
}

/**
 * Where a quorum decision stands, from the asking moderator's side.
 *
 * `mine` is the field that makes a button honest: `votes: 1` alone cannot tell
 * "a colleague has agreed, and one more press finishes it" from "you have
 * agreed, and there is nothing left for you to press". Those want opposite
 * buttons, and only the canister knows which one this is.
 */
export type Quorum = { votes: number; needed: number; mine: boolean; context: string | null };

const asQuorum = (p: {
  votes: bigint;
  needed: bigint;
  mine: boolean;
  context: [] | [string];
}): Quorum => ({
  votes: Number(p.votes),
  needed: Number(p.needed),
  mine: p.mine,
  context: p.context[0] ?? null,
});

/** How many moderators have backed a takedown, and how many it needs. */
export async function takedownTally(entryId: bigint, reason?: string): Promise<Quorum | null> {
  const [found] = await (await backend()).takedown_tally(entryId, reason === undefined ? [] : [reason]);
  return found ? asQuorum(found) : null;
}

/** Remove only this moderator's own pending takedown vote. */
export async function withdrawTakedown(entryId: bigint): Promise<void> {
  unwrap(await (await backend()).withdraw_takedown(entryId));
}

/** The kinds of decision that take more than one moderator. */
export type QuorumKind = "judge" | "sponsor" | "takedown";

/**
 * Where every pending decision on a page stands, in one query.
 *
 * Batched deliberately: a queue is a list, and asking per row would make
 * drawing twenty buttons twenty round trips. Returns a map keyed by the same
 * ids that went in; ids the caller may not see come back missing rather than
 * zeroed, so a non-moderator gets an empty map and no buttons to draw.
 */
export async function approvalTallies(
  kind: QuorumKind,
  subjects: bigint[],
): Promise<Map<bigint, Quorum>> {
  if (subjects.length === 0) return new Map();
  const variant = { [kind]: null } as never;
  const rows = await (await backend()).approval_tallies(variant, subjects);
  return new Map(rows.map(([id, p]) => [id, asQuorum(p)]));
}

/** Has this entry's content been removed by moderators? */
export function takenDown(entry: { takedownAt: bigint }): boolean {
  return entry.takedownAt > 0n;
}

/** Refuse it, with a reason the author reads. Up to 2,000 characters. */
export async function rejectRevision(id: bigint, reason: string): Promise<Revision> {
  return unwrap(await (await backend()).reject_revision(id, reason));
}

export function revisionState(rev: Pick<Revision, "state">): RevisionState {
  return Object.keys(rev.state)[0] as RevisionState;
}

export type RevisionState = "pending" | "approved" | "rejected" | "expired";

export async function castVote(entryId: bigint): Promise<SeasonEntry> {
  return unwrap(await (await backend()).cast_vote(entryId));
}

export async function withdrawVote(entryId: bigint): Promise<SeasonEntry> {
  return unwrap(await (await backend()).withdraw_vote(entryId));
}

// Moderator-only from here down.

export async function createSeason(): Promise<Season> {
  return unwrap(await (await backend()).create_season());
}

export async function startSeason(seasonId: bigint): Promise<Season> {
  return unwrap(await (await backend()).start_season(seasonId));
}

/**
 * When the open week is due to close, if a season is running.
 *
 * The canister closes it itself at that instant — this is what it is aiming
 * at, not a hint about when somebody ought to press something.
 */
export async function weekEndsAt(): Promise<bigint | null> {
  const due = await (await backend()).week_ends_at();
  return due[0] ?? null;
}

/** Is a week-close actually scheduled? False on a finished season. */
export async function clockArmed(): Promise<boolean> {
  return (await backend()).clock_armed();
}

export type AutomationStage = "funding" | "payout" | { round: number };
export type AutomationWake =
  | { kind: "idle" }
  | { kind: "settled" }
  | { kind: "armed"; stage: AutomationStage; at: bigint }
  | { kind: "ran"; stage: AutomationStage; nextAt: bigint | null }
  | { kind: "busy"; stage: AutomationStage; since: bigint };

function automationStage(stage: RawAutomationStage): AutomationStage {
  if ("round" in stage) return { round: Number(stage.round) };
  if ("funding" in stage) return "funding";
  return "payout";
}

/**
 * Rebuild or run the lifecycle action selected entirely from durable state.
 * The caller supplies no deadline, phase, ledger, amount, wallet, or plan.
 */
export async function wakeAutomation(): Promise<AutomationWake> {
  const result = unwrap(await (await backend()).wake_automation());
  if ("idle" in result) return { kind: "idle" };
  if ("settled" in result) return { kind: "settled" };
  if ("armed" in result) {
    return {
      kind: "armed",
      stage: automationStage(result.armed.stage),
      at: result.armed.at,
    };
  }
  if ("busy" in result) {
    return {
      kind: "busy",
      stage: automationStage(result.busy.stage),
      since: result.busy.since,
    };
  }
  return {
    kind: "ran",
    stage: automationStage(result.ran.stage),
    nextAt: result.ran.nextAt[0] ?? null,
  };
}

/** The ledgers the treasury may hold — every one an approved sponsor pledged. */
export async function treasuryLedgers(): Promise<string[]> {
  return (await (await backend()).treasury_ledgers()).map((id) => id.toText());
}

/**
 * What the treasury holds, per token.
 *
 * One query over the canister's own books — it knows what every sweep brought
 * in and what every settled payout took out, so nothing has to be asked of the
 * ledgers. This used to be an update call per ledger against a method that
 * called whichever canister it was handed.
 */
export async function treasuryHoldings(): Promise<
  { ledger: string; amount: bigint }[]
> {
  const pool = await (await backend()).prize_pool();
  return pool.map(([ledger, amount]) => ({ ledger: ledger.toText(), amount }));
}

/** A sponsor saying their transfer has landed, so it can be collected. */
export async function notifyDeposit(ledger: string): Promise<bigint> {
  return unwrap(await (await backend()).notify_deposit(toPrincipal(ledger)));
}

/**
 * Collect everything a sponsor has sent, across every ledger they pledged.
 *
 * Returns what actually moved, per token — ledgers holding nothing are simply
 * absent. Rate limited to once a minute per sponsor; over that it throws with
 * the seconds remaining.
 */
export async function notifyDeposits(): Promise<{ ledger: string; amount: bigint }[]> {
  const moved = unwrap(await (await backend()).notify_deposits());
  return moved.map(([ledger, amount]) => ({ ledger: ledger.toText(), amount }));
}

export async function sweepSponsor(handle: string, ledger: string): Promise<bigint> {
  return unwrap(await (await backend()).sweep_sponsor(handle, Principal.fromText(ledger)));
}

// ── Paying out ─────────────────────────────────────────────────────────────

export type PayoutState = "planned" | "sending" | "paid" | "skipped" | "failed";
export type PayoutPhase = "none" | "proposed" | "approved" | "paying" | "paid" | "failed";

export function payoutPhase(season: Pick<Season, "payout">): PayoutPhase {
  return Object.keys(season.payout)[0] as PayoutPhase;
}

export function payoutState(line: Pick<PayoutLine, "state">): PayoutState {
  return Object.keys(line.state)[0] as PayoutState;
}

export function awardOf(line: Pick<PayoutLine, "award">): Medal {
  return Object.keys(line.award)[0] as Medal;
}

export async function payoutPlan(seasonId: bigint): Promise<PayoutLine[]> {
  return (await backend()).payout_plan(seasonId);
}

export async function payoutProgress(seasonId: bigint): Promise<Progress> {
  return (await backend()).payout_progress(seasonId);
}


/**
 * Send the approved plan.
 *
 * Resumable by design: if this throws, or the page is closed halfway, calling
 * it again picks up whatever is left and re-sends byte-identical arguments, so
 * nobody is paid twice.
 */
export async function runPayout(seasonId: bigint): Promise<Progress> {
  return unwrap(await (await backend()).run_payout(seasonId));
}
