/// A whole season, every role, end to end.
///
/// Moderators appoint the judges and vet the sponsors; a sponsor funds the pool
/// and says so; hackers enter, each having named the wallet they want paying
/// into; judges vote; the weeks close through the bracket; the season is
/// decided; and the distribution is drafted and sent — straight to those
/// wallets, one hop, with nothing left behind in the treasury.
///
/// Two things that used to be here are gone, and the tests below say so rather
/// than working around them. There is no controller sign-off between the plan
/// and the money: `Payout.draft` marks the plan `#approved` itself, because the
/// canister holds its own controllers while a season settles and a gate only a
/// controller could open is a gate nobody could open. And a prize no longer
/// lands in canister custody on its way to the winner — what is left of custody
/// (`withdraw`, the reward subaccounts) is a drain path for balances parked
/// there before that change, and is exercised as exactly that below.
///
/// The point of doing it in one test rather than as separate units is the
/// order: most of the ways this could go wrong are about one step happening
/// before another was really finished.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Error "mo:core/Error";
import Nat8 "mo:core/Nat8";
import Nat "mo:core/Nat";
import Char "mo:core/Char";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Test "mo:test";

import Ashroot "../backend/.ashroot/lib";
import Defaults "../backend/support/defaults";
import Moderation "../backend/lib/Moderation";
import Payout "../backend/lib/Payout";
import Profiles "../backend/lib/Profiles";
import Season "../backend/lib/Season";
import Treasury "../backend/lib/Treasury";

import Fake "./support/FakeLedger";
import Launch "./support/Launch";
import RoleTargets "./support/RoleTargets";

