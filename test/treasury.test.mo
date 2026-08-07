/// The money path.
///
/// Every one of these runs the real `Treasury` code against an in-memory
/// ledger. The point is the branches a live ledger will not produce on demand:
/// a balance under the fee, a ledger that answers with an error, a call that
/// is rejected outright. Those are the paths where money goes missing.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Test "mo:test";

import Ashroot "../backend/.ashroot/lib";
import Defaults "../backend/support/defaults";
import Moderation "../backend/lib/Moderation";
import Profiles "../backend/lib/Profiles";
import Payout "../backend/lib/Payout";
import Season "../backend/lib/Season";
import Treasury "../backend/lib/Treasury";

import Fake "./support/FakeLedger";
import Launch "./support/Launch";
import RoleTargets "./support/RoleTargets";

persistent actor {

    transient let CANISTER = Principal.fromText("aaaaa-aa");
    transient let MOD = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");
    /// The second pair of eyes an approval needs — see `approveSponsor`.
    transient let MOD2 = Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai");
    transient let SPONSOR = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    transient let LAUNCH_SPONSOR = Principal.fromText("mxzaz-hqaaa-aaaar-qaada-cai");
    transient let ICP = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
    transient let CKBTC = Principal.fromText("mxzaz-hqaaa-aaaar-qaada-cai");

    transient let FEE = 10_000;

    func fresh() : Ashroot.DB {
        Ashroot.Use(Ashroot.Mem(), Defaults.store());
    };

    func input(handle : Text) : Profiles.Input = {
        handle;
        displayName = handle;
        title = null;
        bio = "";
        links = [];
        terms = true;
    };

    func principalFor(n : Nat) : Principal {
        Principal.fromBlob(
            Blob.fromArray([4, Nat8.fromNat((n / 256) % 256), Nat8.fromNat(n % 256), 1])
        );
    };

    func register(db : Ashroot.DB, who : Principal, handle : Text) {
        switch (Profiles.register(db, who, 1, input(handle))) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("register failed for " # handle);
        };
    };

    /// Register somebody and hand them the moderator flag.
    ///
    /// Who grants it is cosmetic — `setModerator` is controller-gated in the
    /// actor rather than in the module — so both grants are logged against the
    /// first moderator.
    func moderator(db : Ashroot.DB, who : Principal, handle : Text) {
        register(db, who, handle);
        switch (RoleTargets.setModerator(db, MOD, handle, true, null, 1)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("moderator failed for " # handle);
        };
    };

    /// Approve a sponsorship the way the rule requires: one vote each, from two
    /// different moderators.
    ///
    /// `Moderation.SECONDS_NEEDED` of them must back it, because a pledged
    /// ledger is a canister id this canister will later be asked to call — the
    /// exact shape of thing one careless moderator account gets used for. The
    /// controller escape hatch is not available here: none of these principals
    /// is a canister controller inside a test, and both moderators have profile
    /// rows either way, so the approval really does go through two people.
    ///
    /// The first vote is expected to be held, which is asserted rather than
    /// shrugged at — every sweep below depends on this having actually landed.
    func approveSponsor(db : Ashroot.DB, handle : Text) {
        switch (RoleTargets.setSponsor(db, MOD, handle, #approved, null, 11)) {
            case (#err(#NeedsSecond({ votes; needed }))) {
                assert votes == 1;
                assert needed == Moderation.SECONDS_NEEDED;
            };
            case _ Runtime.trap("one moderator should not have carried " # handle);
        };
        switch (RoleTargets.setSponsor(db, MOD2, handle, #approved, null, 12)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("approve failed for " # handle);
        };
    };

    func approveJudge(db : Ashroot.DB, handle : Text) {
        ignore RoleTargets.setJudge(db, MOD, handle, #approved, null, 11);
        switch (RoleTargets.setJudge(db, MOD2, handle, #approved, null, 12)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("approve judge failed for " # handle);
        };
    };

    /// A world in which money is allowed to move: two moderators exist, `helix`
    /// is a sponsor pledging `ledgers`, and — unless told otherwise — the
    /// sponsorship is approved and a season is running.
    ///
    /// Everybody registers before the season is started, and has to: starting
    /// one closes the doors, so a registration after that point is refused.
    func world(
        db : Ashroot.DB,
        ledgers : [Principal],
        approve : Bool,
        start : Bool,
    ) : Profiles.User {
        Launch.configure(db, ledgers);
        moderator(db, MOD, "zz_mod");
        moderator(db, MOD2, "zz_mod2");
        moderator(db, principalFor(60_000), "zz_mod3");
        if (start) {
            var judgeNo = 0;
            while (judgeNo < Season.MIN_LAUNCH_JUDGES) {
                let handle = "zz_launch_judge" # Nat.toText(judgeNo);
                let who = principalFor(61_000 + judgeNo);
                register(db, who, handle);
                ignore Profiles.applyAsJudge(db, who, 2);
                approveJudge(db, handle);
                judgeNo += 1;
            };
        };
        register(db, SPONSOR, "helix");

        // The jurisdiction declaration a sponsor makes before applying —
        // `applyAsSponsor` refuses without it, because sponsoring is sending
        // money.

        switch (
            Profiles.applyAsSponsor(
                db,
                SPONSOR,
                {
                    org = "Helix Labs";
                    website = "";
                    logo = null;
                    blurb = "";
                    ledgers = Array.map<Principal, { id : Principal; sns : Bool }>(
                        ledgers,
                        func(id) = { id; sns = false },
                    );
                    given = [];
                },
                10,
            )
        ) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("apply failed");
        };

        if (approve) {
            approveSponsor(db, "helix");
        } else if (start) {
            // A pending application cannot cross the launch boundary. Keep
            // `helix` deliberately unapproved for the authorization test, but
            // decide it and provide an independent approved backer so the
            // season itself still starts under production invariants.
            ignore RoleTargets.setSponsor(db, MOD, "helix", #no, null, 11);
            register(db, LAUNCH_SPONSOR, "launch_backer");
            switch (
                Profiles.applyAsSponsor(
                    db,
                    LAUNCH_SPONSOR,
                    {
                        org = "Fixture Backer";
                        website = "";
                        logo = null;
                        blurb = "";
                        ledgers = Array.map<Principal, { id : Principal; sns : Bool }>(
                            ledgers,
                            func(id) = { id; sns = false },
                        );
                        given = [];
                    },
                    11,
                )
            ) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("launch backer apply failed");
            };
            approveSponsor(db, "launch_backer");
        };
        if (start) {
            let created = switch (Season.create(db, 13)) {
                case (#ok(s)) s;
                case (#err(_)) Runtime.trap("create failed");
            };
            db.store.set({ db.store.get() with registrationOpen = false });
            switch (Season.start(db, created.id, 14)) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("start failed");
            };
        };

        let ?user = Profiles.byHandle(db, "helix") else Runtime.trap("no sponsor");
        user;
    };

    func depositOf(user : Profiles.User) : Treasury.Account = {
        owner = CANISTER;
        subaccount = ?Treasury.subaccountFor(user.id);
    };

    func gifts(db : Ashroot.DB) : [{ ledger : Principal; amount : Nat; at : Nat64 }] {
        let ?user = Profiles.byHandle(db, "helix") else Runtime.trap("no sponsor");
        switch (user.sponsor) {
            case (?info) info.given;
            case null [];
        };
    };

    // ── Sweeping ─────────────────────────────────────────────────────────────

    public func a_sweep_moves_the_balance_less_the_fee() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], true, true);
        let ledger = Fake.Fake(FEE, CANISTER);
        ledger.credit(depositOf(user), 500_000_000);

        let moved = switch (await* Treasury.sweep(db, ledger.api(), CANISTER, "helix", ICP, 20)) {
            case (#ok(n)) n;
            case (#err(_)) Runtime.trap("sweep failed");
        };

        Test.test(
            func() {
                // The fee comes out of what was sent, never out of the treasury.
                assert moved == 500_000_000 - FEE;
                assert ledger.balanceOf(Treasury.treasury(CANISTER)) == 500_000_000 - FEE;
                assert ledger.balanceOf(depositOf(user)) == 0;
                // And what arrived is on the record, for the sponsors board.
                let given = gifts(db);
                assert given.size() == 1;
                assert given[0].amount == 500_000_000 - FEE;
                assert given[0].ledger == ICP;
            }
        );
    };

    public func sweeping_twice_accumulates_rather_than_doubling() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], true, true);
        let ledger = Fake.Fake(FEE, CANISTER);

        ledger.credit(depositOf(user), 100_000);
        ignore await* Treasury.sweep(db, ledger.api(), CANISTER, "helix", ICP, 20);
        // A sponsor topping up later is swept again; the record adds up rather
        // than showing two separate gifts on the same token.
        ledger.credit(depositOf(user), 300_000);
        ignore await* Treasury.sweep(db, ledger.api(), CANISTER, "helix", ICP, 30);

        let given = gifts(db);
        let held = ledger.balanceOf(Treasury.treasury(CANISTER));

        Test.test(
            func() {
                assert given.size() == 1;
                assert given[0].amount == (100_000 - FEE) + (300_000 - FEE);
                assert held == given[0].amount;
            }
        );
    };

    public func an_empty_deposit_moves_nothing() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], true, true);
        let ledger = Fake.Fake(FEE, CANISTER);
        // Exactly the fee: transferring it would cost more than it is worth.
        ledger.credit(depositOf(user), FEE);

        let outcome = await* Treasury.sweep(db, ledger.api(), CANISTER, "helix", ICP, 20);
        let held = ledger.balanceOf(Treasury.treasury(CANISTER));

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#Nothing)) {};
                    case (_) Runtime.trap("expected #Nothing");
                };
                assert held == 0;
                assert gifts(db).size() == 0;
            }
        );
    };

    public func an_unpledged_ledger_is_refused() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], true, true);
        let ledger = Fake.Fake(FEE, CANISTER);
        ledger.credit(depositOf(user), 500_000);

        // A ledger the sponsor never named: otherwise anyone able to trigger a
        // sweep could point the canister at an arbitrary token.
        let outcome = await* Treasury.sweep(db, ledger.api(), CANISTER, "helix", CKBTC, 20);

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#NoLedger)) {};
                    case (_) Runtime.trap("expected #NoLedger");
                };
                assert ledger.balanceOf(depositOf(user)) == 500_000;
            }
        );
    };

    public func an_unapproved_sponsor_is_refused() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], false, true);
        let ledger = Fake.Fake(FEE, CANISTER);
        ledger.credit(depositOf(user), 500_000);

        let outcome = await* Treasury.sweep(db, ledger.api(), CANISTER, "helix", ICP, 20);

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#NotASponsor)) {};
                    case (_) Runtime.trap("expected #NotASponsor");
                };
                // The money stays where the sponsor put it.
                assert ledger.balanceOf(depositOf(user)) == 500_000;
            }
        );
    };

    public func nothing_moves_without_a_running_season() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], true, false);
        let ledger = Fake.Fake(FEE, CANISTER);
        ledger.credit(depositOf(user), 500_000);

        let outcome = await* Treasury.sweep(db, ledger.api(), CANISTER, "helix", ICP, 20);

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#NoSeason)) {};
                    case (_) Runtime.trap("expected #NoSeason");
                };
                assert ledger.balanceOf(depositOf(user)) == 500_000;
            }
        );
    };

    // ── When the ledger misbehaves ───────────────────────────────────────────

    public func a_ledger_error_leaves_the_money_alone() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], true, true);
        let ledger = Fake.Fake(FEE, CANISTER);
        ledger.credit(depositOf(user), 500_000);
        ledger.script(#fail(#TemporarilyUnavailable));

        let outcome = await* Treasury.sweep(db, ledger.api(), CANISTER, "helix", ICP, 20);

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#Transfer(_))) {};
                    case (_) Runtime.trap("expected #Transfer");
                };
                // Nothing moved and nothing was recorded as given — a failed
                // sweep must not credit the sponsor with a gift.
                assert ledger.balanceOf(depositOf(user)) == 500_000;
                assert ledger.balanceOf(Treasury.treasury(CANISTER)) == 0;
                assert gifts(db).size() == 0;
            }
        );
    };

    public func a_rejected_call_is_caught_rather_than_trapping() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], true, true);
        let ledger = Fake.Fake(FEE, CANISTER);
        ledger.credit(depositOf(user), 500_000);
        // A ledger that is stopped or out of cycles rejects the call outright.
        // That arrives as an Error, not as an #Err, and must not take the
        // whole message down with it.
        ledger.script(#reject("canister is stopped"));

        let outcome = await* Treasury.sweep(db, ledger.api(), CANISTER, "helix", ICP, 20);

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#Transfer(_))) {};
                    case (_) Runtime.trap("expected #Transfer from a rejected call");
                };
                assert ledger.balanceOf(depositOf(user)) == 500_000;
                assert gifts(db).size() == 0;
            }
        );
    };

    public func a_rejected_cleanup_call_uses_the_guarded_fallback() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], true, true);
        let ledger = Fake.Fake(FEE, CANISTER);
        ledger.credit(depositOf(user), 500_000);

        var inFlight = 0;
        var cleanups = 0;
        func transferStarted() : Bool {
            inFlight += 1;
            true;
        };
        func transferFinishedSync() {
            if (inFlight == 0) return;
            inFlight -= 1;
            cleanups += 1;
        };
        // Models a cleanup self-call refused before its guarded decrement ran.
        // Treasury must catch that rejection and invoke the same decrement in
        // the already-running ledger callback.
        func transferFinished() : async () {
            Runtime.trap("simulated cleanup call rejection");
        };

        let outcome = await* Treasury.reconcile(
            db,
            ledger.api(),
            CANISTER,
            user.id,
            ICP,
            20,
            func() = true,
            transferStarted,
            transferFinished,
            transferFinishedSync,
        );

        Test.test(
            func() {
                switch (outcome) {
                    case (#ok(amount)) assert amount == 500_000 - FEE;
                    case (#err(_)) Runtime.trap("the transfer should still succeed");
                };
                assert inFlight == 0;
                assert cleanups == 1;
                assert ledger.balanceOf(Treasury.treasury(CANISTER)) == 500_000 - FEE;
                assert gifts(db).size() == 0; // recovery observes the balance; fallback does no DB work
                // The production helper is guarded too: a duplicated cleanup
                // cannot underflow or count twice.
                transferFinishedSync();
                assert inFlight == 0;
                assert cleanups == 1;
            }
        );
    };

    public func a_ledger_error_commits_exactly_one_cleanup() : async Test.Metrics {
        let db = fresh();
        let user = world(db, [ICP], true, true);
        let ledger = Fake.Fake(FEE, CANISTER);
        ledger.credit(depositOf(user), 500_000);
        ledger.script(#fail(#TemporarilyUnavailable));

        var inFlight = 0;
        var cleanups = 0;
        func transferStarted() : Bool {
            inFlight += 1;
            true;
        };
        func transferFinishedSync() {
            if (inFlight == 0) return;
            inFlight -= 1;
            cleanups += 1;
        };
        func transferFinished() : async () { transferFinishedSync() };

        let outcome = await* Treasury.reconcile(
            db,
            ledger.api(),
            CANISTER,
            user.id,
            ICP,
            20,
            func() = true,
            transferStarted,
            transferFinished,
            transferFinishedSync,
        );

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#Transfer(_))) {};
                    case (_) Runtime.trap("expected the scripted ledger error");
                };
                assert inFlight == 0;
                assert cleanups == 1;
                assert gifts(db).size() == 0;
            }
        );
    };

    // ── Custody addresses ────────────────────────────────────────────────────

    public func reward_and_deposit_addresses_never_collide() : async Test.Metrics {
        Test.test(
            func() {
                // Byte 0 is the domain tag, so the two derivations occupy
                // disjoint halves of the address space whatever the ids.
                var id : Nat64 = 0;
                while (id < 40) {
                    let deposit = Treasury.subaccountFor(id);
                    let reward = Treasury.rewardSubaccountFor(id);
                    assert deposit != reward;
                    assert deposit.size() == 32;
                    assert reward.size() == 32;
                    // …and no id's reward address is any other id's deposit.
                    var other : Nat64 = 0;
                    while (other < 40) {
                        assert reward != Treasury.subaccountFor(other);
                        if (other != id) {
                            assert reward != Treasury.rewardSubaccountFor(other);
                        };
                        other += 1;
                    };
                    id += 1;
                };
                // The treasury is the default account; nobody derives it.
                let zero = Treasury.subaccountFor(0);
                var who : Nat64 = 1;
                while (who < 40) {
                    assert Treasury.rewardSubaccountFor(who) != zero;
                    assert Treasury.subaccountFor(who) != zero;
                    who += 1;
                };
            }
        );
    };

    // ── Splitting the pool ───────────────────────────────────────────────────

    /// A claim, with a destination that is never used here.
    ///
    /// `shares` is pure arithmetic over weights — it never looks at where the
    /// money would go. The field exists because a real claim now carries the
    /// wallet it was frozen against, and a distinct principal per id keeps the
    /// fixture honest about that even though nothing reads it.
    func claim(id : Nat64, award : Payout.Award) : Payout.Claim = {
        userId = id;
        // One claim per winning app, so a claim names an entry as well as a
        // person. `shares` reads neither; the fixture keeps them distinct so a
        // future assertion about which app was paid has something to read.
        entryId = id;
        award;
        weight = Payout.weightOf(award);
        to = Principal.fromBlob(Blob.fromArray([Nat8.fromNat(Nat64.toNat(id % 256)), 1]));
    };

    public func a_full_field_matches_the_published_split() : async Test.Metrics {
        Test.test(
            func() {
                // 18 bronze, 1 silver, 1 gold is what a full season pays, and
                // the published split says 2.5% / 20% / 35%.
                var who : [Payout.Claim] = [];
                var i : Nat64 = 1;
                while (i <= 18) { who := Array.concat(who, [claim(i, #bronze)]); i += 1 };
                who := Array.concat(who, [claim(19, #silver), claim(20, #gold)]);

                let pool = 1_000_000;
                let cut = Payout.shares(pool, who);
                assert cut[0] == 25_000; // 2.5%
                assert cut[18] == 200_000; // 20%
                assert cut[19] == 350_000; // 35%

                var paid = 0;
                for (n in cut.vals()) { paid += n };
                // Everything but integer-division dust.
                assert paid <= pool;
                assert pool - paid < cut.size();
            }
        );
    };

    public func a_thin_field_still_pays_the_whole_pool() : async Test.Metrics {
        Test.test(
            func() {
                // Two entrants across the whole season. Fixed percentages would
                // hand out 37.5% and strand the rest in the treasury forever.
                let who = [claim(1, #gold), claim(2, #bronze)];
                let pool = 1_000_000;
                let cut = Payout.shares(pool, who);

                var paid = 0;
                for (n in cut.vals()) { paid += n };
                assert pool - paid < who.size();

                // Weights 3500 and 250 out of 3750 between them, so gold takes
                // 93.33% and bronze 6.66% — the published *ratio* preserved,
                // renormalised onto the two people who actually turned up.
                // Both truncate down, which is why the ratio is not exactly
                // 14 and the leftover unit stays in the treasury.
                assert cut[0] == 933_333;
                assert cut[1] == 66_666;
                assert pool - paid == 1;
            }
        );
    };

    public func a_lone_winner_takes_everything() : async Test.Metrics {
        Test.test(
            func() {
                let cut = Payout.shares(999_999, [claim(1, #gold)]);
                assert cut[0] == 999_999;
            }
        );
    };

    public func nobody_owed_means_nothing_allocated() : async Test.Metrics {
        Test.test(
            func() {
                assert Payout.shares(1_000_000, []).size() == 0;
            }
        );
    };

    // ── Addresses ────────────────────────────────────────────────────────────

    public func deposit_addresses_are_distinct_and_stable() : async Test.Metrics {
        Test.test(
            func() {
                // Every sponsor gets their own, and the same one every time —
                // a published address that moved would strand tokens.
                assert Treasury.subaccountFor(1) == Treasury.subaccountFor(1);
                assert Treasury.subaccountFor(1) != Treasury.subaccountFor(2);
                // Ids start at 1, so no sponsor can be handed the treasury's
                // own address.
                let zero = Treasury.subaccountFor(0);
                assert Treasury.subaccountFor(1) != zero;
                assert zero.size() == 32;
            }
        );
    };
};
