// Ballot indexes:
//   judge + entry  -> duplicate prevention
//   judge + season + week -> allowance and withdrawals
//   entry          -> round tally
// Keeping those identities in the keys mirrors vote admission.
import Int "mo:core/Int";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Text "mo:core/Text";

import IndexCore "mo:ashroot/index_core";
import IndexRuntime "mo:ashroot/index_runtime";
import AshrootQueryDir "mo:ashroot/query_direction";
import AshrootQueryRuntime "mo:ashroot/query_runtime";

import VoteTable "../tables/votes";

module {
  public type OrderDirection = AshrootQueryDir.OrderDirection;

  public let defaultDir = AshrootQueryDir.defaultDir;

  public let toIterDir = AshrootQueryDir.toIterDir;

  public type Order = {
    #byId : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byJudgeEntry : { dir : ?OrderDirection; from : ?(Nat64, Nat64) };
    #by_byJudgeWeek : { dir : ?OrderDirection; from : ?(Nat64, Nat64, Nat) };
    #by_byEntry : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byJudge : { dir : ?OrderDirection; from : ?Nat64 };
  };

  public type Filter = {
    #id_eq : Nat64;
    #id_gt : Nat64;
    #id_gte : Nat64;
    #id_lt : Nat64;
    #id_lte : Nat64;
    #entry_id_eq : Nat64;
    #entry_id_gt : Nat64;
    #entry_id_gte : Nat64;
    #entry_id_lt : Nat64;
    #entry_id_lte : Nat64;
    #judge_id_eq : Nat64;
    #judge_id_gt : Nat64;
    #judge_id_gte : Nat64;
    #judge_id_lt : Nat64;
    #judge_id_lte : Nat64;
    #season_id_eq : Nat64;
    #season_id_gt : Nat64;
    #season_id_gte : Nat64;
    #season_id_lt : Nat64;
    #season_id_lte : Nat64;
    #week_eq : Nat;
    #week_gt : Nat;
    #week_gte : Nat;
    #week_lt : Nat;
    #week_lte : Nat;
    #at_eq : Nat64;
    #at_gt : Nat64;
    #at_gte : Nat64;
    #at_lt : Nat64;
    #at_lte : Nat64;
    #all : [Filter];
    #any : [Filter];
    #neg : Filter;
  };

  public type Query = {
    filters : [Filter];
    order : Order;
    limit : ?Nat;
    truncateBlobs : ?Nat;
  };

  public type Row = {
    doc : VoteTable.Types.Vote;
  };

  public type Result = { rows : [Row]; hasMore : Bool };

  public type Db = {
    votes : VoteTable.Use;
  };

  func matches(doc : VoteTable.Types.Vote, filter : Filter) : Bool {
    switch (filter) {
      case (#id_eq(value)) {
        doc.id == value;
      };
      case (#id_gt(value)) {
        Nat64.compare(doc.id, value) == #greater;
      };
      case (#id_gte(value)) {
        Nat64.compare(doc.id, value) != #less;
      };
      case (#id_lt(value)) {
        Nat64.compare(doc.id, value) == #less;
      };
      case (#id_lte(value)) {
        Nat64.compare(doc.id, value) != #greater;
      };
      case (#entry_id_eq(value)) {
        doc.entry_id == value;
      };
      case (#entry_id_gt(value)) {
        Nat64.compare(doc.entry_id, value) == #greater;
      };
      case (#entry_id_gte(value)) {
        Nat64.compare(doc.entry_id, value) != #less;
      };
      case (#entry_id_lt(value)) {
        Nat64.compare(doc.entry_id, value) == #less;
      };
      case (#entry_id_lte(value)) {
        Nat64.compare(doc.entry_id, value) != #greater;
      };
      case (#judge_id_eq(value)) {
        doc.judge_id == value;
      };
      case (#judge_id_gt(value)) {
        Nat64.compare(doc.judge_id, value) == #greater;
      };
      case (#judge_id_gte(value)) {
        Nat64.compare(doc.judge_id, value) != #less;
      };
      case (#judge_id_lt(value)) {
        Nat64.compare(doc.judge_id, value) == #less;
      };
      case (#judge_id_lte(value)) {
        Nat64.compare(doc.judge_id, value) != #greater;
      };
      case (#season_id_eq(value)) {
        doc.season_id == value;
      };
      case (#season_id_gt(value)) {
        Nat64.compare(doc.season_id, value) == #greater;
      };
      case (#season_id_gte(value)) {
        Nat64.compare(doc.season_id, value) != #less;
      };
      case (#season_id_lt(value)) {
        Nat64.compare(doc.season_id, value) == #less;
      };
      case (#season_id_lte(value)) {
        Nat64.compare(doc.season_id, value) != #greater;
      };
      case (#week_eq(value)) {
        doc.week == value;
      };
      case (#week_gt(value)) {
        Nat.compare(doc.week, value) == #greater;
      };
      case (#week_gte(value)) {
        Nat.compare(doc.week, value) != #less;
      };
      case (#week_lt(value)) {
        Nat.compare(doc.week, value) == #less;
      };
      case (#week_lte(value)) {
        Nat.compare(doc.week, value) != #greater;
      };
      case (#at_eq(value)) {
        doc.at == value;
      };
      case (#at_gt(value)) {
        Nat64.compare(doc.at, value) == #greater;
      };
      case (#at_gte(value)) {
        Nat64.compare(doc.at, value) != #less;
      };
      case (#at_lt(value)) {
        Nat64.compare(doc.at, value) == #less;
      };
      case (#at_lte(value)) {
        Nat64.compare(doc.at, value) != #greater;
      };
      case (#all(filters)) {
        for (f in filters.vals()) {
          if (not matches(doc, f)) {
            return false;
          };
        };
        return true;
      };
      case (#any(filters)) {
        for (f in filters.vals()) {
          if (matches(doc, f)) {
            return true;
          };
        };
        return false;
      };
      case (#neg(inner)) {
        return not matches(doc, inner);
      };
    };
  };

  public func passes(doc : VoteTable.Types.Vote, filters : [Filter]) : Bool {
    AshrootQueryRuntime.passes(doc, filters, matches);
  };

  public func run(db : Db, params : Query) : Result {
    var rows = List.empty<Row>();
    var produced : Nat = 0;
    var hasMore = false;
    let filters = params.filters;
    func underLimit() : Bool {
      switch (params.limit) { case (?limit) produced < limit; case null true };
    };
    func push(doc : VoteTable.Types.Vote) : () {
      List.add<Row>(rows, { doc = doc });
      produced += 1;
    };
    func consider(doc : VoteTable.Types.Vote) : Bool {
      if (not passes(doc, filters)) return false;
      if (not underLimit()) { hasMore := true; return true };
      push(doc);
      false;
    };
    switch (params.order) {
      case (#byId(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let iter = db.votes.iterPrimary(iterDir, opts.from);
        AshrootQueryRuntime.drain(
          iter,
          func(entry : (Nat64, VoteTable.Types.Vote)) : Bool {
            let (_pk, doc) = entry;
            return consider(doc);
          },
        );
      };
      case (#by_byJudgeEntry(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat64, Nat64)> = AshrootQueryRuntime.makeRange<(Nat64, Nat64)>(dir, opts.from, iterDir);
        let iter = db.votes.byJudgeEntry.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : VoteTable.Types.Vote) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byJudgeWeek(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat64, Nat64, Nat)> = AshrootQueryRuntime.makeRange<(Nat64, Nat64, Nat)>(dir, opts.from, iterDir);
        let iter = db.votes.byJudgeWeek.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : VoteTable.Types.Vote) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byEntry(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.votes.byEntry.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : VoteTable.Types.Vote) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byJudge(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.votes.byJudge.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : VoteTable.Types.Vote) : Bool {
            return consider(doc);
          },
        );
      };
    };
    { rows = List.toArray<Row>(rows); hasMore };
  };

  public func validate(_params : Query) : Bool { true };

  public func make(args : { filters : ?[Filter]; order : ?Order; limit : ?Nat; truncateBlobs : ?Nat }) : Query {
    let filters = switch (args.filters) {
      case (?value) {
        value;
      };
      case (null) {
        [];
      };
    };
    let order = switch (args.order) {
      case (?value) {
        value;
      };
      case (null) {
        #byId {
          dir = null;
          from = null;
        };
      };
    };
    return {
      filters = filters;
      order = order;
      limit = args.limit;
      truncateBlobs = args.truncateBlobs;
    };
  };

  public func runAll(db : Db, args : { filters : ?[Filter]; order : ?Order; limit : ?Nat; truncateBlobs : ?Nat }) : Result {
    return run(db, make(args));
  };
};
