/// An in-memory ICRC-1 ledger, for tests.
///
/// A real ledger is another canister, and there is none under `ash test`. The
/// canister takes its ledger operations as a value (`Treasury.LedgerApi`), so
/// the same code paths that talk to ICRC-1 in production run against this
/// here — including the failure branches, which are the ones worth testing and
/// the hardest to provoke against a real ledger.
///
/// Deliberately small: an association list rather than a map, because a test
/// holds a handful of accounts and clarity beats asymptotics at that size.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Error "mo:core/Error";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";

import Treasury "../../backend/lib/Treasury";

module {

    public type Account = Treasury.Account;

    /// What the next transfer should do instead of succeeding.
    public type Scripted = {
        /// Answer with an ICRC-1 error, as a real ledger would.
        #fail : Treasury.TransferError;
        /// Reject the call, as a failed inter-canister call would. This is the
        /// one a caller catches with `try`/`catch` rather than by matching.
        #reject : Text;
    };

    /// `owner` is the canister whose subaccounts this ledger is asked about —
    /// in ICRC-1 the sender is the *caller*, and `from_subaccount` only picks
    /// which of that caller's accounts. Deriving it from the destination
    /// instead works right up until the first transfer that leaves the
    /// canister, and then silently reports insufficient funds.
    public class Fake(initialFee : Nat, owner : Principal) {

        var fee_ = initialFee;
        // Plain arrays: a test holds a handful of accounts, and the clarity is
        // worth more here than any asymptotics.
        var balances : [(Text, Nat)] = [];
        var scripted : [Scripted] = [];
        /// Fingerprint of every stamped transfer applied, and its block.
        var stamped : [(Text, Nat)] = [];
        /// Every transfer that was actually applied, so a test can assert on
        /// what moved rather than only on the balances left behind.
        public var transfers : [Treasury.TransferArgs] = [];

        public func setFee(next : Nat) { fee_ := next };

        /// Make the next transfer behave badly. Queued, so several can be
        /// lined up to test a loop that keeps going.
        public func script(outcome : Scripted) {
            scripted := Array.concat(scripted, [outcome]);
        };

        public func key(account : Account) : Text {
            let sub = switch (account.subaccount) {
                case (?blob) hex(blob);
                case null hex(Blob.fromArray(Array.repeat<Nat8>(0, 32)));
            };
            Principal.toText(account.owner) # ":" # sub;
        };

        public func credit(account : Account, amount : Nat) {
            set(key(account), get(key(account)) + amount);
        };

        public func balanceOf(account : Account) : Nat = get(key(account));

        public func totalSupply() : Nat {
            var sum = 0;
            for ((_, amount) in balances.vals()) { sum += amount };
            sum;
        };

        /// The operations the canister actually uses.
        public func api() : Treasury.LedgerApi = {
            balanceOf = func(account : Account) : async* Nat { get(key(account)) };
            fee = func() : async* Nat { fee_ };
            transfer = func(args : Treasury.TransferArgs) : async* Treasury.TransferResult {
                switch (take()) {
                    case (? #reject(message)) throw Error.reject(message);
                    case (? #fail(error)) return #Err(error);
                    case null {};
                };

                let charged = switch (args.fee) {
                    case (?given) {
                        // A real ledger refuses a fee it did not ask for.
                        if (given != fee_) return #Err(#BadFee({ expected_fee = fee_ }));
                        given;
                    };
                    case null fee_;
                };

                let from : Account = { owner; subaccount = args.from_subaccount };
                let held = get(key(from));
                if (held < args.amount + charged) {
                    return #Err(#InsufficientFunds({ balance = held }));
                };

                // Deduplication, because the canister depends on it.
                //
                // ICRC-1 collapses a transfer that is identical to a recent one
                // — same sender, destination, amount, fee, memo and
                // `created_at_time` — and answers `#Duplicate` instead of
                // moving anything a second time. That is the entire mechanism
                // behind at-most-once payment: a retry after a lost reply is
                // *meant* to be swallowed.
                //
                // A fake ledger that does not model it lets a whole class of
                // bug through silently. Two payees who name the same wallet
                // with the same award on the same ledger produce transfers
                // identical in every field the canister sets — and without a
                // memo to tell them apart, the second is a duplicate of the
                // first, comes back `#Duplicate`, is marked paid, and moves no
                // money. Nothing in the balances would show it.
                //
                // Only stamped transfers dedup, exactly as in ICRC-1: a
                // `created_at_time` of null asks for no deduplication.
                switch (args.created_at_time) {
                    case (?_) {
                        let fingerprint = print(args, from, charged);
                        for ((seen, block) in stamped.vals()) {
                            if (seen == fingerprint) {
                                return #Err(#Duplicate({ duplicate_of = block }));
                            };
                        };
                        stamped := Array.concat(stamped, [(fingerprint, transfers.size() + 1)]);
                    };
                    case null {};
                };

                set(key(from), held - args.amount - charged);
                set(key(args.to), get(key(args.to)) + args.amount);
                transfers := Array.concat(transfers, [args]);
                #Ok(transfers.size());
            };
        };

        /// Everything a real ledger keys deduplication on, as one string.
        ///
        /// The memo is in here on purpose: it is what a caller has to vary when
        /// two otherwise identical transfers are genuinely different payments.
        func print(args : Treasury.TransferArgs, from : Account, charged : Nat) : Text {
            let memo = switch (args.memo) { case (?blob) hex(blob); case null "-" };
            let at = switch (args.created_at_time) { case (?t) Nat64.toText(t); case null "-" };
            key(from) # "|" # key(args.to) # "|" # Nat.toText(args.amount)
            # "|" # Nat.toText(charged) # "|" # memo # "|" # at;
        };

        /// Take the next scripted outcome, if one is queued.
        func take() : ?Scripted {
            if (scripted.size() == 0) return null;
            let next = scripted[0];
            scripted := Array.tabulate<Scripted>(
                scripted.size() - 1,
                func(i) = scripted[i + 1],
            );
            ?next;
        };

        func get(k : Text) : Nat {
            for ((name, amount) in balances.vals()) {
                if (name == k) return amount;
            };
            0;
        };

        func set(k : Text, amount : Nat) {
            var found = false;
            balances := Array.map<(Text, Nat), (Text, Nat)>(
                balances,
                func((name, held)) {
                    if (name != k) return (name, held);
                    found := true;
                    (name, amount);
                },
            );
            if (not found) balances := Array.concat(balances, [(k, amount)]);
        };
    };

    public func hex(blob : Blob) : Text {
        let digits = Text.toArray("0123456789abcdef");
        var out = "";
        for (byte in blob.vals()) {
            let n = Nat8.toNat(byte);
            out #= Text.fromChar(digits[n / 16]) # Text.fromChar(digits[n % 16]);
        };
        out;
    };

    /// Assertion that says what it got, so a failure names the number.
    public func expect(actual : Nat, wanted : Nat, what : Text) {
        if (actual != wanted) {
            Runtime.trap(what # ": got " # Nat.toText(actual) # ", wanted " # Nat.toText(wanted));
        };
    };
};
