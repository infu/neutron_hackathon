export const idlFactory = ({ IDL }) => {
  const Title = IDL.Text;
  const Agent = IDL.Principal;
  const JudgeStatus = IDL.Variant({
    'no' : IDL.Null,
    'pending' : IDL.Null,
    'approved' : IDL.Null,
  });
  const Element = IDL.Record({ 'url' : IDL.Text, 'kind' : IDL.Text });
  const Links = IDL.Vec(Element);
  const Logo = IDL.Text;
  const Element__4 = IDL.Record({
    'at' : IDL.Nat64,
    'ledger' : IDL.Principal,
    'amount' : IDL.Nat,
  });
  const Given = IDL.Vec(Element__4);
  const Element__5 = IDL.Record({ 'id' : IDL.Principal, 'sns' : IDL.Bool });
  const Ledgers = IDL.Vec(Element__5);
  const Sponsor = IDL.Record({
    'org' : IDL.Text,
    'logo' : IDL.Opt(Logo),
    'website' : IDL.Text,
    'given' : Given,
    'blurb' : IDL.Text,
    'ledgers' : Ledgers,
  });
  const Wallet = IDL.Principal;
  const SponsorStatus = IDL.Variant({
    'no' : IDL.Null,
    'pending' : IDL.Null,
    'approved' : IDL.Null,
  });
  const Avatar = IDL.Text;
  const User = IDL.Record({
    'id' : IDL.Nat64,
    'bio' : IDL.Text,
    'title' : IDL.Opt(Title),
    'termsVersion' : IDL.Nat,
    'principal' : IDL.Principal,
    'agent' : IDL.Opt(Agent),
    'moderator' : IDL.Bool,
    'termsAt' : IDL.Nat64,
    'displayName' : IDL.Text,
    'createdAt' : IDL.Nat64,
    'judgeStatus' : JudgeStatus,
    'instructions' : IDL.Nat,
    'links' : Links,
    'updatedAt' : IDL.Nat64,
    'rewardOptOut' : IDL.Bool,
    'anonymized' : IDL.Bool,
    'sponsor' : IDL.Opt(Sponsor),
    'hacker' : IDL.Bool,
    'frozen' : IDL.Bool,
    'wallet' : IDL.Opt(Wallet),
    'handle' : IDL.Text,
    'bytes' : IDL.Nat,
    'sponsorStatus' : SponsorStatus,
    'avatar' : IDL.Opt(Avatar),
  });
  const ConstraintViolation = IDL.Record({
    'field' : IDL.Text,
    'message' : IDL.Text,
  });
  const Error__1 = IDL.Variant({
    'Internal' : IDL.Text,
    'NotFound' : IDL.Nat64,
    'AlreadyExists' : IDL.Nat64,
    'ConstraintViolation' : ConstraintViolation,
  });
  const Error__3 = IDL.Variant({
    'Db' : Error__1,
    'Invalid' : IDL.Text,
    'NotRegistered' : IDL.Null,
    'Anonymous' : IDL.Null,
    'Closed' : IDL.Null,
    'AlreadyRegistered' : IDL.Null,
    'Settling' : IDL.Null,
    'Terms' : IDL.Null,
    'HandleTaken' : IDL.Null,
    'Frozen' : IDL.Null,
  });
  const Result_2 = IDL.Variant({ 'ok' : User, 'err' : Error__3 });
  const SponsorApplication = IDL.Record({
    'org' : IDL.Text,
    'logo' : IDL.Opt(IDL.Text),
    'website' : IDL.Text,
    'blurb' : IDL.Text,
    'ledgers' : IDL.Vec(Element__5),
  });
  const ApprovalKind = IDL.Variant({
    'judge' : IDL.Null,
    'sponsor' : IDL.Null,
    'takedown' : IDL.Null,
  });
  const Backing = IDL.Record({
    'context' : IDL.Opt(IDL.Text),
    'votes' : IDL.Nat,
    'mine' : IDL.Bool,
    'needed' : IDL.Nat,
  });
  const Icon = IDL.Text;
  const Kind = IDL.Variant({ 'entry' : IDL.Null, 'version' : IDL.Null });
  const Element__1 = IDL.Text;
  const Shots = IDL.Vec(Element__1);
  const State = IDL.Variant({
    'expired' : IDL.Null,
    'pending' : IDL.Null,
    'approved' : IDL.Null,
    'rejected' : IDL.Null,
  });
  const PkgKey = IDL.Text;
  const TargetEntryId = IDL.Nat64;
  const Reviewer = IDL.Nat64;
  const Revision = IDL.Record({
    'id' : IDL.Nat64,
    'url' : IDL.Text,
    'title' : IDL.Text,
    'season_id' : IDL.Nat64,
    'icon' : IDL.Opt(Icon),
    'kind' : Kind,
    'note' : IDL.Text,
    'createdAt' : IDL.Nat64,
    'slug' : IDL.Text,
    'week' : IDL.Nat,
    'user_id' : IDL.Nat64,
    'links' : Links,
    'shots' : Shots,
    'version' : IDL.Text,
    'summary' : IDL.Text,
    'state' : State,
    'pkgKey' : IDL.Opt(PkgKey),
    'targetEntryId' : IDL.Opt(TargetEntryId),
    'reviewer' : IDL.Opt(Reviewer),
    'decidedAt' : IDL.Nat64,
    'reason' : IDL.Text,
  });
  const Error = IDL.Variant({
    'Db' : Error__1,
    'AlreadyVoted' : IDL.Null,
    'Invalid' : IDL.Text,
    'NoSeason' : IDL.Null,
    'NotRegistered' : IDL.Null,
    'NotAllowed' : IDL.Null,
    'NoWallet' : IDL.Null,
    'NotAHacker' : IDL.Null,
    'NotFound' : IDL.Null,
    'SeasonRunning' : IDL.Null,
    'Distributing' : IDL.Null,
    'WeekClosed' : IDL.Null,
    'NotAJudge' : IDL.Null,
    'Frozen' : IDL.Null,
    'VoteLimit' : IDL.Null,
    'VoteLocked' : IDL.Null,
    'OwnEntry' : IDL.Null,
  });
  const Error__5 = IDL.Variant({
    'Db' : Error__1,
    'Invalid' : IDL.Text,
    'NotAllowed' : IDL.Null,
    'NotFound' : IDL.Null,
    'Season' : Error,
    'Frozen' : IDL.Null,
    'NotPending' : IDL.Null,
  });
  const Result_8 = IDL.Variant({ 'ok' : Revision, 'err' : Error__5 });
  const Info = IDL.Record({
    'key' : IDL.Text,
    'contentType' : IDL.Text,
    'size' : IDL.Nat,
    'complete' : IDL.Bool,
    'chunks' : IDL.Nat,
    'contentEncoding' : IDL.Text,
  });
  const Cmd = IDL.Variant({
    'chunk' : IDL.Record({
      'key' : IDL.Text,
      'content' : IDL.Vec(IDL.Nat8),
      'index' : IDL.Nat,
    }),
    'clear' : IDL.Record({ 'prefix' : IDL.Text }),
    'delete' : IDL.Record({ 'key' : IDL.Text }),
    'store' : IDL.Record({
      'key' : IDL.Text,
      'content' : IDL.Vec(IDL.Nat8),
      'contentType' : IDL.Text,
      'chunks' : IDL.Nat,
      'contentEncoding' : IDL.Text,
    }),
  });
  const Result_11 = IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text });
  const Pkg = IDL.Record({
    'at' : IDL.Nat64,
    'key' : IDL.Text,
    'name' : IDL.Text,
    'size' : IDL.Nat,
    'version' : IDL.Text,
  });
  const Upload = IDL.Record({ 'name' : IDL.Text, 'size' : IDL.Nat });
  const Element__2 = IDL.Record({
    'at' : IDL.Nat64,
    'note' : IDL.Text,
    'version' : IDL.Text,
    'upload' : IDL.Opt(Upload),
  });
  const Updates = IDL.Vec(Element__2);
  const Outcome = IDL.Variant({
    'won' : IDL.Null,
    'advanced' : IDL.Null,
    'none' : IDL.Null,
    'rewarded' : IDL.Null,
  });
  const OriginId = IDL.Nat64;
  const Entry = IDL.Record({
    'id' : IDL.Nat64,
    'pkg' : IDL.Opt(Pkg),
    'url' : IDL.Text,
    'title' : IDL.Text,
    'takedownReason' : IDL.Text,
    'votes' : IDL.Nat,
    'season_id' : IDL.Nat64,
    'icon' : IDL.Opt(Icon),
    'createdAt' : IDL.Nat64,
    'slug' : IDL.Text,
    'week' : IDL.Nat,
    'user_id' : IDL.Nat64,
    'links' : Links,
    'shots' : Shots,
    'summary' : IDL.Text,
    'updatedAt' : IDL.Nat64,
    'takedownAt' : IDL.Nat64,
    'updates' : Updates,
    'outcome' : Outcome,
    'origin_id' : IDL.Opt(OriginId),
  });
  const Result = IDL.Variant({ 'ok' : Entry, 'err' : Error });
  const Element__9 = IDL.Principal;
  const LedgerAllowlist = IDL.Vec(Element__9);
  const Store = IDL.Record({
    'siteTitle' : IDL.Text,
    'ledgerAllowlist' : LedgerAllowlist,
    'ledgerAllowlistSet' : IDL.Bool,
    'nextSeasonUrl' : IDL.Text,
    'frontendHash' : IDL.Text,
    'registrationOpen' : IDL.Bool,
    'instructionCap' : IDL.Nat,
  });
  const ControllerRecovery = IDL.Record({
    'recovered' : IDL.Bool,
    'votes' : IDL.Nat,
    'mine' : IDL.Bool,
    'needed' : IDL.Nat,
  });
  const Order = IDL.Variant({ 'instructions' : IDL.Null, 'bytes' : IDL.Null });
  const Element__8 = IDL.Record({
    'ledger' : IDL.Principal,
    'reason' : IDL.Text,
  });
  const FundingFailures = IDL.Vec(Element__8);
  const Phase = IDL.Variant({
    'finished' : IDL.Null,
    'draft' : IDL.Null,
    'running' : IDL.Null,
  });
  const Payout = IDL.Variant({
    'none' : IDL.Null,
    'paid' : IDL.Null,
    'approved' : IDL.Null,
    'proposed' : IDL.Null,
    'failed' : IDL.Null,
    'paying' : IDL.Null,
  });
  const Season = IDL.Record({
    'id' : IDL.Nat64,
    'startedAt' : IDL.Nat64,
    'fundingReady' : IDL.Bool,
    'fundingFailures' : FundingFailures,
    'endedAt' : IDL.Nat64,
    'week' : IDL.Nat,
    'fundingAttempts' : IDL.Nat,
    'number' : IDL.Nat,
    'weekEndsAt' : IDL.Nat64,
    'phase' : Phase,
    'payout' : Payout,
  });
  const Result_9 = IDL.Variant({ 'ok' : Season, 'err' : Error });
  const Result_5 = IDL.Variant({ 'ok' : User, 'err' : IDL.Text });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Deposit = IDL.Record({
    'subaccount' : IDL.Text,
    'account' : Account,
    'ledgers' : IDL.Vec(Element__5),
  });
  const Detail = IDL.Record({
    'title' : IDL.Opt(IDL.Text),
    'displayName' : IDL.Text,
    'voted' : IDL.Bool,
    'mine' : IDL.Bool,
    'judge' : IDL.Bool,
    'entry' : Entry,
    'versionsEditable' : IDL.Bool,
    'handle' : IDL.Text,
    'detailsEditable' : IDL.Bool,
    'avatar' : IDL.Opt(IDL.Text),
  });
  const State__1 = IDL.Variant({
    'fresh' : IDL.Null,
    'reviewed' : IDL.Null,
    'dismissed' : IDL.Null,
  });
  const HandledBy = IDL.Nat64;
  const Notice = IDL.Record({
    'at' : IDL.Nat64,
    'id' : IDL.Nat64,
    'body' : IDL.Text,
    'state' : State__1,
    'handledAt' : IDL.Nat64,
    'handledBy' : IDL.Opt(HandledBy),
    'reporter' : IDL.Principal,
  });
  const Error__7 = IDL.Variant({
    'Db' : Error__1,
    'Empty' : IDL.Null,
    'TooLong' : IDL.Nat,
    'TooSoon' : IDL.Nat,
    'Full' : IDL.Null,
    'NotAllowed' : IDL.Null,
    'NotFound' : IDL.Null,
  });
  const Result_14 = IDL.Variant({ 'ok' : Notice, 'err' : Error__7 });
  const HeaderField = IDL.Tuple(IDL.Text, IDL.Text);
  const Request = IDL.Record({
    'url' : IDL.Text,
    'method' : IDL.Text,
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(HeaderField),
    'certificate_version' : IDL.Opt(IDL.Nat16),
  });
  const Token = IDL.Record({
    'key' : IDL.Text,
    'sha256' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'index' : IDL.Nat,
    'content_encoding' : IDL.Text,
  });
  const Callback = IDL.Record({
    'token' : IDL.Opt(Token),
    'body' : IDL.Vec(IDL.Nat8),
  });
  const CallbackFunc = IDL.Func([Token], [Callback], ['query']);
  const StreamingStrategy = IDL.Variant({
    'Callback' : IDL.Record({ 'token' : Token, 'callback' : CallbackFunc }),
  });
  const Response = IDL.Record({
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(HeaderField),
    'upgrade' : IDL.Opt(IDL.Bool),
    'streaming_strategy' : IDL.Opt(StreamingStrategy),
    'status_code' : IDL.Nat16,
  });
  const Filter = IDL.Variant({
    'all' : IDL.Null,
    'judges' : IDL.Null,
    'pending' : IDL.Null,
    'observers' : IDL.Null,
    'sponsorsPending' : IDL.Null,
    'moderators' : IDL.Null,
    'sponsors' : IDL.Null,
    'hackers' : IDL.Null,
  });
  const Letter = IDL.Text;
  const LetterCount = IDL.Record({ 'count' : IDL.Nat, 'letter' : Letter });
  const Cursor__1 = IDL.Nat64;
  const Kind__1 = IDL.Variant({
    'sponsor_rejected' : IDL.Null,
    'sponsor_revoked' : IDL.Null,
    'moderator_revoked' : IDL.Null,
    'judge_revoked' : IDL.Null,
    'moderator_granted' : IDL.Null,
    'sponsor_reset' : IDL.Null,
    'judge_approved' : IDL.Null,
    'judge_rejected' : IDL.Null,
    'sponsor_approved' : IDL.Null,
    'judge_reset' : IDL.Null,
  });
  const EntryView = IDL.Record({
    'at' : IDL.Nat64,
    'by' : IDL.Opt(IDL.Text),
    'id' : IDL.Nat64,
    'subject' : IDL.Opt(IDL.Text),
    'kind' : Kind__1,
    'note' : IDL.Opt(IDL.Text),
    'subjectId' : IDL.Nat64,
    'byPrincipal' : IDL.Principal,
  });
  const LogPage = IDL.Record({
    'total' : IDL.Nat,
    'next' : IDL.Opt(Cursor__1),
    'rows' : IDL.Vec(EntryView),
  });
  const Link = IDL.Record({ 'url' : IDL.Text, 'kind' : IDL.Text });
  const SponsorInfo = IDL.Record({
    'org' : IDL.Text,
    'logo' : IDL.Opt(Logo),
    'website' : IDL.Text,
    'given' : Given,
    'blurb' : IDL.Text,
    'ledgers' : Ledgers,
  });
  const PublicUser = IDL.Record({
    'id' : IDL.Nat64,
    'bio' : IDL.Text,
    'title' : IDL.Opt(IDL.Text),
    'moderator' : IDL.Bool,
    'displayName' : IDL.Text,
    'createdAt' : IDL.Nat64,
    'judgeStatus' : JudgeStatus,
    'links' : IDL.Vec(Link),
    'updatedAt' : IDL.Nat64,
    'anonymized' : IDL.Bool,
    'sponsor' : IDL.Opt(SponsorInfo),
    'hacker' : IDL.Bool,
    'handle' : IDL.Text,
    'sponsorStatus' : SponsorStatus,
    'avatar' : IDL.Opt(IDL.Text),
  });
  const Award = IDL.Variant({
    'bronze' : IDL.Null,
    'gold' : IDL.Null,
    'silver' : IDL.Null,
  });
  const State__3 = IDL.Variant({
    'skipped' : IDL.Null,
    'paid' : IDL.Null,
    'planned' : IDL.Null,
    'sending' : IDL.Null,
    'failed' : IDL.Null,
  });
  const Block = IDL.Nat;
  const Payout__1 = IDL.Record({
    'id' : IDL.Nat64,
    'to' : IDL.Principal,
    'fee' : IDL.Nat,
    'net' : IDL.Nat,
    'award' : Award,
    'dust' : IDL.Nat,
    'season_id' : IDL.Nat64,
    'note' : IDL.Text,
    'attempts' : IDL.Nat,
    'createdAtTime' : IDL.Nat64,
    'user_id' : IDL.Nat64,
    'state' : State__3,
    'ledger' : IDL.Principal,
    'gross' : IDL.Nat,
    'block' : IDL.Opt(Block),
    'entry_id' : IDL.Nat64,
  });
  const Error__4 = IDL.Variant({
    'NoSeason' : IDL.Null,
    'NotRegistered' : IDL.Null,
    'Nothing' : IDL.Null,
    'TooSoon' : IDL.Nat,
    'NotASponsor' : IDL.Null,
    'NoLedger' : IDL.Null,
    'Transfer' : IDL.Text,
    'Frozen' : IDL.Null,
  });
  const Result_7 = IDL.Variant({ 'ok' : IDL.Nat, 'err' : Error__4 });
  const Result_17 = IDL.Variant({
    'ok' : IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat)),
    'err' : Error__4,
  });
  const Line = IDL.Record({
    'id' : IDL.Nat64,
    'to' : IDL.Principal,
    'fee' : IDL.Nat,
    'net' : IDL.Nat,
    'award' : Award,
    'displayName' : IDL.Text,
    'dust' : IDL.Nat,
    'season_id' : IDL.Nat64,
    'note' : IDL.Text,
    'attempts' : IDL.Nat,
    'createdAtTime' : IDL.Nat64,
    'user_id' : IDL.Nat64,
    'state' : State__3,
    'ledger' : IDL.Principal,
    'gross' : IDL.Nat,
    'block' : IDL.Opt(Block),
    'handle' : IDL.Text,
    'entry_id' : IDL.Nat64,
  });
  const Progress = IDL.Record({
    'skipped' : IDL.Nat,
    'left' : IDL.Nat,
    'paid' : IDL.Nat,
    'failed' : IDL.Nat,
  });
  const Error__6 = IDL.Variant({
    'Db' : Error__1,
    'Empty' : IDL.Null,
    'NoSeason' : IDL.Null,
    'NotAllowed' : IDL.Null,
    'WrongPhase' : IDL.Text,
    'NotFinished' : IDL.Null,
  });
  const Result_16 = IDL.Variant({ 'ok' : IDL.Nat, 'err' : Error__6 });
  const PackageInput = IDL.Record({ 'key' : IDL.Text });
  const UpdateInput = IDL.Record({
    'pkg' : IDL.Opt(PackageInput),
    'note' : IDL.Text,
    'version' : IDL.Text,
  });
  const Result_15 = IDL.Variant({
    'ok' : ControllerRecovery,
    'err' : IDL.Text,
  });
  const Input = IDL.Record({
    'bio' : IDL.Text,
    'terms' : IDL.Bool,
    'title' : IDL.Opt(IDL.Text),
    'displayName' : IDL.Text,
    'links' : IDL.Vec(Link),
    'handle' : IDL.Text,
  });
  const Result_13 = IDL.Variant({ 'ok' : Progress, 'err' : Error__6 });
  const Summary = IDL.Record({
    'id' : IDL.Nat64,
    'url' : IDL.Text,
    'title' : IDL.Text,
    'takedownReason' : IDL.Text,
    'votes' : IDL.Nat,
    'season_id' : IDL.Nat64,
    'icon' : IDL.Opt(IDL.Text),
    'shot' : IDL.Opt(IDL.Text),
    'week' : IDL.Nat,
    'user_id' : IDL.Nat64,
    'links' : IDL.Nat,
    'shots' : IDL.Nat,
    'summary' : IDL.Text,
    'takedownAt' : IDL.Nat64,
    'updates' : IDL.Nat,
    'hasPackage' : IDL.Bool,
    'outcome' : Outcome,
    'origin_id' : IDL.Opt(IDL.Nat64),
  });
  const View = IDL.Record({
    'title' : IDL.Opt(IDL.Text),
    'displayName' : IDL.Text,
    'voted' : IDL.Bool,
    'mine' : IDL.Bool,
    'judge' : IDL.Bool,
    'entry' : Summary,
    'handle' : IDL.Text,
    'avatar' : IDL.Opt(IDL.Text),
  });
  const WeekView = IDL.Record({
    'total' : IDL.Nat,
    'week' : IDL.Nat,
    'entries' : IDL.Vec(View),
  });
  const WeekPage = IDL.Record({
    'total' : IDL.Nat,
    'next' : IDL.Opt(IDL.Nat),
    'rows' : IDL.Vec(View),
  });
  const JudgeTarget = IDL.Record({
    'id' : IDL.Nat64,
    'expectedStatus' : JudgeStatus,
    'expectedUpdatedAt' : IDL.Nat64,
  });
  const Tally = IDL.Record({ 'votes' : IDL.Nat, 'needed' : IDL.Nat });
  const Error__2 = IDL.Variant({
    'Db' : Error__1,
    'Invalid' : IDL.Text,
    'JudgesFrozen' : IDL.Null,
    'NotRegistered' : IDL.Null,
    'NotAllowed' : IDL.Null,
    'NoChange' : IDL.Null,
    'SponsorsFrozen' : IDL.Null,
    'NoProfile' : IDL.Null,
    'NeedsSecond' : Tally,
  });
  const Result_10 = IDL.Variant({ 'ok' : User, 'err' : Error__2 });
  const Result_12 = IDL.Variant({
    'ok' : IDL.Vec(IDL.Principal),
    'err' : IDL.Text,
  });
  const ModeratorTarget = IDL.Record({
    'id' : IDL.Nat64,
    'expectedOn' : IDL.Bool,
    'expectedUpdatedAt' : IDL.Nat64,
  });
  const SponsorTarget = IDL.Record({
    'id' : IDL.Nat64,
    'expectedStatus' : SponsorStatus,
    'expectedUpdatedAt' : IDL.Nat64,
  });
  const Counts = IDL.Record({
    'judges' : IDL.Nat,
    'pending' : IDL.Nat,
    'observers' : IDL.Nat,
    'sponsorsPending' : IDL.Nat,
    'users' : IDL.Nat,
    'moderators' : IDL.Nat,
    'sponsors' : IDL.Nat,
    'hackers' : IDL.Nat,
  });
  const EntryInput = IDL.Record({
    'pkg' : PackageInput,
    'url' : IDL.Text,
    'title' : IDL.Text,
    'icon' : IDL.Opt(IDL.Text),
    'slug' : IDL.Text,
    'links' : IDL.Vec(Link),
    'shots' : IDL.Vec(IDL.Text),
    'summary' : IDL.Text,
  });
  const Result_6 = IDL.Variant({ 'ok' : Entry, 'err' : Error__2 });
  const Cursor = IDL.Text;
  const Page = IDL.Record({
    'total' : IDL.Nat,
    'next' : IDL.Opt(Cursor),
    'rows' : IDL.Vec(User),
  });
  const PublicPage = IDL.Record({
    'total' : IDL.Nat,
    'next' : IDL.Opt(Cursor),
    'rows' : IDL.Vec(PublicUser),
  });
  const AutomationStage = IDL.Variant({
    'round' : IDL.Nat,
    'funding' : IDL.Null,
    'payout' : IDL.Null,
  });
  const AutomationWake = IDL.Variant({
    'ran' : IDL.Record({
      'nextAt' : IDL.Opt(IDL.Nat64),
      'stage' : AutomationStage,
    }),
    'armed' : IDL.Record({ 'at' : IDL.Nat64, 'stage' : AutomationStage }),
    'settled' : IDL.Null,
    'busy' : IDL.Record({ 'since' : IDL.Nat64, 'stage' : AutomationStage }),
    'idle' : IDL.Null,
  });
  const AutomationError = IDL.Variant({
    'NotAllowed' : IDL.Null,
    'Unavailable' : IDL.Null,
  });
  const Result_4 = IDL.Variant({
    'ok' : AutomationWake,
    'err' : AutomationError,
  });
  const WithdrawError = IDL.Variant({
    'NotRegistered' : IDL.Null,
    'Nothing' : IDL.Null,
    'BadDestination' : IDL.Null,
    'Locked' : IDL.Null,
    'Transfer' : IDL.Text,
    'Frozen' : IDL.Null,
  });
  const Result_3 = IDL.Variant({ 'ok' : IDL.Nat, 'err' : WithdrawError });
  const Result_1 = IDL.Variant({ 'ok' : IDL.Null, 'err' : Error__2 });
  return IDL.Service({
    'am_moderator' : IDL.Func([], [IDL.Bool], ['query']),
    'apply_as_judge' : IDL.Func([], [Result_2], []),
    'apply_as_sponsor' : IDL.Func([SponsorApplication], [Result_2], []),
    'approval_tallies' : IDL.Func(
        [ApprovalKind, IDL.Vec(IDL.Nat64)],
        [IDL.Vec(IDL.Tuple(IDL.Nat64, Backing))],
        ['query'],
      ),
    'approve_revision' : IDL.Func([IDL.Nat64], [Result_8], []),
    'assets_count' : IDL.Func([], [IDL.Nat], ['query']),
    'assets_list' : IDL.Func([IDL.Text, IDL.Nat], [IDL.Vec(Info)], ['query']),
    'assets_upload' : IDL.Func([Cmd], [Result_11], []),
    'cast_vote' : IDL.Func([IDL.Nat64], [Result], []),
    'clock_armed' : IDL.Func([], [IDL.Bool], ['query']),
    'config' : IDL.Func([], [Store], ['query']),
    'controller_recovery_tally' : IDL.Func(
        [],
        [IDL.Opt(ControllerRecovery)],
        ['query'],
      ),
    'costliest' : IDL.Func([Order, IDL.Nat], [IDL.Vec(User)], ['query']),
    'create_season' : IDL.Func([], [Result_9], []),
    'delete_account' : IDL.Func([], [Result_5], []),
    'delete_app' : IDL.Func([IDL.Nat64], [Result_11], []),
    'deposit_for' : IDL.Func([IDL.Text], [IDL.Opt(Deposit)], ['query']),
    'entry_detail' : IDL.Func([IDL.Nat64], [IDL.Opt(Detail)], ['query']),
    'file_notice' : IDL.Func([IDL.Text], [Result_14], []),
    'frontend_asset_keys' : IDL.Func([], [IDL.Vec(IDL.Text)], ['query']),
    'frontend_hash' : IDL.Func([], [IDL.Text], ['query']),
    'funding_closing' : IDL.Func([], [IDL.Bool], ['query']),
    'http_request' : IDL.Func([Request], [Response], ['query']),
    'http_request_streaming_callback' : IDL.Func(
        [Token],
        [Callback],
        ['query'],
      ),
    'is_controller' : IDL.Func([], [IDL.Bool], ['query']),
    'judges_frozen' : IDL.Func([], [IDL.Bool], ['query']),
    'launch_latched' : IDL.Func([], [IDL.Bool], ['query']),
    'letter_counts' : IDL.Func([Filter], [IDL.Vec(LetterCount)], ['query']),
    'me' : IDL.Func([], [IDL.Opt(User)], ['query']),
    'memory' : IDL.Func(
        [],
        [
          IDL.Record({
            'files' : IDL.Nat,
            'stableLive' : IDL.Nat,
            'heap' : IDL.Nat,
            'heapClaimed' : IDL.Nat,
            'cycles' : IDL.Nat,
            'stableReserved' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'moderation_log' : IDL.Func(
        [IDL.Opt(Cursor__1), IDL.Nat],
        [LogPage],
        ['query'],
      ),
    'moderation_log_for' : IDL.Func(
        [IDL.Text, IDL.Opt(Cursor__1), IDL.Nat],
        [LogPage],
        ['query'],
      ),
    'moderators' : IDL.Func([IDL.Nat], [IDL.Vec(PublicUser)], ['query']),
    'my_allowance' : IDL.Func(
        [],
        [IDL.Opt(IDL.Record({ 'cap' : IDL.Nat, 'used' : IDL.Nat }))],
        ['query'],
      ),
    'my_deposit' : IDL.Func([], [IDL.Opt(Deposit)], ['query']),
    'my_entries' : IDL.Func([], [IDL.Vec(Entry)], ['query']),
    'my_entry' : IDL.Func([], [IDL.Opt(Entry)], ['query']),
    'my_payouts' : IDL.Func([], [IDL.Vec(Payout__1)], ['query']),
    'my_revisions' : IDL.Func([IDL.Nat], [IDL.Vec(Revision)], ['query']),
    'my_reward_account' : IDL.Func([], [IDL.Opt(Account)], ['query']),
    'my_upload' : IDL.Func([Cmd], [Result_11], []),
    'my_vote_on' : IDL.Func([IDL.Nat64], [IDL.Bool], ['query']),
    'my_votes_left' : IDL.Func([], [IDL.Nat], ['query']),
    'notices' : IDL.Func([IDL.Nat], [IDL.Vec(Notice)], ['query']),
    'notices_pending' : IDL.Func([], [IDL.Nat], ['query']),
    'notify_deposit' : IDL.Func([IDL.Principal], [Result_7], []),
    'notify_deposits' : IDL.Func([], [Result_17], []),
    'payout_armed' : IDL.Func([], [IDL.Bool], ['query']),
    'payout_plan' : IDL.Func([IDL.Nat64], [IDL.Vec(Line)], ['query']),
    'payout_progress' : IDL.Func([IDL.Nat64], [Progress], ['query']),
    'pending_judges' : IDL.Func([IDL.Nat], [IDL.Vec(PublicUser)], ['query']),
    'prize_pool' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat))],
        ['query'],
      ),
    'profile' : IDL.Func([IDL.Text], [IDL.Opt(PublicUser)], ['query']),
    'propose_payout' : IDL.Func([IDL.Nat64], [Result_16], []),
    'publish_update' : IDL.Func([IDL.Nat64, UpdateInput], [Result_8], []),
    'recent_users' : IDL.Func([IDL.Nat], [IDL.Vec(PublicUser)], ['query']),
    'recover_canister' : IDL.Func([], [Result_15], []),
    'register' : IDL.Func([Input], [Result_2], []),
    'reject_revision' : IDL.Func([IDL.Nat64, IDL.Text], [Result_8], []),
    'resolve_notice' : IDL.Func([IDL.Nat64, State__1], [Result_14], []),
    'review_pending' : IDL.Func([], [IDL.Nat], ['query']),
    'review_queue' : IDL.Func([IDL.Nat], [IDL.Vec(Revision)], ['query']),
    'run_payout' : IDL.Func([IDL.Nat64], [Result_13], []),
    'seal_canister' : IDL.Func([], [Result_11], []),
    'season' : IDL.Func([], [IDL.Opt(Season)], ['query']),
    'season_by_number' : IDL.Func([IDL.Nat], [IDL.Opt(Season)], ['query']),
    'season_map' : IDL.Func(
        [IDL.Nat64, IDL.Nat],
        [IDL.Vec(WeekView)],
        ['query'],
      ),
    'season_running' : IDL.Func([], [IDL.Opt(Season)], ['query']),
    'season_week' : IDL.Func(
        [IDL.Nat64, IDL.Nat, IDL.Nat],
        [IDL.Vec(Entry)],
        ['query'],
      ),
    'season_week_page' : IDL.Func(
        [IDL.Nat64, IDL.Nat, IDL.Opt(IDL.Nat), IDL.Nat],
        [WeekPage],
        ['query'],
      ),
    'season_week_view' : IDL.Func(
        [IDL.Nat64, IDL.Nat, IDL.Nat],
        [IDL.Vec(View)],
        ['query'],
      ),
    'seasons' : IDL.Func([IDL.Nat], [IDL.Vec(Season)], ['query']),
    'set_agent' : IDL.Func([IDL.Opt(IDL.Principal)], [Result_2], []),
    'set_avatar' : IDL.Func([IDL.Opt(IDL.Text)], [Result_2], []),
    'set_config' : IDL.Func([IDL.Text, IDL.Bool], [Result_11], []),
    'set_hacker' : IDL.Func([IDL.Bool], [Result_2], []),
    'set_instruction_cap' : IDL.Func([IDL.Nat], [Result_11], []),
    'set_judge' : IDL.Func(
        [JudgeTarget, JudgeStatus, IDL.Opt(IDL.Text)],
        [Result_10],
        [],
      ),
    'set_ledger_allowlist' : IDL.Func(
        [IDL.Vec(IDL.Principal)],
        [Result_12],
        [],
      ),
    'set_moderator' : IDL.Func(
        [ModeratorTarget, IDL.Bool, IDL.Opt(IDL.Text)],
        [Result_10],
        [],
      ),
    'set_next_season_url' : IDL.Func([IDL.Text], [Result_11], []),
    'set_reward_opt_out' : IDL.Func([IDL.Bool], [Result_2], []),
    'set_sponsor' : IDL.Func(
        [SponsorTarget, SponsorStatus, IDL.Opt(IDL.Text)],
        [Result_10],
        [],
      ),
    'set_wallet' : IDL.Func([IDL.Principal], [Result_2], []),
    'start_season' : IDL.Func([IDL.Nat64], [Result_9], []),
    'stats' : IDL.Func([], [Counts], ['query']),
    'submit_entry' : IDL.Func([EntryInput], [Result_8], []),
    'sweep_sponsor' : IDL.Func([IDL.Text, IDL.Principal], [Result_7], []),
    'takedown_app' : IDL.Func([IDL.Nat64, IDL.Text], [Result_6], []),
    'takedown_tally' : IDL.Func(
        [IDL.Nat64, IDL.Opt(IDL.Text)],
        [IDL.Opt(Backing)],
        ['query'],
      ),
    'terms_info' : IDL.Func(
        [],
        [IDL.Record({ 'effectiveAt' : IDL.Nat64, 'version' : IDL.Nat })],
        ['query'],
      ),
    'thaw_user' : IDL.Func([IDL.Text, IDL.Bool], [Result_5], []),
    'treasury_ledgers' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'update_profile' : IDL.Func([Input], [Result_2], []),
    'user_entries' : IDL.Func(
        [IDL.Text, IDL.Nat],
        [IDL.Vec(Summary)],
        ['query'],
      ),
    'users_admin_page' : IDL.Func(
        [Filter, IDL.Opt(Letter), IDL.Opt(Cursor), IDL.Nat],
        [Page],
        ['query'],
      ),
    'users_page' : IDL.Func(
        [Filter, IDL.Opt(Letter), IDL.Opt(Cursor), IDL.Nat],
        [PublicPage],
        ['query'],
      ),
    'users_search' : IDL.Func(
        [IDL.Text, Filter, IDL.Nat],
        [IDL.Vec(PublicUser)],
        ['query'],
      ),
    'wake_automation' : IDL.Func([], [Result_4], []),
    'week_ends_at' : IDL.Func([], [IDL.Opt(IDL.Nat64)], ['query']),
    'whoami' : IDL.Func([], [IDL.Principal], ['query']),
    'withdraw' : IDL.Func([IDL.Principal, Account], [Result_3], []),
    'withdraw_sponsor' : IDL.Func([], [Result_2], []),
    'withdraw_takedown' : IDL.Func([IDL.Nat64], [Result_1], []),
    'withdraw_vote' : IDL.Func([IDL.Nat64], [Result], []),
    'withdrawals_locked' : IDL.Func([], [IDL.Bool], ['query']),
  });
};
export const init = ({ IDL }) => { return []; };
