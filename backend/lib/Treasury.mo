/// Sponsor deposits and the treasury.
///
/// Each sponsor gets a canister-controlled ICRC-1 deposit address derived from
/// their user id. They send tokens there; once approved, the balance is swept
/// into a single treasury subaccount for safekeeping.
///
/// **Deposits are one-way — there is no refund path here, by design.**
///
/// Rewards are marks on entries at this stage (see rules.md §7); nothing pays
/// out of the treasury yet.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Text "mo:core/Text";
import VarArray "mo:core/VarArray";

import Ashroot "../.ashroot/lib";
import Profiles "./Profiles";
import Season "./Season";

module {

    public type Account = { owner : Principal; subaccount : ?Blob };

    /// The slice of ICRC-1 we need. Declared here rather than imported so the
    /// canister has no dependency on a particular ledger implementation.
    public type TransferArgs = {
        from_subaccount : ?Blob;
        to : Account;
        amount : Nat;
        fee : ?Nat;
        memo : ?Blob;
        created_at_time : ?Nat64;
    };

    public type TransferError = {
        #BadFee : { expected_fee : Nat };
        #BadBurn : { min_burn_amount : Nat };
        #InsufficientFunds : { balance : Nat };
        #TooOld;
        #CreatedInFuture : { ledger_time : Nat64 };
        #Duplicate : { duplicate_of : Nat };
        #TemporarilyUnavailable;
        #GenericError : { error_code : Nat; message : Text };
    };

    public type TransferResult = { #Ok : Nat; #Err : TransferError };

    public type Ledger = actor {
        icrc1_balance_of : shared query (Account) -> async Nat;
        icrc1_fee : shared query () -> async Nat;
        icrc1_transfer : shared (TransferArgs) -> async TransferResult;
    };

    /// The ledger operations this canister needs, as a value rather than an
    /// actor reference.
    ///
    /// Money is the one part that cannot be exercised by calling a module
    /// function: a real ledger is another canister, and there is none in a
    /// test. Passing the operations in means the same code paths — including
    /// every failure branch — run against an in-memory ledger under test and
    /// against ICRC-1 in production.
    public type LedgerApi = {
        balanceOf : (Account) -> async* Nat;
        fee : () -> async* Nat;
        transfer : (TransferArgs) -> async* TransferResult;
    };

    /// The real thing.
    public func icrc1(id : Principal) : LedgerApi {
        let ledger : Ledger = actor (Principal.toText(id));
        {
            balanceOf = func(account : Account) : async* Nat {
                await ledger.icrc1_balance_of(account);
            };
            fee = func() : async* Nat { await ledger.icrc1_fee() };
            transfer = func(args : TransferArgs) : async* TransferResult {
                await ledger.icrc1_transfer(args);
            };
        };
    };

    /// Bound reads and idempotent payout sends so one unreachable ledger cannot
    /// suspend an automation continuation forever. A best-effort timeout does
    /// not prove that a transfer failed; callers of the bounded transfer must
    /// therefore retry byte-identical arguments, as `Payout` does.
    public let AUTOMATION_CALL_TIMEOUT_SECONDS : Nat32 = 120;

    public func boundedIcrc1(id : Principal) : LedgerApi {
        let ledger : Ledger = actor (Principal.toText(id));
        {
            balanceOf = func(account : Account) : async* Nat {
                await (with timeout = AUTOMATION_CALL_TIMEOUT_SECONDS) ledger.icrc1_balance_of(account);
            };
            fee = func() : async* Nat {
                await (with timeout = AUTOMATION_CALL_TIMEOUT_SECONDS) ledger.icrc1_fee();
            };
            transfer = func(args : TransferArgs) : async* TransferResult {
                await (with timeout = AUTOMATION_CALL_TIMEOUT_SECONDS) ledger.icrc1_transfer(args);
            };
        };
    };

    /// Funding reads are safe to time out, but its sponsor-deposit transfer is
    /// not idempotent: each successful sweep may be followed by a new top-up.
    /// Keep that transfer unbounded and keep its actor-level owner exclusive
    /// until the definite ledger reply arrives. A timeout here could return
    /// `SYS_UNKNOWN`, allow a snapshot, and then have the old transfer land.
    public func fundingIcrc1(id : Principal) : LedgerApi {
        let ledger : Ledger = actor (Principal.toText(id));
        {
            balanceOf = func(account : Account) : async* Nat {
                await (with timeout = AUTOMATION_CALL_TIMEOUT_SECONDS) ledger.icrc1_balance_of(account);
            };
            fee = func() : async* Nat {
                await (with timeout = AUTOMATION_CALL_TIMEOUT_SECONDS) ledger.icrc1_fee();
            };
            transfer = func(args : TransferArgs) : async* TransferResult {
                await ledger.icrc1_transfer(args);
            };
        };
    };

    public type Error = {
        /// The caller's account is frozen: they may read, not write.
        #Frozen;
        #NotRegistered;
        #NotASponsor;
        #NoLedger;
        #NoSeason;
        #Nothing;
        /// Asked again too soon. Carries the seconds left on the window, so a
        /// caller can say when rather than just "no".
        #TooSoon : Nat;
        #Transfer : Text;
    };

    public type Deposit = {
        /// Where the sponsor sends tokens.
        ///
        /// One address serves every ledger: a subaccount is a property of the
        /// account, not of the token, so the same one receives ICP, ckBTC and
        /// any SNS token alike.
        account : Account;
        /// Hex of the subaccount, so a UI can show it without re-deriving.
        subaccount : Text;
        /// The ledgers this sponsor said they would pay in.
        ledgers : [Ashroot.Types.Users.User.Sponsor.Ledgers.Element];
    };

    /// The treasury is subaccount zero — the canister's default account.
    public func treasury(canister : Principal) : Account = {
        owner = canister;
        subaccount = null;
    };

    /// Byte 0 says what an address is *for*.
    ///
    /// ```
    /// byte  0        1 .......................... 23   24 ............. 31
    ///     [ tag ]  [           23 zero bytes         ] [ user id, BE64  ]
    ///
    ///   0x00  sponsor deposit    — and, with id 0, the treasury itself
    ///   0x01  reward custody
    /// ```
    ///
    /// Two derivations can therefore never land on the same address whatever
    /// the ids, and user ids start at 1 so nobody is handed the treasury's own
    /// account. Deposits keep the layout they always had — byte 0 was already
    /// zero — so no published deposit address moves.
    let TAG_DEPOSIT : Nat8 = 0x00;
    let TAG_REWARD : Nat8 = 0x01;

    func derive(tag : Nat8, userId : Nat64) : Blob {
        let bytes = VarArray.repeat<Nat8>(0, 32);
        bytes[0] := tag;
        var i = 0;
        while (i < 8) {
            // Big-endian: most significant byte first, at offset 24.
            let shift = Nat64.fromNat((7 - i) * 8);
            bytes[24 + i] := Nat8.fromNat(Nat64.toNat((userId >> shift) & 0xff));
            i += 1;
        };
        Blob.fromVarArray(bytes);
    };

    /// Where a sponsor sends tokens. Deterministic and recoverable from the id
    /// alone, so nothing extra has to be stored.
    public func subaccountFor(userId : Nat64) : Blob = derive(TAG_DEPOSIT, userId);

    /// Where a hacker's rewards are held until they withdraw them.
    ///
    /// Per *user*, not per season: one person has one reward account that
    /// accumulates. Still canister-controlled — this is custody, not a
    /// transfer out — but isolated from the treasury pool and from everyone
    /// else, which is what makes a withdrawal unable to reach either.
    public func rewardSubaccountFor(userId : Nat64) : Blob = derive(TAG_REWARD, userId);

    public func rewardAccount(canister : Principal, userId : Nat64) : Account = {
        owner = canister;
        subaccount = ?rewardSubaccountFor(userId);
    };

    public func depositFor(canister : Principal, user : Profiles.User) : Deposit {
        let sub = subaccountFor(user.id);
        {
            account = { owner = canister; subaccount = ?sub };
            subaccount = hex(sub);
            ledgers = switch (user.sponsor) {
                case (?info) info.ledgers;
                case null [];
            };
        };
    };

    func hex(blob : Blob) : Text {
        let digits = "0123456789abcdef";
        let chars = Text.toArray(digits);
        var out = "";
        for (byte in blob.vals()) {
            let n = Nat8.toNat(byte);
            out #= Text.fromChar(chars[n / 16]) # Text.fromChar(chars[n % 16]);
        };
        out;
    };

    /// Sweep one of a sponsor's deposits into the treasury.
    ///
    /// Only runs while a season is live: the judge freeze that a season start
    /// guarantees is the point at which money is allowed to move (rules.md §6).
    /// Idempotent — a sponsor who tops up later is swept again next time.
    ///
    /// The ledger is named rather than assumed: a sponsor may pledge several,
    /// and each holds its own balance at the same address.
    public func sweep(
        db : Ashroot.DB,
        api : LedgerApi,
        canister : Principal,
        handle : Text,
        ledgerId : Principal,
        now : Nat64,
    ) : async* Result.Result<Nat, Error> {
        await* sweepWhile(
            db,
            api,
            canister,
            handle,
            ledgerId,
            now,
            func() = Season.running(db) != null,
        );
    };

    /// The externally admitted sweep, with a second gate immediately before
    /// money moves. Balance and fee reads are awaits, so a season can reach
    /// its funding cutoff while they are in flight. The callback is read only
    /// after those awaits; callers bind it to the actor's funding-close flag.
    public func sweepWhile(
        db : Ashroot.DB,
        api : LedgerApi,
        canister : Principal,
        handle : Text,
        ledgerId : Principal,
        now : Nat64,
        stillOpen : () -> Bool,
    ) : async* Result.Result<Nat, Error> {
        let user = switch (eligible(db, handle, ledgerId)) {
            case (#ok(u)) u;
            case (#err(e)) return #err(e);
        };

        func transferStarted() : Bool = true;
        func transferFinished() : async () {};
        func transferFinishedSync() {};
        await* sweepUser(
            db,
            api,
            canister,
            user.id,
            ledgerId,
            now,
            stillOpen,
            transferStarted,
            transferFinished,
            transferFinishedSync,
        );
    };

    /// Final-close reconciliation uses the same transfer and accounting path
    /// without the `Season.running` admission check: by then the final week is
    /// deliberately closed. The caller supplies only pairs taken from the
    /// frozen approved-sponsor set.
    public func reconcile(
        db : Ashroot.DB,
        api : LedgerApi,
        canister : Principal,
        userId : Nat64,
        ledgerId : Principal,
        now : Nat64,
        /// The actor-level funding lease. Checked after the balance/fee awaits
        /// and immediately before a transfer, just as public sweeps re-check
        /// that the season is still open.
        stillOwned : () -> Bool,
        /// Funding automation uses these two callbacks to make only the exact
        /// non-idempotent ledger-call window non-reclaimable. Reads and local
        /// finalization remain recoverable by the outer lease.
        transferStarted : () -> Bool,
        transferFinished : () -> async (),
        transferFinishedSync : () -> (),
    ) : async* Result.Result<Nat, Error> {
        let ?user = db.users.get(userId) else return #err(#NotRegistered);
        if (user.sponsorStatus != #approved) return #err(#NotASponsor);
        let ?info = user.sponsor else return #err(#NotASponsor);
        if (not pledged(info.ledgers, ledgerId)) return #err(#NoLedger);
        await* sweepUser(
            db,
            api,
            canister,
            user.id,
            ledgerId,
            now,
            stillOwned,
            transferStarted,
            transferFinished,
            transferFinishedSync,
        );
    };

    func sweepUser(
        db : Ashroot.DB,
        api : LedgerApi,
        canister : Principal,
        userId : Nat64,
        ledgerId : Principal,
        now : Nat64,
        stillOpen : () -> Bool,
        transferStarted : () -> Bool,
        transferFinished : () -> async (),
        transferFinishedSync : () -> (),
    ) : async* Result.Result<Nat, Error> {

        let from = subaccountFor(userId);

        // A ledger that is stopped, frozen, or out of cycles rejects the call
        // outright. That arrives as an Error rather than an #Err, and without
        // catching it the whole message dies — so a sponsor notifying about a
        // sick ledger would get an opaque failure instead of an explanation.
        let balance = try {
            await* api.balanceOf({ owner = canister; subaccount = ?from });
        } catch (_) {
            return #err(#Transfer("ledger balance read failed"));
        };
        let fee = try { await* api.fee() } catch (_) {
            return #err(#Transfer("ledger fee read failed"));
        };
        if (balance <= fee) return #err(#Nothing);

        // The reads above admitted an interleaving. Once final reconciliation
        // begins, no public/moderator sweep may land after its empty-balance
        // observation and escape the payout draft.
        if (not stillOpen()) return #err(#NoSeason);
        if (not transferStarted()) return #err(#NoSeason);

        // The ordinary async call is intentional: it commits the barrier
        // decrement before any later local work can trap. A canister below its
        // freezing threshold may still execute this ledger callback while its
        // cleanup self-call is refused, though. In that one case the callback
        // never ran, so complete the same guarded decrement synchronously in
        // this already-running continuation.
        func finishTransfer() : async* Bool {
            try {
                await transferFinished();
                true;
            } catch (_) {
                transferFinishedSync();
                false;
            };
        };

        let result = try {
            await* api.transfer({
                from_subaccount = ?from;
                to = treasury(canister);
                // The fee comes out of the swept amount, not the treasury.
                amount = balance - fee;
                fee = ?fee;
                memo = null;
                created_at_time = null;
            });
        } catch (_) {
            // Nothing is recorded as given: from here we cannot tell whether
            // the transfer landed, and crediting a gift that may not have
            // arrived is the worse mistake. The next sweep will find the money
            // if it is still there.
            let failed = #err(#Transfer("ledger transfer call failed"));
            ignore await* finishTransfer();
            return failed;
        };

        // A refused cleanup self-call is the low-cycle path. Prepare the plain
        // return value first, then after the guarded synchronous decrement do
        // no database/accounting work at all. A later recovery pass will see
        // the ledger's definite result in its balance.
        let withoutAccounting : Result.Result<Nat, Error> = switch (result) {
            case (#Err(e)) #err(#Transfer(describe(e)));
            case (#Ok(_)) #ok(Nat.sub(balance, fee));
        };
        if (not (await* finishTransfer())) return withoutAccounting;

        switch (result) {
            case (#Err(e)) #err(#Transfer(describe(e)));
            case (#Ok(_)) {
                let moved = Nat.sub(balance, fee);
                // Record what arrived, so the sponsors board can say who gave
                // what rather than only who offered to.
                switch (Profiles.recordGift(db, userId, ledgerId, moved, now)) {
                    case (#ok(_)) #ok(moved);
                    case (#err(_)) #ok(moved);
                };
            };
        };
    };

    /// Everything `sweep` refuses before it dials a ledger.
    ///
    /// Split out so a caller can put its own rate limit *after* these. A
    /// non-sponsor, or a sponsor naming a ledger they never pledged, should
    /// hear which of those it was — being told to come back in a minute, and
    /// then told the same thing a minute later, explains nothing. It also
    /// stops a rejected call from spending the caller's turn.
    public func eligible(
        db : Ashroot.DB,
        handle : Text,
        ledgerId : Principal,
    ) : Result.Result<Profiles.User, Error> {
        if (Season.running(db) == null) return #err(#NoSeason);
        let ?user = Profiles.byHandle(db, handle) else return #err(#NotRegistered);
        if (user.sponsorStatus != #approved) return #err(#NotASponsor);
        let ?info = user.sponsor else return #err(#NotASponsor);
        // Only a ledger the sponsor actually pledged: otherwise a moderator
        // could be talked into sweeping some unrelated canister.
        if (not pledged(info.ledgers, ledgerId)) return #err(#NoLedger);
        #ok(user);
    };

    func pledged(
        ledgers : [Ashroot.Types.Users.User.Sponsor.Ledgers.Element],
        id : Principal,
    ) : Bool {
        for (l in ledgers.vals()) { if (l.id == id) return true };
        false;
    };

    // ── Withdrawals ──────────────────────────────────────────────────────────

    public type WithdrawError = {
        /// The caller's account is frozen: they may read, not write.
        #Frozen;
        #NotRegistered;
        #Locked;
        #Nothing;
        #BadDestination;
        #Transfer : Text;
    };

    /// Move a user's own rewards out to an account they name.
    ///
    /// The source is **derived from `caller`** and is never a parameter. That
    /// is the whole isolation guarantee: there is no input to this function
    /// that can name the treasury, or another user's reward account, or any
    /// other subaccount at all. The most a caller can do is choose where their
    /// own money goes.
    ///
    /// The amount is not a parameter either — the balance of that subaccount
    /// is what leaves it, so there is nothing to over-draw. A user who has
    /// been paid nothing gets `#Nothing`, not somebody else's tokens.
    public func withdraw(
        db : Ashroot.DB,
        api : LedgerApi,
        canister : Principal,
        caller : Principal,
        to : Account,
        /// Re-read rather than passed as a value: reading the balance is an
        /// await, and a distribution can start in that gap. Checked again
        /// immediately before the transfer so the answer cannot be stale.
        locked : () -> Bool,
    ) : async* Result.Result<Nat, WithdrawError> {
        // **`owner`, never `byPrincipal`.** A nominated agent drives an account
        // but must not be able to empty it: `to` is the caller's to choose, so
        // resolving an agent here would let a script that was trusted to submit
        // a build send the balance anywhere it liked. That is the one thing the
        // agent boundary reserves to the account holder, and this is the method
        // it exists to guard. An agent gets `#NotRegistered`, the same answer as
        // any other principal with no account of its own.
        let ?user = Profiles.owner(db, caller) else return #err(#NotRegistered);

        // While a distribution is mid-flight the canister is itself moving
        // money into these accounts; letting withdrawals race that is asking
        // for a half-paid balance to be swept out from under the run.
        if (locked()) return #err(#Locked);

        // Refusing to send to ourselves is not about safety — the derivation
        // already guarantees that — but about the one honest mistake a UI can
        // make: pasting the canister's own address and appearing to lose the
        // tokens.
        if (to.owner == canister) return #err(#BadDestination);

        let from = rewardSubaccountFor(user.id);
        let balance = try {
            await* api.balanceOf({ owner = canister; subaccount = ?from });
        } catch (_) {
            return #err(#Transfer("ledger balance read failed"));
        };
        let fee = try { await* api.fee() } catch (_) {
            return #err(#Transfer("ledger fee read failed"));
        };
        if (balance <= fee) return #err(#Nothing);
        // The two reads above were awaits; a run may have begun since.
        if (locked()) return #err(#Locked);

        let result = try {
            await* api.transfer({
                from_subaccount = ?from;
                to;
                amount = balance - fee;
                fee = ?fee;
                memo = null;
                created_at_time = null;
            });
        } catch (_) {
            return #err(#Transfer("ledger transfer call failed"));
        };

        switch (result) {
            case (#Ok(_)) #ok(balance - fee);
            case (#Err(e)) #err(#Transfer(describe(e)));
        };
    };

    /// What a user could withdraw right now.
    public func rewardBalance(
        api : LedgerApi,
        canister : Principal,
        userId : Nat64,
    ) : async* Nat {
        await* api.balanceOf(rewardAccount(canister, userId));
    };

    /// Every ledger any approved sponsor has pledged, without duplicates.
    ///
    /// The treasury holds a balance per token, so this is the list worth
    /// asking about — a ledger nobody pledged can hold nothing.
    /// What the treasury holds, per ledger — bookkeeping, not a query.
    ///
    /// Every number is already ours. A sweep records exactly what landed on a
    /// sponsor's row (the balance it read, less the fee it paid), and a settled
    /// payout row records exactly what left. So the pool is the difference, and
    /// no ledger has to be asked.
    ///
    /// That matters beyond speed. Reading it live meant a public method that
    /// took a ledger id and called it — which let any caller, anonymous
    /// included, make this canister send messages to a canister of their
    /// choosing and pay for them. There is no version of that which is safe,
    /// so the read is gone rather than guarded.
    ///
    /// Only sponsors and settled payouts are walked, both small sets: the
    /// hundreds of ordinary participants are never touched.
    public func pools(db : Ashroot.DB) : [(Principal, Nat)] {
        let ledgers = ledgersInPlay(db);
        Array.map<Principal, (Principal, Nat)>(
            ledgers,
            func(ledger) = (ledger, poolOf(db, ledger)),
        );
    };

    /// One ledger's balance, by the same reckoning.
    public func poolOf(db : Ashroot.DB, ledger : Principal) : Nat {
        var held = 0;
        for (user in db.users.bySponsorHandle.rangeIter(
            { gt = null; gte = ?(2, ""); lt = ?(3, ""); lte = null; dir = #fwd },
            null,
        )) {
            switch (user.sponsor) {
                case null {};
                case (?info) {
                    for (gift in info.given.vals()) {
                        if (gift.ledger == ledger) held += gift.amount;
                    };
                };
            };
        };

        // Everything a settled payout moved out. `gross` is what left the
        // treasury; the payee received it less the fee, which the ledger took.
        var paid = 0;
        for ((_, row) in db.payouts.iterPrimary(#fwd, null)) {
            if (row.ledger == ledger and row.state == #paid) paid += row.gross;
        };

        // Cannot go negative in practice — a payout is drafted against a pool
        // that was there — but saturate rather than trap if it ever did.
        if (paid >= held) 0 else held - paid;
    };

    public func ledgersInPlay(db : Ashroot.DB) : [Principal] {
        let out = List.empty<Principal>();
        for (user in db.users.bySponsorHandle.rangeIter(
            { gt = null; gte = ?(2, ""); lt = ?(3, ""); lte = null; dir = #fwd },
            null,
        )) {
            switch (user.sponsor) {
                case null {};
                case (?info) {
                    for (ledger in info.ledgers.vals()) {
                        var seen = false;
                        for (known in List.values(out)) {
                            if (known == ledger.id) seen := true;
                        };
                        if (not seen) List.add(out, ledger.id);
                    };
                };
            };
        };
        List.toArray(out);
    };

    public type FundingPair = { userId : Nat64; ledger : Principal };

    /// Every frozen deposit account final-close reconciliation must drain.
    /// Sponsor applications reject duplicate ledgers, and the approved set is
    /// capped, so this is bounded by 64 × 7 = 448 pairs.
    public func fundingPairs(db : Ashroot.DB) : [FundingPair] {
        let out = List.empty<FundingPair>();
        for (user in db.users.bySponsorHandle.rangeIter(
            { gt = null; gte = ?(2, ""); lt = ?(3, ""); lte = null; dir = #fwd },
            null,
        )) {
            switch (user.sponsor) {
                case (?info) {
                    for (ledger in info.ledgers.vals()) {
                        List.add(out, { userId = user.id; ledger = ledger.id });
                    };
                };
                case null {};
            };
        };
        List.toArray(out);
    };

    /// What the treasury currently holds on one ledger.
    public func balance(api : LedgerApi, canister : Principal) : async* Nat {
        await* api.balanceOf(treasury(canister));
    };

    public func describe(e : TransferError) : Text {
        switch (e) {
            case (#BadFee(_)) "ledger rejected the fee";
            case (#BadBurn(_)) "bad burn";
            case (#InsufficientFunds(_)) "insufficient funds";
            case (#TooOld) "transaction too old";
            case (#CreatedInFuture(_)) "created in the future";
            case (#Duplicate(_)) "duplicate transfer";
            case (#TemporarilyUnavailable) "ledger temporarily unavailable";
            case (#GenericError({ error_code; message = _ })) {
                "ledger generic error code " # Nat.toText(error_code);
            };
        };
    };
};
