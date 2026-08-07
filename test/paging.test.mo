import Blob "mo:core/Blob";
import List "mo:core/List";
import Nat8 "mo:core/Nat8";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Test "mo:test";

import Ashroot "../backend/.ashroot/lib";
import Defaults "../backend/support/defaults";
import Moderation "../backend/lib/Moderation";
import Profiles "../backend/lib/Profiles";
import RoleTargets "./support/RoleTargets";

/// Pagination, search and counts at a size that actually matters: the real
/// event is expected to run around 1000 participants and 200 judges.
persistent actor PagingTests {

    transient let MOD = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");

    /// Approving a judge takes two moderators (the Roles section of the Rules page), so the log tests
    /// need a second bench principal alongside MOD. A canister id rather than
    /// a `principalFor` blob, so it can never collide with a seeded user.
    transient let MOD2 = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");

    func fresh() : Ashroot.DB {
        Ashroot.Use(Ashroot.Mem(), Defaults.store());
    };

    /// Distinct principals without needing hundreds of literals. Two varying
    /// bytes cover far more users than these tests create.
    func principalFor(n : Nat) : Principal {
        Principal.fromBlob(
            Blob.fromArray([
                4,
                Nat8.fromNat((n / 256) % 256),
                Nat8.fromNat(n % 256),
                1,
            ])
        );
    };

    /// Handles spread across the alphabet so ordering is meaningful.
    ///
    /// The letter advances every ten users rather than every user: with
    /// `n % 10` it would line up exactly with the every-fifth-is-a-judge
    /// pattern below, and a prefix search would return all-judges or
    /// no-judges rather than a mix.
    func handleFor(n : Nat) : Text {
        let letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
        letters[(n / 10) % 10] # "_" # padded(n);
    };

    func padded(n : Nat) : Text {
        if (n < 10) "000" # Nat.toText(n) else if (n < 100) "00" # Nat.toText(n) else if (n < 1000) "0" # Nat.toText(n) else Nat.toText(n);
    };

    /// `count` users, every `judgeEvery`-th one an approved judge and every
    /// `pendingEvery`-th one a pending applicant.
    func seed(db : Ashroot.DB, count : Nat, judgeEvery : Nat, pendingEvery : Nat) {
        var i = 0;
        while (i < count) {
            let handle = handleFor(i);
            let who = principalFor(i);
            switch (
                Profiles.register(
                    db,
                    who,
                    Nat64.fromNat(i + 1),
                    {
                        handle;
                        displayName = "User " # Nat.toText(i);
                        title = null;
                        bio = "";
                        links = [];
                        terms = true;
                    },
                )
            ) {
                case (#ok(user)) {
                    let status : ?Profiles.JudgeStatus =
                        if (i % judgeEvery == 0) ?#approved
                        else if (i % pendingEvery == 0) ?#pending
                        else null;
                    switch (status) {
                        case (?s) ignore Profiles.save(db, { user with judgeStatus = s });
                        case null {};
                    };
                };
                case (#err(_)) Runtime.trap("seed failed at " # handle);
            };
            i += 1;
        };
    };

    /// Register both moderators and flag them. Their handles sort last so they
    /// never land inside the prefix ranges the search tests assert on.
    ///
    /// Two of them, because approving a judge takes two: `setJudge(#approved)`
    /// only *records* one moderator's backing and answers `#NeedsSecond` until
    /// a different moderator casts the second (`Moderation.SECONDS_NEEDED`).
    /// Neither of these principals controls the test canister, so the
    /// controller-acts-alone path is not open here — see `approveJudge`.
    ///
    /// Each appointment writes one `moderator_granted` row, which is why the
    /// log tests below start their count at two.
    func withModerators(db : Ashroot.DB) {
        appoint(db, MOD, "zz_mod", 1);
        appoint(db, MOD2, "zz_mod2", 2);
    };

    func appoint(db : Ashroot.DB, who : Principal, handle : Text, now : Nat64) {
        switch (
            Profiles.register(db, who, now, {
                handle;
                displayName = "Mod";
                title = null;
                bio = "";
                links = [];
                terms = true;
            })
        ) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("moderator registration failed for " # handle);
        };
        switch (RoleTargets.setModerator(db, who, handle, true, null, now)) {
            case (#ok(user)) assert user.moderator;
            case (#err(_)) Runtime.trap("setModerator failed for " # handle);
        };
        assert Profiles.canModerate(db, who);
    };

    /// Put a judge through the two-moderator gate.
    ///
    /// The first call is refused with `#NeedsSecond` and writes nothing — the
    /// backing is stored in `approvals`, not in the audit log — so the whole
    /// approval contributes exactly one `judge_approved` row, which is what the
    /// per-subject log counts below depend on.
    func approveJudge(db : Ashroot.DB, handle : Text, now : Nat64) {
        switch (RoleTargets.setJudge(db, MOD, handle, #approved, null, now)) {
            case (#err(#NeedsSecond(tally))) {
                assert tally.votes == 1;
                assert tally.needed == Moderation.SECONDS_NEEDED;
            };
            case (_) Runtime.trap("one moderator should not approve " # handle);
        };
        switch (RoleTargets.setJudge(db, MOD2, handle, #approved, null, now)) {
            case (#ok(user)) assert user.judgeStatus == #approved;
            case (#err(_)) Runtime.trap("second approval failed for " # handle);
        };
    };

    /// Walk every page and collect the handles, guarding against a cursor that
    /// never terminates.
    func drain(db : Ashroot.DB, filter : Profiles.Filter, pageSize : Nat) : [Text] {
        drainLetter(db, filter, null, pageSize);
    };

    func drainLetter(
        db : Ashroot.DB,
        filter : Profiles.Filter,
        letter : ?Profiles.Letter,
        pageSize : Nat,
    ) : [Text] {
        let seen = List.empty<Text>();
        var cursor : ?Profiles.Cursor = null;
        var pages = 0;
        label walk loop {
            let page = Profiles.page(db, filter, letter, cursor, pageSize);
            for (user in page.rows.vals()) List.add(seen, user.handle);
            pages += 1;
            if (pages > 500) Runtime.trap("cursor did not terminate");
            switch (page.next) {
                case (?next) cursor := ?next;
                case null break walk;
            };
        };
        List.toArray(seen);
    };

    // ── Counts ───────────────────────────────────────────────────────────────

    /// A ceiling is an upper bound, never a floor. Every listing endpoint
    /// applies one; the numbers the app actually asks for all sit below theirs,
    /// so nothing a user does through the UI is truncated.
    public func a_listing_ceiling_only_ever_lowers() : async Test.Metrics {
        Test.test(
            func() {
                // Below the ceiling: honoured exactly, so paging is unaffected.
                assert Profiles.atMost(25, 100) == 25;
                assert Profiles.atMost(1, 100) == 1;
                assert Profiles.atMost(0, 100) == 0;
                // At it, and past it.
                assert Profiles.atMost(100, 100) == 100;
                assert Profiles.atMost(101, 100) == 100;
                assert Profiles.atMost(100_000_000, 100) == 100;

                // The sizes the frontend requests, against the ceiling each
                // one meets. If a ceiling is ever lowered under an app request,
                // this is what should fail.
                assert Profiles.atMost(50, 100) == 50; // seasons
                assert Profiles.atMost(200, 500) == 200; // season_week_view
                assert Profiles.atMost(12, 50) == 12; // season_map
                assert Profiles.atMost(100, 200) == 100; // user_entries, moderators
                assert Profiles.atMost(25, 100) == 25; // moderation_log
            }
        );
    };

    public func counts_come_from_indexes() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 200, 5, 7);
                let c = Profiles.counts(db);
                assert c.users == 200;
                // every 5th is a judge: 0,5,...,195
                assert c.judges == 40;
                // every 7th that is not already a judge
                assert c.pending > 0 and c.pending < 30;
                assert c.moderators == 0;

                switch (RoleTargets.setModerator(db, MOD, handleFor(3), true, null, 1)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("setModerator failed");
                };
                assert Profiles.counts(db).moderators == 1;
            }
        );
    };

    // ── Paging ───────────────────────────────────────────────────────────────

    public func pages_cover_every_user_exactly_once() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 250, 5, 7);
                let all = drain(db, #all, 24);
                assert all.size() == 250;

                // Alphabetical and strictly increasing — no repeats, no gaps.
                var i = 1;
                while (i < all.size()) {
                    assert all[i - 1] < all[i];
                    i += 1;
                };
            }
        );
    };

    public func judge_pages_cover_every_judge() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 250, 5, 7);
                let judges = drain(db, #judges, 24);
                assert judges.size() == Profiles.counts(db).judges;
                var i = 1;
                while (i < judges.size()) {
                    assert judges[i - 1] < judges[i];
                    i += 1;
                };
            }
        );
    };

    /// The sparse filters walk their own index, so they must still page
    /// cleanly even though the matching set is a small slice of the table.
    public func pending_queue_pages_cleanly() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 250, 5, 7);
                let pending = drain(db, #pending, 10);
                assert pending.size() == Profiles.counts(db).pending;
                assert pending.size() > 0;
            }
        );
    };

    public func a_full_page_reports_a_cursor_and_the_last_does_not() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 30, 5, 7);

                let first = Profiles.page(db, #all, null, null, 24);
                assert first.rows.size() == 24;
                assert first.total == 30;
                assert first.next != null;

                let second = Profiles.page(db, #all, null, first.next, 24);
                assert second.rows.size() == 6;
                assert second.total == 30;
                assert second.next == null;
            }
        );
    };

    public func limits_are_clamped() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 200, 5, 7);
                // 0 means "use the default", and nothing may exceed the cap.
                assert Profiles.page(db, #all, null, null, 0).rows.size() == 24;
                assert Profiles.page(db, #all, null, null, 5_000).rows.size() == 100;
            }
        );
    };

    public func an_empty_table_pages_without_a_cursor() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let page = Profiles.page(db, #all, null, null, 24);
                assert page.rows.size() == 0;
                assert page.total == 0;
                assert page.next == null;
            }
        );
    };

    // ── Letter seek ──────────────────────────────────────────────────────────

    /// The A-Z index must not require loading the table first: asking for a
    /// letter seeks straight to that bucket.
    public func a_letter_returns_only_that_bucket() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 250, 5, 7);

                let cs = drainLetter(db, #all, ?"C", 24);
                assert cs.size() > 0;
                for (handle in cs.vals()) {
                    assert Text.startsWith(handle, #text "c");
                };

                // And the bucket totals add up to the whole listing.
                var summed = 0;
                for (bucket in Profiles.letterCounts(db, #all).vals()) {
                    summed += bucket.count;
                };
                assert summed == Profiles.counts(db).users;
            }
        );
    };

    public func letter_seek_is_case_insensitive() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 100, 5, 7);
                let upper = Profiles.page(db, #all, ?"B", null, 50);
                let lower = Profiles.page(db, #all, ?"b", null, 50);
                assert upper.total == lower.total;
                assert upper.rows.size() == lower.rows.size();
                assert upper.total > 0;
            }
        );
    };

    public func letter_counts_track_the_filter() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 250, 5, 7);

                var allSum = 0;
                for (b in Profiles.letterCounts(db, #all).vals()) allSum += b.count;
                var judgeSum = 0;
                for (b in Profiles.letterCounts(db, #judges).vals()) judgeSum += b.count;

                let c = Profiles.counts(db);
                assert allSum == c.users;
                assert judgeSum == c.judges;
                assert judgeSum < allSum;
            }
        );
    };

    public func an_empty_bucket_reports_zero() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 30, 5, 7);
                // handleFor only uses a..c for 30 users, so Z is empty.
                let page = Profiles.page(db, #all, ?"Z", null, 24);
                assert page.rows.size() == 0;
                assert page.total == 0;
                assert page.next == null;
            }
        );
    };

    public func letters_page_within_the_bucket() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 250, 5, 7);
                // Ten users per letter block, 25 blocks over 250 users, so "A"
                // holds several pages worth at a page size of 4.
                let drained = drainLetter(db, #all, ?"A", 4);
                let total = Profiles.page(db, #all, ?"A", null, 4).total;
                assert drained.size() == total;
                for (handle in drained.vals()) {
                    assert Text.startsWith(handle, #text "a");
                };
            }
        );
    };

    // ── Search ───────────────────────────────────────────────────────────────

    public func search_matches_a_handle_prefix() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 200, 5, 7);

                // handleFor spreads across a_ .. j_, so every tenth user.
                let hits = Profiles.search(db, "a_", #all, 100);
                assert hits.size() == 20;
                for (user in hits.vals()) {
                    assert user.handle.size() > 2;
                };

                // Narrower prefix, fewer hits.
                assert Profiles.search(db, "a_0000", #all, 100).size() == 1;
                assert Profiles.search(db, "zzz", #all, 100).size() == 0;
                // An empty query is not "everything".
                assert Profiles.search(db, "", #all, 100).size() == 0;
            }
        );
    };

    public func search_respects_the_filter() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 200, 5, 7);
                let all = Profiles.search(db, "a_", #all, 100);
                let judges = Profiles.search(db, "a_", #judges, 100);
                assert judges.size() < all.size();
                for (user in judges.vals()) {
                    assert user.judgeStatus == #approved;
                };
            }
        );
    };

    // ── Log paging ───────────────────────────────────────────────────────────

    public func the_log_pages_newest_first() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 40, 5, 7);
                withModerators(db);

                // Generate a log long enough to need several pages. Users who
                // are already #pending yield NoChange and no row, so count the
                // ones that actually landed rather than assuming 30.
                var logged = 2; // one moderator_granted row per bench member
                var i = 0;
                while (i < 30) {
                    switch (
                        RoleTargets.setJudge(db, MOD, handleFor(i), #pending, null, Nat64.fromNat(100 + i))
                    ) {
                        case (#ok(_)) logged += 1;
                        case (#err(_)) {};
                    };
                    i += 1;
                };

                let first = Moderation.history(db, null, 10);
                assert first.rows.size() == 10;
                assert first.total == logged;
                assert first.next != null;

                // Drain and check we see each entry once, newest id first.
                let ids = List.empty<Nat64>();
                var cursor : ?Moderation.Cursor = null;
                var pages = 0;
                label walk loop {
                    let page = Moderation.history(db, cursor, 10);
                    for (entry in page.rows.vals()) List.add(ids, entry.id);
                    pages += 1;
                    if (pages > 100) Runtime.trap("log cursor did not terminate");
                    switch (page.next) {
                        case (?next) cursor := ?next;
                        case null break walk;
                    };
                };
                let seen = List.toArray(ids);
                assert seen.size() == logged;
                var j = 1;
                while (j < seen.size()) {
                    assert seen[j - 1] > seen[j];
                    j += 1;
                };
            }
        );
    };

    public func per_subject_log_pages_independently() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                seed(db, 20, 5, 7);
                withModerators(db);

                let target = handleFor(2);
                let ?user = Profiles.byHandle(db, target) else Runtime.trap("missing");
                ignore RoleTargets.setJudge(db, MOD, target, #pending, null, 10);
                approveJudge(db, target, 11);
                ignore RoleTargets.setJudge(db, MOD, target, #pending, null, 12);
                // Somebody else, to prove isolation.
                ignore RoleTargets.setJudge(db, MOD, handleFor(3), #pending, null, 13);

                let page = Moderation.historyFor(db, user.id, null, 2);
                assert page.rows.size() == 2;
                assert page.total == 3;
                assert page.next != null;

                let rest = Moderation.historyFor(db, user.id, page.next, 2);
                assert rest.rows.size() == 1;
                assert rest.next == null;
            }
        );
    };
};
