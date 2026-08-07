/// Sealing controller authority into this canister's installed code.
///
/// A canister with an external controller is a canister that person or canister
/// can rewrite. Sealing removes every external controller but keeps this
/// canister itself as the sole controller. No ingress caller can impersonate a
/// canister principal, so controller authority is then limited to the paths
/// explicitly installed in this code.
///
/// ## The one installed recovery path
///
/// The only method that changes that self-only list has no controller argument:
/// after three distinct current moderators approve it, the actor adds the
/// fixed Neutrinite DAO principal below. That visibly ends the sealed state and
/// gives the DAO ordinary controller authority, including upgrades and setting
/// changes. There is no generic controller setter in this module.
///
/// ## Why the canister does it rather than a human
///
/// A human must not reduce the list themselves with a CLI call. That would
/// bypass the canister's durable launch latch, and `start_season` deliberately
/// fails closed in that irreparable state. Routing the transition through this
/// code ties the externally visible self-only controller list to the frozen
/// launch manifest that was actually checked before sealing.

import Principal "mo:core/Principal";

module {

    /// The only external controller this installed code can add.
    public let NEUTRINITE_DAO_TEXT = "extk7-gaaaa-aaaaq-aacda-cai";
    public func recoveryController() : Principal {
        Principal.fromText(NEUTRINITE_DAO_TEXT);
    };

    /// The slice of the management canister this needs.
    ///
    /// Declared narrowly on purpose rather than mirroring `ic.did`: the
    /// settings record grows between replica versions, and while Candid ignores
    /// extra fields the *callee* sends, a field we declare and the replica does
    /// not send fails to decode. The small shape is the stable one.
    ///
    /// `canister_status` is annotated `query` in `ic.did`, which applies to
    /// ingress reads. An inter-canister call from an update context must be
    /// replicated, so it is a plain `shared` method here.
    public type Settings = { controllers : ?[Principal] };

    public type Management = actor {
        canister_status : shared { canister_id : Principal } -> async {
            settings : { controllers : [Principal] };
        };
        update_settings : shared {
            canister_id : Principal;
            settings : Settings;
        } -> async ();
    };

    public let IC : Management = actor ("aaaaa-aa");

    /// Who controls this canister right now.
    ///
    /// Needs no privilege at all, which is what makes it useful as a public
    /// check. The interface spec allows a canister to ask for its own status —
    /// the condition is `M.caller ∈ S.controllers[A.canister_id] ∪
    /// {A.canister_id}` — and the replica carries an explicit self-exemption.
    /// So this keeps answering after the list is empty, which is exactly when
    /// somebody wants to ask.
    public func current(me : Principal) : async* ?[Principal] {
        try {
            let status = await IC.canister_status({ canister_id = me });
            ?status.settings.controllers;
        } catch (_) { null };
    };

    /// Exactly the self-only controller state that the rules call sealed.
    public func isSealed(me : Principal, held : [Principal]) : Bool {
        held.size() == 1 and held[0] == me;
    };

    /// The exact state after the fixed DAO recovery has completed.
    public func isRecovered(me : Principal, held : [Principal]) : Bool {
        if (held.size() != 2) return false;
        var self = false;
        var dao = false;
        let recovery = recoveryController();
        for (who in held.vals()) {
            if (who == me) self := true;
            if (who == recovery) dao := true;
        };
        self and dao;
    };

    public func sealed(me : Principal) : async* Bool {
        switch (await* current(me)) {
            case (?held) isSealed(me, held);
            case null false;
        };
    };

    /// Remove every external controller and retain this canister alone.
    ///
    /// The canister must currently be one of its own controllers, because
    /// `update_settings` has no self-exemption — reading your own status is
    /// unprivileged, changing your own settings is not. A human adds it once,
    /// by hand, during setup.
    ///
    /// Answers `false` rather than trapping on every failure. A trap here would
    /// roll the call back, which is harmless, but the caller deserves a plain
    /// answer to "did it happen" — and the honest answer is available by asking
    /// `sealed` afterwards, which is what a caller should do anyway.
    public func seal(me : Principal) : async* Bool {
        let ?held = await* current(me) else return false;
        if (isSealed(me, held)) return true;

        var self = false;
        for (who in held.vals()) { if (who == me) self := true };
        if (not self) return false;

        try {
            await IC.update_settings({
                canister_id = me;
                settings = { controllers = ?[me] };
            });
            true;
        } catch (_) { false };
    };

    /// Add the one fixed emergency controller while retaining self-control.
    ///
    /// The actor checks moderator quorum before calling this helper. Rechecking
    /// exact self-only state here makes the settings write fail closed if
    /// another controller change raced that quorum.
    public func recover(me : Principal) : async* Bool {
        let ?held = await* current(me) else return false;
        if (isRecovered(me, held)) return true;
        if (not isSealed(me, held)) return false;
        let recovery = recoveryController();

        try {
            await IC.update_settings({
                canister_id = me;
                settings = { controllers = ?[me, recovery] };
            });
            true;
        } catch (_) { false };
    };
};
