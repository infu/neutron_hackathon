import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface Account {
  'owner' : Principal,
  'subaccount' : [] | [Uint8Array | number[]],
}
export type Agent = Principal;
export type ApprovalKind = { 'judge' : null } |
  { 'sponsor' : null } |
  { 'takedown' : null };
export type AutomationError = { 'NotAllowed' : null } |
  { 'Unavailable' : null };
export type AutomationStage = { 'round' : bigint } |
  { 'funding' : null } |
  { 'payout' : null };
export type AutomationWake = {
    'ran' : { 'nextAt' : [] | [bigint], 'stage' : AutomationStage }
  } |
  { 'armed' : { 'at' : bigint, 'stage' : AutomationStage } } |
  { 'settled' : null } |
  { 'busy' : { 'since' : bigint, 'stage' : AutomationStage } } |
  { 'idle' : null };
export type Avatar = string;
export type Award = { 'bronze' : null } |
  { 'gold' : null } |
  { 'silver' : null };
export interface Backing {
  'context' : [] | [string],
  'votes' : bigint,
  'mine' : boolean,
  'needed' : bigint,
}
export type Block = bigint;
export interface Callback {
  'token' : [] | [Token],
  'body' : Uint8Array | number[],
}
export type CallbackFunc = ActorMethod<[Token], Callback>;
export type Cmd = {
    'chunk' : {
      'key' : string,
      'content' : Uint8Array | number[],
      'index' : bigint,
    }
  } |
  { 'clear' : { 'prefix' : string } } |
  { 'delete' : { 'key' : string } } |
  {
    'store' : {
      'key' : string,
      'content' : Uint8Array | number[],
      'contentType' : string,
      'chunks' : bigint,
      'contentEncoding' : string,
    }
  };
export interface ConstraintViolation { 'field' : string, 'message' : string }
export interface ControllerRecovery {
  'recovered' : boolean,
  'votes' : bigint,
  'mine' : boolean,
  'needed' : bigint,
}
export interface Counts {
  'judges' : bigint,
  'pending' : bigint,
  'observers' : bigint,
  'sponsorsPending' : bigint,
  'users' : bigint,
  'moderators' : bigint,
  'sponsors' : bigint,
  'hackers' : bigint,
}
export type Cursor = string;
export type Cursor__1 = bigint;
export interface Deposit {
  'subaccount' : string,
  'account' : Account,
  'ledgers' : Array<Element__5>,
}
export interface Detail {
  'title' : [] | [string],
  'displayName' : string,
  'voted' : boolean,
  'mine' : boolean,
  'judge' : boolean,
  'entry' : Entry,
  'versionsEditable' : boolean,
  'handle' : string,
  'detailsEditable' : boolean,
  'avatar' : [] | [string],
}
export interface Element { 'url' : string, 'kind' : string }
export type Element__1 = string;
export interface Element__2 {
  'at' : bigint,
  'note' : string,
  'version' : string,
  'upload' : [] | [Upload],
}
export interface Element__4 {
  'at' : bigint,
  'ledger' : Principal,
  'amount' : bigint,
}
export interface Element__5 { 'id' : Principal, 'sns' : boolean }
export interface Element__8 { 'ledger' : Principal, 'reason' : string }
export type Element__9 = Principal;
export interface Entry {
  'id' : bigint,
  'pkg' : [] | [Pkg],
  'url' : string,
  'title' : string,
  'takedownReason' : string,
  'votes' : bigint,
  'season_id' : bigint,
  'icon' : [] | [Icon],
  'createdAt' : bigint,
  'slug' : string,
  'week' : bigint,
  'user_id' : bigint,
  'links' : Links,
  'shots' : Shots,
  'summary' : string,
  'updatedAt' : bigint,
  'takedownAt' : bigint,
  'updates' : Updates,
  'outcome' : Outcome,
  'origin_id' : [] | [OriginId],
}
export interface EntryInput {
  'pkg' : PackageInput,
  'url' : string,
  'title' : string,
  'icon' : [] | [string],
  'slug' : string,
  'links' : Array<Link>,
  'shots' : Array<string>,
  'summary' : string,
}
export interface EntryView {
  'at' : bigint,
  'by' : [] | [string],
  'id' : bigint,
  'subject' : [] | [string],
  'kind' : Kind__1,
  'note' : [] | [string],
  'subjectId' : bigint,
  'byPrincipal' : Principal,
}
export type Error = { 'Db' : Error__1 } |
  { 'AlreadyVoted' : null } |
  { 'Invalid' : string } |
  { 'NoSeason' : null } |
  { 'NotRegistered' : null } |
  { 'NotAllowed' : null } |
  { 'NoWallet' : null } |
  { 'NotAHacker' : null } |
  { 'NotFound' : null } |
  { 'SeasonRunning' : null } |
  { 'Distributing' : null } |
  { 'WeekClosed' : null } |
  { 'NotAJudge' : null } |
  { 'Frozen' : null } |
  { 'VoteLimit' : null } |
  { 'VoteLocked' : null } |
  { 'OwnEntry' : null };
export type Error__1 = { 'Internal' : string } |
  { 'NotFound' : bigint } |
  { 'AlreadyExists' : bigint } |
  { 'ConstraintViolation' : ConstraintViolation };
export type Error__2 = { 'Db' : Error__1 } |
  { 'Invalid' : string } |
  { 'JudgesFrozen' : null } |
  { 'NotRegistered' : null } |
  { 'NotAllowed' : null } |
  { 'NoChange' : null } |
  { 'SponsorsFrozen' : null } |
  { 'NoProfile' : null } |
  { 'NeedsSecond' : Tally };
