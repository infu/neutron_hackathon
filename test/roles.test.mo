import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Test "mo:test";

import Ashroot "../backend/.ashroot/lib";
import Defaults "../backend/support/defaults";
import Moderation "../backend/lib/Moderation";
import Profiles "../backend/lib/Profiles";
import Treasury "../backend/lib/Treasury";
import RoleTargets "./support/RoleTargets";

/// Roles stack. A user can be a hacker, a judge, a sponsor and a moderator at
/// the same time; "observer" is the absence of all of them.
persistent actor RoleTests {

    transient let MOD = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");
    transient let MOD2 = Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai");
    transient let ALICE = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    transient let BOB = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

    func fresh() : Ashroot.DB {
        let db = Ashroot.Use(Ashroot.Mem(), Defaults.store());
        db.store.set({
            db.store.get() with
            ledgerAllowlistSet = true;
            ledgerAllowlist = [
                Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai"),
                Principal.fromText("mxzaz-hqaaa-aaaar-qaada-cai"),
                Principal.fromText("cngnf-vqaaa-aaaar-qag4q-cai"),
            ];
        });
        db;
    };

    func input(handle : Text) : Profiles.Input = {
        handle;
        displayName = "Display " # handle;
        title = null;
        bio = "";
        links = [];
        terms = true;
    };

    func register(db : Ashroot.DB, who : Principal, handle : Text) : Profiles.User {
        switch (Profiles.register(db, who, 1, input(handle))) {
            case (#ok(user)) user;
            case (#err(_)) Runtime.trap("register failed for " # handle);
        };
    };

    func sponsorInfo() : Profiles.SponsorInfo = {
        org = "Helix Labs";
        website = "https://helix.example";
        logo = null;
        blurb = "We build tooling.";
        // The ICRC-1 ledgers they intend to pay in. The deposit subaccount is
        // derived from the user id, so one address serves them all.
        ledgers = [];
        given = [];
    };

    /// Two of them, because approving a judge or a sponsor takes two
    /// moderators. Neither principal is a controller inside a test, so they
    /// need the flag themselves — and the controller escape hatch in `quorum`
    /// is out of reach here anyway, since both have a profile row.
    func withModerators(db : Ashroot.DB) {
        for ((who, handle) in [(MOD, "zz_mod"), (MOD2, "zz_mod2")].vals()) {
            ignore register(db, who, handle);
            switch (RoleTargets.setModerator(db, MOD, handle, true, null, 1)) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("setModerator failed for " # handle);
            };
        };
    };

    /// Approving a judge or a sponsor takes `Moderation.SECONDS_NEEDED`
    /// moderators: the first call is refused with `#NeedsSecond` and only a
    /// second, *different* moderator applies it. Every approval below goes
    /// through these two helpers, so the rule is pinned here — once — rather
    /// than re-spelled in each fixture. The refusal is asserted rather than
    /// ignored, because a backend that let one moderator through on its own
    /// would otherwise sail through this whole file.
    func approveJudge(db : Ashroot.DB, handle : Text, note : ?Text, at : Nat64) : Profiles.User {
        switch (RoleTargets.setJudge(db, MOD, handle, #approved, note, at)) {
            case (#err(#NeedsSecond(tally))) {
                assert tally.votes == 1;
                assert tally.needed == Moderation.SECONDS_NEEDED;
            };
            case _ Runtime.trap("one moderator approved judge " # handle);
        };
        switch (RoleTargets.setJudge(db, MOD2, handle, #approved, note, at)) {
            case (#ok(user)) user;
            case (#err(_)) Runtime.trap("setJudge failed for " # handle);
        };
    };

    func approveSponsor(db : Ashroot.DB, handle : Text, note : ?Text, at : Nat64) : Profiles.User {
        switch (RoleTargets.setSponsor(db, MOD, handle, #approved, note, at)) {
            case (#err(#NeedsSecond(tally))) {
                assert tally.votes == 1;
                assert tally.needed == Moderation.SECONDS_NEEDED;
            };
            case _ Runtime.trap("one moderator approved sponsor " # handle);
        };
        switch (RoleTargets.setSponsor(db, MOD2, handle, #approved, note, at)) {
            case (#ok(user)) user;
            case (#err(_)) Runtime.trap("setSponsor failed for " # handle);
        };
    };

    func reload(db : Ashroot.DB, handle : Text) : Profiles.User {
        let ?user = Profiles.byHandle(db, handle) else Runtime.trap("missing " # handle);
        user;
    };

    // ── Defaults ─────────────────────────────────────────────────────────────

    public func registration_defaults_to_observer() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let user = register(db, ALICE, "alice");
                assert not user.hacker;
                assert user.judgeStatus == #no;
                assert user.sponsorStatus == #no;
                assert not user.moderator;
                assert user.sponsor == null;
                assert Profiles.isObserver(user);

                let c = Profiles.counts(db);
                assert c.observers == 1;
                assert c.hackers == 0;
            }
        );
    };

    // ── Stacking ─────────────────────────────────────────────────────────────

    public func a_user_can_hold_every_role_at_once() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                ignore register(db, ALICE, "alice");

                ignore Profiles.setHacker(db, ALICE, true, 2);
                ignore Profiles.applyAsJudge(db, ALICE, 3);
                ignore approveJudge(db, "alice", null, 4);
                ignore Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 5);
                ignore approveSponsor(db, "alice", null, 6);
                ignore RoleTargets.setModerator(db, MOD, "alice", true, null, 7);

                let user = reload(db, "alice");
                assert user.hacker;
                assert user.judgeStatus == #approved;
                assert user.sponsorStatus == #approved;
                assert user.moderator;
                assert not Profiles.isObserver(user);

                // And they show up under every corresponding filter.
                assert Profiles.page(db, #hackers, null, null, 10).total == 1;
                assert Profiles.page(db, #judges, null, null, 10).total == 1;
                assert Profiles.page(db, #sponsors, null, null, 10).total == 1;
                // The two fixture moderators are in that index as well.
                assert Profiles.page(db, #moderators, null, null, 10).total == 3;
            }
        );
    };

    /// Taking any role stops you being an observer, and dropping them all
    /// makes you one again — the derived index has to keep up.
    public func observer_is_the_absence_of_every_role() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore register(db, ALICE, "alice");
                assert Profiles.counts(db).observers == 1;

                ignore Profiles.setHacker(db, ALICE, true, 2);
                assert Profiles.counts(db).observers == 0;
                assert Profiles.counts(db).hackers == 1;

                ignore Profiles.setHacker(db, ALICE, false, 3);
                assert Profiles.counts(db).observers == 1;
                assert Profiles.counts(db).hackers == 0;

                // A pending application also counts as having a role.
                ignore Profiles.applyAsJudge(db, ALICE, 4);
                assert Profiles.counts(db).observers == 0;
            }
        );
    };

    public func hacking_is_self_service() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore register(db, ALICE, "alice");
                switch (Profiles.setHacker(db, ALICE, true, 2)) {
                    case (#ok(user)) assert user.hacker;
                    case (#err(_)) Runtime.trap("setHacker failed");
                };
                // Idempotent, and reversible without anyone's approval.
                switch (Profiles.setHacker(db, ALICE, true, 3)) {
                    case (#ok(user)) assert user.hacker;
                    case (#err(_)) Runtime.trap("setHacker failed");
                };
                switch (Profiles.setHacker(db, ALICE, false, 4)) {
                    case (#ok(user)) assert not user.hacker;
                    case (#err(_)) Runtime.trap("setHacker failed");
                };
            }
        );
    };

    public func a_stranger_cannot_take_a_role() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                switch (Profiles.setHacker(db, ALICE, true, 1)) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("expected NotRegistered");
                };
                switch (Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 1)) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("expected NotRegistered");
                };
            }
        );
    };

    // ── Sponsors ─────────────────────────────────────────────────────────────

    /// The application input is the whole stored sponsor record, `given`
    /// included — so the only thing stopping an applicant from naming their own
    /// contributions is `applyAsSponsor` refusing to read that field.
    public func an_applicant_cannot_name_their_own_contributions() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                let alice = register(db, ALICE, "alice");
                ignore Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 2);
                ignore approveSponsor(db, "alice", null, 3);

                // One real sweep, recorded the only way it can be.
                let ledger = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
                let ?approved = Profiles.byPrincipal(db, ALICE) else Runtime.trap("no alice");
                switch (Profiles.recordGift(db, approved.id, ledger, 500, 4)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("recordGift failed");
                };

                // Now re-apply, claiming a fortune on a ledger never touched.
                let forged : Profiles.SponsorInfo = {
                    sponsorInfo() with
                    given = [{ ledger; amount = 999_999_999; at = 5 }];
                };
                ignore Profiles.withdrawSponsor(db, ALICE, 5);
                switch (Profiles.applyAsSponsor(db, ALICE, forged, 5)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("applyAsSponsor failed");
                };

                let ?after = Profiles.byPrincipal(db, ALICE) else Runtime.trap("no alice");
                let ?info = after.sponsor else Runtime.trap("no sponsor");
                assert info.given.size() == 1;
                assert info.given[0].amount == 500;
                // And editing with an empty array must not erase the history.
                switch (Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 6)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("applyAsSponsor failed");
                };
                let ?final = Profiles.byPrincipal(db, ALICE) else Runtime.trap("no alice");
                let ?kept = final.sponsor else Runtime.trap("no sponsor");
                assert kept.given.size() == 1;
                assert kept.given[0].amount == 500;
                ignore alice;
            }
        );
    };

    public func sponsorship_needs_approval() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                ignore register(db, ALICE, "alice");

                switch (Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 2)) {
                    case (#ok(user)) {
                        assert user.sponsorStatus == #pending;
                        assert user.sponsor != null;
                    };
                    case (#err(_)) Runtime.trap("applyAsSponsor failed");
                };

                assert Profiles.counts(db).sponsors == 0;
                assert Profiles.counts(db).sponsorsPending == 1;

                // Two moderators, per `approveSponsor`. The note travels with
                // both calls but only the one that applies the change writes a
                // log row, so that is the note the history carries.
                assert approveSponsor(db, "alice", ?"verified", 3).sponsorStatus == #approved;
                assert Profiles.counts(db).sponsors == 1;
                assert Profiles.counts(db).sponsorsPending == 0;
            }
        );
    };

    public func same_timestamp_sponsor_edit_invalidates_the_reviewed_snapshot() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                let alice = register(db, ALICE, "alice");
                let first = switch (Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 2)) {
                    case (#ok(user)) user;
                    case (#err(_)) Runtime.trap("first application failed");
                };
                let reviewed = RoleTargets.sponsorOf(first);
                switch (Moderation.setSponsor(db, MOD, reviewed, #approved, null, 2)) {
                    case (#err(#NeedsSecond({ votes; needed }))) {
                        assert votes == 1;
                        assert needed == Moderation.SECONDS_NEEDED;
                    };
                    case _ Runtime.trap("first application vote did not wait");
                };

                let changed = { sponsorInfo() with blurb = "Changed after review." };
                let second = switch (
                    Profiles.applyAsSponsor(db, ALICE, changed, first.updatedAt)
                ) {
                    case (#ok(user)) user;
                    case (#err(_)) Runtime.trap("same-timestamp edit failed");
                };
                // `main.apply_as_sponsor` clears the old application's backing
                // after the replacement validates and saves.
                Moderation.clearBacking(db, alice.id, #sponsor);
                assert second.updatedAt > first.updatedAt;
                assert second.sponsorStatus == #pending;

                switch (Moderation.setSponsor(db, MOD2, reviewed, #approved, null, 3)) {
                    case (#err(#Invalid(message))) {
                        assert message == "the account or application changed; refresh and try again";
                    };
                    case _ Runtime.trap("an old review approved changed sponsor details");
                };
                let ?saved = Profiles.byHandle(db, "alice") else Runtime.trap("missing alice");
                let ?info = saved.sponsor else Runtime.trap("changed details disappeared");
                assert saved.sponsorStatus == #pending;
                assert info.blurb == "Changed after review.";
                assert Moderation.backers(db, alice.id, #sponsor).size() == 0;
                assert Moderation.historyFor(db, alice.id, null, 10).rows.size() == 0;
            }
        );
    };

    /// The details are the card; approving without them would publish a blank.
    ///
    /// Deliberately not routed through `approveSponsor`: the missing-details
    /// check runs before the quorum check, so the very first moderator is told
    /// `#Invalid` rather than being asked to find a second — no vote is ever
    /// cast for a card that cannot exist.
    public func approving_a_sponsor_without_details_is_refused() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                ignore register(db, ALICE, "alice");
                switch (RoleTargets.setSponsor(db, MOD, "alice", #approved, null, 2)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("expected Invalid");
                };
            }
        );
    };

    /// Approved ledger/details were reviewed as one record. Editing requires a
    /// withdrawal and a fresh pending application rather than silently keeping
    /// the old approval.
    public func editing_an_approved_sponsorship_requires_reapplication() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                ignore register(db, ALICE, "alice");
                ignore Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 2);
                ignore approveSponsor(db, "alice", null, 3);

                let edited = { sponsorInfo() with blurb = "Now with a new blurb." };
                switch (Profiles.applyAsSponsor(db, ALICE, edited, 4)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("approved sponsor edited without reapplication");
                };
                ignore Profiles.withdrawSponsor(db, ALICE, 5);
                switch (Profiles.applyAsSponsor(db, ALICE, edited, 6)) {
                    case (#ok(user)) {
                        assert user.sponsorStatus == #pending;
                        let ?info = user.sponsor else Runtime.trap("details lost");
                        assert info.blurb == "Now with a new blurb.";
                    };
                    case (#err(_)) Runtime.trap("reapplication failed");
                };
            }
        );
    };

    public func sponsor_details_are_validated() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore register(db, ALICE, "alice");

                let noOrg = { sponsorInfo() with org = "" };
                switch (Profiles.applyAsSponsor(db, ALICE, noOrg, 2)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("expected Invalid for empty org");
                };

                let badSite = { sponsorInfo() with website = "javascript:alert(1)" };
                switch (Profiles.applyAsSponsor(db, ALICE, badSite, 2)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("expected Invalid for bad website");
                };

                // An empty website is fine — it is optional.
                let noSite = { sponsorInfo() with website = "" };
                switch (Profiles.applyAsSponsor(db, ALICE, noSite, 2)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("empty website should be allowed");
                };
            }
        );
    };

    public func withdrawing_keeps_the_details() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore register(db, ALICE, "alice");
                ignore Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 2);

                switch (Profiles.withdrawSponsor(db, ALICE, 3)) {
                    case (#ok(user)) {
                        assert user.sponsorStatus == #no;
                        // Re-applying should not mean retyping everything.
                        assert user.sponsor != null;
                    };
                    case (#err(_)) Runtime.trap("withdrawSponsor failed");
                };
            }
        );
    };

    public func sponsor_rejection_and_revocation_are_distinct() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                ignore register(db, ALICE, "alice");
                ignore register(db, BOB, "bob");
                ignore Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 2);
                ignore Profiles.applyAsSponsor(db, BOB, sponsorInfo(), 2);

                // pending -> no is a rejection, and one moderator's call:
                // the reversible direction does not need a quorum.
                ignore RoleTargets.setSponsor(db, MOD, "alice", #no, null, 3);
                // pending -> approved -> no is a revocation. Only the approval
                // in the middle takes two, and the revocation then discards
                // both votes, so nobody is put back by a single click later.
                ignore approveSponsor(db, "bob", null, 3);
                ignore RoleTargets.setSponsor(db, MOD, "bob", #no, null, 4);

                let log = Moderation.history(db, null, 10).rows;
                assert Moderation.kindTag(log[0].kind) == "sponsor_revoked";
                assert Moderation.kindTag(log[1].kind) == "sponsor_approved";
                assert Moderation.kindTag(log[2].kind) == "sponsor_rejected";

                let rejected = reload(db, "alice");
                assert rejected.sponsorStatus == #no;
                assert rejected.sponsor != null;
                switch (RoleTargets.setSponsor(db, MOD, "alice", #approved, null, 5)) {
                    case (#err(#Invalid(message))) {
                        assert message == "the sponsor must apply before approval";
                    };
                    case _ Runtime.trap("retained details bypassed sponsor reapplication");
                };
                switch (Profiles.applyAsSponsor(db, ALICE, sponsorInfo(), 6)) {
                    case (#ok(user)) assert user.sponsorStatus == #pending;
                    case (#err(_)) Runtime.trap("rejected sponsor could not reapply");
                };
                assert approveSponsor(db, "alice", null, 7).sponsorStatus == #approved;
            }
        );
    };

    public func a_plain_user_cannot_approve_a_sponsor() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore register(db, ALICE, "alice");
                ignore register(db, BOB, "bob");
                ignore Profiles.applyAsSponsor(db, BOB, sponsorInfo(), 2);

                switch (RoleTargets.setSponsor(db, ALICE, "bob", #approved, null, 3)) {
                    case (#err(#NotAllowed)) {};
                    case _ Runtime.trap("expected NotAllowed");
                };
                assert reload(db, "bob").sponsorStatus == #pending;
            }
        );
    };

    // ── Sparseness ───────────────────────────────────────────────────────────

    /// The role indexes are sparse: a projection returning null keeps the row
    /// out of the index entirely, rather than storing it under a "no" code.
    /// So an index costs its members, not the table.
    public func role_indexes_hold_only_members() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                ignore register(db, ALICE, "alice");
                ignore register(db, BOB, "bob");
                ignore Profiles.setHacker(db, ALICE, true, 2);

                // Four users, but only one is a hacker and only the two
                // fixture moderators are moderators.
                let c = Profiles.counts(db);
                assert c.users == 4;
                assert c.hackers == 1;
                assert c.moderators == 2;
                assert c.judges == 0;
                assert c.sponsors == 0;

                // Nobody has ever applied, so those indexes are empty rather
                // than holding three "no" rows.
                assert Profiles.page(db, #judges, null, null, 10).total == 0;
                assert Profiles.page(db, #pending, null, null, 10).total == 0;
                assert Profiles.page(db, #sponsors, null, null, 10).total == 0;
            }
        );
    };

    /// Leaving a role must remove the entry, not leave a stale one behind.
    func ledger(text : Text) : Ashroot.Types.Users.User.Sponsor.Ledgers.Element = {
        id = Principal.fromText(text);
        sns = false;
    };

    let ICP = "ryjl3-tyaaa-aaaaa-aaaba-cai";
    let CKBTC = "mxzaz-hqaaa-aaaar-qaada-cai";
    let CKUSDT = "cngnf-vqaaa-aaaar-qag4q-cai";

    public func a_sponsor_may_pledge_several_ledgers() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let who = ALICE;
                ignore register(db, who, "helix");
                let many = { sponsorInfo() with ledgers = [ledger(ICP), ledger(CKBTC)] };

                switch (Profiles.applyAsSponsor(db, who, many, 10)) {
                    case (#ok(u)) {
                        switch (u.sponsor) {
                            case (?info) {
                                assert info.ledgers.size() == 2;
                                assert info.given.size() == 0;
                            };
                            case null Runtime.trap("no sponsor record");
                        };
                    };
                    case (#err(_)) Runtime.trap("apply failed");
                };
            }
        );
    };

    public func the_same_ledger_twice_is_refused() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let who = ALICE;
                ignore register(db, who, "twice");
                // Listing one twice would sweep it twice and count it twice.
                let dup = { sponsorInfo() with ledgers = [ledger(ICP), ledger(ICP)] };
                switch (Profiles.applyAsSponsor(db, who, dup, 10)) {
                    case (#ok(_)) Runtime.trap("duplicate ledger accepted");
                    case (#err(_)) {};
                };
            }
        );
    };

    public func gifts_accumulate_per_ledger() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let who = ALICE;
                ignore register(db, who, "giver");
                let info = { sponsorInfo() with ledgers = [ledger(ICP), ledger(CKBTC)] };
                let user = switch (Profiles.applyAsSponsor(db, who, info, 10)) {
                    case (#ok(u)) u;
                    case (#err(_)) Runtime.trap("apply failed");
                };

                let icp = Principal.fromText(ICP);
                let ckbtc = Principal.fromText(CKBTC);
                let a = switch (Profiles.recordGift(db, user.id, icp, 500, 20)) {
                    case (#ok(u)) u;
                    case (#err(_)) Runtime.trap("record failed");
                };
                let b = switch (Profiles.recordGift(db, a.id, ckbtc, 7, 30)) {
                    case (#ok(u)) u;
                    case (#err(_)) Runtime.trap("record failed");
                };
                // A top-up on a ledger already given to adds to the running
                // total rather than appearing as a second row.
                let c = switch (Profiles.recordGift(db, b.id, icp, 250, 40)) {
                    case (#ok(u)) u;
                    case (#err(_)) Runtime.trap("record failed");
                };

                let ?given = (switch (c.sponsor) { case (?i) ?i.given; case null null }) else Runtime.trap("no sponsor");
                assert given.size() == 2;
                for (gift in given.vals()) {
                    if (gift.ledger == icp) { assert gift.amount == 750; assert gift.at == 40 };
                    if (gift.ledger == ckbtc) { assert gift.amount == 7 };
                };
            }
        );
    };

    public func only_approved_sponsors_put_ledgers_in_play() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);

                // Approved, pledging two.
                ignore register(db, ALICE, "alice");
                ignore Profiles.applyAsSponsor(
                    db,
                    ALICE,
                    { sponsorInfo() with ledgers = [ledger(ICP), ledger(CKBTC)] },
                    5,
                );
                ignore approveSponsor(db, "alice", null, 6);

                // Applied but not approved: their ledger must not appear, or a
                // moderator would be shown balances for a sponsor nobody vetted.
                ignore register(db, BOB, "bob");
                ignore Profiles.applyAsSponsor(
                    db,
                    BOB,
                    { sponsorInfo() with ledgers = [ledger(CKUSDT)] },
                    7,
                );

                let inPlay = Treasury.ledgersInPlay(db);
                assert inPlay.size() == 2;
                var sawIcp = false;
                var sawCkbtc = false;
                for (id in inPlay.vals()) {
                    if (id == Principal.fromText(ICP)) sawIcp := true;
                    if (id == Principal.fromText(CKBTC)) sawCkbtc := true;
                    assert id != Principal.fromText(CKUSDT);
                };
                assert sawIcp and sawCkbtc;
            }
        );
    };

    public func a_shared_ledger_is_listed_once() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                // Two sponsors both paying in ICP is one balance to read, not
                // two.
                for ((who, handle) in [(ALICE, "alice"), (BOB, "bob")].vals()) {
                    ignore register(db, who, handle);
                    ignore Profiles.applyAsSponsor(
                        db,
                        who,
                        { sponsorInfo() with ledgers = [ledger(ICP)] },
                        5,
                    );
                    ignore approveSponsor(db, handle, null, 6);
                };
                assert Treasury.ledgersInPlay(db).size() == 1;
            }
        );
    };

    public func dropping_a_role_leaves_the_index() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                ignore register(db, ALICE, "alice");

                ignore Profiles.setHacker(db, ALICE, true, 2);
                assert Profiles.counts(db).hackers == 1;
                ignore Profiles.setHacker(db, ALICE, false, 3);
                assert Profiles.counts(db).hackers == 0;
                assert Profiles.page(db, #hackers, null, null, 10).rows.size() == 0;

                // Same for a staged role returning to #no, which one moderator
                // decides on their own.
                ignore Profiles.applyAsJudge(db, ALICE, 4);
                assert Profiles.counts(db).pending == 1;
                ignore RoleTargets.setJudge(db, MOD, "alice", #no, null, 5);
                assert Profiles.counts(db).pending == 0;
                assert Profiles.counts(db).judges == 0;
            }
        );
    };

    /// Moving between stages must move the entry, not duplicate it.
    public func changing_stage_moves_the_entry() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                ignore register(db, ALICE, "alice");
                ignore Profiles.applyAsJudge(db, ALICE, 2);

                assert Profiles.counts(db).pending == 1;
                assert Profiles.counts(db).judges == 0;

                ignore approveJudge(db, "alice", null, 3);
                assert Profiles.counts(db).pending == 0;
                assert Profiles.counts(db).judges == 1;

                // And back, without leaving a copy behind in #approved. A
                // reset is one moderator's call, and it drops the two votes
                // that got them approved.
                ignore RoleTargets.setJudge(db, MOD, "alice", #pending, null, 4);
                assert Profiles.counts(db).pending == 1;
                assert Profiles.counts(db).judges == 0;
                assert Profiles.page(db, #pending, null, null, 10).rows.size() == 1;
            }
        );
    };

    // ── Listing ──────────────────────────────────────────────────────────────

    public func filters_are_independent() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                withModerators(db);
                ignore register(db, ALICE, "alice");
                ignore register(db, BOB, "bob");

                ignore Profiles.setHacker(db, ALICE, true, 2);
                ignore Profiles.applyAsSponsor(db, BOB, sponsorInfo(), 2);
                ignore approveSponsor(db, "bob", null, 3);

                let c = Profiles.counts(db);
                assert c.users == 4;
                assert c.hackers == 1;
                assert c.sponsors == 1;
                assert c.moderators == 2;
                // Everyone has some role now, so nobody is an observer.
                assert c.observers == 0;

                // #all still spans the lot.
                assert Profiles.page(db, #all, null, null, 10).total == 4;
            }
        );
    };
};
