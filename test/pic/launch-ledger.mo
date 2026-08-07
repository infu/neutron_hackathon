/// The smallest ICRC-1 actor a launch fixture needs.
///
/// Production setup validates every immutable ledger principal by reading its
/// balance and fee before a sponsor may pledge it.  Most PocketIC suites are
/// about seasons rather than money, so installing the full ICRC ledger in
/// every one would add seconds and a large external fixture for two queries.
/// This zero-balance actor keeps those launch checks real.  Money tests replace
/// the allowlist with their genuine ledgers before the first application.
persistent actor LaunchLedger {
    public type Account = { owner : Principal; subaccount : ?Blob };

    public query func icrc1_balance_of(_account : Account) : async Nat { 0 };

    public query func icrc1_fee() : async Nat { 10_000 };
};
