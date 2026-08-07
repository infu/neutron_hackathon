/// Paying the season out.
///
/// Two steps, deliberately separate: **draft** turns a finished season into a
/// frozen list of amounts, and a **transfer loop** works through that list.
/// Nobody approves it in between. While sealed, the canister is its own sole
/// controller and no external caller can invoke that authority, so an approval
/// step would be one nobody could perform. A prize pool that needed a
/// controller signature to move would be a prize pool nobody could collect.
///
/// ## The one property everything rests on
///
/// A payment must happen **at most once**, across interruptions, retries, and
/// a caller starting the loop twice. In Motoko every `await` is a commit
/// point: whatever was written before it survives even if the continuation
/// never runs. So each row is *claimed before the call goes out* and *settled
/// after it comes back*.
///
/// That alone is not enough — a claimed row whose outcome was never recorded
/// has to be retried, and a retry must not pay twice. So every argument is
/// **frozen when the plan is drafted**: amount, fee, and `created_at_time` are
/// stored on the row and never recomputed. Every attempt therefore sends
/// *byte-identical* arguments, and ICRC-1's own deduplication window collapses
/// them into one payment. A `#Duplicate` reply means the money already moved
/// and settles the row as paid.
///
/// The corollary is: **never re-stamp an outcome-unknown payment.** A
/// `#planned` row has received only definite rejections, so a later `#TooOld`
/// rejection proves that exact transfer did not land and it may safely receive
/// a current timestamp. A `#sending` row is never re-stamped.
///
/// ## Destination
///
/// Rewards go directly to the winner wallet frozen onto each drafted row.
/// There is no post-award custody or controller approval step: retries reuse
/// that exact destination and the exact same ICRC-1 deduplication arguments.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Nat8 "mo:core/Nat8";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";

import Ashroot "../.ashroot/lib";
import Profiles "./Profiles";
import Season "./Season";
import Treasury "./Treasury";

