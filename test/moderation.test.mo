import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Nat8 "mo:core/Nat8";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Test "mo:test";

import Ashroot "../backend/.ashroot/lib";
import Defaults "../backend/support/defaults";
import Moderation "../backend/lib/Moderation";
import Notices "../backend/lib/Notices";
import Profiles "../backend/lib/Profiles";
import RoleTargets "./support/RoleTargets";

persistent actor ModerationTests {

    // None of these are canister controllers inside a test, so `canModerate`
    // comes down to the moderator flag alone — exactly what we want to test.
    transient let MOD = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");
    transient let MOD2 = Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai");
    transient let ALICE = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    transient let BOB = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

    func fresh() : Ashroot.DB {
        Ashroot.Use(Ashroot.Mem(), Defaults.store());
    };

    func principalFor(n : Nat) : Principal {
        Principal.fromBlob(
            Blob.fromArray([4, Nat8.fromNat((n / 256) % 256), Nat8.fromNat(n % 256), 1])
        );
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

    /// One registered moderator, which is enough for everything but an
    /// approval — see `withTwoModerators` for why those need a second.
    func withModerator() : Ashroot.DB {
        let db = fresh();
        ignore register(db, MOD, "mod");
        switch (RoleTargets.setModerator(db, MOD, "mod", true, null, 2)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("setModerator failed");
        };
        db;
    };

    /// Two moderators, because approving a judge or a sponsor takes two.
    ///
    /// `Moderation.SECONDS_NEEDED` *distinct* moderators must back an approval
    /// (the Roles section of the Rules page); rejecting, resetting and revoking stay single-moderator,
    /// so only the approvals in this file need the pair. There is no controller
    /// shortcut to fall back on either — that one is for a controller with no
    /// profile row, and both of these are ordinary registered users.
    ///
    /// Costs one extra `moderator_granted` row, which the tests that count the
    /// whole log allow for.
    func withTwoModerators() : Ashroot.DB {
        let db = withModerator();
        ignore register(db, MOD2, "mod2");
        switch (RoleTargets.setModerator(db, MOD2, "mod2", true, null, 2)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("setModerator failed");
        };
        db;
    };

    /// Approve a judge the way the rule requires: one vote each, from two
    /// different moderators. The first vote is expected to be held, so this
    /// pins the quorum on every approval path in the file.
    func approveJudge(db : Ashroot.DB, handle : Text, note : ?Text, now : Nat64) : Profiles.User {
        switch (RoleTargets.setJudge(db, MOD, handle, #approved, note, now)) {
            case (#err(#NeedsSecond({ votes; needed }))) {
                assert votes == 1;
                assert needed == Moderation.SECONDS_NEEDED;
            };
            case _ Runtime.trap("one moderator should not have carried " # handle);
        };
        switch (RoleTargets.setJudge(db, MOD2, handle, #approved, note, now)) {
            case (#ok(user)) user;
            case (#err(_)) Runtime.trap("setJudge failed for " # handle);
        };
    };

    // ── Moderator flag ───────────────────────────────────────────────────────

    public func new_users_are_not_moderators() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let user = register(db, ALICE, "alice");
                assert not user.moderator;
                assert not Profiles.canModerate(db, ALICE);
                assert Profiles.moderators(db, 10).size() == 0;
            }
        );
    };

    public func granting_moderator_takes_effect_and_is_logged() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                assert Profiles.canModerate(db, MOD);

                let mods = Profiles.moderators(db, 10);
                assert mods.size() == 1;
                assert mods[0].handle == "mod";

                let log = Moderation.history(db, null, 10).rows;
                assert log.size() == 1;
                assert Moderation.kindTag(log[0].kind) == "moderator_granted";
                assert log[0].byPrincipal == MOD;
                // The log resolves both people, so a reader sees handles.
                assert log[0].by == ?"mod";
                assert log[0].subject == ?"mod";
            }
        );
    };

    public func revoking_moderator_is_logged() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                switch (RoleTargets.setModerator(db, MOD, "mod", false, ?"stepped down", 3)) {
                    case (#ok(user)) assert not user.moderator;
                    case (#err(_)) Runtime.trap("setModerator failed");
                };
                assert Profiles.moderators(db, 10).size() == 0;

                let log = Moderation.history(db, null, 10).rows;
                assert log.size() == 2;
                // Newest first.
                assert Moderation.kindTag(log[0].kind) == "moderator_revoked";
                assert log[0].note == ?"stepped down";
            }
        );
    };

    public func rejects_a_no_op_change() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                switch (RoleTargets.setModerator(db, MOD, "mod", true, null, 3)) {
                    case (#err(#NoChange)) {};
                    case _ Runtime.trap("expected NoChange");
                };
                // Nothing new in the log.
                assert Moderation.history(db, null, 10).rows.size() == 1;
            }
        );
    };

    public func moderator_bench_is_bounded_and_a_revoked_seat_reopens() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                var i = 0;
                while (i < Profiles.MAX_MODERATORS) {
                    let handle = "bench_" # Nat.toText(i);
                    ignore register(db, principalFor(100 + i), handle);
                    switch (RoleTargets.setModerator(db, MOD, handle, true, null, 2)) {
                        case (#ok(_)) {};
                        case (#err(_)) Runtime.trap("moderator below the cap was refused");
                    };
                    i += 1;
                };
                assert Profiles.moderatorCount(db) == 8;

                ignore register(db, principalFor(200), "bench_overflow");
                switch (RoleTargets.setModerator(db, MOD, "bench_overflow", true, null, 3)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("ninth moderator was accepted");
                };

                switch (RoleTargets.setModerator(db, MOD, "bench_0", false, null, 4)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("moderator revocation failed");
                };
                switch (RoleTargets.setModerator(db, MOD, "bench_overflow", true, null, 5)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("reopened moderator seat was not reusable");
                };
                assert Profiles.moderatorCount(db) == 8;
            }
        );
    };

    // ── Authorization ────────────────────────────────────────────────────────

    public func a_plain_user_cannot_moderate() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                ignore register(db, ALICE, "alice");
                ignore register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 3);

                switch (RoleTargets.setJudge(db, ALICE, "bob", #approved, null, 4)) {
                    case (#err(#NotAllowed)) {};
                    case _ Runtime.trap("expected NotAllowed");
                };
                // Unchanged, and nothing logged beyond the moderator grant.
                let ?bob = Profiles.byHandle(db, "bob") else Runtime.trap("missing bob");
                assert bob.judgeStatus == #pending;
                assert Moderation.history(db, null, 10).rows.size() == 1;
            }
        );
    };

    public func an_unregistered_caller_cannot_moderate() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                ignore register(db, BOB, "bob");
                switch (RoleTargets.setJudge(db, ALICE, "bob", #approved, null, 4)) {
                    case (#err(#NotAllowed)) {};
                    case _ Runtime.trap("expected NotAllowed");
                };
            }
        );
    };

    public func anonymized_users_cannot_be_regranted_roles() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                let bob = register(db, BOB, "bob");
                let tombstone = switch (Profiles.anonymize(db, bob, 3)) {
                    case (#ok(saved)) saved;
                    case (#err(_)) Runtime.trap("could not anonymize bob");
                };

                switch (RoleTargets.setJudge(db, MOD, tombstone.handle, #pending, null, 4)) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("anonymized user regained judge status");
                };
                switch (RoleTargets.setSponsor(db, MOD, tombstone.handle, #pending, null, 4)) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("anonymized user regained sponsor status");
                };
                switch (RoleTargets.setModerator(db, MOD, tombstone.handle, true, null, 4)) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("anonymized user regained moderator status");
                };

                let ?historical = Profiles.byHandle(db, tombstone.handle) else {
                    Runtime.trap("historical row disappeared");
                };
                assert historical.anonymized;
                assert historical.judgeStatus == #no;
                assert historical.sponsorStatus == #no;
                assert not historical.moderator;
                assert Profiles.moderators(db, 10).size() == 1;
                assert Moderation.history(db, null, 10).rows.size() == 1;
            }
        );
    };

    // ── Judge transitions ────────────────────────────────────────────────────

    /// The vote is per moderator, so a lone one cannot get there by trying
    /// again: the second attempt is the same vote, not a second one.
    public func one_moderator_cannot_approve_by_voting_twice() : async Test.Metrics {
        Test.test(
            func() {
                let db = withTwoModerators();
                let bob = register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 3);

                switch (RoleTargets.setJudge(db, MOD, "bob", #approved, null, 4)) {
                    case (#err(#NeedsSecond({ votes; needed }))) {
                        assert votes == 1;
                        assert needed == 2;
                    };
                    case _ Runtime.trap("expected NeedsSecond");
                };
                switch (RoleTargets.setJudge(db, MOD, "bob", #approved, null, 5)) {
                    case (#err(#NeedsSecond({ votes }))) assert votes == 1;
                    case _ Runtime.trap("expected NeedsSecond");
                };
                assert Moderation.backers(db, bob.id, #judge).size() == 1;
                assert Moderation.tallyFor(db, bob.id, #judge).votes == 1;

                // Nothing happened to bob, and nothing was logged about him.
                let ?held = Profiles.byHandle(db, "bob") else Runtime.trap("missing bob");
                assert held.judgeStatus == #pending;
                assert Moderation.historyFor(db, bob.id, null, 10).rows.size() == 0;

                // A different moderator is what carries it.
                switch (RoleTargets.setJudge(db, MOD2, "bob", #approved, null, 6)) {
                    case (#ok(user)) assert user.judgeStatus == #approved;
                    case (#err(_)) Runtime.trap("setJudge failed");
                };
            }
        );
    };

    public func a_snapshot_survives_quorum_but_not_the_decision() : async Test.Metrics {
        Test.test(
            func() {
                let db = withTwoModerators();
                let bob = register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 3);
                let ?pending = Profiles.byHandle(db, "bob") else Runtime.trap("missing bob");
                let reviewed = RoleTargets.judgeOf(pending);

                switch (Moderation.setJudge(db, MOD, reviewed, #approved, null, 4)) {
                    case (#err(#NeedsSecond({ votes; needed }))) {
                        assert votes == 1;
                        assert needed == Moderation.SECONDS_NEEDED;
                    };
                    case _ Runtime.trap("the first reviewed vote should wait");
                };
                assert RoleTargets.judge(db, "bob") == reviewed;
                switch (Moderation.setJudge(db, MOD2, reviewed, #approved, null, 5)) {
                    case (#ok(user)) assert user.judgeStatus == #approved;
                    case (#err(_)) Runtime.trap("the second reviewed vote did not approve");
                };

                let backing = Moderation.backers(db, bob.id, #judge).size();
                switch (Moderation.setJudge(db, MOD, reviewed, #no, null, 6)) {
                    case (#err(#Invalid(message))) {
                        assert message == "the account or application changed; refresh and try again";
                    };
                    case _ Runtime.trap("a stale rejection became a revocation");
                };
                let ?approved = Profiles.byHandle(db, "bob") else Runtime.trap("missing bob");
                assert approved.judgeStatus == #approved;
                assert Moderation.backers(db, bob.id, #judge).size() == backing;
                let trail = Moderation.historyFor(db, bob.id, null, 10).rows;
                assert trail.size() == 1;
                assert Moderation.kindTag(trail[0].kind) == "judge_approved";
            }
        );
    };

    public func a_reclaimed_handle_cannot_retarget_a_stale_snapshot() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                let alice = register(db, ALICE, "alice");
                ignore register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, ALICE, 3);
                let ?pending = Profiles.byHandle(db, "alice") else Runtime.trap("missing alice");
                let reviewed = RoleTargets.judgeOf(pending);

                switch (Profiles.update(db, ALICE, 4, input("alice_v2"))) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("alice could not rename");
                };
                switch (Profiles.update(db, BOB, 5, input("alice"))) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("bob could not reclaim the old handle");
                };

                switch (Moderation.setJudge(db, MOD, reviewed, #no, null, 6)) {
                    case (#err(#Invalid(message))) {
                        assert message == "the account or application changed; refresh and try again";
                    };
                    case _ Runtime.trap("a stale row changed somebody's role");
                };
                let ?renamed = Profiles.byHandle(db, "alice_v2") else Runtime.trap("missing alice");
                let ?reclaimer = Profiles.byHandle(db, "alice") else Runtime.trap("missing bob");
                assert renamed.id == alice.id and renamed.judgeStatus == #pending;
                assert reclaimer.id != alice.id and reclaimer.judgeStatus == #no;
                assert Moderation.historyFor(db, renamed.id, null, 10).rows.size() == 0;
                assert Moderation.historyFor(db, reclaimer.id, null, 10).rows.size() == 0;
            }
        );
    };

    public func takedown_votes_bind_to_reason_role_and_caller() : async Test.Metrics {
        Test.test(
            func() {
                let db = withTwoModerators();
                let contexts = Moderation.initTakedownContexts();
                let subject : Nat64 = 77;

                switch (Moderation.takedownQuorum(db, contexts, MOD, subject, "reason a", 3)) {
                    case (#ok(false)) {};
                    case _ Runtime.trap("a first takedown vote should wait");
                };
                switch (Moderation.takedownQuorum(db, contexts, MOD2, subject, "reason b", 4)) {
                    case (#ok(false)) {};
                    case _ Runtime.trap("different reasons must not combine");
                };
                let a = Moderation.takedownBackingFor(db, contexts, MOD, subject, ?"reason a");
                let b = Moderation.takedownBackingFor(db, contexts, MOD2, subject, ?"reason b");
                assert a.votes == 1 and a.mine and a.context == ?"reason a";
                assert b.votes == 1 and b.mine and b.context == ?"reason b";

                // Changing MOD's own vote replaces its context rather than
                // creating a second row, and now the exact reasons agree.
                switch (Moderation.takedownQuorum(db, contexts, MOD, subject, "reason b", 5)) {
                    case (#ok(true)) {};
                    case _ Runtime.trap("matching reasons should reach quorum");
                };

                // Withdrawal can remove only the caller's unique row.
                switch (Moderation.withdrawTakedown(db, contexts, MOD, subject)) {
                    case (#ok) {};
                    case _ Runtime.trap("withdraw should remove the caller's vote");
                };
                let after = Moderation.takedownBackingFor(db, contexts, MOD2, subject, ?"reason b");
                assert after.votes == 1 and after.mine;

                // Losing moderator status invalidates a retained row at read
                // time; no sweep or separate cleanup pass is required.
                switch (RoleTargets.setModerator(db, MOD2, "mod2", false, null, 6)) {
                    case (#ok(_)) {};
                    case _ Runtime.trap("revoking moderator failed");
                };
                assert Moderation.takedownBackingFor(db, contexts, MOD, subject, ?"reason b").votes == 0;

                let erased = withTwoModerators();
                let erasedContexts = Moderation.initTakedownContexts();
                ignore Moderation.takedownQuorum(erased, erasedContexts, MOD, subject, "reason c", 7);
                let ?mod = Profiles.owner(erased, MOD) else Runtime.trap("missing moderator");
                switch (Profiles.anonymize(erased, mod, 8)) {
                    case (#ok(_)) {};
                    case _ Runtime.trap("anonymising moderator failed");
                };
                assert Moderation.takedownBackingFor(erased, erasedContexts, MOD2, subject, ?"reason c").votes == 0;

                // Simulate an approval row surviving from the pre-context
                // schema. With no actor-map binding it authorizes nothing,
                // but the moderator can explicitly cast it again.
                let legacy = withTwoModerators();
                let legacyContexts = Moderation.initTakedownContexts();
                let ?legacyMod = Profiles.owner(legacy, MOD) else Runtime.trap("missing legacy moderator");
                switch (legacy.approvals.insert({
                    subject_id = subject;
                    kind = #takedown;
                    moderator_id = legacyMod.id;
                    at = 1;
                })) {
                    case (#ok(_)) {};
                    case _ Runtime.trap("could not seed legacy backing");
                };
                assert Moderation.takedownBackingFor(legacy, legacyContexts, MOD2, subject, ?"reason d").votes == 0;
                switch (Moderation.takedownQuorum(legacy, legacyContexts, MOD, subject, "reason d", 9)) {
                    case (#ok(false)) {};
                    case _ Runtime.trap("re-cast legacy row should become one bound vote");
                };
            }
        );
    };

    public func approving_a_judge_logs_the_right_kind() : async Test.Metrics {
        Test.test(
            func() {
                let db = withTwoModerators();
                ignore register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 3);

                let user = approveJudge(db, "bob", ?"knows the space", 4);
                assert user.judgeStatus == #approved;

                // One log row, written by the vote that carried it — the held
                // first vote changes nothing and so records nothing.
                let log = Moderation.history(db, null, 10).rows;
                assert Moderation.kindTag(log[0].kind) == "judge_approved";
                assert log[0].note == ?"knows the space";
            }
        );
    };

    /// `#no` means two different things depending on where you came from, and
    /// the log has to tell them apart.
    public func rejecting_and_revoking_are_distinct_in_the_log() : async Test.Metrics {
        Test.test(
            func() {
                let db = withTwoModerators();
                ignore register(db, ALICE, "alice");
                ignore register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, ALICE, 3);
                ignore Profiles.applyAsJudge(db, BOB, 3);

                // pending -> no  is a rejection, and one moderator can do it
                ignore RoleTargets.setJudge(db, MOD, "alice", #no, null, 4);
                // pending -> approved -> no  is a revocation
                ignore approveJudge(db, "bob", null, 4);
                ignore RoleTargets.setJudge(db, MOD, "bob", #no, null, 5);

                let log = Moderation.history(db, null, 10).rows;
                assert Moderation.kindTag(log[0].kind) == "judge_revoked";
                assert Moderation.kindTag(log[1].kind) == "judge_approved";
                assert Moderation.kindTag(log[2].kind) == "judge_rejected";
            }
        );
    };

    /// The whole reason the log exists: undo a mistaken approval.
    public func an_approval_can_be_reset_to_pending() : async Test.Metrics {
        Test.test(
            func() {
                let db = withTwoModerators();
                let bob = register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 3);
                ignore approveJudge(db, "bob", null, 4);

                // Undoing it is the reversible direction, so one moderator is
                // enough — it also throws away the two votes behind it.
                switch (RoleTargets.setJudge(db, MOD, "bob", #pending, ?"approved by mistake", 5)) {
                    case (#ok(user)) assert user.judgeStatus == #pending;
                    case (#err(_)) Runtime.trap("setJudge failed");
                };

                assert Profiles.alphabetical(db, ?#approved, 10).size() == 0;
                assert Profiles.alphabetical(db, ?#pending, 10).size() == 1;
                // The votes go with it, so putting bob back takes two people
                // again rather than one moderator finishing an old pair.
                assert Moderation.backers(db, bob.id, #judge).size() == 0;

                let log = Moderation.history(db, null, 10).rows;
                assert Moderation.kindTag(log[0].kind) == "judge_reset";

                // And the subject's own trail is complete.
                let trail = Moderation.historyFor(db, bob.id, null, 10).rows;
                assert trail.size() == 2;
                assert Moderation.kindTag(trail[0].kind) == "judge_reset";
                assert Moderation.kindTag(trail[1].kind) == "judge_approved";
            }
        );
    };

    public func rejects_an_unknown_account_id() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                switch (RoleTargets.setAbsentJudge(db, MOD, #approved, null, 4)) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("expected NotRegistered");
                };
            }
        );
    };

    public func rejects_an_over_long_note() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                ignore register(db, BOB, "bob");
                var long = "";
                for (_ in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].vals()) {
                    long #= "0123456789012345678901234567890";
                };
                switch (RoleTargets.setJudge(db, MOD, "bob", #approved, ?long, 4)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("expected Invalid");
                };
            }
        );
    };

    // ── Log scoping ──────────────────────────────────────────────────────────

    public func per_subject_history_is_isolated() : async Test.Metrics {
        Test.test(
            func() {
                let db = withTwoModerators();
                let alice = register(db, ALICE, "alice");
                let bob = register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, ALICE, 3);
                ignore Profiles.applyAsJudge(db, BOB, 3);
                ignore approveJudge(db, "alice", null, 4);
                ignore approveJudge(db, "bob", null, 5);
                ignore RoleTargets.setJudge(db, MOD, "bob", #pending, null, 6);

                assert Moderation.historyFor(db, alice.id, null, 10).rows.size() == 1;
                assert Moderation.historyFor(db, bob.id, null, 10).rows.size() == 2;
                // Three judge actions, plus the fixture's two moderator grants.
                assert Moderation.history(db, null, 10).rows.size() == 5;
                assert Moderation.history(db, null, 2).rows.size() == 2;
            }
        );
    };

    public func per_subject_history_keeps_the_newest_bounded_trail() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                let bob = register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 3);

                var i = 0;
                while (i < Moderation.MAX_HISTORY_PER_SUBJECT + 8) {
                    let status : Profiles.JudgeStatus = if (i % 2 == 0) #no else #pending;
                    switch (RoleTargets.setJudge(db, MOD, "bob", status, null, Nat64.fromNat(4 + i))) {
                        case (#ok(_)) {};
                        case (#err(_)) Runtime.trap("history churn transition failed");
                    };
                    i += 1;
                };

                let trail = Moderation.historyFor(
                    db,
                    bob.id,
                    null,
                    Moderation.MAX_HISTORY_PER_SUBJECT + 1,
                );
                assert trail.rows.size() == Moderation.MAX_HISTORY_PER_SUBJECT;
                assert trail.total == Moderation.MAX_HISTORY_PER_SUBJECT;
                assert Moderation.kindTag(trail.rows[0].kind) == "judge_reset";
                assert trail.rows[0].at == 43;
                assert trail.rows[trail.rows.size() - 1].at == 12;
                // One retained moderator-grant row plus this subject's cap.
                assert db.actions.size() == Moderation.MAX_HISTORY_PER_SUBJECT + 1;
            }
        );
    };

    public func an_oversized_legacy_history_converges_in_one_action() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                let bob = register(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 3);

                var i = 0;
                while (i < Moderation.MAX_HISTORY_PER_SUBJECT + 8) {
                    switch (db.actions.insert({
                        subject_id = bob.id;
                        actorPrincipal = MOD;
                        kind = #judge_rejected;
                        note = null;
                        at = Nat64.fromNat(4 + i);
                    })) {
                        case (#ok(_)) {};
                        case (#err(_)) Runtime.trap("legacy history setup failed");
                    };
                    i += 1;
                };

                switch (RoleTargets.setJudge(db, MOD, "bob", #no, null, 100)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("legacy history did not accept a new action");
                };
                let trail = Moderation.historyFor(
                    db,
                    bob.id,
                    null,
                    Moderation.MAX_HISTORY_PER_SUBJECT + 1,
                );
                assert trail.rows.size() == Moderation.MAX_HISTORY_PER_SUBJECT;
                assert trail.total == Moderation.MAX_HISTORY_PER_SUBJECT;
                assert trail.rows[0].at == 100;
                assert trail.rows[trail.rows.size() - 1].at == 13;
                assert db.actions.size() == Moderation.MAX_HISTORY_PER_SUBJECT + 1;
            }
        );
    };

    // ── Open notice admission ───────────────────────────────────────────────

    public func rotating_principals_share_one_global_notice_window() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let recentAt = Notices.WINDOW / 2;
                var i = 0;
                while (i < Notices.GLOBAL_PER_WINDOW) {
                    // Three rows per identity remains within the caller limit;
                    // rotating to the next identity must not bypass the global
                    // admission window.
                    let reporter = principalFor(500 + i / Notices.PER_WINDOW);
                    switch (Notices.file(db, reporter, "report", recentAt)) {
                        case (#ok(_)) {};
                        case (#err(_)) Runtime.trap("notice inside the global window was refused early");
                    };
                    i += 1;
                };
                switch (Notices.file(db, principalFor(900), "one too many", recentAt)) {
                    case (#err(#TooSoon(_))) {};
                    case _ Runtime.trap("rotating principals bypassed the global notice limit");
                };
                assert Notices.globalWaitFor(db, recentAt) == ?3_600;

                // Model a resolved tombstone from the previous window after
                // filling the current one. A globally refused caller must not
                // get the queue-maintenance pass for free.
                let oldId = switch (db.notices.insert({
                    reporter = principalFor(901);
                    body = "";
                    at = 1;
                    state = #dismissed;
                    handledBy = null;
                    handledAt = 2;
                })) {
                    case (#ok(id)) id;
                    case (#err(_)) Runtime.trap("old notice fixture failed");
                };
                switch (Notices.file(db, principalFor(902), "still one too many", Notices.WINDOW + 2)) {
                    case (#err(#TooSoon(_))) {};
                    case _ Runtime.trap("the global window expired too early");
                };
                assert db.notices.get(oldId) != null;
            }
        );
    };

    public func rate_limited_notices_do_not_run_queue_maintenance() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                let oldReporter = principalFor(901);
                let old = switch (Notices.file(db, oldReporter, "old report", 1)) {
                    case (#ok(row)) row;
                    case (#err(_)) Runtime.trap("old notice filing failed");
                };
                switch (Notices.resolve(db, MOD, old.id, #dismissed, 2)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("old notice resolution failed");
                };

                // These three remain inside their caller window when the old
                // tombstone becomes eligible for compaction.
                let recentAt = Notices.WINDOW / 2;
                var i = 0;
                while (i < Notices.PER_WINDOW) {
                    switch (Notices.file(db, ALICE, "recent report", recentAt)) {
                        case (#ok(_)) {};
                        case (#err(_)) Runtime.trap("notice inside the caller window was refused early");
                    };
                    i += 1;
                };

                let later = Notices.WINDOW + 2;
                switch (Notices.file(db, ALICE, "rate-limited report", later)) {
                    case (#err(#TooSoon(_))) {};
                    case _ Runtime.trap("expected the caller notice limit");
                };
                assert db.notices.get(old.id) != null;

                // An admissible write still performs the same lazy
                // reclamation before inserting its notice.
                switch (Notices.file(db, BOB, "admissible report", later)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("admissible notice filing failed");
                };
                assert db.notices.get(old.id) == null;
            }
        );
    };

    public func resolved_notices_reclaim_capacity_after_the_admission_window() : async Test.Metrics {
        Test.test(
            func() {
                let db = withModerator();
                let filed = switch (Notices.file(db, ALICE, "original report", 1)) {
                    case (#ok(row)) row;
                    case (#err(_)) Runtime.trap("notice filing failed");
                };
                let settled = switch (Notices.resolve(db, MOD, filed.id, #dismissed, 2)) {
                    case (#ok(row)) row;
                    case (#err(_)) Runtime.trap("notice resolution failed");
                };
                assert settled.body == "original report";
                assert Notices.pending(db) == 0;
                assert Notices.recent(db, 10).size() == 0;
                switch (db.notices.get(filed.id)) {
                    case (?row) assert row.body == "";
                    case null Runtime.trap("admission tombstone disappeared too early");
                };

                let later = Notices.WINDOW + 2;
                switch (Notices.file(db, BOB, "later report", later)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("notice capacity was not reclaimed");
                };
                assert db.notices.get(filed.id) == null;
                assert db.notices.size() == 1;
            }
        );
    };
};
