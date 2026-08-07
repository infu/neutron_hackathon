/// What each participant costs us, and the lever to stop one who costs too
/// much.
///
/// A canister pays for every instruction it executes and every byte it holds,
/// and both are spent on behalf of whoever made the call. Without a per-person
/// figure the only visible number is the total, which tells you that something
/// is wrong and nothing about who.
///
/// ## Using it
///
/// Two lines in a user-callable update, and nothing else anywhere:
///
/// ```motoko
/// public shared ({ caller }) func submit_entry(input : Season.EntryInput) : async R {
///     let ?m = Meter.open(db(), caller) else return #err(#Frozen);
///     Meter.close(m, Season.submit(db(), caller, input, now()));
/// };
/// ```
///
/// `open` is the frozen check *and* the starting reading; `close` charges what
/// the body cost and hands its result straight back. Because the body is the
/// argument to `close`, a call that fails validation is charged exactly like
/// one that succeeds — which matters, since a flood of rejected calls costs
/// the canister just as much as a flood of accepted ones.
///
/// ## Why the counters are cumulative and never reset
///
/// This is an accounting record, not a rate limiter. A rate limiter answers
/// "is this call allowed right now"; these answer "who has been expensive",
/// which is a question about the whole event. Resetting would erase exactly
/// the history a moderator is looking for.
///
/// ## Freezing
///
/// A frozen user still reads everything — the site is public and their profile
/// stays put. What stops is *writing*, so they cannot spend more of the
/// canister's cycles than the query traffic anyone gets for free.
///
/// Deliberately not a ban: reversible, leaves the record intact, and says
/// nothing about the person. It answers "this account is burning the budget",
/// which is sometimes a script and sometimes a bug in somebody's client.

import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import IC "mo:core/InternetComputer";

import Ashroot "../.ashroot/lib";
import Profiles "./Profiles";

