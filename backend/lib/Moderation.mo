/// Moderator actions and the audit log behind them.
///
/// Kept separate from `Profiles.mo`: that module owns what a user does to
/// their own profile, this one owns what a moderator does to somebody else's.
///
/// Every successful judge, sponsor or moderator status change writes an
/// `actions` row. The newest 32 per subject are retained — enough to undo and
/// explain ordinary decisions without leaving a trusted endpoint as an
/// unbounded heap writer. Quorum backing has its own short-lived table.

import Array "mo:core/Array";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";

import IndexRuntime "mo:ashroot/index_runtime";

import Ashroot "../.ashroot/lib";
import Profiles "./Profiles";
import Season "./Season";

module {

    public type User = Profiles.User;
    public type JudgeStatus = Profiles.JudgeStatus;
    public type SponsorStatus = Profiles.SponsorStatus;
    public type Entry = Ashroot.Types.Action;
    public type JudgeTarget = {
        id : Nat64;
        expectedStatus : JudgeStatus;
        expectedUpdatedAt : Nat64;
    };
    public type SponsorTarget = {
        id : Nat64;
        expectedStatus : SponsorStatus;
        expectedUpdatedAt : Nat64;
    };
    public type ModeratorTarget = {
        id : Nat64;
        expectedOn : Bool;
        expectedUpdatedAt : Nat64;
    };

    /// A log row with the people resolved.
    ///
    /// The stored row holds a subject id and an actor principal, neither of
    /// which means anything to a reader. Resolving both here costs two index
    /// lookups per row and saves the client a round trip per distinct actor.
    ///
    /// `by` is null when the action came from a raw controller rather than a
    /// registered moderator — the principal is still there to identify them.
    /// (`actor` is a Motoko keyword, hence `by`.)
    public type EntryView = {
        id : Nat64;
        kind : Kind;
        note : ?Text;
        at : Nat64;
        subjectId : Nat64;
        subject : ?Text;
        by : ?Text;
        byPrincipal : Principal;
    };
    public type Kind = Ashroot.Types.Actions.Action.Kind;

    public type Error = {
        #NotAllowed;
        #NotRegistered;
        #NoChange;
        #JudgesFrozen;
        #SponsorsFrozen;
        /// The decision needs a second moderator. Carries the tally so the UI
        /// can say "1 of 2" rather than making the caller ask again.
        #NeedsSecond : Tally;
        /// A controller has no profile row, so it has no vote to cast. It can
        /// still reject, reset and revoke — those are one-moderator actions.
        #NoProfile;
        #Invalid : Text;
        #Db : Ashroot.Errors.Error;
    };

    // ── Two moderators ───────────────────────────────────────────────────────

    /// **[decided]** Approving a judge or a sponsor, or taking an app's content
    /// down, takes **two** moderators.
    ///
    /// These are the two decisions that are hard to walk back. A judge sees
    /// every entry and their votes decide the money; a sponsor's pledged
    /// canister id is one this canister will later be asked to call. Both are
    /// also exactly the shape of thing a single compromised or careless
    /// moderator account gets used for.
    ///
    /// A takedown is on the same footing, for the mirror-image reason: it
    /// destroys files that cannot be recovered, and one moderator acting alone
    /// — mistaken, pressured, or compromised — should not be able to erase
    /// somebody's entry from a competition they are winning.
    ///
    /// Rejecting, resetting and revoking stay single-moderator. The asymmetry
    /// is the point: the reversible direction should not need a quorum, and
    /// making it need one would mean a bad actor already through the door
    /// takes two people to remove.
    public let SECONDS_NEEDED = 2;
    let STALE_TARGET = "the account or application changed; refresh and try again";

    public type ApprovalKind = Ashroot.Types.Approvals.Approval.Kind;

    public type Tally = { votes : Nat; needed : Nat };

    /// Reason bindings live beside, not inside, the long-lived Approval row.
    /// Adding a field to that persisted record would make an old-to-new EOP
    /// upgrade incompatible. An initialized actor-level Map is compatible and
    /// remains one small piece of state keyed by the approval's immutable id.
    public type TakedownContexts = Map.Map<Nat64, Text>;

    public func initTakedownContexts() : TakedownContexts {
        Map.empty<Nat64, Text>();
    };

    func code(kind : ApprovalKind) : Nat = switch (kind) {
        case (#judge) 0;
        case (#sponsor) 1;
        case (#takedown) 2;
    };

    /// Only moderators who still hold the role may carry a quorum. Approval
    /// rows are retained until the subject changes, so checking the user row
    /// here makes revocation and anonymisation take effect immediately without
    /// another cleanup index or migration.
    func currentModerator(db : Ashroot.DB, id : Nat64) : Bool {
        switch (db.users.get(id)) {
            case (?user) user.moderator and not user.anonymized;
            case null false;
        };
    };

    /// How many current moderators backed this decision, and who.
    public func backers(db : Ashroot.DB, subject : Nat64, kind : ApprovalKind) : [Nat64] {
        let out = List.empty<Nat64>();
        let key = (subject, code(kind));
        for (row in db.approvals.bySubject.rangeIter(
            { gt = null; gte = ?key; lt = null; lte = ?key; dir = #fwd },
            null,
        )) {
            if (currentModerator(db, row.moderator_id)) List.add(out, row.moderator_id);
        };
        List.toArray(out);
    };

    /// Takedown rows written before this map existed deliberately count zero:
    /// no exact public reason can safely be inferred for them after upgrade.
    func takedownBackers(
        db : Ashroot.DB,
        contexts : TakedownContexts,
        subject : Nat64,
        context : Text,
    ) : [Nat64] {
        let out = List.empty<Nat64>();
        let key = (subject, code(#takedown));
        for (row in db.approvals.bySubject.rangeIter(
            { gt = null; gte = ?key; lt = null; lte = ?key; dir = #fwd },
            null,
        )) {
            if (
                currentModerator(db, row.moderator_id)
                and Map.get(contexts, Nat64.compare, row.id) == ?context
            ) List.add(out, row.moderator_id);
        };
        List.toArray(out);
    };

    /// Record this moderator's backing and say where the count stands.
    ///
    /// Idempotent per moderator: the unique index on
    /// `(subject, kind, moderator)` means clicking twice is one vote, so a
    /// moderator cannot approve alone by trying harder.
    func back(
        db : Ashroot.DB,
        by : User,
        subject : Nat64,
        kind : ApprovalKind,
        now : Nat64,
    ) : Result.Result<Tally, Error> {
        if (db.approvals.bySlot.exists((subject, code(kind), by.id))) {
            return #ok({ votes = backers(db, subject, kind).size(); needed = SECONDS_NEEDED });
        };
        switch (
            db.approvals.insert({
                subject_id = subject; kind; moderator_id = by.id; at = now
            })
        ) {
            case (#err(e)) #err(#Db(e));
            case (#ok(_)) #ok({ votes = backers(db, subject, kind).size(); needed = SECONDS_NEEDED });
        };
    };

    func backTakedown(
        db : Ashroot.DB,
        contexts : TakedownContexts,
        by : User,
        subject : Nat64,
        context : Text,
        now : Nat64,
    ) : Result.Result<Tally, Error> {
        let approvalId = switch (db.approvals.bySlot.locate((subject, code(#takedown), by.id))) {
            case (?id) {
                let ?held = db.approvals.get(id) else Runtime.trap("approval index points at no row");
                if (Map.get(contexts, Nat64.compare, id) != ?context) {
                    // Restamp only to preserve "oldest active proposal" order
                    // when this moderator changes what they authorize.
                    switch (db.approvals.update({ held with at = now })) {
                        case (#err(e)) return #err(#Db(e));
                        case (#ok(_)) {};
                    };
                };
                id;
            };
            case null {
                switch (db.approvals.insert({
                    subject_id = subject; kind = #takedown; moderator_id = by.id; at = now
                })) {
                    case (#err(e)) return #err(#Db(e));
                    case (#ok(id)) id;
                };
            };
        };
        Map.add(contexts, Nat64.compare, approvalId, context);
        #ok({ votes = takedownBackers(db, contexts, subject, context).size(); needed = SECONDS_NEEDED });
    };

    /// Forget every vote for this subject and kind.
    ///
    /// Called whenever the status leaves `#approved`. Without it a revoked
    /// sponsor still carries two old votes and the next single moderator to
    /// touch them puts them straight back.
    public func clearBacking(db : Ashroot.DB, subject : Nat64, kind : ApprovalKind) {
        let key = (subject, code(kind));
        let doomed = List.empty<Nat64>();
        for (row in db.approvals.bySubject.rangeIter(
            { gt = null; gte = ?key; lt = null; lte = ?key; dir = #fwd },
            null,
        )) { List.add(doomed, row.id) };
        for (id in List.values(doomed)) {
            switch (db.approvals.delete(id)) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("could not clear obsolete moderation backing");
            };
        };
    };

    public func clearTakedownBacking(
        db : Ashroot.DB,
        contexts : TakedownContexts,
        subject : Nat64,
    ) {
        let key = (subject, code(#takedown));
        let doomed = List.empty<Nat64>();
        for (row in db.approvals.bySubject.rangeIter(
            { gt = null; gte = ?key; lt = null; lte = ?key; dir = #fwd },
            null,
        )) { List.add(doomed, row.id) };
        for (id in List.values(doomed)) {
            switch (db.approvals.delete(id)) {
                case (#ok(_)) { Map.remove(contexts, Nat64.compare, id) };
                case (#err(_)) Runtime.trap("could not clear obsolete takedown backing");
            };
        };
    };

    let MAX_NOTE = 280;

    /// Keep a useful audit trail without making a trusted pre-launch endpoint
    /// an unbounded heap writer. Ordinary role decisions use only a handful of
    /// rows; 32 leaves ample room for correction/revocation cycles while a
    /// compromised moderator cannot grow one subject forever.
    public let MAX_HISTORY_PER_SUBJECT = 32;

    public func kindTag(kind : Kind) : Text = switch (kind) {
        case (#judge_approved) "judge_approved";
        case (#judge_rejected) "judge_rejected";
        case (#judge_reset) "judge_reset";
        case (#judge_revoked) "judge_revoked";
        case (#moderator_granted) "moderator_granted";
        case (#moderator_revoked) "moderator_revoked";
        case (#sponsor_approved) "sponsor_approved";
        case (#sponsor_rejected) "sponsor_rejected";
        case (#sponsor_reset) "sponsor_reset";
        case (#sponsor_revoked) "sponsor_revoked";
    };

    // ── Reads ────────────────────────────────────────────────────────────────

    /// Resume token: the id of the last entry returned.
    ///
    /// NOT `Cursors.Token`. Ashroot's index cursors encode `(key, slot)` where
    /// `slot` is an internal row position no read API exposes, so one built
    /// from `entry.id` compares an id against a slot and quietly repeats rows.
    /// `iterPrimary` anchors on the real primary key and is exclusive, which
    /// is exactly what a newest-first log wants — ids are auto-increment, so
    /// they are the true sequence even when several actions share a timestamp.
    public type Cursor = Nat64;

    public type LogPage = {
        rows : [EntryView];
        /// `null` means the end of the log.
        next : ?Cursor;
        total : Nat;
    };

    let DEFAULT_LIMIT = 25;
    let MAX_LIMIT = 100;

    func clamp(limit : Nat) : Nat {
        if (limit == 0) DEFAULT_LIMIT else if (limit > MAX_LIMIT) MAX_LIMIT else limit;
    };

    func subjectRange(subjectId : Nat64) : IndexRuntime.IndexRange<Nat64> {
        { gt = null; gte = ?subjectId; lt = null; lte = ?subjectId; dir = #bwd };
    };

    func view(db : Ashroot.DB, entry : Entry) : EntryView {
        {
            id = entry.id;
            kind = entry.kind;
            note = entry.note;
            at = entry.at;
            subjectId = entry.subject_id;
            subject = switch (db.users.get(entry.subject_id)) {
                case (?user) ?user.handle;
                case null null;
            };
            by = switch (Profiles.byPrincipal(db, entry.actorPrincipal)) {
                case (?user) ?user.handle;
                case null null;
            };
            byPrincipal = entry.actorPrincipal;
        };
    };

    /// Newest first, one page at a time.
    public func history(db : Ashroot.DB, after : ?Cursor, limit : Nat) : LogPage {
        let want = clamp(limit);
        let out = List.empty<EntryView>();
        var last : ?Nat64 = null;
        var exhausted = true;

        label scan for ((id, entry) in db.actions.iterPrimary(#bwd, after)) {
            if (List.size(out) >= want) { exhausted := false; break scan };
            last := ?id;
            List.add(out, view(db, entry));
        };

        {
            rows = List.toArray(out);
            next = if (exhausted) null else last;
            total = db.actions.size();
        };
    };

    /// Everything that has happened to one user, newest first.
    ///
    /// A subject's trail is short — a handful of entries — so this filters the
    /// primary walk rather than paging the `bySubject` index, whose cursors
    /// have the slot problem described above. `bySubject` still backs the
    /// count, which is exact and cheap.
    public func historyFor(db : Ashroot.DB, subjectId : Nat64, after : ?Cursor, limit : Nat) : LogPage {
        let want = clamp(limit);
        let out = List.empty<EntryView>();
        var last : ?Nat64 = null;
        var scanned = 0;
        var exhausted = true;

        label scan for ((id, entry) in db.actions.iterPrimary(#bwd, after)) {
            if (List.size(out) >= want or scanned >= SUBJECT_SCAN_BUDGET) {
                exhausted := false;
                break scan;
            };
            scanned += 1;
            last := ?id;
            if (entry.subject_id == subjectId) List.add(out, view(db, entry));
        };

        {
            rows = List.toArray(out);
            next = if (exhausted) null else last;
            total = db.actions.bySubject.countInRange(subjectRange(subjectId), null);
        };
    };

    let SUBJECT_SCAN_BUDGET = 2_000;

    // ── Writes ───────────────────────────────────────────────────────────────

    /// Approve, reject, reset to pending, or revoke a judge.
    ///
    /// Which of those it is depends on the transition, and that is what gets
    /// logged — `#no` after `#pending` is a rejection, `#no` after `#approved`
    /// is a revocation, and they should not read the same in the history.
    public func setJudge(
        db : Ashroot.DB,
        by : Principal,
        target : JudgeTarget,
        status : JudgeStatus,
        note : ?Text,
        now : Nat64,
    ) : Result.Result<User, Error> {
        if (not Profiles.canModerate(db, by)) return #err(#NotAllowed);
        // The integrity of the format: who decides is fixed before any entry
        // is seen. See rules.md §2.
        if (Season.judgesFrozen(db)) return #err(#JudgesFrozen);
        switch (checkNote(note)) { case (#err(e)) return #err(e); case (#ok) {} };

        let ?current = db.users.get(target.id) else return #err(#NotRegistered);
        if (current.anonymized) return #err(#NotRegistered);
        if (
            current.judgeStatus != target.expectedStatus
            or current.updatedAt != target.expectedUpdatedAt
        ) return #err(#Invalid(STALE_TARGET));
        if (current.judgeStatus == status) return #err(#NoChange);
        switch (Profiles.owner(db, by)) {
            case (?reviewer) if (reviewer.id == current.id) return #err(#NotAllowed);
            case _ {};
        };

        let kind : Kind = switch (status) {
            case (#approved) #judge_approved;
            case (#pending) #judge_reset;
            // Where it came from is what distinguishes the two.
            case (#no) if (current.judgeStatus == #approved) #judge_revoked else #judge_rejected;
        };

        if (status == #approved) {
            switch (quorum(db, by, current.id, #judge, now)) {
                case (#err(e)) return #err(e);
                case (#ok(false)) return #err(#NeedsSecond(tallyFor(db, current.id, #judge)));
                case (#ok(true)) {};
            };
        } else {
            clearBacking(db, current.id, #judge);
        };

        switch (Profiles.save(db, {
            current with
            judgeStatus = status;
            updatedAt = Profiles.nextUpdatedAt(current, now);
        })) {
            // A quorum vote or backing cleanup may already have been written
            // in this message. Trap so those writes roll back with the failed
            // status change instead of leaving a half-applied decision.
            case (#err(_)) Runtime.trap("could not update judge status");
            case (#ok(saved)) record(db, by, saved, kind, note, now, saved);
        };
    };

    public func tallyFor(db : Ashroot.DB, subject : Nat64, kind : ApprovalKind) : Tally {
        { votes = backers(db, subject, kind).size(); needed = SECONDS_NEEDED };
    };

    /// The tally plus **whether the moderator asking has already backed it**.
    ///
    /// The extra field is what lets a button be honest before it is pressed.
    /// `votes` alone cannot distinguish "one moderator has agreed, and it was
    /// you" from "one moderator has agreed, and it was somebody else" — and
    /// those need opposite buttons. The first is a moderator waiting on a
    /// colleague and has nothing left to press; the second is one press away
    /// from destroying files. A button that looks live in both cases invites
    /// the click that does nothing and hides the one that does everything.
    public type Backing = {
        votes : Nat;
        needed : Nat;
        mine : Bool;
        /// Present only for a takedown. This is the exact public reason the
        /// votes above authorize, so the next moderator never has to guess it.
        context : ?Text;
    };

    func describedBacking(
        db : Ashroot.DB,
        by : Principal,
        subject : Nat64,
        kind : ApprovalKind,
    ) : Backing {
        switch (Profiles.owner(db, by)) {
            case (?voter) {
                let held = backers(db, subject, kind);
                var mine = false;
                for (id in held.vals()) { if (id == voter.id) mine := true };
                { votes = held.size(); needed = SECONDS_NEEDED; mine; context = null };
            };
            case null {
                if (Principal.isController(by)) {
                    { votes = 0; needed = 1; mine = false; context = null };
                } else {
                    { votes = 0; needed = SECONDS_NEEDED; mine = false; context = null };
                };
            };
        };
    };

    func describedTakedownBacking(
        db : Ashroot.DB,
        contexts : TakedownContexts,
        by : Principal,
        subject : Nat64,
        context : ?Text,
    ) : Backing {
        let held = switch (context) {
            case (?exact) takedownBackers(db, contexts, subject, exact);
            case null [];
        };
        switch (Profiles.owner(db, by)) {
            case (?voter) {
                var mine = false;
                for (id in held.vals()) { if (id == voter.id) mine := true };
                { votes = held.size(); needed = SECONDS_NEEDED; mine; context };
            };
            case null {
                if (Principal.isController(by)) {
                    { votes = 0; needed = 1; mine = false; context };
                } else {
                    { votes = 0; needed = SECONDS_NEEDED; mine = false; context };
                };
            };
        };
    };

    /// Pick the context useful to the asking moderator: their own vote first,
    /// otherwise the oldest live proposal. With a requested context this
    /// selection is skipped and the exact tally is returned.
    func takedownContext(
        db : Ashroot.DB,
        contexts : TakedownContexts,
        by : Principal,
        subject : Nat64,
    ) : ?Text {
        switch (Profiles.owner(db, by)) {
            case (?voter) {
                switch (db.approvals.bySlot.locate((subject, code(#takedown), voter.id))) {
                    case (?id) {
                        switch (db.approvals.get(id)) {
                            case (?row) if (currentModerator(db, row.moderator_id)) {
                                switch (Map.get(contexts, Nat64.compare, row.id)) {
                                    case (?context) return ?context;
                                    case null {};
                                };
                            };
                            case _ {};
                        };
                    };
                    case null {};
                };
            };
            case null {};
        };
        let key = (subject, code(#takedown));
        for (row in db.approvals.bySubject.rangeIter(
            { gt = null; gte = ?key; lt = null; lte = ?key; dir = #fwd },
            null,
        )) {
            if (currentModerator(db, row.moderator_id)) {
                switch (Map.get(contexts, Nat64.compare, row.id)) {
                    case (?context) return ?context;
                    case null {};
                };
            };
        };
        null;
    };

    public func takedownBackingFor(
        db : Ashroot.DB,
        contexts : TakedownContexts,
        by : Principal,
        subject : Nat64,
        requested : ?Text,
    ) : Backing {
        let context = switch (requested) {
            case (?exact) ?exact;
            case null takedownContext(db, contexts, by, subject);
        };
        describedTakedownBacking(db, contexts, by, subject, context);
    };

    public func backingFor(
        db : Ashroot.DB,
        contexts : TakedownContexts,
        by : Principal,
        subject : Nat64,
        kind : ApprovalKind,
    ) : Backing {
        // Described from the **caller's** side: how far along *their* path to
        // completing this is, not a global scoreboard. The two differ for a
        // controller with no profile row, which `quorum` lets straight through
        // — for it the bar is one press high and empty, because that is
        // exactly what its press will do. Reporting the moderators' 1-of-2
        // instead would tell it a colleague is needed when none is.
        switch (kind) {
            case (#takedown) takedownBackingFor(db, contexts, by, subject, null);
            case _ describedBacking(db, by, subject, kind);
        };
    };

    /// Cast this moderator's vote and say whether the bar is now met.
    ///
    /// A controller has no profile row and therefore no vote. That is not a
    /// gap: a controller can already install code, so requiring it to find a
    /// second moderator would protect nothing. It gets through on its own.
    public func quorum(db : Ashroot.DB, by : Principal, subject : Nat64, kind : ApprovalKind, now : Nat64) : Result.Result<Bool, Error> {
        if (Principal.isController(by)) return #ok(true);
        let ?voter = Profiles.owner(db, by) else return #err(#NoProfile);
        if (not voter.moderator or voter.anonymized) return #err(#NotAllowed);
        switch (back(db, voter, subject, kind, now)) {
            case (#err(e)) #err(e);
            case (#ok(t)) #ok(t.votes >= t.needed);
        };
    };

    /// The takedown counterpart: same quorum, but bound to one exact reason.
    public func takedownQuorum(
        db : Ashroot.DB,
        contexts : TakedownContexts,
        by : Principal,
        subject : Nat64,
        context : Text,
        now : Nat64,
    ) : Result.Result<Bool, Error> {
        if (Principal.isController(by)) return #ok(true);
        let ?voter = Profiles.owner(db, by) else return #err(#NoProfile);
        if (not voter.moderator or voter.anonymized) return #err(#NotAllowed);
        switch (backTakedown(db, contexts, voter, subject, context, now)) {
            case (#err(e)) #err(e);
            case (#ok(t)) #ok(t.votes >= t.needed);
        };
    };

    /// Remove only the caller's own pending takedown vote.
    public func withdrawTakedown(
        db : Ashroot.DB,
        contexts : TakedownContexts,
        by : Principal,
        subject : Nat64,
    ) : Result.Result<(), Error> {
        let ?voter = Profiles.owner(db, by) else return #err(#NoProfile);
        if (not voter.moderator or voter.anonymized) return #err(#NotAllowed);
        let ?id = db.approvals.bySlot.locate((subject, code(#takedown), voter.id)) else {
            return #err(#NoChange);
        };
        switch (db.approvals.delete(id)) {
            case (#ok(_)) {
                Map.remove(contexts, Nat64.compare, id);
                #ok;
            };
            case (#err(e)) #err(#Db(e));
        };
    };

    /// Approve, reject, reset or revoke a sponsorship.
    ///
    /// Same shape as `setJudge`, and for the same reason: `#no` reached from
    /// `#pending` is a rejection while `#no` reached from `#approved` is a
    /// revocation, and the log has to tell them apart.
    public func setSponsor(
        db : Ashroot.DB,
        by : Principal,
        target : SponsorTarget,
        status : SponsorStatus,
        note : ?Text,
        now : Nat64,
    ) : Result.Result<User, Error> {
        if (not Profiles.canModerate(db, by)) return #err(#NotAllowed);
        // Sponsor rows and their ledgers become the treasury's immutable
        // accounting source at start. This check precedes quorum so a refused
        // post-start call cannot even leave a new approval vote behind.
        if (Season.sponsorsFrozen(db)) return #err(#SponsorsFrozen);
        switch (checkNote(note)) { case (#err(e)) return #err(e); case (#ok) {} };

        let ?current = db.users.get(target.id) else return #err(#NotRegistered);
        if (current.anonymized) return #err(#NotRegistered);
        if (
            current.sponsorStatus != target.expectedStatus
            or current.updatedAt != target.expectedUpdatedAt
        ) return #err(#Invalid(STALE_TARGET));
        if (current.sponsorStatus == status) return #err(#NoChange);
        switch (Profiles.owner(db, by)) {
            case (?reviewer) if (reviewer.id == current.id) return #err(#NotAllowed);
            case _ {};
        };

        // Approving a sponsorship with no details would publish an empty card.
        if (status == #approved and current.sponsor == null) {
            return #err(#Invalid("no sponsor details submitted"));
        };
        if (status == #approved) {
            if (current.sponsorStatus != #pending) {
                return #err(#Invalid("the sponsor must apply before approval"));
            };
            let ?application = current.sponsor else {
                return #err(#Invalid("no sponsor details submitted"));
            };
            if (not Profiles.applicationLedgersAllowed(db, application)) {
                return #err(#Invalid("the application names a ledger outside the sealed allowlist"));
            };
            if (Profiles.approvedSponsorCount(db) >= Profiles.MAX_APPROVED_SPONSORS) {
                return #err(#Invalid("the approved sponsor limit has been reached"));
            };
        };

        let kind : Kind = switch (status) {
            case (#approved) #sponsor_approved;
            case (#pending) #sponsor_reset;
            case (#no) if (current.sponsorStatus == #approved) #sponsor_revoked else #sponsor_rejected;
        };

        if (status == #approved) {
            switch (quorum(db, by, current.id, #sponsor, now)) {
                case (#err(e)) return #err(e);
                case (#ok(false)) return #err(#NeedsSecond(tallyFor(db, current.id, #sponsor)));
                case (#ok(true)) {};
            };
        } else {
            clearBacking(db, current.id, #sponsor);
        };

        switch (Profiles.save(db, {
            current with
            sponsorStatus = status;
            updatedAt = Profiles.nextUpdatedAt(current, now);
        })) {
            case (#err(_)) Runtime.trap("could not update sponsor status");
            case (#ok(saved)) record(db, by, saved, kind, note, now, saved);
        };
    };

    /// Grant or revoke moderator powers. Controller-only — `main.mo` enforces
    /// that, because moderators appointing moderators has no floor.
    public func setModerator(
        db : Ashroot.DB,
        by : Principal,
        target : ModeratorTarget,
        on : Bool,
        note : ?Text,
        now : Nat64,
    ) : Result.Result<User, Error> {
        switch (checkNote(note)) { case (#err(e)) return #err(e); case (#ok) {} };

        let ?current = db.users.get(target.id) else return #err(#NotRegistered);
        if (current.anonymized) return #err(#NotRegistered);
        if (
            current.moderator != target.expectedOn
            or current.updatedAt != target.expectedUpdatedAt
        ) return #err(#Invalid(STALE_TARGET));
        if (current.moderator == on) return #err(#NoChange);
        if (on and Profiles.moderatorCount(db) >= Profiles.MAX_MODERATORS) {
            return #err(#Invalid(
                "the moderator bench may contain at most "
                # Nat.toText(Profiles.MAX_MODERATORS) # " accounts"
            ));
        };

        let kind : Kind = if (on) #moderator_granted else #moderator_revoked;

        switch (Profiles.save(db, {
            current with
            moderator = on;
            updatedAt = Profiles.nextUpdatedAt(current, now);
        })) {
            case (#err(_)) Runtime.trap("could not update moderator status");
            case (#ok(saved)) record(db, by, saved, kind, note, now, saved);
        };
    };

    // ── Internals ────────────────────────────────────────────────────────────

    func checkNote(note : ?Text) : Result.Result<(), Error> {
        switch (note) {
            case (?text) {
                if (text.size() > MAX_NOTE) return #err(#Invalid("note is too long"));
                #ok;
            };
            case null #ok;
        };
    };

    /// Append to the audit log and hand back the updated user. A failure to
    /// log is a failure of the whole action — an unlogged moderation is worse
    /// than a refused one.
    func record(
        db : Ashroot.DB,
        by : Principal,
        subject : User,
        kind : Kind,
        note : ?Text,
        now : Nat64,
        result : User,
    ) : Result.Result<User, Error> {
        let entry : Ashroot.Types.CreateAction = {
            subject_id = subject.id;
            actorPrincipal = by;
            kind = kind;
            note = note;
            at = now;
        };
        switch (db.actions.insert(entry)) {
            case (#ok(id)) {
                trimSubjectHistory(db, subject.id, id);
                #ok(result);
            };
            // The subject row changed immediately before this. An unlogged
            // moderation action is not a recoverable partial success.
            case (#err(_)) Runtime.trap("could not append moderation audit log");
        };
    };

    /// The insert and trim share one message, so a delete failure traps and
    /// rolls the status change, log append and trim back together. The index
    /// order includes an internal slot, not the public id, so sort public ids
    /// before deleting the oldest. Normally this sees at most 33 rows; deleting
    /// every excess row also converges an upgraded database written before the
    /// cap existed.
    func trimSubjectHistory(db : Ashroot.DB, subjectId : Nat64, keep : Nat64) {
        let range = subjectRange(subjectId);
        let total = db.actions.bySubject.countInRange(range, null);
        if (total <= MAX_HISTORY_PER_SUBJECT) return;

        let candidates = List.empty<Nat64>();
        for (row in db.actions.bySubject.rangeIter(range, null)) {
            if (row.id != keep) List.add(candidates, row.id);
        };
        let ordered = Array.sort(List.toArray(candidates), Nat64.compare);
        let excess = Nat.sub(total, MAX_HISTORY_PER_SUBJECT);
        if (ordered.size() < excess) Runtime.trap("could not bound moderation history");
        var i = 0;
        while (i < excess) {
            switch (db.actions.delete(ordered[i])) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("could not trim moderation history");
            };
            i += 1;
        };
    };
};
