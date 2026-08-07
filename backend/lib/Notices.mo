/// Takedown notices, from anybody at all.
///
/// A hackathon that hosts other people's binaries and screenshots needs a way
/// to be told when one of them should not be there. The people who need that
/// channel are, by construction, **not participants** — a rights holder who
/// finds their artwork in somebody's entry has no account here and no reason
/// to make one. So this takes no registration, and the anonymous principal is
/// a perfectly good caller.
///
/// ## What that costs, and the limit that pays for it
///
/// An open write endpoint is an open invitation. Two things bound it:
///
/// * **500 characters.** Enough for what is wrong, which entry, and how to
///   reach you. Not enough to use this as storage.
/// * **Three an hour, per caller; 100 an hour globally.** The global window is
///   what keeps rotating principals from turning the legal-reporting channel
///   into an unbounded write path. Anonymous submitters also share one caller
///   bucket because they share one principal.
///
/// The window is stable, so an upgrade does not reopen it. A rate limit that
/// resets whenever the canister is upgraded is a rate limit whose schedule is
/// set by the party it is not protecting against.
///
/// ## What this deliberately does not do
///
/// It does not act. Filing a notice puts a row in a queue a moderator reads;
/// nothing is hidden, deleted or flagged automatically. An endpoint anyone can
/// call that takes content down is a censorship button with no lock on it.

import List "mo:core/List";
import Nat64 "mo:core/Nat64";
import Result "mo:core/Result";

import Ashroot "../.ashroot/lib";
import Profiles "./Profiles";