export type Error__3 = { 'Db' : Error__1 } |
  { 'Invalid' : string } |
  { 'NotRegistered' : null } |
  { 'Anonymous' : null } |
  { 'Closed' : null } |
  { 'AlreadyRegistered' : null } |
  { 'Settling' : null } |
  { 'Terms' : null } |
  { 'HandleTaken' : null } |
  { 'Frozen' : null };
export type Error__4 = { 'NoSeason' : null } |
  { 'NotRegistered' : null } |
  { 'Nothing' : null } |
  { 'TooSoon' : bigint } |
  { 'NotASponsor' : null } |
  { 'NoLedger' : null } |
  { 'Transfer' : string } |
  { 'Frozen' : null };
export type Error__5 = { 'Db' : Error__1 } |
  { 'Invalid' : string } |
  { 'NotAllowed' : null } |
  { 'NotFound' : null } |
  { 'Season' : Error } |
  { 'Frozen' : null } |
  { 'NotPending' : null };
export type Error__6 = { 'Db' : Error__1 } |
  { 'Empty' : null } |
  { 'NoSeason' : null } |
  { 'NotAllowed' : null } |
  { 'WrongPhase' : string } |
  { 'NotFinished' : null };
export type Error__7 = { 'Db' : Error__1 } |
  { 'Empty' : null } |
  { 'TooLong' : bigint } |
  { 'TooSoon' : bigint } |
  { 'Full' : null } |
  { 'NotAllowed' : null } |
  { 'NotFound' : null };
export type Filter = { 'all' : null } |
  { 'judges' : null } |
  { 'pending' : null } |
  { 'observers' : null } |
  { 'sponsorsPending' : null } |
  { 'moderators' : null } |
  { 'sponsors' : null } |
  { 'hackers' : null };
export type FundingFailures = Array<Element__8>;
export type Given = Array<Element__4>;
export type HandledBy = bigint;
export type HeaderField = [string, string];
export type Icon = string;
export interface Info {
  'key' : string,
  'contentType' : string,
  'size' : bigint,
  'complete' : boolean,
  'chunks' : bigint,
  'contentEncoding' : string,
}
export interface Input {
  'bio' : string,
  'terms' : boolean,
  'title' : [] | [string],
  'displayName' : string,
  'links' : Array<Link>,
  'handle' : string,
}
export type JudgeStatus = { 'no' : null } |
  { 'pending' : null } |
  { 'approved' : null };
export interface JudgeTarget {
  'id' : bigint,
  'expectedStatus' : JudgeStatus,
  'expectedUpdatedAt' : bigint,
}
export type Kind = { 'entry' : null } |
  { 'version' : null };
export type Kind__1 = { 'sponsor_rejected' : null } |
  { 'sponsor_revoked' : null } |
  { 'moderator_revoked' : null } |
  { 'judge_revoked' : null } |
  { 'moderator_granted' : null } |
  { 'sponsor_reset' : null } |
  { 'judge_approved' : null } |
  { 'judge_rejected' : null } |
  { 'sponsor_approved' : null } |
  { 'judge_reset' : null };
export type LedgerAllowlist = Array<Element__9>;
export type Ledgers = Array<Element__5>;
export type Letter = string;
export interface LetterCount { 'count' : bigint, 'letter' : Letter }
export interface Line {
  'id' : bigint,
  'to' : Principal,
  'fee' : bigint,
  'net' : bigint,
  'award' : Award,
  'displayName' : string,
  'dust' : bigint,
  'season_id' : bigint,
  'note' : string,
  'attempts' : bigint,
  'createdAtTime' : bigint,
  'user_id' : bigint,
  'state' : State__3,
  'ledger' : Principal,
  'gross' : bigint,
  'block' : [] | [Block],
  'handle' : string,
  'entry_id' : bigint,
}
export interface Link { 'url' : string, 'kind' : string }
export type Links = Array<Element>;
export interface LogPage {
  'total' : bigint,
  'next' : [] | [Cursor__1],
  'rows' : Array<EntryView>,
}
export type Logo = string;
export interface ModeratorTarget {
  'id' : bigint,
  'expectedOn' : boolean,
  'expectedUpdatedAt' : bigint,
}
export interface Notice {
  'at' : bigint,
  'id' : bigint,
  'body' : string,
  'state' : State__1,
  'handledAt' : bigint,
  'handledBy' : [] | [HandledBy],
  'reporter' : Principal,
}
export type Order = { 'instructions' : null } |
  { 'bytes' : null };
export type OriginId = bigint;
export type Outcome = { 'won' : null } |
  { 'advanced' : null } |
  { 'none' : null } |
  { 'rewarded' : null };
export interface PackageInput { 'key' : string }
export interface Page {
  'total' : bigint,
  'next' : [] | [Cursor],
  'rows' : Array<User>,
}
export type Payout = { 'none' : null } |
  { 'paid' : null } |
  { 'approved' : null } |
  { 'proposed' : null } |
  { 'failed' : null } |
  { 'paying' : null };
