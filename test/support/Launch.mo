/// Launch configuration shared by Motoko module tests.
///
/// The actor validates ledger principals with real inter-canister calls.  Unit
/// tests inject `Treasury.LedgerApi` directly, so there is no remote actor to
/// query; their equivalent setup is to freeze the exact principals their fake
/// API represents.  Sponsor application, independent approval, and the
/// no-pending-applications invariant still run through the production modules.

import Principal "mo:core/Principal";

import Ashroot "../../backend/.ashroot/lib";

module {
    public func configure(db : Ashroot.DB, ledgers : [Principal]) {
        assert ledgers.size() > 0;
        db.store.set({
            db.store.get() with
            ledgerAllowlistSet = true;
            ledgerAllowlist = ledgers;
        });
    };
};