module {

    public type User = Ashroot.Types.User;

    /// An open measurement. Carries what `close` needs so a call site does not.
    public type Session = {
        db : Ashroot.DB;
        caller : Principal;
        from : Nat64;
    };

    /// Start measuring, unless this caller is frozen.
    ///
    /// `null` means frozen, so the guard is the `else` of a `let ?m = …` and
    /// each method answers with its own error type.
    ///
    /// An unregistered caller is *not* frozen — there is no row to freeze, and
    /// `register` has to be reachable. It is also not charged, for the same
    /// reason: the row that would be charged is the one being created.
    public func open(db : Ashroot.DB, caller : Principal) : ?Session {
        switch (rowOf(db, caller)) {
            case (?user) if (user.frozen) return null;
            case null {};
        };
        // Counter 1, not 0. Counter 0 resets at every `await`, so on anything
        // that talks to a ledger it would report only the fragment after the
        // last suspension. Counter 1 is the whole call context.
        ?{ db; caller; from = IC.performanceCounter(1) };
    };

    /// Charge what the body cost and return whatever it produced.
    ///
    /// Crossing the cap freezes the account here, in the same write that
    /// records the spend. A separate sweep would leave a window where the
    /// budget is already gone and the next call is still allowed — and the
    /// calls that matter are the ones arriving faster than any sweep.
    ///
    /// This call still finishes. Refusing work already done would charge for
    /// it and throw it away; the freeze applies from the *next* call, which is
    /// where `open` sees it.
    public func close<T>(session : Session, result : T) : T {
        let ?user = rowOf(session.db, session.caller) else return result;
        let now = IC.performanceCounter(1);
        // Monotonic within a call, but do not assume it: a subtraction that
        // trapped here would take down an otherwise successful update.
        let spent = if (now > session.from) Nat64.toNat(now - session.from) else 0;
        let total = user.instructions + spent;
        let cap = session.db.store.get().instructionCap;
        // Never a moderator, for the same reason `thaw` exists and its
        // opposite does not: one runaway script in a moderator's client would
        // take the event's moderation offline.
        let over = cap > 0 and total >= cap and not user.moderator;
        switch (session.db.users.update({
            user with instructions = total; frozen = user.frozen or over
        })) {
            case (#ok(_)) {};
            // The metered body may already have changed application state.
            // Returning success while dropping its accounting write creates a
            // durable partial update, so roll the message back instead.
            case (#err(_)) Runtime.trap("could not record metered instruction use");
        };
        result;
    };

    /// What this account has spent, and what it is allowed.
    ///
    /// The pair rather than a percentage, so the caller decides how to render
    /// it — and so a cap of zero, meaning no cap at all, stays visible as such
    /// instead of becoming a division by zero.
    public func allowance(db : Ashroot.DB, user : User) : { used : Nat; cap : Nat } {
        { used = user.instructions; cap = db.store.get().instructionCap };
    };

    /// Move a user's fixed-slot storage tally. Callers pass the allocator's
    /// slot charge, not the shorter payload length: this is the capacity each
    /// file actually consumes. Negative deltas saturate at zero — the store is
    /// the truth for what exists, and a tally that traps is worse than a tally
    /// that is briefly low.
    public func bytes(db : Ashroot.DB, caller : Principal, added : Nat, removed : Nat) {
        let ?user = rowOf(db, caller) else return;
        charge(db, user.id, added, removed);
    };

    /// The same, for storage the canister moves on somebody's behalf.
    ///
    /// A moderator approving a revision deletes the build it replaced, and
    /// those bytes belong to the author's tally, not the moderator's — so the
    /// caller is the wrong thing to key on and there is no principal to hand in
    /// anyway. Without this the allowance counts slots that are gone.
    public func charge(db : Ashroot.DB, userId : Nat64, added : Nat, removed : Nat) {
        let ?user = db.users.get(userId) else return;
        let held = user.bytes + added;
        switch (db.users.update({ user with bytes = if (held > removed) Nat.sub(held, removed) else 0 })) {
            case (#ok(_)) {};
            case (#err(_)) Runtime.trap("could not record asset byte use");
        };
    };

    /// Let an account write again, and optionally give its allowance back.
    ///
    /// **[decided]** Moderators thaw; they do not freeze. Freezing is what the
    /// meter does when an account crosses its allowance — a measurement, not a
    /// judgement, and one nobody can argue with. Handing moderators the other
    /// half would make "frozen" mean two things at once: out of budget, or out
    /// of favour. A moderator who wants somebody stopped has moderation for
    /// that. What they need here is the power to say "that was a bug in their
    /// client, let them back in".
    ///
    /// `reset` clears the spend too. Without it, thawing an account that is
    /// over the cap lasts exactly one call.
    public func thaw(db : Ashroot.DB, handle : Text, reset : Bool) : Result.Result<User, Text> {
        let ?pk = db.users.byHandle.locate(handle) else return #err("no such handle");
        let ?user = db.users.get(pk) else return #err("no such handle");
        switch (
            db.users.update({
                user with frozen = false; instructions = if (reset) 0 else user.instructions
            })
        ) {
            case (#ok(updated)) #ok(updated);
            case (#err(_)) #err("could not update that user");
        };
    };

    public type Order = { #instructions; #bytes };

    /// The most expensive participants first.
    ///
    /// Straight off the index in reverse, so it costs the page and not the
    /// table. No cursor: this is a leaderboard of the worst offenders, and
    /// nobody pages to the cheap end of one.
    public func costliest(db : Ashroot.DB, order : Order, limit : Nat) : [User] {
        let range = { gt = null; gte = null; lt = null; lte = null; dir = #bwd };
        let rows = switch (order) {
            case (#instructions) db.users.byInstructions.rangeIter(range, null);
            case (#bytes) db.users.byBytes.rangeIter(range, null);
        };
        var out : [User] = [];
        label scan for (user in rows) {
            if (out.size() >= limit) break scan;
            out := Array.concat(out, [user]);
        };
        out;
    };

    /// The account a call is charged to.
    ///
    /// **`Profiles.byPrincipal`, never the raw index.** This used to reach for
    /// `db.users.byPrincipal` directly, which does not resolve a nominated
    /// agent — and every other layer does. The result was a hole rather than an
    /// inconsistency: an agent's calls found no row, so `open` never saw a
    /// freeze and `close` never charged anything, while `Review` and `Season`
    /// resolved the same principal perfectly well and did the work. An account
    /// could nominate an agent and then submit, upload and vote for free, for
    /// ever, including after it had been frozen.
    ///
    /// The lesson is the general one: two places that resolve "who is calling"
    /// have to be the same function, not the same idea.
    func rowOf(db : Ashroot.DB, caller : Principal) : ?User {
        Profiles.byPrincipal(db, caller);
    };
};
