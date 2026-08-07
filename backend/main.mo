/// Neutron Hackathon canister — an AI-powered hackathon for Neutron apps.
///
/// Deliberately thin: this file is authorization + dispatch only. All the real
/// work lives in modules —
///
///   lib/Assets.mo    chunked uploads, SHA-256, IC certification, HTTP serving
///   lib/Painless.mo  IC HTTP gateway types + chunked response plumbing
///   lib/Profiles.mo  registration and profile rules
///   lib/Moderation.mo moderator actions + the audit log behind them
///   lib/Season.mo    the season format: entries, votes, round resolution
///   lib/Treasury.mo  sponsor deposit addresses and sweeping
///   .ashroot/lib.mo  database implementation

import List "mo:core/List";
import Cycles "mo:core/Cycles";
import Error "mo:core/Error";
import Iter "mo:core/Iter";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Timer "mo:core/Timer";

import Prim "mo:⛔";

import Array "mo:core/Array";
import Map "mo:core/Map";
import Ashroot "./.ashroot/lib";
import Assets "./lib/Assets";
import Slab "./lib/Slab";
import Painless "./lib/Painless";
import Meter "./lib/Meter";
import Moderation "./lib/Moderation";
import Controllers "./lib/Controllers";
import Notices "./lib/Notices";
import Payout "./lib/Payout";
import Review "./lib/Review";
import Season "./lib/Season";
import Treasury "./lib/Treasury";
import Profiles "./lib/Profiles";
import Defaults "./support/defaults";