module {

    public type Notice = Ashroot.Types.Notice;
    public type State = Ashroot.Types.Notices.Notice.State;

    public type Error = {
        #Empty;
        #TooLong : Nat;
        /// Seconds until the next one is allowed.
        #TooSoon : Nat;
        #Full;
        #NotFound;
        #NotAllowed;
        #Db : Ashroot.Errors.Error;
    };

    public let MAX_BODY = 500;
    public let MAX_NOTICES = 10_000;
    public let PER_WINDOW = 3;
    public let GLOBAL_PER_WINDOW = 100;
    public let WINDOW : Nat64 = 3_600_000_000_000; // one hour, in nanoseconds
    public let COMPACT_PER_FILE = 200;

    /// File one. Open to anybody, including the anonymous principal.
    public func file(
        db : Ashroot.DB,
        reporter : Principal,
        body : Text,
        now : Nat64,
    ) : Result.Result<Notice, Error> {
        let trimmed = body;
        if (trimmed.size() == 0) return #err(#Empty);
        if (trimmed.size() > MAX_BODY) return #err(#TooLong(MAX_BODY));

        // Refuse rate-limited traffic before doing queue maintenance. A caller
        // cannot repeatedly trigger compaction after its per-caller or global
        // allowance is gone. Admissible calls still maintain the queue before
        // the physical-cap check so expired tombstones can reopen a full one.
        switch (waitFor(db, reporter, now)) {
            case (?seconds) return #err(#TooSoon(seconds));
            case null {};
        };
        switch (globalWaitFor(db, now)) {
            case (?seconds) return #err(#TooSoon(seconds));
            case null {};
        };

        compactResolved(db, now);
        if (db.notices.size() >= MAX_NOTICES) return #err(#Full);

        switch (
            db.notices.insert({
                reporter;
                body = trimmed;
                at = now;
                state = #fresh;
                handledBy = null;
                handledAt = 0;
            })
        ) {
            case (#err(e)) #err(#Db(e));
            case (#ok(pk)) {
                let ?saved = db.notices.get(pk) else return #err(#NotFound);
                #ok(saved);
            };
        };
    };

    /// Seconds this reporter must wait, or `null` if they may file now.
    ///
    /// A sliding window rather than a fixed one: fixed hours let somebody send
    /// three at 10:59 and three more at 11:00. This walks the reporter's own
    /// rows back from newest and stops as soon as one is older than the
    /// window, so the cost is the number that are *inside* it — at most three,
    /// by the rule it is enforcing.
    public func waitFor(db : Ashroot.DB, reporter : Principal, now : Nat64) : ?Nat {
        let recent = List.empty<Nat64>();
        label scan for (row in db.notices.byReporter.rangeIter(
            { gt = null; gte = ?reporter; lt = null; lte = ?reporter; dir = #bwd },
            null,
        )) {
            if (row.at + WINDOW <= now) break scan;
            List.add(recent, row.at);
            if (List.size(recent) >= PER_WINDOW) break scan;
        };
        if (List.size(recent) < PER_WINDOW) return null;
        // The oldest of the three still inside the window is the one whose
        // expiry frees a slot.
        var oldest : Nat64 = now;
        for (at in List.values(recent)) { if (at < oldest) oldest := at };
        let free = oldest + WINDOW;
        ?Nat64.toNat((if (free > now) free - now else 0) / 1_000_000_000);
    };

    /// Seconds until the whole service may admit another notice. Resolved rows
    /// remain as body-free tombstones for one window, so moderation cannot
    /// accidentally reset this Sybil-resistant limit by working the queue.
    public func globalWaitFor(db : Ashroot.DB, now : Nat64) : ?Nat {
        var count = 0;
        var oldest : Nat64 = now;
        label scan for (row in db.notices.byTime.rangeIter(
            { gt = null; gte = null; lt = null; lte = null; dir = #bwd },
            null,
        )) {
            if (row.at + WINDOW <= now) break scan;
            oldest := row.at;
            count += 1;
            if (count >= GLOBAL_PER_WINDOW) break scan;
        };
        if (count < GLOBAL_PER_WINDOW) return null;
        let free = oldest + WINDOW;
        ?Nat64.toNat((if (free > now) free - now else 0) / 1_000_000_000);
    };

    /// Reclaim old resolved tombstones a bounded batch at a time. Fresh rows
    /// are never removed automatically; they remain visible until a moderator
    /// makes a decision.
    func compactResolved(db : Ashroot.DB, now : Nat64) {
        let ids = List.empty<Nat64>();
        var scanned = 0;
        label scan for (row in db.notices.byTime.rangeIter(
            { gt = null; gte = null; lt = null; lte = null; dir = #fwd },
            null,
        )) {
            scanned += 1;
            if (row.at + WINDOW > now) break scan;
            if (row.state != #fresh) {
                List.add(ids, row.id);
            };
            if (scanned >= COMPACT_PER_FILE) break scan;
        };
        for (id in List.values(ids)) { ignore db.notices.delete(id) };
    };

    /// The queue a moderator reads: newest first.
    public func recent(db : Ashroot.DB, limit : Nat) : [Notice] {
        let out = List.empty<Notice>();
        label scan for (row in db.notices.byTime.rangeIter(
            { gt = null; gte = null; lt = null; lte = null; dir = #bwd },
            null,
        )) {
            if (List.size(out) >= limit) break scan;
            if (row.state == #fresh) List.add(out, row);
        };
        List.toArray(out);
    };

    public func pending(db : Ashroot.DB) : Nat {
        var n = 0;
        for (row in db.notices.byTime.rangeIter(
            { gt = null; gte = null; lt = null; lte = null; dir = #fwd },
            null,
        )) { if (row.state == #fresh) n += 1 };
        n;
    };

    /// A moderator marking one read, or read and not acted on.
    public func resolve(
        db : Ashroot.DB,
        by : Principal,
        id : Nat64,
        state : State,
        now : Nat64,
    ) : Result.Result<Notice, Error> {
        if (not Profiles.canModerate(db, by)) return #err(#NotAllowed);
        if (state == #fresh) return #err(#NotAllowed);
        let ?row = db.notices.get(id) else return #err(#NotFound);
        let who = switch (Profiles.byPrincipal(db, by)) {
            case (?user) ?user.id;
            // A controller has no profile row. Recorded as handled by nobody
            // rather than refused — see `Review.approve`, same situation.
            case null null;
        };
        let settled = { row with state; handledBy = who; handledAt = now };
        // Keep only a body-free one-hour admission tombstone. This preserves
        // the global rolling limit while removing attacker-controlled text and
        // the row disappears lazily after the window.
        switch (db.notices.update({ settled with body = "" })) {
            case (#ok(_)) #ok(settled);
            case (#err(e)) #err(#Db(e));
        };
    };

    public func describe(error : Error) : Text = switch (error) {
        case (#Empty) "say what the problem is";
        case (#TooLong(n)) "a notice is at most " # Nat64.toText(Nat64.fromNat(n)) # " characters";
        case (#TooSoon(s)) "too many notices — try again in " # Nat64.toText(Nat64.fromNat(s)) # " seconds";
        case (#Full) "the notice queue has reached its permanent storage limit";
        case (#NotFound) "no such notice";
        case (#NotAllowed) "not allowed";
        case (#Db(_)) "could not store that notice";
    };
};
