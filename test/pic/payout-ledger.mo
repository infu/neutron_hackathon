/// Small stateful ICRC-1 fixture for payout and recovery scenarios.
///
/// It intentionally exposes `credit`: this actor exists only inside PocketIC,
/// where tests need to seed sponsor deposits without carrying the full
/// production ledger Wasm fixture. Transfers debit the caller's account,
/// charge the configured fee, enforce a 24-hour timestamp window, and
/// deduplicate accepted timestamped calls by their exact arguments.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Time "mo:core/Time";

persistent actor class PayoutLedger(initialFee : Nat) {
    let DEDUP_WINDOW : Nat64 = 86_400_000_000_000; // 24 hours

    public type Account = { owner : Principal; subaccount : ?Blob };
    public type TransferArg = {
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
        #TemporarilyUnavailable;
        #Duplicate : { duplicate_of : Nat };
        #GenericError : { error_code : Nat; message : Text };
    };
    public type TransferResult = { #Ok : Nat; #Err : TransferError };

    var balances : [(Account, Nat)] = [];
    var nextBlock = 0;
    var temporaryFailures = 0;
    var accepted : [{ caller : Principal; arg : TransferArg; block : Nat }] = [];

    func same(a : Account, b : Account) : Bool {
        a.owner == b.owner and a.subaccount == b.subaccount;
    };

    func balance(account : Account) : Nat {
        for ((known, amount) in balances.vals()) {
            if (same(known, account)) return amount;
        };
        0;
    };

    func put(account : Account, amount : Nat) {
        var found = false;
        balances := Array.map<(Account, Nat), (Account, Nat)>(
            balances,
            func((known, held)) {
                if (same(known, account)) {
                    found := true;
                    (known, amount);
                } else (known, held);
            },
        );
        if (not found) balances := Array.concat(balances, [(account, amount)]);
    };

    public shared func credit(account : Account, amount : Nat) : async () {
        put(account, balance(account) + amount);
    };

    public query func icrc1_balance_of(account : Account) : async Nat {
        balance(account);
    };

    public query func icrc1_fee() : async Nat { initialFee };

    /// Test-only fault injection. The actor is compiled solely as a PocketIC
    /// fixture; production never installs or imports it.
    public shared func fail_next(count : Nat) : async () {
        temporaryFailures := count;
    };

    public query func transfer_count() : async Nat { nextBlock };

    func sameArg(a : TransferArg, b : TransferArg) : Bool {
        a.from_subaccount == b.from_subaccount
        and same(a.to, b.to)
        and a.amount == b.amount
        and a.fee == b.fee
        and a.memo == b.memo
        and a.created_at_time == b.created_at_time;
    };

    public shared ({ caller }) func icrc1_transfer(arg : TransferArg) : async TransferResult {
        switch (arg.fee) {
            case (?supplied) if (supplied != initialFee) {
                return #Err(#BadFee({ expected_fee = initialFee }));
            };
            case _ {};
        };

        switch (arg.created_at_time) {
            case (?stamp) {
                let at = Nat64.fromIntWrap(Time.now());
                if (stamp < at and at - stamp > DEDUP_WINDOW) return #Err(#TooOld);
                for (tx in accepted.vals()) {
                    if (tx.caller == caller and sameArg(tx.arg, arg)) {
                        return #Err(#Duplicate({ duplicate_of = tx.block }));
                    };
                };
            };
            case null {};
        };

        if (temporaryFailures > 0) {
            temporaryFailures -= 1;
            return #Err(#TemporarilyUnavailable);
        };

        let from = { owner = caller; subaccount = arg.from_subaccount };
        let held = balance(from);
        let debit = arg.amount + initialFee;
        if (held < debit) return #Err(#InsufficientFunds({ balance = held }));

        put(from, held - debit);
        put(arg.to, balance(arg.to) + arg.amount);
        let block = nextBlock;
        nextBlock += 1;
        switch (arg.created_at_time) {
            case (?_) {
                accepted := Array.concat(accepted, [{ caller; arg; block }]);
            };
            case null {};
        };

        #Ok(block);
    };
};