export interface Payout__1 {
  'id' : bigint,
  'to' : Principal,
  'fee' : bigint,
  'net' : bigint,
  'award' : Award,
  'dust' : bigint,
  'season_id' : bigint,
  'note' : string,
  'attempts' : bigint,
  'createdAtTime' : bigint,
  'user_id' : bigint,
  'state' : State__3,
  'ledger' : Principal,
  'gross' : bigint,
  'block' : [] | [Block],
  'entry_id' : bigint,
}
export type Phase = { 'finished' : null } |
  { 'draft' : null } |
  { 'running' : null };
export interface Pkg {
  'at' : bigint,
  'key' : string,
  'name' : string,
  'size' : bigint,
  'version' : string,
}
export type PkgKey = string;
export interface Progress {
  'skipped' : bigint,
  'left' : bigint,
  'paid' : bigint,
  'failed' : bigint,
}
export interface PublicPage {
  'total' : bigint,
  'next' : [] | [Cursor],
  'rows' : Array<PublicUser>,
}
export interface PublicUser {
  'id' : bigint,
  'bio' : string,
  'title' : [] | [string],
  'moderator' : boolean,
  'displayName' : string,
  'createdAt' : bigint,
  'judgeStatus' : JudgeStatus,
  'links' : Array<Link>,
  'updatedAt' : bigint,
  'anonymized' : boolean,
  'sponsor' : [] | [SponsorInfo],
  'hacker' : boolean,
  'handle' : string,
  'sponsorStatus' : SponsorStatus,
  'avatar' : [] | [string],
}
export interface Request {
  'url' : string,
  'method' : string,
  'body' : Uint8Array | number[],
  'headers' : Array<HeaderField>,
  'certificate_version' : [] | [number],
}
export interface Response {
  'body' : Uint8Array | number[],
  'headers' : Array<HeaderField>,
  'upgrade' : [] | [boolean],
  'streaming_strategy' : [] | [StreamingStrategy],
  'status_code' : number,
}
export type Result = { 'ok' : Entry } |
  { 'err' : Error };
export type Result_1 = { 'ok' : null } |
  { 'err' : Error__2 };
export type Result_10 = { 'ok' : User } |
  { 'err' : Error__2 };
export type Result_11 = { 'ok' : null } |
  { 'err' : string };
export type Result_12 = { 'ok' : Array<Principal> } |
  { 'err' : string };
export type Result_13 = { 'ok' : Progress } |
  { 'err' : Error__6 };
export type Result_14 = { 'ok' : Notice } |
  { 'err' : Error__7 };
export type Result_15 = { 'ok' : ControllerRecovery } |
  { 'err' : string };
export type Result_16 = { 'ok' : bigint } |
  { 'err' : Error__6 };
export type Result_17 = { 'ok' : Array<[Principal, bigint]> } |
  { 'err' : Error__4 };
export type Result_2 = { 'ok' : User } |
  { 'err' : Error__3 };
export type Result_3 = { 'ok' : bigint } |
  { 'err' : WithdrawError };
export type Result_4 = { 'ok' : AutomationWake } |
  { 'err' : AutomationError };
export type Result_5 = { 'ok' : User } |
  { 'err' : string };
export type Result_6 = { 'ok' : Entry } |
  { 'err' : Error__2 };
export type Result_7 = { 'ok' : bigint } |
  { 'err' : Error__4 };
export type Result_8 = { 'ok' : Revision } |
  { 'err' : Error__5 };
export type Result_9 = { 'ok' : Season } |
  { 'err' : Error };
export type Reviewer = bigint;
export interface Revision {
  'id' : bigint,
  'url' : string,
  'title' : string,
  'season_id' : bigint,
  'icon' : [] | [Icon],
  'kind' : Kind,
  'note' : string,
  'createdAt' : bigint,
  'slug' : string,
  'week' : bigint,
  'user_id' : bigint,
  'links' : Links,
  'shots' : Shots,
  'version' : string,
  'summary' : string,
  'state' : State,
  'pkgKey' : [] | [PkgKey],
  'targetEntryId' : [] | [TargetEntryId],
  'reviewer' : [] | [Reviewer],
  'decidedAt' : bigint,
  'reason' : string,
}
export interface Season {
  'id' : bigint,
  'startedAt' : bigint,
  'fundingReady' : boolean,
  'fundingFailures' : FundingFailures,
  'endedAt' : bigint,
  'week' : bigint,
  'fundingAttempts' : bigint,
  'number' : bigint,
  'weekEndsAt' : bigint,
  'phase' : Phase,
  'payout' : Payout,
}
export type Shots = Array<Element__1>;
export interface Sponsor {
  'org' : string,
  'logo' : [] | [Logo],
  'website' : string,
  'given' : Given,
  'blurb' : string,
  'ledgers' : Ledgers,
}
export interface SponsorApplication {
  'org' : string,
  'logo' : [] | [string],
  'website' : string,
  'blurb' : string,
  'ledgers' : Array<Element__5>,
}
export interface SponsorInfo {
  'org' : string,
  'logo' : [] | [Logo],
  'website' : string,
  'given' : Given,
  'blurb' : string,
  'ledgers' : Ledgers,
}
export type SponsorStatus = { 'no' : null } |
  { 'pending' : null } |
  { 'approved' : null };
export interface SponsorTarget {
  'id' : bigint,
  'expectedStatus' : SponsorStatus,
  'expectedUpdatedAt' : bigint,
}
export type State = { 'expired' : null } |
  { 'pending' : null } |
  { 'approved' : null } |
  { 'rejected' : null };
export type State__1 = { 'fresh' : null } |
  { 'reviewed' : null } |
  { 'dismissed' : null };