module {

    public type Payout = Ashroot.Types.Payout;
    public type State = Ashroot.Types.Payouts.Payout.State;
    public type Award = Ashroot.Types.Payouts.Payout.Award;
    public type Phase = Ashroot.Types.Seasons.Season.Payout;

    public type Error = {
        #NotAllowed;
        #NoSeason;
        #NotFinished;
        #WrongPhase : Text;
        #Empty;
        #Db : Ashroot.Errors.Error;
    };

    /// Relative weights, in basis points of one award each. The published
    /// split (rules.md §7) is bronze 2.5%, silver 20%, gold 35% — those are
    /// the *ratios* between awards, and they only sum to 100% of the pool when
    /// the field is full.
    public let BRONZE_BP = 250;
    public let SILVER_BP = 2_000;
    public let GOLD_BP = 3_500;

    public func weightOf(award : Award) : Nat = switch (award) {
        case (#bronze) BRONZE_BP;
        case (#silver) SILVER_BP;
        case (#gold) GOLD_BP;
    };

    // ── Who is owed what ─────────────────────────────────────────────────────

    /// The best award **one app** took, and the entry row that earned it.
    ///
    /// A project that wins the final also holds a silver and a bronze from the
    /// rounds below. rules.md §7 pays the highest finish only, so a lineage's
    /// several rows collapse to one claim.
    ///
    /// **[decided]** The collapse is per app, not per hacker. §7's subject is
    /// "a project climbing the bracket", and its arithmetic assumes it: 20
    /// bronzes handed out and 18 paid subtracts only the two that reached the
    /// final. Collapsing per person instead — which this used to do — quietly
    /// underpaid anyone who fielded two different apps, paying one bronze for
    /// two separate wins in two separate weeks. Nothing in the format says a
    /// hacker may enter only once, so nothing should say they may only be paid
    /// once.
    ///
    /// An app is `(owner, chosen slug)`, not the stored entry slug. The stored
    /// form carries an entry-id suffix for database uniqueness, so using it as
    /// the reward identity would let the same chosen app become a fresh claim
    /// merely by entering another qualifier. Carried rows are first walked back
    /// to their qualifier root, then that root's generated suffix is removed.
    type Best = { entryId : Nat64; award : Award };

    func better(found : Best, have : Best) : Bool = weightOf(found.award) > weightOf(have.award);

    public type Claim = {
        userId : Nat64;
        entryId : Nat64;
        award : Award;
        weight : Nat;
        to : Principal;
    };

    /// Every award owed, one row per winning app, highest finish only.
    ///
    /// Two people who placed are still left out, and both exclusions matter to
    /// the arithmetic rather than being tidiness:
    ///
    /// * **Opted out.** `shares` normalises over the weight actually present,
    ///   so dropping the claim here means their share is divided among
    ///   everybody else rather than stranded in the treasury. That is what
    ///   opting out is *for*; leaving the claim in and skipping the transfer
    ///   would burn the money instead of redistributing it.
    /// * **No wallet.** There is nowhere to send it. A hacker cannot submit
    ///   without one, so this is the rare case of an account that was cleared
    ///   afterwards — and a row with no destination is one that can only ever
    ///   fail, retried on every pass for a day.
    public func claims(db : Ashroot.DB, seasonId : Nat64) : [Claim] {
        // One pass, grouped by the author's canonical app identity. The owner
        // remains part of the key because two people may deliberately choose
        // the same public slug and still own different apps.
        let seen = List.empty<(Nat64, Text, Best)>();

        for (entry in db.entries.bySeason.rangeIter(
            { gt = null; gte = ?seasonId; lt = null; lte = ?seasonId; dir = #fwd },
            null,
        )) {
            let award : ?Award = switch (Season.awardOf(entry)) {
                case (?#bronze) ?#bronze;
                case (?#silver) ?#silver;
                case (?#gold) ?#gold;
                case null null;
            };
            switch (award) {
                case null {};
                case (?won) {
                    let found = { entryId = entry.id; award = won };
                    let chosen = chosenAppSlug(db, entry);
                    var at : ?Nat = null;
                    var i = 0;
                    for ((owner, slug, _) in List.values(seen)) {
                        if (owner == entry.user_id and slug == chosen) at := ?i;
                        i += 1;
                    };
                    switch (at) {
                        case null List.add(seen, (entry.user_id, chosen, found));
                        case (?index) {
                            switch (List.get(seen, index)) {
                                case (?(owner, slug, have)) {
                                    if (better(found, have)) {
                                        List.put(seen, index, (owner, slug, found));
                                    };
                                };
                                case null {};
                            };
                        };
                    };
                };
            };
        };

        let out = List.empty<Claim>();
        for ((owner, _, best) in List.values(seen)) {
            switch (db.users.get(owner)) {
                case (?user) {
                    switch (user.wallet) {
                        case (?to) {
                            if (not user.rewardOptOut) {
                                List.add(out, {
                                    userId = owner;
                                    entryId = best.entryId;
                                    award = best.award;
                                    weight = weightOf(best.award);
                                    to;
                                });
                            };
                        };
                        case null {};
                    };
                };
                case null {};
            };
        };
        List.toArray(out);
    };

    /// The app id the author chose, without the storage suffix. This mirrors
    /// Season's takedown identity: follow carried rows to their qualifier root,
    /// then use the public `slugFor` function to reconstruct only the suffix
    /// generated for that root. A malformed legacy row falls back to its stored
    /// slug rather than being merged on a prefix guess.
    func chosenAppSlug(db : Ashroot.DB, row : Season.Entry) : Text {
        var root = row;
        var hops = 0;
        while (root.week > Season.QUALIFIERS and hops < Season.FINAL) {
            let ?origin = root.origin_id else return root.slug;
            let ?source = db.entries.get(origin) else return root.slug;
            root := source;
            hops += 1;
        };
        let suffix = Season.slugFor("", root.id);
        switch (Text.stripEnd(root.slug, #text suffix)) {
            case (?chosen) chosen;
            case null root.slug;
        };
    };

    /// Split `pool` between claims in proportion to their weights.
    ///
    /// **Normalised over who actually won**, not over the published
    /// percentages. A thin season — two entrants, or a week nobody entered —
    /// produces fewer awards than the format assumes, and fixed percentages
    /// would strand most of the pool in the treasury. Dividing by the weight
    /// actually present pays the whole pool out however few turned up, and
    /// reduces to the published split exactly when the field is full.
    ///
    /// Integer division leaves a remainder of at most `claims.size() - 1`
    /// units, and this function does **not** account for it — the shares it
    /// returns sum to slightly less than `pool`. Deciding where the remainder
    /// goes is `plan`'s job, because the answer depends on the fee, which is
    /// per ledger and not visible here: it rides on the largest payable share,
    /// which is the one row that cannot fall under its own fee and be skipped.
    public func shares(pool : Nat, entries : [Claim]) : [Nat] {
        var total = 0;
        for (claim in entries.vals()) { total += claim.weight };
        if (total == 0) return Array.map<Claim, Nat>(entries, func(_) = 0);
        Array.map<Claim, Nat>(entries, func(claim) = pool * claim.weight / total);
    };

    // ── Drafting ─────────────────────────────────────────────────────────────

    /// What one ledger's pool is worth and who it goes to.
    public type Line = {
        userId : Nat64;
        /// The entry whose award this line pays. Part of the payout row's
        /// unique key, because one hacker may hold two winning apps.
        entryId : Nat64;
        award : Award;
        ledger : Principal;
        gross : Nat;
        /// Frozen here and never read from the user row again — see
        /// `Season.settling`. A destination that can move between attempts is
        /// a destination that defeats the ledger's deduplication.
        to : Principal;
        /// What this row carries on top of its own share so the pool lands on
        /// zero. Nonzero on exactly one row per ledger.
        dust : Nat;
    };

    /// Turn balances into a plan.
    ///
    /// The caller supplies the pool per ledger, having read it from each
    /// ledger; this module does no I/O so it can be tested without one.
    public func plan(
        db : Ashroot.DB,
        seasonId : Nat64,
        pools : [(Principal, Nat)],
        fees : [(Principal, Nat)],
    ) : [Line] {
        let who = claims(db, seasonId);
        let out = List.empty<Line>();
        for ((ledger, pool) in pools.vals()) {
            let cut = shares(pool, who);
            let fee = feeFor(fees, ledger);

            // **[decided]** No dust. Integer division leaves up to `n - 1`
            // units unspent, and a share too small to cover its own fee leaves
            // its whole share unspent — so a treasury that has "paid out"
            // still holds something, every season, forever.
            //
            // One row per ledger carries the remainder. Which row is decided
            // *here*, at drafting, and never at send time: processing order is
            // not stable across retries, and choosing a carrier later would
            // mean recomputing an amount on a frozen plan, which is the exact
            // thing that makes a retry pay twice.
            //
            // The carrier is the largest payable share, ties to the lowest
            // user id and then the lowest entry id — a hacker with two winning
            // apps has two rows under one user id, so the user id alone stopped
            // being a total order. Largest because it is the row that cannot
            // fall under the fee
            // — put the dust on the smallest and it is the one most likely to
            // be skipped, stranding the remainder on a row that never sends.
            // In an ordinary season that is the grand-prize winner.
            var carrier : ?Nat = null;
            var payable = 0;
            var i = 0;
            while (i < who.size()) {
                if (cut[i] > fee) {
                    payable += cut[i];
                    let better = switch (carrier) {
                        case null true;
                        case (?c) {
                            cut[i] > cut[c] or (
                                cut[i] == cut[c] and (
                                    who[i].userId < who[c].userId or (
                                        who[i].userId == who[c].userId and who[i].entryId < who[c].entryId
                                    )
                                )
                            );
                        };
                    };
                    if (better) carrier := ?i;
                };
                i += 1;
            };

            // Nothing here is worth a transfer. Written as skipped rather than
            // silently dropped, so the plan says why the pool did not move.
            let remainder = switch (carrier) {
                case null 0;
                case (?_) Nat.sub(pool, payable);
            };

            i := 0;
            while (i < who.size()) {
                let carries = carrier == ?i;
                // A share under the fee keeps its own gross for the record but
                // is never sent, so it must not be counted as spent.
                if (cut[i] > 0 or carries) {
                    List.add(out, {
                        userId = who[i].userId;
                        entryId = who[i].entryId;
                        award = who[i].award;
                        ledger;
                        gross = if (carries) cut[i] + remainder else cut[i];
                        to = who[i].to;
                        dust = if (carries) remainder else 0;
                    });
                };
                i += 1;
            };
        };
        List.toArray(out);
    };

    /// Write the plan down, frozen, ready for the transfer loop.
    ///
    /// `fee` is the ledger's fee at drafting time and is frozen onto every row
    /// with it: the payee receives `gross - fee`, so the treasury is debited
    /// exactly `gross` and the sum of the plan is affordable by construction.
    /// A share too small to cover its own fee is written as `#skipped` rather
    /// than attempted — a transfer that cannot succeed should not be retried
    /// forever.
    public func draft(
        db : Ashroot.DB,
        seasonId : Nat64,
        pools : [(Principal, Nat)],
        fees : [(Principal, Nat)],
        now : Nat64,
    ) : Result.Result<Nat, Error> {
        draftReconciled(db, seasonId, pools, fees, [], now);
    };

    /// Final-reconciliation draft. `excluded` contains only ledgers whose
    /// central treasury balance/fee could not be observed in the final full
    /// pass—not sponsor deposit-pair failures whose central pool did answer.
    public func draftReconciled(
        db : Ashroot.DB,
        seasonId : Nat64,
        pools : [(Principal, Nat)],
        fees : [(Principal, Nat)],
        excluded : [Principal],
        now : Nat64,
    ) : Result.Result<Nat, Error> {
        let ?season = db.seasons.get(seasonId) else return #err(#NoSeason);
        if (season.phase != #finished) return #err(#NotFinished);
        if (season.payout != #none) {
            return #err(#WrongPhase("a payout has already been drafted"));
        };

        // Defensive boundary: callers may only draft from a duplicate-free
        // observation of the immutable sponsor-ledger set. An omitted ledger
        // must be in the cutoff's internal central-snapshot exclusion set;
        // pair-level failures alone never authorize silently stranding a pool.
        let ledgers = Treasury.ledgersInPlay(db);
        if (not completeObservation(ledgers, excluded, season.fundingFailures, pools, fees)) {
            return #err(#WrongPhase("the prize-pool ledger observation is incomplete"));
        };

        let lines = plan(db, seasonId, pools, fees);
        if (lines.size() == 0) return #err(#Empty);

        var written = 0;
        label planning for (line in lines.vals()) {
            // Defensive idempotence within the initial draft. Once a season is
            // approved—or reaches terminal #failed—it can never be redrafted.
            // A settled row is therefore never rewritten or re-sent.
            if (db.payouts.bySlot.locate((seasonId, line.userId, line.ledger, line.entryId)) != null) {
                continue planning;
            };
            let fee = feeFor(fees, line.ledger);
            let state : State = if (line.gross <= fee) #skipped else #planned;
            let note = if (line.gross <= fee) "share does not cover the transfer fee" else "";
            let row : Ashroot.Types.CreatePayout = {
                season_id = seasonId;
                user_id = line.userId;
                entry_id = line.entryId;
                ledger = line.ledger;
                gross = line.gross;
                fee;
                net = if (line.gross <= fee) 0 else line.gross - fee;
                // The dedup nonce. Frozen across every ambiguous attempt. A
                // still-planned row may refresh it only after the ledger
                // definitely rejects the old timestamp as TooOld.
                createdAtTime = now;
                state;
                attempts = 0;
                note = if (line.dust > 0 and state == #planned) {
                    "carries the remainder of the pool";
                } else note;
                award = line.award;
                to = line.to;
                dust = line.dust;
                // Filled in by the ledger when the transfer lands.
                block = null;
            };
            switch (db.payouts.insert(row)) {
                case (#ok(_)) written += 1;
                case (#err(e)) {
                    if (written > 0) Runtime.trap("could not finish writing the payout plan");
                    return #err(#Db(e));
                };
            };
        };

        // **[decided]** Drafted is approved. There is no human or DAO sign-off
        // between the plan and the money. While sealed no external caller can
        // invoke controller authority, and recovery must not be required for a
        // normal payout, so a controller-gated approval would be an unsafe
        // availability dependency.
        //
        // What replaces the signature is that the plan is not a judgement
        // call. Every number in it is derived: the pools are read off the
        // ledgers, the split is `rules.md` §7 arithmetic over who placed, and
        // the destinations are wallets their owners set. `payout_plan` remains
        // readable by anyone, so it is auditable — just not blockable.
        switch (db.seasons.update({ season with payout = #approved })) {
            case (#ok(_)) #ok(written);
            case (#err(e)) {
                if (written > 0) Runtime.trap("could not approve the payout plan after writing its rows");
                #err(#Db(e));
            };
        };
    };

    /// Close a reconciled season for which there is no transferable line.
    ///
    /// Called synchronously after `draft` returns `#Empty`, in the same actor
    /// continuation that persists fundingReady. An empty healthy pool is paid
    /// (there was nothing to move); an omitted failed ledger makes the season
    /// explicitly failed. Either way `fundingReady + #none` is never committed.
    public func finishEmpty(db : Ashroot.DB, seasonId : Nat64) : Result.Result<Progress, Error> {
        let ?season = db.seasons.get(seasonId) else return #err(#NoSeason);
        if (season.phase != #finished) return #err(#NotFinished);
        if (season.payout != #none) {
            return #err(#WrongPhase("a payout result already exists"));
        };
        let progress = progressOf(db, seasonId);
        if (progress.paid + progress.failed + progress.skipped + progress.left != 0) {
            return #err(#WrongPhase("an empty payout cannot contain rows"));
        };
        let next : Phase = if (season.fundingFailures.size() > 0) #failed else #paid;
        switch (db.seasons.update({ season with payout = next })) {
            case (#ok(_)) #ok(progress);
            case (#err(e)) #err(#Db(e));
        };
    };

    func completeObservation(
        ledgers : [Principal],
        excluded : [Principal],
        failures : [Season.FundingFailure],
        pools : [(Principal, Nat)],
        fees : [(Principal, Nat)],
    ) : Bool {
        if (pools.size() != fees.size()) return false;
        for (ledger in ledgers.vals()) {
            var poolSeen = 0;
            var feeSeen = 0;
            for ((id, _) in pools.vals()) {
                if (id == ledger) poolSeen += 1;
            };
            for ((id, _) in fees.vals()) {
                if (id == ledger) feeSeen += 1;
            };
            let excludedCount = countLedger(excluded, ledger);
            if (poolSeen == 1 and feeSeen == 1 and excludedCount == 0) {
                // Complete observation for this ledger.
            } else if (poolSeen == 0 and feeSeen == 0 and excludedCount == 1) {
                // Central snapshot explicitly failed in the final full pass.
            } else return false;
        };
        // The loops above reject missing/duplicate expected ledgers. This one
        // rejects an injected tuple for a principal outside the frozen set.
        for ((id, _) in pools.vals()) {
            if (not containsLedger(ledgers, id)) return false;
        };
        for ((id, _) in fees.vals()) {
            if (not containsLedger(ledgers, id)) return false;
        };
        for (id in excluded.vals()) {
            if (not containsLedger(ledgers, id) or not fundingFailed(failures, id)) return false;
        };
        true;
    };

    func containsLedger(ledgers : [Principal], ledger : Principal) : Bool {
        for (known in ledgers.vals()) { if (known == ledger) return true };
        false;
    };

    func countLedger(ledgers : [Principal], ledger : Principal) : Nat {
        var count = 0;
        for (known in ledgers.vals()) {
            if (known == ledger) count += 1;
        };
        count;
    };

    func fundingFailed(failures : [Season.FundingFailure], ledger : Principal) : Bool {
        for (failure in failures.vals()) {
            if (failure.ledger == ledger) return true;
        };
        false;
    };

    func feeFor(fees : [(Principal, Nat)], ledger : Principal) : Nat {
        for ((id, fee) in fees.vals()) { if (id == ledger) return fee };
        0;
    };

    /// Everything drafted for a season.
    public func forSeason(db : Ashroot.DB, seasonId : Nat64) : [Payout] {
        let out = List.empty<Payout>();
        for (row in db.payouts.bySeason.rangeIter(
            { gt = null; gte = ?seasonId; lt = null; lte = ?seasonId; dir = #fwd },
            null,
        )) { List.add(out, row) };
        List.toArray(out);
    };

    public func forUser(db : Ashroot.DB, userId : Nat64) : [Payout] {
        let out = List.empty<Payout>();
        for (row in db.payouts.byUser.rangeIter(
            { gt = null; gte = ?userId; lt = null; lte = ?userId; dir = #fwd },
            null,
        )) { List.add(out, row) };
        List.toArray(out);
    };

    /// Has this person ever been paid on this ledger?
    ///
    /// The allowlist for `withdraw`, and deliberately per-person rather than
    /// global. `withdraw` has to call a ledger, so something must bound which —
    /// but bounding it by "a ledger some approved sponsor currently pledges"
    /// makes a winner's access to their own money contingent on a sponsor
    /// staying, and a sponsor can leave on their own. This is the durable
    /// version of the same claim: the canister has already moved this token to
    /// this person, so calling that ledger for them again is nothing new.
    ///
    /// Only `draft` writes these rows, and drafting is moderator-gated — so
    /// unlike the pledge list, a caller cannot widen their own allowlist.
    public func owed(db : Ashroot.DB, userId : Nat64, ledger : Principal) : Bool {
        for (row in db.payouts.byUser.rangeIter(
            { gt = null; gte = ?userId; lt = null; lte = ?userId; dir = #fwd },
            null,
        )) { if (row.ledger == ledger) return true };
        false;
    };

    // ── Approval ─────────────────────────────────────────────────────────────

    // `approve` and `discard` used to live here. Both required the season's
    // payout phase to be `#proposed`, and `draft` no longer produces that — it
    // writes `#approved` directly, because a sealed canister has no controller
    // left to sign anything off. A method that can only ever answer
    // `#WrongPhase` is worse than no method: it advertises a capability that
    // does not exist.

    // ── Sending ──────────────────────────────────────────────────────────────

    /// Where a run has got to.
    public type Progress = { paid : Nat; left : Nat; failed : Nat; skipped : Nat };

    /// Attempts at each unsent row before this call gives up and waits.
    ///
    /// Three, and three is the right shape for what it protects against: a
    /// ledger that is momentarily busy, a call that was dropped, a reply that
    /// was lost. Anything still failing after three immediate tries is failing
    /// for a reason a fourth will not fix either, which is what the hourly wait
    /// is for.
    ///
    /// Retrying costs nothing when it is unnecessary: every attempt sends
    /// byte-identical arguments, so a ledger that already applied one answers
    /// `#Duplicate` and the row settles as paid.
    public let PASSES : Nat = 3;

    public func run(
        db : Ashroot.DB,
        seasonId : Nat64,
        canister : Principal,
        ledgerFor : Principal -> Treasury.LedgerApi,
    ) : async* Result.Result<Progress, Error> {
        await* runWhile(db, seasonId, canister, ledgerFor, func() = true);
    };

    /// Actor-level automation supplies an ownership check. Unit/module callers
    /// retain the always-owned wrapper above. A reclaimed continuation may
    /// record proof that an already-sent row was paid, but it cannot start a
    /// later row or settle the aggregate season.
    public func runWhile(
        db : Ashroot.DB,
        seasonId : Nat64,
        canister : Principal,
        ledgerFor : Principal -> Treasury.LedgerApi,
        stillOwned : () -> Bool,
    ) : async* Result.Result<Progress, Error> {
        await* runPassesWhile(db, seasonId, canister, ledgerFor, PASSES, stillOwned);
    };

    public func runPasses(
        db : Ashroot.DB,
        seasonId : Nat64,
        canister : Principal,
        ledgerFor : Principal -> Treasury.LedgerApi,
        passes : Nat,
    ) : async* Result.Result<Progress, Error> {
        await* runPassesWhile(db, seasonId, canister, ledgerFor, passes, func() = true);
    };

    public func runPassesWhile(
        db : Ashroot.DB,
        seasonId : Nat64,
        canister : Principal,
        ledgerFor : Principal -> Treasury.LedgerApi,
        passes : Nat,
        stillOwned : () -> Bool,
    ) : async* Result.Result<Progress, Error> {
        let ?season = db.seasons.get(seasonId) else return #err(#NoSeason);
        if (season.payout != #approved and season.payout != #paying) {
            return #err(#WrongPhase("there is no plan waiting to be sent"));
        };
        if (not stillOwned()) return #ok(progressOf(db, seasonId));
        // Mark the run in flight before the first await, so a withdrawal
        // arriving mid-run is refused rather than racing the transfers.
        if (season.payout != #paying) {
            switch (db.seasons.update({ season with payout = #paying })) {
                case (#ok(_)) {};
                case (#err(e)) return #err(#Db(e));
            };
        };

        // Up to `passes` sweeps of whatever is still unsent. A pass that
        // settles everything leaves nothing for the next one to do, so the
        // common case costs one sweep and a cheap second look.
        let deferred = List.empty<Nat64>();
        // A ledger gets the conservative whole-pass circuit break once per
        // run. After that, one bad row is deferred on its own so several bad
        // rows at the front cannot consume every pass and starve payable rows
        // behind them. This is deliberately transient: payout rows and their
        // frozen transfer arguments remain the complete durable state.
        let blockedOnce = List.empty<Principal>();
        let stateOrder : [State] = [#sending, #planned];
        var pass = 0;
        while (pass < passes) {
            if (not stillOwned()) return #ok(progressOf(db, seasonId));
            // A ledger that has just timed out or reported a temporary failure
            // is unlikely to help the next hundred rows. Stop calling it for
            // this pass once per run. A following pass may isolate further bad
            // rows and continue behind them, while every failed row remains
            // deferred until the next scheduled run.
            let blockedLedgers = List.empty<Principal>();
            for (wanted in stateOrder.vals()) {
                // Historically ambiguous rows go first. Their frozen timestamps
                // have the least room left in the ledger's deduplication window.
                for (row in forSeason(db, seasonId).vals()) {
                    if (not stillOwned()) return #ok(progressOf(db, seasonId));
                    // Re-read: an earlier iteration's await is a commit point, so
                    // this row may have been settled by a concurrent run since
                    // the list was taken.
                    switch (db.payouts.get(row.id)) {
                        case null {};
                        case (?fresh) {
                            if (
                                fresh.state == wanted
                                and not containsId(deferred, fresh.id)
                                and not containsPrincipal(blockedLedgers, fresh.ledger)
                            ) {
                                switch (await* send(db, fresh, canister, ledgerFor(fresh.ledger), stillOwned)) {
                                    case (#defer) {
                                        List.add(deferred, fresh.id);
                                        if (not containsPrincipal(blockedOnce, fresh.ledger)) {
                                            List.add(blockedOnce, fresh.ledger);
                                            List.add(blockedLedgers, fresh.ledger);
                                        };
                                    };
                                    case (#retry or #done) {};
                                    case (#stale) return #ok(progressOf(db, seasonId));
                                };
                            };
                        };
                    };
                };
            };

            pass += 1;
        };

        if (not stillOwned()) return #ok(progressOf(db, seasonId));
        settleSeason(db, seasonId);
    };

    /// The payout row id as 8 big-endian bytes.
    ///
    /// Part of the ICRC-1 deduplication key, which is the point: it is what
    /// makes two otherwise byte-identical transfers different transactions.
    /// Stable across retries because the id is, so a retry of *this* row still
    /// deduplicates against itself.
    public func memoFor(id : Nat64) : Blob {
        Blob.fromArray(
            Array.tabulate<Nat8>(8, func(i) = Nat8.fromNat(Nat64.toNat((id >> (56 - 8 * Nat64.fromNat(i))) & 0xFF)))
        );
    };

    type SendDisposition = { #done; #retry; #defer; #stale };

    func containsId(ids : List.List<Nat64>, id : Nat64) : Bool {
        for (one in List.values(ids)) { if (one == id) return true };
        false;
    };

    func containsPrincipal(ids : List.List<Principal>, id : Principal) : Bool {
        for (one in List.values(ids)) { if (one == id) return true };
        false;
    };

    func send(
        db : Ashroot.DB,
        row : Payout,
        _canister : Principal,
        api : Treasury.LedgerApi,
        stillOwned : () -> Bool,
    ) : async* SendDisposition {
        if (not stillOwned()) return #stale;
        // `#sending` means a prior call had an outcome we could not prove. A
        // planned row may have prior attempts too, but every one of those got
        // a definite rejection, so changing a rejected BadFee is still safe.
        let wasAmbiguous = row.state == #sending;
        // Claim first. This is durable the moment the call below goes out, so
        // an interruption leaves the row #sending rather than #planned — and a
        // #sending row is retried with the same frozen arguments, never with
        // new ones.
        let claimed = switch (db.payouts.update({ row with state = #sending; attempts = row.attempts + 1 })) {
            case (#ok(saved)) saved;
            case (#err(_)) return #defer;
        };
        if (not stillOwned()) return #stale;

        let outcome = try {
            await* api.transfer({
                // Never a parameter: the treasury is the only source.
                from_subaccount = null;
                // Straight to the winner's own wallet. `to` was frozen at
                // draft and is never re-read from the user row — see
                // `Season.settling`.
                to = { owner = claimed.to; subaccount = null };
                amount = claimed.net;
                fee = ?claimed.fee;
                // **The row id, and it is load-bearing.** ICRC-1 deduplicates
                // on the whole argument record, and paying wallets directly
                // makes collisions reachable: two hackers who happen to name
                // the same wallet, with the same award on the same ledger,
                // produce transfers identical in amount, fee, destination and
                // `created_at_time` — because the whole plan is stamped with
                // one `now`. The second would come back `#Duplicate`, be
                // marked paid, and move nothing. The memo is what keeps every
                // row distinct.
                memo = ?memoFor(claimed.id);
                // Frozen at draft. Re-stamping here is how a retry becomes a
                // second payment.
                created_at_time = ?claimed.createdAtTime;
            });
        } catch (_) {
            // The call failed, and from here we cannot tell whether the
            // transfer landed. The row stays #sending so the next run retries
            // it with identical arguments — which the ledger will either
            // perform once or refuse as a duplicate.
            if (not stillOwned()) return #stale;
            let ?fresh = db.payouts.get(claimed.id) else return #defer;
            if (terminalState(fresh.state)) return #done;
            if (fresh.attempts > claimed.attempts) return #defer;
            switch (db.payouts.update({
                fresh with note = "ledger transfer call failed"
            })) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("could not retain an ambiguous payout claim");
            };
            return #defer;
        };

        let ?fresh = db.payouts.get(claimed.id) else return #defer;
        let paidOutcome = switch (outcome) {
            case (#Ok(_)) true;
            case (#Err(#Duplicate(_))) true;
            case (_) false;
        };
        let ownedAfter = stillOwned();
        // A stale definite rejection belongs to the newer owner to interpret.
        // A success/Duplicate is objective proof and is safe to retain before
        // stopping this old continuation.
        if (not ownedAfter and not paidOutcome) return #stale;
        // A reclaimed lease may have completed or terminalized this row while
        // the older ledger call was suspended. Only proof that money moved may
        // advance such a row to #paid; stale errors never regress newer state.
        if (not paidOutcome and terminalState(fresh.state)) return #done;
        if (not paidOutcome and fresh.attempts > claimed.attempts) return #defer;

        let (settled, disposition) : (Payout, SendDisposition) = switch (outcome) {
            // The ledger's block index, kept. It is the receipt: the one thing
            // that lets somebody look this payment up on the ledger itself
            // rather than take the canister's word that it happened. Discarding
            // it made the transaction unshowable, which is half of what a
            // public payout list is for.
            case (#Ok(index)) ({ fresh with state = #paid; note = ""; block = ?index }, #done);
            // Already done: the money moved on an earlier attempt whose reply
            // we never saw. This is the deduplication doing its job. The block
            // index in a `#Duplicate` is the *original* transaction's, which is
            // exactly the one worth recording.
            case (#Err(#Duplicate({ duplicate_of }))) {
                ({ fresh with state = #paid; note = "already sent"; block = ?duplicate_of }, #done);
            };
            case (#Err(#BadFee({ expected_fee }))) {
                if (wasAmbiguous) {
                    (
                        {
                            fresh with
                            state = #failed;
                            note = ambiguousFailure("the latest retry reported a changed ledger fee");
                        },
                        #done,
                    );
                } else if (fresh.gross <= expected_fee) {
                    (
                        {
                            fresh with
                            fee = expected_fee;
                            net = 0;
                            state = #skipped;
                            note = "updated ledger fee consumes this share";
                        },
                        #done,
                    );
                } else {
                    (
                        {
                            fresh with
                            fee = expected_fee;
                            net = Nat.sub(fresh.gross, expected_fee);
                            state = #planned;
                            note = "updated to the ledger's expected fee";
                        },
                        #retry,
                    );
                };
            };
            case (#Err(#BadBurn(_))) {
                (
                    {
                        fresh with
                        state = #failed;
                        note = if (wasAmbiguous) {
                            ambiguousFailure("the latest retry reported an amount below its minimum burn")
                        } else "amount is below the ledger's minimum burn";
                    },
                    #done,
                );
            };
            case (#Err(#TooOld)) {
                if (not wasAmbiguous) {
                    // A long cycles freeze may outlive the ledger's dedup
                    // window. The row was #planned before this call, which
                    // means every earlier attempt received a definite
                    // rejection. This TooOld is definite too, so no transfer
                    // under the old stamp can exist and refreshing is safe.
                    (
                        {
                            fresh with
                            createdAtTime = Nat64.fromIntWrap(Time.now());
                            state = #planned;
                            note = "refreshed a definitely unsent payment after a long pause";
                        },
                        #retry,
                    );
                } else {
                    // Any outcome-unknown send keeps its exact dedup identity.
                    (
                        {
                            fresh with
                            state = #failed;
                            note = if (wasAmbiguous) {
                                ambiguousFailure("the latest retry was outside the deduplication window")
                            } else "the deduplication window expired; needs checking by hand";
                        },
                        #done,
                    );
                };
            };
            case (#Err(#InsufficientFunds(_))) {
                (
                    {
                        fresh with
                        state = #failed;
                        note = if (wasAmbiguous) {
                            ambiguousFailure("the latest retry reported insufficient treasury funds")
                        } else "the treasury did not hold enough";
                    },
                    #done,
                );
            };
            case (#Err(other)) {
                // The latest call was definitely rejected, but that says
                // nothing about an earlier call whose reply was lost. Preserve
                // #sending once it has ever meant "outcome unknown"; otherwise
                // a later BadFee could mutate the deduplication identity and
                // send the payment a second time.
                (
                    {
                        fresh with
                        state = if (wasAmbiguous) #sending else #planned;
                        note = if (wasAmbiguous) {
                            "retrying the exact transfer after an unknown outcome; " # safeLedgerNote(other)
                        } else safeLedgerNote(other);
                    },
                    #defer,
                );
            };
        };
        switch (db.payouts.update(settled)) {
            case (#ok(_)) if (ownedAfter) disposition else #stale;
            // If money moved, the durable #sending claim remains and the next
            // identical retry resolves it via #Duplicate.
            case (#err(_)) Runtime.trap("could not settle a payout ledger response");
        };
    };

    func terminalState(state : State) : Bool = switch (state) {
        case (#paid or #skipped or #failed) true;
        case (#planned or #sending) false;
    };

    /// Never persist a ledger-controlled message. Error codes/timestamps are
    /// bounded scalar values; free-form GenericError text is deliberately
    /// omitted from permanent payout rows.
    func safeLedgerNote(error : Treasury.TransferError) : Text = switch (error) {
        case (#CreatedInFuture({ ledger_time })) {
            "created in the future of ledger time " # Nat64.toText(ledger_time);
        };
        case (#TemporarilyUnavailable) "ledger temporarily unavailable";
        case (#GenericError({ error_code; message = _ })) {
            "ledger generic error code " # Nat.toText(error_code);
        };
        case (_) "ledger rejected the transfer";
    };

    func ambiguousFailure(latest : Text) : Text {
        "an earlier transfer outcome is unknown; " # latest # "; needs checking by hand";
    };

    /// Terminalize every row still eligible for retry once the shared
    /// 24-round budget is exhausted. This also closes an empty/undraftable
    /// season, so zero payout rows can never leave withdrawals locked forever.
    public func exhaust(db : Ashroot.DB, seasonId : Nat64) : Result.Result<Progress, Error> {
        let ?season = db.seasons.get(seasonId) else return #err(#NoSeason);
        if (season.payout == #paid or season.payout == #failed) {
            return #ok(progressOf(db, seasonId));
        };
        var changed = false;
        for (row in forSeason(db, seasonId).vals()) {
            if (row.state == #planned or row.state == #sending) {
                switch (db.payouts.update({
                    row with
                    state = #failed;
                    note = if (row.state == #sending) {
                        ambiguousFailure("the retry budget was exhausted after 24 rounds")
                    } else "retry budget exhausted after 24 rounds";
                })) {
                    case (#ok(_)) changed := true;
                    case (#err(e)) {
                        if (changed) Runtime.trap("could not terminalize every exhausted payout row");
                        return #err(#Db(e));
                    };
                };
            };
        };
        switch (db.seasons.update({ season with payout = #failed })) {
            case (#ok(_)) #ok(progressOf(db, seasonId));
            case (#err(e)) {
                if (changed) Runtime.trap("could not terminalize the exhausted payout season");
                #err(#Db(e));
            };
        };
    };

    /// Where the run got to, and whether withdrawals may open.
    public func progressOf(db : Ashroot.DB, seasonId : Nat64) : Progress {
        var paid = 0;
        var failed = 0;
        var skipped = 0;
        var left = 0;
        for (row in forSeason(db, seasonId).vals()) {
            switch (row.state) {
                case (#paid) paid += 1;
                case (#failed) failed += 1;
                case (#skipped) skipped += 1;
                case (#planned or #sending) left += 1;
            };
        };
        { paid; failed; skipped; left };
    };

    func settleSeason(db : Ashroot.DB, seasonId : Nat64) : Result.Result<Progress, Error> {
        let progress = progressOf(db, seasonId);
        let ?season = db.seasons.get(seasonId) else return #err(#NoSeason);
        // Terminal season status is absorbing. A late response may improve a
        // row's audit receipt, but an expired continuation cannot rewrite the
        // already-published aggregate result.
        if (season.payout == #paid or season.payout == #failed) return #ok(progress);

        // Only a run with nothing left to try is finished. A row that failed
        // definitively still counts as settled — it will not be retried, and
        // holding every other payee's withdrawal hostage to it helps nobody.
        let next : Phase = if (progress.left > 0) #paying
        else if (progress.failed > 0 or season.fundingFailures.size() > 0) #failed
        else #paid;

        switch (db.seasons.update({ season with payout = next })) {
            case (#ok(_)) #ok(progress);
            case (#err(e)) #err(#Db(e));
        };
    };

    /// Is any distribution mid-flight?
    ///
    /// Withdrawals are gated on this rather than on a particular season: a
    /// reward account accumulates across seasons, so what matters is whether
    /// the canister is currently moving money out of the treasury, not which
    /// season paid.
    public func running(db : Ashroot.DB) : Bool {
        for ((_, season) in db.seasons.iterPrimary(#fwd, null)) {
            if (season.payout == #paying) return true;
        };
        false;
    };
};