persistent actor Hackathon {

    // ── State ────────────────────────────────────────────────────────────────

    let dbMem : Ashroot.Mem = Ashroot.Mem();
    let assetMem : Assets.Mem = Assets.init();
    /// Kept outside the persisted Approval record so upgrading an existing
    /// canister does not change that stable row's EOP shape. Legacy takedown
    /// votes have no entry here and therefore authorize nothing.
    let takedownContexts : Moderation.TakedownContexts = Moderation.initTakedownContexts();
    /// Emergency controller recovery needs no new table or schema. There are
    /// at most eight moderators, so a persisted list of their stable user ids
    /// is the complete bounded vote record. Revoked or anonymised ids stop
    /// counting when the tally is read.
    var controllerRecoveryBackers : [Nat64] = [];
    transient var controllerRecoveryCallActive = false;
    let CONTROLLER_RECOVERY_NEEDED = 3;
    public type ControllerRecovery = {
        votes : Nat;
        needed : Nat;
        mine : Bool;
        recovered : Bool;
    };

    // Both handles wrap stable memory in closures, so they are rebuilt per
    // call and must never be held as actor-level state.
    func db() : Ashroot.DB = Ashroot.Use(dbMem, Defaults.store());
    func assets() : Assets.Use = Assets.Use(assetMem);
    func now() : Nat64 = Nat64.fromIntWrap(Time.now());

    /// Participant storage is accounted in the same fixed slots the allocator
    /// reserves, never in the smaller payload lengths shown by `Assets.Info`.
    /// Every participant file is one chunk, so its complete size selects its
    /// one allocator class exactly.
    func slotCharge(size : Nat) : Nat {
        let ?class_ = Slab.classFor(size) else Runtime.trap("stored asset exceeds slab capacity");
        Slab.slotBytes(class_);
    };

    /// Rows written by the payload-byte implementation survive a setup-time
    /// upgrade. On this account's first storage-sensitive call after every
    /// install/upgrade, rebuild its figure from the real files. The transient
    /// marker keeps byte reconciliation O(1); production cannot upgrade after seal.
    transient let reconciledStorage = Map.empty<Nat64, Bool>();

    func storageUsed(database : Ashroot.DB, store : Assets.Use, user : Profiles.User) : Nat {
        switch (Map.get(reconciledStorage, Nat64.compare, user.id)) {
            case (?_) return user.bytes;
            case null {};
        };

        var actual = 0;
        for (key in store.keys(Profiles.scope(user), Assets.MAX_LIVE_SLOTS + 1).vals()) {
            switch (store.info(key)) {
                case (?file) actual += slotCharge(file.size);
                case null {};
            };
        };
        if (actual != user.bytes) Meter.charge(database, user.id, actual, user.bytes);
        Map.add(reconciledStorage, Nat64.compare, user.id, true);
        actual;
    };

    /// Persisted before the management-canister call that removes every
    /// external controller. Once set, launch-sensitive state is frozen even
    /// while that call is awaiting a reply. It deliberately remains set after a
    /// successful seal until the season starts; the season therefore starts
    /// from exactly the launch-sensitive state that passed readiness rather
    /// than from a moderator-edited role/configuration state a moment later.
    var sealing = false;
    /// Distinguishes a live call from a persisted latch left behind by an
    /// interrupted upgrade. A controller may safely retry the latter only
    /// after `seal_canister` has checked the real controller list.
    transient var sealingCallActive = false;
    transient let SEALING_LOCKED = "launch configuration is frozen because canister sealing has begun";

    // ── HTTP ─────────────────────────────────────────────────────────────────

    public query func http_request(request : Painless.Request) : async Painless.Response {
        assets().http(request, http_request_streaming_callback);
    };

    public query func http_request_streaming_callback(token : Painless.Token) : async Painless.Callback {
        assets().callback(token);
    };

    // ── Assets: controller-only ──────────────────────────────────────────────

    /// Frontend bundles, `.neutron` packages, anything site-owned.
    /// Driven by `scripts/upload.mjs`.
    public shared ({ caller }) func assets_upload(cmd : Assets.Cmd) : async Result.Result<(), Text> {
        if (not Principal.isController(caller)) return #err("caller is not a controller");
        if (sealing) return #err(SEALING_LOCKED);
        assets().upload(cmd, null, Assets.defaultLimits);
    };

    public query func assets_list(prefix : Text, limit : Nat) : async [Assets.Info] {
        assets().list(prefix, Profiles.atMost(limit, MAX_ASSETS));
    };

    public query func assets_count() : async Nat {
        assets().size();
    };

    public query func frontend_asset_keys() : async [Text] {
        assets().frontendKeys();
    };

    // ── Assets: user-scoped ──────────────────────────────────────────────────

    /// A registered user may only write under `/u/<their id>/`.
    /// Upload into your own namespace.
    ///
    /// What the file is for — and therefore how large it may be — comes from
    /// the folder it is going into, not from the caller. Declaring it meant the
    /// avatar and image caps were advisory: anyone wanting a 1.9 MB avatar
    /// asked for the package limit and got it.
    /// Role-aware account and whole-store ceilings live in `Assets`; the
    /// hacker-cap proof in `Profiles` is calculated against those same values.
    /// Keeping one source prevents a harmless-looking local constant change
    /// from reopening the global capacity exhaustion bug.

    public shared ({ caller }) func my_upload(cmd : Assets.Cmd) : async Result.Result<(), Text> {
        let ?m = Meter.open(db(), caller) else return #err("your account is frozen");
        Meter.close(m, userUpload(caller, cmd));
    };

    /// Synchronous body for `my_upload`: keeping every validation return in
    /// here guarantees the shared wrapper reaches exactly one `Meter.close`.
    func userUpload(caller : Principal, cmd : Assets.Cmd) : Result.Result<(), Text> {
        let database = db();
        let store = assets();
        let ?user = Profiles.byPrincipal(database, caller) else return #err("not registered");
        let usedStorage = storageUsed(database, store, user);
        let scope = Profiles.scope(user);
        let ?key = Assets.keyOf(cmd) else return #err("that is not an upload you can make");
        let writing = switch (cmd) { case (#store(_) or #chunk(_)) true; case (_) false };
        // A malformed key is a different complaint from a key in the wrong
        // folder, and the asset store already words the first one.
        if (not Assets.inScope(key, ?scope)) return #err("key out of scope: " # key);
        let kind = switch (Assets.kindFor(key, scope)) {
            case (?valid) valid;
            case null {
                // Admission is strict, but an older malformed file must remain
                // deletable so this fix cannot strand already-hosted bytes.
                if (not writing) {
                    switch (Assets.folderOf(key, scope)) {
                        case (?"avatar") #avatar;
                        case (?"icon") #icon;
                        case (?"shots") #media;
                        case (?"pkg") #package;
                        case _ return #err("uploads go in " # scope # "{avatar,icon,shots,pkg}/");
                    };
                } else {
                    switch (Assets.folderOf(key, scope)) {
                        case (?"pkg") {
                            return #err("a package is " # scope # "pkg/<digits>.neutron");
                        };
                        case (?"avatar" or ?"icon" or ?"shots") {
                            return #err("that is not a file type we serve; images only, by extension");
                        };
                        case _ {
                            return #err("uploads go in " # scope # "{avatar,icon,shots,pkg}/");
                        };
                    };
                };
            };
        };
        let appKind = switch (kind) {
            case (#avatar) false;
            case (#icon or #media or #package) true;
        };
        if (writing and not Assets.mayWriteKind(kind, user.hacker)) {
            return #err("choose the hacker role before uploading app files");
        };
        if (writing and appKind) {
            // Qualifier art follows the details form: carried bracket rows keep
            // their approved icon and screenshots. Builds are different.
            // `publish_update` deliberately remains open for a current
            // semi-final or final row, so its fresh `.neutron` key must be
            // uploadable too. The new key changes only that carried row when a
            // moderator approves it; settled rows keep their old immutable key.
            //
            // Every app upload, including a bracket build, closes at the same
            // final-hour boundary as revision proposals and approvals.
            switch (Season.running(database)) {
                case (?season) {
                    let bracketBuild = switch (kind) {
                        case (#package) true;
                        case (#avatar or #icon or #media) false;
                    };
                    if (
                        not Review.changesOpen(season, now())
                        or (season.week > Season.QUALIFIERS and not bracketBuild)
                    ) {
                        return #err("app uploads are closed for this round");
                    };
                };
                case null {};
            };
        };
        // A closed week is a record, and a record includes the art it was
        // judged on. Once an entry is no longer editable its files are frozen
        // with it — otherwise the row is immutable and the picture is not.
        let sponsorLogoLocked = switch (user.sponsor) {
            case (?info) {
                user.sponsorStatus != #no and info.logo == ?key;
            };
            case null false;
        };
        if (sponsorLogoLocked or Review.assetLocked(database, user.id, key)) {
            return #err("that file is referenced by a published entry or pending review");
        };
        if (writing and Season.participantWritesClosedAt(database, now())) {
            return #err("uploads are permanently closed after the season finishes");
        };
        if (Season.settling(database)) {
            return #err("files are locked until the season's rewards have been distributed");
        };

        // What a participant's file is served as is ours to decide, not
        // theirs to declare. A stored `text/html` executes on the origin that
        // serves this app, which is where the sign-in session lives. The
        // encoding goes the same way — it is another response header the
        // caller would otherwise control.
        let contentType = if (writing) {
            let ?served = Assets.typeFor(key, kind) else {
                return #err("that is not a file type we serve; images only, by extension");
            };
            served;
        } else {
            "";
        };
        let sanitised = switch (cmd) {
            case (#store(req)) #store({ req with contentType; contentEncoding = "identity" });
            case (other) other;
        };

        // A namespace has a ceiling. Deletes are always allowed — the way back
        // under it must never itself be refused — and the overshoot is bounded
        // by one file, since `limitsFor` already caps every upload.
        let old = store.info(key);
        let held = switch (old) { case (?was) was.size; case null 0 };
        let incoming : Nat = switch (cmd) {
            case (#store(req)) {
                if (req.content.size() == 0) return #err("empty files are not stored");
                req.content.size();
            };
            case (#chunk(req)) {
                if (req.content.size() == 0) return #err("empty chunks are not stored");
                held + req.content.size();
            };
            case (_) 0;
        };
        let heldCharge = switch (old) { case (?was) slotCharge(was.size); case null 0 };
        let incomingClass = if (writing) Slab.classFor(incoming) else null;
        if (writing and incomingClass == null) return #err("file is too large for stable storage");
        let incomingCharge = switch (incomingClass) {
            case (?class_) Slab.slotBytes(class_);
            case null 0;
        };
        let withoutOld = if (usedStorage > heldCharge) Nat.sub(usedStorage, heldCharge) else 0;
        let projectedBytes = if (writing) withoutOld + incomingCharge else withoutOld;
        let maxUserBytes = Assets.maxBytesFor(user.hacker);
        if (writing and projectedBytes > maxUserBytes) {
            let allowance = if (maxUserBytes >= 1_000_000) {
                Nat.toText(maxUserBytes / 1_000_000) # " MB";
            } else {
                Nat.toText(maxUserBytes / 1_024) # " KiB";
            };
            return #err(
                "that upload would exceed the " # allowance
                # " account storage allowance — delete something first"
            );
        };

        if (writing) {
            let oldExists = store.info(key) != null;
            let maxUserKeys = Assets.maxKeysFor(user.hacker);
            if (not oldExists and store.keys(scope, maxUserKeys + 1).size() >= maxUserKeys) {
                return #err("an account may hold at most " # Nat.toText(maxUserKeys) # " asset keys");
            };

            let stats = store.storage();
            let addedSlots = switch (cmd) {
                case (#store(_)) if (oldExists) 0 else 1;
                case (#chunk(_)) 1;
                case (_) 0;
            };
            if (stats.liveSlots + addedSlots > Assets.MAX_LIVE_SLOTS) {
                return #err("the event's asset-slot limit has been reached");
            };

            let ?class_ = incomingClass else Runtime.trap("checked incoming class disappeared");
            // A same-class replacement releases its old slot before writing.
            // Otherwise ask the allocator whether this class already has an
            // interior free slot or reserved tail capacity to reuse.
            let replacingSameClass = switch (cmd, old) {
                case (#store(_), ?was) Slab.classFor(was.size) == ?class_;
                case _ false;
            };
            let growth = if (replacingSameClass) 0 else store.reservationGrowth(class_);
            if (stats.reserved + growth > Assets.MAX_RESERVED_BYTES) {
                return #err("the event's reserved asset-storage limit has been reached");
            };
        };

        let done = store.upload(sanitised, ?scope, Assets.limitsFor(kind));
        // Read the actual result even on error. A store replacement releases
        // its old slot before asking stable memory to grow; if that grow fails,
        // the old file is deliberately gone and its allowance must be returned.
        let afterCharge = switch (store.info(key)) {
            case (?is) slotCharge(is.size);
            case null 0;
        };
        if (afterCharge != heldCharge) {
            Meter.bytes(database, caller, afterCharge, heldCharge);
        };
        done;
    };

    public shared ({ caller }) func set_avatar(key : ?Text) : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        Meter.close(m, setAvatar(caller, key));
    };

    func setAvatar(caller : Principal, key : ?Text) : Result.Result<Profiles.User, Profiles.Error> {
        let database = db();
        if (Season.participantWritesClosedAt(database, now()) or Season.settling(database)) {
            return #err(#Settling);
        };
        switch (Profiles.setAvatar(database, caller, key, now())) {
            case (#err(e)) #err(e);
            case (#ok((saved, gone))) {
                // The picture it replaced. Every change writes a fresh
                // timestamped key, so without this a person who updates their
                // avatar three times is serving and paying for three.
                switch (gone) {
                    case (?old) {
                        // A sponsor's logo is required to live in this same
                        // `avatar/` folder and may name the very key being
                        // displaced. Deleting it unconditionally then takes the
                        // sponsors board's picture down with it, and nothing
                        // says so — the card simply renders a 404. A row that
                        // still points at a key is what decides whether its
                        // bytes may go.
                        let claimed = switch (saved.sponsor) {
                            case (?info) saved.sponsorStatus != #no and info.logo == ?old;
                            case null false;
                        };
                        let held = switch (assets().info(old)) {
                            case (?was) slotCharge(was.size);
                            case null 0;
                        };
                        if (
                            not claimed
                            and not Review.assetLocked(database, saved.id, old)
                            and Result.isOk(assets().upload(#delete({ key = old }), null, Assets.limitsFor(#avatar)))
                        ) {
                            Meter.bytes(database, caller, 0, held);
                        };
                    };
                    case null {};
                };
                #ok(saved);
            };
        };
    };

    // ── Review ───────────────────────────────────────────────────────────────

    /// The queue, oldest first. Moderators and their nominated review agents.
    public query ({ caller }) func review_queue(limit : Nat) : async [Review.Revision] {
        if (not Profiles.canReviewApps(db(), caller)) return [];
        Review.pending(db(), Profiles.atMost(limit, MAX_PEOPLE));
    };

    public query ({ caller }) func review_pending() : async Nat {
        if (not Profiles.canReviewApps(db(), caller)) return 0;
        Review.count(db());
    };

    /// What this caller has asked for, and what came back — rejection reports
    /// included. Their own only: a review is between a hacker and a moderator.
    public query ({ caller }) func my_revisions(limit : Nat) : async [Review.Revision] {
        let ?user = Profiles.byPrincipal(db(), caller) else return [];
        Review.forUser(db(), user.id, Profiles.atMost(limit, MAX_HISTORY));
    };

    /// Apply a pending revision to the bracket.
    public shared ({ caller }) func approve_revision(
        id : Nat64,
    ) : async Result.Result<Review.Revision, Review.Error> {
        let database = db();
        if (not Profiles.canReviewApps(database, caller)) return #err(#NotAllowed);
        let decidedAt = now();
        let who = switch (Profiles.byPrincipal(database, caller)) {
            case (?user) ?user.id;
            case null null;
        };
        let store = assets();
        let sizeOf = func(key : Text) : ?Nat {
            switch (store.info(key)) {
                case (?found) if (found.complete) ?found.size else null;
                case null null;
            };
        };
        switch (Review.approve(database, who, id, sizeOf, decidedAt)) {
            case (#err(e)) #err(e);
            case (#ok((saved, replaced))) {
                // Approved content invalidates every pending takedown vote for
                // the affected lineage. The approval row itself is the content
                // generation: no second counter or request table is needed.
                if (saved.state == #approved) {
                    let changed = switch (saved.kind) {
                        case (#entry) {
                            Season.entryFor(database, saved.season_id, saved.week, saved.user_id);
                        };
                        case (#version) {
                            let ?targetId = saved.targetEntryId else {
                                Runtime.trap("an approved version has no target");
                            };
                            Season.entry(database, targetId);
                        };
                    };
                    switch (changed) {
                        case (?changed) {
                            for (row in Season.lineageEntries(database, changed).vals()) {
                                Moderation.clearTakedownBacking(database, takedownContexts, row.id);
                            };
                        };
                        case null Runtime.trap("an approved revision wrote no entry");
                    };
                };
                // Everything this revision displaced: the build a newer one
                // replaced, an icon swapped for a different one, a screenshot
                // dropped. Deleting them is what makes a withdrawn file stop
                // resolving (rules.md §3) and what gives the slots back — the
                // rows that pointed at them are gone, so nothing else ever
                // will, and the bytes would stay charged to their author for
                // ever.
                //
                // Uploading over the *same* key already frees the old bytes;
                // `Assets.upload` releases the slot before it writes. This is
                // the other half — a new key, which the store has no way to
                // know replaced anything.
                //
                // The §3 exception still holds: a file a settled round was
                // judged on is part of that round's record and stays.
                for (key in replaced.vals()) {
                    if (not Season.assetLocked(database, saved.user_id, key)) {
                        let held = switch (store.info(key)) {
                            case (?was) slotCharge(was.size);
                            case null 0;
                        };
                        switch (store.upload(#delete({ key }), null, Assets.limitsFor(#package))) {
                            case (#ok) {
                                // The author's tally, not the moderator's.
                                Meter.charge(database, saved.user_id, 0, held);
                            };
                            case (#err(_)) Runtime.trap("could not remove an asset displaced by review");
                        };
                    };
                };
                #ok(saved);
            };
        };
    };

    /// Take an app's content down. **Two moderators, and it deletes files.**
    ///
    /// For content that must stop being served: an infringing build, art
    /// somebody else owns, anything unlawful. It removes the package and the
    /// images and says so on the entry — and it leaves the entry, its author
    /// and its votes exactly where they were.
    ///
    /// That last part is deliberate. Judges have already seen and scored what
    /// was there; deleting the row would rewrite a week's arithmetic to cover
    /// for a moderation decision. The entry stands with a notice on it, and the
    /// judges decide what an app with nothing to install is worth.
    ///
    /// Two moderators because it destroys files that cannot be recovered.
    /// The first call records a vote and answers `#NeedsSecond`.
    public shared ({ caller }) func takedown_app(
        entryId : Nat64,
        reason : Text,
    ) : async Result.Result<Season.Entry, Moderation.Error> {
        let database = db();
        if (not Profiles.canModerate(database, caller)) return #err(#NotAllowed);
        let ?entry = Season.entry(database, entryId) else return #err(#NotRegistered);
        let actionAt = now();
        // Validate and canonicalise before recording a vote. Otherwise an
        // empty or oversized reason could leave reusable backing behind even
        // though the takedown itself was refused.
        let canonical = switch (Season.canonicalTakedownReason(reason)) {
            case (#ok(value)) value;
            case (#err(#Invalid(message))) return #err(#Invalid(message));
            case (#err(_)) return #err(#Invalid("invalid takedown reason"));
        };
        let reviewer = switch (Profiles.owner(database, caller)) {
            case (?moderator) ?moderator.id;
            case null null;
        };
        switch (Profiles.owner(database, caller)) {
            case (?moderator) {
                if (moderator.id == entry.user_id) return #err(#NotAllowed);
            };
            case null {};
        };
        if (
            entry.takedownAt != 0
            or Season.takenDownSlug(database, entry.season_id, entry.user_id, Season.chosenSlugOf(database, entry))
        ) return #err(#Invalid("that app is already taken down"));

        switch (Moderation.takedownQuorum(database, takedownContexts, caller, entryId, canonical, actionAt)) {
            case (#err(e)) return #err(e);
            case (#ok(false)) {
                let held = Moderation.takedownBackingFor(database, takedownContexts, caller, entryId, ?canonical);
                return #err(#NeedsSecond({ votes = held.votes; needed = held.needed }));
            };
            case (#ok(true)) {};
        };

        switch (Season.takedown(database, entryId, canonical, actionAt)) {
            // Backing has already mutated in this message.
            // Trap so an impossible database failure rolls all of it back.
            case (#err(_)) Runtime.trap("could not complete a validated takedown");
            case (#ok((saved, files))) {
                // Expire both this app's revisions and any defensive legacy
                // row that still names one of the bytes about to be removed.
                let pendingOnly = Review.expireForTakedown(
                    database,
                    entry,
                    files,
                    reviewer,
                    actionAt,
                );
                // Keep those fresh pending paths locked after their revision
                // history is eventually pruned. The entry fields are private
                // tombstones once `takedownAt` is set.
                let tombstoned = switch (
                    Season.retainTakedownKeys(database, saved.id, pendingOnly, actionAt)
                ) {
                    case (#ok(row)) row;
                    case (#err(_)) Runtime.trap("could not retain pending takedown keys");
                };
                let doomedFiles = Array.concat(files, pendingOnly);
                for (row in Season.lineageEntries(database, entry).vals()) {
                    Moderation.clearTakedownBacking(database, takedownContexts, row.id);
                };
                // The files themselves, not just the row's pointers. Leaving
                // them served is the one outcome a takedown must not have —
                // the whole point is that they stop being reachable.
                //
                // Deletion is unconditional. New cross-app sharing is refused,
                // and a corrupt old row must not turn a successful takedown
                // into a promise while the prohibited bytes remain online.
                let store = assets();
                var freed = 0;
                for (key in doomedFiles.vals()) {
                    let held = switch (store.info(key)) { case (?was) slotCharge(was.size); case null 0 };
                    switch (store.upload(#delete({ key }), null, Assets.limitsFor(#package))) {
                        case (#ok) {
                            if (store.info(key) != null) {
                                Runtime.trap("a taken-down asset remained stored");
                            };
                            freed += held;
                        };
                        case (#err(_)) Runtime.trap("could not remove a taken-down asset");
                    };
                };
                Meter.charge(database, entry.user_id, 0, freed);
                #ok(Season.visibleEntry(tombstoned));
            };
        };
    };

    /// How many moderators have backed taking this app down, and how many it needs.
    public query ({ caller }) func takedown_tally(entryId : Nat64, reason : ?Text) : async ?Moderation.Backing {
        if (not Profiles.canModerate(db(), caller)) return null;
        let context = switch (reason) {
            case (?raw) {
                switch (Season.canonicalTakedownReason(raw)) {
                    case (#ok(value)) ?value;
                    case (#err(_)) return null;
                };
            };
            case null null;
        };
        ?Moderation.takedownBackingFor(db(), takedownContexts, caller, entryId, context);
    };

    /// Withdraw only the caller's own still-pending takedown vote.
    public shared ({ caller }) func withdraw_takedown(entryId : Nat64) : async Result.Result<(), Moderation.Error> {
        if (not Profiles.canModerate(db(), caller)) return #err(#NotAllowed);
        Moderation.withdrawTakedown(db(), takedownContexts, caller, entryId);
    };

    /// Where every pending decision in a queue stands, in one call.
    ///
    /// Batched because the alternative is one query per row, and the moderation
    /// queues are lists — a page of twenty pending judges would be twenty
    /// round trips to draw twenty buttons. The caller passes the ids it is
    /// already showing, so this never walks more than the page.
    ///
    /// Answers `[]` rather than trapping for a non-moderator: the tallies say
    /// who is willing to approve whom, which is not public.
    public query ({ caller }) func approval_tallies(
        kind : Moderation.ApprovalKind,
        subjects : [Nat64],
    ) : async [(Nat64, Moderation.Backing)] {
        let database = db();
        if (not Profiles.canModerate(database, caller)) return [];
        Array.map<Nat64, (Nat64, Moderation.Backing)>(
            subjects,
            func(id) = (id, Moderation.backingFor(database, takedownContexts, caller, id, kind)),
        );
    };

    /// Refuse it, with a concise reason the author can act on. Longer machine
    /// reports can be linked instead of retained in every revision row.
    public shared ({ caller }) func reject_revision(
        id : Nat64,
        reason : Text,
    ) : async Result.Result<Review.Revision, Review.Error> {
        let database = db();
        if (not Profiles.canReviewApps(database, caller)) return #err(#NotAllowed);
        let who = switch (Profiles.byPrincipal(database, caller)) {
            case (?user) ?user.id;
            case null null;
        };
        Review.reject(database, who, id, reason, now());
    };

    // ── What the canister costs ──────────────────────────────────────────────

    /// Where this canister's memory has gone.
    ///
    /// Public on purpose: it is the number that decides whether the event fits,
    /// and it says nothing about any participant. The interesting pair is
    /// `heap` against `stableReserved` — file bytes live in stable memory
    /// (see `Slab`), so a heap that stays flat while stable memory grows is
    /// the design working.
    public query func memory() : async {
        /// Live objects on the heap, in bytes.
        heap : Nat;
        /// Wasm main memory the canister has claimed, in bytes.
        heapClaimed : Nat;
        /// Stable memory committed to file storage. Never falls.
        stableReserved : Nat;
        /// Bytes of file actually held in it.
        stableLive : Nat;
        /// Files stored.
        files : Nat;
        /// Exact canister cycle balance at this diagnostic message boundary.
        cycles : Nat;
    } {
        let store = assets().storage();
        {
            heap = Prim.rts_heap_size();
            heapClaimed = Prim.rts_memory_size();
            stableReserved = store.reserved;
            stableLive = store.liveBytes;
            files = assets().size();
            cycles = Cycles.balance();
        };
    };

    // ── What people cost ─────────────────────────────────────────────────────

    /// The most expensive participants first, by instructions or by bytes.
    ///
    /// Moderator-gated: it is a list of who to look at, and publishing it
    /// would tell somebody probing the canister exactly how well it is going.
    public query ({ caller }) func costliest(
        order : Meter.Order,
        limit : Nat,
    ) : async [Profiles.User] {
        if (not Profiles.canModerate(db(), caller)) return [];
        Meter.costliest(db(), order, Profiles.atMost(limit, MAX_PEOPLE));
    };

    /// Let a frozen account write again, and optionally clear its spend.
    ///
    /// There is no companion that freezes. Freezing is what the meter does
    /// when an account crosses its allowance — see `Meter.thaw` for why
    /// moderators get one half of that and not the other.
    public shared ({ caller }) func thaw_user(
        handle : Text,
        reset : Bool,
    ) : async Result.Result<Profiles.User, Text> {
        if (not Profiles.canModerate(db(), caller)) return #err("not allowed");
        Meter.thaw(db(), handle, reset);
    };

    /// What this caller has spent of their allowance, and what it is.
    public query ({ caller }) func my_allowance() : async ?{ used : Nat; cap : Nat } {
        let ?user = Profiles.byPrincipal(db(), caller) else return null;
        ?Meter.allowance(db(), user);
    };

    /// The instruction allowance one account gets per season. Controller-only.
    public shared ({ caller }) func set_instruction_cap(cap : Nat) : async Result.Result<(), Text> {
        if (not Principal.isController(caller)) return #err("caller is not a controller");
        if (sealing) return #err(SEALING_LOCKED);
        db().store.set({ db().store.get() with instructionCap = cap });
        #ok;
    };

    // ── Listing ceilings ─────────────────────────────────────────────────────

    /// Upper bound on how much one call may ask for.
    ///
    /// Every ceiling below sits above what the app actually requests, so
    /// nothing anybody does through the UI is truncated. They exist because a
    /// listing that took the caller's number was bounded only by how much data
    /// happened to exist — fine today, and on a long-lived table an easy way
    /// to ask for a response that will not fit or a scan that will not finish.
    ///
    /// A purely upper bound: a smaller number is honoured exactly, so paging
    /// still works and no existing caller changes behaviour. Defined in
    /// `Profiles` so it can be tested; the ceilings below are policy about
    /// this interface and belong next to the methods they apply to.

    /// One week can hold an entry per hacker — a thousand at full size — but a
    /// page showing them is a page nobody reads. The UI asks for 200.
    let MAX_ENTRIES = 1_000;
    let MAX_ENTRY_PAGE = 200;
    /// The bracket draws a handful of boxes per week; the UI asks for 12.
    let MAX_PER_WEEK = 50;
    /// Six rounds a season, and seasons accumulate slowly. The UI asks for 50.
    let MAX_SEASONS = 100;
    /// A hacker's whole history: six entries a season. The UI asks for 100.
    let MAX_HISTORY = 200;
    /// Retained moderation trails merge into one log. The UI pages by 25.
    let MAX_LOG = 100;
    /// Small standing sets, and CLI conveniences.
    let MAX_PEOPLE = 200;
    let MAX_ASSETS = 500;

    // ── Profiles ─────────────────────────────────────────────────────────────

    public shared ({ caller }) func register(input : Profiles.Input) : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        Meter.close(m, Profiles.register(db(), caller, now(), input));
    };

    /// Opt in to judging. Sets a flag on the caller's existing profile; a
    /// controller decides. No approval UI by design — do it from the CLI:
    ///   icp canister call hackathon pending_judges '(50)' --query
    /// Then pass the returned id, judgeStatus, and updatedAt snapshot to
    /// `set_judge`; stale snapshots are rejected.
    public shared ({ caller }) func apply_as_judge() : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        let database = db();
        let result = if (sealing or Season.participantWritesClosedAt(database, now()) or Season.judgesFrozen(database)) {
            #err(#Settling);
        } else {
            Profiles.applyAsJudge(database, caller, now());
        };
        Meter.close(m, result);
    };

    public shared ({ caller }) func update_profile(input : Profiles.Input) : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        let database = db();
        let result = if (Season.participantWritesClosedAt(database, now())) {
            #err(#Settling);
        } else {
            Profiles.update(database, caller, now(), input);
        };
        Meter.close(m, result);
    };

    /// Roles stack. Hacking is self-service; judging and sponsoring are
    /// applications a moderator approves. Holding none of them is what makes
    /// somebody an observer — the default on registration.
    public shared ({ caller }) func set_hacker(on : Bool) : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        let database = db();
        let result = if (Season.participantWritesClosedAt(database, now())) {
            #err(#Settling);
        } else if (not on) {
            switch (Profiles.owner(database, caller)) {
                case (?user) {
                    ignore storageUsed(database, assets(), user);
                    let ordinaryKeys = Assets.MAX_NON_HACKER_KEYS;
                    if (assets().keys(Profiles.scope(user), ordinaryKeys + 1).size() > ordinaryKeys) {
                        #err(#Invalid(
                            "delete app files until at most " # Nat.toText(ordinaryKeys)
                            # " asset keys remain before leaving the hacker role"
                        ));
                    } else {
                        Profiles.setHacker(database, caller, on, now());
                    };
                };
                case null #err(#NotRegistered);
            };
        } else {
            Profiles.setHacker(database, caller, on, now());
        };
        Meter.close(m, result);
    };

    public shared ({ caller }) func apply_as_sponsor(
        application : Profiles.SponsorApplication,
    ) : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        // The one profile write that was missing this, and not a cosmetic one:
        // an approved sponsor's pledged ledgers feed the treasury, so rewriting
        // them while a distribution is being computed changes what the plan was
        // computed against.
        let database = db();
        let result = switch (Profiles.owner(database, caller)) {
            // Establish ownership before inspecting either the season or the
            // submitted application, just like the other owner-only writes.
            case null #err(#NotRegistered);
            case (?user) {
                if (sealing or Season.sponsorsFrozen(database) or Season.participantWritesClosedAt(database, now())) {
                    #err(#Settling);
                } else if (application.ledgers.size() == 0) {
                    #err(#Invalid("a sponsor must name at least one approved ledger"));
                } else if (application.ledgers.size() > Profiles.MAX_LEDGERS) {
                    // Reject the fixed-size shape before walking the allowlist.
                    // `Profiles.applyAsSponsor` repeats this check so internal
                    // callers retain the same invariant.
                    #err(#Invalid("too many ledgers"));
                } else if (not Profiles.applicationLedgersAllowed(database, application)) {
                    #err(#Invalid("configure the fixed ledger allowlist first; every pledged ledger must be on it"));
                } else {
                    let applied = Profiles.applyAsSponsor(database, caller, application, now());
                    switch (applied) {
                        case (#ok(saved)) {
                            // Editing pending data invalidates review of the
                            // old details. Clear only after validation succeeds,
                            // so an invalid edit still returns its typed error.
                            if (user.sponsorStatus == #pending) {
                                Moderation.clearBacking(database, user.id, #sponsor);
                            };
                            #ok(saved);
                        };
                        case (#err(e)) #err(e);
                    };
                };
            };
        };
        Meter.close(m, result);
    };

    public shared ({ caller }) func withdraw_sponsor() : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        let database = db();
        let result = if (sealing or Season.sponsorsFrozen(database) or Season.participantWritesClosedAt(database, now())) {
            #err(#Settling);
        } else {
            let approved = switch (Profiles.owner(database, caller)) {
                case (?user) {
                    if (user.sponsorStatus != #no) {
                        Moderation.clearBacking(database, user.id, #sponsor);
                        true;
                    } else false;
                };
                case _ false;
            };
            let withdrawn = Profiles.withdrawSponsor(database, caller, now());
            if (approved and Result.isErr(withdrawn)) {
                Runtime.trap("could not withdraw sponsor after clearing approval backing");
            };
            withdrawn;
        };
        Meter.close(m, result);
    };

    // ── Rewards, automation and leaving ──────────────────────────────────────

    /// Where this account's rewards should be sent.
    ///
    /// Not the identity you signed in with — that is a per-origin pseudonym,
    /// not a ledger account, and tokens sent to it are gone. Make a wallet at
    /// https://nns.ic0.app/ and give it that principal.
    public shared ({ caller }) func set_wallet(wallet : Principal) : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        let database = db();
        let result = if (Season.participantWritesClosedAt(database, now())) {
            #err(#Settling);
        } else if (wallet == Principal.fromActor(Hackathon)) {
            #err(#Invalid("the hackathon canister cannot be used as a reward wallet"));
        } else {
            Profiles.setWallet(database, caller, wallet);
        };
        Meter.close(m, result);
    };

    /// Nominate a principal that may drive this account, or stand it down.
    ///
    /// For scripting a weekly build. Deliberately the account holder's call
    /// and not the agent's — an agent that could appoint the next agent could
    /// keep the account after being dismissed.
    public shared ({ caller }) func set_agent(agent : ?Principal) : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        let database = db();
        let result = if (Season.participantWritesClosedAt(database, now())) {
            #err(#Settling);
        } else {
            Profiles.setAgent(database, caller, agent);
        };
        Meter.close(m, result);
    };

    /// Stand out of the prize money. What you would have had is shared among
    /// everybody else rather than staying in the treasury.
    public shared ({ caller }) func set_reward_opt_out(out : Bool) : async Result.Result<Profiles.User, Profiles.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        let database = db();
        let result = if (Season.participantWritesClosedAt(database, now())) {
            #err(#Settling);
        } else {
            Profiles.setRewardOptOut(database, caller, out);
        };
        Meter.close(m, result);
    };

    /// Erase yourself. Not available while a season is running.
    ///
    /// The row survives — see `Profiles.anonymize`. Everything personal on it
    /// does not, and every app goes with it.
    ///
    /// Refused mid-season because a season is a competition in progress: an
    /// entry vanishing from a week that judges have already voted in changes
    /// the result, and rules.md §5 makes a closed week a record.
    public shared ({ caller }) func delete_account() : async Result.Result<Profiles.User, Text> {
        let database = db();
        let ?user = Profiles.owner(database, caller) else return #err("not registered");
        if (sealing) {
            switch (Season.current(database)) {
                case (?season) if (season.phase == #draft) return #err(SEALING_LOCKED);
                case _ {};
            };
        };
        if (Season.running(database) != null) {
            return #err("an account cannot be deleted while a season is running");
        };
        if (Season.settling(database)) {
            return #err("an account cannot be deleted until the season's rewards have gone out");
        };
        if (user.sponsorStatus == #approved) {
            return #err("an approved sponsor is part of the sealed funding record and cannot be anonymised");
        };
        // A normal seal leaves no externally callable controller, and
        // `set_moderator` is controller-only. The last moderator deleting
        // themselves would therefore end the event unless the separate DAO
        // recovery had already completed. Keep a floor of one either way:
        // standing down is something to do once somebody else holds the role,
        // not instead of it.
        if (user.moderator and Profiles.moderatorCount(database) <= 1) {
            return #err(
                "you are the only moderator — appoint another before deleting "
                # "your account; the sealed canister has no external caller who can replace you"
            );
        };
        // Privacy erases the person, not the public competition record. Remove
        // only orphaned files; any key still referenced by an approved entry
        // remains immutable and served with that entry.
        let store = assets();
        var freed = 0;
        for (key in store.keys(Profiles.scope(user), Assets.MAX_LIVE_SLOTS).vals()) {
            if (not Review.assetLocked(database, user.id, key)) {
                switch (store.info(key)) { case (?was) freed += slotCharge(was.size); case null {} };
                switch (store.upload(#delete({ key }), null, Assets.limitsFor(#package))) {
                    case (#ok) {};
                    case (#err(_)) Runtime.trap("could not remove an orphaned account asset");
                };
            };
        };
        Meter.charge(database, user.id, 0, freed);
        switch (Profiles.anonymize(database, user, now())) {
            case (#ok(saved)) #ok(saved);
            case (#err(_)) Runtime.trap("could not anonymise that account after cleanup");
        };
    };

    /// Erase one app, leaving the row that the bracket counts on.
    public shared ({ caller }) func delete_app(entryId : Nat64) : async Result.Result<(), Text> {
        let database = db();
        let ?user = Profiles.owner(database, caller) else return #err("not registered");
        let ?entry = Season.entry(database, entryId) else return #err("no such app");
        if (entry.user_id != user.id) return #err("that is not your app");
        if (Season.participantWritesClosedAt(database, now())) {
            return #err("the finished season is a permanent public record; apps can no longer be deleted");
        };
        if (Season.running(database) != null) {
            return #err("an app cannot be deleted while a season is running");
        };
        if (Season.settling(database)) {
            return #err("an app cannot be deleted until the season's rewards have gone out");
        };
        // The row's pointers going blank is not the same as the files going
        // away. `Assets` serves any complete asset by its key and never asks
        // whether an entry still points at it, and a package URL is a stable
        // public path — so without this the build stays downloadable to anyone
        // who kept the link, which is not what "delete" means to the person
        // pressing it.
        //
        // A key a settled round was judged on is left alone: that round's
        // record includes what it saw, and rules.md §3 freezes it.
        let store = assets();
        var freed = 0;
        for (key in filesOf(entry)) {
            if (not Season.assetLocked(database, user.id, key)) {
                switch (store.info(key)) { case (?was) freed += slotCharge(was.size); case null {} };
                switch (store.upload(#delete({ key }), null, Assets.limitsFor(#package))) {
                    case (#ok) {};
                    case (#err(_)) Runtime.trap("could not remove an app asset");
                };
            };
        };
        Meter.charge(database, user.id, 0, freed);

        switch (Season.blank(database, entryId, now())) {
            case (#ok(_)) #ok;
            case (#err(_)) Runtime.trap("could not blank that app after asset cleanup");
        };
    };

    /// Every asset key an entry points at: icon, screenshots and the build.
    func filesOf(entry : Season.Entry) : Iter.Iter<Text> {
        let keys = List.empty<Text>();
        switch (entry.icon) { case (?key) List.add(keys, key); case null {} };
        for (shot in entry.shots.vals()) List.add(keys, shot);
        switch (entry.pkg) { case (?pkg) List.add(keys, pkg.key); case null {} };
        List.values(keys);
    };

    // ── Takedown notices ─────────────────────────────────────────────────────

    /// Report content that should not be here. No account needed.
    ///
    /// Three an hour per calling principal, 500 characters. Anonymous callers
    /// share one principal and therefore one allowance — that is the limit
    /// doing its job, not a bug to route around.
    public shared ({ caller }) func file_notice(body : Text) : async Result.Result<Notices.Notice, Notices.Error> {
        Notices.file(db(), caller, body, now());
    };

    public query ({ caller }) func notices(limit : Nat) : async [Notices.Notice] {
        if (not Profiles.canModerate(db(), caller)) return [];
        Notices.recent(db(), Profiles.atMost(limit, MAX_PEOPLE));
    };

    public query ({ caller }) func notices_pending() : async Nat {
        if (not Profiles.canModerate(db(), caller)) return 0;
        Notices.pending(db());
    };

    public shared ({ caller }) func resolve_notice(
        id : Nat64,
        state : Notices.State,
    ) : async Result.Result<Notices.Notice, Notices.Error> {
        Notices.resolve(db(), caller, id, state, now());
    };

    public query ({ caller }) func me() : async ?Profiles.User {
        Profiles.byPrincipal(db(), caller);
    };

    public query func profile(handle : Text) : async ?Profiles.PublicUser {
        switch (Profiles.byHandle(db(), handle)) {
            case (?user) ?Profiles.publicUser(user);
            case null null;
        };
    };

    /// One page of users, always alphabetical by handle.
    ///
    /// `letter` restricts to one A-Z bucket ("#" for handles starting with a
    /// digit or underscore) and seeks straight to it — nothing before it is
    /// read. `after` is the previous page's `next`; `null` starts at the top.
    ///
    /// Everyone is a participant, so `#all` includes judges and moderators.
    public query func users_page(
        filter : Profiles.Filter,
        letter : ?Profiles.Letter,
        after : ?Profiles.Cursor,
        limit : Nat,
    ) : async Profiles.PublicPage {
        Profiles.publishPage(Profiles.page(db(), filter, letter, after, limit));
    };

    /// Raw account rows contain principals, wallet/agent assignments, terms
    /// acceptance and metering state. Only moderators may inspect them.
    public query ({ caller }) func users_admin_page(
        filter : Profiles.Filter,
        letter : ?Profiles.Letter,
        after : ?Profiles.Cursor,
        limit : Nat,
    ) : async Profiles.Page {
        if (not Profiles.canModerate(db(), caller)) {
            return { rows = []; next = null; total = 0 };
        };
        Profiles.page(db(), filter, letter, after, limit);
    };

    /// Per-bucket counts for the A-Z strip, so it can show what exists
    /// without the client fetching any rows.
    public query func letter_counts(filter : Profiles.Filter) : async [Profiles.LetterCount] {
        Profiles.letterCounts(db(), filter);
    };

    /// Handle prefix search, scoped by the same filters.
    public query func users_search(
        prefix : Text,
        filter : Profiles.Filter,
        limit : Nat,
    ) : async [Profiles.PublicUser] {
        Array.map<Profiles.User, Profiles.PublicUser>(
            Profiles.search(db(), prefix, filter, limit),
            Profiles.publicUser,
        );
    };

    /// Index-backed totals; cheap enough to poll.
    public query func stats() : async Profiles.Counts {
        Profiles.counts(db());
    };

    // Unpaged conveniences for the CLI and scripts. The UI uses `users_page`.
    public query func pending_judges(limit : Nat) : async [Profiles.PublicUser] {
        Array.map<Profiles.User, Profiles.PublicUser>(
            Profiles.alphabetical(db(), ?#pending, Profiles.atMost(limit, MAX_PEOPLE)),
            Profiles.publicUser,
        );
    };

    public query func moderators(limit : Nat) : async [Profiles.PublicUser] {
        Array.map<Profiles.User, Profiles.PublicUser>(
            Profiles.moderators(db(), Profiles.atMost(limit, MAX_PEOPLE)),
            Profiles.publicUser,
        );
    };

    public query func recent_users(limit : Nat) : async [Profiles.PublicUser] {
        Array.map<Profiles.User, Profiles.PublicUser>(
            Profiles.recent(db(), Profiles.atMost(limit, MAX_PEOPLE)),
            Profiles.publicUser,
        );
    };

    // ── Moderation: moderators or the controller ─────────────────────────────

    /// Approve, reject, reset or revoke a judge. The target binds the decision
    /// to the exact account and role snapshot the moderator reviewed.
    ///   variant { approved } | variant { pending } | variant { no }
    /// Every successful state change enters the subject's bounded audit trail,
    /// so a mistake is reversible and traceable rather than silent.
    public shared ({ caller }) func set_judge(
        target : Moderation.JudgeTarget,
        status : Profiles.JudgeStatus,
        note : ?Text,
    ) : async Result.Result<Profiles.User, Moderation.Error> {
        let database = db();
        if (sealing and not Season.judgesFrozen(database)) {
            if (not Profiles.canModerate(database, caller)) return #err(#NotAllowed);
            return #err(#Invalid(SEALING_LOCKED));
        };
        Moderation.setJudge(database, caller, target, status, note, now());
    };

    /// Approve, reject, reset or revoke a sponsorship against the exact
    /// application snapshot shown to the moderator.
    ///   variant { approved } | variant { pending } | variant { no }
    public shared ({ caller }) func set_sponsor(
        target : Moderation.SponsorTarget,
        status : Profiles.SponsorStatus,
        note : ?Text,
    ) : async Result.Result<Profiles.User, Moderation.Error> {
        let database = db();
        if (sealing and not Season.sponsorsFrozen(database)) {
            if (not Profiles.canModerate(database, caller)) return #err(#NotAllowed);
            return #err(#Invalid(SEALING_LOCKED));
        };
        Moderation.setSponsor(database, caller, target, status, note, now());
    };

    public query ({ caller }) func moderation_log(
        after : ?Moderation.Cursor,
        limit : Nat,
    ) : async Moderation.LogPage {
        if (not Profiles.canModerate(db(), caller)) return EMPTY_LOG;
        Moderation.history(db(), after, Profiles.atMost(limit, MAX_LOG));
    };

    public query ({ caller }) func moderation_log_for(
        handle : Text,
        after : ?Moderation.Cursor,
        limit : Nat,
    ) : async Moderation.LogPage {
        let database = db();
        if (not Profiles.canModerate(database, caller)) return EMPTY_LOG;
        let ?user = Profiles.byHandle(database, handle) else return EMPTY_LOG;
        Moderation.historyFor(database, user.id, after, Profiles.atMost(limit, MAX_LOG));
    };

    public query ({ caller }) func am_moderator() : async Bool {
        Profiles.canModerate(db(), caller);
    };

    // ── Admin: controller-only ───────────────────────────────────────────────

    /// Appointing moderators stays with the controller. Moderators appointing
    /// moderators has no floor.
    public shared ({ caller }) func set_moderator(
        target : Moderation.ModeratorTarget,
        on : Bool,
        note : ?Text,
    ) : async Result.Result<Profiles.User, Moderation.Error> {
        if (not Principal.isController(caller)) return #err(#NotAllowed);
        if (sealing) return #err(#Invalid(SEALING_LOCKED));
        Moderation.setModerator(db(), caller, target, on, note, now());
    };

    public shared ({ caller }) func set_config(siteTitle : Text, registrationOpen : Bool) : async Result.Result<(), Text> {
        if (not Principal.isController(caller)) return #err("caller is not a controller");
        if (sealing) return #err(SEALING_LOCKED);
        // Merge rather than replace: `frontendHash` is maintained by the asset
        // store and `instructionCap` by its own method, and a whole-record
        // write here would silently reset both.
        db().store.set({ db().store.get() with siteTitle; registrationOpen });
        #ok;
    };

    public shared ({ caller }) func set_next_season_url(url : Text) : async Result.Result<(), Text> {
        if (not Principal.isController(caller)) return #err("caller is not a controller");
        if (sealing) return #err(SEALING_LOCKED);
        if (url.size() > 256) return #err("next season url is too long");
        if (url != "" and not Text.startsWith(url, #text "https://")) {
            return #err("next season url must be https");
        };
        db().store.set({ db().store.get() with nextSeasonUrl = url });
        #ok;
    };

    /// Seven is the reviewed production catalog and keeps one worst-case
    /// sequential payout retry pass comfortably inside the ledgers' 24-hour
    /// duplicate window. Expanding it requires revisiting that latency bound.
    transient let MAX_LEDGER_ALLOWLIST = Season.MAX_LAUNCH_LEDGERS;

    /// Configure the only remote ledger actors this sealed canister will ever
    /// call. The list is controller-owned setup state and freezes as soon as a
    /// sponsor application exists (and, independently, once a season starts).
    public shared ({ caller }) func set_ledger_allowlist(
        ledgers : [Principal],
    ) : async Result.Result<[Principal], Text> {
        if (not Principal.isController(caller)) return #err("caller is not a controller");
        if (sealing) return #err(SEALING_LOCKED);
        if (ledgers.size() == 0) return #err("at least one ledger is required");
        if (ledgers.size() > MAX_LEDGER_ALLOWLIST) {
            return #err("at most " # Nat.toText(MAX_LEDGER_ALLOWLIST) # " ledgers are allowed");
        };
        var i = 0;
        while (i < ledgers.size()) {
            if (Principal.isAnonymous(ledgers[i])) return #err("the anonymous principal is not a ledger");
            var j = i + 1;
            while (j < ledgers.size()) {
                if (ledgers[i] == ledgers[j]) return #err("a ledger is listed twice");
                j += 1;
            };
            i += 1;
        };

        let database = db();
        if (not ledgerConfigurationOpen(database)) {
            return #err("the ledger allowlist freezes before the first sponsor application or season start");
        };

        let canister = Principal.fromActor(Hackathon);
        for (ledger in ledgers.vals()) {
            let api = Treasury.icrc1(ledger);
            try {
                ignore await* Treasury.balance(api, canister);
                ignore await* api.fee();
            } catch (failure) {
                return #err(
                    "ledger " # Principal.toText(ledger) # " did not answer ICRC-1 balance/fee validation: "
                    # Error.message(failure)
                );
            };
        };

        // Every call above admitted an interleaving. Never let an application
        // race the validation and then have its reviewed ledger set replaced.
        if (sealing or not Principal.isController(caller) or not ledgerConfigurationOpen(database)) {
            return #err("the ledger allowlist froze while validation was in progress");
        };
        database.store.set({
            database.store.get() with
            ledgerAllowlistSet = true;
            ledgerAllowlist = ledgers;
        });
        #ok(ledgers);
    };

    func ledgerConfigurationOpen(database : Ashroot.DB) : Bool {
        if (Profiles.hasSponsorApplication(database)) return false;
        switch (Season.current(database)) {
            case (?season) season.phase == #draft;
            case null true;
        };
    };

    /// A digest over every frontend file this canister serves.
    ///
    /// Recompute it from a checkout with `npm run verify:web` and compare. If
    /// the two agree, the site you are looking at is the build in the
    /// repository — which is the claim a canister that hosts its own frontend
    /// ought to be able to support rather than ask you to take on trust.
    ///
    /// Computed on demand rather than cached: it walks the frontend's own
    /// keys, which number in the tens, and a cached value is one more thing
    /// that can silently drift from what is actually being served.
    public query func frontend_hash() : async Text {
        assets().frontendHash();
    };

    public query func config() : async Ashroot.Types.Store {
        db().store.get();
    };

    public query func terms_info() : async { version : Nat; effectiveAt : Nat64 } {
        { version = Profiles.TERMS_VERSION; effectiveAt = Profiles.TERMS_EFFECTIVE_AT };
    };

    transient let EMPTY_LOG : Moderation.LogPage = { rows = []; next = null; total = 0 };

    // ── Season ───────────────────────────────────────────────────────────────

    public query func season() : async ?Season.Season {
        Season.current(db());
    };

    /// Past and present seasons, newest first — what the season switcher lists.
    public query func seasons(limit : Nat) : async [Season.Season] {
        Season.all(db(), Profiles.atMost(limit, MAX_SEASONS));
    };

    public query func season_by_number(number : Nat) : async ?Season.Season {
        Season.byNumber(db(), number);
    };

    public query func season_running() : async ?Season.Season {
        Season.running(db());
    };

    /// True from the moment a season starts until it finishes. While set, no
    /// moderator can change the judges.
    public query func judges_frozen() : async Bool {
        Season.judgesFrozen(db());
    };

    /// One week's entries, best first. Ranked by votes, ties to the earliest
    /// submission.
    public query func season_week(seasonId : Nat64, week : Nat, limit : Nat) : async [Season.Entry] {
        Array.map<Season.Entry, Season.Entry>(
            Season.week(db(), seasonId, week, Profiles.atMost(limit, MAX_ENTRIES)),
            Season.visibleEntry,
        );
    };

    /// The same week, joined with each entry's author and the caller's own
    /// votes — what the season page actually renders.
    public query ({ caller }) func season_week_view(
        seasonId : Nat64,
        week : Nat,
        limit : Nat,
    ) : async [Season.View] {
        Season.weekView(db(), seasonId, week, Profiles.atMost(limit, MAX_ENTRIES), ?caller);
    };

    public query ({ caller }) func season_week_page(
        seasonId : Nat64,
        week : Nat,
        after : ?Nat,
        limit : Nat,
    ) : async Season.WeekPage {
        Season.weekPage(
            db(),
            seasonId,
            week,
            after,
            Profiles.atMost(limit, MAX_ENTRY_PAGE),
            ?caller,
        );
    };

    /// The whole bracket in one call — every week, its top entries and its
    /// true count. What the season map draws.
    public query ({ caller }) func season_map(
        seasonId : Nat64,
        perWeek : Nat,
    ) : async [Season.WeekView] {
        Season.map(db(), seasonId, Profiles.atMost(perWeek, MAX_PER_WEEK), ?caller);
    };

    /// Everything one person has entered, across every season. Public: a
    /// profile shows what somebody built whether or not you are them.
    public query func user_entries(handle : Text, limit : Nat) : async [Season.Summary] {
        let database = db();
        let ?user = Profiles.byHandle(database, handle) else return [];
        Season.entriesBy(database, user.id, Profiles.atMost(limit, MAX_HISTORY));
    };

    /// Everything about one entry — screenshots, links, package, changelog.
    /// Fetched when an entry is opened, so the bracket itself stays small.
    public query ({ caller }) func entry_detail(id : Nat64) : async ?Season.Detail {
        Season.entryDetail(db(), id, ?caller, now());
    };

    /// Ship a new build, write what changed, or both.
    ///
    /// The replaced package is deleted here rather than in `Season`: that
    /// module owns the row, this one owns the asset store.
    public shared ({ caller }) func publish_update(
        entryId : Nat64,
        input : Season.UpdateInput,
    ) : async Result.Result<Review.Revision, Review.Error> {
        // The asset store is this module's, so it answers how big an upload
        // really is; `Season` owns the row and asks.
        let store = assets();
        let sizeOf = func(key : Text) : ?Nat {
            switch (store.info(key)) {
                case (?found) if (found.complete) ?found.size else null;
                case null null;
            };
        };
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        Meter.close(m, Review.proposeVersion(db(), caller, entryId, input, sizeOf, now()));
    };


    public query ({ caller }) func my_entry() : async ?Season.Entry {
        let database = db();
        let ?live = Season.running(database) else return null;
        let ?user = Profiles.byPrincipal(database, caller) else return null;
        switch (Season.entryFor(database, live.id, live.week, user.id)) {
            case (?entry) ?Season.visibleEntry(entry);
            case null null;
        };
    };

    /// Every current seat, so a double qualifier can deliberately choose the
    /// app a version belongs to. The singular query above stays for old cards.
    public query ({ caller }) func my_entries() : async [Season.Entry] {
        let database = db();
        let ?live = Season.running(database) else return [];
        let ?user = Profiles.byPrincipal(database, caller) else return [];
        Array.map<Season.Entry, Season.Entry>(
            Season.slotsFor(database, live.id, live.week, user.id),
            Season.visibleEntry,
        );
    };

    /// How many of a judge's two votes are left this week.
    public query ({ caller }) func my_votes_left() : async Nat {
        let database = db();
        let ?live = Season.running(database) else return 0;
        let ?user = Profiles.byPrincipal(database, caller) else return 0;
        if (user.judgeStatus != #approved) return 0;
        let used = Season.votesBy(database, user.id, live.id, live.week);
        if (used >= Season.VOTES_PER_JUDGE) 0 else Season.VOTES_PER_JUDGE - used;
    };

    public query ({ caller }) func my_vote_on(entryId : Nat64) : async Bool {
        let database = db();
        let ?user = Profiles.byPrincipal(database, caller) else return false;
        Season.hasVoted(database, user.id, entryId);
    };

    /// Submit or replace this week's entry. Hackers only.
    public shared ({ caller }) func submit_entry(
        input : Season.EntryInput,
    ) : async Result.Result<Review.Revision, Review.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        // Not written to the bracket — proposed. A moderator decides, and the
        // entry keeps showing its last approved state until they do.
        let store = assets();
        let sizeOf = func(key : Text) : ?Nat {
            switch (store.info(key)) {
                case (?found) if (found.complete) ?found.size else null;
                case null null;
            };
        };
        Meter.close(m, Review.proposeEntry(db(), caller, input, sizeOf, now()));
    };

    /// Spend one of two votes. Not on your own entry.
    public shared ({ caller }) func cast_vote(entryId : Nat64) : async Result.Result<Season.Entry, Season.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        let result = switch (Season.vote(db(), caller, entryId, now())) {
            case (#ok(entry)) #ok(Season.visibleEntry(entry));
            case (#err(e)) #err(e);
        };
        Meter.close(m, result);
    };

    public shared ({ caller }) func withdraw_vote(entryId : Nat64) : async Result.Result<Season.Entry, Season.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        let result = switch (Season.unvote(db(), caller, entryId, now())) {
            case (#ok(entry)) #ok(Season.visibleEntry(entry));
            case (#err(e)) #err(e);
        };
        Meter.close(m, result);
    };

    // ── Season control: a moderator starts it, the clock runs it ─────────────

    /// Draw up this canister's season. **Moderators, and only ever one.** The
    /// draft is one of the preconditions checked before sealing, so it is
    /// created while controllers still exist but never requires controller
    /// authority itself.
    ///
    /// `Season.create` refuses a second one outright — the next season is a new
    /// canister, not another row here (rules.md §1).
    public shared ({ caller }) func create_season() : async Result.Result<Season.Season, Season.Error> {
        if (not Profiles.canModerate(db(), caller)) return #err(#NotAllowed);
        if (sealing) return #err(#Invalid(SEALING_LOCKED));
        Season.create(db(), now());
    };

    /// Start the season. Freezes the judges and starts the clock, and from here
    /// nobody has to press anything again.
    ///
    /// **Moderators, and only once the canister is sealed.** Sealed means the
    /// canister itself is its sole controller: no external principal holds
    /// upgrade or settings authority, and ingress cannot impersonate the
    /// canister principal. The authority that survives sealing is therefore
    /// only what this installed code grants.
    ///
    /// The seal is checked rather than assumed, on every start. A season that
    /// began while somebody still held the keys would be a season whose rules
    /// could be rewritten halfway through, which is the one thing the whole
    /// arrangement exists to rule out — and it would look identical from
    /// outside to one that could not.
    public shared ({ caller }) func start_season(seasonId : Nat64) : async Result.Result<Season.Season, Season.Error> {
        if (not Profiles.canModerate(db(), caller)) return #err(#NotAllowed);

        let me = Principal.fromActor(Hackathon);
        if (not (await* Controllers.sealed(me))) {
            return #err(#Invalid(
                "this canister is not sealed, so a season cannot start — seal it first "
                # "with seal_canister(), which removes every external controller and "
                # "leaves only the canister itself under the installed recovery rules."
            ));
        };

        // A self-only controller list is necessary but not sufficient: setting
        // it by hand bypasses the durable latch that freezes the launch
        // manifest. A manually changed draft therefore fails closed.
        if (not sealing) {
            return #err(#Invalid(
                "this canister was not sealed through seal_canister(), so the season cannot start"
            ));
        };

        // Recheck the exact manifest frozen by `seal_canister`. `Season.start`
        // repeats the same helper at the phase write.
        switch (Season.launchReadiness(db(), seasonId)) {
            case (#err(error)) return #err(error);
            case (#ok(_)) {};
        };

        let started = Season.start(db(), seasonId, now());
        if (Result.isOk(started)) {
            // The running phase now freezes judges/sponsors itself, and there
            // is no external controller to mutate setup. Releasing the launch
            // latch lets normal post-season account cleanup work later; the
            // exact self-only controller list remains the public seal.
            sealing := false;
            armWeek<system>();
        };
        started;
    };

    /// Remove every external controller and retain only this canister.
    ///
    /// No person, developer identity or DAO can then upgrade the code/frontend
    /// or change settings. The installed emergency path below can add only the
    /// fixed Neutrinite DAO after three distinct current moderators approve it.
    /// Arrange everything first — moderators appointed, frontend uploaded,
    /// allowance set — because normal operation remains self-controlled.
    ///
    /// Requires the canister to be one of its own controllers, which a human
    /// arranges once by hand: reading your own status is unprivileged, changing
    /// your own settings is not.
    public shared ({ caller }) func seal_canister() : async Result.Result<(), Text> {
        if (not Principal.isController(caller)) return #err("caller is not a controller");
        let me = Principal.fromActor(Hackathon);

        // A persisted latch with no live call means an upgrade interrupted the
        // attempt. Resolve it against the management canister before allowing
        // a retry; never clear a live call's lock from a concurrent ingress.
        if (sealing) {
            if (sealingCallActive) return #err("canister sealing is already in progress");
            switch (await* Controllers.current(me)) {
                case (?held) {
                    if (Controllers.isSealed(me, held)) return #ok;
                    sealing := false;
                };
                case null return #err(
                    "canister controller status is temporarily unavailable; launch remains frozen — retry this check"
                );
            };
        };

        let database = db();
        let ?draft = Season.current(database) else {
            return #err("create the draft season before sealing the canister");
        };
        switch (Season.launchReadiness(database, draft.id)) {
            case (#ok(_)) {};
            case (#err(#Invalid(message))) return #err(message);
            case (#err(#NotFound)) return #err("create the draft season before sealing the canister");
            case (#err(#SeasonRunning)) return #err("a season is already running");
            case (#err(_)) return #err("the draft season is not ready to be sealed");
        };

        sealing := true;
        sealingCallActive := true;
        let changed = await* Controllers.seal(me);
        // `update_settings` may commit while its response is lost. Ask for the
        // real controller list before reporting failure or reopening setup. A
        // failed status read is outcome-unknown, so keep the durable latch set
        // and fail closed until a later retry can observe the actual list.
        let confirmed : ?Bool = if (changed) ?true else switch (await* Controllers.current(me)) {
            case (?held) ?Controllers.isSealed(me, held);
            case null null;
        };
        sealingCallActive := false;
        switch (confirmed) {
            case (?true) #ok;
            case (?false) {
                sealing := false;
                #err(
                    "could not make the canister its sole controller — add " # Principal.toText(me)
                    # " as a controller first, so the canister can change its own settings"
                );
            };
            case null #err(
                "canister controller status is temporarily unavailable; launch remains frozen — retry this check"
            );
        };
    };

    /// Did this installed actor begin the irreversible seal transition?
    ///
    /// A self-only controller list alone cannot distinguish `seal_canister()`
    /// from an operator changing settings by hand. This durable,
    /// read-only witness lets the release verifier require both facts. It
    /// grants no recovery authority. A confirmed failed attempt resets it while
    /// controllers still remain; after successful removal it stays true until
    /// a season starts, when the running phase becomes the durable boundary.
    public query func launch_latched() : async Bool {
        sealing;
    };

    func activeControllerRecoveryBackers(database : Ashroot.DB) : [Nat64] {
        let active = List.empty<Nat64>();
        for (id in controllerRecoveryBackers.vals()) {
            switch (database.users.get(id)) {
                case (?user) {
                    if (user.moderator and not user.anonymized) {
                        var seen = false;
                        for (held in List.values(active)) {
                            if (held == id) seen := true;
                        };
                        if (not seen) List.add(active, id);
                    };
                };
                case null {};
            };
        };
        List.toArray(active);
    };

    /// Current progress toward the fixed emergency controller recovery.
    ///
    /// Only actual moderator account owners may see or cast these approvals.
    /// Agent delegation is deliberately insufficient for granting controller
    /// authority.
    public query ({ caller }) func controller_recovery_tally() : async ?ControllerRecovery {
        let database = db();
        let ?voter = Profiles.owner(database, caller) else return null;
        if (not voter.moderator or voter.anonymized) return null;
        let active = activeControllerRecoveryBackers(database);
        var mine = false;
        for (id in active.vals()) { if (id == voter.id) mine := true };
        ?{
            votes = active.size();
            needed = CONTROLLER_RECOVERY_NEEDED;
            mine;
            recovered = false;
        };
    };

    /// End the self-only seal by adding the fixed Neutrinite DAO controller.
    ///
    /// No principal or repair instruction comes from the caller. Each current,
    /// non-anonymised moderator owner contributes at most one persisted vote.
    /// The third vote invokes the one settings transition installed in
    /// `Controllers.recover`.
    public shared ({ caller }) func recover_canister() : async Result.Result<ControllerRecovery, Text> {
        let database = db();
        let ?voter = Profiles.owner(database, caller) else return #err("not allowed");
        if (not voter.moderator or voter.anonymized) return #err("not allowed");
        if (controllerRecoveryCallActive) return #err("controller recovery is already in progress");

        let me = Principal.fromActor(Hackathon);
        let ?held = await* Controllers.current(me) else {
            return #err("canister controller status is temporarily unavailable; try again");
        };
        if (Controllers.isRecovered(me, held)) {
            controllerRecoveryBackers := [];
            return #ok({
                votes = CONTROLLER_RECOVERY_NEEDED;
                needed = CONTROLLER_RECOVERY_NEEDED;
                mine = true;
                recovered = true;
            });
        };
        if (not Controllers.isSealed(me, held)) {
            return #err(
                "the canister is not in its sealed self-controlled state; recovery cannot vote or overwrite its controllers"
            );
        };
        // Another third voter may have crossed the management await while this
        // call was reading status. Never issue two settings writes.
        if (controllerRecoveryCallActive) {
            return #err("controller recovery is already in progress");
        };

        var active = activeControllerRecoveryBackers(database);
        var mine = false;
        for (id in active.vals()) { if (id == voter.id) mine := true };
        if (not mine) {
            active := Array.concat(active, [voter.id]);
            controllerRecoveryBackers := active;
            mine := true;
        } else {
            // Persist the filtered set so revoked or anonymised votes do not
            // occupy the bounded list forever.
            controllerRecoveryBackers := active;
        };
        if (active.size() < CONTROLLER_RECOVERY_NEEDED) {
            return #ok({
                votes = active.size();
                needed = CONTROLLER_RECOVERY_NEEDED;
                mine;
                recovered = false;
            });
        };

        controllerRecoveryCallActive := true;
        let changed = await* Controllers.recover(me);
        let confirmed : ?Bool = if (changed) ?true else switch (await* Controllers.current(me)) {
            case (?after) ?Controllers.isRecovered(me, after);
            case null null;
        };
        controllerRecoveryCallActive := false;
        switch (confirmed) {
            case (?true) {
                controllerRecoveryBackers := [];
                #ok({
                    votes = CONTROLLER_RECOVERY_NEEDED;
                    needed = CONTROLLER_RECOVERY_NEEDED;
                    mine = true;
                    recovered = true;
                });
            };
            case (?false) #err(
                "the fixed DAO controller could not be added; the three approvals remain recorded for a retry"
            );
            case null #err(
                "canister controller status is temporarily unavailable; the three approvals remain recorded"
            );
        };
    };

    // ── The clock ────────────────────────────────────────────────────────────

    /// When the open week is due to end, if a season is running.
    public query func week_ends_at() : async ?Nat64 {
        let ?season = Season.running(db()) else return null;
        ?season.weekEndsAt;
    };

    /// Is a week-close actually scheduled?
    ///
    /// This reports that the actor installed a timer id. It cannot prove that
    /// the replica's global timer is still live: after a cycles freeze or a
    /// congested timer expiry, an id may remain even though no callback will
    /// arrive. `wake_automation` is the repair path for that case.
    public query func clock_armed() : async Bool {
        weekTimer != null;
    };

    /// The only information a moderator can give automation is "check now".
    /// Durable state supplies every consequential value: deadline, season,
    /// ledger set, payout rows, retry cadence and destinations.
    public type AutomationStage = {
        #round : Nat;
        #funding;
        #payout;
    };

    public type AutomationWake = {
        #idle;
        #armed : { stage : AutomationStage; at : Nat64 };
        #ran : { stage : AutomationStage; nextAt : ?Nat64 };
        #busy : { stage : AutomationStage; since : Nat64 };
        #settled;
    };

    public type AutomationError = {
        #NotAllowed;
        #Unavailable;
    };

    /// The pending week-close timer.
    ///
    /// Transient because it has to be: the system cancels every timer on
    /// upgrade, so a preserved id would name a timer that no longer exists.
    /// Losing it is correct — `armWeek` runs on every start and rebuilds it
    /// from `weekEndsAt`, which is the durable part.
    transient var weekTimer : ?Timer.TimerId = null;
    /// A cancelled expiry may already be queued. The generation makes that
    /// callback harmless even if `cancelTimer` can no longer remove it.
    transient var weekTimerGeneration = 0;

    func cancelWeekTimer() {
        weekTimerGeneration += 1;
        switch (weekTimer) {
            case (?id) Timer.cancelTimer(id);
            case null {};
        };
        weekTimer := null;
    };

    func nanosAfter(seconds : Nat) : Nat64 {
        now() + Nat64.fromNat(seconds) * 1_000_000_000;
    };

    /// Schedule one exact round identity. `fireAt` may be later than the
    /// round's deadline when this is a backoff after an internal failure, but
    /// the callback always validates the original durable deadline as well.
    func scheduleWeek<system>(season : Season.Season, fireAt : Nat64) {
        cancelWeekTimer();
        let generation = weekTimerGeneration;
        let seasonId = season.id;
        let week = season.week;
        let deadline = season.weekEndsAt;
        func due() : async () {
            await closeDueWeek(generation, seasonId, week, deadline);
        };
        let delay = Season.secondsUntil(fireAt, now());
        weekTimer := ?Timer.setTimer<system>(
            #seconds delay,
            due,
        );
    };

    /// Point a one-shot timer at the exact moment the open week ends.
    ///
    /// One timer, one wake-up per week — not a heartbeat polling for a
    /// deadline that moves once every seven days. A season that is over, or
    /// never started, arms nothing at all.
    ///
    /// A deadline already in the past arms at zero rather than going negative:
    /// that happens whenever the canister was down or upgrading when a week
    /// was due, and the right answer is to close it now.
    func armWeek<system>() {
        let ?season = Season.running(db()) else {
            cancelWeekTimer();
            return;
        };
        scheduleWeek<system>(season, season.weekEndsAt);
    };

    /// How long to wait before trying a close that failed.
    ///
    /// Not zero, and not never. A failed close leaves the deadline in the past,
    /// so arming at the deadline again would fire immediately, fail again, and
    /// spin — a tight loop burning cycles with nobody watching. Backing off
    /// keeps a transient fault recoverable without that.
    transient let RETRY_AFTER_FAILURE = 5;

    /// The timer's job: close the week that just ended, then arm the next.
    ///
    /// Re-arming from inside is what keeps this to one timer at a time. The
    /// last week of a season closes into `#finished`, `Season.running` returns
    /// nothing, and `armWeek` sets no timer — so a finished season costs
    /// nothing until somebody starts the next one.
    type WeekDrive = { #armed : Nat64; #ran; #failed };

    /// Resolve exactly the round named by the callback. This is synchronous,
    /// so no other message can replace the durable round between validation
    /// and close. Most importantly, the deadline check lives here rather than
    /// trusting that a timer or caller arrived at the right instant.
    func driveWeek<system>(
        seasonId : Nat64,
        week : Nat,
        deadline : Nat64,
    ) : WeekDrive {
        let ?season = Season.running(db()) else {
            armWeek<system>();
            return #ran;
        };
        if (
            season.id != seasonId
            or season.week != week
            or season.weekEndsAt != deadline
        ) {
            armWeek<system>();
            return #armed(season.weekEndsAt);
        };

        let at = now();
        if (at < deadline) {
            scheduleWeek<system>(season, deadline);
            return #armed(deadline);
        };

        switch (Season.closeWeek(db(), at)) {
            case (#ok(closed)) {
                armWeek<system>();
                // The final week closing is what starts the distribution.
                // Nobody proposes it and nobody signs it off — see
                // `Payout.draft` for why there is no longer a human in the
                // loop, and `payDue` for what happens when a ledger is down.
                if (closed.phase == #finished) {
                    // Close admission in the same atomic timer message that
                    // closes the final. No public sweep can pass its final
                    // pre-transfer callback after this point.
                    fundingClosing := true;
                    fundingLease += 1;
                    fundingBusySince := null;
                    fundingRetryAt := at;
                    payoutRound := 0;
                    payoutLease += 1;
                    payoutBusySince := null;
                    payoutRetryAt := 0;
                    armFundingAt<system>(at);
                };
                #ran;
            };
            // Somebody closed it early, or the season is over. Either way the
            // state is fine and `armWeek` will work out what is next.
            case (#err(#NoSeason)) {
                armWeek<system>();
                #ran;
            };
            case (#err(_)) {
                scheduleWeek<system>(season, nanosAfter(RETRY_AFTER_FAILURE * 60));
                #failed;
            };
        };
    };

    /// Timer wrapper. A stale queued callback returns before touching the
    /// current timer handle, so it cannot clear or close a replacement round.
    func closeDueWeek(
        generation : Nat,
        seasonId : Nat64,
        week : Nat,
        deadline : Nat64,
    ) : async () {
        if (generation != weekTimerGeneration) return;
        weekTimer := null;
        ignore driveWeek<system>(seasonId, week, deadline);
    };

    // ── Final funding cutoff ─────────────────────────────────────────────────

    /// Deposits visible to reconciliation during this five-minute window count.
    /// The last full pass at/after the deadline is the published cutoff.
    transient let FUNDING_GRACE : Nat64 = 300_000_000_000;
    transient let FUNDING_RETRY_MINUTES = 1;
    transient let FUNDING_FAILURE_PASS_FLOOR = 15;
    transient let FUNDING_LEASE : Nat64 = 600_000_000_000; // ten quiet minutes
    transient var fundingTimer : ?Timer.TimerId = null;
    transient var fundingTimerGeneration = 0;
    transient var fundingClosing = false;

    /// Logical scheduling and ownership survive an upgrade; timer ids do not.
    /// A sealed production canister cannot upgrade, but preserving the cadence
    /// before sealing keeps upgrades from resetting a safety boundary.
    var fundingRetryAt = 0 : Nat64;
    var fundingBusySince : ?Nat64 = null;
    var fundingLease = 0 : Nat64;
    /// Public sponsor sweeps admitted before a round deadline may already have
    /// sent their transfer when the close callback runs. Final reconciliation
    /// waits for those definite replies before it observes the central pools.
    var fundingSweepsInFlight = 0;
    var fundingSweepsSince : ?Nat64 = null;
    /// Exact reconciliation-transfer window. While nonzero an expired pass
    /// lease cannot be reclaimed, because the outbound transfer has no safe
    /// retry identity and cannot be cancelled locally.
    var fundingTransfersInFlight = 0;

    /// The only transfer-barrier mutation after a ledger reply. Keep this
    /// helper synchronous, guarded, and otherwise side-effect free: both the
    /// normal commit-forcing self-call and its refused-call fallback invoke it.
    /// The fallback is safe because a resource-refused self-call did not
    /// execute; the zero guard prevents underflow but does not make duplicate
    /// completion of one transfer safe while another is still in flight.
    func finishFundingTransferSync() {
        if (fundingTransfersInFlight == 0) return;
        fundingTransfersInFlight := Nat.sub(fundingTransfersInFlight, 1);
    };

    public query func funding_closing() : async Bool { fundingClosing };

    func cancelFundingTimer() {
        fundingTimerGeneration += 1;
        switch (fundingTimer) {
            case (?id) Timer.cancelTimer(id);
            case null {};
        };
        fundingTimer := null;
    };

    func armFundingAt<system>(dueAt : Nat64) {
        cancelFundingTimer();
        let ?season = Season.current(db()) else return;
        if (season.phase != #finished or season.fundingReady) return;

        let generation = fundingTimerGeneration;
        let seasonId = season.id;
        func due() : async () {
            await fundingDue(generation, seasonId, dueAt);
        };
        let delay = Season.secondsUntil(dueAt, now());
        fundingTimer := ?Timer.setTimer<system>(
            #seconds delay,
            due,
        );
    };

    func fundingDue(
        generation : Nat,
        seasonId : Nat64,
        dueAt : Nat64,
    ) : async () {
        if (generation != fundingTimerGeneration) return;
        fundingTimer := null;

        let ?season = Season.current(db()) else return;
        if (season.id != seasonId or season.phase != #finished or season.fundingReady) return;
        if (now() < dueAt) {
            armFundingAt<system>(dueAt);
            return;
        };
        ignore await* driveFunding<system>();
    };

    func fundingFailure(error : Treasury.Error) : Text = switch (error) {
        case (#Frozen) "account frozen";
        case (#NotRegistered) "sponsor row missing";
        case (#NotASponsor) "approved sponsor invariant failed";
        case (#NoLedger) "pledged ledger invariant failed";
        case (#NoSeason) "funding admission closed";
        case (#Nothing) "deposit is empty after fee";
        case (#TooSoon(_)) "rate limited";
        // Do not persist a hostile ledger's unbounded reject message.
        case (#Transfer(_)) "ledger read or transfer failed";
    };

    func addFundingFailure(
        failures : List.List<Season.FundingFailure>,
        ledger : Principal,
        reason : Text,
    ) {
        for (failure in List.values(failures)) {
            if (failure.ledger == ledger) return;
        };
        List.add(failures, { ledger; reason });
    };

    type AutomationDrive = {
        #armed : Nat64;
        #busy : Nat64;
        #ran;
        #failed;
    };

    func fundingOwned(lease : Nat64, seasonId : Nat64) : Bool {
        if (fundingLease != lease) return false;
        let ?season = Season.current(db()) else return false;
        season.id == seasonId and season.phase == #finished and not season.fundingReady;
    };

    func touchFunding(lease : Nat64, seasonId : Nat64) : Bool {
        if (not fundingOwned(lease, seasonId)) return false;
        fundingBusySince := ?now();
        true;
    };

    func releaseFunding(lease : Nat64) {
        if (fundingLease == lease) fundingBusySince := null;
    };

    func fundingRetryDeadline(at : Nat64, graceEnds : Nat64) : Nat64 {
        let retry = at + Nat64.fromNat(FUNDING_RETRY_MINUTES * 60) * 1_000_000_000;
        if (at < graceEnds and graceEnds < retry) graceEnds else retry;
    };

    /// Serialize timer and moderator recovery calls before the first ledger
    /// await. The pass lease is recoverable after ten quiet minutes of reads or
    /// local work. Only the exact transfer await is non-reclaimable: a timeout
    /// or a local token cannot cancel a transfer already accepted by another
    /// canister. Its guaranteed reply resumes this continuation after a cycles
    /// top-up. Repeated moderator checks cannot start a duplicate pass.
    func driveFunding<system>() : async* AutomationDrive {
        fundingClosing := true;
        let database = db();
        let ?season = Season.current(database) else return #failed;
        if (season.phase != #finished or season.fundingReady) return #ran;

        let at = now();
        if (fundingSweepsInFlight > 0) {
            cancelFundingTimer();
            return #busy(switch (fundingSweepsSince) { case (?since) since; case null at });
        };
        switch (fundingBusySince) {
            case (?since) {
                let retryAt = since + FUNDING_LEASE;
                if (at < retryAt) {
                    armFundingAt<system>(retryAt);
                    return #busy(since);
                };
                if (fundingTransfersInFlight > 0) {
                    // Do not take over an outcome-unknown transfer. Check only
                    // once per quiet lease; this is a watchdog, not polling.
                    armFundingAt<system>(at + FUNDING_LEASE);
                    return #busy(since);
                };
            };
            case null {};
        };
        if (at < fundingRetryAt) {
            armFundingAt<system>(fundingRetryAt);
            return #armed(fundingRetryAt);
        };

        fundingLease += 1;
        let lease = fundingLease;
        fundingBusySince := ?at;
        armFundingAt<system>(at + FUNDING_LEASE);
        await* reconcileFunding(lease, season.id, at);
        #ran;
    };

    /// Drain every frozen sponsor/ledger deposit pair. Before the grace
    /// deadline failures retry; at/after it this final full pass records the
    /// remaining failures and makes payout reachable.
    func reconcileFunding<system>(lease : Nat64, seasonId : Nat64, passStartedAt : Nat64) : async* () {
        let database = db();
        if (not fundingOwned(lease, seasonId)) return;

        let failures = List.empty<Season.FundingFailure>();
        let me = Principal.fromActor(Hackathon);
        for (pair in Treasury.fundingPairs(database).vals()) {
            if (not fundingOwned(lease, seasonId)) return;
            var cleanupFallback = false;
            func stillOwned() : Bool = fundingOwned(lease, seasonId);
            func transferStarted() : Bool {
                if (not touchFunding(lease, seasonId)) return false;
                fundingTransfersInFlight += 1;
                true;
            };
            func transferFinishedSync() {
                finishFundingTransferSync();
                cleanupFallback := true;
            };
            func transferFinished() : async () { finishFundingTransferSync() };
            let outcome = await* Treasury.reconcile(
                database,
                Treasury.fundingIcrc1(pair.ledger),
                me,
                pair.userId,
                pair.ledger,
                now(),
                stillOwned,
                transferStarted,
                transferFinished,
                transferFinishedSync,
            );
            // The synchronous cleanup ran because its commit-forcing self-call
            // was refused. Return immediately: no lease/accounting write can
            // now trap and roll that decrement back. A moderator wake after
            // cycles are restored resumes from the durable state.
            if (cleanupFallback) return;
            if (not touchFunding(lease, seasonId)) return;
            switch (outcome) {
                case (#ok(_)) {};
                // A fresh balance read at or below the fee completes the pair.
                case (#err(#Nothing)) {};
                case (#err(error)) {
                    addFundingFailure(failures, pair.ledger, fundingFailure(error));
                };
            };
        };

        // Snapshot the whole treasury after the last deposit-account transfer.
        // Once the final observation returns, no further await occurs before
        // these values and `fundingReady` are committed together.
        let pools = List.empty<(Principal, Nat)>();
        let fees = List.empty<(Principal, Nat)>();
        // Kept separate from the persisted combined failures: a failed sponsor
        // deposit read must not authorize omitting a central treasury balance
        // that was successfully observed.
        let excludedLedgers = List.empty<Principal>();
        for (ledger in Treasury.ledgersInPlay(database).vals()) {
            if (not fundingOwned(lease, seasonId)) return;
            let observation : ?(Nat, Nat) = try {
                let api = Treasury.boundedIcrc1(ledger);
                let pool = await* Treasury.balance(api, me);
                if (not touchFunding(lease, seasonId)) return;
                // A zero treasury produces no payout row, so its fee cannot
                // affect this plan and need not become another failure point.
                let fee = if (pool == 0) 0 else {
                    let read = await* api.fee();
                    if (not touchFunding(lease, seasonId)) return;
                    read;
                };
                ?(pool, fee);
            } catch (_) {
                if (not touchFunding(lease, seasonId)) return;
                null;
            };
            switch (observation) {
                case (?(pool, fee)) {
                    List.add(pools, (ledger, pool));
                    List.add(fees, (ledger, fee));
                };
                case null {
                    List.add(excludedLedgers, ledger);
                    addFundingFailure(failures, ledger, "ledger read or transfer failed");
                };
            };
        };

        if (not fundingOwned(lease, seasonId)) return;
        let ?season = database.seasons.get(seasonId) else {
            releaseFunding(lease);
            return;
        };
        if (season.phase != #finished or season.fundingReady) {
            releaseFunding(lease);
            return;
        };

        let attempt = season.fundingAttempts + 1;
        let at = now();
        let graceEnds = season.endedAt + FUNDING_GRACE;
        // No caller can turn the attempt ceiling into an early cutoff: time
        // reaching the grace boundary is required in every final-pass case.
        let finalPass = passStartedAt >= graceEnds and (
            List.size(failures) == 0 or attempt >= FUNDING_FAILURE_PASS_FLOOR
        );
        switch (Season.setFunding(database, season.id, attempt, List.toArray(failures), finalPass)) {
            case (#err(_)) {
                fundingRetryAt := fundingRetryDeadline(at, graceEnds);
                releaseFunding(lease);
                armFundingAt<system>(fundingRetryAt);
            };
            case (#ok(_)) {
                if (finalPass) {
                    // No await is permitted between the persisted cutoff and
                    // this frozen plan. A ledger that answered is represented;
                    // one that did not is omitted only alongside its explicit
                    // persisted funding failure, so reachable pools continue.
                    let drafted = switch (
                        Payout.draftReconciled(
                            database,
                            season.id,
                            List.toArray(pools),
                            List.toArray(fees),
                            List.toArray(excludedLedgers),
                            at,
                        )
                    ) {
                        case (#ok(_)) true;
                        case (#err(#Empty)) {
                            switch (Payout.finishEmpty(database, season.id)) {
                                case (#ok(_)) false;
                                case (#err(_)) Runtime.trap("could not atomically close an empty payout plan");
                            };
                        };
                        case (#err(_)) Runtime.trap("could not atomically freeze the reconciled payout plan");
                    };
                    fundingRetryAt := 0;
                    releaseFunding(lease);
                    cancelFundingTimer();
                    payoutRound := 0;
                    payoutLease += 1;
                    payoutBusySince := null;
                    // Leave a deterministic observation/failover boundary
                    // between freezing the plan and its first transfer.
                    if (drafted) {
                        payoutRetryAt := at + 1_000_000_000;
                        armPayoutAt<system>(payoutRetryAt);
                    } else {
                        payoutRetryAt := 0;
                        stopPayoutTimer();
                    };
                } else {
                    fundingRetryAt := fundingRetryDeadline(at, graceEnds);
                    releaseFunding(lease);
                    armFundingAt<system>(fundingRetryAt);
                };
            };
        };
    };

    // ── Treasury ─────────────────────────────────────────────────────────────

    /// Funding admission follows the published round deadline, not merely the
    /// phase row. If a close timer vanished, the deadline still closes this
    /// window; recovery may open the next round, with its own new deadline.
    func fundingAdmissionOpen(database : Ashroot.DB) : Bool {
        if (fundingClosing) return false;
        let ?season = Season.running(database) else return false;
        Season.roundOpen(season, now());
    };

    /// Count every externally admitted sweep across its ledger awaits. The
    /// final funding pass cannot start while one may already have dispatched a
    /// transfer. The counter is deliberately durable across a cycles freeze.
    func beginFundingSweep() {
        if (fundingSweepsInFlight == 0) fundingSweepsSince := ?now();
        fundingSweepsInFlight += 1;
    };

    /// The only sweep-barrier mutation after a ledger reply. The synchronous
    /// fallback is correct because a resource-refused commit call did not
    /// execute. The zero guard prevents underflow; it is not an idempotency
    /// claim when several independently owned sweeps are still in flight.
    func finishFundingSweepSync() : Bool {
        if (fundingSweepsInFlight == 0) return false;
        fundingSweepsInFlight := Nat.sub(fundingSweepsInFlight, 1);
        fundingSweepsInFlight == 0;
    };

    /// Force the decrement to commit before metering, timer installation,
    /// reply encoding, or other later work. If a low-cycle canister cannot
    /// enqueue this self-call, finish the same known-complete sweep locally.
    func finishFundingSweepCommit() : async Bool {
        finishFundingSweepSync();
    };

    type SweepBarrierFinish = { #committed : Bool; #fallback };

    func finishFundingSweepBarrier() : async* SweepBarrierFinish {
        try {
            #committed(await finishFundingSweepCommit());
        } catch (_) {
            ignore finishFundingSweepSync();
            #fallback;
        };
    };

    func rearmFundingAfterSweep<system>() {
        if (fundingSweepsInFlight != 0 or fundingBusySince != null) return;
        // The final-close callback may have found this barrier and left no
        // polling timer. The last definite ledger reply supplies the wake-up.
        let ?season = Season.current(db()) else return;
        if (season.phase == #finished and not season.fundingReady) {
            fundingRetryAt := now();
            armFundingAt<system>(fundingRetryAt);
        };
    };

    /// `false` means the synchronous low-cycle fallback ran. Callers must
    /// return immediately in that case; recovery will rearm funding later.
    func completeFundingSweep<system>() : async* Bool {
        switch (await* finishFundingSweepBarrier()) {
            case (#fallback) false;
            case (#committed(last)) {
                if (last) {
                    fundingSweepsSince := null;
                    rearmFundingAfterSweep<system>();
                };
                true;
            };
        };
    };

    /// Where an approved sponsor sends their contribution.
    ///
    /// **Only while a season is running.** `Treasury.sweep` refuses outside
    /// one, so tokens sent early sit at an address the canister will not
    /// collect from until a season opens — money in limbo, and the sponsor
    /// with no way to tell. Withholding the address is the only honest answer:
    /// an address you cannot act on should not be shown as though you can.
    ///
    /// It closes again when the season finishes, for the same reason.
    func depositIfOpen(user : Profiles.User) : ?Treasury.Deposit {
        if (user.sponsorStatus == #no) return null;
        if (not fundingAdmissionOpen(db())) return null;
        ?Treasury.depositFor(Principal.fromActor(Hackathon), user);
    };

    public query ({ caller }) func my_deposit() : async ?Treasury.Deposit {
        let ?user = Profiles.owner(db(), caller) else return null;
        depositIfOpen(user);
    };

    public query func deposit_for(handle : Text) : async ?Treasury.Deposit {
        let ?user = Profiles.byHandle(db(), handle) else return null;
        depositIfOpen(user);
    };

    /// Move an approved sponsor's balance into the treasury. One way.
    public shared ({ caller }) func sweep_sponsor(
        handle : Text,
        ledger : Principal,
    ) : async Result.Result<Nat, Treasury.Error> {
        let database = db();
        if (not Profiles.canModerate(database, caller)) return #err(#NotRegistered);
        switch (Treasury.eligible(database, handle, ledger)) {
            case (#err(e)) return #err(e);
            case (#ok(_)) {};
        };
        if (not fundingAdmissionOpen(database)) return #err(#NoSeason);
        beginFundingSweep();
        let result = await* Treasury.sweepWhile(
            database,
            Treasury.fundingIcrc1(ledger),
            Principal.fromActor(Hackathon),
            handle,
            ledger,
            now(),
            func() = fundingAdmissionOpen(database),
        );
        if (not (await* completeFundingSweep<system>())) return result;
        result;
    };

    /// A sponsor telling us the tokens have been sent.
    ///
    /// Sponsors move their own money and then say so; the canister checks the
    /// deposit address itself rather than believing an amount off the wire.
    /// Nothing here trusts the caller beyond "which of your ledgers to look
    /// at" — the address is derived from their id, and the sweep refuses a
    /// ledger they did not pledge.
    /// How often one sponsor may ask for their deposits to be collected.
    ///
    /// A sweep is three inter-canister calls per ledger and it is triggered by
    /// the caller, so without a limit one sponsor could keep the canister busy
    /// talking to ledgers for free. A minute is far below any honest use — a
    /// transfer has to land first — and far above what a loop needs to be
    /// useless.
    transient let NOTIFY_EVERY : Nat64 = 60_000_000_000;

    /// When each sponsor last swept, keyed by user id.
    ///
    /// Stable, and it has to be. This was transient on the reasoning that a
    /// rate limit is abuse control rather than accounting, so losing it costs
    /// nothing — but that is only true if upgrades are rare, and the party who
    /// decides how often this canister upgrades is not the party being limited.
    /// A wiped window is an open window, and an upgrade is exactly the moment
    /// nobody is watching the cycle balance. It costs one small entry per
    /// approved sponsor ever, which is the bound that makes keeping it easy.
    let notifiedAt = Map.empty<Nat64, Nat64>();

    /// Spend the caller's turn at the limit, or say how much of it is left.
    ///
    /// Stamped before the caller's first await, because every await is a commit
    /// point: two calls racing here must not both get through.
    func takeTurn(id : Nat64, at : Nat64) : Result.Result<(), Treasury.Error> {
        switch (Map.get(notifiedAt, Nat64.compare, id)) {
            case (?last) {
                if (at < last + NOTIFY_EVERY) {
                    return #err(#TooSoon(Nat64.toNat((last + NOTIFY_EVERY - at) / 1_000_000_000)));
                };
            };
            case null {};
        };
        Map.add(notifiedAt, Nat64.compare, id, at);
        #ok;
    };

    /// Collect everything a sponsor has sent, across every ledger they pledged.
    ///
    /// Self-service: the sponsor transfers, then says so. Each ledger is swept
    /// independently and one that fails does not stop the others — a sponsor
    /// paying in three tokens should not be blocked by one unreachable ledger.
    public shared ({ caller }) func notify_deposits() : async Result.Result<[(Principal, Nat)], Treasury.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        var cleanupFallback = false;
        func markCleanupFallback() { cleanupFallback := true };
        let result = await* notifyDeposits(caller, markCleanupFallback);
        if (cleanupFallback) return result;
        Meter.close(m, result);
    };

    func notifyDeposits(
        caller : Principal,
        markCleanupFallback : () -> (),
    ) : async* Result.Result<[(Principal, Nat)], Treasury.Error> {
        let database = db();
        let ?user = Profiles.owner(database, caller) else return #err(#NotRegistered);
        if (user.sponsorStatus != #approved) return #err(#NotASponsor);
        let ?info = user.sponsor else return #err(#NoLedger);
        if (info.ledgers.size() == 0) return #err(#NoLedger);
        if (fundingClosing) return #err(#NoSeason);

        switch (takeTurn(user.id, now())) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };
        if (not fundingAdmissionOpen(database)) {
            return if (fundingClosing) #err(#NoSeason) else #ok([]);
        };

        let me = Principal.fromActor(Hackathon);
        var moved : [(Principal, Nat)] = [];
        beginFundingSweep();
        label ledgers for (ledger in info.ledgers.vals()) {
            if (not fundingAdmissionOpen(database)) break ledgers;
            let swept = await* Treasury.sweepWhile(
                database,
                Treasury.fundingIcrc1(ledger.id),
                me,
                user.handle,
                ledger.id,
                now(),
                func() = fundingAdmissionOpen(database),
            );
            switch (swept) {
                case (#ok(amount)) { moved := Array.concat(moved, [(ledger.id, amount)]) };
                // Nothing there, or that ledger would not answer. Neither is a
                // reason to abandon the rest.
                case (#err(_)) {};
            };
        };
        let result = #ok(moved);
        if (not (await* completeFundingSweep<system>())) {
            markCleanupFallback();
            return result;
        };
        result;
    };

    /// Sweep one named ledger.
    ///
    /// Rate-limited from the same window as `notify_deposits`, which it used to
    /// skip entirely — so the limit was decorative: one call a minute asking
    /// about all your ledgers, or as many as you liked asking about one. The
    /// eligibility check runs first so a refusal does not spend the turn.
    public shared ({ caller }) func notify_deposit(
        ledger : Principal,
    ) : async Result.Result<Nat, Treasury.Error> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        var cleanupFallback = false;
        func markCleanupFallback() { cleanupFallback := true };
        let result = await* notifyDeposit(caller, ledger, markCleanupFallback);
        if (cleanupFallback) return result;
        Meter.close(m, result);
    };

    func notifyDeposit(
        caller : Principal,
        ledger : Principal,
        markCleanupFallback : () -> (),
    ) : async* Result.Result<Nat, Treasury.Error> {
        let database = db();
        let ?user = Profiles.owner(database, caller) else return #err(#NotRegistered);
        switch (Treasury.eligible(database, user.handle, ledger)) {
            case (#err(e)) return #err(e);
            case (#ok(_)) {};
        };
        if (not fundingAdmissionOpen(database)) return #err(#NoSeason);
        switch (takeTurn(user.id, now())) {
            case (#err(e)) return #err(e);
            case (#ok) {};
        };
        beginFundingSweep();
        let result = await* Treasury.sweepWhile(
            database,
            Treasury.fundingIcrc1(ledger),
            Principal.fromActor(Hackathon),
            user.handle,
            ledger,
            now(),
            func() = fundingAdmissionOpen(database),
        );
        if (not (await* completeFundingSweep<system>())) {
            markCleanupFallback();
            return result;
        };
        result;
    };

    /// The ledgers any approved sponsor pledged — what the treasury may hold.
    public query func treasury_ledgers() : async [Principal] {
        Treasury.ledgersInPlay(db());
    };

    // ── Paying the season out ────────────────────────────────────────────────

    /// Report whether final reconciliation already froze the distribution.
    ///
    /// Retained for interface compatibility and moderator diagnostics. Final
    /// reconciliation exclusively owns the ledger snapshot and plan write;
    /// this endpoint performs no ledger I/O and can never redraft it.
    public shared ({ caller }) func propose_payout(
        seasonId : Nat64,
    ) : async Result.Result<Nat, Payout.Error> {
        if (not Profiles.canModerate(db(), caller)) return #err(#NotAllowed);
        await* draftFor(seasonId);
    };

    /// Final reconciliation owns the one balance snapshot and writes the plan.
    ///
    /// The retained moderator endpoint is diagnostic/backward compatible; it
    /// never performs post-cutoff ledger I/O or reopens a frozen/terminal plan.
    func draftFor(seasonId : Nat64) : async* Result.Result<Nat, Payout.Error> {
        let database = db();
        let ?season = database.seasons.get(seasonId) else return #err(#NoSeason);
        if (not season.fundingReady) {
            return #err(#WrongPhase("final sponsor funding reconciliation is still open"));
        };
        #err(#WrongPhase("final reconciliation already froze the payout result"));
    };

    // ── Paying without being asked ───────────────────────────────────────────

    /// How long between attempts at whatever is still unsent.
    ///
    /// An hour, from the todo: long enough that a ledger which was down has a
    /// chance to come back, short enough that a season settles inside a day.
    transient let RETRY_EVERY = 60;

    /// How many times the canister will keep coming back.
    ///
    /// Each firing makes up to `Payout.PASSES` attempts per row, so this is the
    /// outer bound on how long a broken ledger can hold settlement open. At
    /// the ceiling every remaining row becomes terminally failed; the canister
    /// itself stays permanently sealed.
    transient let RETRY_ROUNDS = 24;
    transient let PAYOUT_LEASE : Nat64 = 600_000_000_000; // ten minutes
    transient let PAYOUT_RETRY : Nat64 = 3_600_000_000_000; // one hour

    transient var payoutTimer : ?Timer.TimerId = null;
    transient var payoutTimerGeneration = 0;
    var payoutRound = 0;
    var payoutBusySince : ?Nat64 = null;
    var payoutLease = 0 : Nat64;
    var payoutRetryAt = 0 : Nat64;

    /// Is a distribution still being attempted?
    public query func payout_armed() : async Bool {
        payoutTimer != null;
    };

    func cancelPayoutTimer() {
        payoutTimerGeneration += 1;
        switch (payoutTimer) {
            case (?id) Timer.cancelTimer(id);
            case null {};
        };
        payoutTimer := null;
    };

    /// Point a guarded one-shot timer at an absolute logical retry time. An
    /// old queued callback cannot clear a newer watchdog or retry.
    func armPayoutAt<system>(dueAt : Nat64) {
        cancelPayoutTimer();
        let ?season = Season.current(db()) else return;
        if (
            season.phase != #finished
            or not season.fundingReady
            or payoutTerminal(season)
        ) return;

        let generation = payoutTimerGeneration;
        let seasonId = season.id;
        func due() : async () {
            await payDue(generation, seasonId, dueAt);
        };
        let delay = Season.secondsUntil(dueAt, now());
        payoutTimer := ?Timer.setTimer<system>(
            #seconds delay,
            due,
        );
    };

    func stopPayoutTimer() {
        cancelPayoutTimer();
    };

    /// Acquire the one shared timer/manual lease. Both the cooldown and the
    /// lease are stamped before the first ledger await. A stale lease can be
    /// reclaimed, while a fresh one or future retry deadline performs no I/O.
    func acquirePayout(at : Nat64) : ?Nat64 {
        var reclaimingExpiredOwner = false;
        switch (payoutBusySince) {
            case (?since) {
                if (at < since + PAYOUT_LEASE) return null;
                reclaimingExpiredOwner := true;
            };
            case null {};
        };
        // The hourly cadence applies between completed rounds. A worker that
        // has made no progress for a full lease is a failed owner, not a
        // completed round, and its watchdog may take over immediately.
        if (not reclaimingExpiredOwner and at < payoutRetryAt) return null;
        payoutLease += 1;
        payoutBusySince := ?at;
        payoutRetryAt := at + PAYOUT_RETRY;
        ?payoutLease;
    };

    func releasePayout(lease : Nat64) {
        if (payoutLease == lease) payoutBusySince := null;
    };

    func payoutTerminal(season : Season.Season) : Bool {
        season.payout == #paid or season.payout == #failed;
    };

    func schedulePayoutRetry<system>() {
        armPayoutAt<system>(payoutRetryAt);
    };

    /// Draft if there is nothing drafted, then send whatever is left.
    ///
    /// Every error path re-arms rather than returning. A distribution that
    /// stopped because one ledger was unreachable must not need a person to
    /// restart it — there may not be one who can.
    func payDue(
        generation : Nat,
        seasonId : Nat64,
        dueAt : Nat64,
    ) : async () {
        if (generation != payoutTimerGeneration) return;
        payoutTimer := null;
        let ?season = Season.current(db()) else return;
        if (
            season.id != seasonId
            or season.phase != #finished
            or not season.fundingReady
            or payoutTerminal(season)
        ) return;
        if (now() < dueAt) {
            armPayoutAt<system>(dueAt);
            return;
        };
        ignore await* payoutAttempt(seasonId, true, true);
    };

    func payoutAttempt(
        seasonId : Nat64,
        draftMissing : Bool,
        rearmWhenBlocked : Bool,
    ) : async* Result.Result<Payout.Progress, Payout.Error> {
        let database = db();
        let ?season = database.seasons.get(seasonId) else return #err(#NoSeason);
        if (not season.fundingReady) {
            return #err(#WrongPhase("final sponsor funding reconciliation is still open"));
        };
        if (payoutTerminal(season)) return #ok(Payout.progressOf(database, seasonId));
        if (not draftMissing and season.payout == #none) {
            return #err(#WrongPhase("there is no plan waiting to be sent"));
        };

        let at = now();
        let ?lease = acquirePayout(at) else {
            // Timer callbacks rebuild their own absolute watchdog/cooldown.
            // Manual `run_payout` is a no-op while blocked, so repeated
            // moderator checks cannot cancel and reinstall the same system
            // timer.
            if (rearmWhenBlocked) {
                let nextAt = switch (payoutBusySince) {
                    case (?since) {
                        if (at < since + PAYOUT_LEASE) since + PAYOUT_LEASE
                        else payoutRetryAt;
                    };
                    case null payoutRetryAt;
                };
                armPayoutAt<system>(nextAt);
            };
            return #ok(Payout.progressOf(database, seasonId));
        };
        // Do not launch a 25th remote round merely to discover the durable
        // ceiling afterward. Acquiring first invalidates any older owner; the
        // terminal write itself performs no await.
        if (payoutRound >= RETRY_ROUNDS) {
            releasePayout(lease);
            stopPayoutTimer();
            return Payout.exhaust(database, seasonId);
        };
        // Watchdog survives a trapped or indefinitely suspended continuation.
        armPayoutAt<system>(at + PAYOUT_LEASE);
        payoutRound += 1;

        if (draftMissing and season.payout == #none) {
            // A current-version finalizer never leaves this combination. Fail
            // closed if legacy/corrupt state reaches it; discovering balances
            // after fundingReady would recreate the omitted-ledger race.
            releasePayout(lease);
            stopPayoutTimer();
            return Payout.exhaust(database, seasonId);
        };

        let runResult = switch (database.seasons.get(seasonId)) {
            case (?fresh) {
                if (fresh.payout == #approved or fresh.payout == #paying) {
                    func stillOwned() : Bool {
                        if (payoutLease != lease) return false;
                        let ?active = database.seasons.get(seasonId) else return false;
                        if (payoutTerminal(active)) return false;
                        // Active row-by-row progress renews the quiet-period
                        // watchdog. A genuinely suspended ledger call does not.
                        payoutBusySince := ?now();
                        true;
                    };
                    await* Payout.runWhile(
                        database,
                        seasonId,
                        Principal.fromActor(Hackathon),
                        Treasury.boundedIcrc1,
                        stillOwned,
                    );
                } else {
                    #ok(Payout.progressOf(database, seasonId));
                };
            };
            case null #ok(Payout.progressOf(database, seasonId));
        };

        // A stale lease may have been reclaimed while this ledger call was
        // suspended. Its late continuation may settle its own rows, but must
        // not cancel/rearm the newer owner's watchdog or exhaust its budget.
        if (payoutLease != lease) return runResult;
        releasePayout(lease);
        let current = database.seasons.get(seasonId);
        let terminal = switch (current) {
            case (?fresh) payoutTerminal(fresh);
            case null true;
        };

        let finalResult = if (not terminal and payoutRound >= RETRY_ROUNDS) {
            Payout.exhaust(database, seasonId);
        } else {
            runResult;
        };

        let finished = switch (database.seasons.get(seasonId)) {
            case (?fresh) payoutTerminal(fresh);
            case null true;
        };
        if (finished) {
            stopPayoutTimer();
        } else {
            // The hourly recovery cadence starts after the owned pass
            // completes, not when its first ledger call began. A long pass
            // therefore cannot immediately churn into another one.
            payoutRetryAt := now() + PAYOUT_RETRY;
            schedulePayoutRetry<system>();
        };
        finalResult;
    };

    /// A planned line with the person attached. The row stores a user id
    /// because that is what the money is keyed on; a moderator approving a
    /// distribution needs to see a name.
    public type Line = Payout.Payout and { handle : Text; displayName : Text };

    func named(rows : [Payout.Payout]) : [Line] {
        let database = db();
        Array.map<Payout.Payout, Line>(
            rows,
            func(row) {
                switch (database.users.get(row.user_id)) {
                    case (?who) ({ row with handle = who.handle; displayName = who.displayName });
                    case null ({ row with handle = ""; displayName = "" });
                };
            },
        );
    };

    public query func payout_plan(seasonId : Nat64) : async [Line] {
        named(Payout.forSeason(db(), seasonId));
    };

    public query func payout_progress(seasonId : Nat64) : async Payout.Progress {
        Payout.progressOf(db(), seasonId);
    };

    public query ({ caller }) func my_payouts() : async [Payout.Payout] {
        let ?user = Profiles.byPrincipal(db(), caller) else return [];
        Payout.forUser(db(), user.id);
    };


    /// Send the approved plan. Resumable: call it again after a failure and it
    /// picks up whatever is left, re-sending identical arguments.
    ///
    /// This is the moderator fallback for a distribution whose timer stopped
    /// while the canister was frozen. It uses the same lease, cooldown and
    /// immutable plan as the automatic worker; standing is checked before even
    /// the bounded progress scan.
    ///
    /// Resumption is safe because the plan is not an input. Amounts,
    /// destinations, fees and the deduplication nonce were all frozen when it
    /// was drafted; the moderator cannot add a row, change one, or aim one
    /// somewhere else. Every attempt re-sends byte-identical arguments, so a
    /// row that already went through comes back `#Duplicate` and settles as
    /// paid.
    public shared ({ caller }) func run_payout(
        seasonId : Nat64,
    ) : async Result.Result<Payout.Progress, Payout.Error> {
        if (not Profiles.canModerate(db(), caller)) return #err(#NotAllowed);
        await* payoutAttempt(seasonId, false, false);
    };

    func fundingNextAt() : ?Nat64 {
        switch (fundingBusySince) {
            case (?since) ?(since + FUNDING_LEASE);
            case null if (fundingRetryAt == 0) null else ?fundingRetryAt;
        };
    };

    func payoutNextAt() : ?Nat64 {
        switch (payoutBusySince) {
            case (?since) ?(since + PAYOUT_LEASE);
            case null if (payoutRetryAt == 0) null else ?payoutRetryAt;
        };
    };

    /// Describe the durable phase after one due action ran. This is computed
    /// after any awaits, never from a season row captured before them.
    func automationAfterRun() : AutomationWake {
        let ?season = Season.current(db()) else return #idle;
        switch (season.phase) {
            case (#draft) #idle;
            case (#running) #ran({
                stage = #round(season.week);
                nextAt = ?season.weekEndsAt;
            });
            case (#finished) {
                if (not season.fundingReady) {
                    #ran({ stage = #funding; nextAt = fundingNextAt() });
                } else if (payoutTerminal(season)) {
                    #settled;
                } else {
                    #ran({ stage = #payout; nextAt = payoutNextAt() });
                };
            };
        };
    };

    func drivePayout<system>(seasonId : Nat64) : async* AutomationDrive {
        let database = db();
        let ?season = database.seasons.get(seasonId) else return #failed;
        if (not season.fundingReady) return #failed;
        if (payoutTerminal(season)) return #ran;

        let at = now();
        var reclaimingExpiredOwner = false;
        switch (payoutBusySince) {
            case (?since) {
                let retryAt = since + PAYOUT_LEASE;
                if (at < retryAt) {
                    armPayoutAt<system>(retryAt);
                    return #busy(since);
                };
                reclaimingExpiredOwner := true;
            };
            case null {};
        };
        if (not reclaimingExpiredOwner and at < payoutRetryAt) {
            armPayoutAt<system>(payoutRetryAt);
            return #armed(payoutRetryAt);
        };

        switch (await* payoutAttempt(seasonId, false, false)) {
            case (#ok(_)) #ran;
            case (#err(_)) #failed;
        };
    };

    /// Recover a vanished lifecycle timer after cycles are restored.
    ///
    /// This is deliberately not an override. The caller supplies no target or
    /// timing data. An early call only replaces the one-shot timer at the exact
    /// stored deadline; a due call enters the same guarded phase function as
    /// that timer. Funding and payout retain their leases and retry cadence.
    public shared ({ caller }) func wake_automation() : async Result.Result<AutomationWake, AutomationError> {
        if (not Profiles.canModerate(db(), caller)) return #err(#NotAllowed);

        let ?season = Season.current(db()) else return #ok(#idle);
        switch (season.phase) {
            case (#draft) #ok(#idle);
            case (#running) {
                let stage : AutomationStage = #round(season.week);
                if (now() < season.weekEndsAt) {
                    scheduleWeek<system>(season, season.weekEndsAt);
                    return #ok(#armed({ stage; at = season.weekEndsAt }));
                };

                cancelWeekTimer();
                switch (driveWeek<system>(season.id, season.week, season.weekEndsAt)) {
                    case (#armed(at)) #ok(#armed({ stage; at }));
                    case (#ran) #ok(automationAfterRun());
                    case (#failed) #err(#Unavailable);
                };
            };
            case (#finished) {
                cancelWeekTimer();
                if (not season.fundingReady) {
                    stopPayoutTimer();
                    switch (await* driveFunding<system>()) {
                        case (#armed(at)) #ok(#armed({ stage = #funding; at }));
                        case (#busy(since)) #ok(#busy({ stage = #funding; since }));
                        case (#ran) #ok(automationAfterRun());
                        case (#failed) #err(#Unavailable);
                    };
                } else if (payoutTerminal(season)) {
                    cancelFundingTimer();
                    stopPayoutTimer();
                    #ok(#settled);
                } else {
                    cancelFundingTimer();
                    switch (await* drivePayout<system>(season.id)) {
                        case (#armed(at)) #ok(#armed({ stage = #payout; at }));
                        case (#busy(since)) #ok(#busy({ stage = #payout; since }));
                        case (#ran) #ok(automationAfterRun());
                        case (#failed) #err(#Unavailable);
                    };
                };
            };
        };
    };

    // ── Withdrawing ──────────────────────────────────────────────────────────

    /// Where the caller's rewards are held.
    ///
    /// The address, not the balance. Reading a balance means calling a ledger,
    /// and a method that calls whichever ledger the caller names is a way to
    /// spend this canister's cycles on someone else's errand. The browser can
    /// query `icrc1_balance_of` itself — it is a public, anonymous query, and
    /// the account below is all it needs.
    public query ({ caller }) func my_reward_account() : async ?Treasury.Account {
        let ?user = Profiles.owner(db(), caller) else return null;
        ?Treasury.rewardAccount(Principal.fromActor(Hackathon), user.id);
    };

    public query func withdrawals_locked() : async Bool {
        Payout.running(db());
    };

    /// Move your own rewards out. **The account holder only, never an agent.**
    ///
    /// The source subaccount is derived from `caller` and is not a parameter,
    /// so there is no input to this method that can name the treasury or
    /// somebody else's rewards. The destination *is* a parameter, which is why
    /// this resolves with `Profiles.owner`: an agent is trusted to drive the
    /// account, not to empty it.
    public shared ({ caller }) func withdraw(
        ledger : Principal,
        to : Treasury.Account,
    ) : async Result.Result<Nat, Treasury.WithdrawError> {
        let ?m = Meter.open(db(), caller) else return #err(#Frozen);
        Meter.close(m, await* withdrawFor(caller, ledger, to));
    };

    func withdrawFor(
        caller : Principal,
        ledger : Principal,
        to : Treasury.Account,
    ) : async* Result.Result<Nat, Treasury.WithdrawError> {
        let database = db();
        // A withdrawal has to call a ledger, so bound which — otherwise this
        // method is an open invitation to make the canister call an arbitrary
        // canister. The bound is per caller: a ledger they hold a payout row
        // on. The canister has already sent them that token once, so dialling
        // it again on their behalf is nothing it has not done.
        //
        // It used to be "a ledger some approved sponsor currently pledges",
        // which a sponsor could shrink by leaving — stranding every winner's
        // rewards on the token that sponsor funded. Nothing in rules.md §7
        // makes a winner's access to their own money contingent on a sponsor
        // staying.
        let ?who = Profiles.owner(database, caller) else return #err(#NotRegistered);
        // One rule and one refusal. Splitting it into "a ledger we deal in that
        // you have nothing on" versus "not a ledger" reads better, but every
        // source for "a ledger we deal in" is written by sponsors — which is
        // the input this guard just stopped depending on. A friendlier message
        // is not worth putting it back.
        if (not Payout.owed(database, who.id, ledger)) return #err(#BadDestination);
        await* Treasury.withdraw(
            database,
            Treasury.icrc1(ledger),
            Principal.fromActor(Hackathon),
            caller,
            to,
            func() = Payout.running(database),
        );
    };

    /// What the treasury holds, per ledger.
    ///
    /// A query over our own records, not a round of calls to the ledgers. The
    /// canister already knows every movement — see `Treasury.pools` — and the
    /// method this replaces took a ledger id from the caller and called it,
    /// which let anyone make this canister send messages wherever they liked.
    public query func prize_pool() : async [(Principal, Nat)] {
        Treasury.pools(db());
    };

    // ── Introspection ────────────────────────────────────────────────────────

    public query ({ caller }) func whoami() : async Principal { caller };

    public query ({ caller }) func is_controller() : async Bool {
        Principal.isController(caller);
    };

    // ── Starting the clocks ──────────────────────────────────────────────────
    //
    // Last in the actor body, because both of these reach forward: closing a
    // week can finish a season, and finishing a season arms the distribution.
    //
    // Runs on install *and* on every upgrade, which is the point: timers do
    // not survive an upgrade, so this is what puts the clock back. Reading the
    // deadline off the season means an upgrade cannot drift the schedule.
    // Stable asset/tree memory survives an upgrade; certified data does not.
    // A bare body expression is rerun on both install and upgrade.
    assets().republish();
    // Async continuations do not survive an upgrade. Logical retry times and
    // budgets do, but an owner that can no longer resume must not keep its
    // lease/barrier. Normal sealed operation has no externally callable
    // controller; clearing these affects development upgrades and any explicit
    // post-recovery upgrade.
    fundingLease += 1;
    fundingBusySince := null;
    fundingSweepsInFlight := 0;
    fundingSweepsSince := null;
    fundingTransfersInFlight := 0;
    payoutLease += 1;
    payoutBusySince := null;
    armWeek<system>();

    // Same reasoning as the week timer, and it matters more here: timers do
    // not survive an upgrade, and a sealed canister has no controller who
    // could restart a stalled distribution by hand. Armed on every start, at
    // the retry interval rather than immediately — an upgrade is often part of
    // fixing whatever broke, and hammering a ledger that was already failing
    // helps nobody.
    switch (Season.current(db())) {
        case (?season) {
            if (season.phase == #finished) {
                fundingClosing := true;
                if (not season.fundingReady) {
                    let graceEnds = season.endedAt + FUNDING_GRACE;
                    if (fundingRetryAt == 0) {
                        fundingRetryAt := if (season.fundingAttempts == 0) now()
                            else fundingRetryDeadline(now(), graceEnds);
                    };
                    armFundingAt<system>(fundingRetryAt);
                } else if (season.payout != #paid and season.payout != #failed) {
                    if (payoutRetryAt == 0) {
                        payoutRetryAt := nanosAfter(RETRY_EVERY * 60);
                    };
                    armPayoutAt<system>(payoutRetryAt);
                };
            };
        };
        case null {};
    };
};
