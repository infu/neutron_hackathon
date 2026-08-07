/// Season, entries, votes and week resolution.
///
/// The format is in rules.md; this is the enforcement. Six weeks: four
/// qualifiers, a semi-final, a final. Everything hangs off a season row, and
/// the whole competition is three tables — seasons, entries, votes — because
/// the interesting state is all derivable from those.
///
/// The one rule worth restating here, because it is the integrity of the
/// format: **starting a season freezes the judges**. Moderation.mo checks
/// `judgesFrozen` before any judge change.

import Array "mo:core/Array";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";

import IndexRuntime "mo:ashroot/index_runtime";

import Ashroot "../.ashroot/lib";
import Assets "./Assets";
import Profiles "./Profiles";

module {

    public type Season = Ashroot.Types.Season;
    public type Entry = Ashroot.Types.Entry;
    public type Vote = Ashroot.Types.Vote;
    public type Phase = Ashroot.Types.Seasons.Season.Phase;
    public type Outcome = Ashroot.Types.Entries.Entry.Outcome;
    public type FundingFailure = Ashroot.Types.Seasons.Season.FundingFailures.Element;
    public type User = Profiles.User;

    public type Error = {
        /// The caller's account is frozen: they may read, not write.
        #Frozen;
        #NotAllowed;
        #NotRegistered;
        #NoSeason;
        #SeasonRunning;
        #WeekClosed;
        #NotAHacker;
        /// No reward wallet on the account. Separate from `#Invalid` because
        /// the UI has a specific field and a specific link to point at.
        #NoWallet;
        /// A distribution is being worked out or is in flight. Nothing about
        /// a profile or an app may move until it settles.
        #Distributing;
        #NotAJudge;
        #OwnEntry;
        #VoteLimit;
        #AlreadyVoted;
        /// Existing ballots become final for the last hour of every round.
        /// New ballots may still be cast until the round itself closes.
        #VoteLocked;
        #NotFound;
        #Invalid : Text;
        #Db : Ashroot.Errors.Error;
    };

    /// Four qualifiers, a semi-final, a final.
    public let QUALIFIERS = 4;
    public let SEMI = 5;
    public let FINAL = 6;

    /// Top 5 rewarded in a qualifier; top 1 advances.
    public let REWARDED_PER_WEEK = 5;
    public let ADVANCE_FROM_QUALIFIER = 1;
    /// Four meet in the semi, two survive.
    public let ADVANCE_FROM_SEMI = 2;

    public let VOTES_PER_JUDGE = 2;
    public let MAX_QUALIFIER_ENTRIES = 1_000;
    public let MAX_FUNDING_FAILURES = 64;

    /// Launch is irreversible once the controller list is emptied. Three
    /// moderators is the smallest bench on which a matter concerning one
    /// moderator can still receive the two independent approvals required by
    /// Moderation. Three judges provide six independent ballots per round,
    /// enough to cover all five rewarded qualifier places without allowing a
    /// single missing judge to stop judging altogether.
    public let MIN_LAUNCH_MODERATORS = 3;
    public let MIN_LAUNCH_JUDGES = 3;
    public let MAX_LAUNCH_LEDGERS = 7;

    /// A week and a day, in nanoseconds. Written out because arithmetic here
    /// is not a static expression.
    public let WEEK_NANOS : Nat64 = 604_800_000_000_000;
    public let DAY_NANOS : Nat64 = 86_400_000_000_000;
    public let VOTE_WITHDRAWAL_LOCK_NANOS : Nat64 = 3_600_000_000_000;

    /// How long a round stays open.
    ///
    /// **[decided]** A qualifier runs a **week**; the semi-final and the final
    /// run a **day** each. They are not the same kind of round and giving them
    /// the same clock was a mistake of symmetry.
    ///
    /// A qualifier week is for *building*: it is open for submissions, and a
    /// week is roughly the least time in which somebody can produce an app
    /// worth judging. Nothing is submitted to the semi or the final — the
    /// entrants are carried in automatically, finished — so those rounds are
    /// pure judging, and there are two apps and four apps in them
    /// respectively. A week to compare four things is a week of a bracket
    /// visibly not moving, with the prize pool sitting undistributed at the
    /// end of it.
    ///
    /// So a season is four weeks and two days, not six weeks.
    public func roundNanos(weekNo : Nat) : Nat64 =
        if (weekNo <= QUALIFIERS) WEEK_NANOS else DAY_NANOS;

    /// Which half of the bracket a qualifier week feeds. Weeks 1 and 2 meet
    /// each other; weeks 3 and 4 meet each other (rules.md §5).
    public func halfOfWeek(weekNo : Nat) : Nat = if (weekNo <= 2) 0 else 1;

    // ── Reads ────────────────────────────────────────────────────────────────

    /// The live season, if any. Backed by a sparse index holding at most one
    /// row, so this is a lookup rather than a scan.
    public func running(db : Ashroot.DB) : ?Season {
        db.seasons.byRunning.rangeIter(
            { gt = null; gte = null; lt = null; lte = null; dir = #fwd },
            null,
        ).next();
    };

    /// Durable phase alone is not enough when a close timer is late or gone.
    /// Writes stop at the published deadline even if the row has not yet been
    /// advanced to its next round.
    public func roundOpen(season : Season, at : Nat64) : Bool {
        season.phase == #running and at < season.weekEndsAt;
    };

    public func current(db : Ashroot.DB) : ?Season {
        switch (running(db)) {
            case (?season) ?season;
            case null {
                // Nothing live: fall back to the most recent, so a finished
                // season still has a results page.
                switch (db.seasons.iterPrimary(#bwd, null).next()) {
                    case (?(_, season)) ?season;
                    case null null;
                };
            };
        };
    };

    /// The judge set becomes part of the sealed competition record at start
    /// and never becomes editable again on this one-season canister.
    public func judgesFrozen(db : Ashroot.DB) : Bool {
        switch (current(db)) {
            case (?season) season.phase != #draft;
            case null false;
        };
    };

    /// The one-season sponsor/ledger set becomes accounting truth at start and
    /// can never become editable again, including after payout.
    public func sponsorsFrozen(db : Ashroot.DB) : Bool {
        switch (current(db)) {
            case (?season) season.phase != #draft;
            case null false;
        };
    };

    public func participantWritesClosed(db : Ashroot.DB) : Bool {
        switch (current(db)) {
            case (?season) season.phase == #finished;
            case null false;
        };
    };

    /// The final's published deadline closes participant mutation even when
    /// its timer has not yet changed the phase row to `#finished`.
    public func participantWritesClosedAt(db : Ashroot.DB, at : Nat64) : Bool {
        let ?season = current(db) else return false;
        season.phase == #finished or (
            season.phase == #running
            and season.week >= FINAL
            and at >= season.weekEndsAt
        );
    };

    /// Every season, newest first.
    ///
    /// A season is six weeks, so this list is short by construction — there
    /// is no paging here and there does not need to be.
    public func all(db : Ashroot.DB, limit : Nat) : [Season] {
        let out = List.empty<Season>();
        label scan for ((_, season) in db.seasons.iterPrimary(#bwd, null)) {
            if (List.size(out) >= limit) break scan;
            List.add(out, season);
        };
        List.toArray(out);
    };

    public func byNumber(db : Ashroot.DB, number : Nat) : ?Season {
        let ?pk = db.seasons.byNumber.locate(number) else return null;
        db.seasons.get(pk);
    };

    /// Is the season settling up?
    ///
    /// **[decided]** From the moment the final week closes until rewards reach
    /// a terminal paid/failed state, participants cannot change anything: not
    /// a profile, app, reward wallet, or opt-out choice. Controller recovery
    /// does not reopen these participant writes.
    ///
    /// The wallet is the sharp case and it is a money bug, not a tidiness one.
    /// A payout row freezes its destination at draft precisely so a retry is
    /// byte-identical and the ledger's deduplication collapses it — that is the
    /// whole at-most-once mechanism. A wallet edited between attempt one and
    /// attempt two would produce a *different* transfer, dedup would not fire,
    /// and the winner would be paid twice. Freezing the row is the first line
    /// of defence; this is the second, and it also covers the softer versions:
    /// a handle rename or an opt-out landing after the split was computed.
    ///
    /// It ends when the money has settled — paid, or definitively failed.
    /// There is no controller hand-back step in settlement.
    public func settling(db : Ashroot.DB) : Bool {
        let ?season = current(db) else return false;
        // A running season is the normal case: hackers edit their apps weekly.
        if (season.phase != #finished) return false;
        switch (season.payout) {
            // `#none` counts as unsettled: the distribution has not started
            // *yet*, which is the beginning of the window rather than the end.
            case (#none or #proposed or #approved or #paying) true;
            case (#paid or #failed) false;
        };
    };

    public func entry(db : Ashroot.DB, id : Nat64) : ?Entry {
        db.entries.get(id);
    };

    /// A hacker's first entry for one week, if they have one.
    ///
    /// In weeks 1-4 there is at most one, and this is it. In the semi-final and
    /// the final a hacker who won two qualifiers holds **two** seats — see
    /// `slotsFor` — and this returns the one carried from the earlier week.
    /// This remains a convenient singular read for old callers. Any write that
    /// can affect a carried app must use an exact entry id instead: a double
    /// qualifier can hold two current seats and seat zero is not a choice.
    public func entryFor(db : Ashroot.DB, seasonId : Nat64, week : Nat, userId : Nat64) : ?Entry {
        let held = slotsFor(db, seasonId, week, userId);
        if (held.size() == 0) null else ?held[0];
    };

    /// Every seat a hacker holds in one week, earliest origin first.
    ///
    /// `bySlot` is keyed `(season, week, user, origin)` — origin `0` for a
    /// submission, the source row's id for a carried one — so this is one
    /// bounded range walk. The origin is in the key because a hacker who wins
    /// two qualifier weeks earns two semi-final seats, and keying on
    /// `(season, week, user)` alone silently collapsed them: the second `carry`
    /// hit the unique constraint, and duel B lost an entrant it had won.
    public func slotsFor(db : Ashroot.DB, seasonId : Nat64, week : Nat, userId : Nat64) : [Entry] {
        let out = List.empty<Entry>();
        for (row in db.entries.bySlot.rangeIter(
            {
                gt = null;
                gte = ?(seasonId, week, userId, 0 : Nat64);
                lt = ?(seasonId, week, userId + 1, 0 : Nat64);
                lte = null;
                dir = #fwd;
            },
            null,
        )) { List.add(out, row) };
        List.toArray(out);
    };

    /// Every entry in a week, highest votes first.
    ///
    /// The index order *is* the ranking. `byRank` is keyed
    /// `(season, week, votes, Nat64.maxValue - id)`, so walking backwards gives
    /// votes descending and, within equal votes, id ascending — which is
    /// rules.md §5's tie-break exactly. Stopping at `limit` is therefore
    /// correct by construction: the first `k` of this walk are the first `k` of
    /// the whole ranking.
    ///
    /// That is the whole point of the fourth key component. With `(season,
    /// week, votes)` alone, ties came back in insertion order and were re-sorted
    /// *after* truncation — so a limited read returned the newest tied entries
    /// and then ranked those, and `season_week(k)` was not the first `k` of
    /// `season_week(all)`. The bracket draws 12 boxes a week, so any week over
    /// 12 entries rendered a wrong bracket, and `closeWeek`'s limit of 500 made
    /// it decide money above 500.
    ///
    /// `rankTies` below is now a redundant safety net rather than a correction.
    public func week(db : Ashroot.DB, seasonId : Nat64, weekNo : Nat, limit : Nat) : [Entry] {
        let range = {
            gt = null;
            gte = ?(seasonId, weekNo, 0, 0 : Nat64);
            lt = ?(seasonId, weekNo + 1, 0, 0 : Nat64);
            lte = null;
            dir = #bwd;
        };
        let out = List.empty<Entry>();
        label scan for (row in db.entries.byRank.rangeIter(range, null)) {
            if (List.size(out) >= limit) break scan;
            List.add(out, row);
        };
        rankTies(List.toArray(out));
    };

    /// A week's entries with their author attached, plus the viewer's own
    /// relationship to each one.
    ///
    /// The join belongs here rather than in the browser: an entry row carries
    /// only a user id, so a twenty-entry week would otherwise be twenty extra
    /// calls to render a list.
    /// The slice of an entry the bracket needs.
    ///
    /// Not the row itself: screenshots, links and the changelog can run to
    /// kilobytes each, and the map asks for six weeks at once. Sending them
    /// with every box would make the payload grow with content nobody is
    /// looking at yet. The counts are enough to draw a badge; `entryDetail`
    /// fetches the rest when an entry is actually opened.
    public type Summary = {
        id : Nat64;
        season_id : Nat64;
        user_id : Nat64;
        week : Nat;
        title : Text;
        summary : Text;
        url : Text;
        icon : ?Text;
        /// Just the first, for the card.
        shot : ?Text;
        votes : Nat;
        outcome : Outcome;
        origin_id : ?Nat64;
        shots : Nat;
        links : Nat;
        updates : Nat;
        hasPackage : Bool;
        /// Nonzero once moderators removed the content. Carried on the summary
        /// as well as the row because the bracket draws cards from summaries,
        /// and a card that still looks whole is the one place somebody would
        /// not think to check.
        takedownAt : Nat64;
        takedownReason : Text;
    };

    /// A taken-down row retains only private key tombstones in its existing
    /// asset fields. They make the exact deleted URLs permanently immutable,
    /// while every public entry projection still looks stripped and never
    /// advertises a broken image or package.
    public func visibleEntry(entry : Entry) : Entry {
        if (entry.takedownAt == 0) entry else ({
            entry with
            icon = null;
            shots = [];
            pkg = null;
        });
    };

    public func summarise(entry : Entry) : Summary {
        let visible = visibleEntry(entry);
        {
            id = entry.id;
            season_id = entry.season_id;
            user_id = entry.user_id;
            week = entry.week;
            title = entry.title;
            summary = entry.summary;
            url = entry.url;
            icon = visible.icon;
            shot = if (visible.shots.size() == 0) null else ?visible.shots[0];
            votes = entry.votes;
            outcome = entry.outcome;
            origin_id = entry.origin_id;
            shots = visible.shots.size();
            links = entry.links.size();
            updates = entry.updates.size();
            hasPackage = visible.pkg != null;
            takedownAt = entry.takedownAt;
            takedownReason = entry.takedownReason;
        };
    };

    /// Who made it, and where the viewer stands on it.
    public type Author = {
        handle : Text;
        displayName : Text;
        avatar : ?Text;
        title : ?Text;
        judge : Bool;
        /// The viewer submitted this one — so they cannot vote for it.
        mine : Bool;
        /// The viewer has already spent a vote on it.
        voted : Bool;
    };

    public type View = Author and { entry : Summary };

    /// Everything about one entry, for the panel that opens over the bracket.
    public type Detail = Author and {
        entry : Entry;
        /// The viewer owns it and may **replace its details** — title, summary,
        /// links, art. Only ever true for a qualifier entry in the open week:
        /// weeks 5 and 6 are carried into and `submit_entry` refuses them.
        detailsEditable : Bool;
        /// The viewer owns it and may **publish a version** against it. True
        /// for a carried entry too, which is the point of splitting these:
        /// one flag could not say "you cannot replace this, but you can still
        /// ship a build against it", so it said one and the UI believed the
        /// other.
        versionsEditable : Bool;
    };

    func author(db : Ashroot.DB, entry : Entry, me : ?User) : Author {
        let who = db.users.get(entry.user_id);
        {
            handle = switch (who) { case (?u) u.handle; case null "unknown" };
            displayName = switch (who) { case (?u) u.displayName; case null "Unknown" };
            avatar = switch (who) { case (?u) u.avatar; case null null };
            title = switch (who) { case (?u) u.title; case null null };
            judge = switch (who) { case (?u) u.judgeStatus == #approved; case null false };
            mine = switch (me) { case (?u) u.id == entry.user_id; case null false };
            voted = switch (me) { case (?u) hasVoted(db, u.id, entry.id); case null false };
        };
    };

    public func weekView(
        db : Ashroot.DB,
        seasonId : Nat64,
        weekNo : Nat,
        limit : Nat,
        viewer : ?Principal,
    ) : [View] {
        let me = switch (viewer) {
            case (?p) Profiles.byPrincipal(db, p);
            case null null;
        };
        Array.map<Entry, View>(
            week(db, seasonId, weekNo, limit),
            func(entry) { { author(db, entry, me) with entry = summarise(entry) } },
        );
    };

    /// A bounded rank cursor for the large qualifier list. `next` is the
    /// zero-based offset of the next row, or null at the end. Open-week votes
    /// can reorder rows between query calls, so this is intentionally a view
    /// cursor rather than a durable competition record.
    public type WeekPage = {
        rows : [View];
        next : ?Nat;
        total : Nat;
    };

    public func weekPage(
        db : Ashroot.DB,
        seasonId : Nat64,
        weekNo : Nat,
        after : ?Nat,
        limit : Nat,
        viewer : ?Principal,
    ) : WeekPage {
        let start = switch (after) { case (?offset) offset; case null 0 };
        let ranked = week(db, seasonId, weekNo, MAX_QUALIFIER_ENTRIES);
        let available = if (start < ranked.size()) Nat.sub(ranked.size(), start) else 0;
        let take = Nat.min(limit, available);
        let selected = Array.tabulate<Entry>(take, func(i) = ranked[start + i]);
        let me = switch (viewer) {
            case (?p) Profiles.byPrincipal(db, p);
            case null null;
        };
        let rows = Array.map<Entry, View>(
            selected,
            func(entry) { { author(db, entry, me) with entry = summarise(entry) } },
        );
        let end = start + take;
        {
            rows;
            next = if (end < ranked.size()) ?end else null;
            total = countWeek(db, seasonId, weekNo);
        };
    };

    /// Everything one person has entered, newest first.
    ///
    /// Backed by the `byUser` index, so this is a walk of that person's own
    /// rows rather than a scan — a profile page must not get slower because
    /// the season did.
    /// Is this asset key part of a published record?
    ///
    /// An entry row stops being editable when its week closes, but the row
    /// only holds *keys* — the images and the build live in the asset store,
    /// and overwriting a key there changes what a closed week shows without
    /// touching the row at all. A project could be judged on one set of
    /// screenshots and display another afterwards, or have the package that
    /// was judged deleted out from under it.
    ///
    /// A published key is immutable even while its week is open.  Editing is
    /// a fresh upload and a fresh revision; otherwise approval attests to a
    /// path whose bytes the author can replace immediately afterwards.
    ///
    /// Walks one person's own entries — a handful per season — not the table.
    public func assetLocked(db : Ashroot.DB, userId : Nat64, key : Text) : Bool {
        for (row in db.entries.byUser.rangeIter(
            { gt = null; gte = ?userId; lt = null; lte = ?userId; dir = #fwd },
            null,
        )) {
            if (references(row, key)) return true;
        };
        false;
    };

    func references(entry : Entry, key : Text) : Bool {
        if (entry.icon == ?key) return true;
        for (shot in entry.shots.vals()) { if (shot == key) return true };
        switch (entry.pkg) {
            case (?pkg) if (pkg.key == key) return true;
            case null {};
        };
        false;
    };

    /// Refuse one exact upload key when another app lineage already publishes
    /// it. Carried copies of the same app intentionally share their immutable
    /// files; a separately named app must upload its own key so a later
    /// takedown can delete one app's bytes without breaking another.
    func keyAvailableToLineage(
        db : Ashroot.DB,
        userId : Nat64,
        seasonId : Nat64,
        lineage : Text,
        key : Text,
    ) : Bool {
        for (row in db.entries.byUser.rangeIter(
            { gt = null; gte = ?userId; lt = null; lte = ?userId; dir = #fwd },
            null,
        )) {
            if (
                references(row, key)
                and not (
                    row.season_id == seasonId
                    and chosenSlugOf(db, row) == lineage
                )
            ) return false;
        };
        true;
    };

    func checkLineageKeys(
        db : Ashroot.DB,
        userId : Nat64,
        seasonId : Nat64,
        lineage : Text,
        keys : [Text],
    ) : Result.Result<(), Error> {
        for (key in keys.vals()) {
            if (not keyAvailableToLineage(db, userId, seasonId, lineage, key)) {
                return #err(#Invalid(
                    "that exact upload is already used by another app; upload it again for this app"
                ));
            };
        };
        #ok;
    };

    /// The existing lineage when this qualifier row is an edit, otherwise the
    /// app id the author is proposing for the new row.
    public func entryInputLineage(
        db : Ashroot.DB,
        seasonId : Nat64,
        week : Nat,
        userId : Nat64,
        slug : Text,
    ) : Text {
        switch (entryFor(db, seasonId, week, userId)) {
            case (?existing) chosenSlugOf(db, existing);
            case null slug;
        };
    };

    public func checkEntryAssetReuse(
        db : Ashroot.DB,
        season : Season,
        user : Profiles.User,
        input : EntryInput,
    ) : Result.Result<(), Error> {
        let keys = List.empty<Text>();
        switch (input.icon) { case (?key) List.add(keys, key); case null {} };
        for (shot in input.shots.vals()) List.add(keys, shot);
        List.add(keys, input.pkg.key);
        checkLineageKeys(
            db,
            user.id,
            season.id,
            entryInputLineage(db, season.id, season.week, user.id, input.slug),
            List.toArray(keys),
        );
    };

    public func checkVersionAssetReuse(
        db : Ashroot.DB,
        user : Profiles.User,
        entry : Entry,
        input : UpdateInput,
    ) : Result.Result<(), Error> {
        switch (input.pkg) {
            case null #ok;
            case (?pkg) checkLineageKeys(
                db,
                user.id,
                entry.season_id,
                chosenSlugOf(db, entry),
                [pkg.key],
            );
        };
    };

    public func entriesBy(db : Ashroot.DB, userId : Nat64, limit : Nat) : [Summary] {
        let out = List.empty<Entry>();
        for (row in db.entries.byUser.rangeIter(
            { gt = null; gte = ?userId; lt = null; lte = ?userId; dir = #fwd },
            null,
        )) {
            List.add(out, row);
        };
        // Sorted here rather than trusting the index direction: `byUser` keys
        // on the user alone, so everything one person entered shares a key and
        // the order within it is the index's business, not a guarantee. Ids
        // ascend with creation, so descending id is newest first.
        let rows = Array.sort<Entry>(
            List.toArray(out),
            func(a, b) = Nat64.compare(b.id, a.id),
        );
        Array.map<Entry, Summary>(
            Array.tabulate<Entry>(Nat.min(limit, rows.size()), func(i) = rows[i]),
            summarise,
        );
    };

    public func entryDetail(db : Ashroot.DB, id : Nat64, viewer : ?Principal, at : Nat64) : ?Detail {
        let ?entry = db.entries.get(id) else return null;
        let me = switch (viewer) {
            case (?p) Profiles.byPrincipal(db, p);
            case null null;
        };
        let open = switch (running(db)) {
            case (?live) {
                live.id == entry.season_id
                and live.week == entry.week
                and roundOpen(live, at);
            };
            case null false;
        };
        let mine = switch (me) {
            case (?u) open and entry.takedownAt == 0 and u.id == entry.user_id and u.hacker;
            case null false;
        };
        ?{
            author(db, entry, me) with
            entry = visibleEntry(entry);
            detailsEditable = mine and entry.week <= QUALIFIERS;
            versionsEditable = mine;
        };
    };

    /// Stable ordering: votes descending, then id ascending.
    ///
    /// An index cannot express "descending on one component, ascending on the
    /// next", so the tie-break is applied here. rules.md picks earliest-submitted
    /// on a tie — arbitrary, but deterministic, which is what matters.
    func rankTies(rows : [Entry]) : [Entry] {
        Array.sort<Entry>(
            rows,
            func(a, b) {
                if (a.votes != b.votes) return Nat.compare(b.votes, a.votes);
                Nat64.compare(a.id, b.id);
            },
        );
    };

    /// One week's slice of the map: its top entries and how many there are.
    public type WeekView = {
        week : Nat;
        /// Everything submitted that week, even if only `entries` are shown.
        total : Nat;
        entries : [View];
    };

    /// The whole season in a single call.
    ///
    /// The map is meant to be readable at a glance, so each week is capped at
    /// `perWeek` and reports its true `total` alongside — six round trips to
    /// draw one screen would be silly, and an uncapped week would blow the
    /// response up once a qualifier has a few hundred entries.
    public func map(
        db : Ashroot.DB,
        seasonId : Nat64,
        perWeek : Nat,
        viewer : ?Principal,
    ) : [WeekView] {
        Array.tabulate<WeekView>(
            FINAL,
            func(i) {
                let weekNo = i + 1;
                {
                    week = weekNo;
                    total = countWeek(db, seasonId, weekNo);
                    entries = weekView(db, seasonId, weekNo, perWeek, viewer);
                };
            },
        );
    };

    public func countWeek(db : Ashroot.DB, seasonId : Nat64, weekNo : Nat) : Nat {
        db.entries.bySlot.countInRange(
            {
                gt = null;
                gte = ?(seasonId, weekNo, 0 : Nat64, 0 : Nat64);
                lt = ?(seasonId, weekNo + 1, 0 : Nat64, 0 : Nat64);
                lte = null;
                dir = #fwd;
            },
            null,
        );
    };

    public func votesBy(db : Ashroot.DB, judgeId : Nat64, seasonId : Nat64, weekNo : Nat) : Nat {
        db.votes.byJudgeWeek.countInRange(
            {
                gt = null;
                gte = ?(judgeId, seasonId, weekNo);
                lt = null;
                lte = ?(judgeId, seasonId, weekNo);
                dir = #fwd;
            },
            null,
        );
    };

    public func hasVoted(db : Ashroot.DB, judgeId : Nat64, entryId : Nat64) : Bool {
        db.votes.byJudgeEntry.exists((judgeId, entryId));
    };

    // ── Season lifecycle ─────────────────────────────────────────────────────

    /// Create a draft. The judges can still be changed until it starts.
    /// Draw up this canister's season. There is only ever one.
    ///
    /// **[decided]** One canister, one season. The next season is a new
    /// canister, not a new row here.
    ///
    /// The alternative was guarding a list of things that only go wrong with a
    /// second season in the same canister, and the list was not short: two
    /// distributions drawing on one treasury with nothing sequencing them, and
    /// a retry timer that resolves *which* season through `current` — which
    /// prefers the running one, so starting a second would quietly abandon the
    /// first's unfinished transfers. Each of those is fixable; none of them
    /// needs fixing if the situation cannot arise.
    ///
    /// It buys something better than the absence of those bugs. A finished
    /// season's canister is sealed, holds only its own record, and is not run
    /// by whoever runs the next one — so last year's results cannot be edited
    /// by this year's moderators, whatever anyone decides later.
    public func create(db : Ashroot.DB, _now : Nat64) : Result.Result<Season, Error> {
        switch (db.seasons.iterPrimary(#bwd, null).next()) {
            case (?_) return #err(#Invalid(
                "this canister runs one season and already has one — the next "
                # "season is a new canister"
            ));
            case null {};
        };
        insert(db, 1);
    };

    func insert(db : Ashroot.DB, number : Nat) : Result.Result<Season, Error> {
        let row : Ashroot.Types.CreateSeason = {
            number;
            week = 0;
            phase = #draft;
            payout = #none;
            startedAt = 0;
            weekEndsAt = 0;
            endedAt = 0;
            fundingReady = false;
            fundingAttempts = 0;
            fundingFailures = [];
        };
        switch (db.seasons.insert(row)) {
            case (#err(e)) #err(#Db(e));
            case (#ok(pk)) {
                let ?season = db.seasons.get(pk) else return #err(#NotFound);
                #ok(season);
            };
        };
    };

    /// Everything that must be true before controllers can be removed or a
    /// season can start. Both irreversible boundaries use this exact helper.
    ///
    /// Registration closes deliberately, through controller configuration,
    /// before sealing. `start` no longer quietly fixes an omitted launch step
    /// after nobody remains able to inspect or correct the configured state.
    public func launchReadiness(db : Ashroot.DB, seasonId : Nat64) : Result.Result<Season, Error> {
        if (running(db) != null) return #err(#SeasonRunning);
        let ?season = db.seasons.get(seasonId) else return #err(#NotFound);
        if (season.phase != #draft) return #err(#Invalid("season is not a draft"));
        let launch = db.store.get();
        if (launch.registrationOpen) {
            return #err(#Invalid("registration must be closed before the canister is sealed"));
        };
        if (not launch.ledgerAllowlistSet or launch.ledgerAllowlist.size() == 0) {
            return #err(#Invalid("the ledger allowlist has not been configured"));
        };
        if (launch.ledgerAllowlist.size() > MAX_LAUNCH_LEDGERS) {
            return #err(#Invalid(
                "the launch ledger allowlist may contain at most "
                # Nat.toText(MAX_LAUNCH_LEDGERS) # " ledgers"
            ));
        };
        let counts = Profiles.counts(db);
        if (counts.pending > 0) {
            return #err(#Invalid("every judge application must be decided before the canister is sealed"));
        };
        if (counts.sponsorsPending > 0) {
            return #err(#Invalid("every sponsor application must be decided before the season starts"));
        };
        if (counts.moderators < MIN_LAUNCH_MODERATORS) {
            return #err(#Invalid(
                "appoint at least " # Nat.toText(MIN_LAUNCH_MODERATORS)
                # " moderators before the canister is sealed"
            ));
        };
        if (counts.moderators > Profiles.MAX_MODERATORS) {
            return #err(#Invalid(
                "retain at most " # Nat.toText(Profiles.MAX_MODERATORS)
                # " moderators before the canister is sealed"
            ));
        };
        if (counts.judges < MIN_LAUNCH_JUDGES) {
            return #err(#Invalid(
                "approve at least " # Nat.toText(MIN_LAUNCH_JUDGES)
                # " judges before the canister is sealed"
            ));
        };
        let approvedSponsors = counts.sponsors;
        if (approvedSponsors == 0) {
            return #err(#Invalid("at least one sponsor must be approved before the season starts"));
        };
        if (approvedSponsors > Profiles.MAX_APPROVED_SPONSORS) {
            return #err(#Invalid("too many approved sponsors"));
        };
        // Recheck the frozen set at the exact write boundary.  `start_season`
        // awaits controller status first, so an application can interleave
        // before this synchronous function runs.
        var approvedLedgers = 0;
        for (user in db.users.bySponsorHandle.rangeIter(
            { gt = null; gte = ?(2, ""); lt = ?(3, ""); lte = null; dir = #fwd },
            null,
        )) {
            switch (user.sponsor) {
                case (?info) {
                    for (ledger in info.ledgers.vals()) {
                        if (not Profiles.ledgerAllowed(db, ledger.id)) {
                            return #err(#Invalid("an approved sponsor names a ledger outside the allowlist"));
                        };
                        approvedLedgers += 1;
                    };
                };
                case null return #err(#Invalid("an approved sponsor has no application"));
            };
        };
        if (approvedLedgers == 0) {
            return #err(#Invalid("at least one approved sponsor ledger is required"));
        };
        #ok(season);
    };

    /// Start a draft. This is the moment the judge freezes. Readiness is
    /// checked again here, synchronously with the phase write: `start_season`
    /// awaited the management canister immediately before entering this
    /// function. The durable launch latch separately rejects a controller list
    /// that an operator changed by hand.
    public func start(db : Ashroot.DB, seasonId : Nat64, now : Nat64) : Result.Result<Season, Error> {
        let season = switch (launchReadiness(db, seasonId)) {
            case (#ok(ready)) ready;
            case (#err(error)) return #err(error);
        };
        switch (save(db, {
            season with
            phase = #running;
            week = 1;
            startedAt = now;
            weekEndsAt = now + roundNanos(1);
            fundingReady = false;
            fundingAttempts = 0;
            fundingFailures = [];
        })) {
            case (#ok(saved)) #ok(saved);
            case (#err(_)) Runtime.trap("could not start a ready season");
        };
    };

    func setRegistration(db : Ashroot.DB, open : Bool) {
        db.store.set({ db.store.get() with registrationOpen = open });
    };

    /// Resolve the open week and move on.
    ///
    /// Qualifiers reward the top five and advance the top one. The semi-final
    /// rewards and advances two. The final crowns one and ends the season.
    /// Whole seconds from `now` until `due`, and never negative.
    ///
    /// What a week-close timer is armed with. Split out from the actor because
    /// it is the one piece of the clock that is arithmetic rather than
    /// scheduling, and because the interesting case is the one that cannot be
    /// reached by waiting: a deadline already in the past. That happens
    /// whenever the canister was down or upgrading when a week came due, and
    /// the answer is zero — fire now. On `Nat64` the subtraction would trap
    /// rather than go negative, so the guard is load-bearing, not decoration.
    /// Whole seconds until `due`, **rounded up**.
    ///
    /// Rounding down is what a division gives you and it is wrong here: a
    /// deadline 900 ms away truncates to zero, the timer fires at once, and the
    /// week closes before the moment `week_ends_at` published. Nobody would
    /// notice a second — but an upgrade re-arms this, so an upgrade landing in
    /// the last second of a week would close it early, which is a different
    /// claim from "the schedule does not drift".
    ///
    /// Waking a moment late is free; waking early is the bug.
    public func secondsUntil(due : Nat64, now : Nat64) : Nat {
        if (due <= now) return 0;
        Nat64.toNat((due - now + 999_999_999) / 1_000_000_000);
    };

    public func closeWeek(db : Ashroot.DB, now : Nat64) : Result.Result<Season, Error> {
        let ?season = running(db) else return #err(#NoSeason);
        let weekNo = season.week;

        // Resolution only needs the rows whose outcome can change: five in a
        // qualifier, all four semi-final seats, and the two finalists. The
        // qualifier entry cap bounds writes; it is not a reason to sort and
        // materialize a thousand rows in the timer callback.
        let resolutionLimit = if (weekNo <= QUALIFIERS) REWARDED_PER_WEEK
            else if (weekNo == SEMI) QUALIFIERS
            else ADVANCE_FROM_SEMI;
        let ranked = week(db, season.id, weekNo, resolutionLimit);

        // The semi is two separate duels, not one four-way round: weeks 1 and
        // 2 meet, weeks 3 and 4 meet, and one survives each (rules.md §5).
        // Taking the global top two would let both finalists come from the
        // same half of the bracket, which is a different competition.
        let advancers : [Entry] = if (weekNo == SEMI) {
            semiWinners(db, ranked);
        } else if (weekNo <= QUALIFIERS) {
            firstN(ranked, ADVANCE_FROM_QUALIFIER);
        } else {
            [];
        };
        let advancing = advancers.size();

        let rewarded = if (weekNo <= QUALIFIERS) REWARDED_PER_WEEK else advancing;

        var i = 0;
        for (row in ranked.vals()) {
            let outcome : Outcome = if (weekNo == FINAL and i == 0) #won
                else if (isAdvancer(advancers, row.id)) #advanced
                else if (weekNo <= QUALIFIERS and i < rewarded) #rewarded
                else #none;
            if (outcome != #none) {
                switch (db.entries.update({ row with outcome; updatedAt = now })) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("could not record a week outcome");
                };
            };
            i += 1;
        };

        // Carry the advancing entries into their next round.
        if (weekNo <= SEMI) {
            let target = if (weekNo <= QUALIFIERS) SEMI else FINAL;
            for (row in advancers.vals()) {
                switch (carry(db, row, target, now)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("could not carry a week winner");
                };
            };
        };

        if (weekNo >= FINAL) {
            // One canister runs one season.  It becomes a read-only record at
            // final close; registration never reopens here.
            setRegistration(db, false);
            switch (save(db, {
                season with
                phase = #finished;
                endedAt = now;
                weekEndsAt = 0 : Nat64;
                fundingReady = false;
                fundingAttempts = 0;
                fundingFailures = [] : [FundingFailure];
            })) {
                case (#ok(saved)) #ok(saved);
                case (#err(_)) Runtime.trap("could not finish the final week");
            };
        } else {
            // A full round from the close, not from the deadline it missed. A
            // close can be late — the timer fires a moment after the deadline,
            // a failed close backs off five minutes, a canister that was down
            // catches up whenever it returns — and anchoring on the old
            // deadline would hand the next round whatever was left of it. The
            // hackers entering that week did nothing wrong; they get the whole
            // round like everybody else, and the season simply ends later.
            // The round being *opened*, not the one just closed — the semi
            // follows a qualifier and gets a day, not the week behind it.
            switch (save(db, {
                season with
                week = weekNo + 1;
                weekEndsAt = now + roundNanos(weekNo + 1);
            })) {
                case (#ok(saved)) #ok(saved);
                case (#err(_)) Runtime.trap("could not advance the season clock");
            };
        };
    };

    func firstN(rows : [Entry], n : Nat) : [Entry] {
        Array.tabulate<Entry>(Nat.min(n, rows.size()), func(i) = rows[i]);
    };

    func isAdvancer(advancers : [Entry], id : Nat64) : Bool {
        for (row in advancers.vals()) { if (row.id == id) return true };
        false;
    };

    /// The best entry from each half of the bracket.
    ///
    /// `ranked` is already votes-descending with ties to the earliest entry,
    /// so the first match in each half is that half's winner.
    func semiWinners(db : Ashroot.DB, ranked : [Entry]) : [Entry] {
        let out = List.empty<Entry>();
        var half = 0;
        while (half < 2) {
            label find for (row in ranked.vals()) {
                switch (halfOf(db, row)) {
                    case (?h) if (h == half) { List.add(out, row); break find };
                    case _ {};
                };
            };
            half += 1;
        };
        List.toArray(out);
    };

    /// Which award an entry earned, if any.
    ///
    /// Read off the outcome and the round rather than stored: bronze is a
    /// place in a qualifier week, silver is surviving the semi, gold is the
    /// final. The same rule the UI draws from, so the two cannot disagree.
    public func awardOf(entry : Entry) : ?{ #bronze; #silver; #gold } {
        if (entry.outcome == #won) return ?#gold;
        if (entry.week == SEMI and entry.outcome == #advanced) return ?#silver;
        if (entry.week <= QUALIFIERS and entry.outcome != #none) return ?#bronze;
        null;
    };

    /// Which half of the bracket an entry came from.
    ///
    /// Walks the `origin_id` chain back to the qualifier week it started in —
    /// a finalist points at a semi-finalist, which points at the qualifier, so
    /// one hop is not enough. The loop is bounded by the number of rounds.
    public func halfOf(db : Ashroot.DB, row : Entry) : ?Nat {
        var current = row;
        var hops = 0;
        while (current.week > QUALIFIERS and hops < FINAL) {
            let ?origin = current.origin_id else return null;
            let ?source = db.entries.get(origin) else return null;
            current := source;
            hops += 1;
        };
        if (current.week > QUALIFIERS) return null;
        ?halfOfWeek(current.week);
    };

    /// Files the old version of an entry pointed at and the new one does not.
    ///
    /// Editing an entry is the quiet half of "replace an image". Uploading to
    /// the *same* key already frees the old bytes — `Assets.upload` releases
    /// the slot before it writes. But a hacker who swaps `icon/a.png` for
    /// `icon/b.png` leaves `a.png` behind: the row stops pointing at it and the
    /// asset store never notices, because it serves any complete asset by key
    /// and has no idea an entry exists. The file stays online and stays
    /// charged to them, for ever.
    ///
    /// So the writer reports what it displaced and the caller deletes it —
    /// same shape as `applyVersion`, and for the same reason.
    public func displaced(before : Entry, after : Entry) : [Text] {
        let gone = List.empty<Text>();
        let keeps = func(key : Text) : Bool {
            switch (after.icon) { case (?now) if (now == key) return true; case null {} };
            for (shot in after.shots.vals()) { if (shot == key) return true };
            switch (after.pkg) { case (?now) if (now.key == key) return true; case null {} };
            false;
        };
        switch (before.icon) { case (?key) if (not keeps(key)) List.add(gone, key); case null {} };
        for (shot in before.shots.vals()) { if (not keeps(shot)) List.add(gone, shot) };
        switch (before.pkg) { case (?was) if (not keeps(was.key)) List.add(gone, was.key); case null {} };
        List.toArray(gone);
    };

    /// Strip an entry's content after a takedown, keeping the entry.
    ///
    /// **[decided]** The app stays in the bracket and keeps its votes. A
    /// takedown is a statement about the files, not about the competition:
    /// judges have already seen and scored what was there, and deleting the
    /// row would silently rewrite a week's arithmetic to cover for it. So the
    /// row, the title, the author and the score all remain, the entry says
    /// plainly that its content was removed, and the judges decide what an
    /// entry with nothing to install is worth. That is their call to make.
    ///
    /// What goes is what can infringe and what can be installed: the package
    /// and the images. Whoever calls this deletes the files themselves — this
    /// module has no asset store — and the keys are returned for that.
    ///
    /// A takedown is terminal for this app lineage. A pending or later revision
    /// must never put the removed pointers back while leaving the row marked as
    /// already taken down.
    public func takedown(db : Ashroot.DB, entryId : Nat64, reason : Text, now : Nat64) : Result.Result<(Entry, [Text]), Error> {
        let canonical = switch (canonicalTakedownReason(reason)) {
            case (#ok(value)) value;
            case (#err(e)) return #err(e);
        };
        let ?target = db.entries.get(entryId) else return #err(#NotFound);
        if (target.takedownAt != 0) return #err(#Invalid("that app is already taken down"));

        // **Every row of the app, not the one that was clicked.**
        //
        // Winning a qualifier clones the entry into the semi-final and the
        // final, and a clone carries the same asset keys — so taking down the
        // week-one row deletes files that the week-five row is still pointing
        // at. What a moderator would have achieved is an entry that looks
        // untouched, carries no notice, and whose every image is broken.
        //
        // A carried lineage shares its stored `slug`, but a fresh qualifier
        // entry receives a fresh row suffix even when the author typed the
        // same app id. Those rows may legally share immutable asset keys. If
        // only the clicked suffix came down, deleting those shared keys would
        // leave every earlier qualifier advertising broken images without a
        // takedown notice. Match the author's original app id across this
        // season, including every carried clone, before deleting any bytes.
        let rows = lineageEntries(db, target);

        let files = List.empty<Text>();
        let keep = func(key : Text) {
            // Clones share keys, so the same file would otherwise be queued for
            // deletion several times. Harmless — `drop` is idempotent — but the
            // byte tally is charged per key, and charging twice would credit a
            // hacker back more than they ever stored.
            for (seen in List.values(files)) { if (seen == key) return };
            List.add(files, key);
        };

        var updated : ?Entry = null;
        for (row in rows.vals()) {
            switch (row.icon) { case (?key) keep(key); case null {} };
            for (shot in row.shots.vals()) keep(shot);
            switch (row.pkg) { case (?pkg) keep(pkg.key); case null {} };

            switch (
                db.entries.update({
                    row with
                    // Keep the exact deleted keys as private tombstones in the
                    // existing row. `assetLocked` then prevents a direct
                    // Candid caller from restoring the prohibited URL. Public
                    // queries pass the row through `visibleEntry`, so these
                    // pointers are never advertised after takedown.
                    takedownAt = now;
                    takedownReason = canonical;
                    updatedAt = now;
                })
            ) {
                case (#ok(saved)) { if (saved.id == entryId) updated := ?saved };
                // Earlier rows in this lineage may already have been hidden.
                // Trap so the whole takedown (and its quorum write) rolls back.
                case (#err(_)) Runtime.trap("could not update every row in a taken-down lineage");
            };
        };

        let ?answer = updated else return #err(#NotFound);
        #ok((answer, List.toArray(files)));
    };

    /// Retain pending-only keys removed by a completed takedown as private URL
    /// tombstones. `visibleEntry` strips `shots` from every public projection,
    /// while `assetLocked` continues to scan the stored row and therefore
    /// refuses an attempt to upload the exact deleted path again.
    ///
    /// The existing array is intentionally reused rather than adding a table
    /// or schema field. A participant owns at most 64 live keys, so this stays
    /// bounded even when several stale revisions of one app are expired.
    public func retainTakedownKeys(
        db : Ashroot.DB,
        entryId : Nat64,
        keys : [Text],
        now : Nat64,
    ) : Result.Result<Entry, Error> {
        let ?row = db.entries.get(entryId) else return #err(#NotFound);
        if (row.takedownAt == 0) {
            return #err(#Invalid("takedown keys require a taken-down entry"));
        };
        let held = List.empty<Text>();
        for (key in row.shots.vals()) List.add(held, key);
        for (key in keys.vals()) {
            var seen = false;
            for (existing in List.values(held)) {
                if (existing == key) seen := true;
            };
            if (not seen) List.add(held, key);
        };
        switch (db.entries.update({
            row with
            shots = List.toArray(held);
            updatedAt = now;
        })) {
            case (#ok(saved)) #ok(saved);
            case (#err(e)) #err(#Db(e));
        };
    };

    /// The id the author typed, without the row suffix used for uniqueness.
    /// Carried rows keep their qualifier ancestor's stored slug, so first walk
    /// back to that ancestor and remove the suffix derived from *its* id.
    public func chosenSlugOf(db : Ashroot.DB, row : Entry) : Text {
        var root = row;
        var hops = 0;
        while (root.week > QUALIFIERS and hops < FINAL) {
            let ?origin = root.origin_id else return root.slug;
            let ?source = db.entries.get(origin) else return root.slug;
            root := source;
            hops += 1;
        };
        let suffix = "_" # letters(root.id);
        switch (Text.stripEnd(root.slug, #text suffix)) {
            case (?chosen) chosen;
            // Defensive fallback for rows written before suffix finalisation.
            case null root.slug;
        };
    };

    /// Every qualifier/bracket copy that represents the same app identity.
    /// The season has six bounded rounds, so this is a small indexed walk and
    /// is shared by takedown, revision expiry, and approval cleanup.
    public func lineageEntries(db : Ashroot.DB, target : Entry) : [Entry] {
        let appSlug = chosenSlugOf(db, target);
        let rows = List.empty<Entry>();
        var week = 1;
        while (week <= FINAL) {
            for (row in slotsFor(db, target.season_id, week, target.user_id).vals()) {
                if (chosenSlugOf(db, row) == appSlug) List.add(rows, row);
            };
            week += 1;
        };
        List.toArray(rows);
    };

    /// Does this user already have a terminally removed lineage named by the
    /// chosen or stored slug? Used at both proposal and apply time.
    public func takenDownSlug(db : Ashroot.DB, seasonId : Nat64, userId : Nat64, slug : Text) : Bool {
        for (row in db.entries.byUser.rangeIter(
            { gt = null; gte = ?userId; lt = null; lte = ?userId; dir = #fwd },
            null,
        )) {
            if (
                row.season_id == seasonId
                and row.takedownAt != 0
                and (row.slug == slug or chosenSlugOf(db, row) == slug)
            ) return true;
        };
        false;
    };

    /// Long enough to name the work and the complaint, short enough that the
    /// notice on the entry stays readable where it is shown.
    public let MAX_TAKEDOWN_REASON = 500;

    /// One representation is used by quorum and by the published notice.
    public func canonicalTakedownReason(reason : Text) : Result.Result<Text, Error> {
        let canonical = Text.trimStart(Text.trimEnd(reason, #char ' '), #char ' ');
        if (canonical.size() == 0) return #err(#Invalid("say why"));
        if (canonical.size() > MAX_TAKEDOWN_REASON) {
            return #err(#Invalid("that reason is too long"));
        };
        #ok(canonical);
    };

    /// Empty an entry out, keeping the row.
    ///
    /// The counterpart of `Profiles.anonymize`, and for the same reason. Votes
    /// point at entries and payouts point at both, so deleting the row would
    /// leave a settled week that no longer adds up — a bracket with a box
    /// missing, or a reward with nothing to explain it. What the record needs
    /// is that something was there and who it belonged to; everything else can
    /// go, and does: title, blurb, links, art and the build.
    ///
    /// The vote count stays. It is the week's arithmetic, not the author's
    /// content, and every reader of a closed week depends on it.
    public func blank(db : Ashroot.DB, entryId : Nat64, now : Nat64) : Result.Result<Entry, Error> {
        let ?entry = db.entries.get(entryId) else return #err(#NotFound);
        switch (
            db.entries.update({
                entry with
                title = "Removed";
                summary = "";
                url = "";
                icon = null;
                shots = [];
                links = [];
                pkg = null;
                updates = [];
                updatedAt = now;
            })
        ) {
            case (#ok(saved)) #ok(saved);
            case (#err(e)) #err(#Db(e));
        };
    };

    /// Clone an entry into a later week, linking back to where it came from.
    /// A fresh row keeps each week's votes separate and the bracket traceable.
    func carry(db : Ashroot.DB, row : Entry, target : Nat, now : Nat64) : Result.Result<(), Error> {
        // Idempotent, and keyed on *this* source row rather than on the hacker.
        //
        // The guard is load-bearing: `closeWeek` can fail after marking
        // outcomes and carrying but before `save`, and `closeDueWeek` retries
        // five minutes later, so a second close of the same week is reachable.
        // But keyed on the hacker it also swallowed the legitimate second
        // carry of a double winner — "already here" was true of a *different*
        // seat. Keyed on the origin it means what it says: has this entry
        // already been carried?
        if (db.entries.bySlot.locate((row.season_id, target, row.user_id, row.id)) != null) {
            return #ok;
        };
        let clone : Ashroot.Types.CreateEntry = {
            season_id = row.season_id;
            user_id = row.user_id;
            week = target;
            title = row.title;
            summary = row.summary;
            url = row.url;
            icon = row.icon;
            shots = row.shots;
            links = row.links;
            pkg = row.pkg;
            slug = row.slug;
            // A takedown travels with the entry: carrying it forward must not
            // quietly restore content a moderator removed.
            takedownAt = row.takedownAt;
            takedownReason = row.takedownReason;
            updates = row.updates;
            votes = 0;
            outcome = #none;
            origin_id = ?row.id;
            createdAt = now;
            updatedAt = now;
        };
        switch (db.entries.insert(clone)) {
            case (#ok(_)) #ok;
            case (#err(e)) #err(#Db(e));
        };
    };

    // ── Entries ──────────────────────────────────────────────────────────────

    public type EntryInput = {
        title : Text;
        summary : Text;
        url : Text;
        /// Asset keys into the certified store, not blobs. A row only ever
        /// points at an image; the bytes live where every other file does.
        icon : ?Text;
        /// Up to `MAX_SHOTS`, in the order they should be shown.
        shots : [Text];
        links : [Link];
        /// The build. Not optional: an app is a `.neutron` package, and an
        /// entry without one is a description of software rather than
        /// software. Judges are voting on something they can install.
        pkg : PackageInput;
        /// The app's permanent id — `a-z` and `_`, 5 to 50 characters.
        ///
        /// Chosen once, at first submission, and never changed: it names the
        /// file people download, so changing it would break every link to a
        /// build that already exists. On an edit it must match what is already
        /// stored, which is checked rather than ignored — silently discarding
        /// a changed id would leave the author believing it had been renamed.
        slug : Text;
    };

    /// What a hacker types. The stored id is this plus a suffix — see `slugFor`
    /// — so the room for the suffix comes out of the published 50.
    public let SLUG_MIN = 5;
    public let SLUG_MAX = 40;

    /// The full stored id, including the suffix.
    public let SLUG_STORED_MAX = 50;

    /// `a-z` and `_` only.
    ///
    /// No digits, no capitals, no dots, no hyphens. It ends up as a filename
    /// on somebody's machine, so the narrow set is deliberate: nothing here can
    /// be read as a second extension, a path, or a lookalike of another app.
    public func validSlug(slug : Text) : Bool {
        if (slug.size() < SLUG_MIN or slug.size() > SLUG_MAX) return false;
        for (c in slug.chars()) {
            if (not ((c >= 'a' and c <= 'z') or c == '_')) return false;
        };
        true;
    };

    /// Everything about the id that needs the database to decide.
    ///
    /// Kept out of `checkEntry` because that one is deliberately pure — it is
    /// the shared predicate a proposal and an application both run, and it
    /// answers "is this input well formed" rather than "does the world allow
    /// it right now".
    public func checkSlug(
        db : Ashroot.DB,
        seasonId : Nat64,
        week : Nat,
        user : Profiles.User,
        slug : Text,
    ) : Result.Result<(), Error> {
        if (takenDownSlug(db, seasonId, user.id, slug)) {
            return #err(#Invalid("a taken-down app cannot be submitted again"));
        };
        // Editing: the id was set when the entry was created and does not
        // move. Refused rather than ignored — an author who believes they have
        // renamed their app, and has not, finds out from a broken link.
        //
        // Two forms are accepted, because half the id is the canister's doing.
        // The form round-trips the stored value (`cool_app_bd`); a script
        // naturally sends back the part its author typed (`cool_app`). Both
        // name the same app, so both are fine — and this stays exact by
        // *recomposing* the second rather than matching a prefix, which would
        // have let `cool` pass for `cool_app_bd`.
        switch (entryFor(db, seasonId, week, user.id)) {
            case (?existing) {
                if (existing.slug != slug and existing.slug != slugFor(slug, existing.id)) {
                    return #err(#Invalid("an app id cannot be changed once it is set"));
                };
                return #ok;
            };
            case null {};
        };
        // Nothing about who else holds what. Two hackers may both want
        // `cool_app` and both get it — `slugFor` gives them different stored
        // ids — so there is no contention to arbitrate, and the check that used
        // to be here could not have arbitrated it anyway. See `slugFor`.
        #ok;
    };

    /// The stored id: what the hacker chose, plus the entry's own number.
    ///
    /// **[decided]** The suffix is what makes the id unique, and it makes it
    /// unique *by construction* rather than by a check somebody has to
    /// remember to run. The check it replaces could not be made reliable: a
    /// pending revision is not an entry, so two hackers could both propose
    /// `cool_app` before either was approved, both pass a "is it taken?" test
    /// that had nothing to look at, and both land. Anything that only asks at
    /// proposal time has that hole, because the queue is exactly the gap
    /// between asking and writing.
    ///
    /// Row ids are assigned by the database and never reused, so `cool_app_bd`
    /// and `cool_app_be` are two different apps that both wanted to be called
    /// `cool_app`, and neither has to lose. A carried entry keeps the id it was
    /// cloned with — it is the same app in a later week, and the file people
    /// downloaded should not be renamed by winning.
    ///
    /// Base 26 rather than digits because the published alphabet is `a-z` and
    /// `_`; the id ends up as a filename, and widening the alphabet to carry a
    /// number would widen what can appear in a downloaded name.
    public func slugFor(chosen : Text, entryId : Nat64) : Text {
        chosen # "_" # letters(entryId);
    };

    /// A number in `a`-`z`, most significant first. `0` is `a`.
    func letters(n : Nat64) : Text {
        if (n == 0) return "a";
        let alphabet = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
                        "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"];
        var out = "";
        var x = n;
        while (x > 0) {
            out := alphabet[Nat64.toNat(x % 26)] # out;
            x /= 26;
        };
        out;
    };

    public type Link = { kind : Text; url : Text };

    public let MAX_SHOTS = 6;
    public let MAX_LINKS = 6;
    /// Enough to read the project's history without the row growing forever.
    public let MAX_UPDATES = 30;

    /// Submit or replace this week's entry. Hackers only, week must be open.
    public func submit(
        db : Ashroot.DB,
        caller : Principal,
        input : EntryInput,
        sizeOf : Text -> ?Nat,
        now : Nat64,
    ) : Result.Result<Entry, Error> {
        let ?season = running(db) else return #err(#NoSeason);
        // The bracket weeks are carried forward, never submitted into.
        if (season.week > QUALIFIERS or not roundOpen(season, now)) return #err(#WeekClosed);

        let ?user = Profiles.byPrincipal(db, caller) else return #err(#NotRegistered);
        if (not user.hacker) return #err(#NotAHacker);
        switch (checkEntry(input, Profiles.scope(user), sizeOf)) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };
        // `submit` is the direct path used by the ash suite; the displaced
        // keys are the review path's business, so they are dropped here.
        switch (applyEntry(db, user, input, sizeOf, now)) {
            case (#ok((entry, _))) #ok(entry);
            case (#err(e)) #err(e);
        };
    };

    /// Write an entry the way its author asked for, having already been
    /// checked. Called by `submit` and, once a moderator has agreed, by
    /// `Review.approve` — one writer, so an approved change and a direct one
    /// cannot diverge.
    public func applyEntry(
        db : Ashroot.DB,
        user : Profiles.User,
        input : EntryInput,
        sizeOf : Text -> ?Nat,
        now : Nat64,
    ) : Result.Result<(Entry, [Text]), Error> {
        let ?season = running(db) else return #err(#NoSeason);
        if (season.week > QUALIFIERS or not roundOpen(season, now)) return #err(#WeekClosed);
        if (takenDownSlug(db, season.id, user.id, input.slug)) {
            return #err(#Invalid("a taken-down app cannot be changed"));
        };
        switch (checkEntry(input, Profiles.scope(user), sizeOf)) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };
        // Rechecked at the authoritative write, not only when the revision was
        // proposed. A moderator may decide it later, after other rows changed.
        switch (checkEntryAssetReuse(db, season, user, input)) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };

        switch (entryFor(db, season.id, season.week, user.id)) {
            // Editing is free while the week is open; votes already cast stay.
            case (?existing) {
                let next = buildOf(input, Profiles.scope(user), sizeOf, existing.pkg, existing.slug, now);
                switch (
                    db.entries.update({
                        existing with
                        title = input.title;
                        summary = input.summary;
                        url = input.url;
                        icon = input.icon;
                        shots = input.shots;
                        links = input.links;
                        pkg = next;
                        updatedAt = now;
                    })
                ) {
                    case (#ok(saved)) #ok((saved, displaced(existing, saved)));
                    case (#err(e)) #err(#Db(e));
                };
            };
            case null {
                if (countWeek(db, season.id, season.week) >= MAX_QUALIFIER_ENTRIES) {
                    return #err(#Invalid("this qualifier week has reached its 1,000-entry limit"));
                };
                let row : Ashroot.Types.CreateEntry = {
                    season_id = season.id;
                    user_id = user.id;
                    week = season.week;
                    title = input.title;
                    summary = input.summary;
                    url = input.url;
                    icon = input.icon;
                    shots = input.shots;
                    links = input.links;
                    pkg = buildOf(input, Profiles.scope(user), sizeOf, null, input.slug, now);
                    slug = input.slug;
                    takedownAt = 0;
                    takedownReason = "";
                    updates = [];
                    votes = 0;
                    outcome = #none;
                    origin_id = null;
                    createdAt = now;
                    updatedAt = now;
                };
                switch (db.entries.insert(row)) {
                    case (#err(e)) #err(#Db(e));
                    case (#ok(pk)) {
                        let ?saved = db.entries.get(pk) else return #err(#NotFound);
                        // The id is only knowable once the row exists, so it is
                        // written in a second pass. The package is renamed with
                        // it: the two are the same fact, and letting them drift
                        // is how an app ends up called one thing and
                        // downloading as another.
                        let id = slugFor(input.slug, saved.id);
                        let named = switch (saved.pkg) {
                            case (?was) ?{ was with name = id # PKG_EXT };
                            case null null;
                        };
                        switch (db.entries.update({ saved with slug = id; pkg = named })) {
                            case (#ok(final)) #ok((final, []));
                            // The insert above already succeeded.  Trap so the
                            // message rolls both writes back instead of leaving
                            // a provisional slug that later approvals collide
                            // with.
                            case (#err(_)) Runtime.trap("could not finalize an inserted entry");
                        };
                    };
                };
            };
        };
    };

    /// `scope` is the submitter's own asset namespace, `/u/<id>/`.
    ///
    /// Keyed on the **user id**, which the canister assigns and never changes.
    /// Not the handle: a handle can be edited, and a namespace that moved when
    /// somebody renamed themselves would strand every key already stored.
    public func checkEntry(
        input : EntryInput,
        scope : Text,
        sizeOf : Text -> ?Nat,
    ) : Result.Result<(), Error> {
        if (not validSlug(input.slug)) {
            return #err(#Invalid(
                "the app id is " # Nat.toText(SLUG_MIN) # " to " # Nat.toText(SLUG_MAX)
                # " characters of a-z and _"
            ));
        };
        if (input.title.size() == 0) return #err(#Invalid("a title is required"));
        if (input.title.size() > 80) return #err(#Invalid("title is too long"));
        if (input.summary.size() > 600) return #err(#Invalid("summary is too long"));
        if (input.url.size() > 256) return #err(#Invalid("url is too long"));
        if (input.url != "") {
            let https = Text.startsWith(input.url, #text "https://");
            let http = Text.startsWith(input.url, #text "http://");
            if (not (https or http)) return #err(#Invalid("url must be http(s)"));
        };
        // Images must be the submitter's own uploads. Without this an entry
        // could display somebody else's file as its own, or point at a path
        // that was never uploaded at all.
        switch (input.icon) {
            case (?key) {
                switch (checkKey(key, scope, "icon", "icon")) {
                    case (#err(e)) return #err(e);
                    case (#ok) {};
                };
            };
            case null {};
        };
        switch (checkKey(input.pkg.key, scope, "package", "pkg")) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };
        let ?_ = packageName(input.pkg.key, scope) else {
            return #err(#Invalid("a package is " # scope # "pkg/<digits>" # PKG_EXT));
        };
        // The build has to be there, and it has to be a build. Read, never
        // taken — the same rule a version's package goes through.
        let ?size = sizeOf(input.pkg.key) else return #err(#Invalid("no finished upload at that key"));
        if (size == 0) return #err(#Invalid("the package is empty"));
        if (input.shots.size() > MAX_SHOTS) return #err(#Invalid("too many screenshots"));
        for (shot in input.shots.vals()) {
            switch (checkKey(shot, scope, "screenshot", "shots")) {
                case (#err(e)) return #err(e);
                case (#ok) {};
            };
        };
        if (input.links.size() > MAX_LINKS) return #err(#Invalid("too many links"));
        for (link in input.links.vals()) {
            if (link.url.size() == 0) return #err(#Invalid("a link needs a url"));
            if (link.url.size() > 256) return #err(#Invalid("link url is too long"));
            if (link.kind.size() > 24) return #err(#Invalid("link label is too long"));
            let https = Text.startsWith(link.url, #text "https://");
            let http = Text.startsWith(link.url, #text "http://");
            if (not (https or http)) return #err(#Invalid("links must be http(s)"));
        };
        #ok;
    };

    /// One asset key: the owner's own, in the folder it claims, not absurd.
    ///
    /// `folder` is not decoration. Without it an entry's icon could name a
    /// 1.9 MB file in `pkg/` — uploaded legitimately under the package limit —
    /// and the published size table would mean nothing.
    func checkKey(key : Text, scope : Text, what : Text, folder : Text) : Result.Result<(), Error> {
        if (key.size() == 0) return #err(#Invalid("an empty " # what # " key"));
        if (not Assets.keyWithinLimit(key)) return #err(#Invalid(what # " key is too long"));
        // Two different mistakes, two different answers: somebody else's
        // namespace is not the same error as your own namespace, wrong folder.
        if (not Assets.inScope(key, ?scope)) {
            return #err(#Invalid(what # " must live under " # scope));
        };
        // Package filename validation immediately follows this folder check
        // and gives the useful `<digits>.neutron` error. Keep that distinction
        // while images use `ownedKey`'s exact browser-stable grammar here.
        let inNamedPackageFolder = folder == "pkg" and Assets.folderOf(key, scope) == ?"pkg";
        if (not Assets.ownedKey(key, scope, folder) and not inNamedPackageFolder) {
            return #err(#Invalid(what # " must live under " # scope # folder # "/"));
        };
        #ok;
    };

    // ── Versions and the changelog ───────────────────────────────────────────

    /// Only the key. The name and the size used to come with it, and both were
    /// simply believed — a three-byte file could declare itself 1.9 MB, and the
    /// changelog would say so.
    public type PackageInput = { key : Text };

    /// What a package key has to look like: `/u/<id>/pkg/<digits>.neutron`.
    ///
    /// The browser names a download from the last segment of the path, so an
    /// unconstrained key means an unconstrained filename — somebody could ship
    /// a build that saves as `setup.exe`. The name is therefore ours, not the
    /// uploader's: digits they choose (a timestamp, so replacing a build is
    /// visible past a cache) and an extension they do not.
    public let PKG_EXT = ".neutron";

    func packageName(key : Text, scope : Text) : ?Text {
        // `stripStart`/`stripEnd`, never the `trim` pair: those strip a pattern
        // *repeatedly*, which is how `1234.neutron.neutron` was getting through
        // — the tail was trimmed twice and the stem read as digits.
        let ?name = Text.stripStart(key, #text(scope # "pkg/")) else return null;
        let ?stem = Text.stripEnd(name, #text PKG_EXT) else return null;
        if (stem.size() == 0 or stem.size() > 32) return null;
        // Digits only: no slashes, no dots, no second extension, nothing that
        // renders as anything but a number followed by `.neutron`.
        for (c in stem.chars()) {
            if (c < '0' or c > '9') return null;
        };
        ?name;
    };

    public type UpdateInput = {
        version : Text;
        note : Text;
        /// Omitted for a note with no new build behind it.
        pkg : ?PackageInput;
    };

    /// Resolve the exact current seat an author selected for a version.
    ///
    /// Looking up the id is not enough: approval can happen after the round or
    /// row has moved. Every authoritative write repeats ownership, season,
    /// week, current-seat and takedown checks and never falls back to seat zero.
    public func versionTarget(
        db : Ashroot.DB,
        user : Profiles.User,
        entryId : Nat64,
    ) : Result.Result<Entry, Error> {
        let ?season = running(db) else return #err(#NoSeason);
        let ?candidate = db.entries.get(entryId) else return #err(#NotFound);
        if (
            candidate.user_id != user.id
            or candidate.season_id != season.id
            or candidate.week != season.week
        ) return #err(#NotFound);

        var current = false;
        for (held in slotsFor(db, season.id, season.week, user.id).vals()) {
            if (held.id == candidate.id) current := true;
        };
        if (not current) return #err(#NotFound);
        if (candidate.takedownAt != 0) {
            return #err(#Invalid("a taken-down app cannot be changed"));
        };
        #ok(candidate);
    };

    /// Publish an update against the caller's entry in the open week.
    ///
    /// One call for both halves of the same event: a new `.neutron` replaces
    /// the old one and the note explaining it lands in the changelog together,
    /// so a version can never appear with no record of what changed.
    ///
    /// Returns the key of the package this replaced, if any — the actor deletes
    /// that asset, which this module cannot do because it has no asset store.
    /// `sizeOf` reports a stored asset's real byte count, or null if there is
    /// no complete asset under that key. Supplied by the actor, which owns the
    /// asset store; this module owns the row.
    public func publishUpdate(
        db : Ashroot.DB,
        caller : Principal,
        entryId : Nat64,
        input : UpdateInput,
        sizeOf : Text -> ?Nat,
        now : Nat64,
    ) : Result.Result<(Entry, ?Text), Error> {
        let ?season = running(db) else return #err(#NoSeason);
        if (not roundOpen(season, now)) return #err(#WeekClosed);
        let ?user = Profiles.byPrincipal(db, caller) else return #err(#NotRegistered);
        // §8 gives editing to "the hacker who owns it". Submitting already
        // checks the role; publishing a version is the other way to edit an
        // entry, and it did not — so resigning left the entry writable.
        if (not user.hacker) return #err(#NotAHacker);
        let entry = switch (versionTarget(db, user, entryId)) {
            case (#ok(value)) value;
            case (#err(e)) return #err(e);
        };
        switch (checkVersion(user, entry, input, sizeOf)) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };
        switch (checkVersionAssetReuse(db, user, entry, input)) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };
        applyVersion(db, user, entryId, input, sizeOf, now);
    };

    /// The build record for an entry, measured now.
    ///
    /// `previous` is kept when the key has not moved, so re-titling an app
    /// does not restamp the build it already had.
    func buildOf(
        input : EntryInput,
        scope : Text,
        sizeOf : Text -> ?Nat,
        previous : ?Ashroot.Types.Entries.Entry.Pkg,
        /// The entry's own id. On a create it is provisional — the row does not
        /// exist yet, so the caller renames the package once it does.
        named : Text,
        now : Nat64,
    ) : ?Ashroot.Types.Entries.Entry.Pkg {
        switch (previous) {
            case (?had) if (had.key == input.pkg.key) return ?had;
            case null {};
        };
        let ?_ = packageName(input.pkg.key, scope) else return previous;
        let ?size = sizeOf(input.pkg.key) else return previous;
        // Named by the app, not by the upload key and **not by the input**.
        // The key is a number the uploader picked; the input's slug is what
        // they asked for, which on an edit is not necessarily what the entry is
        // called. Taking it from the input let an app whose id was `aaa` serve
        // its build as `bbb.neutron`: propose twice before either is approved,
        // and the second lands on the edit branch, which keeps the stored id
        // and rebuilt the package from the newer request. The entry's own slug
        // is the only version of this that cannot drift.
        ?{ key = input.pkg.key; name = named # PKG_EXT; size; version = "1"; at = now };
    };

    /// Everything a version has to satisfy before anyone acts on it.
    ///
    /// Separate from applying it so a hacker hears about a bad build the
    /// moment they propose it, rather than after a moderator has read it.
    public func checkVersion(
        user : Profiles.User,
        entry : Entry,
        input : UpdateInput,
        sizeOf : Text -> ?Nat,
    ) : Result.Result<(), Error> {
        if (entry.takedownAt != 0) return #err(#Invalid("a taken-down app cannot be changed"));
        let version = Text.trimStart(Text.trimEnd(input.version, #char ' '), #char ' ');
        let note = Text.trimStart(Text.trimEnd(input.note, #char ' '), #char ' ');
        if (version.size() == 0) return #err(#Invalid("a version is required"));
        if (version.size() > 24) return #err(#Invalid("version is too long"));
        if (note.size() == 0) return #err(#Invalid("say what changed"));
        if (note.size() > 500) return #err(#Invalid("note is too long"));
        if (entry.updates.size() >= MAX_UPDATES) return #err(#Invalid("too many updates"));
        switch (input.pkg) {
            case null #ok;
            case (?next) {
                let scope = Profiles.scope(user);
                switch (checkKey(next.key, scope, "package", "pkg")) {
                    case (#err(e)) return #err(e);
                    case (#ok) {};
                };
                let ?_ = packageName(next.key, scope) else {
                    return #err(#Invalid("a package is " # scope # "pkg/<digits>" # PKG_EXT));
                };
                let ?size = sizeOf(next.key) else return #err(#Invalid("no finished upload at that key"));
                if (size == 0) return #err(#Invalid("the package is empty"));
                #ok;
            };
        };
    };

    /// Write a version that has already been checked.
    public func applyVersion(
        db : Ashroot.DB,
        user : Profiles.User,
        entryId : Nat64,
        input : UpdateInput,
        sizeOf : Text -> ?Nat,
        now : Nat64,
    ) : Result.Result<(Entry, ?Text), Error> {
        let ?season = running(db) else return #err(#NoSeason);
        if (not roundOpen(season, now)) return #err(#WeekClosed);
        let entry = switch (versionTarget(db, user, entryId)) {
            case (#ok(value)) value;
            case (#err(e)) return #err(e);
        };
        switch (checkVersion(user, entry, input, sizeOf)) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };
        switch (checkVersionAssetReuse(db, user, entry, input)) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };

        let version = Text.trimStart(Text.trimEnd(input.version, #char ' '), #char ' ');
        let note = Text.trimStart(Text.trimEnd(input.note, #char ' '), #char ' ');
        if (version.size() == 0) return #err(#Invalid("a version is required"));
        if (version.size() > 24) return #err(#Invalid("version is too long"));
        if (note.size() == 0) return #err(#Invalid("say what changed"));
        if (note.size() > 500) return #err(#Invalid("note is too long"));
        if (entry.updates.size() >= MAX_UPDATES) return #err(#Invalid("too many updates"));

        let scope = Profiles.scope(user);
        let (pkg, replaced) = switch (input.pkg) {
            case null (entry.pkg, null);
            case (?next) {
                // Same rule as the images: the caller's own namespace or
                // nothing. An entry must not point at somebody else's upload.
                switch (checkKey(next.key, scope, "package", "pkg")) {
                    case (#err(e)) return #err(e);
                    case (#ok) {};
                };
                let ?_ = packageName(next.key, scope) else {
                    return #err(#Invalid("a package is " # scope # "pkg/<digits>" # PKG_EXT));
                };
                // The size is read, never taken. An uploaded file has one real
                // length and the asset store knows it.
                let ?size = sizeOf(next.key) else {
                    return #err(#Invalid("no finished upload at that key"));
                };
                if (size == 0) return #err(#Invalid("the package is empty"));
                let old = switch (entry.pkg) {
                    case (?before) if (before.key == next.key) null else ?before.key;
                    case null null;
                };
                // Named by the app, exactly as `buildOf` does on submission —
                // the two paths have to agree or shipping a new build silently
                // renames the download. The key is a number the uploader
                // chose; the app id is what somebody should end up with.
                (?{ key = next.key; name = entry.slug # PKG_EXT; size; version; at = now }, old);
            };
        };

        // What this update shipped, if anything — the history should record
        // the upload itself, not only the words written about it. Taken from
        // the row just built, so the changelog and the package agree.
        let upload = switch (pkg) {
            case (?just) if (input.pkg != null) ?{ name = just.name; size = just.size } else null;
            case null null;
        };

        // Newest first: the changelog is read from the top.
        let logged = Array.tabulate<Ashroot.Types.Entries.Entry.Updates.Element>(
            entry.updates.size() + 1,
            func(i) = if (i == 0) { { version; note; at = now; upload } } else entry.updates[i - 1],
        );

        switch (db.entries.update({ entry with pkg; updates = logged; updatedAt = now })) {
            case (#ok(saved)) #ok((saved, replaced));
            case (#err(e)) #err(#Db(e));
        };
    };

    // ── Voting ───────────────────────────────────────────────────────────────

    /// Cast one of a judge's two votes for the week.
    public func vote(
        db : Ashroot.DB,
        caller : Principal,
        entryId : Nat64,
        now : Nat64,
    ) : Result.Result<Entry, Error> {
        let ?season = running(db) else return #err(#NoSeason);
        let ?judge = Profiles.byPrincipal(db, caller) else return #err(#NotRegistered);
        if (judge.judgeStatus != #approved) return #err(#NotAJudge);

        let ?row = db.entries.get(entryId) else return #err(#NotFound);
        // Votes belong to the open week; anything else is already decided.
        if (row.season_id != season.id or row.week != season.week) return #err(#WeekClosed);
        // The timer normally closes the round first. Comparing the stored
        // deadline here as well removes the message-ordering edge at exactly
        // that instant: a late update cannot land merely because the timer's
        // own message is next in the queue.
        if (now >= season.weekEndsAt) return #err(#WeekClosed);
        // A judge who also hacks does not get to score themselves.
        if (row.user_id == judge.id) return #err(#OwnEntry);
        if (hasVoted(db, judge.id, entryId)) return #err(#AlreadyVoted);
        if (votesBy(db, judge.id, season.id, season.week) >= VOTES_PER_JUDGE) {
            return #err(#VoteLimit);
        };

        let ballot : Ashroot.Types.CreateVote = {
            entry_id = entryId;
            judge_id = judge.id;
            season_id = season.id;
            week = season.week;
            at = now;
        };
        switch (db.votes.insert(ballot)) {
            case (#err(e)) return #err(#Db(e));
            case (#ok(_)) {};
        };
        switch (bump(db, row, 1, now)) {
            case (#ok(saved)) #ok(saved);
            case (#err(_)) Runtime.trap("could not update the entry after recording a vote");
        };
    };

    /// Withdraw a vote so it can be re-cast, until the round's final hour.
    public func unvote(
        db : Ashroot.DB,
        caller : Principal,
        entryId : Nat64,
        now : Nat64,
    ) : Result.Result<Entry, Error> {
        let ?season = running(db) else return #err(#NoSeason);
        let ?judge = Profiles.byPrincipal(db, caller) else return #err(#NotRegistered);
        let ?row = db.entries.get(entryId) else return #err(#NotFound);
        if (row.season_id != season.id or row.week != season.week) return #err(#WeekClosed);
        if (now >= season.weekEndsAt) return #err(#WeekClosed);

        let ?pk = db.votes.byJudgeEntry.locate((judge.id, entryId)) else return #err(#NotFound);
        // Inclusive at the boundary: at exactly deadline minus one hour the
        // recorded ballot is final. `now < weekEndsAt` above makes the
        // subtraction safe and keeps a closed round's answer `#WeekClosed`.
        if (season.weekEndsAt - now <= VOTE_WITHDRAWAL_LOCK_NANOS) {
            return #err(#VoteLocked);
        };
        switch (db.votes.delete(pk)) {
            case (#err(e)) return #err(#Db(e));
            case (#ok) {};
        };
        switch (bump(db, row, -1, now)) {
            case (#ok(saved)) #ok(saved);
            case (#err(_)) Runtime.trap("could not update the entry after removing a vote");
        };
    };

    /// Keep the denormalised tally in step. It is what `byRank` indexes, so it
    /// has to move with every ballot.
    func bump(db : Ashroot.DB, row : Entry, delta : Int, now : Nat64) : Result.Result<Entry, Error> {
        let next = if (delta >= 0) row.votes + 1 else if (row.votes > 0) Nat.sub(row.votes, 1) else 0;
        switch (db.entries.update({ row with votes = next; updatedAt = now })) {
            case (#ok(saved)) #ok(saved);
            case (#err(e)) #err(#Db(e));
        };
    };

    public func setFunding(
        db : Ashroot.DB,
        seasonId : Nat64,
        attempts : Nat,
        failures : [FundingFailure],
        ready : Bool,
    ) : Result.Result<Season, Error> {
        let ?season = db.seasons.get(seasonId) else return #err(#NotFound);
        if (season.phase != #finished) return #err(#Invalid("funding can close only after the final"));
        let bounded = Array.tabulate<FundingFailure>(
            Nat.min(failures.size(), MAX_FUNDING_FAILURES),
            func(i) = failures[i],
        );
        save(db, {
            season with
            fundingReady = ready;
            fundingAttempts = attempts;
            fundingFailures = bounded;
        });
    };

    func save(db : Ashroot.DB, season : Season) : Result.Result<Season, Error> {
        switch (db.seasons.update(season)) {
            case (#ok(saved)) #ok(saved);
            case (#err(e)) #err(#Db(e));
        };
    };
};
