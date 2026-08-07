/// Nothing a hacker publishes reaches the bracket until a moderator has looked
/// at it.
///
/// ## The shape
///
/// A hacker's `submit_entry` and `publish_update` no longer write to `entries`.
/// They write a **revision**: a row holding what they are asking for, in
/// `#pending`. A moderator approves it — at which point it is applied to the
/// entry exactly as if the hacker had written it — or rejects it with a reason.
///
/// The entry keeps showing its **last approved** state throughout. A pending
/// revision is visible to its author and to moderators and to nobody else, so
/// a slow review never removes an app that was already approved, and an app
/// nobody has reviewed never competes.
///
/// ## Validation happens twice, deliberately
///
/// At **propose** time, so a hacker learns immediately that their icon is in
/// the wrong folder rather than waiting for a human to tell them. And again at
/// **apply** time, because the world moves in between: a week closes, an asset
/// is deleted, a role is dropped. The second check is the one that is load
/// bearing; the first is a courtesy.
///
/// ## Rejections carry a useful explanation
///
/// Two thousand characters is enough to identify the problems and fixes while
/// keeping the retained review trail bounded for a 1,000-person event. Longer
/// machine reports belong outside the canister and can be linked from here.

import Array "mo:core/Array";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";

import Ashroot "../.ashroot/lib";
import Profiles "./Profiles";
import Season "./Season";

