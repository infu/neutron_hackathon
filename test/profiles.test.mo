import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Test "mo:test";

import Ashroot "../backend/.ashroot/lib";
import Assets "../backend/lib/Assets";
import Defaults "../backend/support/defaults";
import Profiles "../backend/lib/Profiles";
import Slab "../backend/lib/Slab";

persistent actor ProfileTests {

    transient let ALICE = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");
    transient let BOB = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    transient let CAROL = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
    transient let ANON = Principal.fromText("2vxsx-fae");

    func fresh() : Ashroot.DB {
        Ashroot.Use(Ashroot.Mem(), Defaults.store());
    };

    func input(handle : Text) : Profiles.Input = {
        handle;
        displayName = "Display " # handle;
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

    /// Set judge status directly. Going through `Moderation.setJudge` here
    /// would drag in a moderator fixture for tests that are really about
    /// registration and listing; moderation.test.mo covers that path.
    func setJudgeStatus(db : Ashroot.DB, handle : Text, status : Profiles.JudgeStatus) : Profiles.User {
        let ?user = Profiles.byHandle(db, handle) else Runtime.trap("missing " # handle);
        switch (Profiles.save(db, { user with judgeStatus = status })) {
            case (#ok(saved)) saved;
            case (#err(_)) Runtime.trap("save failed for " # handle);
        };
    };

    func mustRegister(db : Ashroot.DB, who : Principal, handle : Text) : Profiles.User {
        switch (Profiles.register(db, who, 1, input(handle))) {
            case (#ok(user)) user;
            case (#err(_)) Runtime.trap("register failed for " # handle);
        };
    };

    // ── Registration ─────────────────────────────────────────────────────────

    public func registers_a_user() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let user = mustRegister(db, ALICE, "alice");
                assert user.handle == "alice";
                assert user.principal == ALICE;
                assert user.judgeStatus == #no;
                assert user.avatar == null;
                assert Profiles.count(db) == 1;
            }
        );
    };

    public func finds_user_by_principal_and_handle() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let created = mustRegister(db, ALICE, "alice");
                let ?byP = Profiles.byPrincipal(db, ALICE) else Runtime.trap("missing by principal");
                let ?byH = Profiles.byHandle(db, "alice") else Runtime.trap("missing by handle");
                assert byP.id == created.id;
                assert byH.id == created.id;
                assert Profiles.byPrincipal(db, BOB) == null;
                assert Profiles.byHandle(db, "nobody") == null;
            }
        );
    };

    public func rejects_a_second_registration_from_one_principal() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore mustRegister(db, ALICE, "alice");
                switch (Profiles.register(db, ALICE, 2, input("alice2"))) {
                    case (#err(#AlreadyRegistered)) {};
                    case _ Runtime.trap("expected AlreadyRegistered");
                };
            }
        );
    };

    public func anonymized_accounts_are_terminal_but_their_history_remains() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                switch (Profiles.register(db, CAROL, 1, input("deleted_0"))) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("a live account claimed the tombstone namespace");
                };
                let user = mustRegister(db, ALICE, "alice");
                switch (
                    Profiles.update(db, ALICE, 2, input("deleted_" # Nat64.toText(user.id)))
                ) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("a live account renamed into the tombstone namespace");
                };
                switch (Profiles.setAgent(db, ALICE, ?BOB)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("could not nominate agent");
                };
                assert Profiles.byPrincipal(db, ALICE) != null;
                assert Profiles.byPrincipal(db, BOB) != null;
                assert Profiles.owner(db, ALICE) != null;

                let deleted = switch (Profiles.anonymize(db, user, 2)) {
                    case (#ok(saved)) saved;
                    case (#err(_)) Runtime.trap("could not anonymize account");
                };
                assert deleted.anonymized;

                // Neither the former owner nor their former automation key is
                // an authenticated account after deletion.
                assert Profiles.byPrincipal(db, ALICE) == null;
                assert Profiles.byPrincipal(db, BOB) == null;
                assert Profiles.owner(db, ALICE) == null;

                switch (Profiles.update(db, ALICE, 3, input("alice_again"))) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("anonymized owner could still write");
                };

                // The principal index is intentionally retained: deletion is
                // terminal, not a way to create a fresh identity over the same
                // historical entries and votes. Closing registration does not
                // mask that permanent reservation with a generic `Closed`.
                db.store.registrationOpen.set(false);
                switch (Profiles.register(db, ALICE, 3, input("alice_again"))) {
                    case (#err(#AlreadyRegistered)) {};
                    case _ Runtime.trap("anonymized principal registered again");
                };

                // Public history uses the durable row rather than the auth
                // resolver, so finished brackets still have an author.
                let ?historical = Profiles.byHandle(db, "deleted-" # Nat64.toText(user.id)) else {
                    Runtime.trap("anonymized history disappeared");
                };
                assert historical.id == user.id;
                assert historical.anonymized;
                assert historical.displayName == "Deleted account";
            }
        );
    };

    public func rejects_a_taken_handle() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore mustRegister(db, ALICE, "alice");
                switch (Profiles.register(db, BOB, 2, input("alice"))) {
                    case (#err(#HandleTaken)) {};
                    case _ Runtime.trap("expected HandleTaken");
                };
            }
        );
    };

    public func rejects_the_anonymous_principal() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                switch (Profiles.register(db, ANON, 1, input("ghost"))) {
                    case (#err(#Anonymous)) {};
                    case _ Runtime.trap("expected Anonymous");
                };
            }
        );
    };

    public func rejects_malformed_handles() : async Test.Metrics {
        Test.test(
            func() {
                assert not Profiles.validHandle("ab");
                assert not Profiles.validHandle("Alice");
                assert not Profiles.validHandle("has space");
                assert not Profiles.validHandle("dash-not-allowed");
                assert not Profiles.validHandle("");
                assert Profiles.validHandle("alice");
                assert Profiles.validHandle("a_1");

                let db = fresh();
                switch (Profiles.register(db, ALICE, 1, input("Alice"))) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("expected Invalid");
                };
            }
        );
    };

    public func rejects_registration_when_closed() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                db.store.registrationOpen.set(false);
                switch (Profiles.register(db, ALICE, 1, input("alice"))) {
                    case (#err(#Closed)) {};
                    case _ Runtime.trap("expected Closed");
                };
            }
        );
    };

    public func hacker_capacity_fits_the_asset_store_and_is_reusable() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                assert Profiles.MAX_HACKERS == 1_000;
                assert Profiles.MAX_APPROVED_SPONSORS == 64;
                assert Profiles.MAX_MODERATORS == 8;
                let nonHackers = Profiles.MAX_ACCOUNTS - Profiles.MAX_HACKERS;
                let promisedSlots =
                    Profiles.MAX_HACKERS * Assets.MAX_HACKER_KEYS
                    + nonHackers * Assets.MAX_NON_HACKER_KEYS;
                let liveStorage =
                    Profiles.MAX_HACKERS * Assets.MAX_HACKER_BYTES
                    + nonHackers * Assets.MAX_NON_HACKER_BYTES;
                assert nonHackers == 200;
                assert promisedSlots == 64_400;
                assert liveStorage == 32_052_428_800;
                assert Assets.MAX_LIVE_SLOTS == 80_000;
                assert promisedSlots <= Assets.MAX_LIVE_SLOTS;
                assert promisedSlots + 10_000 <= Assets.MAX_LIVE_SLOTS;
                assert liveStorage <= Assets.MAX_RESERVED_BYTES;

                // Regions do not shrink and classes cannot reuse each other's
                // slots. Size policy for the sum of each class's independent
                // historical maximum, not merely for one live arrangement.
                let slotsFor = func(allowance : Nat, keys : Nat, class_ : Slab.Class) : Nat {
                    let byAllowance = allowance / Slab.slotBytes(class_);
                    if (byAllowance < keys) byAllowance else keys;
                };
                let small = (
                    Profiles.MAX_HACKERS * slotsFor(Assets.MAX_HACKER_BYTES, Assets.MAX_HACKER_KEYS, #small)
                    + nonHackers * slotsFor(Assets.MAX_NON_HACKER_BYTES, Assets.MAX_NON_HACKER_KEYS, #small)
                ) * Slab.slotBytes(#small);
                let image = Profiles.MAX_HACKERS
                    * slotsFor(Assets.MAX_HACKER_BYTES, Assets.MAX_HACKER_KEYS, #image)
                    * Slab.slotBytes(#image);
                let build = Profiles.MAX_HACKERS
                    * slotsFor(Assets.MAX_HACKER_BYTES, Assets.MAX_HACKER_KEYS, #build)
                    * Slab.slotBytes(#build);
                let historical = small + image + build;
                let frontend = 1_073_741_824; // 1 GiB
                assert small == 8_441_036_800;
                assert image == 29_360_128_000;
                assert build == 31_457_280_000;
                assert historical == 69_258_444_800;
                assert historical + frontend == Assets.MAX_RESERVED_BYTES;
                assert Assets.MAX_RESERVED_BYTES < 80 * 1_073_741_824;
                // These figures are allocator reservation promises now, not
                // payload-byte promises. Even the smallest ordinary account
                // has two small slots so replacement can land before cleanup.
                assert Assets.MAX_NON_HACKER_BYTES == 2 * Slab.slotBytes(#small);
                var i = 0;
                while (i < Profiles.MAX_HACKERS) {
                    let who = principalFor(i + 100);
                    ignore mustRegister(db, who, "hacker" # Nat.toText(i));
                    switch (Profiles.setHacker(db, who, true, 2)) {
                        case (#ok(_)) {};
                        case (#err(_)) Runtime.trap("hacker below the capacity was refused");
                    };
                    i += 1;
                };

                let extra = principalFor(Profiles.MAX_HACKERS + 100);
                ignore mustRegister(db, extra, "hacker_extra");
                switch (Profiles.setHacker(db, extra, true, 3)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("hacker above the capacity was accepted");
                };

                // Idempotence at the boundary is still allowed, and dropping
                // the role immediately frees its capacity for somebody else.
                let first = principalFor(100);
                switch (Profiles.setHacker(db, first, true, 4)) {
                    case (#ok(_)) {};
                    case _ Runtime.trap("existing hacker was refused at the capacity");
                };
                let ?held = Profiles.byPrincipal(db, first) else Runtime.trap("missing first hacker");
                ignore Profiles.save(db, { held with bytes = Assets.MAX_NON_HACKER_BYTES + 1 });
                switch (Profiles.setHacker(db, first, false, 5)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("a large retained app allowance escaped the hacker cap");
                };
                let ?cleaned = Profiles.byPrincipal(db, first) else Runtime.trap("missing cleaned hacker");
                ignore Profiles.save(db, { cleaned with bytes = 0 });
                ignore Profiles.setHacker(db, first, false, 5);
                switch (Profiles.setHacker(db, extra, true, 6)) {
                    case (#ok(_)) {};
                    case _ Runtime.trap("released hacker capacity was not reusable");
                };
            }
        );
    };

    public func rejects_non_http_links() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let bad : Profiles.Input = {
                    handle = "alice";
                    displayName = "Alice";
                    title = null;
                    bio = "";
                    links = [{ kind = "web"; url = "javascript:alert(1)" }];
                    terms = true;
                };
                switch (Profiles.register(db, ALICE, 1, bad)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("expected Invalid");
                };
            }
        );
    };

    // ── Updates ──────────────────────────────────────────────────────────────

    public func updates_an_existing_profile() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore mustRegister(db, ALICE, "alice");
                let next : Profiles.Input = {
                    handle = "alice_v2";
                    displayName = "Alice B";
                    title = ?"Founder of Something";
                    bio = "building on neutron";
                    links = [{ kind = "github"; url = "https://github.com/alice" }];
                    terms = true;
                };
                switch (Profiles.update(db, ALICE, 9, next)) {
                    case (#ok(user)) {
                        assert user.handle == "alice_v2";
                        assert user.title == ?"Founder of Something";
                        assert user.bio == "building on neutron";
                        assert user.links.size() == 1;
                        assert user.updatedAt == 9;
                        assert user.createdAt == 1;
                    };
                    case (#err(_)) Runtime.trap("update failed");
                };
                // The unique handle index must follow the rename.
                assert Profiles.byHandle(db, "alice") == null;
                assert Profiles.byHandle(db, "alice_v2") != null;
            }
        );
    };

    public func rejects_updates_from_unregistered_callers() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                switch (Profiles.update(db, ALICE, 1, input("alice"))) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("expected NotRegistered");
                };
            }
        );
    };

    public func rejects_taking_another_users_handle() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore mustRegister(db, ALICE, "alice");
                ignore mustRegister(db, BOB, "bob");
                switch (Profiles.update(db, BOB, 3, input("alice"))) {
                    case (#err(#HandleTaken)) {};
                    case _ Runtime.trap("expected HandleTaken");
                };
            }
        );
    };

    // ── Avatars ──────────────────────────────────────────────────────────────

    public func accepts_an_avatar_inside_the_user_scope() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                let user = mustRegister(db, ALICE, "alice");
                let key = Profiles.scope(user) # "avatar/face.png";
                // The second half of the answer is the key this replaced, so
                // the caller can delete the file — a fresh avatar is written to
                // a new key every time, and the old one would otherwise stay
                // served and charged for ever.
                switch (Profiles.setAvatar(db, ALICE, ?key, 5)) {
                    case (#ok((updated, replaced))) {
                        assert updated.avatar == ?key;
                        assert replaced == null; // there was no picture before
                    };
                    case (#err(_)) Runtime.trap("setAvatar failed");
                };

                // Changing it reports the one it displaced.
                let next = Profiles.scope(user) # "avatar/other.png";
                switch (Profiles.setAvatar(db, ALICE, ?next, 6)) {
                    case (#ok((updated, replaced))) {
                        assert updated.avatar == ?next;
                        assert replaced == ?key;
                    };
                    case (#err(_)) Runtime.trap("setAvatar failed");
                };

                // And so does taking it off.
                switch (Profiles.setAvatar(db, ALICE, null, 7)) {
                    case (#ok((updated, replaced))) {
                        assert updated.avatar == null;
                        assert replaced == ?next;
                    };
                    case (#err(_)) Runtime.trap("setAvatar failed");
                };
            }
        );
    };

    public func rejects_an_avatar_outside_the_user_scope() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore mustRegister(db, ALICE, "alice");
                switch (Profiles.setAvatar(db, ALICE, ?"/index.html", 5)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("expected Invalid");
                };
            }
        );
    };

    // ── Judging ──────────────────────────────────────────────────────────────

    public func applying_flags_an_existing_profile_as_pending() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore mustRegister(db, BOB, "bob");

                switch (Profiles.applyAsJudge(db, BOB, 2)) {
                    case (#ok(user)) assert user.judgeStatus == #pending;
                    case (#err(_)) Runtime.trap("applyAsJudge failed");
                };

                // Pending applicants are not judges yet.
                assert Profiles.alphabetical(db, ?#approved, 10).size() == 0;
                assert Profiles.alphabetical(db, ?#pending, 10).size() == 1;

                // A controller approves; only then do they list as judges.
                assert setJudgeStatus(db, "bob", #approved).judgeStatus == #approved;
                assert Profiles.alphabetical(db, ?#approved, 10).size() == 1;
                assert Profiles.alphabetical(db, ?#pending, 10).size() == 0;
            }
        );
    };

    public func approved_judges_are_still_participants() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore mustRegister(db, ALICE, "ada");
                ignore mustRegister(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 2);
                ignore setJudgeStatus(db, "bob", #approved);

                // The participants list is everyone, judges included.
                let everyone = Profiles.alphabetical(db, null, 10);
                assert everyone.size() == 2;
                assert Profiles.alphabetical(db, ?#approved, 10).size() == 1;
            }
        );
    };

    public func re_applying_never_downgrades() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore mustRegister(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 2);
                ignore setJudgeStatus(db, "bob", #approved);

                switch (Profiles.applyAsJudge(db, BOB, 4)) {
                    case (#ok(user)) assert user.judgeStatus == #approved;
                    case (#err(_)) Runtime.trap("applyAsJudge failed");
                };
            }
        );
    };

    public func rejects_a_judge_application_from_a_stranger() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                switch (Profiles.applyAsJudge(db, ALICE, 1)) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("expected NotRegistered");
                };
            }
        );
    };

    public func a_controller_can_step_a_judge_down() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore mustRegister(db, BOB, "bob");
                ignore Profiles.applyAsJudge(db, BOB, 2);
                ignore setJudgeStatus(db, "bob", #approved);

                assert setJudgeStatus(db, "bob", #no).judgeStatus == #no;
                assert Profiles.alphabetical(db, ?#approved, 10).size() == 0;
                // Still a participant.
                assert Profiles.alphabetical(db, null, 10).size() == 1;
            }
        );
    };

    public func rejects_an_over_long_title() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                var long = "";
                for (_ in [1, 2, 3, 4, 5, 6, 7, 8, 9].vals()) {
                    long #= "0123456789";
                };
                let bad : Profiles.Input = {
                    handle = "bob";
                    displayName = "Bob";
                    title = ?long;
                    bio = "";
                    links = [];
                    terms = true;
                };
                switch (Profiles.register(db, BOB, 1, bad)) {
                    case (#err(#Invalid(_))) {};
                    case _ Runtime.trap("expected Invalid");
                };
            }
        );
    };

    // ── Alphabetical listing ─────────────────────────────────────────────────

    public func lists_alphabetically_regardless_of_signup_order() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                // Register out of alphabetical order on purpose.
                ignore Profiles.register(db, CAROL, 100, input("zoe"));
                ignore Profiles.register(db, ALICE, 200, input("ada"));
                ignore Profiles.register(db, BOB, 300, input("mia"));

                let all = Profiles.alphabetical(db, null, 10);
                assert all.size() == 3;
                assert all[0].handle == "ada";
                assert all[1].handle == "mia";
                assert all[2].handle == "zoe";
            }
        );
    };

    public func alphabetical_filters_by_role_and_respects_limit() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore Profiles.register(db, ALICE, 1, input("ada"));
                ignore Profiles.register(db, BOB, 2, input("mia"));
                ignore Profiles.register(db, CAROL, 3, input("zoe"));
                ignore Profiles.applyAsJudge(db, CAROL, 4);
                ignore setJudgeStatus(db, "zoe", #approved);

                assert Profiles.alphabetical(db, ?#no, 10).size() == 2;
                assert Profiles.alphabetical(db, ?#approved, 10).size() == 1;
                assert Profiles.alphabetical(db, null, 10).size() == 3;
                assert Profiles.alphabetical(db, null, 2).size() == 2;

                // Unfiltered is still alphabetical across roles.
                let all = Profiles.alphabetical(db, null, 10);
                assert all[0].handle == "ada";
                assert all[2].handle == "zoe";
            }
        );
    };

    public func lists_recent_users_newest_first() : async Test.Metrics {
        Test.test(
            func() {
                let db = fresh();
                ignore Profiles.register(db, ALICE, 100, input("alice"));
                ignore Profiles.register(db, BOB, 200, input("bob"));
                ignore Profiles.register(db, CAROL, 300, input("carol"));

                let recent = Profiles.recent(db, 2);
                assert recent.size() == 2;
                assert recent[0].handle == "carol";
                assert recent[1].handle == "bob";
            }
        );
    };
};
