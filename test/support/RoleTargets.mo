/// Current optimistic-concurrency targets for moderation unit tests.
///
/// Production role decisions bind to the immutable user id, the role state,
/// and the profile version a moderator actually reviewed. Most unit tests are
/// interested in a fresh decision rather than a stale one, so resolving that
/// three-field snapshot at every call site would repeat the same plumbing and
/// make tests accidentally keep an old target after an earlier transition.
///
/// Tests that intentionally exercise staleness use `judgeOf`, `sponsorOf`, or
/// `moderatorOf` once and retain that value across the intervening write.

import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";

import Ashroot "../../backend/.ashroot/lib";
import Moderation "../../backend/lib/Moderation";
import Profiles "../../backend/lib/Profiles";

module {
    /// Former-shape conveniences for ordinary tests. Each call resolves a
    /// fresh snapshot immediately before invoking production moderation.
    public func setJudge(
        db : Ashroot.DB,
        by : Principal,
        handle : Text,
        status : Profiles.JudgeStatus,
        note : ?Text,
        now : Nat64,
    ) : Result.Result<Profiles.User, Moderation.Error> {
        Moderation.setJudge(db, by, judge(db, handle), status, note, now);
    };

    public func setSponsor(
        db : Ashroot.DB,
        by : Principal,
        handle : Text,
        status : Profiles.SponsorStatus,
        note : ?Text,
        now : Nat64,
    ) : Result.Result<Profiles.User, Moderation.Error> {
        Moderation.setSponsor(db, by, sponsor(db, handle), status, note, now);
    };

    public func setModerator(
        db : Ashroot.DB,
        by : Principal,
        handle : Text,
        on : Bool,
        note : ?Text,
        now : Nat64,
    ) : Result.Result<Profiles.User, Moderation.Error> {
        Moderation.setModerator(db, by, moderator(db, handle), on, note, now);
    };

    /// Exercise the production missing-row branch without pretending an
    /// absent account has a current handle to resolve.
    public func setAbsentJudge(
        db : Ashroot.DB,
        by : Principal,
        status : Profiles.JudgeStatus,
        note : ?Text,
        now : Nat64,
    ) : Result.Result<Profiles.User, Moderation.Error> {
        let id : Nat64 = 18_446_744_073_709_551_615;
        switch (db.users.get(id)) {
            case null {};
            case (?_) Runtime.trap("reserved absent test id exists");
        };
        Moderation.setJudge(
            db,
            by,
            { id; expectedStatus = #no; expectedUpdatedAt = 0 },
            status,
            note,
            now,
        );
    };

    public func judge(db : Ashroot.DB, handle : Text) : Moderation.JudgeTarget {
        judgeOf(current(db, handle));
    };

    public func sponsor(db : Ashroot.DB, handle : Text) : Moderation.SponsorTarget {
        sponsorOf(current(db, handle));
    };

    public func moderator(db : Ashroot.DB, handle : Text) : Moderation.ModeratorTarget {
        moderatorOf(current(db, handle));
    };

    public func judgeOf(user : Profiles.User) : Moderation.JudgeTarget = {
        id = user.id;
        expectedStatus = user.judgeStatus;
        expectedUpdatedAt = user.updatedAt;
    };

    public func sponsorOf(user : Profiles.User) : Moderation.SponsorTarget = {
        id = user.id;
        expectedStatus = user.sponsorStatus;
        expectedUpdatedAt = user.updatedAt;
    };

    public func moderatorOf(user : Profiles.User) : Moderation.ModeratorTarget = {
        id = user.id;
        expectedOn = user.moderator;
        expectedUpdatedAt = user.updatedAt;
    };

    func current(db : Ashroot.DB, handle : Text) : Profiles.User {
        let ?user = Profiles.byHandle(db, handle) else {
            Runtime.trap("missing role target @" # handle);
        };
        user;
    };
};
