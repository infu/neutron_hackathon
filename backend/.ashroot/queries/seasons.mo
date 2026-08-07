// Season reads are intentionally small: find by public number, find the live
// lifecycle row, or page the historical primary order. None needs a table scan.
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

import SeasonTable "../tables/seasons";

module {
  public type OrderDirection = AshrootQueryDir.OrderDirection;

  public let defaultDir = AshrootQueryDir.defaultDir;

  public let toIterDir = AshrootQueryDir.toIterDir;

  public type Order = {
    #byId : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byNumber : { dir : ?OrderDirection; from : ?Nat };
    #by_byRunning : { dir : ?OrderDirection; from : ?Nat64 };
  };

  public type Filter = {
    #id_eq : Nat64;
    #id_gt : Nat64;
    #id_gte : Nat64;
    #id_lt : Nat64;
    #id_lte : Nat64;
    #number_eq : Nat;
    #number_gt : Nat;
    #number_gte : Nat;
    #number_lt : Nat;
    #number_lte : Nat;
    #week_eq : Nat;
    #week_gt : Nat;
    #week_gte : Nat;
    #week_lt : Nat;
    #week_lte : Nat;
    #startedAt_eq : Nat64;
    #startedAt_gt : Nat64;
    #startedAt_gte : Nat64;
    #startedAt_lt : Nat64;
    #startedAt_lte : Nat64;
    #weekEndsAt_eq : Nat64;
    #weekEndsAt_gt : Nat64;
    #weekEndsAt_gte : Nat64;
    #weekEndsAt_lt : Nat64;
    #weekEndsAt_lte : Nat64;
    #endedAt_eq : Nat64;
    #endedAt_gt : Nat64;
    #endedAt_gte : Nat64;
    #endedAt_lt : Nat64;
    #endedAt_lte : Nat64;
    #fundingReady_eq : Bool;
    #fundingAttempts_eq : Nat;
    #fundingAttempts_gt : Nat;
    #fundingAttempts_gte : Nat;
    #fundingAttempts_lt : Nat;
    #fundingAttempts_lte : Nat;
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
    doc : SeasonTable.Types.Season;
  };

  public type Result = { rows : [Row]; hasMore : Bool };

  public type Db = {
    seasons : SeasonTable.Use;
  };

  func matches(doc : SeasonTable.Types.Season, filter : Filter) : Bool {
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
      case (#number_eq(value)) {
        doc.number == value;
      };
      case (#number_gt(value)) {
        Nat.compare(doc.number, value) == #greater;
      };
      case (#number_gte(value)) {
        Nat.compare(doc.number, value) != #less;
      };
      case (#number_lt(value)) {
        Nat.compare(doc.number, value) == #less;
      };
      case (#number_lte(value)) {
        Nat.compare(doc.number, value) != #greater;
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
      case (#startedAt_eq(value)) {
        doc.startedAt == value;
      };
      case (#startedAt_gt(value)) {
        Nat64.compare(doc.startedAt, value) == #greater;
      };
      case (#startedAt_gte(value)) {
        Nat64.compare(doc.startedAt, value) != #less;
      };
      case (#startedAt_lt(value)) {
        Nat64.compare(doc.startedAt, value) == #less;
      };
      case (#startedAt_lte(value)) {
        Nat64.compare(doc.startedAt, value) != #greater;
      };
      case (#weekEndsAt_eq(value)) {
        doc.weekEndsAt == value;
      };
      case (#weekEndsAt_gt(value)) {
        Nat64.compare(doc.weekEndsAt, value) == #greater;
      };
      case (#weekEndsAt_gte(value)) {
        Nat64.compare(doc.weekEndsAt, value) != #less;
      };
      case (#weekEndsAt_lt(value)) {
        Nat64.compare(doc.weekEndsAt, value) == #less;
      };
      case (#weekEndsAt_lte(value)) {
        Nat64.compare(doc.weekEndsAt, value) != #greater;
      };
      case (#endedAt_eq(value)) {
        doc.endedAt == value;
      };
      case (#endedAt_gt(value)) {
        Nat64.compare(doc.endedAt, value) == #greater;
      };
      case (#endedAt_gte(value)) {
        Nat64.compare(doc.endedAt, value) != #less;
      };
      case (#endedAt_lt(value)) {
        Nat64.compare(doc.endedAt, value) == #less;
      };
      case (#endedAt_lte(value)) {
        Nat64.compare(doc.endedAt, value) != #greater;
      };
      case (#fundingReady_eq(value)) {
        doc.fundingReady == value;
      };
      case (#fundingAttempts_eq(value)) {
        doc.fundingAttempts == value;
      };
      case (#fundingAttempts_gt(value)) {
        Nat.compare(doc.fundingAttempts, value) == #greater;
      };
      case (#fundingAttempts_gte(value)) {
        Nat.compare(doc.fundingAttempts, value) != #less;
      };
      case (#fundingAttempts_lt(value)) {
        Nat.compare(doc.fundingAttempts, value) == #less;
      };
      case (#fundingAttempts_lte(value)) {
        Nat.compare(doc.fundingAttempts, value) != #greater;
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

  public func passes(doc : SeasonTable.Types.Season, filters : [Filter]) : Bool {
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
    func push(doc : SeasonTable.Types.Season) : () {
      List.add<Row>(rows, { doc = doc });
      produced += 1;
    };
    func consider(doc : SeasonTable.Types.Season) : Bool {
      if (not passes(doc, filters)) return false;
      if (not underLimit()) { hasMore := true; return true };
      push(doc);
      false;
    };
    switch (params.order) {
      case (#byId(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let iter = db.seasons.iterPrimary(iterDir, opts.from);
        AshrootQueryRuntime.drain(
          iter,
          func(entry : (Nat64, SeasonTable.Types.Season)) : Bool {
            let (_pk, doc) = entry;
            return consider(doc);
          },
        );
      };
      case (#by_byNumber(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat> = AshrootQueryRuntime.makeRange<Nat>(dir, opts.from, iterDir);
        let iter = db.seasons.byNumber.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : SeasonTable.Types.Season) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byRunning(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.seasons.byRunning.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : SeasonTable.Types.Season) : Bool {
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