export type State__3 = { 'skipped' : null } |
  { 'paid' : null } |
  { 'planned' : null } |
  { 'sending' : null } |
  { 'failed' : null };
export interface Store {
  'siteTitle' : string,
  'ledgerAllowlist' : LedgerAllowlist,
  'ledgerAllowlistSet' : boolean,
  'nextSeasonUrl' : string,
  'frontendHash' : string,
  'registrationOpen' : boolean,
  'instructionCap' : bigint,
}
export type StreamingStrategy = {
    'Callback' : { 'token' : Token, 'callback' : [Principal, string] }
  };
export interface Summary {
  'id' : bigint,
  'url' : string,
  'title' : string,
  'takedownReason' : string,
  'votes' : bigint,
  'season_id' : bigint,
  'icon' : [] | [string],
  'shot' : [] | [string],
  'week' : bigint,
  'user_id' : bigint,
  'links' : bigint,
  'shots' : bigint,
  'summary' : string,
  'takedownAt' : bigint,
  'updates' : bigint,
  'hasPackage' : boolean,
  'outcome' : Outcome,
  'origin_id' : [] | [bigint],
}
export interface Tally { 'votes' : bigint, 'needed' : bigint }
export type TargetEntryId = bigint;
export type Title = string;
export interface Token {
  'key' : string,
  'sha256' : [] | [Uint8Array | number[]],
  'index' : bigint,
  'content_encoding' : string,
}
export interface UpdateInput {
  'pkg' : [] | [PackageInput],
  'note' : string,
  'version' : string,
}
export type Updates = Array<Element__2>;
export interface Upload { 'name' : string, 'size' : bigint }
export interface User {
  'id' : bigint,
  'bio' : string,
  'title' : [] | [Title],
  'termsVersion' : bigint,
  'principal' : Principal,
  'agent' : [] | [Agent],
  'moderator' : boolean,
  'termsAt' : bigint,
  'displayName' : string,
  'createdAt' : bigint,
  'judgeStatus' : JudgeStatus,
  'instructions' : bigint,
  'links' : Links,
  'updatedAt' : bigint,
  'rewardOptOut' : boolean,
  'anonymized' : boolean,
  'sponsor' : [] | [Sponsor],
  'hacker' : boolean,
  'frozen' : boolean,
  'wallet' : [] | [Wallet],
  'handle' : string,
  'bytes' : bigint,
  'sponsorStatus' : SponsorStatus,
  'avatar' : [] | [Avatar],
}
export interface View {
  'title' : [] | [string],
  'displayName' : string,
  'voted' : boolean,
  'mine' : boolean,
  'judge' : boolean,
  'entry' : Summary,
  'handle' : string,
  'avatar' : [] | [string],
}
export type Wallet = Principal;
export interface WeekPage {
  'total' : bigint,
  'next' : [] | [bigint],
  'rows' : Array<View>,
}
export interface WeekView {
  'total' : bigint,
  'week' : bigint,
  'entries' : Array<View>,
}
export type WithdrawError = { 'NotRegistered' : null } |
  { 'Nothing' : null } |
  { 'BadDestination' : null } |
  { 'Locked' : null } |
  { 'Transfer' : string } |
  { 'Frozen' : null };
/**
 * / Neutron Hackathon canister — an AI-powered hackathon for Neutron apps.
 * /
 * / Deliberately thin: this file is authorization + dispatch only. All the real
 * / work lives in modules —
 * /
 * /   lib/Assets.mo    chunked uploads, SHA-256, IC certification, HTTP serving
 * /   lib/Painless.mo  IC HTTP gateway types + chunked response plumbing
 * /   lib/Profiles.mo  registration and profile rules
 * /   lib/Moderation.mo moderator actions + the audit log behind them
 * /   lib/Season.mo    the season format: entries, votes, round resolution
 * /   lib/Treasury.mo  sponsor deposit addresses and sweeping
 * /   .ashroot/lib.mo  database implementation
 */