module {

    public type Revision = Ashroot.Types.Revision;
    public type State = Ashroot.Types.Revisions.Revision.State;
    public type Kind = Ashroot.Types.Revisions.Revision.Kind;

    public type Error = {
        /// The caller's account is frozen: they may read, not write.
        #Frozen;
        #NotAllowed;
        #NotFound;
        #NotPending;
        #Season : Season.Error;
        #Invalid : Text;
        #Db : Ashroot.Errors.Error;
    };

    /// The longest retained rejection explanation.
    public let MAX_REASON = 2_000;

    /// One person's bounded audit trail. Old decided rows are discarded only
    /// when that person files a newer request. Pending rows stay until they are
    /// settled: their asset keys remain served and a later terminal takedown
    /// must still be able to find and delete them. There is at most one pending
    /// row per round, and the one-season format has six rounds, so the ordinary
    /// eight-row bound still has room for every pending row.
    public let MAX_HISTORY = 8;

    /// App bytes and presentation freeze at the same inclusive boundary as a
    /// recorded ballot.  `roundOpen` makes the subtraction safe, including if
    /// a delayed timer has left the season row in `#running` after its stored
    /// deadline.
    public func changesOpen(season : Season.Season, now : Nat64) : Bool {
        if (not Season.roundOpen(season, now)) return false;
        season.weekEndsAt - now > Season.VOTE_WITHDRAWAL_LOCK_NANOS;
    };

    func entryKeys(input : Season.EntryInput) : [Text] {
        let keys = List.empty<Text>();
        switch (input.icon) { case (?key) List.add(keys, key); case null {} };
        for (shot in input.shots.vals()) List.add(keys, shot);
        List.add(keys, input.pkg.key);
        List.toArray(keys);
    };

    func versionKeys(input : Season.UpdateInput) : [Text] {
        switch (input.pkg) {
            case (?pkg) [pkg.key];
            case null [];
        };
    };

    /// Which existing app a pending row belongs to. Missing or inconsistent
    /// version targets fail closed when their keys collide with another
    /// proposal; fresh version rows always carry an exact target.
    func revisionLineage(db : Ashroot.DB, row : Revision) : ?Text {
        switch (row.kind) {
            case (#entry) {
                ?Season.entryInputLineage(db, row.season_id, row.week, row.user_id, row.slug);
            };
            case (#version) {
                let ?id = row.targetEntryId else return null;
                let ?entry = Season.entry(db, id) else return null;
                if (
                    entry.user_id != row.user_id
                    or entry.season_id != row.season_id
                    or entry.week != row.week
                ) return null;
                ?Season.chosenSlugOf(db, entry);
            };
        };
    };

    func referencesAny(row : Revision, keys : [Text]) : Bool {
        for (key in keys.vals()) {
            if (revisionReferences(row, key)) return true;
        };
        false;
    };

    /// One exact pending key belongs to one app lineage, even across weeks.
    /// Otherwise a takedown of an old pending edit could have to expire a
    /// different current proposal that reused the same bytes. Same-lineage
    /// qualifier copies may still share their own keys. At approval, exclude
    /// the candidate itself so a revision never rejects its own uploads.
    func checkPendingAssetReuse(
        db : Ashroot.DB,
        userId : Nat64,
        lineage : Text,
        keys : [Text],
        exclude : ?Nat64,
    ) : Result.Result<(), Error> {
        for (row in db.revisions.byUser.rangeIter(
            { gt = null; gte = ?userId; lt = null; lte = ?userId; dir = #fwd },
            null,
        )) {
            if (
                row.state == #pending
                and ?row.id != exclude
                and referencesAny(row, keys)
            ) {
                switch (revisionLineage(db, row)) {
                    case (?other) {
                        if (other != lineage) return #err(#Invalid(
                            "that exact upload is already waiting for review on another app"
                        ));
                    };
                    case null return #err(#Invalid(
                        "that exact upload is already waiting for review on another app"
                    ));
                };
            };
        };
        #ok;
    };

    // ── Proposing ────────────────────────────────────────────────────────────

    /// Ask for an entry to be created or changed.
    ///
    /// Checked against the same rules the entry itself would face, so a
    /// hopeless request never reaches a moderator's queue.
    public func proposeEntry(
        db : Ashroot.DB,
        caller : Principal,
        input : Season.EntryInput,
        sizeOf : Text -> ?Nat,
        now : Nat64,
    ) : Result.Result<Revision, Error> {
        let ?season = Season.running(db) else return #err(#Season(#NoSeason));
        if (season.week > Season.QUALIFIERS or not changesOpen(season, now)) {
            return #err(#Season(#WeekClosed));
        };
        let ?user = Profiles.byPrincipal(db, caller) else return #err(#Season(#NotRegistered));
        if (not user.hacker) return #err(#Season(#NotAHacker));
        // **[decided]** Somewhere to be paid, before there is anything to pay
        // for. Asked at signup and asked again here, because the alternative is
        // discovering on distribution day that a winner never filled it in —
        // at which point they are unreachable and the money has nowhere to go.
        if (user.wallet == null) return #err(#Season(#NoWallet));
        if (Season.settling(db)) return #err(#Season(#Distributing));
        switch (Season.checkEntry(input, Profiles.scope(user), sizeOf)) {
            case (#err(e)) return #err(#Season(e));
            case (#ok) {};
        };
        switch (Season.checkSlug(db, season.id, season.week, user, input.slug)) {
            case (#err(e)) return #err(#Season(e));
            case (#ok) {};
        };
        switch (Season.checkEntryAssetReuse(db, season, user, input)) {
            case (#err(e)) return #err(#Season(e));
            case (#ok) {};
        };
        switch (checkPendingAssetReuse(
            db,
            user.id,
            Season.entryInputLineage(db, season.id, season.week, user.id, input.slug),
            entryKeys(input),
            null,
        )) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };

        write(
            db,
            {
                user_id = user.id;
                season_id = season.id;
                week = season.week;
                kind = #entry;
                targetEntryId = null;
                title = input.title;
                summary = input.summary;
                url = input.url;
                icon = input.icon;
                shots = input.shots;
                links = input.links;
                slug = input.slug;
                version = "";
                note = "";
                pkgKey = ?input.pkg.key;
                state = #pending;
                reason = "";
                reviewer = null;
                createdAt = now;
                decidedAt = 0;
            },
        );
    };

    /// Ask for a version to be published against the open week's entry.
    public func proposeVersion(
        db : Ashroot.DB,
        caller : Principal,
        entryId : Nat64,
        input : Season.UpdateInput,
        sizeOf : Text -> ?Nat,
        now : Nat64,
    ) : Result.Result<Revision, Error> {
        let ?season = Season.running(db) else return #err(#Season(#NoSeason));
        if (not changesOpen(season, now)) return #err(#Season(#WeekClosed));
        let ?user = Profiles.byPrincipal(db, caller) else return #err(#Season(#NotRegistered));
        if (not user.hacker) return #err(#Season(#NotAHacker));
        // There must be something to publish against — an approved entry.
        let entry = switch (Season.versionTarget(db, user, entryId)) {
            case (#ok(value)) value;
            case (#err(e)) return #err(#Season(e));
        };
        switch (Season.checkVersion(user, entry, input, sizeOf)) {
            case (#err(e)) return #err(#Season(e));
            case (#ok) {};
        };
        switch (Season.checkVersionAssetReuse(db, user, entry, input)) {
            case (#err(e)) return #err(#Season(e));
            case (#ok) {};
        };
        switch (checkPendingAssetReuse(
            db,
            user.id,
            Season.chosenSlugOf(db, entry),
            versionKeys(input),
            null,
        )) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };

        write(
            db,
            {
                user_id = user.id;
                season_id = season.id;
                week = season.week;
                kind = #version;
                targetEntryId = ?entry.id;
                // Existing bounded fields double as a human-readable snapshot
                // for the moderation queue; no second target field is needed.
                title = entry.title;
                summary = "";
                url = "";
                icon = null;
                shots = [];
                links = [];
                // A version proposal renames nothing; `approve` reads this
                // only on the `#entry` branch.
                slug = entry.slug;
                version = input.version;
                note = input.note;
                pkgKey = switch (input.pkg) { case (?p) ?p.key; case null null };
                state = #pending;
                reason = "";
                reviewer = null;
                createdAt = now;
                decidedAt = 0;
            },
        );
    };

    /// A full edit also carries a package, so allowing one `#entry` and one
    /// `#version` request to wait together would make moderator approval order
    /// choose the final build.  One slot total is both safer and what the UI
    /// already presents.  The check and insert contain no `await`, so a direct
    /// Candid caller cannot race two requests through it.
    func write(db : Ashroot.DB, row : Ashroot.Types.CreateRevision) : Result.Result<Revision, Error> {
        for (pending in db.revisions.bySlot.rangeIter(
            {
                gt = null;
                gte = ?(row.season_id, row.week, row.user_id);
                lt = null;
                lte = ?(row.season_id, row.week, row.user_id);
                dir = #fwd;
            },
            null,
        )) {
            if (pending.state == #pending) {
                return #err(#Invalid("a revision for this week is already waiting for review"));
            };
        };

        switch (db.revisions.insert(row)) {
            case (#err(e)) #err(#Db(e));
            case (#ok(id)) {
                // `insert` answers with the id it assigned; the caller wants
                // the row, so the author can see what they asked for.
                let ?saved = db.revisions.get(id) else return #err(#NotFound);
                trimHistory(db, row.user_id, id);
                #ok(saved);
            };
        };
    };

    /// Keep the newest bounded history after an insert. A prior round's pending
    /// row is stale for approval, but not for asset safety: its URLs remain
    /// served and a later takedown must still discover them. Prune decided rows
    /// only. The six-round, one-pending-per-round invariant leaves enough of
    /// those to reach the eight-row bound.
    ///
    /// Collect ids before deleting so index mutation never invalidates the
    /// iterator. Any database failure traps, rolling the whole message back
    /// together with the insert rather than committing a half-pruned history.
    func trimHistory(db : Ashroot.DB, userId : Nat64, keep : Nat64) {
        let range = {
            gt = null;
            gte = ?userId;
            lt = null;
            lte = ?userId;
            dir = #fwd;
        };
        let total = db.revisions.byUser.countInRange(range, null);
        if (total <= MAX_HISTORY) return;

        var remaining = Nat.sub(total, MAX_HISTORY);
        let doomed = List.empty<Nat64>();
        label collect for (old in db.revisions.byUser.rangeIter(range, null)) {
            if (remaining == 0) break collect;
            if (old.id != keep and old.state != #pending) {
                List.add(doomed, old.id);
                remaining -= 1;
            };
        };
        if (remaining != 0) Runtime.trap("could not bound revision history");
        for (id in List.values(doomed)) {
            switch (db.revisions.delete(id)) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("could not prune revision history");
            };
        };
    };

    // ── Deciding ─────────────────────────────────────────────────────────────

    /// Does this revision address the lineage represented by `target`?
    /// Revisions predate entry ids, so a full proposal carries its slug while
    /// a package-only proposal resolves the current entry exactly as apply
    /// does. Both paths stay bounded to one user's six season slots.
    func targetsLineage(db : Ashroot.DB, row : Revision, target : Season.Entry) : Bool {
        if (row.user_id != target.user_id or row.season_id != target.season_id) return false;
        let chosen = Season.chosenSlugOf(db, target);
        switch (row.kind) {
            case (#entry) {
                return Season.entryInputLineage(
                    db,
                    row.season_id,
                    row.week,
                    row.user_id,
                    row.slug,
                ) == chosen;
            };
            case (#version) {
                let ?id = row.targetEntryId else return false;
                let ?current = Season.entry(db, id) else return false;
                return (
                    current.user_id == row.user_id
                    and current.season_id == row.season_id
                    and current.week == row.week
                    and Season.chosenSlugOf(db, current) == chosen
                );
            };
        };
        false;
    };

    /// Pending work must not outlive a terminal takedown. This is called in
    /// the same message that strips the entry, so any database failure traps
    /// the whole operation rather than leaving an approvable restoration.
    public func expireForTakedown(
        db : Ashroot.DB,
        target : Season.Entry,
        capturedKeys : [Text],
        reviewer : ?Nat64,
        now : Nat64,
    ) : [Text] {
        // Collect only keys that belong exclusively to pending work for this
        // lineage. Stale pending files are deliberately reusable; if one has
        // since been published by another app, `Season.assetLocked` is true
        // after the target lineage is marked down and that live app must win.
        let pendingOnly = List.empty<Text>();
        let keepPendingOnly = func(key : Text) {
            for (published in capturedKeys.vals()) {
                if (published == key) return;
            };
            if (Season.assetLocked(db, target.user_id, key)) return;
            for (seen in List.values(pendingOnly)) {
                if (seen == key) return;
            };
            List.add(pendingOnly, key);
        };
        for (row in db.revisions.byUser.rangeIter(
            { gt = null; gte = ?target.user_id; lt = null; lte = ?target.user_id; dir = #fwd },
            null,
        )) {
            if (row.state == #pending and targetsLineage(db, row, target)) {
                switch (row.icon) { case (?key) keepPendingOnly(key); case null {} };
                for (shot in row.shots.vals()) keepPendingOnly(shot);
                switch (row.pkgKey) { case (?key) keepPendingOnly(key); case null {} };
            };
        };

        // A defensive pending row may share one of the doomed keys without
        // belonging to this app. Expire that row too, but do not delete its
        // unrelated files.
        let prohibited = Array.concat(capturedKeys, List.toArray(pendingOnly));
        let doomed = List.empty<Nat64>();
        for (row in db.revisions.byUser.rangeIter(
            { gt = null; gte = ?target.user_id; lt = null; lte = ?target.user_id; dir = #fwd },
            null,
        )) {
            if (
                row.state == #pending
                and (
                    targetsLineage(db, row, target)
                    or referencesAny(row, prohibited)
                )
            ) {
                List.add(doomed, row.id);
            };
        };
        // Settling changes the queue index. Collect before writing so no index
        // iterator can skip a neighbouring pending row during mutation.
        for (id in List.values(doomed)) {
            let ?row = db.revisions.get(id) else Runtime.trap("pending takedown revision disappeared");
            switch (settle(db, row, #expired, reviewer, "the app was permanently taken down before this was reviewed", now)) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("could not expire a taken-down app revision");
            };
        };
        List.toArray(pendingOnly);
    };

    func takenDown(db : Ashroot.DB, row : Revision) : Bool {
        switch (row.kind) {
            case (#entry) Season.takenDownSlug(db, row.season_id, row.user_id, row.slug);
            case (#version) {
                let ?id = row.targetEntryId else return true;
                switch (Season.entry(db, id)) {
                    case (?entry) {
                        entry.user_id != row.user_id
                        or entry.season_id != row.season_id
                        or entry.week != row.week
                        or entry.takedownAt != 0;
                    };
                    case null true;
                };
            };
        };
    };

    /// Apply a pending revision to the entry it names.
    ///
    /// `sizeOf` reads the asset store, as `publish_update` does — the size of a
    /// build is read at the moment it is approved, not when it was proposed,
    /// so a file swapped in between is measured as it now stands.
    /// `reviewer` is the deciding moderator's id, where there is one — a
    /// canister controller counts as a moderator without holding a profile,
    /// so the record says "decided, by nobody in the directory" rather than
    /// refusing the decision.
    /// Apply a pending revision, and say which files it displaced.
    ///
    /// The keys are files the entry no longer points at — the build a newer one
    /// replaced, an icon swapped for a different one, a screenshot dropped. It is handed back rather than deleted here because this
    /// module has no asset store, and **the caller has to act on it**: a
    /// replaced build that is not deleted stays downloadable at its old URL,
    /// which rules.md §3 says must stop resolving, and now that file bytes live
    /// in fixed slots it also holds 2 MiB of stable memory that nothing will
    /// ever hand back.
    ///
    /// That is not hypothetical — it is the bug this signature exists to stop
    /// recurring. `publish_update` used to do the delete, and putting the write
    /// behind the review queue moved it out from under the only caller that
    /// could still see the key.
    public func approve(
        db : Ashroot.DB,
        reviewer : ?Nat64,
        id : Nat64,
        sizeOf : Text -> ?Nat,
        now : Nat64,
    ) : Result.Result<(Revision, [Text]), Error> {
        let ?row = db.revisions.get(id) else return #err(#NotFound);
        if (row.state != #pending) return #err(#NotPending);
        if (reviewer == ?row.user_id) return #err(#NotAllowed);

        if (takenDown(db, row)) {
            return switch (settle(db, row, #expired, reviewer, "the app was permanently taken down before this was reviewed", now)) {
                case (#ok(saved)) #ok((saved, []));
                case (#err(e)) #err(e);
            };
        };

        // The world moved while this sat in the queue. Expiring says so rather
        // than pretending a moderator disliked it.
        let live = Season.running(db);
        let stale = switch (live) {
            case (?season) {
                season.id != row.season_id
                or season.week != row.week
                or not changesOpen(season, now);
            };
            case null true;
        };
        if (stale) {
            // Nothing was applied, so nothing was displaced.
            return switch (settle(db, row, #expired, reviewer, "the app-change window closed before this was reviewed", now)) {
                case (#ok(saved)) #ok((saved, []));
                case (#err(e)) #err(e);
            };
        };

        let ?author = db.users.get(row.user_id) else return #err(#NotFound);
        // Normalised to "which file did this displace", because that is the
        // only part of the two results the caller has to act on.
        let applied : Result.Result<[Text], Season.Error> = switch (row.kind) {
            case (#entry) {
                let input : Season.EntryInput = {
                    title = row.title;
                    summary = row.summary;
                    url = row.url;
                    icon = row.icon;
                    shots = row.shots;
                    links = row.links;
                    pkg = { key = switch (row.pkgKey) { case (?k) k; case null "" } };
                    slug = row.slug;
                };
                switch (checkPendingAssetReuse(
                    db,
                    author.id,
                    Season.entryInputLineage(db, row.season_id, row.week, author.id, row.slug),
                    entryKeys(input),
                    ?row.id,
                )) {
                    case (#err(#Invalid(message))) return #err(#Invalid(message));
                    case (#err(_)) return #err(#Invalid("could not validate pending app files"));
                    case (#ok) {};
                };
                switch (Season.applyEntry(
                    db,
                    author,
                    input,
                    sizeOf,
                    now,
                )) {
                    // An edit can displace several: the icon it swapped, any
                    // screenshot it dropped, and the build it replaced.
                    case (#ok((_, gone))) #ok(gone);
                    case (#err(e)) #err(e);
                };
            };
            case (#version) {
                let ?targetId = row.targetEntryId else {
                    return #err(#Invalid("this version does not name an app"));
                };
                let target = switch (Season.versionTarget(db, author, targetId)) {
                    case (#ok(value)) value;
                    case (#err(e)) return #err(#Season(e));
                };
                let input : Season.UpdateInput = {
                    version = row.version;
                    note = row.note;
                    pkg = switch (row.pkgKey) { case (?key) ?{ key }; case null null };
                };
                switch (checkPendingAssetReuse(
                    db,
                    author.id,
                    Season.chosenSlugOf(db, target),
                    versionKeys(input),
                    ?row.id,
                )) {
                    case (#err(#Invalid(message))) return #err(#Invalid(message));
                    case (#err(_)) return #err(#Invalid("could not validate pending app files"));
                    case (#ok) {};
                };
                switch (Season.applyVersion(
                    db,
                    author,
                    targetId,
                    input,
                    sizeOf,
                    now,
                )) {
                    case (#ok((_, ?replaced))) #ok([replaced]);
                    case (#ok((_, null))) #ok([]);
                    case (#err(e)) #err(e);
                };
            };
        };

        switch (applied) {
            case (#err(e)) #err(#Season(e));
            case (#ok(replaced)) {
                switch (settle(db, row, #approved, reviewer, "", now)) {
                    case (#ok(saved)) #ok((saved, replaced));
                    // Applying the entry already mutated its row.  A returned
                    // error here would commit that change while leaving the
                    // revision pending and approvable again.
                    case (#err(_)) Runtime.trap("could not settle an applied revision");
                };
            };
        };
    };

    public func reject(
        db : Ashroot.DB,
        reviewer : ?Nat64,
        id : Nat64,
        reason : Text,
        now : Nat64,
    ) : Result.Result<Revision, Error> {
        if (reason.size() == 0) return #err(#Invalid("say why"));
        if (reason.size() > MAX_REASON) return #err(#Invalid("that reason is too long"));
        let ?row = db.revisions.get(id) else return #err(#NotFound);
        if (row.state != #pending) return #err(#NotPending);
        if (reviewer == ?row.user_id) return #err(#NotAllowed);
        settle(db, row, #rejected, reviewer, reason, now);
    };

    /// A participant cannot mutate bytes while a moderator is deciding them,
    /// nor any bytes already published. Stale rows from an earlier week are
    /// ignored here: `approve` can only expire them, never apply them, and the
    /// owner must be able to delete their bytes to recover finite allowance.
    /// `checkPendingAssetReuse` separately prevents assigning that exact stale
    /// key to a different app lineage.
    public func assetLocked(db : Ashroot.DB, userId : Nat64, key : Text) : Bool {
        if (Season.assetLocked(db, userId, key)) return true;
        let live = Season.running(db);
        for (row in db.revisions.byUser.rangeIter(
            { gt = null; gte = ?userId; lt = null; lte = ?userId; dir = #fwd },
            null,
        )) {
            let current = switch (live) {
                case (?season) row.season_id == season.id and row.week == season.week;
                case null false;
            };
            if (row.state == #pending and current and revisionReferences(row, key)) return true;
        };
        false;
    };

    func revisionReferences(row : Revision, key : Text) : Bool {
        if (row.icon == ?key or row.pkgKey == ?key) return true;
        for (shot in row.shots.vals()) { if (shot == key) return true };
        false;
    };

    func settle(
        db : Ashroot.DB,
        row : Revision,
        state : State,
        reviewer : ?Nat64,
        reason : Text,
        now : Nat64,
    ) : Result.Result<Revision, Error> {
        switch (
            db.revisions.update({
                row with state; reason; reviewer; decidedAt = now
            })
        ) {
            case (#ok(saved)) #ok(saved);
            case (#err(e)) #err(#Db(e));
        };
    };

    // ── Reading ──────────────────────────────────────────────────────────────

    /// The queue, oldest first — the order it should be worked.
    public func pending(db : Ashroot.DB, limit : Nat) : [Revision] {
        let ?live = Season.running(db) else return [];
        // Pending is state code 0; the upper bound is the first key of the
        // next state, so the walk covers exactly the queue.
        let range = {
            gt = null : ?(Nat, Nat64);
            gte = ?(0 : Nat, 0 : Nat64);
            lt = ?(1 : Nat, 0 : Nat64);
            lte = null : ?(Nat, Nat64);
            dir = #fwd;
        };
        let out = List.empty<Revision>();
        label scan for (row in db.revisions.byQueue.rangeIter(range, null)) {
            if (List.size(out) >= limit) break scan;
            if (row.season_id == live.id and row.week == live.week) {
                List.add(out, row);
            };
        };
        List.toArray(out);
    };

    public func count(db : Ashroot.DB) : Nat {
        let ?live = Season.running(db) else return 0;
        var total = 0;
        for (row in db.revisions.byQueue.rangeIter(
            {
                gt = null : ?(Nat, Nat64);
                gte = ?(0 : Nat, 0 : Nat64);
                lt = ?(1 : Nat, 0 : Nat64);
                lte = null : ?(Nat, Nat64);
                dir = #fwd;
            },
            null,
        )) {
            if (row.season_id == live.id and row.week == live.week) total += 1;
        };
        total;
    };

    /// One person's history, newest first — what they asked for and what came
    /// back, rejection reports included.
    public func forUser(db : Ashroot.DB, userId : Nat64, limit : Nat) : [Revision] {
        let out = List.empty<Revision>();
        let wanted = Nat.min(limit, MAX_HISTORY);
        label scan for (row in db.revisions.byUser.rangeIter(
            { gt = null; gte = ?userId; lt = null; lte = ?userId; dir = #bwd },
            null,
        )) {
            if (List.size(out) >= wanted) break scan;
            List.add(out, row);
        };
        List.toArray(out);
    };
};
