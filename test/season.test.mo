import Blob "mo:core/Blob";
import Char "mo:core/Char";
import Nat8 "mo:core/Nat8";
import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Runtime "mo:core/Runtime";
import Test "mo:test";

import Ashroot "../backend/.ashroot/lib";
import Defaults "../backend/support/defaults";
import Moderation "../backend/lib/Moderation";
import Profiles "../backend/lib/Profiles";
import Season "../backend/lib/Season";
import Treasury "../backend/lib/Treasury";
import Launch "./support/Launch";
import RoleTargets "./support/RoleTargets";

/// The six-week format from the Rules page.
persistent actor SeasonTests {

    transient let MOD = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");
    /// The seconder. Approving a judge or a sponsor takes two moderators
    /// (the Roles section of the Rules page), so a fixture that wants either needs two principals to
    /// do it with. There is no shortcut available here: `quorum` lets a raw
    /// controller through alone, but only one with no profile row, and both of
    /// these are registered users of the test db.
    transient let MOD2 = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    transient let LAUNCH_SPONSOR = Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai");
    transient let LAUNCH_LEDGER = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

    func fresh() : Ashroot.DB {
        let db = Ashroot.Use(Ashroot.Mem(), Defaults.store());
        Launch.configure(db, [LAUNCH_LEDGER]);
        db;
    };

    func principalFor(n : Nat) : Principal {
        Principal.fromBlob(
            Blob.fromArray([4, Nat8.fromNat((n / 256) % 256), Nat8.fromNat(n % 256), 1])
        );
    };

    func input(handle : Text) : Profiles.Input = {
        handle;
        displayName = handle;
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

    /// Three moderators, always. Two approve applications; the third preserves
    /// that quorum when a matter concerns either one of them after sealing.
    func moderator(db : Ashroot.DB) {
        grantModerator(db, MOD, "zz_mod");
        grantModerator(db, MOD2, "zz_mod2");
        grantModerator(db, principalFor(60_000), "zz_mod3");
    };

    func grantModerator(db : Ashroot.DB, who : Principal, handle : Text) {
        switch (Profiles.byHandle(db, handle)) {
            case null ignore register(db, who, handle);
            case (?user) if (user.moderator) return;
            case (?_) {};
        };
        switch (RoleTargets.setModerator(db, who, handle, true, null, 1)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("setModerator failed");
        };
    };

    /// Approve a judge, which takes two moderators (the Roles section of the Rules page).
    ///
    /// `MOD`'s call only records a backing and comes back `#NeedsSecond`; it
    /// is `MOD2`'s that applies the change. Calling twice as the same
    /// moderator would not do — the backing is keyed on the moderator, so the
    /// second click is the same vote. The second result is the one returned,
    /// so a caller can still see whether the approval landed and why not.
    ///
    /// Rejecting, resetting and revoking are untouched by this and stay a
    /// single call, which is why nothing below wraps them.
    func approveJudge(db : Ashroot.DB, handle : Text, at : Nat64) : Result.Result<Profiles.User, Moderation.Error> {
        ignore RoleTargets.setJudge(db, MOD, handle, #approved, null, at);
        RoleTargets.setJudge(db, MOD2, handle, #approved, null, at);
    };

    /// The same two-moderator bar covers sponsorships. See `approveJudge`.
    func approveSponsor(db : Ashroot.DB, handle : Text, at : Nat64) : Result.Result<Profiles.User, Moderation.Error> {
        ignore RoleTargets.setSponsor(db, MOD, handle, #approved, null, at);
        RoleTargets.setSponsor(db, MOD2, handle, #approved, null, at);
    };

    /// A registered hacker. Like everybody else, they have to exist *before*
    /// the season starts: starting one closes registration, so an account not
    /// signed up by then cannot be conjured mid-season. Every test below
    /// therefore assembles its whole cast first and starts the season last.
    func hacker(db : Ashroot.DB, n : Nat, handle : Text) : Principal {
        let who = principalFor(n);
        ignore register(db, who, handle);
        ignore Profiles.setHacker(db, who, true, 2);
        who;
    };

    /// An approved judge. Must be created *before* the season starts, since
    /// starting it freezes the judges as well as closing the door.
    func judge(db : Ashroot.DB, n : Nat, handle : Text) : Principal {
        let who = principalFor(n);
        ignore register(db, who, handle);
        ignore Profiles.applyAsJudge(db, who, 2);
        switch (approveJudge(db, handle, 3)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("could not approve judge " # handle);
        };
        who;
    };

    /// Launch has a three-judge operational floor. Tests that care about one
    /// named judge still receive that exact principal; these reserved judges
    /// merely complete the otherwise production-identical fixture.
    func ensureLaunchJudges(db : Ashroot.DB) {
        var n = 0;
        while (Profiles.counts(db).judges < Season.MIN_LAUNCH_JUDGES) {
            ignore judge(db, 61_000 + n, "zz_launch_judge" # Nat.toText(n));
            n += 1;
        };
    };

    /// A running season — and the moment registration shuts. Nothing that
    /// needs an account may be created after this call.
    func startedSeason(db : Ashroot.DB) : Season.Season {
        ensureLaunchSponsor(db);
        ensureLaunchJudges(db);
        let created = switch (Season.create(db, 10)) {
            case (#ok(s)) s;
            case (#err(_)) Runtime.trap("create failed");
        };
        db.store.set({ db.store.get() with registrationOpen = false });
        switch (Season.start(db, created.id, 11)) {
            case (#ok(s)) s;
            case (#err(_)) Runtime.trap("start failed");
        };
    };

    /// Meet the same funding prerequisite every real season meets.
    ///
    /// It is deliberately idempotent: a test may provide its own approved
    /// sponsor to exercise sponsorship itself.  Otherwise a dedicated profile
    /// applies with the fixed fake-ledger principal and both moderators vet it
    /// before `Season.start` is reached.
    func ensureLaunchSponsor(db : Ashroot.DB) {
        moderator(db);
        if (Profiles.approvedSponsorCount(db) > 0) return;
        switch (Profiles.byHandle(db, "zz_launch_sponsor")) {
            case null {
                ignore register(db, LAUNCH_SPONSOR, "zz_launch_sponsor");
                switch (
                    Profiles.applyAsSponsor(
                        db,
                        LAUNCH_SPONSOR,
                        {
                            org = "Fixture Sponsor";
                            website = "";
                            logo = null;
                            blurb = "";
                            ledgers = [{ id = LAUNCH_LEDGER; sns = false }];
                            given = [];
                        },
                        9,
                    )
                ) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("launch sponsor apply failed");
                };
            };
            case (?_) {};
        };
        switch (approveSponsor(db, "zz_launch_sponsor", 9)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("launch sponsor approval failed");
        };
    };

    func isOk<T, E>(r : Result.Result<T, E>) : Bool = switch (r) {
        case (#ok(_)) true;
        case (#err(_)) false;
    };
    func isErr<T, E>(r : Result.Result<T, E>) : Bool = not isOk(r);

    /// A build every fixture entry can point at. `sizes` reports it as real,
    /// which is what `checkEntry` asks the asset store.
    func buildFor(db : Ashroot.DB, who : Principal) : Season.PackageInput {
        let ?user = Profiles.byPrincipal(db, who) else Runtime.trap("no user");
        { key = Profiles.scope(user) # "pkg/1.neutron" };
    };

    func entryInput(db : Ashroot.DB, who : Principal, title : Text) : Season.EntryInput = {
        title;
        summary = "";
        url = "";
        icon = null;
        shots = [];
        links = [];
        pkg = buildFor(db, who);
        slug = slugFor(db, who);
    };

    /// A per-user app id in the alphabet the canister allows.
    ///
    /// `slugTaken` only refuses an id held by a *different* user, so one stable
    /// id per user is exactly right — and it has to be letters, since `a-z` and
    /// `_` is the whole set. The scope is `/u/<id>/`, so mapping its digits to
    /// `a`-`j` gives a distinct all-letters id for every user for nothing.
    func slugFor(db : Ashroot.DB, who : Principal) : Text {
        let ?user = Profiles.byPrincipal(db, who) else return "app_unknown";
        slugOf(Profiles.scope(user));
    };

    func slugOf(scope : Text) : Text {
        var out = "app_";
        for (c in scope.chars()) {
            if (c >= '0' and c <= '9') {
                out #= Text.fromChar(Char.fromNat32(Char.toNat32(c) - 48 + 97));
            };
        };
        out;
    };


    func submit(db : Ashroot.DB, who : Principal, title : Text) : Season.Entry {
        switch (Season.submit(db, who, entryInput(db, who, title), sizes, 20)) {
            case (#ok(e)) e;
            case (#err(_)) Runtime.trap("submit failed for " # title);
        };
    };

    func closeWeek(db : Ashroot.DB, at : Nat64) : Season.Season {
        switch (Season.closeWeek(db, at)) {
            case (#ok(s)) s;
            case (#err(_)) Runtime.trap("closeWeek failed");
        };
    };

    func readyDraft(db : Ashroot.DB, closeRegistration : Bool) : Season.Season {
        ensureLaunchSponsor(db);
        ensureLaunchJudges(db);
        let draft = switch (Season.create(db, 10)) {
            case (#ok(s)) s;
            case (#err(_)) Runtime.trap("create failed");
        };
        if (closeRegistration) {
            db.store.set({ db.store.get() with registrationOpen = false });
        };
        draft;
    };

    // ── Lifecycle ────────────────────────────────────────────────────────────

    public func a_new_season_is_a_draft() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let s = switch (Season.create(db, 10)) {
                    case (#ok(s)) s;
                    case (#err(_)) Runtime.trap("create failed");
                };
                assert s.number == 1;
                assert s.phase == #draft;
                assert s.week == 0;
                // A draft is not running, so the judges is still open.
                assert not Season.judgesFrozen(db);
            }
        );
    };

    public func launch_readiness_requires_registration_to_be_closed() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let draft = readyDraft(db, false);
                switch (Season.launchReadiness(db, draft.id)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("open registration must block launch");
                };
                db.store.set({ db.store.get() with registrationOpen = false });
                switch (Season.launchReadiness(db, draft.id)) {
                    case (#ok(_)) {};
                    case _ Runtime.trap("complete closed launch should be ready");
                };
            }
        );
    };

    public func launch_readiness_requires_three_moderators() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let draft = readyDraft(db, true);
                ignore RoleTargets.setModerator(db, MOD, "zz_mod3", false, null, 20);
                assert Profiles.moderatorCount(db) == 2;
                switch (Season.launchReadiness(db, draft.id)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("two moderators must not pass launch readiness");
                };
            }
        );
    };

    public func launch_readiness_requires_three_judges() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let draft = readyDraft(db, true);
                ignore RoleTargets.setJudge(db, MOD, "zz_launch_judge0", #no, null, 20);
                assert Profiles.counts(db).judges == 2;
                switch (Season.launchReadiness(db, draft.id)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("two judges must not pass launch readiness");
                };
            }
        );
    };

    public func launch_readiness_rejects_pending_role_applications() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ensureLaunchSponsor(db);
                ensureLaunchJudges(db);

                let pendingJudge = principalFor(62_000);
                ignore register(db, pendingJudge, "zz_pending_judge");
                ignore Profiles.applyAsJudge(db, pendingJudge, 8);

                let pendingSponsor = principalFor(62_001);
                ignore register(db, pendingSponsor, "zz_pending_sponsor");
                ignore Profiles.applyAsSponsor(
                    db,
                    pendingSponsor,
                    {
                        org = "Pending";
                        website = "";
                        logo = null;
                        blurb = "";
                        ledgers = [{ id = LAUNCH_LEDGER; sns = false }];
                        given = [];
                    },
                    8,
                );
                let draft = switch (Season.create(db, 10)) {
                    case (#ok(s)) s;
                    case (#err(_)) Runtime.trap("create failed");
                };
                db.store.set({ db.store.get() with registrationOpen = false });

                switch (Season.launchReadiness(db, draft.id)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("pending judge must block launch");
                };
                ignore RoleTargets.setJudge(db, MOD, "zz_pending_judge", #no, null, 20);
                switch (Season.launchReadiness(db, draft.id)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("pending sponsor must block launch");
                };
                ignore RoleTargets.setSponsor(db, MOD, "zz_pending_sponsor", #no, null, 21);
                switch (Season.launchReadiness(db, draft.id)) {
                    case (#ok(_)) {};
                    case _ Runtime.trap("decided applications should unblock launch");
                };
            }
        );
    };

    /// One canister, one season. The next season is a new canister.
    public func a_second_season_is_refused() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let first = switch (Season.create(db, 10)) {
                    case (#ok(s)) s;
                    case (#err(_)) Runtime.trap("create failed");
                };
                assert first.number == 1;
                switch (Season.create(db, 11)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("a second season should be refused");
                };
            }
        );
    };

    /// And refused whatever state the first one is in — drafted, running or
    /// finished. A draft is the interesting case: it is the one that looks
    /// most like nothing has happened yet.
    public func a_second_season_is_refused_while_one_runs() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore startedSeason(db);
                switch (Season.create(db, 12)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("a second season should be refused");
                };
            }
        );
    };

    // ── The judge freeze ──────────────────────────────────────────────────────

    /// The integrity rule of the whole format.
    public func starting_a_season_freezes_the_judges() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = principalFor(50);
                ignore register(db, who, "hopeful");
                ignore Profiles.applyAsJudge(db, who, 2);

                // Before the start, approving works.
                assert not Season.judgesFrozen(db);
                switch (approveJudge(db, "hopeful", 3)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("should approve before the freeze");
                };

                ignore startedSeason(db);
                assert Season.judgesFrozen(db);

                // After it, every judge change is refused.
                switch (RoleTargets.setJudge(db, MOD, "hopeful", #no, null, 12)) {
                    case (#err(#JudgesFrozen)) {};
                    case _ Runtime.trap("expected JudgesFrozen");
                };
            }
        );
    };

    /// The sponsor and ledger set becomes immutable accounting truth at start.
    public func starting_a_season_freezes_sponsors() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = principalFor(51);
                ignore register(db, who, "backer");
                ignore Profiles.applyAsSponsor(
                    db,
                    who,
                    {
                        org = "Helix";
                        website = "";
                        logo = null;
                        blurb = "";
                        ledgers = [{ id = LAUNCH_LEDGER; sns = false }];
                        given = [];
                    },
                    2,
                );
                switch (approveSponsor(db, "backer", 3)) {
                    case (#ok(u)) assert u.sponsorStatus == #approved;
                    case (#err(_)) Runtime.trap("sponsor should be approved before start");
                };
                ignore startedSeason(db);

                switch (RoleTargets.setSponsor(db, MOD, "backer", #no, null, 12)) {
                    case (#err(#SponsorsFrozen)) {};
                    case _ Runtime.trap("expected SponsorsFrozen");
                };
            }
        );
    };

    public func finishing_a_season_keeps_the_judges_frozen() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                ignore startedSeason(db);
                assert Season.judgesFrozen(db);
                var at : Nat64 = 20;
                var w = 0;
                while (w < 6) {
                    ignore closeWeek(db, at);
                    at += 1;
                    w += 1;
                };
                assert Season.judgesFrozen(db);
            }
        );
    };

    // ── Entries ──────────────────────────────────────────────────────────────

    public func only_hackers_submit() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let watcher = principalFor(60);
                ignore register(db, watcher, "watcher");
                ignore startedSeason(db);
                switch (Season.submit(db, watcher, entryInput(db, watcher, "nope"), sizes, 20)) {
                    case (#err(#NotAHacker)) {};
                    case _ Runtime.trap("expected NotAHacker");
                };
            }
        );
    };

    public func one_entry_per_hacker_per_week() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let who = hacker(db, 61, "ada");
                let live = startedSeason(db);

                let first = submit(db, who, "First idea");
                // A second submit edits rather than creating a rival row.
                let second = submit(db, who, "Better idea");
                assert first.id == second.id;
                assert second.title == "Better idea";
                assert Season.week(db, live.id, 1, 10).size() == 1;
            }
        );
    };

    public func entries_need_a_running_season() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let who = hacker(db, 62, "ada");
                switch (Season.submit(db, who, entryInput(db, who, "early"), sizes, 20)) {
                    case (#err(#NoSeason)) {};
                    case _ Runtime.trap("expected NoSeason");
                };
            }
        );
    };

    // ── Voting ───────────────────────────────────────────────────────────────

    public func a_judge_gets_two_votes_on_two_entries() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let judges = judge(db, 70, "judy");
                let ada = hacker(db, 71, "ada");
                let bob = hacker(db, 72, "bob");
                let cal = hacker(db, 73, "cal");
                ignore startedSeason(db);

                let a = submit(db, ada, "A");
                let b = submit(db, bob, "B");
                let c = submit(db, cal, "C");

                switch (Season.vote(db, judges, a.id, 30)) {
                    case (#ok(e)) assert e.votes == 1;
                    case (#err(_)) Runtime.trap("first vote failed");
                };
                switch (Season.vote(db, judges, b.id, 31)) {
                    case (#ok(e)) assert e.votes == 1;
                    case (#err(_)) Runtime.trap("second vote failed");
                };
                // Both spent.
                switch (Season.vote(db, judges, c.id, 32)) {
                    case (#err(#VoteLimit)) {};
                    case _ Runtime.trap("expected VoteLimit");
                };
            }
        );
    };

    public func a_judge_cannot_stack_votes_on_one_entry() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let judges = judge(db, 74, "judy");
                let ada = hacker(db, 75, "ada");
                ignore startedSeason(db);
                let a = submit(db, ada, "A");

                ignore Season.vote(db, judges, a.id, 30);
                switch (Season.vote(db, judges, a.id, 31)) {
                    case (#err(#AlreadyVoted)) {};
                    case _ Runtime.trap("expected AlreadyVoted");
                };
            }
        );
    };

    /// Roles stack, so a judge can also be a hacker — but not their own scorer.
    public func a_judge_cannot_vote_for_themselves() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let judges = judge(db, 76, "judy");
                ignore Profiles.setHacker(db, judges, true, 4);
                ignore startedSeason(db);

                let mine = submit(db, judges, "Mine");
                switch (Season.vote(db, judges, mine.id, 30)) {
                    case (#err(#OwnEntry)) {};
                    case _ Runtime.trap("expected OwnEntry");
                };
            }
        );
    };

    public func only_approved_judges_vote() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = principalFor(77);
                ignore register(db, who, "nobody");
                let ada = hacker(db, 78, "ada");
                ignore startedSeason(db);
                let a = submit(db, ada, "A");

                switch (Season.vote(db, who, a.id, 30)) {
                    case (#err(#NotAJudge)) {};
                    case _ Runtime.trap("expected NotAJudge");
                };
            }
        );
    };

    public func a_vote_can_be_withdrawn_and_recast() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let judges = judge(db, 79, "judy");
                let ada = hacker(db, 80, "ada");
                let bob = hacker(db, 81, "bob");
                let cal = hacker(db, 82, "cal");
                ignore startedSeason(db);
                let a = submit(db, ada, "A");
                let b = submit(db, bob, "B");

                ignore Season.vote(db, judges, a.id, 30);
                ignore Season.vote(db, judges, b.id, 31);
                switch (Season.unvote(db, judges, a.id, 32)) {
                    case (#ok(e)) assert e.votes == 0;
                    case (#err(_)) Runtime.trap("unvote failed");
                };
                // Freed up, so a third entry becomes reachable.
                let c = submit(db, cal, "C");
                switch (Season.vote(db, judges, c.id, 33)) {
                    case (#ok(e)) assert e.votes == 1;
                    case (#err(_)) Runtime.trap("recast failed");
                };
            }
        );
    };

    public func vote_withdrawals_lock_exactly_one_hour_before_the_deadline() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let judges = judge(db, 83, "judy");
                let ada = hacker(db, 84, "ada");
                let bob = hacker(db, 85, "bob");
                let cal = hacker(db, 86, "cal");
                let live = startedSeason(db);
                let a = submit(db, ada, "A");
                let b = submit(db, bob, "B");
                let c = submit(db, cal, "C");
                let cutoff = live.weekEndsAt - Season.VOTE_WITHDRAWAL_LOCK_NANOS;

                // One nanosecond before the final hour, moving a ballot still
                // works. Put it back so the exact boundary tests a real vote.
                ignore Season.vote(db, judges, a.id, cutoff - 2);
                switch (Season.unvote(db, judges, a.id, cutoff - 1)) {
                    case (#ok(e)) assert e.votes == 0;
                    case _ Runtime.trap("withdrawal closed before the final hour");
                };
                ignore Season.vote(db, judges, a.id, cutoff - 1);

                // At the boundary the existing ballot is final and its tally
                // is untouched. An unused slot can still be filled right up
                // to the round deadline; this is a withdrawal lock, not an
                // early end to voting.
                switch (Season.unvote(db, judges, a.id, cutoff)) {
                    case (#err(#VoteLocked)) {};
                    case _ Runtime.trap("expected VoteLocked at the one-hour boundary");
                };
                let ?judy = Profiles.byPrincipal(db, judges) else Runtime.trap("judge disappeared");
                assert Season.hasVoted(db, judy.id, a.id);
                switch (Season.vote(db, judges, b.id, live.weekEndsAt - 1)) {
                    case (#ok(e)) assert e.votes == 1;
                    case _ Runtime.trap("an unused vote was closed before the deadline");
                };

                // The method itself also enforces the exact end, even if the
                // canister timer's close message has not run first.
                switch (Season.vote(db, judges, c.id, live.weekEndsAt)) {
                    case (#err(#WeekClosed)) {};
                    case _ Runtime.trap("expected WeekClosed at the deadline");
                };
                switch (Season.unvote(db, judges, a.id, live.weekEndsAt)) {
                    case (#err(#WeekClosed)) {};
                    case _ Runtime.trap("expected WeekClosed withdrawal at the deadline");
                };
            }
        );
    };

    // ── Selection ────────────────────────────────────────────────────────────

    /// Six entries, descending votes: top 5 rewarded, top 1 advanced.
    public func closing_a_qualifier_rewards_five_and_advances_one() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                // Six judges so votes can be spread to make a clear ranking.
                let juries = [
                    judge(db, 90, "judges1"), judge(db, 91, "judges2"), judge(db, 92, "judges3"),
                    judge(db, 93, "judges4"), judge(db, 94, "judges5"), judge(db, 95, "judges6"),
                ];
                let field = [
                    hacker(db, 100, "hack1"), hacker(db, 101, "hack2"),
                    hacker(db, 102, "hack3"), hacker(db, 103, "hack4"),
                    hacker(db, 104, "hack5"), hacker(db, 105, "hack6"),
                ];
                let live = startedSeason(db);

                let entries = [
                    submit(db, field[0], "E1"),
                    submit(db, field[1], "E2"),
                    submit(db, field[2], "E3"),
                    submit(db, field[3], "E4"),
                    submit(db, field[4], "E5"),
                    submit(db, field[5], "E6"),
                ];

                // E1 gets 4 votes, E2 3, E3 2, E4 1, E5/E6 none.
                var cast = 0;
                for (j in juries.vals()) {
                    // Each judge spends both votes on the leading entries.
                    if (cast < 4) ignore Season.vote(db, j, entries[0].id, 30);
                    if (cast < 3) ignore Season.vote(db, j, entries[1].id, 30);
                    cast += 1;
                };
                // Top up the tail from judges with votes to spare.
                ignore Season.vote(db, juries[4], entries[2].id, 31);
                ignore Season.vote(db, juries[5], entries[2].id, 31);
                ignore Season.vote(db, juries[3], entries[3].id, 31);

                let after = closeWeek(db, 40);
                assert after.week == 2;

                let ranked = Season.week(db, live.id, 1, 10);
                assert ranked[0].outcome == #advanced;
                assert ranked[1].outcome == #rewarded;
                assert ranked[4].outcome == #rewarded;
                // Sixth place gets nothing.
                assert ranked[5].outcome == #none;
            }
        );
    };

    /// The winner is carried into week 5 rather than re-submitted.
    public func art_is_carried_forward_with_the_entry() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let judges = judge(db, 130, "judy");
                let who = hacker(db, 131, "ada");
                let live = startedSeason(db);

                let ?author = Profiles.byPrincipal(db, who) else Runtime.trap("no author");
                let scope = Profiles.scope(author);
                let submitted = switch (
                    Season.submit(
                        db,
                        who,
                        {
                            title = "Sable";
                            summary = "";
                            url = "";
                            icon = ?(scope # "icon/sable.png");
                            shots = [scope # "shots/sable.webp", scope # "shots/sable-2.webp"];
                            links = [{ kind = "video"; url = "https://youtu.be/demo" }];
                            pkg = { key = scope # "pkg/1.neutron" };
                            slug = slugOf(scope);
                        },
                        sizes,
                        20,
                    )
                ) {
                    case (#ok(e)) e;
                    case (#err(_)) Runtime.trap("submit failed");
                };
                assert submitted.icon == ?(scope # "icon/sable.png");

                ignore Season.vote(db, judges, submitted.id, 30);
                ignore closeWeek(db, 40);

                // The bracket weeks are clones, so the art has to come along
                // or the map goes blank the moment a week closes.
                let semi = Season.week(db, live.id, Season.SEMI, 10);
                assert semi.size() == 1;
                assert semi[0].icon == ?(scope # "icon/sable.png");
                assert semi[0].shots.size() == 2;
                assert semi[0].shots[0] == scope # "shots/sable.webp";
                assert semi[0].links.size() == 1;
                // The build comes along too: a carried entry is still an app.
                switch (semi[0].pkg) {
                    case (?p) assert p.key == scope # "pkg/1.neutron";
                    case null Runtime.trap("the package was not carried");
                };
            }
        );
    };

    public func the_semi_is_two_duels_not_one_round() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let a = judge(db, 160, "judgesa");
                let b = judge(db, 161, "judgesb");

                // Four hackers, one winning each qualifier week.
                let who = [
                    hacker(db, 170, "hackw"),
                    hacker(db, 171, "hackx"),
                    hacker(db, 172, "hacky"),
                    hacker(db, 173, "hackz"),
                ];
                let live = startedSeason(db);

                let names = ["W", "X", "Y", "Z"];
                var w = 0;
                while (w < 4) {
                    let entry = submit(db, who[w], names[w]);
                    ignore Season.vote(db, a, entry.id, 20);
                    ignore closeWeek(db, 30);
                    w += 1;
                };

                let semi = Season.week(db, live.id, Season.SEMI, 10);
                assert semi.size() == 4;

                // Stack every vote on the two entries from weeks 1 and 2, so
                // a global top-two would send both finalists from one half.
                for (row in semi.vals()) {
                    if (row.title == "W" or row.title == "X") {
                        ignore Season.vote(db, a, row.id, 40);
                        ignore Season.vote(db, b, row.id, 40);
                    };
                };
                ignore closeWeek(db, 50);

                let final = Season.week(db, live.id, Season.FINAL, 10);
                assert final.size() == 2;
                // One from weeks 1-2, one from weeks 3-4 — never both from
                // the same side, however lopsided the voting was.
                let halves = Array.map<Season.Entry, ?Nat>(
                    final,
                    func(row) = Season.halfOf(db, row),
                );
                assert halves[0] != halves[1];
                // "W" beat "X"; the other place goes to whoever led 3 v 4.
                assert final[0].title == "W" or final[1].title == "W";
                assert (final[0].title != "X") and (final[1].title != "X");
            }
        );
    };

    public func starting_a_season_sets_a_voting_deadline() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let live = startedSeason(db);
                // Deadlines are stored, not derived: weeks close by hand, so
                // a schedule computed from the start would drift.
                assert live.weekEndsAt == live.startedAt + Season.WEEK_NANOS;

                let next = closeWeek(db, 999);
                assert next.week == 2;
                assert next.weekEndsAt == 999 + Season.WEEK_NANOS;
                // Rounds are not all the same length: qualifiers run a week,
                // the semi-final and the final a day each. The deadline
                // written at a close belongs to the round being *opened*, so
                // closing qualifier 4 opens a one-day semi.
                assert Season.roundNanos(Season.QUALIFIERS) == Season.WEEK_NANOS;
                assert Season.roundNanos(Season.SEMI) == Season.DAY_NANOS;
                assert Season.roundNanos(Season.FINAL) == Season.DAY_NANOS;
            }
        );
    };

    /// A finished season is still listed and still reachable by number.
    ///
    /// There is only ever one of them — the next season is a new canister — so
    /// what this pins is that ending a season does not hide it. The results
    /// page reads from exactly these two calls, and a canister whose whole
    /// remaining job is to be the record of what happened must keep answering
    /// them after the last week closes.
    public func a_finished_season_is_still_listed() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);

                let only = startedSeason(db);
                var w = 0;
                while (w < Season.FINAL) {
                    ignore closeWeek(db, 100);
                    w += 1;
                };

                let all = Season.all(db, 10);
                assert all.size() == 1;
                assert all[0].id == only.id;
                assert all[0].number == 1;
                assert all[0].phase == #finished;

                switch (Season.byNumber(db, 1)) {
                    case (?found) assert found.id == only.id;
                    case null Runtime.trap("season 1 missing");
                };
            }
        );
    };

    /// Stands in for the asset store. `submit` and `publishUpdate` read a
    /// package's size from there rather than believing what they were handed
    /// — and refuse a key with nothing behind it — so a test has to say which
    /// uploads exist. Every fixture package is uploaded; nothing else is.
    func sizes(key : Text) : ?Nat {
        if (Text.endsWith(key, #text ".neutron")) ?1_000 else null;
    };

    func mediaInput(scope : Text, title : Text, shots : Nat, links : Nat) : Season.EntryInput = {
        title;
        summary = "";
        url = "";
        icon = null;
        shots = Array.tabulate<Text>(shots, func(i) = scope # "shots/" # Nat.toText(i) # ".webp");
        links = Array.tabulate<Season.Link>(
            links,
            func(i) = { kind = "link"; url = "https://example.test/" # Nat.toText(i) },
        );
        pkg = { key = scope # "pkg/1.neutron" };
        slug = slugOf(scope);
    };

    public func media_is_capped_at_six() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = hacker(db, 180, "shotty");
                ignore startedSeason(db);
                let ?user = Profiles.byPrincipal(db, who) else Runtime.trap("no user");
                let scope = Profiles.scope(user);

                assert Season.submit(db, who, mediaInput(scope, "Ok", 6, 6), sizes, 20) |> isOk(_);
                assert Season.submit(db, who, mediaInput(scope, "Too many", 7, 0), sizes, 20) |> isErr(_);
                assert Season.submit(db, who, mediaInput(scope, "Too many", 0, 7), sizes, 20) |> isErr(_);
            }
        );
    };

    public func a_link_must_be_http() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = hacker(db, 181, "linky");
                ignore startedSeason(db);
                let ?user = Profiles.byPrincipal(db, who) else Runtime.trap("no user");
                let bad : Season.EntryInput = {
                    title = "Bad link";
                    summary = "";
                    url = "";
                    icon = null;
                    shots = [];
                    links = [{ kind = "x"; url = "javascript:alert(1)" }];
                    // Everything else about the entry is fine, so the link is
                    // the only thing left to refuse it for.
                    pkg = { key = Profiles.scope(user) # "pkg/1.neutron" };
                    slug = slugOf(Profiles.scope(user));
                };
                assert Season.submit(db, who, bad, sizes, 20) |> isErr(_);
            }
        );
    };

    public func a_version_replaces_the_last_package() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = hacker(db, 182, "shipper");
                ignore startedSeason(db);
                let user = switch (Profiles.byPrincipal(db, who)) {
                    case (?u) u;
                    case null Runtime.trap("no user");
                };
                let scope = Profiles.scope(user);
                let entry = submit(db, who, "Shipping");

                let first = switch (
                    Season.publishUpdate(
                        db,
                        who,
                        entry.id,
                        {
                            version = "0.1.0";
                            note = "First build.";
                            pkg = ?{ key = scope # "pkg/1.neutron" };
                        },
                        sizes,
                        30,
                    )
                ) { case (#ok(r)) r; case (#err(_)) Runtime.trap("publish failed") };
                assert first.1 == null;
                assert first.0.updates.size() == 1;
                assert first.0.updates[0].version == "0.1.0";

                let second = switch (
                    Season.publishUpdate(
                        db,
                        who,
                        entry.id,
                        {
                            version = "0.2.0";
                            note = "Second build.";
                            pkg = ?{ key = scope # "pkg/2.neutron" };
                        },
                        sizes,
                        40,
                    )
                ) { case (#ok(r)) r; case (#err(_)) Runtime.trap("publish failed") };

                // The replaced key comes back so the actor can drop the asset.
                assert second.1 == ?(scope # "pkg/1.neutron");
                // Newest first, and the package now points at the new build.
                assert second.0.updates.size() == 2;
                assert second.0.updates[0].version == "0.2.0";
                assert second.0.updates[1].version == "0.1.0";
                // The upload is part of the history, and stamped when it
                // happened rather than inferred from the current package.
                switch (second.0.updates[0].upload) {
                    // Both come from the canister: the name off the app's own
                    // id, the size off the store it read. Never off the upload
                    // key, which is a number the uploader chose.
                    // Read off the entry, not recomputed: the stored id
                    // carries a suffix the canister assigns, and a test that
                    // predicted it would be asserting its own arithmetic
                    // rather than that the name follows the app.
                    case (?u) { assert u.name == second.0.slug # ".neutron"; assert u.size == 1_000 };
                    case null Runtime.trap("upload not recorded");
                };
                assert second.0.updates[0].at == 40;
                assert second.0.updates[1].at == 30;
                switch (second.0.pkg) {
                    case (?p) { assert p.size == 1_000; assert p.version == "0.2.0" };
                    case null Runtime.trap("no package");
                };
            }
        );
    };

    public func a_package_must_be_your_own_upload() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = hacker(db, 183, "thief");
                ignore startedSeason(db);
                let entry = submit(db, who, "Borrowed");

                // Somebody else's namespace: pointing an entry at it would
                // attach an upload the hacker never made.
                let result = Season.publishUpdate(
                    db,
                    who,
                    entry.id,
                    {
                        version = "1.0.0";
                        note = "Not mine.";
                        pkg = ?{ key = "/u/999/pkg/1.neutron" };
                    },
                    sizes,
                    30,
                );
                assert isErr(result);
            }
        );
    };

    /// The browser names a download from the last segment of the path, so an
    /// unconstrained key is an unconstrained filename. The name is ours.
    public func a_package_is_named_by_us_and_measured_by_us() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = hacker(db, 185, "namer");
                ignore startedSeason(db);
                let ?user = Profiles.byPrincipal(db, who) else Runtime.trap("no user");
                let scope = Profiles.scope(user);
                let entry = submit(db, who, "Named");

                let ship = func(key : Text, at : Nat64) : Result.Result<(Season.Entry, ?Text), Season.Error> {
                    Season.publishUpdate(
                        db,
                        who,
                        entry.id,
                        { version = "1.0.0"; note = "Build."; pkg = ?{ key } },
                        sizes,
                        at,
                    );
                };

                // Anything that would not save as `<digits>.neutron`.
                assert isErr(ship(scope # "pkg/setup.exe", 30));
                assert isErr(ship(scope # "pkg/app.neutron.exe", 31));
                assert isErr(ship(scope # "pkg/nice-try.neutron", 32));
                assert isErr(ship(scope # "pkg/.neutron", 33));
                assert isErr(ship(scope # "pkg/12/34.neutron", 34));
                // Right shape, but nothing was ever uploaded there.
                assert isErr(
                    Season.publishUpdate(
                        db,
                        who,
                        entry.id,
                        { version = "1.0.0"; note = "Build."; pkg = ?{ key = scope # "pkg/9.neutron" } },
                        func(_) = null,
                        35,
                    )
                );

                switch (ship(scope # "pkg/1785704320852.neutron", 36)) {
                    case (#ok(entry, _)) {
                        let ?pkg = entry.pkg else Runtime.trap("no package");
                        // Shipping a build does not rename the download: both
                        // the submit path and the version path name it after
                        // the app, so a hacker's link keeps working.
                        assert pkg.name == entry.slug # ".neutron";
                        // The size is the store's answer, not anybody's claim.
                        assert pkg.size == 1_000;
                        assert entry.updates[0].upload == ?{ name = pkg.name; size = 1_000 };
                    };
                    case (#err(_)) Runtime.trap("a well-formed package was refused");
                };
            }
        );
    };

    public func a_note_needs_no_package() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = hacker(db, 184, "noter");
                ignore startedSeason(db);
                let ?user = Profiles.byPrincipal(db, who) else Runtime.trap("no user");
                let scope = Profiles.scope(user);
                let entry = submit(db, who, "Notes");

                let r = switch (
                    Season.publishUpdate(
                        db,
                        who,
                        entry.id,
                        { version = "0.1.1"; note = "Fixed a typo."; pkg = null },
                        sizes,
                        30,
                    )
                ) { case (#ok(x)) x; case (#err(_)) Runtime.trap("publish failed") };
                assert r.1 == null;
                // Every entry carries a build now, so "no package" cannot mean
                // an empty one: it means the build it was submitted with is
                // left exactly as it was, neither restamped nor replaced.
                //
                // The served name is the app's id, not the upload key's stem —
                // the key is a number the uploader chose, and what lands in
                // somebody's downloads folder should say which app it is.
                switch (r.0.pkg) {
                    case (?p) {
                        assert p.key == scope # "pkg/1.neutron";
                        assert p.name == r.0.slug # ".neutron";
                        assert p.size == 1_000;
                        assert p.version == "1";
                        assert p.at == 20;
                    };
                    case null Runtime.trap("a note dropped the package");
                };
                assert r.0.updates.size() == 1;
                // A note with no build behind it records no upload.
                assert r.0.updates[0].upload == null;

                // An empty note is not a changelog entry.
                assert isErr(
                    Season.publishUpdate(
                        db,
                        who,
                        entry.id,
                        { version = "0.1.2"; note = ""; pkg = null },
                        sizes,
                        30,
                    )
                );
            }
        );
    };

    public func a_profile_lists_only_its_own_entries() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let mine = hacker(db, 190, "mineown");
                let theirs = hacker(db, 191, "someone");
                ignore startedSeason(db);

                let first = submit(db, mine, "Mine one");
                ignore submit(db, theirs, "Theirs");
                ignore closeWeek(db, 30);
                let second = submit(db, mine, "Mine two");

                let ?me = Profiles.byPrincipal(db, mine) else Runtime.trap("no user");
                let listed = Season.entriesBy(db, me.id, 50);

                // Three, not two: winning week 1 carried a clone into the
                // semi-final, and that clone is theirs as well.
                assert listed.size() == 3;
                // Newest first, so a profile opens on what they did last.
                assert listed[0].id == second.id;
                assert listed[2].id == first.id;

                var carried = 0;
                for (row in listed.vals()) {
                    assert row.user_id == me.id;
                    if (row.origin_id == ?first.id) carried += 1;
                };
                assert carried == 1;
            }
        );
    };

    // ── Thin seasons ─────────────────────────────────────────────────────
    //
    // The format is written for a full field: five rewarded a week, four
    // qualifier winners meeting in the semi. A real season may be nothing
    // like that — two entrants, or a week nobody enters at all — and the
    // machinery has to degrade rather than mis-award or trap.

    /// Every asset an entry points at has to be the submitter's own upload.
    /// The namespace is keyed on the user id — assigned by the canister and
    /// never changed — rather than the handle, which a profile edit can move.
    public func an_entry_can_only_point_at_its_owners_uploads() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let me = hacker(db, 700, "mine");
                let them = hacker(db, 701, "theirs");
                ignore startedSeason(db);

                let ?mine = Profiles.byPrincipal(db, me) else Runtime.trap("no mine");
                let ?theirs = Profiles.byPrincipal(db, them) else Runtime.trap("no theirs");
                let ours = Profiles.scope(mine);
                let alien = Profiles.scope(theirs);
                assert ours != alien;

                let base = {
                    title = "Borrowed";
                    summary = "";
                    url = "";
                    icon = null : ?Text;
                    shots = [] : [Text];
                    links = [] : [Season.Link];
                    pkg = { key = ours # "pkg/1.neutron" };
                    slug = slugOf(ours);
                };

                // Another user's icon.
                switch (Season.submit(db, me, { base with icon = ?(alien # "icon/a.webp") }, sizes, 10)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("a foreign icon was accepted");
                };
                // Another user's screenshot, among their own.
                switch (
                    Season.submit(
                        db,
                        me,
                        { base with shots = [ours # "shots/ok.webp", alien # "shots/no.webp"] },
                        sizes,
                        11,
                    )
                ) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("a foreign screenshot was accepted");
                };
                // A path belonging to nobody.
                switch (Season.submit(db, me, { base with icon = ?"/u/999/icon/x.webp" }, sizes, 12)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("an unowned path was accepted");
                };
                // Another user's build — the package is an upload like any
                // other, and it is now the one asset every entry must have.
                switch (
                    Season.submit(db, me, { base with pkg = { key = alien # "pkg/1.neutron" } }, sizes, 12)
                ) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("a foreign package was accepted");
                };
                // Their own is fine, and so is having none at all.
                switch (
                    Season.submit(
                        db,
                        me,
                        { base with icon = ?(ours # "icon/mine.webp"); shots = [ours # "shots/one.webp"] },
                        sizes,
                        13,
                    )
                ) {
                    case (#ok(entry)) {
                        assert entry.icon == ?(ours # "icon/mine.webp");
                        assert entry.shots.size() == 1;
                    };
                    case (#err(_)) Runtime.trap("own uploads were refused");
                };
                switch (Season.submit(db, me, base, sizes, 14)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("an entry with no images was refused");
                };
            }
        );
    };

    /// A closed week is a record, and the record includes the art. The row is
    /// already immutable; without this the files it points at were not, so a
    /// project could be judged on one set of screenshots and show another.
    public func art_from_a_closed_round_is_frozen() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                ignore judge(db, 710, "artjudge");
                let me = hacker(db, 711, "artist");
                let live = startedSeason(db);
                let ?user = Profiles.byPrincipal(db, me) else Runtime.trap("no user");
                let scope = Profiles.scope(user);

                let icon = scope # "icon/one.png";
                let shot = scope # "shots/one.png";
                let build = scope # "pkg/1.neutron";
                let spare = scope # "icon/unused.png";
                switch (
                    Season.submit(
                        db,
                        me,
                        {
                            title = "Frozen";
                            summary = "";
                            url = "";
                            icon = ?icon;
                            shots = [shot];
                            links = [];
                            pkg = { key = build };
                            slug = slugOf(scope);
                        },
                        sizes,
                        20,
                    )
                ) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("submit failed");
                };

                // Publication freezes the exact reviewed bytes immediately.
                // An edit is a new upload and a fresh revision; otherwise the
                // author could replace what the moderator just approved while
                // voting is still open.
                assert Season.assetLocked(db, user.id, icon);
                assert Season.assetLocked(db, user.id, shot);
                assert Season.assetLocked(db, user.id, build);

                ignore Season.closeWeek(db, 30);

                // Closed. The entry was carried into the semi, but the week-1
                // row is settled and its files go with it.
                assert Season.assetLocked(db, user.id, icon);
                assert Season.assetLocked(db, user.id, shot);
                // Including the build that was judged — the thing the judges
                // actually installed must not be swapped out afterwards.
                assert Season.assetLocked(db, user.id, build);
                // Something never referenced stays free.
                assert not Season.assetLocked(db, user.id, spare);
                // And it is scoped to the owner: nobody else is affected.
                assert not Season.assetLocked(db, 999, icon);
                ignore live;
            }
        );
    };

    /// What the week-close timer is armed with.
    ///
    /// The firing itself cannot be tested here — the test replica's clock
    /// advances a nanosecond per call, so a timer with a real deadline never
    /// comes due. The arithmetic can be, and it is where the mistakes are.
    public func a_deadline_never_schedules_into_the_past() : async Test.Metrics {
        Test.test(
            func() {
                let second : Nat64 = 1_000_000_000;
                let now : Nat64 = 1_000 * second;

                // Ahead: whole seconds, rounded **up**. Rounding down means a
                // deadline 900 ms away arms at zero and the week closes before
                // the moment `week_ends_at` published. Waking a moment late is
                // free; waking early is the bug.
                assert Season.secondsUntil(now + 60 * second, now) == 60;
                assert Season.secondsUntil(now + second, now) == 1;
                assert Season.secondsUntil(now + second + 999_999_999, now) == 2;
                assert Season.secondsUntil(now + 999_999_999, now) == 1;
                assert Season.secondsUntil(now + 1, now) == 1;

                // Exactly due, and past it. Both are "now", never negative —
                // on Nat64 the subtraction would trap rather than wrap, so a
                // missing guard here takes the canister down on start-up
                // rather than merely scheduling something odd.
                assert Season.secondsUntil(now, now) == 0;
                assert Season.secondsUntil(now - second, now) == 0;
                assert Season.secondsUntil(0, now) == 0;

                // A whole week, which is what a season actually arms.
                assert Season.secondsUntil(now + Season.WEEK_NANOS, now) == 7 * 24 * 60 * 60;
            }
        );
    };

    public func a_thin_week_rewards_only_what_is_there() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let judges = judge(db, 200, "thinjudge");
                let thinA = hacker(db, 201, "thin_a");
                let thinB = hacker(db, 202, "thin_b");
                let live = startedSeason(db);

                // Two entries where the format expects five.
                let a = submit(db, thinA, "A");
                let b = submit(db, thinB, "B");
                ignore Season.vote(db, judges, b.id, 20);
                ignore closeWeek(db, 30);

                let week1 = Season.week(db, live.id, 1, 10);
                assert week1.size() == 2;
                // Everybody present places; nothing is invented to fill the
                // remaining three rewarded slots.
                var rewarded = 0;
                var advanced = 0;
                for (row in week1.vals()) {
                    if (row.outcome == #rewarded) rewarded += 1;
                    if (row.outcome == #advanced) advanced += 1;
                    if (row.id == b.id) assert row.outcome == #advanced;
                    if (row.id == a.id) assert row.outcome == #rewarded;
                };
                assert rewarded == 1;
                assert advanced == 1;
                // And exactly one is carried, not five.
                assert Season.week(db, live.id, Season.SEMI, 10).size() == 1;
            }
        );
    };

    public func an_empty_week_closes_and_carries_nothing() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let live = startedSeason(db);

                // Nobody entered week 1 at all.
                let after = closeWeek(db, 30);
                assert after.week == 2;
                assert after.phase == #running;
                assert Season.week(db, live.id, Season.SEMI, 10).size() == 0;
            }
        );
    };

    public func a_season_nobody_entered_still_finishes() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let live = startedSeason(db);

                var closed = 0;
                while (closed < Season.FINAL) {
                    ignore closeWeek(db, 30);
                    closed += 1;
                };

                let ?ended = Season.byNumber(db, live.number) else Runtime.trap("season gone");
                assert ended.phase == #finished;
                // No entries anywhere means no awards anywhere.
                var week = 1;
                while (week <= Season.FINAL) {
                    assert Season.week(db, ended.id, week, 10).size() == 0;
                    week += 1;
                };
            }
        );
    };

    public func one_entrant_takes_the_whole_bracket() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                ignore judge(db, 210, "lonejudge");
                let only = hacker(db, 211, "lone");
                let live = startedSeason(db);

                // A single hacker entering only week 1: they advance to the
                // semi, are the sole survivor of it, and win the final
                // unopposed. No round may crown two.
                ignore submit(db, only, "Only");
                var closed = 0;
                while (closed < Season.FINAL) {
                    ignore closeWeek(db, 40);
                    closed += 1;
                };

                let semi = Season.week(db, live.id, Season.SEMI, 10);
                assert semi.size() == 1;
                let final = Season.week(db, live.id, Season.FINAL, 10);
                assert final.size() == 1;
                assert final[0].outcome == #won;

                let ?ended = Season.byNumber(db, live.number) else Runtime.trap("season gone");
                assert ended.phase == #finished;
            }
        );
    };

    public func a_half_with_no_winner_still_yields_a_final() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                ignore judge(db, 220, "halfjudge");
                let halfA = hacker(db, 221, "half_a");
                let halfB = hacker(db, 222, "half_b");
                let live = startedSeason(db);

                // Weeks 1 and 2 are entered; 3 and 4 are empty. The semi is
                // meant to pair 1v2 and 3v4 — the second duel has nobody in
                // it, and the first must still produce a finalist.
                ignore submit(db, halfA, "A");
                ignore closeWeek(db, 40);
                ignore submit(db, halfB, "B");
                ignore closeWeek(db, 41);
                ignore closeWeek(db, 42);
                ignore closeWeek(db, 43);

                let semi = Season.week(db, live.id, Season.SEMI, 10);
                assert semi.size() == 2;
                // Both semi entries come from the first half of the bracket,
                // so only one may go through — the empty half cannot conjure
                // a second finalist.
                ignore closeWeek(db, 44);
                let final = Season.week(db, live.id, Season.FINAL, 10);
                assert final.size() == 1;
            }
        );
    };

    public func the_map_covers_every_week() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let ada = hacker(db, 140, "ada");
                let bob = hacker(db, 141, "bob");
                let live = startedSeason(db);
                ignore submit(db, ada, "One");
                ignore submit(db, bob, "Two");

                let map = Season.map(db, live.id, 10, null);
                // Six weeks, always — empty ones included, because the map
                // draws the whole bracket before it has been played.
                assert map.size() == Season.FINAL;
                assert map[0].week == 1;
                assert map[0].total == 2;
                assert map[0].entries.size() == 2;
                assert map[Season.SEMI - 1].total == 0;
                assert map[Season.FINAL - 1].entries.size() == 0;
            }
        );
    };

    public func the_map_caps_a_week_but_reports_the_total() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let field = [
                    hacker(db, 150, "hack0"), hacker(db, 151, "hack1"),
                    hacker(db, 152, "hack2"), hacker(db, 153, "hack3"),
                    hacker(db, 154, "hack4"),
                ];
                let live = startedSeason(db);
                var n = 0;
                while (n < 5) {
                    ignore submit(db, field[n], "P" # Nat.toText(n));
                    n += 1;
                };

                let map = Season.map(db, live.id, 2, null);
                assert map[0].entries.size() == 2;
                assert map[0].total == 5;
            }
        );
    };

    public func the_winner_is_carried_into_the_semi() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let judges = judge(db, 110, "judy");
                let ada = hacker(db, 111, "ada");
                let live = startedSeason(db);

                let a = submit(db, ada, "Winner");
                ignore Season.vote(db, judges, a.id, 30);
                ignore closeWeek(db, 40);

                let semi = Season.week(db, live.id, Season.SEMI, 10);
                assert semi.size() == 1;
                assert semi[0].title == "Winner";
                assert semi[0].origin_id == ?a.id;
                // A carried entry starts the new week with a clean slate.
                assert semi[0].votes == 0;
                assert semi[0].outcome == #none;
            }
        );
    };

    public func the_bracket_runs_to_a_grand_prize() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let judges = judge(db, 120, "judy");

                // One winner per qualifier week, from four different hackers.
                let hackers = [
                    hacker(db, 121, "hack1"), hacker(db, 122, "hack2"),
                    hacker(db, 123, "hack3"), hacker(db, 124, "hack4"),
                ];
                let live = startedSeason(db);

                var w = 0;
                while (w < 4) {
                    let e = submit(db, hackers[w], "W" # debug_show (w));
                    ignore Season.vote(db, judges, e.id, 30);
                    ignore closeWeek(db, 40);
                    w += 1;
                };

                // Four qualifier winners now meet in the semi.
                let semi = Season.week(db, live.id, Season.SEMI, 10);
                assert semi.size() == 4;

                // Two survive.
                ignore Season.vote(db, judges, semi[0].id, 50);
                ignore Season.vote(db, judges, semi[1].id, 50);
                ignore closeWeek(db, 60);

                let final = Season.week(db, live.id, Season.FINAL, 10);
                assert final.size() == 2;

                // And one takes the grand prize.
                ignore Season.vote(db, judges, final[0].id, 70);
                let done = closeWeek(db, 80);
                assert done.phase == #finished;

                let decided = Season.week(db, live.id, Season.FINAL, 10);
                assert decided[0].outcome == #won;
            }
        );
    };

    public func a_finished_season_takes_no_more_entries() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = hacker(db, 130, "already_here");
                ignore startedSeason(db);
                var at : Nat64 = 20;
                var w = 0;
                while (w < 6) { ignore closeWeek(db, at); at += 1; w += 1 };

                // An existing hacker cannot enter a finished season.
                switch (Season.submit(db, who, entryInput(db, who, "too late"), sizes, 100)) {
                    case (#err(#NoSeason)) {};
                    case _ Runtime.trap("expected NoSeason");
                };

                // This is a one-season canister, so the final week does not
                // reopen registration for a competition that cannot exist.
                switch (Profiles.register(db, principalFor(131), 101, input("late"))) {
                    case (#err(#Closed)) {};
                    case _ Runtime.trap("expected registration to stay closed");
                };
            }
        );
    };

    /// Bracket weeks are carried into, never submitted into.
    public func the_semi_cannot_be_submitted_into() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                moderator(db);
                let who = hacker(db, 131, "sneaky");
                ignore startedSeason(db);
                var at : Nat64 = 20;
                var w = 0;
                while (w < 4) { ignore closeWeek(db, at); at += 1; w += 1 };

                switch (Season.submit(db, who, entryInput(db, who, "straight to the semi"), sizes, 100)) {
                    case (#err(#WeekClosed)) {};
                    case _ Runtime.trap("expected WeekClosed");
                };
            }
        );
    };

    // ── Treasury ─────────────────────────────────────────────────────────────

    public func deposit_subaccounts_are_unique_and_derived() : async Test.Metrics {
        Test.test(
            func() {
                let one = Treasury.subaccountFor(1);
                let two = Treasury.subaccountFor(2);
                assert one.size() == 32;
                assert two.size() == 32;
                assert one != two;
                // Derived, so the same id always gives the same address.
                assert Treasury.subaccountFor(1) == one;

                // Big-endian id in the last eight bytes, zeroes elsewhere.
                let bytes = Blob.toArray(Treasury.subaccountFor(258));
                assert bytes[0] == 0;
                assert bytes[30] == 1;
                assert bytes[31] == 2;
            }
        );
    };
};
