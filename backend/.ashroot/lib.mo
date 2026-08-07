/*
  The database facade used throughout the backend.

  It gathers stable tables, query helpers, relationships, and singleton
  settings behind one typed API. Domain code should enter through this module
  instead of assembling storage pieces ad hoc.
*/
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";

import UsersTable "./tables/users";
import ActionsTable "./tables/actions";
import SeasonsTable "./tables/seasons";
import EntriesTable "./tables/entries";
import VotesTable "./tables/votes";
import PayoutsTable "./tables/payouts";
import RevisionsTable "./tables/revisions";
import NoticesTable "./tables/notices";
import ApprovalsTable "./tables/approvals";

import UsersQueries "./queries/users";
import ActionsQueries "./queries/actions";
import SeasonsQueries "./queries/seasons";
import EntriesQueries "./queries/entries";
import VotesQueries "./queries/votes";
import PayoutsQueries "./queries/payouts";
import RevisionsQueries "./queries/revisions";
import NoticesQueries "./queries/notices";
import ApprovalsQueries "./queries/approvals";

import StoreModule "./store";
import CursorCore "mo:ashroot/cursors";
import IndexHelpers "mo:ashroot/index_core";

module {
  public module Types {
    public let Users = UsersTable.Types;
    public type User = Users.User;
    public type CreateUser = Users.CreateUser;

    public let Actions = ActionsTable.Types;
    public type Action = Actions.Action;
    public type CreateAction = Actions.CreateAction;

    public let Seasons = SeasonsTable.Types;
    public type Season = Seasons.Season;
    public type CreateSeason = Seasons.CreateSeason;

    public let Entries = EntriesTable.Types;
    public type Entry = Entries.Entry;
    public type CreateEntry = Entries.CreateEntry;

    public let Votes = VotesTable.Types;
    public type Vote = Votes.Vote;
    public type CreateVote = Votes.CreateVote;

    public let Payouts = PayoutsTable.Types;
    public type Payout = Payouts.Payout;
    public type CreatePayout = Payouts.CreatePayout;

    public let Revisions = RevisionsTable.Types;
    public type Revision = Revisions.Revision;
    public type CreateRevision = Revisions.CreateRevision;

    public let Notices = NoticesTable.Types;
    public type Notice = Notices.Notice;
    public type CreateNotice = Notices.CreateNotice;

    public let Approvals = ApprovalsTable.Types;
    public type Approval = Approvals.Approval;
    public type CreateApproval = Approvals.CreateApproval;

    public let Store = StoreModule.Types;
    public type Store = StoreModule.Types.Store;
    public type StoreAccess = StoreModule.StoreAccess;
  };

  public let Users = UsersTable;
  public let Actions = ActionsTable;
  public let Seasons = SeasonsTable;
  public let Entries = EntriesTable;
  public let Votes = VotesTable;
  public let Payouts = PayoutsTable;
  public let Revisions = RevisionsTable;
  public let Notices = NoticesTable;
  public let Approvals = ApprovalsTable;

  public module Errors {
    public type Error = UsersTable.Errors.Error;
    public type UserError = UsersTable.Errors.Error;
    public type ActionError = ActionsTable.Errors.Error;
    public type SeasonError = SeasonsTable.Errors.Error;
    public type EntryError = EntriesTable.Errors.Error;
    public type VoteError = VotesTable.Errors.Error;
    public type PayoutError = PayoutsTable.Errors.Error;
    public type RevisionError = RevisionsTable.Errors.Error;
    public type NoticeError = NoticesTable.Errors.Error;
    public type ApprovalError = ApprovalsTable.Errors.Error;
  };

  public let Cursors = CursorCore;
  public let Index = IndexHelpers;
  public let Store = StoreModule;

  public module Queries {
    public let Users = UsersQueries;

    public let Actions = ActionsQueries;

    public let Seasons = SeasonsQueries;

    public let Entries = EntriesQueries;

    public let Votes = VotesQueries;

    public let Payouts = PayoutsQueries;

    public let Revisions = RevisionsQueries;

    public let Notices = NoticesQueries;

    public let Approvals = ApprovalsQueries;
  };

  public module AshQL {
    public type Query = {
      #users : Queries.Users.Query;
      #actions : Queries.Actions.Query;
      #seasons : Queries.Seasons.Query;
      #entries : Queries.Entries.Query;
      #votes : Queries.Votes.Query;
      #payouts : Queries.Payouts.Query;
      #revisions : Queries.Revisions.Query;
      #notices : Queries.Notices.Query;
      #approvals : Queries.Approvals.Query;
    };

    public type Result = {
      #users : Queries.Users.Result;
      #actions : Queries.Actions.Result;
      #seasons : Queries.Seasons.Result;
      #entries : Queries.Entries.Result;
      #votes : Queries.Votes.Result;
      #payouts : Queries.Payouts.Result;
      #revisions : Queries.Revisions.Result;
      #notices : Queries.Notices.Result;
      #approvals : Queries.Approvals.Result;
    };
  };

  public type Mem = {
    users : UsersTable.Init;
    actions : ActionsTable.Init;
    seasons : SeasonsTable.Init;
    entries : EntriesTable.Init;
    votes : VotesTable.Init;
    payouts : PayoutsTable.Init;
    revisions : RevisionsTable.Init;
    notices : NoticesTable.Init;
    approvals : ApprovalsTable.Init;
    store : StoreModule.Init;
  };

  public func Mem() : Mem {
    {
      users = UsersTable.init();
      actions = ActionsTable.init();
      seasons = SeasonsTable.init();
      entries = EntriesTable.init();
      votes = VotesTable.init();
      payouts = PayoutsTable.init();
      revisions = RevisionsTable.init();
      notices = NoticesTable.init();
      approvals = ApprovalsTable.init();
      store = StoreModule.init();
    };
  };

  public type Transaction = {
    start : () -> ();
    commit : () -> Result.Result<(), Errors.Error>;
    discard : () -> ();
  };

  public type DB = {
    users : UsersTable.Use;
    actions : ActionsTable.Use;
    seasons : SeasonsTable.Use;
    entries : EntriesTable.Use;
    votes : VotesTable.Use;
    payouts : PayoutsTable.Use;
    revisions : RevisionsTable.Use;
    notices : NoticesTable.Use;
    approvals : ApprovalsTable.Use;
    store : StoreModule.Use;
    ashql : AshQL.Query -> AshQL.Result;
    transaction : Transaction;
  };

  public module Stats {
    public type Index = { name : Text; size : Nat };
    public type Table = { name : Text; rows : Nat; indexes : [Index] };
    public type Snapshot = {
      tables : [Table];
      totalRows : Nat;
      totalIndexEntries : Nat;
    };

    public func collect(db : DB) : Snapshot {
      var totalRows : Nat = 0;
      var totalIndexEntries : Nat = 0;
      let tables : [Table] = [
        {
          name = "users";
          rows = db.users.size();
          indexes = [
            {
              name = "byPrincipal";
              size = db.users.byPrincipal.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byHandle";
              size = db.users.byHandle.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byCreated";
              size = db.users.byCreated.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byHackerHandle";
              size = db.users.byHackerHandle.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byObserverHandle";
              size = db.users.byObserverHandle.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byModeratorHandle";
              size = db.users.byModeratorHandle.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byJudgeHandle";
              size = db.users.byJudgeHandle.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "bySponsorHandle";
              size = db.users.bySponsorHandle.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byInstructions";
              size = db.users.byInstructions.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byBytes";
              size = db.users.byBytes.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byAgent";
              size = db.users.byAgent.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
          ];
        },
        {
          name = "actions";
          rows = db.actions.size();
          indexes = [
            {
              name = "bySubject";
              size = db.actions.bySubject.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byActor";
              size = db.actions.byActor.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byTime";
              size = db.actions.byTime.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
          ];
        },
        {
          name = "seasons";
          rows = db.seasons.size();
          indexes = [
            {
              name = "byNumber";
              size = db.seasons.byNumber.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byRunning";
              size = db.seasons.byRunning.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
          ];
        },
        {
          name = "entries";
          rows = db.entries.size();
          indexes = [
            {
              name = "bySlot";
              size = db.entries.bySlot.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byRank";
              size = db.entries.byRank.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byUser";
              size = db.entries.byUser.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "bySeason";
              size = db.entries.bySeason.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "bySlug";
              size = db.entries.bySlug.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
          ];
        },
        {
          name = "votes";
          rows = db.votes.size();
          indexes = [
            {
              name = "byJudgeEntry";
              size = db.votes.byJudgeEntry.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byJudgeWeek";
              size = db.votes.byJudgeWeek.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byEntry";
              size = db.votes.byEntry.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byJudge";
              size = db.votes.byJudge.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
          ];
        },
        {
          name = "payouts";
          rows = db.payouts.size();
          indexes = [
            {
              name = "bySlot";
              size = db.payouts.bySlot.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "bySeason";
              size = db.payouts.bySeason.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byUser";
              size = db.payouts.byUser.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
          ];
        },
        {
          name = "revisions";
          rows = db.revisions.size();
          indexes = [
            {
              name = "byQueue";
              size = db.revisions.byQueue.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byUser";
              size = db.revisions.byUser.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "bySlot";
              size = db.revisions.bySlot.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
          ];
        },
        {
          name = "notices";
          rows = db.notices.size();
          indexes = [
            {
              name = "byTime";
              size = db.notices.byTime.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "byReporter";
              size = db.notices.byReporter.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
          ];
        },
        {
          name = "approvals";
          rows = db.approvals.size();
          indexes = [
            {
              name = "bySlot";
              size = db.approvals.bySlot.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
            {
              name = "bySubject";
              size = db.approvals.bySubject.countInRange({ gt = null; gte = null; lt = null; lte = null; dir = #fwd }, null);
            },
          ];
        },
      ];
      for (table in tables.vals()) {
        totalRows += table.rows;
        for (idx in table.indexes.vals()) {
          totalIndexEntries += idx.size;
        };
      };
      { tables; totalRows; totalIndexEntries };
    };
  };

  public module Migration {
    public type Handlers = {
      users : (Iter.Iter<(Nat64, Types.User)>) -> ();
      actions : (Iter.Iter<(Nat64, Types.Action)>) -> ();
      seasons : (Iter.Iter<(Nat64, Types.Season)>) -> ();
      entries : (Iter.Iter<(Nat64, Types.Entry)>) -> ();
      votes : (Iter.Iter<(Nat64, Types.Vote)>) -> ();
      payouts : (Iter.Iter<(Nat64, Types.Payout)>) -> ();
      revisions : (Iter.Iter<(Nat64, Types.Revision)>) -> ();
      notices : (Iter.Iter<(Nat64, Types.Notice)>) -> ();
      approvals : (Iter.Iter<(Nat64, Types.Approval)>) -> ();
      store : (StoreModule.Use) -> ();
    };

    public func forEach(db : DB, handlers : Handlers) : () {
      handlers.users(db.users.iterPrimary(#fwd, null));
      handlers.actions(db.actions.iterPrimary(#fwd, null));
      handlers.seasons(db.seasons.iterPrimary(#fwd, null));
      handlers.entries(db.entries.iterPrimary(#fwd, null));
      handlers.votes(db.votes.iterPrimary(#fwd, null));
      handlers.payouts(db.payouts.iterPrimary(#fwd, null));
      handlers.revisions(db.revisions.iterPrimary(#fwd, null));
      handlers.notices(db.notices.iterPrimary(#fwd, null));
      handlers.approvals(db.approvals.iterPrimary(#fwd, null));
      handlers.store(db.store);
    };
  };

  public func Use(mem : Mem, storeDefaults : StoreModule.Types.Store) : DB {
    let usersBundle = UsersTable.use(mem.users);
    let actionsBundle = ActionsTable.use(mem.actions);
    let seasonsBundle = SeasonsTable.use(mem.seasons);
    let entriesBundle = EntriesTable.use(mem.entries);
    let votesBundle = VotesTable.use(mem.votes);
    let payoutsBundle = PayoutsTable.use(mem.payouts);
    let revisionsBundle = RevisionsTable.use(mem.revisions);
    let noticesBundle = NoticesTable.use(mem.notices);
    let approvalsBundle = ApprovalsTable.use(mem.approvals);
    StoreModule.ensure(mem.store, storeDefaults);
    let storeUse = StoreModule.use(mem.store);

    let usersBase = usersBundle.table;
    let actionsBase = actionsBundle.table;
    let seasonsBase = seasonsBundle.table;
    let entriesBase = entriesBundle.table;
    let votesBase = votesBundle.table;
    let payoutsBase = payoutsBundle.table;
    let revisionsBase = revisionsBundle.table;
    let noticesBase = noticesBundle.table;
    let approvalsBase = approvalsBundle.table;

    let usersManagers = usersBundle.relations.foreignKeys;
    let usersManagerControllers = usersBundle.relationsInternal.foreignKeys;
    let actionsManagers = actionsBundle.relations.foreignKeys;
    let actionsManagerControllers = actionsBundle.relationsInternal.foreignKeys;
    let seasonsManagers = seasonsBundle.relations.foreignKeys;
    let seasonsManagerControllers = seasonsBundle.relationsInternal.foreignKeys;
    let entriesManagers = entriesBundle.relations.foreignKeys;
    let entriesManagerControllers = entriesBundle.relationsInternal.foreignKeys;
    let votesManagers = votesBundle.relations.foreignKeys;
    let votesManagerControllers = votesBundle.relationsInternal.foreignKeys;
    let payoutsManagers = payoutsBundle.relations.foreignKeys;
    let payoutsManagerControllers = payoutsBundle.relationsInternal.foreignKeys;
    let revisionsManagers = revisionsBundle.relations.foreignKeys;
    let revisionsManagerControllers = revisionsBundle.relationsInternal.foreignKeys;
    let noticesManagers = noticesBundle.relations.foreignKeys;
    let noticesManagerControllers = noticesBundle.relationsInternal.foreignKeys;
    let approvalsManagers = approvalsBundle.relations.foreignKeys;
    let approvalsManagerControllers = approvalsBundle.relationsInternal.foreignKeys;

    let actionsManagers_for_users = Array.filter<ActionsTable.ForeignKeyManager>(
      actionsManagers,
      func(manager : ActionsTable.ForeignKeyManager) : Bool {
        manager.parentTable == "users";
      },
    );
    let actionsManagers_for_users_controllers = Array.filter<ActionsTable.ForeignKeyRuntime>(
      actionsManagerControllers,
      func(manager : ActionsTable.ForeignKeyRuntime) : Bool {
        manager.parentTable == "users";
      },
    );
    let entriesManagers_for_seasons = Array.filter<EntriesTable.ForeignKeyManager>(
      entriesManagers,
      func(manager : EntriesTable.ForeignKeyManager) : Bool {
        manager.parentTable == "seasons";
      },
    );
    let entriesManagers_for_seasons_controllers = Array.filter<EntriesTable.ForeignKeyRuntime>(
      entriesManagerControllers,
      func(manager : EntriesTable.ForeignKeyRuntime) : Bool {
        manager.parentTable == "seasons";
      },
    );
    let entriesManagers_for_users = Array.filter<EntriesTable.ForeignKeyManager>(
      entriesManagers,
      func(manager : EntriesTable.ForeignKeyManager) : Bool {
        manager.parentTable == "users";
      },
    );
    let entriesManagers_for_users_controllers = Array.filter<EntriesTable.ForeignKeyRuntime>(
      entriesManagerControllers,
      func(manager : EntriesTable.ForeignKeyRuntime) : Bool {
        manager.parentTable == "users";
      },
    );
    let votesManagers_for_entries = Array.filter<VotesTable.ForeignKeyManager>(
      votesManagers,
      func(manager : VotesTable.ForeignKeyManager) : Bool {
        manager.parentTable == "entries";
      },
    );
    let votesManagers_for_entries_controllers = Array.filter<VotesTable.ForeignKeyRuntime>(
      votesManagerControllers,
      func(manager : VotesTable.ForeignKeyRuntime) : Bool {
        manager.parentTable == "entries";
      },
    );
    let votesManagers_for_users = Array.filter<VotesTable.ForeignKeyManager>(
      votesManagers,
      func(manager : VotesTable.ForeignKeyManager) : Bool {
        manager.parentTable == "users";
      },
    );
    let votesManagers_for_users_controllers = Array.filter<VotesTable.ForeignKeyRuntime>(
      votesManagerControllers,
      func(manager : VotesTable.ForeignKeyRuntime) : Bool {
        manager.parentTable == "users";
      },
    );

    func wrapUser(use : UsersTable.Use, managers : [UsersTable.ForeignKeyManager]) : UsersTable.Use {
      var wrapped : UsersTable.Use = use;

      let base = wrapped;
      func applyPolicies(pk : Nat64) : Result.Result<(), UsersTable.Errors.Error> {
        for (manager in actionsManagers_for_users_controllers.vals()) {
          switch (manager.onDelete) {
            case (#restrict) {
              let dependents = manager.countDependents(pk);
              if (dependents > 0) {
                let msg = "restrict violation on actions." # manager.field # " for users.id " # Nat64.toText(pk) # " (" # Nat.toText(dependents) # " dependents)";
                return #err(#Internal(msg));
              };
            };
            case (#cascade) {
              switch (manager.deleteDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "cascade delete via actions." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
            case (#setNull) {
              switch (manager.setNullDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "setNull via actions." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
          };
        };
        for (manager in entriesManagers_for_users_controllers.vals()) {
          switch (manager.onDelete) {
            case (#restrict) {
              let dependents = manager.countDependents(pk);
              if (dependents > 0) {
                let msg = "restrict violation on entries." # manager.field # " for users.id " # Nat64.toText(pk) # " (" # Nat.toText(dependents) # " dependents)";
                return #err(#Internal(msg));
              };
            };
            case (#cascade) {
              switch (manager.deleteDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "cascade delete via entries." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
            case (#setNull) {
              switch (manager.setNullDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "setNull via entries." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
          };
        };
        for (manager in votesManagers_for_users_controllers.vals()) {
          switch (manager.onDelete) {
            case (#restrict) {
              let dependents = manager.countDependents(pk);
              if (dependents > 0) {
                let msg = "restrict violation on votes." # manager.field # " for users.id " # Nat64.toText(pk) # " (" # Nat.toText(dependents) # " dependents)";
                return #err(#Internal(msg));
              };
            };
            case (#cascade) {
              switch (manager.deleteDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "cascade delete via votes." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
            case (#setNull) {
              switch (manager.setNullDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "setNull via votes." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
          };
        };
        #ok();
      };

      func deleteWithPolicies(pk : Nat64) : Result.Result<(), UsersTable.Errors.Error> {
        switch (applyPolicies(pk)) {
          case (#ok()) { base.delete(pk) };
          case (#err(e)) #err(e);
        };
      };

      func deleteManyWithPolicies(ids : [Nat64]) : Result.Result<Nat, UsersTable.Errors.Error> {
        var removed : Nat = 0;
        for (id in ids.vals()) {
          switch (deleteWithPolicies(id)) {
            case (#ok()) { removed += 1 };
            case (#err(e)) { return #err(e) };
          };
        };
        #ok(removed);
      };

      func wrapIndexOps<K>(ops : UsersTable.IndexOps<K>) : UsersTable.IndexOps<K> {
        {
          descriptor = ops.descriptor;
          find = ops.find;
          rangeDelete = func(range : UsersTable.IndexRange<K>, limit : Nat, cursor : ?CursorCore.Token) : Result.Result<UsersTable.RangeDeleteResult, UsersTable.Errors.Error> {
            if (limit == 0) {
              return #ok({ deleted = 0; cursor = null; hasMore = false });
            };
            ignore cursor;
            let iter = ops.rangeIter(range, null);
            let staged = List.empty<Nat64>();
            var processed : Nat = 0;
            var hasMore = false;
            label collect while (processed < limit) {
              switch (iter.next()) {
                case null { break collect };
                case (?row) {
                  List.add(staged, row.id);
                  processed += 1;
                };
              };
            };
            if (processed == limit) {
              switch (iter.next()) {
                case (?_) { hasMore := true };
                case null {};
              };
            };
            var deleted : Nat = 0;
            for (pk in List.values(staged)) {
              switch (deleteWithPolicies(pk)) {
                case (#ok()) { deleted += 1 };
                case (#err(e)) { return #err(e) };
              };
            };
            return #ok({ deleted; cursor = null; hasMore });
          };
          exists = ops.exists;
          locate = ops.locate;
          countInRange = ops.countInRange;
          size = ops.size;
          rangeIter = ops.rangeIter;
          mapRange = ops.mapRange;
          foldRange = ops.foldRange;
        };
      };

      func wrapTextIndexOps(ops : UsersTable.TextIndexOps) : UsersTable.TextIndexOps {
        {
          descriptor = ops.descriptor;
          find = ops.find;
          rangeDelete = func(range : UsersTable.IndexRange<Text>, limit : Nat, cursor : ?CursorCore.Token) : Result.Result<UsersTable.RangeDeleteResult, UsersTable.Errors.Error> {
            if (limit == 0) {
              return #ok({ deleted = 0; cursor = null; hasMore = false });
            };
            ignore cursor;
            let iter = ops.rangeIter(range, null);
            let staged = List.empty<Nat64>();
            var processed : Nat = 0;
            var hasMore = false;
            label collect while (processed < limit) {
              switch (iter.next()) {
                case null { break collect };
                case (?row) {
                  List.add(staged, row.id);
                  processed += 1;
                };
              };
            };
            if (processed == limit) {
              switch (iter.next()) {
                case (?_) { hasMore := true };
                case null {};
              };
            };
            var deleted : Nat = 0;
            for (pk in List.values(staged)) {
              switch (deleteWithPolicies(pk)) {
                case (#ok()) { deleted += 1 };
                case (#err(e)) { return #err(e) };
              };
            };
            return #ok({ deleted; cursor = null; hasMore });
          };
          exists = ops.exists;
          locate = ops.locate;
          countInRange = ops.countInRange;
          size = ops.size;
          rangeIter = ops.rangeIter;
          mapRange = ops.mapRange;
          foldRange = ops.foldRange;
          prefixFind = ops.prefixFind;
        };
      };

      wrapped := { wrapped with delete = deleteWithPolicies };
      wrapped := { wrapped with deleteMany = deleteManyWithPolicies };
      wrapped := {
        wrapped with byPrincipal = wrapIndexOps<Principal>(base.byPrincipal)
      };
      wrapped := { wrapped with byHandle = wrapTextIndexOps(base.byHandle) };
      wrapped := {
        wrapped with byCreated = wrapIndexOps<Nat64>(base.byCreated)
      };
      wrapped := {
        wrapped with byHackerHandle = wrapTextIndexOps(base.byHackerHandle)
      };
      wrapped := {
        wrapped with byObserverHandle = wrapTextIndexOps(base.byObserverHandle)
      };
      wrapped := {
        wrapped with byModeratorHandle = wrapTextIndexOps(base.byModeratorHandle)
      };
      wrapped := {
        wrapped with byJudgeHandle = wrapIndexOps<(Nat, Text)>(base.byJudgeHandle)
      };
      wrapped := {
        wrapped with bySponsorHandle = wrapIndexOps<(Nat, Text)>(base.bySponsorHandle)
      };
      wrapped := {
        wrapped with byInstructions = wrapIndexOps<Nat>(base.byInstructions)
      };
      wrapped := { wrapped with byBytes = wrapIndexOps<Nat>(base.byBytes) };
      wrapped := {
        wrapped with byAgent = wrapIndexOps<Principal>(base.byAgent)
      };
      wrapped;
    };

    func wrapAction(use : ActionsTable.Use, managers : [ActionsTable.ForeignKeyManager]) : ActionsTable.Use {
      var wrapped : ActionsTable.Use = use;
      if (Array.size(managers) > 0) {
        let base = wrapped;
        func validateCreate(record : ActionsTable.Types.CreateAction) : Result.Result<(), ActionsTable.Errors.Error> {
          for (manager in managers.vals()) {
            switch (manager.validateCreate(record)) {
              case (#ok()) {};
              case (#err(e)) { return #err(e) };
            };
          };
          #ok();
        };

        func validateDoc(doc : ActionsTable.Types.Action) : Result.Result<(), ActionsTable.Errors.Error> {
          for (manager in managers.vals()) {
            switch (manager.validateDoc(doc)) {
              case (#ok()) {};
              case (#err(e)) { return #err(e) };
            };
          };
          #ok();
        };

        wrapped := {
          wrapped with insert = func(record : ActionsTable.Types.CreateAction) : Result.Result<Nat64, ActionsTable.Errors.Error> {
            switch (validateCreate(record)) {
              case (#ok()) { base.insert(record) };
              case (#err(e)) #err(e);
            };
          };
        };
        wrapped := {
          wrapped with insertMany = func(records : [ActionsTable.Types.CreateAction]) : Result.Result<[Nat64], ActionsTable.Errors.Error> {
            for (record in records.vals()) {
              switch (validateCreate(record)) {
                case (#ok()) {};
                case (#err(e)) { return #err(e) };
              };
            };
            base.insertMany(records);
          };
        };
        wrapped := {
          wrapped with update = func(doc : ActionsTable.Types.Action) : Result.Result<ActionsTable.Types.Action, ActionsTable.Errors.Error> {
            switch (validateDoc(doc)) {
              case (#ok()) { base.update(doc) };
              case (#err(e)) #err(e);
            };
          };
        };
        wrapped := {
          wrapped with upsert = func(doc : ActionsTable.Types.Action) : Result.Result<{ #inserted; #updated }, ActionsTable.Errors.Error> {
            switch (validateDoc(doc)) {
              case (#ok()) { base.upsert(doc) };
              case (#err(e)) #err(e);
            };
          };
        };
        wrapped := {
          wrapped with upsertMany = func(docs : [ActionsTable.Types.Action]) : Result.Result<{ inserted : Nat; updated : Nat }, ActionsTable.Errors.Error> {
            for (doc in docs.vals()) {
              switch (validateDoc(doc)) {
                case (#ok()) {};
                case (#err(e)) { return #err(e) };
              };
            };
            base.upsertMany(docs);
          };
        };
      };
      wrapped;
    };

    func wrapSeason(use : SeasonsTable.Use, managers : [SeasonsTable.ForeignKeyManager]) : SeasonsTable.Use {
      var wrapped : SeasonsTable.Use = use;

      let base = wrapped;
      func applyPolicies(pk : Nat64) : Result.Result<(), SeasonsTable.Errors.Error> {
        for (manager in entriesManagers_for_seasons_controllers.vals()) {
          switch (manager.onDelete) {
            case (#restrict) {
              let dependents = manager.countDependents(pk);
              if (dependents > 0) {
                let msg = "restrict violation on entries." # manager.field # " for seasons.id " # Nat64.toText(pk) # " (" # Nat.toText(dependents) # " dependents)";
                return #err(#Internal(msg));
              };
            };
            case (#cascade) {
              switch (manager.deleteDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "cascade delete via entries." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
            case (#setNull) {
              switch (manager.setNullDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "setNull via entries." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
          };
        };
        #ok();
      };

      func deleteWithPolicies(pk : Nat64) : Result.Result<(), SeasonsTable.Errors.Error> {
        switch (applyPolicies(pk)) {
          case (#ok()) { base.delete(pk) };
          case (#err(e)) #err(e);
        };
      };

      func deleteManyWithPolicies(ids : [Nat64]) : Result.Result<Nat, SeasonsTable.Errors.Error> {
        var removed : Nat = 0;
        for (id in ids.vals()) {
          switch (deleteWithPolicies(id)) {
            case (#ok()) { removed += 1 };
            case (#err(e)) { return #err(e) };
          };
        };
        #ok(removed);
      };

      func wrapIndexOps<K>(ops : SeasonsTable.IndexOps<K>) : SeasonsTable.IndexOps<K> {
        {
          descriptor = ops.descriptor;
          find = ops.find;
          rangeDelete = func(range : SeasonsTable.IndexRange<K>, limit : Nat, cursor : ?CursorCore.Token) : Result.Result<SeasonsTable.RangeDeleteResult, SeasonsTable.Errors.Error> {
            if (limit == 0) {
              return #ok({ deleted = 0; cursor = null; hasMore = false });
            };
            ignore cursor;
            let iter = ops.rangeIter(range, null);
            let staged = List.empty<Nat64>();
            var processed : Nat = 0;
            var hasMore = false;
            label collect while (processed < limit) {
              switch (iter.next()) {
                case null { break collect };
                case (?row) {
                  List.add(staged, row.id);
                  processed += 1;
                };
              };
            };
            if (processed == limit) {
              switch (iter.next()) {
                case (?_) { hasMore := true };
                case null {};
              };
            };
            var deleted : Nat = 0;
            for (pk in List.values(staged)) {
              switch (deleteWithPolicies(pk)) {
                case (#ok()) { deleted += 1 };
                case (#err(e)) { return #err(e) };
              };
            };
            return #ok({ deleted; cursor = null; hasMore });
          };
          exists = ops.exists;
          locate = ops.locate;
          countInRange = ops.countInRange;
          size = ops.size;
          rangeIter = ops.rangeIter;
          mapRange = ops.mapRange;
          foldRange = ops.foldRange;
        };
      };

      wrapped := { wrapped with delete = deleteWithPolicies };
      wrapped := { wrapped with deleteMany = deleteManyWithPolicies };
      wrapped := { wrapped with byNumber = wrapIndexOps<Nat>(base.byNumber) };
      wrapped := {
        wrapped with byRunning = wrapIndexOps<Nat64>(base.byRunning)
      };
      wrapped;
    };

    func wrapEntry(use : EntriesTable.Use, managers : [EntriesTable.ForeignKeyManager]) : EntriesTable.Use {
      var wrapped : EntriesTable.Use = use;
      if (Array.size(managers) > 0) {
        let base = wrapped;
        func validateCreate(record : EntriesTable.Types.CreateEntry) : Result.Result<(), EntriesTable.Errors.Error> {
          for (manager in managers.vals()) {
            switch (manager.validateCreate(record)) {
              case (#ok()) {};
              case (#err(e)) { return #err(e) };
            };
          };
          #ok();
        };

        func validateDoc(doc : EntriesTable.Types.Entry) : Result.Result<(), EntriesTable.Errors.Error> {
          for (manager in managers.vals()) {
            switch (manager.validateDoc(doc)) {
              case (#ok()) {};
              case (#err(e)) { return #err(e) };
            };
          };
          #ok();
        };

        wrapped := {
          wrapped with insert = func(record : EntriesTable.Types.CreateEntry) : Result.Result<Nat64, EntriesTable.Errors.Error> {
            switch (validateCreate(record)) {
              case (#ok()) { base.insert(record) };
              case (#err(e)) #err(e);
            };
          };
        };
        wrapped := {
          wrapped with insertMany = func(records : [EntriesTable.Types.CreateEntry]) : Result.Result<[Nat64], EntriesTable.Errors.Error> {
            for (record in records.vals()) {
              switch (validateCreate(record)) {
                case (#ok()) {};
                case (#err(e)) { return #err(e) };
              };
            };
            base.insertMany(records);
          };
        };
        wrapped := {
          wrapped with update = func(doc : EntriesTable.Types.Entry) : Result.Result<EntriesTable.Types.Entry, EntriesTable.Errors.Error> {
            switch (validateDoc(doc)) {
              case (#ok()) { base.update(doc) };
              case (#err(e)) #err(e);
            };
          };
        };
        wrapped := {
          wrapped with upsert = func(doc : EntriesTable.Types.Entry) : Result.Result<{ #inserted; #updated }, EntriesTable.Errors.Error> {
            switch (validateDoc(doc)) {
              case (#ok()) { base.upsert(doc) };
              case (#err(e)) #err(e);
            };
          };
        };
        wrapped := {
          wrapped with upsertMany = func(docs : [EntriesTable.Types.Entry]) : Result.Result<{ inserted : Nat; updated : Nat }, EntriesTable.Errors.Error> {
            for (doc in docs.vals()) {
              switch (validateDoc(doc)) {
                case (#ok()) {};
                case (#err(e)) { return #err(e) };
              };
            };
            base.upsertMany(docs);
          };
        };
      };

      let base = wrapped;
      func applyPolicies(pk : Nat64) : Result.Result<(), EntriesTable.Errors.Error> {
        for (manager in votesManagers_for_entries_controllers.vals()) {
          switch (manager.onDelete) {
            case (#restrict) {
              let dependents = manager.countDependents(pk);
              if (dependents > 0) {
                let msg = "restrict violation on votes." # manager.field # " for entries.id " # Nat64.toText(pk) # " (" # Nat.toText(dependents) # " dependents)";
                return #err(#Internal(msg));
              };
            };
            case (#cascade) {
              switch (manager.deleteDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "cascade delete via votes." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
            case (#setNull) {
              switch (manager.setNullDependents(pk)) {
                case (#ok()) {};
                case (#err(e)) {
                  let msg = "setNull via votes." # manager.field # ": " # manager.formatError(e);
                  return #err(#Internal(msg));
                };
              };
            };
          };
        };
        #ok();
      };

      func deleteWithPolicies(pk : Nat64) : Result.Result<(), EntriesTable.Errors.Error> {
        switch (applyPolicies(pk)) {
          case (#ok()) { base.delete(pk) };
          case (#err(e)) #err(e);
        };
      };

      func deleteManyWithPolicies(ids : [Nat64]) : Result.Result<Nat, EntriesTable.Errors.Error> {
        var removed : Nat = 0;
        for (id in ids.vals()) {
          switch (deleteWithPolicies(id)) {
            case (#ok()) { removed += 1 };
            case (#err(e)) { return #err(e) };
          };
        };
        #ok(removed);
      };

      func wrapIndexOps<K>(ops : EntriesTable.IndexOps<K>) : EntriesTable.IndexOps<K> {
        {
          descriptor = ops.descriptor;
          find = ops.find;
          rangeDelete = func(range : EntriesTable.IndexRange<K>, limit : Nat, cursor : ?CursorCore.Token) : Result.Result<EntriesTable.RangeDeleteResult, EntriesTable.Errors.Error> {
            if (limit == 0) {
              return #ok({ deleted = 0; cursor = null; hasMore = false });
            };
            ignore cursor;
            let iter = ops.rangeIter(range, null);
            let staged = List.empty<Nat64>();
            var processed : Nat = 0;
            var hasMore = false;
            label collect while (processed < limit) {
              switch (iter.next()) {
                case null { break collect };
                case (?row) {
                  List.add(staged, row.id);
                  processed += 1;
                };
              };
            };
            if (processed == limit) {
              switch (iter.next()) {
                case (?_) { hasMore := true };
                case null {};
              };
            };
            var deleted : Nat = 0;
            for (pk in List.values(staged)) {
              switch (deleteWithPolicies(pk)) {
                case (#ok()) { deleted += 1 };
                case (#err(e)) { return #err(e) };
              };
            };
            return #ok({ deleted; cursor = null; hasMore });
          };
          exists = ops.exists;
          locate = ops.locate;
          countInRange = ops.countInRange;
          size = ops.size;
          rangeIter = ops.rangeIter;
          mapRange = ops.mapRange;
          foldRange = ops.foldRange;
        };
      };

      func wrapTextIndexOps(ops : EntriesTable.TextIndexOps) : EntriesTable.TextIndexOps {
        {
          descriptor = ops.descriptor;
          find = ops.find;
          rangeDelete = func(range : EntriesTable.IndexRange<Text>, limit : Nat, cursor : ?CursorCore.Token) : Result.Result<EntriesTable.RangeDeleteResult, EntriesTable.Errors.Error> {
            if (limit == 0) {
              return #ok({ deleted = 0; cursor = null; hasMore = false });
            };
            ignore cursor;
            let iter = ops.rangeIter(range, null);
            let staged = List.empty<Nat64>();
            var processed : Nat = 0;
            var hasMore = false;
            label collect while (processed < limit) {
              switch (iter.next()) {
                case null { break collect };
                case (?row) {
                  List.add(staged, row.id);
                  processed += 1;
                };
              };
            };
            if (processed == limit) {
              switch (iter.next()) {
                case (?_) { hasMore := true };
                case null {};
              };
            };
            var deleted : Nat = 0;
            for (pk in List.values(staged)) {
              switch (deleteWithPolicies(pk)) {
                case (#ok()) { deleted += 1 };
                case (#err(e)) { return #err(e) };
              };
            };
            return #ok({ deleted; cursor = null; hasMore });
          };
          exists = ops.exists;
          locate = ops.locate;
          countInRange = ops.countInRange;
          size = ops.size;
          rangeIter = ops.rangeIter;
          mapRange = ops.mapRange;
          foldRange = ops.foldRange;
          prefixFind = ops.prefixFind;
        };
      };

      wrapped := { wrapped with delete = deleteWithPolicies };
      wrapped := { wrapped with deleteMany = deleteManyWithPolicies };
      wrapped := {
        wrapped with bySlot = wrapIndexOps<(Nat64, Nat, Nat64, Nat64)>(base.bySlot)
      };
      wrapped := {
        wrapped with byRank = wrapIndexOps<(Nat64, Nat, Nat, Nat64)>(base.byRank)
      };
      wrapped := { wrapped with byUser = wrapIndexOps<Nat64>(base.byUser) };
      wrapped := { wrapped with bySeason = wrapIndexOps<Nat64>(base.bySeason) };
      wrapped := { wrapped with bySlug = wrapTextIndexOps(base.bySlug) };
      wrapped;
    };

    func wrapVote(use : VotesTable.Use, managers : [VotesTable.ForeignKeyManager]) : VotesTable.Use {
      var wrapped : VotesTable.Use = use;
      if (Array.size(managers) > 0) {
        let base = wrapped;
        func validateCreate(record : VotesTable.Types.CreateVote) : Result.Result<(), VotesTable.Errors.Error> {
          for (manager in managers.vals()) {
            switch (manager.validateCreate(record)) {
              case (#ok()) {};
              case (#err(e)) { return #err(e) };
            };
          };
          #ok();
        };

        func validateDoc(doc : VotesTable.Types.Vote) : Result.Result<(), VotesTable.Errors.Error> {
          for (manager in managers.vals()) {
            switch (manager.validateDoc(doc)) {
              case (#ok()) {};
              case (#err(e)) { return #err(e) };
            };
          };
          #ok();
        };

        wrapped := {
          wrapped with insert = func(record : VotesTable.Types.CreateVote) : Result.Result<Nat64, VotesTable.Errors.Error> {
            switch (validateCreate(record)) {
              case (#ok()) { base.insert(record) };
              case (#err(e)) #err(e);
            };
          };
        };
        wrapped := {
          wrapped with insertMany = func(records : [VotesTable.Types.CreateVote]) : Result.Result<[Nat64], VotesTable.Errors.Error> {
            for (record in records.vals()) {
              switch (validateCreate(record)) {
                case (#ok()) {};
                case (#err(e)) { return #err(e) };
              };
            };
            base.insertMany(records);
          };
        };
        wrapped := {
          wrapped with update = func(doc : VotesTable.Types.Vote) : Result.Result<VotesTable.Types.Vote, VotesTable.Errors.Error> {
            switch (validateDoc(doc)) {
              case (#ok()) { base.update(doc) };
              case (#err(e)) #err(e);
            };
          };
        };
        wrapped := {
          wrapped with upsert = func(doc : VotesTable.Types.Vote) : Result.Result<{ #inserted; #updated }, VotesTable.Errors.Error> {
            switch (validateDoc(doc)) {
              case (#ok()) { base.upsert(doc) };
              case (#err(e)) #err(e);
            };
          };
        };
        wrapped := {
          wrapped with upsertMany = func(docs : [VotesTable.Types.Vote]) : Result.Result<{ inserted : Nat; updated : Nat }, VotesTable.Errors.Error> {
            for (doc in docs.vals()) {
              switch (validateDoc(doc)) {
                case (#ok()) {};
                case (#err(e)) { return #err(e) };
              };
            };
            base.upsertMany(docs);
          };
        };
      };
      wrapped;
    };

    func wrapPayout(use : PayoutsTable.Use, managers : [PayoutsTable.ForeignKeyManager]) : PayoutsTable.Use {
      use;
    };

    func wrapRevision(use : RevisionsTable.Use, managers : [RevisionsTable.ForeignKeyManager]) : RevisionsTable.Use {
      use;
    };

    func wrapNotice(use : NoticesTable.Use, managers : [NoticesTable.ForeignKeyManager]) : NoticesTable.Use {
      use;
    };

    func wrapApproval(use : ApprovalsTable.Use, managers : [ApprovalsTable.ForeignKeyManager]) : ApprovalsTable.Use {
      use;
    };

    let usersUse = wrapUser(usersBase, usersManagers);
    let actionsUse = wrapAction(actionsBase, actionsManagers);
    let seasonsUse = wrapSeason(seasonsBase, seasonsManagers);
    let entriesUse = wrapEntry(entriesBase, entriesManagers);
    let votesUse = wrapVote(votesBase, votesManagers);
    let payoutsUse = wrapPayout(payoutsBase, payoutsManagers);
    let revisionsUse = wrapRevision(revisionsBase, revisionsManagers);
    let noticesUse = wrapNotice(noticesBase, noticesManagers);
    let approvalsUse = wrapApproval(approvalsBase, approvalsManagers);

    let usersQueryDb : Queries.Users.Db = {
      users = usersUse;
    };
    let actionsQueryDb : Queries.Actions.Db = {
      actions = actionsUse;
    };
    let seasonsQueryDb : Queries.Seasons.Db = {
      seasons = seasonsUse;
    };
    let entriesQueryDb : Queries.Entries.Db = {
      entries = entriesUse;
    };
    let votesQueryDb : Queries.Votes.Db = {
      votes = votesUse;
    };
    let payoutsQueryDb : Queries.Payouts.Db = {
      payouts = payoutsUse;
    };
    let revisionsQueryDb : Queries.Revisions.Db = {
      revisions = revisionsUse;
    };
    let noticesQueryDb : Queries.Notices.Db = {
      notices = noticesUse;
    };
    let approvalsQueryDb : Queries.Approvals.Db = {
      approvals = approvalsUse;
    };

    let ashqlDispatch = func(req : AshQL.Query) : AshQL.Result {
      switch (req) {
        case (#users(params)) {
          #users(Queries.Users.run(usersQueryDb, params));
        };
        case (#actions(params)) {
          #actions(Queries.Actions.run(actionsQueryDb, params));
        };
        case (#seasons(params)) {
          #seasons(Queries.Seasons.run(seasonsQueryDb, params));
        };
        case (#entries(params)) {
          #entries(Queries.Entries.run(entriesQueryDb, params));
        };
        case (#votes(params)) {
          #votes(Queries.Votes.run(votesQueryDb, params));
        };
        case (#payouts(params)) {
          #payouts(Queries.Payouts.run(payoutsQueryDb, params));
        };
        case (#revisions(params)) {
          #revisions(Queries.Revisions.run(revisionsQueryDb, params));
        };
        case (#notices(params)) {
          #notices(Queries.Notices.run(noticesQueryDb, params));
        };
        case (#approvals(params)) {
          #approvals(Queries.Approvals.run(approvalsQueryDb, params));
        };
      };
    };

    for (manager in actionsManagers.vals()) {
      if (manager.parentTable == "users") {
        manager.installParentExists(usersUse.exists);
      };
    };
    for (manager in entriesManagers.vals()) {
      if (manager.parentTable == "seasons") {
        manager.installParentExists(seasonsUse.exists);
      } else if (manager.parentTable == "users") {
        manager.installParentExists(usersUse.exists);
      };
    };
    for (manager in votesManagers.vals()) {
      if (manager.parentTable == "entries") {
        manager.installParentExists(entriesUse.exists);
      } else if (manager.parentTable == "users") {
        manager.installParentExists(usersUse.exists);
      };
    };

    var transactionActive : Bool = false;

    {
      users = usersUse;
      actions = actionsUse;
      seasons = seasonsUse;
      entries = entriesUse;
      votes = votesUse;
      payouts = payoutsUse;
      revisions = revisionsUse;
      notices = noticesUse;
      approvals = approvalsUse;
      store = storeUse;
      ashql = ashqlDispatch;
      transaction = {
        start = func() : () {
          if (transactionActive) {
            Runtime.trap("transaction already active");
          };
          transactionActive := true;
        };
        commit = func() : Result.Result<(), Errors.Error> {
          if (not transactionActive) {
            return #err(#Internal("no active transaction"));
          };
          transactionActive := false;
          #ok();
        };
        discard = func() : () {
          transactionActive := false;
        };
      };
    };
  };
};
