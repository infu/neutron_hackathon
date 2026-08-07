/// User registration and profile logic over the database.
///
/// Kept out of the actor so `main.mo` stays a thin authorization + dispatch
/// shell. Nothing here is async; every function is a pure transformation of
/// the passed-in `Ashroot.DB` handle.

import Array "mo:core/Array";
import Char "mo:core/Char";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Text "mo:core/Text";

import IndexRuntime "mo:ashroot/index_runtime";

import Assets "./Assets";

import Ashroot "../.ashroot/lib";

module {

    public type User = Ashroot.Types.User;

    /// The participant directory never needs account-control or metering
    /// fields.  Keeping the projection here makes every public listing use the
    /// same allowlist instead of relying on each actor method to remember what
    /// a raw database row contains.
    public type PublicUser = {
        id : Nat64;
        handle : Text;
        displayName : Text;
        title : ?Text;
        bio : Text;
        avatar : ?Text;
        links : [Link];
        hacker : Bool;
        judgeStatus : JudgeStatus;
        sponsorStatus : SponsorStatus;
        sponsor : ?SponsorInfo;
        moderator : Bool;
        anonymized : Bool;
        createdAt : Nat64;
        updatedAt : Nat64;
    };

    public let TERMS_VERSION : Nat = 5;
    public let TERMS_EFFECTIVE_AT : Nat64 = 1_786_060_800_000_000_000;
    public let MAX_ACCOUNTS : Nat = 1_200;
    /// Hacking is self-service, but its asset allowance is much larger than an
    /// observer's avatar allowance. Capping the role before sealing makes the
    /// published per-account allowance fit the asset store: 1,000 hackers at 64
    /// keys / 32 MB of fixed-slot storage plus the remaining 200 accounts at two
    /// small-slot allowances stay below both global ceilings, leaving room for
    /// the frontend.
    public let MAX_HACKERS : Nat = 1_000;
    public let MAX_APPROVED_SPONSORS : Nat = 64;
    /// A small operational bench is also a resource boundary: each moderator
    /// may retain one takedown backing per app in the sealed season.
    public let MAX_MODERATORS : Nat = 8;

    /// Judging is a flag on the one user table, not a separate kind of user.
    /// Approved judges are still ordinary participants — the rule that they
    /// cannot score their own entry belongs in voting, once that exists.
    public type JudgeStatus = Ashroot.Types.Users.User.JudgeStatus;

    /// Sponsorship is a claim about an organisation, so it is an application.
    public type SponsorStatus = Ashroot.Types.Users.User.SponsorStatus;

    /// Sponsor-only fields, hanging off the same row. One table, one id —
    /// whatever we later attach to a user (submissions, votes, prizes)
    /// attaches to sponsors for free.
    public type SponsorInfo = Ashroot.Types.Users.User.Sponsor;

    /// What an applicant actually supplies.
    ///
    /// Deliberately *not* the stored record. `given` is accounting — written
    /// only by `recordGift`, only from a real balance read in `Treasury.sweep`
    /// — and a field a caller can put on the wire is a field a caller can lie
    /// in. Leaving it on the input and ignoring it server-side would work, but
    /// it would also sit there looking meaningful.
    public type SponsorApplication = {
        org : Text;
        website : Text;
        logo : ?Text;
        blurb : Text;
        ledgers : [Ashroot.Types.Users.User.Sponsor.Ledgers.Element];
    };

    public type Link = { kind : Text; url : Text };

    public type Input = {
        handle : Text;
        displayName : Text;
        /// Free text like "CEO of Something". Mainly a judge thing, but the
        /// field lives on every user so the shape stays uniform.
        title : ?Text;
        bio : Text;
        links : [Link];
        /// Accepting the Season Rules & Peer Participation Agreement.
        ///
        /// **One acceptance, covering every role.** The agreement says so
        /// itself: you agree to the common rules and to the rules for every
        /// role you assume. So there is nothing further to collect when
        /// somebody later takes a role — no second checkbox, no modal, no
        /// per-role attestation that a route could forget to show.
        ///
        /// A boolean on the input rather than a separate call, because a
        /// separate call is a state where an account exists having agreed to
        /// nothing, and every reader then has to decide what that means.
        terms : Bool;
    };

    public type Error = {
        /// The caller's account is frozen: they may read, not write.
        #Frozen;
        #Anonymous;
        #Closed;
        #NotRegistered;
        #AlreadyRegistered;
        #HandleTaken;
        /// The terms were not accepted, or the sanctions declaration was not
        /// made. Separate from `#Invalid` because the UI has a checkbox to
        /// point at for each, and a generic message cannot say which.
        #Terms;
        /// The season is settling up. Nothing about an account may move until
        /// the rewards have gone out and the controllers are back — see
        /// `Season.settling` for why a wallet edit mid-distribution is a
        /// double-payment rather than an inconvenience.
        #Settling;
        #Invalid : Text;
        #Db : Ashroot.Errors.Error;
    };

    /// Roles stack: a user can be a hacker, a judge, a sponsor and a
    /// moderator at once. "Observer" is not a flag — it is the absence of
    /// every other role, which is what makes it the default and keeps the
    /// states consistent.
    public func isObserver(user : User) : Bool {
        not user.hacker
        and user.judgeStatus == #no
        and user.sponsorStatus == #no
        and not user.moderator;
    };

    let MAX_LINKS = 8;
    let MAX_URL = 256;
    /// What a link's label may run to. The same 24 as `Season`'s entry links —
    /// they are the same kind of field and are rendered by the same component.
    let MAX_LINK_KIND = 24;
    let MAX_TITLE = 80;
    // `-` has never been valid in a user handle, so this namespace is also
    // collision-free for rows created before `deleted_` became reserved.
    let TOMBSTONE_PREFIX = "deleted-";
    let LEGACY_TOMBSTONE_PREFIX = "deleted_";

    // ── Validation ───────────────────────────────────────────────────────────

    /// Handles double as URL path segments (`/u/<id>/`) and display identity,
    /// so keep them boring: lowercase, digits, underscore.
    public func validHandle(handle : Text) : Bool {
        // An anonymized row is renamed into this namespace. Keeping it out of
        // user input makes that rename collision-free without a second table
        // or a retry scheme.
        if (
            Text.startsWith(handle, #text TOMBSTONE_PREFIX)
            or Text.startsWith(handle, #text LEGACY_TOMBSTONE_PREFIX)
        ) return false;
        let size = handle.size();
        if (size < 3 or size > 32) return false;
        for (c in handle.chars()) {
            let ok = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '_';
            if (not ok) return false;
        };
        true;
    };

    func validate(input : Input) : Result.Result<(), Error> {
        if (
            Text.startsWith(input.handle, #text TOMBSTONE_PREFIX)
            or Text.startsWith(input.handle, #text LEGACY_TOMBSTONE_PREFIX)
        ) {
            return #err(#Invalid("deleted-account handles are reserved"));
        };
        if (not validHandle(input.handle)) {
            return #err(#Invalid("handle must be 3-32 characters of a-z, 0-9 or _"));
        };
        if (input.displayName.size() > 64) return #err(#Invalid("displayName exceeds 64 characters"));
        switch (input.title) {
            case (?title) {
                if (title.size() > MAX_TITLE) {
                    return #err(#Invalid("title exceeds " # Nat.toText(MAX_TITLE) # " characters"));
                };
            };
            case null {};
        };
        if (input.bio.size() > 1000) return #err(#Invalid("bio exceeds 1000 characters"));
        if (not input.terms) return #err(#Terms);
        if (input.links.size() > MAX_LINKS) return #err(#Invalid("at most 8 links"));
        for (link in input.links.vals()) {
            if (link.url.size() > MAX_URL) return #err(#Invalid("link url too long"));
            // The label is bounded for the same reason as the url. `Season`'s
            // links already cap this; a profile's did not, so the field the UI
            // limits to 24 characters accepted a megabyte from anything that
            // was not the UI.
            if (link.kind.size() > MAX_LINK_KIND) return #err(#Invalid("link label is too long"));
            let https = Text.startsWith(link.url, #text "https://");
            let http = Text.startsWith(link.url, #text "http://");
            if (not (https or http)) return #err(#Invalid("link url must be http(s)"));
        };
        #ok;
    };

    // ── Reads ────────────────────────────────────────────────────────────────

    /// Who is calling — the account holder, or a principal they authorised.
    ///
    /// A hacker may nominate one **agent**: a second principal that acts as
    /// them. The point is automation. Building, packaging and submitting a
    /// `.neutron` every week is script-shaped work, and the alternative is
    /// handing a script the Internet Identity that also holds the money.
    ///
    /// Resolving it here rather than at each call site is deliberate — "the
    /// same way as they can" is the requirement, and an allowlist of methods
    /// the agent may use would be a list somebody has to remember to extend.
    /// The exceptions go the other way instead: the handful of methods that
    /// must be the human call `owner` below, and each says why.
    public func byPrincipal(db : Ashroot.DB, who : Principal) : ?User {
        let found = switch (db.users.byPrincipal.locate(who)) {
            case (?pk) db.users.get(pk);
            case null {
                let ?pk = db.users.byAgent.locate(who) else return null;
                db.users.get(pk);
            };
        };
        let ?user = found else return null;
        if (user.anonymized) null else ?user;
    };

    /// The account holder themselves, never an agent.
    ///
    /// For the things an automation principal must not be able to do: nominate
    /// a *further* agent, move where the money goes, or delete the account. An
    /// agent that could do any of those could take the account, which is a
    /// different thing from being able to drive it.
    public func owner(db : Ashroot.DB, who : Principal) : ?User {
        let ?pk = db.users.byPrincipal.locate(who) else return null;
        let ?user = db.users.get(pk) else return null;
        if (user.anonymized) null else ?user;
    };

    public func byHandle(db : Ashroot.DB, handle : Text) : ?User {
        let ?pk = db.users.byHandle.locate(handle) else return null;
        db.users.get(pk);
    };

    public func publicUser(user : User) : PublicUser = {
        id = user.id;
        handle = user.handle;
        displayName = user.displayName;
        title = user.title;
        bio = user.bio;
        avatar = user.avatar;
        links = user.links;
        hacker = user.hacker;
        judgeStatus = user.judgeStatus;
        sponsorStatus = user.sponsorStatus;
        sponsor = user.sponsor;
        moderator = user.moderator;
        anonymized = user.anonymized;
        createdAt = user.createdAt;
        updatedAt = user.updatedAt;
    };

    /// `updatedAt` is also the optimistic-concurrency version used by
    /// moderation decisions. Canister time may repeat across separate
    /// messages, so a raw timestamp is not enough to prove that the account
    /// shown to a moderator is still the account being changed.
    public func nextUpdatedAt(user : User, at : Nat64) : Nat64 {
        if (at > user.updatedAt) return at;
        // Checked Nat64 arithmetic deliberately traps at the unreachable
        // maximum instead of ever reusing a concurrency version.
        user.updatedAt + 1;
    };

    /// Asset key prefix a user is allowed to write into.
    public func scope(user : User) : Text = "/u/" # Nat64.toText(user.id) # "/";

    public func count(db : Ashroot.DB) : Nat = db.users.size();

    /// Newest first, `limit` at most.
    public func recent(db : Ashroot.DB, limit : Nat) : [User] {
        let out = List.empty<User>();
        label scan for (user in db.users.byCreated.rangeIter({ gt = null; gte = null; lt = null; lte = null; dir = #bwd }, null)) {
            if (List.size(out) >= limit) break scan;
            List.add(out, user);
        };
        List.toArray(out);
    };

    let ALL_HANDLES = { gt = null; gte = null; lt = null; lte = null; dir = #fwd };

    // ── Paged listing ────────────────────────────────────────────────────────

    /// Resume token: the handle of the last row examined.
    ///
    /// NOT `Cursors.Token`. Ashroot's tokens encode `(indexKey, slot)` where
    /// `slot` is the row's internal position in the slot list — a value no
    /// read API exposes. Building one from `doc.id` compares an id against a
    /// slot, which silently repeats or skips rows. Only `rangeDelete` can
    /// round-trip an ashroot token, because it runs inside the iterator.
    ///
    /// Every listing here is ordered by handle, and handles are unique, so an
    /// exclusive `gt` bound on the handle is an exact resume point.
    public type Cursor = Text;

    /// Bucket to restrict a listing to: "A".."Z" for handles starting with
    /// that letter, "#" for the ones that start with a digit or underscore.
    /// `null` is the whole listing.
    public type Letter = Text;

    public type Page = {
        rows : [User];
        /// `null` means the end of the listing.
        next : ?Cursor;
        /// Total matching rows for the filter and letter — not the page size.
        total : Nat;
    };

    public type PublicPage = {
        rows : [PublicUser];
        next : ?Cursor;
        total : Nat;
    };

    public func publishPage(page : Page) : PublicPage = {
        rows = Array.map<User, PublicUser>(page.rows, publicUser);
        next = page.next;
        total = page.total;
    };

    public type Filter = {
        #all;
        #hackers;
        #observers;
        #judges;
        #pending;
        #sponsors;
        #sponsorsPending;
        #moderators;
    };

    public type Counts = {
        users : Nat;
        hackers : Nat;
        observers : Nat;
        judges : Nat;
        pending : Nat;
        sponsors : Nat;
        sponsorsPending : Nat;
        moderators : Nat;
    };

    /// One entry per A-Z bucket plus "#", so the client can render an index
    /// that knows what exists without loading a single row.
    public type LetterCount = { letter : Letter; count : Nat };

    let DEFAULT_LIMIT = 24;

    /// The ceiling for the paged API, `users_page` and `users_search`.
    ///
    /// It used to apply to every listing that ran through `page`, including the
    /// unpaged conveniences the actor bounds at `MAX_PEOPLE = 200` — so
    /// `pending_judges(200)` was clamped to 200 by the actor and then quietly
    /// to 100 here, returning half of what it documented. Two ceilings on one
    /// call is one too many; a caller that has already applied its own says so
    /// with `pageWithin`.
    let MAX_LIMIT = 100;

    /// Upper bound on a listing, and nothing more.
    ///
    /// A smaller request is honoured exactly, so paging still works and no
    /// existing caller changes behaviour; only a number above the ceiling is
    /// brought down. The ceilings themselves are API policy and live in the
    /// actor, next to the methods they apply to.
    ///
    /// Without one, a listing was bounded only by how much data happened to
    /// exist — fine on a small table, and on one that grows for the life of
    /// the event an easy way to ask for a response that will not fit.
    public func atMost(limit : Nat, ceiling : Nat) : Nat {
        if (limit > ceiling) ceiling else limit;
    };

    func clamp(limit : Nat, ceiling : Nat) : Nat {
        if (limit == 0) DEFAULT_LIMIT else if (limit > ceiling) ceiling else limit;
    };

    /// Stage code for the two-step roles.
    ///
    /// ashroot index keys are Nat/Nat32/Nat64/Int/Text/Principal/Blob — no
    /// Bool, no variants — so a projection is unavoidable. The boolean roles
    /// avoid a code entirely by being *sparse*: the index holds only members,
    /// so membership is the key's existence and the handle alone orders them.
    /// Judge and sponsor have two live stages, so those keep a code.
    ///
    /// `#no` is absent from the index rather than coded 0.
    // Shared with the database's role-index projections — keep in step.
    let PENDING = 1;
    let APPROVED = 2;

    func stageOf(filter : Filter) : Nat {
        switch (filter) {
            case (#judges or #sponsors) APPROVED;
            case (_) PENDING;
        };
    };

    /// Half-open handle bounds for a bucket: `[lo, hi)`.
    ///
    /// Handles are `[a-z0-9_]`, and digits (0x30) and underscore (0x5F) all
    /// sort below "a" (0x61), so the non-alphabetic bucket is simply
    /// everything before "a".
    func letterBounds(letter : ?Letter) : (Text, Text) {
        switch (letter) {
            case null ("", "");
            case (?l) {
                if (l == "#") return ("", "a");
                let lower = lowercase(l);
                (lower, successor(lower));
            };
        };
    };

    func lowercase(letter : Text) : Text {
        var out = "";
        for (c in letter.chars()) {
            let code = Char.toNat32(c);
            out #= Text.fromChar(
                if (code >= 65 and code <= 90) Char.fromNat32(code + 32) else c
            );
        };
        out;
    };

    /// Smallest string strictly greater than every string with this prefix:
    /// "m" -> "n", "z" -> "{".
    ///
    /// Only used for single-letter bucket bounds now that group codes are
    /// Nat, but it still preserves the prefix rather than returning the bare
    /// incremented character — a multi-character input would otherwise come
    /// back *below* what it is meant to cap.
    func successor(text : Text) : Text {
        let chars = Text.toArray(text);
        let n = chars.size();
        if (n == 0) return "a";
        var out = "";
        var i = 0;
        while (i + 1 < n) {
            out #= Text.fromChar(chars[i]);
            i += 1;
        };
        out # Text.fromChar(Char.fromNat32(Char.toNat32(chars[n - 1]) + 1));
    };

    func handleRange(letter : ?Letter, after : ?Cursor) : IndexRuntime.IndexRange<Text> {
        let (lo, hi) = letterBounds(letter);
        let inside = withinBucket(lo, after);
        {
            // A cursor may only narrow the page. This used to read "a cursor is
            // always inside the bucket" and drop `lo` whenever one was present —
            // so a cursor from a *lower* bucket widened the page down into the
            // buckets underneath, and a request for D came back holding B and C.
            // A stale page token is enough to do it.
            gt = if (inside) after else null;
            gte = if (inside or lo == "") null else ?lo;
            lt = if (hi == "") null else ?hi;
            lte = null;
            dir = #fwd;
        };
    };

    /// Is this cursor inside the bucket, or left over from a lower one?
    func withinBucket(lo : Text, after : ?Cursor) : Bool = switch (after) {
        case (?handle) handle >= lo;
        case null false;
    };

    /// Range over one group, optionally narrowed to a letter bucket.
    ///
    /// The upper bound is where the next stage begins: `(code + 1, "")`.
    /// Text tags needed a string-successor for this, which is easy to get
    /// subtly wrong in a way that inverts the range and silently returns
    /// nothing. Nat removes the whole class of bug.
    func groupRange(code : Nat, letter : ?Letter, after : ?Cursor) : IndexRuntime.IndexRange<(Nat, Text)> {
        let (lo, hi) = letterBounds(letter);
        // The identical shape, and so the identical bug — the filtered listings
        // went the same way as the flat ones.
        let inside = withinBucket(lo, after);
        {
            gt = switch (after) { case (?h) if (inside) ?(code, h) else null; case null null };
            gte = if (inside) null else ?(code, lo);
            lt = ?(if (hi == "") (code + 1, "") else (code, hi));
            lte = null;
            dir = #fwd;
        };
    };

    public func counts(db : Ashroot.DB) : Counts {
        // A sparse index *is* the set, so a boolean role's count is just its
        // size — no range scan, no key comparison at all.
        {
            users = db.users.size();
            hackers = db.users.byHackerHandle.size();
            observers = db.users.byObserverHandle.size();
            moderators = db.users.byModeratorHandle.size();
            judges = groupCount(db, #judges, null);
            pending = groupCount(db, #pending, null);
            sponsors = groupCount(db, #sponsors, null);
            sponsorsPending = groupCount(db, #sponsorsPending, null);
        };
    };

    public func pendingSponsorCount(db : Ashroot.DB) : Nat = groupCount(db, #sponsorsPending, null);

    public func approvedSponsorCount(db : Ashroot.DB) : Nat = groupCount(db, #sponsors, null);

    /// Any submitted sponsor record freezes the controller-configured ledger
    /// allowlist.  Status alone is insufficient because a withdrawn or
    /// rejected application deliberately keeps its details for audit/reapply.
    public func hasSponsorApplication(db : Ashroot.DB) : Bool {
        for (user in db.users.byHandle.rangeIter(ALL_HANDLES, null)) {
            if (user.sponsor != null) return true;
        };
        false;
    };

    public func ledgerAllowed(db : Ashroot.DB, ledger : Principal) : Bool {
        let config = db.store.get();
        if (not config.ledgerAllowlistSet) return false;
        for (allowed in config.ledgerAllowlist.vals()) {
            if (allowed == ledger) return true;
        };
        false;
    };

    public func applicationLedgersAllowed(db : Ashroot.DB, application : SponsorApplication) : Bool {
        let config = db.store.get();
        if (not config.ledgerAllowlistSet) return false;
        for (ledger in application.ledgers.vals()) {
            if (not ledgerAllowed(db, ledger.id)) return false;
        };
        true;
    };

    /// `#judges` and `#pending` live in `byJudgeHandle`, `#moderators` in
    /// `byModeratorHandle`. Both are `(tag, handle)` so the same range shape
    /// works for either; only the index differs.
    /// Boolean roles key on the handle alone, so the plain handle range works
    /// unchanged; judge and sponsor prefix theirs with a stage code.
    func groupIter(db : Ashroot.DB, filter : Filter, letter : ?Letter, after : ?Cursor) : Iter.Iter<User> {
        let flat = handleRange(letter, after);
        let staged = groupRange(stageOf(filter), letter, after);
        switch (filter) {
            case (#hackers) db.users.byHackerHandle.rangeIter(flat, null);
            case (#observers) db.users.byObserverHandle.rangeIter(flat, null);
            case (#moderators) db.users.byModeratorHandle.rangeIter(flat, null);
            case (#sponsors or #sponsorsPending) db.users.bySponsorHandle.rangeIter(staged, null);
            case (_) db.users.byJudgeHandle.rangeIter(staged, null);
        };
    };

    func groupCount(db : Ashroot.DB, filter : Filter, letter : ?Letter) : Nat {
        let flat = handleRange(letter, null);
        let staged = groupRange(stageOf(filter), letter, null);
        switch (filter) {
            case (#hackers) db.users.byHackerHandle.countInRange(flat, null);
            case (#observers) db.users.byObserverHandle.countInRange(flat, null);
            case (#moderators) db.users.byModeratorHandle.countInRange(flat, null);
            case (#sponsors or #sponsorsPending) db.users.bySponsorHandle.countInRange(staged, null);
            case (_) db.users.byJudgeHandle.countInRange(staged, null);
        };
    };

    public func total(db : Ashroot.DB, filter : Filter, letter : ?Letter) : Nat {
        switch (filter) {
            case (#all) {
                switch (letter) {
                    case null db.users.size();
                    case (?_) db.users.byHandle.countInRange(handleRange(letter, null), null);
                };
            };
            case _ groupCount(db, filter, letter);
        };
    };

    /// One page of users, always alphabetical by handle.
    ///
    /// Every filter has an index that is *already* in handle order:
    ///   #all                    byHandle
    ///   #judges, #pending       byJudgeHandle      (code, handle)
    ///   #sponsors               bySponsorHandle    (code, handle)
    ///   #hackers, #observers    by{Hacker,Observer}Handle
    ///   #moderators             byModeratorHandle  (code, handle)
    ///
    /// So no filter needs a scan-and-discard pass, and a page costs the page
    /// rather than the table. The same ranges let `letter` seek straight to a
    /// bucket without reading anything before it.
    public func page(
        db : Ashroot.DB,
        filter : Filter,
        letter : ?Letter,
        after : ?Cursor,
        limit : Nat,
    ) : Page = pageWithin(db, filter, letter, after, limit, MAX_LIMIT);

    /// `page`, for a caller that has already bounded the request itself.
    ///
    /// The actor holds the API ceilings — they are policy, and they differ per
    /// method. This exists so applying one there does not mean applying a
    /// second, smaller one here.
    public func pageWithin(
        db : Ashroot.DB,
        filter : Filter,
        letter : ?Letter,
        after : ?Cursor,
        limit : Nat,
        ceiling : Nat,
    ) : Page {
        let want = clamp(limit, ceiling);
        let out = List.empty<User>();
        var last : ?Text = null;
        var exhausted = true;

        let iter = switch (filter) {
            case (#all) db.users.byHandle.rangeIter(handleRange(letter, after), null);
            case _ groupIter(db, filter, letter, after);
        };

        label scan for (user in iter) {
            if (List.size(out) >= want) { exhausted := false; break scan };
            last := ?user.handle;
            List.add(out, user);
        };

        {
            rows = List.toArray(out);
            next = if (exhausted) null else last;
            total = total(db, filter, letter);
        };
    };

    /// Per-bucket counts for the A-Z index. 27 range counts against an index
    /// that is already sorted — cheap, and it means the strip can show what
    /// exists without the client fetching a single row.
    public func letterCounts(db : Ashroot.DB, filter : Filter) : [LetterCount] {
        let buckets = [
            "#", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
            "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
        ];
        Array.map<Text, LetterCount>(
            buckets,
            func(letter) { { letter; count = total(db, filter, ?letter) } },
        );
    };

    /// Handle prefix search. Walks only the matching stretch of `byHandle`,
    /// so cost is proportional to hits rather than table size.
    public func search(db : Ashroot.DB, prefix : Text, filter : Filter, limit : Nat) : [User] {
        let want = clamp(limit, MAX_LIMIT);
        if (prefix == "") return [];
        let out = List.empty<User>();
        // Over-fetch so a filter applied after the prefix walk can still fill
        // a page; bounded so a one-letter prefix cannot pull the whole table.
        label scan for (user in db.users.byHandle.prefixFind(#fwd, lowercase(prefix), want * 8 + 32)) {
            if (List.size(out) >= want) break scan;
            if (matches(user, filter)) List.add(out, user);
        };
        List.toArray(out);
    };

    func matches(user : User, filter : Filter) : Bool {
        switch (filter) {
            case (#all) true;
            case (#hackers) user.hacker;
            case (#observers) isObserver(user);
            case (#judges) user.judgeStatus == #approved;
            case (#pending) user.judgeStatus == #pending;
            case (#sponsors) user.sponsorStatus == #approved;
            case (#sponsorsPending) user.sponsorStatus == #pending;
            case (#moderators) user.moderator;
        };
    };

    /// Moderator powers, or the canister controller as the root of trust.
    /// Controllers are always allowed so a fresh deployment is never locked
    /// out before the first moderator exists.
    // ── Rewards, automation and leaving ──────────────────────────────────────

    /// Where this account's rewards are sent.
    ///
    /// **[decided]** Not the principal they signed in with. An Internet
    /// Identity here is a per-origin pseudonym: it is not an account on any
    /// ledger, tokens sent to it are not spendable, and the mistake is
    /// invisible until the money has already moved. So it is refused, and the
    /// UI points at the NNS wallet instead.
    ///
    /// Replaceable but never clearable. A hacker who is about to be paid must
    /// have somewhere for it to go, and "I removed it" three days before a
    /// distribution is a support ticket nobody can answer afterwards.
    public func setWallet(db : Ashroot.DB, caller : Principal, wallet : Principal) : Result.Result<User, Error> {
        let ?user = owner(db, caller) else return #err(#NotRegistered);
        if (Principal.isAnonymous(wallet)) return #err(#Invalid("that is the anonymous principal"));
        if (wallet == user.principal) {
            return #err(#Invalid(
                "that is the identity you signed in with, which cannot hold tokens — "
                # "make a wallet at https://nns.ic0.app/ and use its principal"
            ));
        };
        save(db, { user with wallet = ?wallet });
    };

    /// Nominate, or stand down, the principal that may act as this account.
    public func setAgent(db : Ashroot.DB, caller : Principal, agent : ?Principal) : Result.Result<User, Error> {
        let ?user = owner(db, caller) else return #err(#NotRegistered);
        switch (agent) {
            case (?who) {
                if (Principal.isAnonymous(who)) return #err(#Invalid("that is the anonymous principal"));
                if (who == user.principal) return #err(#Invalid("that is already your own principal"));
                // One principal, one account. Without this an agent could be
                // pointed at somebody else's account and `byPrincipal` would
                // have two answers.
                if (db.users.byAgent.exists(who)) return #err(#Invalid("that principal already automates an account"));
                if (db.users.byPrincipal.exists(who)) return #err(#Invalid("that principal is a registered account"));
            };
            case null {};
        };
        save(db, { user with agent });
    };

    /// Stand out of the prize money, so it is shared among everybody else.
    /// **The account holder's own call.** Opting out forfeits the whole prize
    /// share — `shares` renormalises over who is left, so it is given away to
    /// the other winners and cannot be taken back once a plan is drafted. An
    /// agent that could do that could destroy the thing it was nominated to
    /// help earn, which is squarely what `owner` is for.
    public func setRewardOptOut(db : Ashroot.DB, caller : Principal, out : Bool) : Result.Result<User, Error> {
        let ?user = owner(db, caller) else return #err(#NotRegistered);
        save(db, { user with rewardOptOut = out });
    };

    /// Erase the person, keep the row.
    ///
    /// **[decided]** Not a delete. Entries point at users, votes point at
    /// entries, and payouts point at both — removing the row would either
    /// cascade through a settled bracket or leave dangling references in the
    /// record of a finished season. Neither is acceptable for something that
    /// has already been judged in public.
    ///
    /// So everything personal goes and the row stays: name scrambled to the
    /// account number, bio, title, links and avatar cleared, roles dropped.
    /// What survives is what the bracket needs to still add up.
    public func anonymize(db : Ashroot.DB, user : User, now : Nat64) : Result.Result<User, Error> {
        let tag = TOMBSTONE_PREFIX # Nat64.toText(user.id);
        save(
            db,
            {
                user with
                handle = tag;
                displayName = "Deleted account";
                title = null;
                bio = "";
                avatar = null;
                links = [];
                hacker = false;
                judgeStatus = #no;
                sponsorStatus = #no;
                sponsor = null;
                moderator = false;
                wallet = null;
                agent = null;
                anonymized = true;
                updatedAt = nextUpdatedAt(user, now);
            },
        );
    };

    /// How many moderators there are.
    ///
    /// `byModeratorHandle` is sparse — it holds its members and nobody else —
    /// so this is the index's own size rather than a scan.
    public func moderatorCount(db : Ashroot.DB) : Nat = db.users.byModeratorHandle.size();

    public func canModerate(db : Ashroot.DB, caller : Principal) : Bool {
        if (Principal.isController(caller)) return true;
        switch (owner(db, caller)) {
            case (?user) user.moderator;
            case null false;
        };
    };

    /// The deliberately narrow part of moderation that an account's nominated
    /// automation principal may perform. `byPrincipal` resolves either the
    /// owner or that one agent to the same user row, so Review's user-id check
    /// still prevents either key from deciding the account's own work.
    ///
    /// Do not use this for any other moderator power. Those continue to call
    /// `canModerate`, which requires the account owner's principal.
    public func canReviewApps(db : Ashroot.DB, caller : Principal) : Bool {
        if (Principal.isController(caller)) return true;
        switch (byPrincipal(db, caller)) {
            case (?user) user.moderator;
            case null false;
        };
    };

    /// Unpaged convenience wrappers over `page`, for callers that know the set
    /// is small — the seed script, the CLI, and tests.
    public func moderators(db : Ashroot.DB, limit : Nat) : [User] {
        // Ceiling `limit`: the actor already applied its own.
        pageWithin(db, #moderators, null, null, limit, limit).rows;
    };

    public func alphabetical(db : Ashroot.DB, status : ?JudgeStatus, limit : Nat) : [User] {
        let filter : Filter = switch (status) {
            case null #all;
            case (?#approved) #judges;
            case (?#pending) #pending;
            // No index shortcut for "not a judge"; walk the alphabet.
            case (?#no) return alphabeticalWhere(db, func(u) { u.judgeStatus == #no }, limit);
        };
        pageWithin(db, filter, null, null, limit, limit).rows;
    };

    public func alphabeticalWhere(db : Ashroot.DB, keep : User -> Bool, limit : Nat) : [User] {
        let out = List.empty<User>();
        label scan for (user in db.users.byHandle.rangeIter(ALL_HANDLES, null)) {
            if (List.size(out) >= limit) break scan;
            if (keep(user)) List.add(out, user);
        };
        List.toArray(out);
    };

    // ── Writes ───────────────────────────────────────────────────────────────

    /// One registration for everyone. Judging is opted into afterwards with
    /// `applyAsJudge`.
    public func register(db : Ashroot.DB, caller : Principal, now : Nat64, input : Input) : Result.Result<User, Error> {
        if (Principal.isAnonymous(caller)) return #err(#Anonymous);
        // Account deletion retains this index deliberately. Ask it before the
        // mutable launch gates so the same principal is always told that its
        // one registration was already used, even after registration closes
        // or the account table fills.
        if (db.users.byPrincipal.exists(caller)) return #err(#AlreadyRegistered);
        if (not db.store.get().registrationOpen) return #err(#Closed);
        if (db.users.size() >= MAX_ACCOUNTS) {
            return #err(#Closed);
        };
        switch (validate(input)) { case (#err(e)) return #err(e); case (#ok) {} };
        if (db.users.byHandle.exists(input.handle)) return #err(#HandleTaken);

        let row : Ashroot.Types.CreateUser = {
            principal = caller;
            handle = input.handle;
            displayName = input.displayName;
            title = input.title;
            bio = input.bio;
            avatar = null;
            links = input.links;
            // Everyone starts as an observer — that is simply no roles set.
            hacker = false;
            judgeStatus = #no;
            sponsorStatus = #no;
            sponsor = null;
            moderator = false;
            // What this account has cost us so far, which is nothing yet.
            instructions = 0;
            bytes = 0;
            frozen = false;
            // Where rewards go. Not set here even when it was offered at
            // signup — `setWallet` is the one place that checks it, and having
            // two ways in is how one of them ends up not checking.
            wallet = null;
            agent = null;
            rewardOptOut = false;
            // Whatever the caller ticked. `validate` has already refused a
            // registration that did not, so these are true by construction —
            // recorded rather than assumed, because "when did they agree" is
            // the question these exist to answer.
            // When they accepted the agreement. Recorded because "did they,
            // and when" is the question this field exists to answer.
            termsAt = if (input.terms) now else 0;
            termsVersion = TERMS_VERSION;
            anonymized = false;
            createdAt = now;
            updatedAt = now;
        };

        switch (db.users.insert(row)) {
            case (#err(e)) #err(#Db(e));
            case (#ok(pk)) {
                let ?user = db.users.get(pk) else return #err(#NotRegistered);
                #ok(user);
            };
        };
    };

    public func update(db : Ashroot.DB, caller : Principal, now : Nat64, input : Input) : Result.Result<User, Error> {
        let ?current = owner(db, caller) else return #err(#NotRegistered);
        switch (validate(input)) { case (#err(e)) return #err(e); case (#ok) {} };
        if (input.handle != current.handle and db.users.byHandle.exists(input.handle)) {
            return #err(#HandleTaken);
        };
        save(db, { current with
            handle = input.handle;
            displayName = input.displayName;
            title = input.title;
            bio = input.bio;
            links = input.links;
            updatedAt = nextUpdatedAt(current, now);
        });
    };

    public func setAvatar(db : Ashroot.DB, caller : Principal, key : ?Text, now : Nat64) : Result.Result<(User, ?Text), Error> {
        let ?current = owner(db, caller) else return #err(#NotRegistered);
        switch (key) {
            case (?k) {
                let prefix = scope(current);
                if (not Assets.keyWithinLimit(k)) return #err(#Invalid("avatar key is too long"));
                // The same predicate an entry's art goes through. Prefix alone
                // let `/u/1/../2/avatar/face.png` past, and a 1.9 MB package
                // stand in as a face.
                if (not Assets.inScope(k, ?prefix)) {
                    return #err(#Invalid("avatar must live under " # prefix));
                };
                if (not Assets.ownedKey(k, prefix, "avatar")) {
                    return #err(#Invalid("avatar must live under " # prefix # "avatar/"));
                };
            };
            case null {};
        };
        // The avatar it replaces, so the caller can delete the file. The UI
        // uploads to a fresh timestamped key every time, so without this every
        // change a person makes to their picture leaves the previous one
        // online and still charged to them — the most frequent orphan there
        // is, and the least visible.
        let gone = switch (current.avatar, key) {
            case (?was, ?next) if (was != next) ?was else null;
            case (?was, null) ?was;
            case (null, _) null;
        };
        switch (save(db, {
            current with
            avatar = key;
            updatedAt = nextUpdatedAt(current, now);
        })) {
            case (#ok(saved)) #ok((saved, gone));
            case (#err(e)) #err(e);
        };
    };

    /// Hacking is self-service: pick it, drop it, no approval.
    public func setHacker(db : Ashroot.DB, caller : Principal, on : Bool, now : Nat64) : Result.Result<User, Error> {
        let ?current = owner(db, caller) else return #err(#NotRegistered);
        if (current.hacker == on) return #ok(current);
        // A large app storage allowance cannot be shed while its files remain and
        // then handed to a new hacker. That would let accounts rotate through
        // the 1,000-role cap while retaining 32 MB of slots each, defeating the global
        // capacity envelope. Deleting back to the ordinary avatar allowance
        // makes the role reusable without stranding the former hacker.
        if (not on and current.bytes > Assets.MAX_NON_HACKER_BYTES) {
            return #err(#Invalid(
                "delete app files until no more than "
                # Nat.toText(Assets.MAX_NON_HACKER_BYTES / 1_024)
                # " KiB of storage remains before leaving the hacker role"
            ));
        };
        if (on and db.users.byHackerHandle.size() >= MAX_HACKERS) {
            return #err(#Invalid(
                "the hacker capacity of " # Nat.toText(MAX_HACKERS) # " accounts is full"
            ));
        };
        save(db, {
            current with
            hacker = on;
            updatedAt = nextUpdatedAt(current, now);
        });
    };

    let MAX_ORG = 80;
    let MAX_URL_LONG = 256;
    let MAX_BLURB = 500;

    /// A sponsor's logo is an asset key like any other, and was the one that
    /// nothing checked. The sponsors board renders it as `<img src>`, so an
    /// arbitrary URL there is a tracking pixel firing at every visitor of it.
    func checkLogo(logo : ?Text, prefix : Text) : Result.Result<(), Error> {
        let ?key = logo else return #ok;
        if (not Assets.keyWithinLimit(key)) return #err(#Invalid("logo key is too long"));
        if (not Assets.ownedKey(key, prefix, "avatar")) {
            return #err(#Invalid("logo must live under " # prefix # "avatar/"));
        };
        #ok;
    };

    public func validateSponsor(info : SponsorInfo) : Result.Result<(), Error> {
        if (info.org.size() == 0) return #err(#Invalid("organisation name is required"));
        if (info.org.size() > MAX_ORG) return #err(#Invalid("organisation name is too long"));
        if (info.website.size() > MAX_URL_LONG) return #err(#Invalid("website url is too long"));
        if (info.website != "") {
            let https = Text.startsWith(info.website, #text "https://");
            let http = Text.startsWith(info.website, #text "http://");
            if (not (https or http)) return #err(#Invalid("website must be http(s)"));
        };
        if (info.blurb.size() > MAX_BLURB) return #err(#Invalid("blurb is too long"));
        if (info.ledgers.size() > MAX_LEDGERS) return #err(#Invalid("too many ledgers"));
        // A ledger listed twice would be swept twice and counted twice.
        var i = 0;
        while (i < info.ledgers.size()) {
            var j = i + 1;
            while (j < info.ledgers.size()) {
                if (info.ledgers[i].id == info.ledgers[j].id) {
                    return #err(#Invalid("that ledger is listed twice"));
                };
                j += 1;
            };
            i += 1;
        };
        #ok;
    };

    /// Enough for a sponsor paying in several tokens, few enough that the
    /// moderator reviewing them can actually check each one.
    public let MAX_LEDGERS = 7;

    /// Add a swept amount to what a sponsor has given on one ledger.
    ///
    /// Accumulates rather than appends: a sponsor who tops up repeatedly has
    /// given one running total per token, which is what the board shows.
    public func recordGift(
        db : Ashroot.DB,
        userId : Nat64,
        ledger : Principal,
        amount : Nat,
        now : Nat64,
    ) : Result.Result<User, Error> {
        // This read must happen after the ledger awaits in `Treasury.sweep`.
        // Saving the pre-await row can restore a revoked role or erase a
        // concurrent wallet/profile edit.
        let ?user = db.users.get(userId) else return #err(#NotRegistered);
        let ?info = user.sponsor else return #err(#Invalid("not a sponsor"));

        var found = false;
        let bumped = Array.map<Ashroot.Types.Users.User.Sponsor.Given.Element, Ashroot.Types.Users.User.Sponsor.Given.Element>(
            info.given,
            func(gift) {
                if (gift.ledger != ledger) return gift;
                found := true;
                { gift with amount = gift.amount + amount; at = now };
            },
        );
        let given = if (found) bumped else Array.concat(bumped, [{ ledger; amount; at = now }]);
        save(db, {
            user with
            sponsor = ?{ info with given };
            updatedAt = nextUpdatedAt(user, now);
        });
    };

    /// Apply to sponsor. Unlike hacking, this is a claim about an
    /// organisation, so it lands as `#pending` for a moderator to approve.
    public func applyAsSponsor(
        db : Ashroot.DB,
        caller : Principal,
        application : SponsorApplication,
        now : Nat64,
    ) : Result.Result<User, Error> {
        let ?current = owner(db, caller) else return #err(#NotRegistered);
        if (current.sponsorStatus == #approved) {
            return #err(#Invalid("withdraw and reapply so changes receive a new review"));
        };
        // Contributions carry across untouched. They are not part of the
        // application and there is no way to express them in one.
        let given = switch (current.sponsor) {
            case (?previous) previous.given;
            case null [];
        };
        let info : SponsorInfo = { application with given };
        switch (validateSponsor(info)) { case (#err(e)) return #err(e); case (#ok) {} };
        switch (checkLogo(info.logo, scope(current))) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };
        save(db, {
            current with
            sponsor = ?info;
            sponsorStatus = #pending;
            updatedAt = nextUpdatedAt(current, now);
        });
    };

    /// Withdraw a sponsorship. Keeps the details so re-applying is cheap.
    public func withdrawSponsor(db : Ashroot.DB, caller : Principal, now : Nat64) : Result.Result<User, Error> {
        let ?current = owner(db, caller) else return #err(#NotRegistered);
        if (current.sponsorStatus == #no) return #ok(current);
        save(db, {
            current with
            sponsorStatus = #no;
            updatedAt = nextUpdatedAt(current, now);
        });
    };

    /// Opt in to judging. Flips the flag to `#pending`; a controller decides.
    /// Re-applying after approval is a no-op rather than a downgrade.
    public func applyAsJudge(db : Ashroot.DB, caller : Principal, now : Nat64) : Result.Result<User, Error> {
        let ?current = owner(db, caller) else return #err(#NotRegistered);
        switch (current.judgeStatus) {
            case (#approved) #ok(current);
            case (#pending) #ok(current);
            case (#no) save(db, {
                current with
                judgeStatus = #pending;
                updatedAt = nextUpdatedAt(current, now);
            });
        };
    };

    /// Shared with `Moderation.mo`, which writes the same rows.
    public func save(db : Ashroot.DB, user : User) : Result.Result<User, Error> {
        switch (db.users.update(user)) {
            case (#ok(saved)) #ok(saved);
            case (#err(e)) #err(#Db(e));
        };
    };
};
