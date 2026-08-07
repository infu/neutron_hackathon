// Public reports -> moderation queue
//
// Recent work is ordered by time. Reporter lookups are separate, keeping both
// rate checks and moderator pages bounded.
import Int "mo:core/Int";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Text "mo:core/Text";

import IndexCore "mo:ashroot/index_core";
import IndexRuntime "mo:ashroot/index_runtime";
import AshrootQueryDir "mo:ashroot/query_direction";
import AshrootQueryRuntime "mo:ashroot/query_runtime";

import NoticeTable "../tables/notices";

module {
  public type OrderDirection = AshrootQueryDir.OrderDirection;

  public let defaultDir = AshrootQueryDir.defaultDir;

  public let toIterDir = AshrootQueryDir.toIterDir;

  public type Order = {
    #byId : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byTime : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byReporter : { dir : ?OrderDirection; from : ?Principal };
  };

  public type Filter = {
    #id_eq : Nat64;
    #id_gt : Nat64;
    #id_gte : Nat64;
    #id_lt : Nat64;
    #id_lte : Nat64;
    #body_eq : Text;
    #at_eq : Nat64;
    #at_gt : Nat64;
    #at_gte : Nat64;
    #at_lt : Nat64;
    #at_lte : Nat64;
    #handledBy_eq : Nat64;
    #handledBy_is_null;
    #handledBy_gt : Nat64;
    #handledBy_gte : Nat64;
    #handledBy_lt : Nat64;
    #handledBy_lte : Nat64;
    #handledAt_eq : Nat64;
    #handledAt_gt : Nat64;
    #handledAt_gte : Nat64;
    #handledAt_lt : Nat64;
    #handledAt_lte : Nat64;
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
    doc : NoticeTable.Types.Notice;
  };

  public type Result = { rows : [Row]; hasMore : Bool };

  public type Db = {
    notices : NoticeTable.Use;
  };

  func matches(doc : NoticeTable.Types.Notice, filter : Filter) : Bool {
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
      case (#body_eq(value)) {
        doc.body == value;
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
      case (#handledBy_eq(value)) {
        switch (doc.handledBy) {
          case (?inner) { inner == value };
          case null false;
        };
      };
      case (#handledBy_is_null) {
        switch (doc.handledBy) { case null true; case _ false };
      };
      case (#handledBy_gt(value)) {
        switch (doc.handledBy) {
          case (?inner) { Nat64.compare(inner, value) == #greater };
          case null false;
        };
      };
      case (#handledBy_gte(value)) {
        switch (doc.handledBy) {
          case (?inner) { Nat64.compare(inner, value) != #less };
          case null false;
        };
      };
      case (#handledBy_lt(value)) {
        switch (doc.handledBy) {
          case (?inner) { Nat64.compare(inner, value) == #less };
          case null false;
        };
      };
      case (#handledBy_lte(value)) {
        switch (doc.handledBy) {
          case (?inner) { Nat64.compare(inner, value) != #greater };
          case null false;
        };
      };
      case (#handledAt_eq(value)) {
        doc.handledAt == value;
      };
      case (#handledAt_gt(value)) {
        Nat64.compare(doc.handledAt, value) == #greater;
      };
      case (#handledAt_gte(value)) {
        Nat64.compare(doc.handledAt, value) != #less;
      };
      case (#handledAt_lt(value)) {
        Nat64.compare(doc.handledAt, value) == #less;
      };
      case (#handledAt_lte(value)) {
        Nat64.compare(doc.handledAt, value) != #greater;
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

  public func passes(doc : NoticeTable.Types.Notice, filters : [Filter]) : Bool {
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
    func push(doc : NoticeTable.Types.Notice) : () {
      List.add<Row>(rows, { doc = doc });
      produced += 1;
    };
    func consider(doc : NoticeTable.Types.Notice) : Bool {
      if (not passes(doc, filters)) return false;
      if (not underLimit()) { hasMore := true; return true };
      push(doc);
      false;
    };
    switch (params.order) {
      case (#byId(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let iter = db.notices.iterPrimary(iterDir, opts.from);
        AshrootQueryRuntime.drain(
          iter,
          func(entry : (Nat64, NoticeTable.Types.Notice)) : Bool {
            let (_pk, doc) = entry;
            return consider(doc);
          },
        );
      };
      case (#by_byTime(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.notices.byTime.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : NoticeTable.Types.Notice) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byReporter(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Principal> = AshrootQueryRuntime.makeRange<Principal>(dir, opts.from, iterDir);
        let iter = db.notices.byReporter.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : NoticeTable.Types.Notice) : Bool {
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