export interface _SERVICE {
  'am_moderator' : ActorMethod<[], boolean>,
  /**
   * / Opt in to judging. Sets a flag on the caller's existing profile; a
   * / controller decides. No approval UI by design — do it from the CLI:
   * /   icp canister call hackathon pending_judges '(50)' --query
   * / Then pass the returned id, judgeStatus, and updatedAt snapshot to
   * / `set_judge`; stale snapshots are rejected.
   */
  'apply_as_judge' : ActorMethod<[], Result_2>,
  'apply_as_sponsor' : ActorMethod<[SponsorApplication], Result_2>,
  /**
   * / Where every pending decision in a queue stands, in one call.
   * /
   * / Batched because the alternative is one query per row, and the moderation
   * / queues are lists — a page of twenty pending judges would be twenty
   * / round trips to draw twenty buttons. The caller passes the ids it is
   * / already showing, so this never walks more than the page.
   * /
   * / Answers `[]` rather than trapping for a non-moderator: the tallies say
   * / who is willing to approve whom, which is not public.
   */
  'approval_tallies' : ActorMethod<
    [ApprovalKind, BigUint64Array | bigint[]],
    Array<[bigint, Backing]>
  >,
  /**
   * / Apply a pending revision to the bracket.
   */
  'approve_revision' : ActorMethod<[bigint], Result_8>,
  'assets_count' : ActorMethod<[], bigint>,
  'assets_list' : ActorMethod<[string, bigint], Array<Info>>,
  /**
   * / Frontend bundles, `.neutron` packages, anything site-owned.
   * / Driven by `scripts/upload.mjs`.
   */
  'assets_upload' : ActorMethod<[Cmd], Result_11>,
  /**
   * / Spend one of two votes. Not on your own entry.
   */
  'cast_vote' : ActorMethod<[bigint], Result>,
  /**
   * / Is a week-close actually scheduled?
   * /
   * / This reports that the actor installed a timer id. It cannot prove that
   * / the replica's global timer is still live: after a cycles freeze or a
   * / congested timer expiry, an id may remain even though no callback will
   * / arrive. `wake_automation` is the repair path for that case.
   */
  'clock_armed' : ActorMethod<[], boolean>,
  'config' : ActorMethod<[], Store>,
  /**
   * / Current progress toward the fixed emergency controller recovery.
   * /
   * / Only actual moderator account owners may see or cast these approvals.
   * / Agent delegation is deliberately insufficient for granting controller
   * / authority.
   */
  'controller_recovery_tally' : ActorMethod<[], [] | [ControllerRecovery]>,
  /**
   * / The most expensive participants first, by instructions or by bytes.
   * /
   * / Moderator-gated: it is a list of who to look at, and publishing it
   * / would tell somebody probing the canister exactly how well it is going.
   */
  'costliest' : ActorMethod<[Order, bigint], Array<User>>,
  /**
   * / Draw up this canister's season. **Moderators, and only ever one.** The
   * / draft is one of the preconditions checked before sealing, so it is
   * / created while controllers still exist but never requires controller
   * / authority itself.
   * /
   * / `Season.create` refuses a second one outright — the next season is a new
   * / canister, not another row here (rules.md §1).
   */
  'create_season' : ActorMethod<[], Result_9>,
  /**
   * / Erase yourself. Not available while a season is running.
   * /
   * / The row survives — see `Profiles.anonymize`. Everything personal on it
   * / does not, and every app goes with it.
   * /
   * / Refused mid-season because a season is a competition in progress: an
   * / entry vanishing from a week that judges have already voted in changes
   * / the result, and rules.md §5 makes a closed week a record.
   */
  'delete_account' : ActorMethod<[], Result_5>,
  /**
   * / Erase one app, leaving the row that the bracket counts on.
   */
  'delete_app' : ActorMethod<[bigint], Result_11>,
  'deposit_for' : ActorMethod<[string], [] | [Deposit]>,
  /**
   * / Everything about one entry — screenshots, links, package, changelog.
   * / Fetched when an entry is opened, so the bracket itself stays small.
   */
  'entry_detail' : ActorMethod<[bigint], [] | [Detail]>,
  /**
   * / Report content that should not be here. No account needed.
   * /
   * / Three an hour per calling principal, 500 characters. Anonymous callers
   * / share one principal and therefore one allowance — that is the limit
   * / doing its job, not a bug to route around.
   */
  'file_notice' : ActorMethod<[string], Result_14>,
  'frontend_asset_keys' : ActorMethod<[], Array<string>>,
  /**
   * / A digest over every frontend file this canister serves.
   * /
   * / Recompute it from a checkout with `npm run verify:web` and compare. If
   * / the two agree, the site you are looking at is the build in the
   * / repository — which is the claim a canister that hosts its own frontend
   * / ought to be able to support rather than ask you to take on trust.
   * /
   * / Computed on demand rather than cached: it walks the frontend's own
   * / keys, which number in the tens, and a cached value is one more thing
   * / that can silently drift from what is actually being served.
   */
  'frontend_hash' : ActorMethod<[], string>,
  'funding_closing' : ActorMethod<[], boolean>,
  'http_request' : ActorMethod<[Request], Response>,
  'http_request_streaming_callback' : ActorMethod<[Token], Callback>,
  'is_controller' : ActorMethod<[], boolean>,
  /**
   * / True from the moment a season starts until it finishes. While set, no
   * / moderator can change the judges.
   */
  'judges_frozen' : ActorMethod<[], boolean>,
  /**
   * / Did this installed actor begin the irreversible seal transition?
   * /
   * / A self-only controller list alone cannot distinguish `seal_canister()`
   * / from an operator changing settings by hand. This durable,
   * / read-only witness lets the release verifier require both facts. It
   * / grants no recovery authority. A confirmed failed attempt resets it while
   * / controllers still remain; after successful removal it stays true until
   * / a season starts, when the running phase becomes the durable boundary.
   */
  'launch_latched' : ActorMethod<[], boolean>,
  /**
   * / Per-bucket counts for the A-Z strip, so it can show what exists
   * / without the client fetching any rows.
   */
  'letter_counts' : ActorMethod<[Filter], Array<LetterCount>>,
  'me' : ActorMethod<[], [] | [User]>,
  /**
   * / Where this canister's memory has gone.
   * /
   * / Public on purpose: it is the number that decides whether the event fits,
   * / and it says nothing about any participant. The interesting pair is
   * / `heap` against `stableReserved` — file bytes live in stable memory
   * / (see `Slab`), so a heap that stays flat while stable memory grows is
   * / the design working.
   */
  'memory' : ActorMethod<
    [],
    {
      'files' : bigint,
      'stableLive' : bigint,
      'heap' : bigint,
      'heapClaimed' : bigint,
      'cycles' : bigint,
      'stableReserved' : bigint,
    }
  >,
  'moderation_log' : ActorMethod<[[] | [Cursor__1], bigint], LogPage>,
  'moderation_log_for' : ActorMethod<
    [string, [] | [Cursor__1], bigint],
    LogPage
  >,
  'moderators' : ActorMethod<[bigint], Array<PublicUser>>,
  /**
   * / What this caller has spent of their allowance, and what it is.
   */
  'my_allowance' : ActorMethod<[], [] | [{ 'cap' : bigint, 'used' : bigint }]>,
  'my_deposit' : ActorMethod<[], [] | [Deposit]>,
  /**
   * / Every current seat, so a double qualifier can deliberately choose the
   * / app a version belongs to. The singular query above stays for old cards.
   */
  'my_entries' : ActorMethod<[], Array<Entry>>,
  'my_entry' : ActorMethod<[], [] | [Entry]>,
  'my_payouts' : ActorMethod<[], Array<Payout__1>>,
  /**
   * / What this caller has asked for, and what came back — rejection reports
   * / included. Their own only: a review is between a hacker and a moderator.
   */
  'my_revisions' : ActorMethod<[bigint], Array<Revision>>,
  /**
   * / Where the caller's rewards are held.
   * /
   * / The address, not the balance. Reading a balance means calling a ledger,
   * / and a method that calls whichever ledger the caller names is a way to
   * / spend this canister's cycles on someone else's errand. The browser can
   * / query `icrc1_balance_of` itself — it is a public, anonymous query, and
   * / the account below is all it needs.
   */
  'my_reward_account' : ActorMethod<[], [] | [Account]>,
  /**
   * / A registered user may only write under `/u/<their id>/`.
   * / Upload into your own namespace.
   * /
   * / What the file is for — and therefore how large it may be — comes from
   * / the folder it is going into, not from the caller. Declaring it meant the
   * / avatar and image caps were advisory: anyone wanting a 1.9 MB avatar
   * / asked for the package limit and got it.
   * / Role-aware account and whole-store ceilings live in `Assets`; the
   * / hacker-cap proof in `Profiles` is calculated against those same values.
   * / Keeping one source prevents a harmless-looking local constant change
   * / from reopening the global capacity exhaustion bug.
   */
  'my_upload' : ActorMethod<[Cmd], Result_11>,
  'my_vote_on' : ActorMethod<[bigint], boolean>,
  /**
   * / How many of a judge's two votes are left this week.
   */
  'my_votes_left' : ActorMethod<[], bigint>,
  'notices' : ActorMethod<[bigint], Array<Notice>>,
  'notices_pending' : ActorMethod<[], bigint>,
  /**
   * / Sweep one named ledger.
   * /
   * / Rate-limited from the same window as `notify_deposits`, which it used to
   * / skip entirely — so the limit was decorative: one call a minute asking
   * / about all your ledgers, or as many as you liked asking about one. The
   * / eligibility check runs first so a refusal does not spend the turn.
   */
  'notify_deposit' : ActorMethod<[Principal], Result_7>,
  /**
   * / Collect everything a sponsor has sent, across every ledger they pledged.
   * /
   * / Self-service: the sponsor transfers, then says so. Each ledger is swept
   * / independently and one that fails does not stop the others — a sponsor
   * / paying in three tokens should not be blocked by one unreachable ledger.
   */
  'notify_deposits' : ActorMethod<[], Result_17>,
  /**
   * / Is a distribution still being attempted?
   */
  'payout_armed' : ActorMethod<[], boolean>,
  'payout_plan' : ActorMethod<[bigint], Array<Line>>,
  'payout_progress' : ActorMethod<[bigint], Progress>,
  'pending_judges' : ActorMethod<[bigint], Array<PublicUser>>,
  /**
   * / What the treasury holds, per ledger.
   * /
   * / A query over our own records, not a round of calls to the ledgers. The
   * / canister already knows every movement — see `Treasury.pools` — and the
   * / method this replaces took a ledger id from the caller and called it,
   * / which let anyone make this canister send messages wherever they liked.
   */
  'prize_pool' : ActorMethod<[], Array<[Principal, bigint]>>,
  'profile' : ActorMethod<[string], [] | [PublicUser]>,
  /**
   * / Report whether final reconciliation already froze the distribution.
   * /
   * / Retained for interface compatibility and moderator diagnostics. Final
   * / reconciliation exclusively owns the ledger snapshot and plan write;
   * / this endpoint performs no ledger I/O and can never redraft it.
   */
  'propose_payout' : ActorMethod<[bigint], Result_16>,
  /**
   * / Ship a new build, write what changed, or both.
   * /
   * / The replaced package is deleted here rather than in `Season`: that
   * / module owns the row, this one owns the asset store.
   */
  'publish_update' : ActorMethod<[bigint, UpdateInput], Result_8>,
  'recent_users' : ActorMethod<[bigint], Array<PublicUser>>,
  /**
   * / End the self-only seal by adding the fixed Neutrinite DAO controller.
   * /
   * / No principal or repair instruction comes from the caller. Each current,
   * / non-anonymised moderator owner contributes at most one persisted vote.
   * / The third vote invokes the one settings transition installed in
   * / `Controllers.recover`.
   */
  'recover_canister' : ActorMethod<[], Result_15>,
  'register' : ActorMethod<[Input], Result_2>,
  /**
   * / Refuse it, with a concise reason the author can act on. Longer machine
   * / reports can be linked instead of retained in every revision row.
   */
  'reject_revision' : ActorMethod<[bigint, string], Result_8>,
  'resolve_notice' : ActorMethod<[bigint, State__1], Result_14>,
  'review_pending' : ActorMethod<[], bigint>,
  /**
   * / The queue, oldest first. Moderators and their nominated review agents.
   */
  'review_queue' : ActorMethod<[bigint], Array<Revision>>,
  /**
   * / Send the approved plan. Resumable: call it again after a failure and it
   * / picks up whatever is left, re-sending identical arguments.
   * /
   * / This is the moderator fallback for a distribution whose timer stopped
   * / while the canister was frozen. It uses the same lease, cooldown and
   * / immutable plan as the automatic worker; standing is checked before even
   * / the bounded progress scan.
   * /
   * / Resumption is safe because the plan is not an input. Amounts,
   * / destinations, fees and the deduplication nonce were all frozen when it
   * / was drafted; the moderator cannot add a row, change one, or aim one
   * / somewhere else. Every attempt re-sends byte-identical arguments, so a
   * / row that already went through comes back `#Duplicate` and settles as
   * / paid.
   */
  'run_payout' : ActorMethod<[bigint], Result_13>,
  /**
   * / Remove every external controller and retain only this canister.
   * /
   * / No person, developer identity or DAO can then upgrade the code/frontend
   * / or change settings. The installed emergency path below can add only the
   * / fixed Neutrinite DAO after three distinct current moderators approve it.
   * / Arrange everything first — moderators appointed, frontend uploaded,
   * / allowance set — because normal operation remains self-controlled.
   * /
   * / Requires the canister to be one of its own controllers, which a human
   * / arranges once by hand: reading your own status is unprivileged, changing
   * / your own settings is not.
   */
  'seal_canister' : ActorMethod<[], Result_11>,
  'season' : ActorMethod<[], [] | [Season]>,
  'season_by_number' : ActorMethod<[bigint], [] | [Season]>,
  /**
   * / The whole bracket in one call — every week, its top entries and its
   * / true count. What the season map draws.
   */
  'season_map' : ActorMethod<[bigint, bigint], Array<WeekView>>,
  'season_running' : ActorMethod<[], [] | [Season]>,
  /**
   * / One week's entries, best first. Ranked by votes, ties to the earliest
   * / submission.
   */
  'season_week' : ActorMethod<[bigint, bigint, bigint], Array<Entry>>,
  'season_week_page' : ActorMethod<
    [bigint, bigint, [] | [bigint], bigint],
    WeekPage
  >,
  /**
   * / The same week, joined with each entry's author and the caller's own
   * / votes — what the season page actually renders.
   */
  'season_week_view' : ActorMethod<[bigint, bigint, bigint], Array<View>>,
  /**
   * / Past and present seasons, newest first — what the season switcher lists.
   */
  'seasons' : ActorMethod<[bigint], Array<Season>>,
  /**
   * / Nominate a principal that may drive this account, or stand it down.
   * /
   * / For scripting a weekly build. Deliberately the account holder's call
   * / and not the agent's — an agent that could appoint the next agent could
   * / keep the account after being dismissed.
   */
  'set_agent' : ActorMethod<[[] | [Principal]], Result_2>,
  'set_avatar' : ActorMethod<[[] | [string]], Result_2>,
  'set_config' : ActorMethod<[string, boolean], Result_11>,
  /**
   * / Roles stack. Hacking is self-service; judging and sponsoring are
   * / applications a moderator approves. Holding none of them is what makes
   * / somebody an observer — the default on registration.
   */
  'set_hacker' : ActorMethod<[boolean], Result_2>,
  /**
   * / The instruction allowance one account gets per season. Controller-only.
   */
  'set_instruction_cap' : ActorMethod<[bigint], Result_11>,
  /**
   * / Approve, reject, reset or revoke a judge. The target binds the decision
   * / to the exact account and role snapshot the moderator reviewed.
   * /   variant { approved } | variant { pending } | variant { no }
   * / Every successful state change enters the subject's bounded audit trail,
   * / so a mistake is reversible and traceable rather than silent.
   */
  'set_judge' : ActorMethod<
    [JudgeTarget, JudgeStatus, [] | [string]],
    Result_10
  >,
  /**
   * / Configure the only remote ledger actors this sealed canister will ever
   * / call. The list is controller-owned setup state and freezes as soon as a
   * / sponsor application exists (and, independently, once a season starts).
   */
  'set_ledger_allowlist' : ActorMethod<[Array<Principal>], Result_12>,
  /**
   * / Appointing moderators stays with the controller. Moderators appointing
   * / moderators has no floor.
   */
  'set_moderator' : ActorMethod<
    [ModeratorTarget, boolean, [] | [string]],
    Result_10
  >,
  'set_next_season_url' : ActorMethod<[string], Result_11>,
  /**
   * / Stand out of the prize money. What you would have had is shared among
   * / everybody else rather than staying in the treasury.
   */
  'set_reward_opt_out' : ActorMethod<[boolean], Result_2>,
  /**
   * / Approve, reject, reset or revoke a sponsorship against the exact
   * / application snapshot shown to the moderator.
   * /   variant { approved } | variant { pending } | variant { no }
   */
  'set_sponsor' : ActorMethod<
    [SponsorTarget, SponsorStatus, [] | [string]],
    Result_10
  >,
  /**
   * / Where this account's rewards should be sent.
   * /
   * / Not the identity you signed in with — that is a per-origin pseudonym,
   * / not a ledger account, and tokens sent to it are gone. Make a wallet at
   * / https://nns.ic0.app/ and give it that principal.
   */
  'set_wallet' : ActorMethod<[Principal], Result_2>,
  /**
   * / Start the season. Freezes the judges and starts the clock, and from here
   * / nobody has to press anything again.
   * /
   * / **Moderators, and only once the canister is sealed.** Sealed means the
   * / canister itself is its sole controller: no external principal holds
   * / upgrade or settings authority, and ingress cannot impersonate the
   * / canister principal. The authority that survives sealing is therefore
   * / only what this installed code grants.
   * /
   * / The seal is checked rather than assumed, on every start. A season that
   * / began while somebody still held the keys would be a season whose rules
   * / could be rewritten halfway through, which is the one thing the whole
   * / arrangement exists to rule out — and it would look identical from
   * / outside to one that could not.
   */
  'start_season' : ActorMethod<[bigint], Result_9>,
  /**
   * / Index-backed totals; cheap enough to poll.
   */
  'stats' : ActorMethod<[], Counts>,
  /**
   * / Submit or replace this week's entry. Hackers only.
   */
  'submit_entry' : ActorMethod<[EntryInput], Result_8>,
  /**
   * / Move an approved sponsor's balance into the treasury. One way.
   */
  'sweep_sponsor' : ActorMethod<[string, Principal], Result_7>,
  /**
   * / Take an app's content down. **Two moderators, and it deletes files.**
   * /
   * / For content that must stop being served: an infringing build, art
   * / somebody else owns, anything unlawful. It removes the package and the
   * / images and says so on the entry — and it leaves the entry, its author
   * / and its votes exactly where they were.
   * /
   * / That last part is deliberate. Judges have already seen and scored what
   * / was there; deleting the row would rewrite a week's arithmetic to cover
   * / for a moderation decision. The entry stands with a notice on it, and the
   * / judges decide what an app with nothing to install is worth.
   * /
   * / Two moderators because it destroys files that cannot be recovered.
   * / The first call records a vote and answers `#NeedsSecond`.
   */
  'takedown_app' : ActorMethod<[bigint, string], Result_6>,
  /**
   * / How many moderators have backed taking this app down, and how many it needs.
   */
  'takedown_tally' : ActorMethod<[bigint, [] | [string]], [] | [Backing]>,
  'terms_info' : ActorMethod<
    [],
    { 'effectiveAt' : bigint, 'version' : bigint }
  >,
  /**
   * / Let a frozen account write again, and optionally clear its spend.
   * /
   * / There is no companion that freezes. Freezing is what the meter does
   * / when an account crosses its allowance — see `Meter.thaw` for why
   * / moderators get one half of that and not the other.
   */
  'thaw_user' : ActorMethod<[string, boolean], Result_5>,
  /**
   * / The ledgers any approved sponsor pledged — what the treasury may hold.
   */
  'treasury_ledgers' : ActorMethod<[], Array<Principal>>,
  'update_profile' : ActorMethod<[Input], Result_2>,
  /**
   * / Everything one person has entered, across every season. Public: a
   * / profile shows what somebody built whether or not you are them.
   */
  'user_entries' : ActorMethod<[string, bigint], Array<Summary>>,
  /**
   * / Raw account rows contain principals, wallet/agent assignments, terms
   * / acceptance and metering state. Only moderators may inspect them.
   */
  'users_admin_page' : ActorMethod<
    [Filter, [] | [Letter], [] | [Cursor], bigint],
    Page
  >,
  /**
   * / One page of users, always alphabetical by handle.
   * /
   * / `letter` restricts to one A-Z bucket ("#" for handles starting with a
   * / digit or underscore) and seeks straight to it — nothing before it is
   * / read. `after` is the previous page's `next`; `null` starts at the top.
   * /
   * / Everyone is a participant, so `#all` includes judges and moderators.
   */
  'users_page' : ActorMethod<
    [Filter, [] | [Letter], [] | [Cursor], bigint],
    PublicPage
  >,
  /**
   * / Handle prefix search, scoped by the same filters.
   */
  'users_search' : ActorMethod<[string, Filter, bigint], Array<PublicUser>>,
  /**
   * / Recover a vanished lifecycle timer after cycles are restored.
   * /
   * / This is deliberately not an override. The caller supplies no target or
   * / timing data. An early call only replaces the one-shot timer at the exact
   * / stored deadline; a due call enters the same guarded phase function as
   * / that timer. Funding and payout retain their leases and retry cadence.
   */
  'wake_automation' : ActorMethod<[], Result_4>,
  /**
   * / When the open week is due to end, if a season is running.
   */
  'week_ends_at' : ActorMethod<[], [] | [bigint]>,
  'whoami' : ActorMethod<[], Principal>,
  /**
   * / Move your own rewards out. **The account holder only, never an agent.**
   * /
   * / The source subaccount is derived from `caller` and is not a parameter,
   * / so there is no input to this method that can name the treasury or
   * / somebody else's rewards. The destination *is* a parameter, which is why
   * / this resolves with `Profiles.owner`: an agent is trusted to drive the
   * / account, not to empty it.
   */
  'withdraw' : ActorMethod<[Principal, Account], Result_3>,
  'withdraw_sponsor' : ActorMethod<[], Result_2>,
  /**
   * / Withdraw only the caller's own still-pending takedown vote.
   */
  'withdraw_takedown' : ActorMethod<[bigint], Result_1>,
  'withdraw_vote' : ActorMethod<[bigint], Result>,
  'withdrawals_locked' : ActorMethod<[], boolean>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