persistent actor {

    transient let CANISTER = Principal.fromText("aaaaa-aa");
    transient let MOD = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");
    /// The second moderator. Seating a judge or vetting a sponsor takes two of
    /// them — see `approveJudge`.
    transient let MOD2 = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    transient let ICP = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
    transient let OTHER_LEDGER = Principal.fromText("mxzaz-hqaaa-aaaar-qaada-cai");
    transient let FEE = 10_000;
    transient let FUNDED = 100_000_000;

    // ── The cast ─────────────────────────────────────────────────────────────

    type Cast = {
        db : Ashroot.DB;
        ledger : Fake.Fake;
        season : Season.Season;
        sponsor : Profiles.User;
        judges : [Principal];
        hackers : [Principal];
    };

    func principalFor(n : Nat) : Principal {
        Principal.fromBlob(
            Blob.fromArray([4, Nat8.fromNat((n / 256) % 256), Nat8.fromNat(n % 256), 1])
        );
    };

    /// The wallet hacker `n` is paid into.
    ///
    /// Deliberately not the principal they sign in with: `Profiles.setWallet`
    /// refuses that one, on the grounds that an identity which authenticates is
    /// not an account that holds tokens. Hackers sign in as `principalFor(200 +
    /// n)`, so the two ranges cannot meet.
    func walletFor(n : Nat) : Principal = principalFor(300 + n);

    func register(db : Ashroot.DB, who : Principal, handle : Text) : Profiles.User {
        switch (
            Profiles.register(
                db,
                who,
                1,
                { handle; displayName = handle; title = null; bio = ""; links = []; terms = true },
            )
        ) {
            case (#ok(user)) user;
            case (#err(_)) Runtime.trap("register failed for " # handle);
        };
    };

    /// Approving a judge takes two moderators, so every approval in this file
    /// is cast twice, from two different accounts (rules.md §2). One vote is a
    /// proposal, not a decision, and that is what the first branch pins. The
    /// lone-controller shortcut is no use here: it only lets through a caller
    /// with no profile row, and both of our moderators are registered users.
    func approveJudge(db : Ashroot.DB, handle : Text, now : Nat64) {
        switch (RoleTargets.setJudge(db, MOD, handle, #approved, null, now)) {
            case (#err(#NeedsSecond(_))) {};
            case (_) Runtime.trap("one moderator must not seat " # handle);
        };
        switch (RoleTargets.setJudge(db, MOD2, handle, #approved, null, now)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("approve judge failed");
        };
    };

    /// A sponsorship is vetted the same way, and for the same reason: the
    /// ledger it names is one this canister will later be asked to call.
    func approveSponsor(db : Ashroot.DB, handle : Text, now : Nat64) {
        switch (RoleTargets.setSponsor(db, MOD, handle, #approved, null, now)) {
            case (#err(#NeedsSecond(_))) {};
            case (_) Runtime.trap("one moderator must not vet " # handle);
        };
        switch (RoleTargets.setSponsor(db, MOD2, handle, #approved, null, now)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("approve sponsor failed");
        };
    };

    /// Everything up to the moment the season starts, in the order the rules
    /// require: the judges have to be approved *before* the start freezes it, and
    /// everybody has to be signed up *before* the start closes registration.
    func setUp(hackerCount : Nat, judgeCount : Nat) : Cast =
        setUpWith(hackerCount, judgeCount, []);

    /// `setUp`, plus onlookers: accounts on the books with no part to play.
    ///
    /// They join here rather than in the test body because starting a season
    /// shuts registration, and a test that quietly reopened it would be
    /// describing a world that does not exist.
    func setUpWith(
        hackerCount : Nat,
        judgeCount : Nat,
        onlookers : [(Principal, Text)],
    ) : Cast {
        let db : Ashroot.DB = Ashroot.Use(Ashroot.Mem(), Defaults.store());
        Launch.configure(db, [ICP]);

        // Three moderators are the launch floor. Two cast each approval; the
        // spare preserves quorum for a matter concerning either approver.
        for ((who, handle) in [
            (MOD, "zz_mod"),
            (MOD2, "zz_mod2"),
            (principalFor(60_000), "zz_mod3"),
        ].vals()) {
            ignore register(db, who, handle);
            switch (RoleTargets.setModerator(db, MOD, handle, true, null, 1)) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("moderator failed");
            };
        };

        // Judges apply and the moderators approve them.
        var judges : [Principal] = [];
        var j = 0;
        while (j < judgeCount) {
            let who = principalFor(100 + j);
            let handle = "judge" # Nat.toText(j);
            ignore register(db, who, handle);
            ignore Profiles.applyAsJudge(db, who, 2);
            approveJudge(db, handle, 3);
            judges := Array.concat(judges, [who]);
            j += 1;
        };
        var launchJudge = 0;
        while (Profiles.counts(db).judges < Season.MIN_LAUNCH_JUDGES) {
            let who = principalFor(61_000 + launchJudge);
            let handle = "zz_launch_judge" # Nat.toText(launchJudge);
            ignore register(db, who, handle);
            ignore Profiles.applyAsJudge(db, who, 2);
            approveJudge(db, handle, 3);
            launchJudge += 1;
        };

        // A sponsor applies with a ledger, and is vetted.
        let sponsorWho = principalFor(50);
        ignore register(db, sponsorWho, "helix");
        switch (
            Profiles.applyAsSponsor(
                db,
                sponsorWho,
                {
                    org = "Helix Labs";
                    website = "";
                    logo = null;
                    blurb = "";
                    ledgers = [{ id = ICP; sns = false }];
                    given = [];
                },
                4,
            )
        ) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("sponsor apply failed");
        };
        approveSponsor(db, "helix", 5);

        // Hackers — each with a wallet, which is now what makes them payable at
        // all. `Payout.claims` skips a hacker with no wallet outright: there is
        // nowhere to send the money and no custody account to park it in, and
        // because `shares` normalises over the weight actually present, the
        // claim is not merely unsent but never budgeted for. A fixture whose
        // hackers have no wallet produces an empty plan and a season that
        // cannot pay.
        var hackers : [Principal] = [];
        var h = 0;
        while (h < hackerCount) {
            let who = principalFor(200 + h);
            ignore register(db, who, "hacker" # Nat.toText(h));
            ignore Profiles.setHacker(db, who, true, 6);
            switch (Profiles.setWallet(db, who, walletFor(h))) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("wallet failed for hacker" # Nat.toText(h));
            };
            hackers := Array.concat(hackers, [who]);
            h += 1;
        };

        // Last through the door before it shuts.
        for ((who, handle) in onlookers.vals()) { ignore register(db, who, handle) };

        // Close registration before the irreversible launch boundary, then
        // start from the exact state that passed readiness.
        let created = switch (Season.create(db, 10)) {
            case (#ok(s)) s;
            case (#err(_)) Runtime.trap("create failed");
        };
        db.store.set({ db.store.get() with registrationOpen = false });
        let season = switch (Season.start(db, created.id, 11)) {
            case (#ok(s)) s;
            case (#err(_)) Runtime.trap("start failed");
        };

        let ?sponsor = Profiles.byHandle(db, "helix") else Runtime.trap("no sponsor");
        { db; ledger = Fake.Fake(FEE, CANISTER); season; sponsor; judges; hackers };
    };

    /// Stands in for the asset store. An entry has to name a `.neutron` that
    /// has really been uploaded, so the cast's builds are the only assets that
    /// exist here.
    func sizes(key : Text) : ?Nat {
        if (Text.endsWith(key, #text ".neutron")) ?1_000 else null;
    };

    /// `/u/12/` becomes "app_bc" — letters only, distinct per user.
    func slugOf(scope : Text) : Text {
        var out = "app_";
        for (c in scope.chars()) {
            if (c >= '0' and c <= '9') {
                out #= Text.fromChar(Char.fromNat32(Char.toNat32(c) - 48 + 97));
            };
        };
        out;
    };

    func qualifierTag(week : Nat) : Text = switch (week) {
        case (1) "a";
        case (2) "b";
        case (3) "c";
        case (4) "d";
        case (_) Runtime.trap("not a qualifier week");
    };

    /// Every hacker ships one build, in their own namespace. Most fixtures use
    /// a genuinely different chosen app id in each qualifier. The canonical-id
    /// regression deliberately reuses the same chosen id and asks payout to
    /// collapse the generated storage suffixes.
    func entryInput(
        db : Ashroot.DB,
        who : Principal,
        title : Text,
        week : Nat,
        reuseChosenSlug : Bool,
    ) : Season.EntryInput {
        let ?user = Profiles.byPrincipal(db, who) else Runtime.trap("no user");
        let base = slugOf(Profiles.scope(user));
        {
            title;
            summary = "";
            url = "";
            icon = null;
            shots = [];
            links = [];
            // Separate qualifier apps use separate immutable upload keys.
            // Reusing the same bytes is fine; sharing one exact URL would make
            // a later takedown unable to remove only one app.
            pkg = { key = Profiles.scope(user) # "pkg/" # Nat.toText(week) # ".neutron" };
            // `/u/<id>/` digits map to a-j, and the qualifier tag remains in
            // the published letters/underscore alphabet.
            slug = if (reuseChosenSlug) base else base # "_" # qualifierTag(week);
        };
    };

    /// Play one week: `entrants` enter, the judges score, the week closes.
    ///
    /// Who enters is a parameter because it decides how many *lineages* the
    /// season produces, and that is the whole difference between the two
    /// fixtures below. Nothing is submitted after the qualifiers — the bracket
    /// weeks are carried into — so `entrants` is ignored from week 5 on.
    func playWeek(
        cast : Cast,
        entrants : [Principal],
        week : Nat,
        at : Nat64,
        reuseChosenSlug : Bool,
    ) {
        if (week <= Season.QUALIFIERS) {
            for (who in entrants.vals()) {
                switch (
                    Season.submit(
                        cast.db,
                        who,
                        entryInput(cast.db, who, "app", week, reuseChosenSlug),
                        sizes,
                        at,
                    )
                ) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("submit failed in week " # Nat.toText(week));
                };
            };
        };

        // Judges spend both votes on the two entries at the front of the
        // ranking, which is enough to make the ordering deliberate.
        let live = switch (Season.running(cast.db)) {
            case (?s) s;
            case null Runtime.trap("no running season");
        };
        let entries = Season.week(cast.db, live.id, week, 50);
        for (judge in cast.judges.vals()) {
            var cast_ = 0;
            for (entry in entries.vals()) {
                if (cast_ < Season.VOTES_PER_JUDGE) {
                    switch (Season.vote(cast.db, judge, entry.id, at)) {
                        case (#ok(_)) cast_ += 1;
                        // Their own entry, or already voted: skip it.
                        case (#err(_)) {};
                    };
                };
            };
        };

        switch (Season.closeWeek(cast.db, at)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("close failed in week " # Nat.toText(week));
        };
    };

    /// Six weeks with a **full field**: every hacker enters every qualifier
    /// week, which is the season rules.md §7 tabulates.
    ///
    /// The judges spend their votes on the front of the ranking and ties break
    /// to the earliest entry, so the same hacker — `hackers[0]` — tops every
    /// qualifier week. One entry advances per qualifier, so all four semi-final
    /// seats are theirs, both halves of the bracket are theirs, and so is the
    /// final.
    ///
    /// What that pays out is **`4n` claims, not `n`**, because a claim is per
    /// app and this fixture deliberately chooses a different app id in every
    /// qualifier. `Season.slugFor` additionally makes the stored row id unique;
    /// payout ignores that generated part and keys on the chosen id. `carry`
    /// copies its source's slug, so climbing the bracket continues one lineage.
    /// `hackers[0]` therefore holds four lineages — a gold, a silver and two
    /// bronzes, since two of their four seats lost their duel — and every other
    /// hacker holds four bronzes.
    ///
    /// So the shape is **one gold, one silver and `4n - 2` bronzes**, and for
    /// the five hackers of §7 that is 3,500 + 2,000 + 18 × 250 = 10,000 basis
    /// points: the published 35% / 20% / 2.5% split exactly, arrived at by
    /// renormalising rather than assumed.
    func playSeason(cast : Cast) {
        var week = 1;
        while (week <= Season.FINAL) {
            playWeek(cast, cast.hackers, week, 100 + Nat64.fromNat(week), false);
            week += 1;
        };
    };

    /// The same six weeks, with each hacker entering **one** qualifier week.
    ///
    /// For the tests whose subject is a *person* rather than a plan: clearing
    /// one hacker's wallet, opting one out, two hackers naming one account, a
    /// wallet edited between the draft and the run. Under `playSeason` a hacker
    /// owns four lineages and so four payout rows, and each of those
    /// manipulations would move four rows at once — which is not what any of
    /// those tests means to say, and would leave several rows sharing one
    /// wallet in checks that read a balance per row.
    ///
    /// Hacker `i` enters week `i % QUALIFIERS + 1` and nothing else, so one
    /// hacker is one lineage is one claim. The bracket is otherwise untouched:
    /// with a cast that fills both halves it is four real qualifier weeks, two
    /// duels and a final, and five hackers come out as a gold, a silver and
    /// three bronzes — 3,500 + 2,000 + 3 × 250 = 6,250 basis points.
    ///
    /// A cast too small to reach both halves is a *thin* season rather than a
    /// broken one, which is what the renormalisation is for: two hackers land
    /// in weeks 1 and 2, both of which feed the same half (rules.md §5), so one
    /// duel is fought, the final is a walkover, and the claims are a gold and a
    /// bronze over 3,750 basis points.
    func playSeasonOneAppEach(cast : Cast) {
        var week = 1;
        while (week <= Season.FINAL) {
            var entrants : [Principal] = [];
            var i = 0;
            while (i < cast.hackers.size()) {
                if (i % Season.QUALIFIERS == week - 1) {
                    entrants := Array.concat(entrants, [cast.hackers[i]]);
                };
                i += 1;
            };
            playWeek(cast, entrants, week, 100 + Nat64.fromNat(week), false);
            week += 1;
        };
    };

    func depositOf(user : Profiles.User) : Treasury.Account = {
        owner = CANISTER;
        subaccount = ?Treasury.subaccountFor(user.id);
    };

    /// The canister-controlled custody account. **No longer where a prize
    /// lands** — a season pays wallets directly — so this appears below only
    /// where a test is about the drain path that empties balances left in
    /// custody from before that change, or is asserting that a season put
    /// nothing there.
    func rewardOf(userId : Nat64) : Treasury.Account =
        Treasury.rewardAccount(CANISTER, userId);

    /// Where a prize actually lands: the winner's own wallet, default
    /// subaccount, in one hop.
    func walletOf(db : Ashroot.DB, userId : Nat64) : Treasury.Account {
        let ?user = db.users.get(userId) else Runtime.trap("no user");
        let ?wallet = user.wallet else Runtime.trap("no wallet");
        { owner = wallet; subaccount = null };
    };

    func userIdOf(db : Ashroot.DB, who : Principal) : Nat64 {
        let ?user = Profiles.byPrincipal(db, who) else Runtime.trap("no user");
        user.id;
    };

    /// The account a user id signs in with.
    ///
    /// Claims and payout rows carry ids; `Profiles.setWallet` takes the
    /// principal, so any test that decides what to do from the *awards* has to
    /// come back the other way.
    func principalOfId(cast : Cast, userId : Nat64) : Principal {
        for (who in cast.hackers.vals()) {
            if (userIdOf(cast.db, who) == userId) return who;
        };
        Runtime.trap("no hacker holds that id");
    };

    /// What one hacker's wallet should be holding: the net of every row that
    /// names them.
    ///
    /// A row is per app and a wallet is per person, so a hacker who fielded
    /// several winning apps is paid several times into one account. Reading a
    /// balance per row would count that account once per row and compare it
    /// against a single row's net.
    func netFor(rows : [Payout.Payout], userId : Nat64) : Nat {
        var total = 0;
        for (row in rows.vals()) { if (row.user_id == userId) total += row.net };
        total;
    };

    public func generated_storage_suffixes_do_not_create_extra_claims() : async Test.Metrics {
        let cast = setUp(1, 1);
        var week = 1;
        while (week <= Season.FINAL) {
            playWeek(
                cast,
                cast.hackers,
                week,
                100 + Nat64.fromNat(week),
                true,
            );
            week += 1;
        };

        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let first = Season.week(cast.db, ended.id, 1, 10);
        let second = Season.week(cast.db, ended.id, 2, 10);
        let owed = Payout.claims(cast.db, ended.id);

        Test.test(
            func() {
                // The database rows are distinct and therefore carry different
                // generated suffixes, despite the author choosing the same id.
                assert first.size() == 1 and second.size() == 1;
                assert first[0].slug != second[0].slug;
                // Reward identity ignores those suffixes and keeps only this
                // app's best finish through the bracket.
                assert owed.size() == 1;
                assert owed[0].award == #gold;
            }
        );
    };

    // ── The whole thing ──────────────────────────────────────────────────────

    public func a_season_runs_from_sponsorship_to_the_winners_wallets() : async Test.Metrics {
        let cast = setUp(5, 2);
        let api = cast.ledger.api();

        // 1. The sponsor sends tokens and says so.
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        let swept = switch (
            await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20)
        ) {
            case (#ok(n)) n;
            case (#err(_)) Runtime.trap("sweep failed");
        };
        assert swept == FUNDED - FEE;
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));
        assert pool == FUNDED - FEE;

        // 2. Six weeks of hacking and judging.
        playSeason(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        assert ended.phase == #finished;
        assert ended.payout == #none;

        // 3. Somebody won, and everybody placed. Five hackers across four
        //    qualifier weeks is the full field of rules.md §7: twenty lineages,
        //    so twenty bronzes handed out, and the two that climbed to the
        //    final are paid higher — one gold, one silver, eighteen bronze,
        //    twenty paid. Not five: a claim is per app, and `hackers[0]` holds
        //    four of these on their own, having entered four times.
        let owed = Payout.claims(cast.db, ended.id);
        assert owed.size() == 20;
        var golds = 0;
        var silvers = 0;
        var bronzes = 0;
        for (claim in owed.vals()) {
            switch (claim.award) {
                case (#gold) golds += 1;
                case (#silver) silvers += 1;
                case (#bronze) bronzes += 1;
            };
        };
        assert golds == 1;
        assert silvers == 1;
        assert bronzes == 18;

        // Every claim already names the wallet it will be paid into, copied
        // from the user row here and frozen onto the payout row at draft —
        // never read from `db.users` again once the plan exists.
        for (claim in owed.vals()) {
            assert claim.to == walletOf(cast.db, claim.userId).owner;
            // Never the principal they authenticate with. That account cannot
            // hold tokens, and `setWallet` refuses to record it as a wallet.
            assert claim.to != principalOfId(cast, claim.userId);
        };

        // 4. The distribution is drafted from what the treasury actually holds.
        let drafted = switch (
            Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 200)
        ) {
            case (#ok(n)) n;
            case (#err(_)) Runtime.trap("draft failed");
        };
        assert drafted == owed.size();

        // 5. Drafting *is* the approval — the plan is sendable the moment it
        //    exists. Nothing human stands between the list and the money, and
        //    nothing can: the canister has no controllers at all, so a
        //    controller-gated approval would be a gate with nobody on the
        //    other side of it. What replaces the signature is that no number
        //    in the plan is a judgement call.
        //
        //    `Payout.approve` and `Payout.discard` are gone rather than merely
        //    unused — both required a `#proposed` phase that `draft` no longer
        //    produces, so they could only ever have answered `#WrongPhase`.
        let ?planned = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        assert planned.payout == #approved;

        // The plan already spends the pool to the last base unit: which row
        // carries the remainder is decided here, at drafting, never at send
        // time.
        var promised = 0;
        for (row in Payout.forSeason(cast.db, ended.id).vals()) { promised += row.gross };
        assert promised == pool;

        // 6. And it goes out.
        let progress = switch (
            await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api)
        ) {
            case (#ok(p)) p;
            case (#err(_)) Runtime.trap("run failed");
        };
        assert progress.left == 0;
        assert progress.failed == 0;
        assert progress.paid == drafted;

        // 7. The money is in the winners' own wallets, and the treasury is
        //    empty — not "empty but for the dust integer division could not
        //    split", empty.
        //
        //    A full field is the one case where renormalising over the awards
        //    present gives back the published percentages themselves: 3,500 +
        //    2,000 + 18 × 250 is 10,000 basis points, so gold takes 35% of the
        //    pool, silver 20% and each bronze 2.5%. 99,990,000 divides by all
        //    three exactly, so no row carries a remainder here.
        let paid = Payout.forSeason(cast.db, ended.id);
        var handedOut = 0;
        for (row in paid.vals()) {
            let want = switch (row.award) {
                case (#gold) 34_996_500; // 35% of 99,990,000
                case (#silver) 19_998_000; // 20%
                case (#bronze) 2_499_750; // 2.5%
            };
            assert row.gross == want;
            assert row.dust == 0;
            handedOut += row.net;
        };
        // Paid per app, delivered per person. `hackers[0]` entered four times
        // and holds four of the twenty rows — a gold, a silver and two bronzes
        // — and all four arrive in the one wallet they named. Collapsing per
        // hacker instead would have paid them once and kept the difference.
        let winner = userIdOf(cast.db, cast.hackers[0]);
        var winnersRows = 0;
        var winnersWeight = 0;
        for (row in paid.vals()) {
            if (row.user_id == winner) {
                winnersRows += 1;
                winnersWeight += Payout.weightOf(row.award);
            };
        };
        assert winnersRows == 4;
        // Which four: 3,500 + 2,000 + 2 × 250 is a gold, a silver and two
        // bronzes and nothing else adds to it.
        assert winnersWeight == 6_000;
        for (who in cast.hackers.vals()) {
            let id = userIdOf(cast.db, who);
            assert cast.ledger.balanceOf(walletOf(cast.db, id)) == netFor(paid, id);
        };
        assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == 0;
        // Every unit is accounted for: in a wallet, or spent on the fee of the
        // transfer that put it there.
        assert handedOut + (drafted * FEE) == pool;

        // Custody is not on the path any more. Nothing was parked in a reward
        // subaccount on the way, so there is nothing here for a winner to
        // withdraw — they were paid, they do not collect.
        for (claim in owed.vals()) {
            assert cast.ledger.balanceOf(rewardOf(claim.userId)) == 0;
        };

        // 8. Settled, and the withdrawal gate is open again.
        let ?after = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        assert after.payout == #paid;
        assert not Payout.running(cast.db);

        Test.test(func() { assert true });
    };

    // ── The pool lands on zero ───────────────────────────────────────────────

    /// One row per ledger carries the remainder, so a season that has paid out
    /// leaves nothing behind.
    ///
    /// Integer division strands up to `n - 1` units per ledger, every season,
    /// forever. The carrier is picked at drafting — the largest payable share,
    /// ties to the lowest user id — because processing order is not stable
    /// across retries, and choosing later would mean recomputing an amount on a
    /// frozen plan, which is the exact thing that makes a retry pay twice.
    public func the_last_base_unit_of_the_pool_is_paid_out() : async Test.Metrics {
        let cast = setUp(5, 2);
        let api = cast.ledger.api();

        // Seven units past a round number, so the split cannot come out even.
        // A full field is 10,000 basis points of weight, so the shares are 35%,
        // 20% and 2.5% of the pool — whole numbers only if the pool divides by
        // 20, by 5 and by 40 respectively, and 99,990,007 is odd.
        //
        // A full field is also what makes this worth checking at all: the
        // remainder can be as large as one unit short of the number of rows,
        // and twenty rows is the most an ordinary season produces.
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED + 7);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeason(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));
        assert pool == 99_990_007;

        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 200);
        let rows = Payout.forSeason(cast.db, ended.id);
        assert rows.size() == 20;

        // The shares before the remainder, each rounded down: 34,996,502 +
        // 19,998,001 + 18 × 2,499,750 is 99,990,003, four short of the pool.
        var carriers = 0;
        var promised = 0;
        for (row in rows.vals()) {
            promised += row.gross;
            if (row.dust > 0) {
                carriers += 1;
                // The largest payable share carries it, which in an ordinary
                // season is the grand-prize winner. Putting it on the smallest
                // would land it on the row most likely to fall under the fee
                // and never be sent at all.
                assert row.award == #gold;
                assert row.dust == 4;
                assert row.gross == 34_996_502 + 4;
                assert row.note == "carries the remainder of the pool";
            } else {
                // Everybody else takes their own truncated share and nothing
                // more: the silver 20% of the pool, each bronze 2.5%.
                assert row.award != #gold;
                assert row.gross == (if (row.award == #silver) 19_998_001 else 2_499_750);
            };
        };
        assert carriers == 1;
        assert promised == pool;

        let progress = switch (
            await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api)
        ) {
            case (#ok(p)) p;
            case (#err(_)) Runtime.trap("run failed");
        };
        assert progress.paid == rows.size();

        Test.test(
            func() {
                // The invariant the whole rule exists for.
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == 0;
                // Each payee receives their own gross less the ledger's fee —
                // the treasury is debited exactly `gross`, which is why the
                // sum above lands on the pool. Per wallet rather than per row,
                // because a hacker with several winning apps has several rows
                // and one account to be paid into.
                for (who in cast.hackers.vals()) {
                    let id = userIdOf(cast.db, who);
                    assert cast.ledger.balanceOf(walletOf(cast.db, id)) == netFor(rows, id);
                };
            }
        );
    };

    /// A share nobody can be paid is divided among everybody else, not
    /// stranded.
    ///
    /// Both exclusions are arithmetic rather than tidiness: `claims` drops the
    /// row, and because `shares` normalises over the weight actually present,
    /// dropping it *redistributes* the share. Leaving the claim in and skipping
    /// the transfer would burn the money instead.
    ///
    /// One app each, because both exclusions are recorded against a *person*:
    /// under a full field clearing one wallet would drop that hacker's four
    /// lineages at once, and what is being weighed here is one share going
    /// missing, not four.
    public func a_share_nobody_can_be_paid_goes_to_everybody_else() : async Test.Metrics {
        let cast = setUp(5, 2);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));

        // The whole field of five — a gold, a silver and three bronzes — before
        // anybody is put out of reach.
        let full = Payout.claims(cast.db, ended.id);
        assert full.size() == 5;

        // Take two of them out of reach, one each way, and make one of them the
        // silver: it is a fifth of the pool on its own, so what has to be
        // redistributed here is one large share and one small one rather than
        // two small ones. The first has their wallet cleared after the fact —
        // the only way to arrive at a hacker without one, since entering
        // requires a wallet. The second stood out of the prize money on
        // purpose.
        var walletCleared : ?Nat64 = null;
        var stoodOut : ?Nat64 = null;
        var optedOutWallet = Treasury.treasury(CANISTER);
        for (claim in full.vals()) {
            if (claim.award == #silver and walletCleared == null) {
                walletCleared := ?claim.userId;
                let ?user = cast.db.users.get(claim.userId) else Runtime.trap("no user");
                ignore Profiles.save(cast.db, { user with wallet = null });
            } else if (claim.award == #bronze and stoodOut == null) {
                stoodOut := ?claim.userId;
                optedOutWallet := walletOf(cast.db, claim.userId);
                ignore Profiles.setRewardOptOut(cast.db, principalOfId(cast, claim.userId), true);
            };
        };
        let ?noWallet = walletCleared else Runtime.trap("no silver to strand");
        let ?optedOut = stoodOut else Runtime.trap("no bronze to opt out");

        // Three claims left — and they now split 3,500 / 250 / 250 of 4,000
        // rather than of 6,250, so each of them is paid *more* than the whole
        // field would have paid them.
        let owed = Payout.claims(cast.db, ended.id);
        assert owed.size() == 3;

        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 200);
        let rows = Payout.forSeason(cast.db, ended.id);
        assert rows.size() == 3;

        var promised = 0;
        for (row in rows.vals()) {
            promised += row.gross;
            // Neither of the two is planned for at all: no row, not a row that
            // fails later.
            assert row.user_id != noWallet;
            assert row.user_id != optedOut;
            // 7/8 of the pool for the winner against 14/25 of it with all five
            // claims, and 1/16 for each surviving bronze against 1/25. Both
            // divide exactly, so no row carries a remainder here — the dust
            // rule has its own test above.
            let want = if (row.award == #gold) 87_491_250 else 6_249_375;
            assert row.gross == want;
            assert row.dust == 0;
            // Strictly more than the whole field of five would have paid them.
            let wholeField = if (row.award == #gold) 55_994_400 else 3_999_600;
            assert row.gross > wholeField;
        };
        // Redistributed, not stranded: the whole pool is still spoken for.
        assert promised == pool;

        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);

        Test.test(
            func() {
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == 0;
                // The hacker who opted out is paid nothing — into their wallet,
                // and into the custody account that no longer receives prizes
                // either.
                assert cast.ledger.balanceOf(optedOutWallet) == 0;
                assert cast.ledger.balanceOf(rewardOf(optedOut)) == 0;
                assert cast.ledger.balanceOf(rewardOf(noWallet)) == 0;
            }
        );
    };

    // ── The ways it could pay twice ──────────────────────────────────────────

    /// Two winners who name the same wallet, and the memo that keeps them
    /// apart.
    ///
    /// Paying wallets directly makes the collision reachable: two rows with the
    /// same award on the same ledger have the same amount, the same fee, the
    /// same destination — and the same `created_at_time`, because the whole
    /// plan is stamped with one `now`. ICRC-1 deduplicates on the argument
    /// record, so byte-identical arguments are *one* transaction: the second
    /// would come back `#Duplicate`, be marked `#paid`, and move no money. The
    /// memo — the row id as eight big-endian bytes — is the only thing that
    /// makes them two.
    ///
    /// One app each, so that pointing two hackers at one account produces
    /// exactly two rows there. Under a full field each of them would bring four
    /// lineages along, and "the two rows that ended up at one account" would be
    /// eight.
    public func two_winners_sharing_a_wallet_are_paid_separately() : async Test.Metrics {
        let cast = setUp(5, 2);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));

        // One wallet, two bronze winners — a shared team account, or one person
        // with two entries under two handles. Nothing forbids it, and nothing
        // about it is anomalous.
        let sharedWallet = principalFor(700);
        var sharing = 0;
        for (claim in Payout.claims(cast.db, ended.id).vals()) {
            if (claim.award == #bronze and sharing < 2) {
                switch (Profiles.setWallet(cast.db, principalOfId(cast, claim.userId), sharedWallet)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("shared wallet failed");
                };
                sharing += 1;
            };
        };
        assert sharing == 2;

        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 200);
        let rows = Payout.forSeason(cast.db, ended.id);
        // Still five rows: a claim is per app, and two apps whose owners happen
        // to name one account are still two apps.
        assert rows.size() == 5;
        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);

        // The two rows that ended up pointing at one account.
        var twins : [Payout.Payout] = [];
        for (row in Payout.forSeason(cast.db, ended.id).vals()) {
            if (row.to == sharedWallet) twins := Array.concat(twins, [row]);
        };

        Test.test(
            func() {
                assert twins.size() == 2;
                // Identical in every argument a ledger deduplicates on...
                assert twins[0].to == twins[1].to;
                assert twins[0].net == twins[1].net;
                assert twins[0].fee == twins[1].fee;
                assert twins[0].createdAtTime == twins[1].createdAtTime;
                // ...and told apart by the memo alone.
                assert twins[0].id != twins[1].id;
                assert Payout.memoFor(twins[0].id) != Payout.memoFor(twins[1].id);

                // Both really moved: the wallet holds two nets, not one.
                assert twins[0].state == #paid and twins[1].state == #paid;
                assert cast.ledger.balanceOf({ owner = sharedWallet; subaccount = null })
                == twins[0].net + twins[1].net;

                // And it is a property of the plan, not a coincidence of these
                // two: no two rows anywhere in it share a memo.
                var i = 0;
                while (i < rows.size()) {
                    var k = i + 1;
                    while (k < rows.size()) {
                        assert Payout.memoFor(rows[i].id) != Payout.memoFor(rows[k].id);
                        k += 1;
                    };
                    i += 1;
                };

                // Every transfer that left the treasury carried its own row's
                // memo. The sponsor's sweep is the one with a `from_subaccount`,
                // and carries none.
                var payouts = 0;
                for (sent in cast.ledger.transfers.vals()) {
                    if (sent.from_subaccount == null) {
                        payouts += 1;
                        var matched = false;
                        for (row in rows.vals()) {
                            if (sent.memo == ?Payout.memoFor(row.id) and sent.amount == row.net) {
                                matched := true;
                            };
                        };
                        assert matched;
                    };
                };
                assert payouts == rows.size();
            }
        );
    };

    /// A wallet edited after the plan exists does not move the money.
    ///
    /// This is the retry story rather than tidiness. `send` never reads
    /// `db.users`: it transfers to the `to` frozen onto the row at draft. A
    /// destination that could change between two attempts would make the second
    /// a *different* transfer, the ledger's deduplication would not fire, and
    /// the winner would be paid twice. `Season.settling` refuses the edit while
    /// a season is settling; this pins the second line of defence, which is the
    /// one that holds even if the first is ever bypassed.
    ///
    /// One app each, so every row has a destination of its own and the balances
    /// below can be read one row at a time.
    public func a_wallet_edited_after_the_draft_is_ignored() : async Test.Metrics {
        let cast = setUp(2, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));

        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 200);
        let rows = Payout.forSeason(cast.db, ended.id);
        // A gold and a bronze, one hacker each: two hackers land in weeks 1 and
        // 2, which feed the same half of the bracket, so only one duel is
        // fought and nobody's best finish is silver.
        assert rows.size() == 2;

        // Everybody moves house between the draft and the run.
        var moved = 0;
        for (who in cast.hackers.vals()) {
            switch (Profiles.setWallet(cast.db, who, principalFor(800 + moved))) {
                case (#ok(_)) {};
                case (#err(_)) Runtime.trap("moving the wallet failed");
            };
            moved += 1;
        };

        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);

        Test.test(
            func() {
                for (row in rows.vals()) {
                    // Paid where the plan said, not where the user row now says.
                    assert cast.ledger.balanceOf({ owner = row.to; subaccount = null }) == row.net;
                    assert cast.ledger.balanceOf(walletOf(cast.db, row.user_id)) == 0;
                };
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == 0;
            }
        );
    };

    public func running_the_distribution_twice_pays_once() : async Test.Metrics {
        let cast = setUp(3, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeason(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));

        // Drafting leaves the plan `#approved`, so this is everything that
        // stands between a finished season and the money going out.
        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 200);
        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);

        let afterFirst = cast.ledger.transfers.size();
        let treasuryAfterFirst = cast.ledger.balanceOf(Treasury.treasury(CANISTER));
        // The first run spent the pool exactly, so a second one paying anything
        // at all would have to overdraw.
        assert treasuryAfterFirst == 0;

        // A moderator pressing the button again — the commonest way a
        // distribution pays twice. `run_payout` is still there for a run that
        // stalled, and the hourly timer calls the same code with no human
        // involved at all.
        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);

        Test.test(
            func() {
                // Already-settled rows are skipped outright, so the ledger is
                // not even asked a second time.
                assert cast.ledger.transfers.size() == afterFirst;
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == treasuryAfterFirst;
            }
        );
    };

    public func ambiguous_rows_go_first_and_pause_their_ledger() : async Test.Metrics {
        let cast = setUp(2, 1);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        ignore Payout.draft(cast.db, ended.id, [(ICP, FUNDED)], [(ICP, FEE)], 200);
        let rows = Payout.forSeason(cast.db, ended.id);
        assert rows.size() == 2;

        // Make the later row a historical unknown. If the loop followed row id
        // order, the earlier planned transfer would be attempted first.
        switch (cast.db.payouts.update({ rows[1] with state = #sending; attempts = 1 })) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("could not prepare ambiguous payout");
        };

        var calls = 0;
        var firstMemo : ?Blob = null;
        let unavailable : Treasury.LedgerApi = {
            balanceOf = func(_account : Treasury.Account) : async* Nat { 0 };
            fee = func() : async* Nat { FEE };
            transfer = func(args : Treasury.TransferArgs) : async* Treasury.TransferResult {
                calls += 1;
                firstMemo := args.memo;
                #Err(#TemporarilyUnavailable);
            };
        };
        ignore await* Payout.runPasses(
            cast.db,
            ended.id,
            CANISTER,
            func(_) = unavailable,
            1,
        );

        let ?planned = cast.db.payouts.get(rows[0].id) else Runtime.trap("planned row gone");
        let ?ambiguous = cast.db.payouts.get(rows[1].id) else Runtime.trap("ambiguous row gone");
        Test.test(
            func() {
                // One temporary failure blocks this ledger for the pass, so the
                // planned row was not allowed to delay the older unknown one.
                assert calls == 1;
                assert firstMemo == ?Payout.memoFor(rows[1].id);
                assert planned.state == #planned;
                assert ambiguous.state == #sending;
            }
        );
    };

    public func deferred_rows_do_not_starve_later_rows_or_other_ledgers() : async Test.Metrics {
        let cast = setUp(5, 1);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        ignore Payout.draft(cast.db, ended.id, [(ICP, FUNDED)], [(ICP, FEE)], 200);
        let drafted = Payout.forSeason(cast.db, ended.id);
        assert drafted.size() == 5;

        // Put the last row on a second ledger after drafting. This test is
        // about the transfer scheduler, not observation/drafting, and keeping
        // the first four ids together makes the starvation order explicit.
        switch (cast.db.payouts.update({ drafted[4] with ledger = OTHER_LEDGER })) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("could not prepare the second-ledger row");
        };

        var mainCalls = 0;
        var otherCalls = 0;
        var callOrder : [Text] = [];
        let main : Treasury.LedgerApi = {
            balanceOf = func(_account : Treasury.Account) : async* Nat { 0 };
            fee = func() : async* Nat { FEE };
            transfer = func(_args : Treasury.TransferArgs) : async* Treasury.TransferResult {
                mainCalls += 1;
                callOrder := Array.concat(callOrder, ["main"]);
                if (mainCalls <= 3) return #Err(#TemporarilyUnavailable);
                #Ok(mainCalls);
            };
        };
        let other : Treasury.LedgerApi = {
            balanceOf = func(_account : Treasury.Account) : async* Nat { 0 };
            fee = func() : async* Nat { FEE };
            transfer = func(_args : Treasury.TransferArgs) : async* Treasury.TransferResult {
                otherCalls += 1;
                callOrder := Array.concat(callOrder, ["other"]);
                #Ok(otherCalls);
            };
        };

        ignore await* Payout.runPasses(
            cast.db,
            ended.id,
            CANISTER,
            func(ledger) = if (ledger == ICP) main else other,
            Payout.PASSES,
        );

        let after = Payout.forSeason(cast.db, ended.id);
        Test.test(
            func() {
                assert mainCalls == 4;
                assert otherCalls == 1;
                // The first main-ledger deferral stopped that ledger for pass
                // one, but not the independent ledger. Later passes defer only
                // the bad rows, allowing the fourth main row to be attempted.
                assert callOrder.size() == 5;
                assert callOrder[0] == "main";
                assert callOrder[1] == "other";
                assert callOrder[2] == "main";
                assert callOrder[3] == "main";
                assert callOrder[4] == "main";

                var i = 0;
                while (i < 3) {
                    assert after[i].state == #planned;
                    assert after[i].attempts == 1;
                    assert after[i].gross == drafted[i].gross;
                    assert after[i].fee == drafted[i].fee;
                    assert after[i].net == drafted[i].net;
                    assert after[i].to == drafted[i].to;
                    assert after[i].createdAtTime == drafted[i].createdAtTime;
                    i += 1;
                };
                assert after[3].state == #paid;
                assert after[3].attempts == 1;
                assert after[4].state == #paid;
                assert after[4].attempts == 1;
            }
        );
    };

    public func an_expired_payout_owner_stops_before_the_next_row() : async Test.Metrics {
        let cast = setUp(2, 1);
        let base = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, base, CANISTER, "helix", ICP, 20);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));
        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 200);
        assert Payout.forSeason(cast.db, ended.id).size() == 2;

        // Simulate the actor lease being replaced while the first ledger call
        // is suspended. Its definite success may be recorded, but this old run
        // must not issue row two or settle the aggregate season.
        var owned = true;
        let api : Treasury.LedgerApi = {
            balanceOf = func(account : Treasury.Account) : async* Nat {
                await* base.balanceOf(account);
            };
            fee = func() : async* Nat { await* base.fee() };
            transfer = func(args : Treasury.TransferArgs) : async* Treasury.TransferResult {
                let result = await* base.transfer(args);
                owned := false;
                result;
            };
        };
        let progress = switch (
            await* Payout.runPassesWhile(
                cast.db,
                ended.id,
                CANISTER,
                func(_) = api,
                Payout.PASSES,
                func() = owned,
            )
        ) {
            case (#ok(found)) found;
            case (#err(_)) Runtime.trap("fenced run failed");
        };
        let ?after = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");

        Test.test(
            func() {
                assert cast.ledger.transfers.size() == 2; // sponsor sweep + exactly one payout
                assert progress.paid == 1;
                assert progress.left == 1;
                assert after.payout == #paying;
            }
        );
    };

    /// One app each, so the sum of the wallets below is the sum of the rows.
    /// Under a full field both hackers hold several rows apiece and adding up a
    /// balance per row would count each wallet more than once.
    public func a_lost_reply_is_retried_and_settles_once() : async Test.Metrics {
        let cast = setUp(2, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));

        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 200);

        // The first transfer's call fails after the ledger may already have
        // acted. The row must be left claimed, not abandoned.
        //
        // One pass, deliberately. `run` makes `Payout.PASSES` attempts at every
        // unsent row before returning, so a single scripted rejection would be
        // swallowed by its own retry and there would be nothing left to resume.
        // What is under test here is resumption across *calls* — that a run cut
        // short leaves a claimed row, and that picking it up again sends the
        // same arguments rather than new ones. `runPasses` lets the test say
        // "one attempt" without encoding how many a real run makes.
        cast.ledger.script(#reject("no reply"));
        let first = switch (
            await* Payout.runPasses(cast.db, ended.id, CANISTER, func(_) = api, 1)
        ) {
            case (#ok(p)) p;
            case (#err(_)) Runtime.trap("run failed");
        };
        assert first.left > 0;
        let ?mid = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        assert mid.payout == #paying;

        // Resuming finishes the job.
        let second = switch (
            await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api)
        ) {
            case (#ok(p)) p;
            case (#err(_)) Runtime.trap("resume failed");
        };

        let rows = Payout.forSeason(cast.db, ended.id);
        var totalNet = 0;
        for (row in rows.vals()) { totalNet += row.net };
        var received = 0;
        for (row in rows.vals()) {
            received += cast.ledger.balanceOf(walletOf(cast.db, row.user_id));
        };

        Test.test(
            func() {
                assert second.left == 0;
                // Each payee got exactly what their row said, in their own
                // wallet — not twice, and not nothing.
                assert received == totalNet;
                // And the retry did not overdraw: the pool covered the plan
                // once and only once.
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == 0;
            }
        );
    };

    public func a_temporary_error_cannot_erase_earlier_payout_ambiguity() : async Test.Metrics {
        let cast = setUp(1, 1);
        let base = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, base, CANISTER, "helix", ICP, 20);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));
        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 12_345);
        let drafted = Payout.forSeason(cast.db, ended.id);
        assert drafted.size() == 1;
        let frozen = drafted[0];

        var payoutCall = 0;
        let uncertain : Treasury.LedgerApi = {
            balanceOf = func(account : Treasury.Account) : async* Nat {
                await* base.balanceOf(account);
            };
            fee = func() : async* Nat { await* base.fee() };
            transfer = func(args : Treasury.TransferArgs) : async* Treasury.TransferResult {
                payoutCall += 1;
                if (payoutCall == 1) {
                    // Apply the transfer, then lose its reply. The caller knows
                    // only that the outcome is ambiguous.
                    switch (await* base.transfer(args)) {
                        case (#Ok(_)) {};
                        case (#Err(_)) Runtime.trap("the first payout did not land");
                    };
                    throw Error.reject("reply lost after the ledger committed");
                };
                if (payoutCall == 2) return #Err(#TemporarilyUnavailable);
                await* base.transfer(args);
            };
        };

        // Unknown but actually landed.
        ignore await* Payout.runPasses(cast.db, ended.id, CANISTER, func(_) = uncertain, 1);
        // A definite temporary error must not turn #sending back into #planned.
        ignore await* Payout.runPasses(cast.db, ended.id, CANISTER, func(_) = uncertain, 1);
        let ?mid = cast.db.payouts.get(frozen.id) else Runtime.trap("payout gone");
        assert mid.state == #sending;
        assert mid.fee == frozen.fee and mid.net == frozen.net;
        assert mid.createdAtTime == frozen.createdAtTime;

        // The ledger now asks for a different fee. Since an earlier transfer
        // may have landed, changing the arguments would create a second payment;
        // the row must stop for reconciliation with its identity untouched.
        cast.ledger.setFee(FEE + 1);
        ignore await* Payout.runPasses(cast.db, ended.id, CANISTER, func(_) = uncertain, 1);
        let ?after = cast.db.payouts.get(frozen.id) else Runtime.trap("payout gone");

        Test.test(
            func() {
                assert after.state == #failed;
                assert after.fee == frozen.fee and after.net == frozen.net;
                assert after.createdAtTime == frozen.createdAtTime;
                assert after.note == "an earlier transfer outcome is unknown; the latest retry reported a changed ledger fee; needs checking by hand";
                // Sponsor sweep plus exactly one payout transfer. No changed-fee
                // transaction was emitted, and the winner received one net.
                assert cast.ledger.transfers.size() == 2;
                assert cast.ledger.balanceOf(walletOf(cast.db, frozen.user_id)) == frozen.net;
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == 0;
            }
        );
    };

    public func a_stamped_time_is_never_rewritten() : async Test.Metrics {
        let cast = setUp(2, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeason(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));

        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 12_345);

        cast.ledger.script(#reject("first attempt lost"));
        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);
        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);

        let rows = Payout.forSeason(cast.db, ended.id);

        Test.test(
            func() {
                // The nonce is half of what the ledger deduplicates on. If a
                // retry ever moved it, the retry would be a second payment.
                for (row in rows.vals()) { assert row.createdAtTime == 12_345 };
                // Only the payout transfers: the sponsor's sweep also went
                // through this ledger and carries no nonce, by design.
                for (sent in cast.ledger.transfers.vals()) {
                    if (sent.from_subaccount == null) {
                        assert sent.created_at_time == ?12_345;
                        // The other half. One `now` stamps the whole plan, so
                        // with a shared destination the memo is all that is
                        // left to tell two rows apart — see
                        // `two_winners_sharing_a_wallet_are_paid_separately`.
                        assert sent.memo != null;
                    };
                };
            }
        );
    };

    public func a_never_sent_old_payment_gets_one_safe_fresh_stamp() : async Test.Metrics {
        let cast = setUp(1, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));
        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 12_345);

        // The first call was definitely rejected before the ledger accepted a
        // transfer. This is the simplest long-freeze-before-first-send case:
        // the still-planned row may receive a current timestamp and retry.
        cast.ledger.script(#fail(#TooOld));
        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);
        let rows = Payout.forSeason(cast.db, ended.id);

        Test.test(
            func() {
                assert rows.size() == 1;
                assert rows[0].createdAtTime != 12_345;
                assert rows[0].state == #paid;
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == 0;
            }
        );
    };

    public func a_definitely_rejected_payment_can_refresh_after_a_later_freeze() : async Test.Metrics {
        let cast = setUp(1, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));
        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 12_345);

        // The ledger was reachable and definitely rejected this attempt. The
        // row remains #planned: unlike #sending, that state proves there is no
        // outcome-unknown transfer whose dedup identity must be preserved.
        cast.ledger.script(#fail(#TemporarilyUnavailable));
        ignore await* Payout.runPasses(cast.db, ended.id, CANISTER, func(_) = api, 1);
        let afterTemporaryRows = Payout.forSeason(cast.db, ended.id);
        assert afterTemporaryRows.size() == 1;
        let afterTemporary = afterTemporaryRows[0];
        assert afterTemporary.state == #planned;
        assert afterTemporary.attempts == 1;
        assert afterTemporary.createdAtTime == 12_345;

        // A later cycles freeze can put that definitely-unsent stamp outside
        // the ledger's window. TooOld is another definite rejection, so the
        // planned row may refresh and then pay. No new state or retry protocol
        // is needed; #planned versus sticky #sending is the proof boundary.
        cast.ledger.script(#fail(#TooOld));
        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);
        let paidRows = Payout.forSeason(cast.db, ended.id);
        assert paidRows.size() == 1;
        let paid = paidRows[0];

        Test.test(
            func() {
                assert paid.createdAtTime != 12_345;
                assert paid.state == #paid;
                assert cast.ledger.balanceOf(walletOf(cast.db, paid.user_id)) == paid.net;
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == 0;
            }
        );
    };

    public func an_ambiguous_old_payment_is_never_re_stamped() : async Test.Metrics {
        let cast = setUp(1, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeasonOneAppEach(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));
        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 12_345);

        cast.ledger.script(#reject("reply lost"));
        ignore await* Payout.runPasses(cast.db, ended.id, CANISTER, func(_) = api, 1);
        cast.ledger.script(#fail(#TooOld));
        ignore await* Payout.runPasses(cast.db, ended.id, CANISTER, func(_) = api, 1);
        let rows = Payout.forSeason(cast.db, ended.id);

        Test.test(
            func() {
                assert rows.size() == 1;
                assert rows[0].createdAtTime == 12_345;
                assert rows[0].state == #failed;
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == pool;
            }
        );
    };

    // ── Withdrawing ──────────────────────────────────────────────────────────

    public func a_winner_withdraws_only_their_own() : async Test.Metrics {
        let cast = setUp(3, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);
        playSeason(cast);
        let ?ended = Season.byNumber(cast.db, cast.season.number) else Runtime.trap("gone");
        let pool = cast.ledger.balanceOf(Treasury.treasury(CANISTER));
        ignore Payout.draft(cast.db, ended.id, [(ICP, pool)], [(ICP, FEE)], 200);
        ignore await* Payout.run(cast.db, ended.id, CANISTER, func(_) = api);

        let me = cast.hackers[0];
        let myId = userIdOf(cast.db, me);
        let myWallet = walletOf(cast.db, myId);

        // The season paid this hacker in one hop, into their own wallet, and
        // left custody empty. So `withdraw` is no longer how anyone collects a
        // prize — it is the drain for balances that were parked in custody
        // before that changed, and that is what is set up below.
        assert cast.ledger.balanceOf(myWallet) > 0;
        assert cast.ledger.balanceOf(rewardOf(myId)) == 0;

        // Credited straight onto the ledger, because no code path fills these
        // any more: they stand for what an earlier season left in custody, and
        // draining that is the whole of what `withdraw` is still for.
        let stranded = 5_000_000;
        for (who in cast.hackers.vals()) {
            cast.ledger.credit(rewardOf(userIdOf(cast.db, who)), stranded);
        };
        let mine = cast.ledger.balanceOf(rewardOf(myId));
        assert mine == stranded;
        let myWalletBefore = cast.ledger.balanceOf(myWallet);

        // Everyone else's custody, before.
        var othersBefore = 0;
        for (who in cast.hackers.vals()) {
            let id = userIdOf(cast.db, who);
            if (id != myId) othersBefore += cast.ledger.balanceOf(rewardOf(id));
        };
        let treasuryBefore = cast.ledger.balanceOf(Treasury.treasury(CANISTER));

        let elsewhere : Treasury.Account = {
            owner = Principal.fromText("2vxsx-fae");
            subaccount = null;
        };
        let got = switch (
            await* Treasury.withdraw(cast.db, api, CANISTER, me, elsewhere, func() = false)
        ) {
            case (#ok(n)) n;
            case (#err(_)) Runtime.trap("withdraw failed");
        };

        var othersAfter = 0;
        for (who in cast.hackers.vals()) {
            let id = userIdOf(cast.db, who);
            if (id != myId) othersAfter += cast.ledger.balanceOf(rewardOf(id));
        };

        Test.test(
            func() {
                assert got == mine - FEE;
                assert cast.ledger.balanceOf(elsewhere) == mine - FEE;
                // Their own custody account is emptied and nothing else is
                // touched: the source is derived from the caller, so there is
                // no input to `withdraw` that can name anything else — not
                // another hacker's custody, not the treasury, and not the
                // wallet a prize was already sent to.
                assert cast.ledger.balanceOf(rewardOf(myId)) == 0;
                assert othersAfter == othersBefore;
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == treasuryBefore;
                assert cast.ledger.balanceOf(myWallet) == myWalletBefore;
            }
        );
    };

    /// An agent drives the account. It does not get to empty it.
    ///
    /// Nominating an agent is meant to cost you nothing but the work you handed
    /// it: the point is not having to give a build script the identity that
    /// also holds the money. `withdraw` takes its *destination* as a parameter,
    /// so an agent resolving there could send the balance anywhere it liked —
    /// which is precisely the thing the arrangement exists to avoid. Opting out
    /// is the same shape from the other side: it throws the whole share away,
    /// and it cannot be taken back once a plan is drafted.
    ///
    /// Both therefore resolve with `Profiles.owner`, unlike almost everything
    /// else, which resolves an agent quite deliberately.
    public func an_agent_cannot_take_or_forfeit_the_prize() : async Test.Metrics {
        let cast = setUp(3, 1);
        let api = cast.ledger.api();

        let me = cast.hackers[0];
        let myId = userIdOf(cast.db, me);
        let robot = principalFor(950);
        switch (Profiles.setAgent(cast.db, me, ?robot)) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("could not nominate the agent");
        };

        // It really does act as them everywhere else — otherwise this test
        // would pass for the wrong reason.
        switch (Profiles.byPrincipal(cast.db, robot)) {
            case (?who) assert who.id == myId;
            case null Runtime.trap("the agent should resolve to the account it drives");
        };

        let stranded = 5_000_000;
        cast.ledger.credit(rewardOf(myId), stranded);

        let elsewhere : Treasury.Account = {
            owner = Principal.fromText("2vxsx-fae");
            subaccount = null;
        };
        let taking = await* Treasury.withdraw(
            cast.db, api, CANISTER, robot, elsewhere, func() = false,
        );
        let forfeiting = Profiles.setRewardOptOut(cast.db, robot, true);

        Test.test(
            func() {
                switch (taking) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("an agent should not be able to withdraw");
                };
                // Nothing moved, and nowhere to look for it.
                assert cast.ledger.balanceOf(rewardOf(myId)) == stranded;
                assert cast.ledger.balanceOf(elsewhere) == 0;

                switch (forfeiting) {
                    case (#err(#NotRegistered)) {};
                    case _ Runtime.trap("an agent should not be able to opt out");
                };
                switch (cast.db.users.get(myId)) {
                    case (?who) assert not who.rewardOptOut;
                    case null Runtime.trap("gone");
                };

                // And the holder is not locked out of their own account by any
                // of this: the rule is who may, not that nobody may.
                switch (Profiles.setRewardOptOut(cast.db, me, true)) {
                    case (#ok(_)) {};
                    case (#err(_)) Runtime.trap("the holder should be able to opt out");
                };
            }
        );
    };

    public func somebody_owed_nothing_withdraws_nothing() : async Test.Metrics {
        // A registered user who never entered: no reward account, no balance,
        // and no way to reach anyone else's. They have to sign up with the
        // rest of the cast — the season start shuts the door behind them.
        let bystander = principalFor(900);
        let cast = setUpWith(2, 1, [(bystander, "bystander")]);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);

        let elsewhere : Treasury.Account = {
            owner = Principal.fromText("2vxsx-fae");
            subaccount = null;
        };
        let outcome = await* Treasury.withdraw(
            cast.db, api, CANISTER, bystander, elsewhere, func() = false,
        );

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#Nothing)) {};
                    case (_) Runtime.trap("expected #Nothing");
                };
                // The treasury is untouched — this is the attack that matters.
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == FUNDED - FEE;
                assert cast.ledger.balanceOf(elsewhere) == 0;
            }
        );
    };

    public func withdrawing_is_refused_while_a_run_is_in_flight() : async Test.Metrics {
        let cast = setUp(2, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);

        let elsewhere : Treasury.Account = {
            owner = Principal.fromText("2vxsx-fae");
            subaccount = null;
        };
        let outcome = await* Treasury.withdraw(
            cast.db, api, CANISTER, cast.hackers[0], elsewhere, func() = true,
        );

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#Locked)) {};
                    case (_) Runtime.trap("expected #Locked");
                };
            }
        );
    };

    public func an_unregistered_caller_gets_nothing() : async Test.Metrics {
        let cast = setUp(1, 1);
        let api = cast.ledger.api();
        cast.ledger.credit(depositOf(cast.sponsor), FUNDED);
        ignore await* Treasury.sweep(cast.db, api, CANISTER, "helix", ICP, 20);

        let stranger = Principal.fromText("2vxsx-fae");
        let outcome = await* Treasury.withdraw(
            cast.db,
            api,
            CANISTER,
            stranger,
            { owner = stranger; subaccount = null },
            func() = false,
        );

        Test.test(
            func() {
                switch (outcome) {
                    case (#err(#NotRegistered)) {};
                    case (_) Runtime.trap("expected #NotRegistered");
                };
                assert cast.ledger.balanceOf(Treasury.treasury(CANISTER)) == FUNDED - FEE;
            }
        );
    };

};
