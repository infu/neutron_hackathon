// MODERATION HISTORY
// ------------------
// Chronological, per-subject, and per-actor paths all stay on an index;
// viewing one account's history never walks unrelated decisions.
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

import ActionTable "../tables/actions";

module {
  public type OrderDirection = AshrootQueryDir.OrderDirection;

  public let defaultDir = AshrootQueryDir.defaultDir;

  public let toIterDir = AshrootQueryDir.toIterDir;

  public type Order = {
    #byId : { dir : ?OrderDirection; from : ?Nat64 };
    #by_bySubject : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byActor : { dir : ?OrderDirection; from : ?Principal };
    #by_byTime : { dir : ?OrderDirection; from : ?Nat64 };
  };

  public type Filter = {
    #id_eq : Nat64;
    #id_gt : Nat64;
    #id_gte : Nat64;
    #id_lt : Nat64;
    #id_lte : Nat64;
    #subject_id_eq : Nat64;
    #subject_id_gt : Nat64;
    #subject_id_gte : Nat64;
    #subject_id_lt : Nat64;
    #subject_id_lte : Nat64;
    #note_eq : Text;
    #note_is_null;
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
    doc : ActionTable.Types.Action;
  };

  public type Result = { rows : [Row]; hasMore : Bool };

  public type Db = {
    actions : ActionTable.Use;
  };

  func matches(doc : ActionTable.Types.Action, filter : Filter) : Bool {
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
      case (#subject_id_eq(value)) {
        doc.subject_id == value;
      };
      case (#subject_id_gt(value)) {
        Nat64.compare(doc.subject_id, value) == #greater;
      };
      case (#subject_id_gte(value)) {
        Nat64.compare(doc.subject_id, value) != #less;
      };
      case (#subject_id_lt(value)) {
        Nat64.compare(doc.subject_id, value) == #less;
      };
      case (#subject_id_lte(value)) {
        Nat64.compare(doc.subject_id, value) != #greater;
      };
      case (#note_eq(value)) {
        switch (doc.note) { case (?inner) { inner == value }; case null false };
      };
      case (#note_is_null) {
        switch (doc.note) { case null true; case _ false };
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

  public func passes(doc : ActionTable.Types.Action, filters : [Filter]) : Bool {
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
    func push(doc : ActionTable.Types.Action) : () {
      List.add<Row>(rows, { doc = doc });
      produced += 1;
    };
    func consider(doc : ActionTable.Types.Action) : Bool {
      if (not passes(doc, filters)) return false;
      if (not underLimit()) { hasMore := true; return true };
      push(doc);
      false;
    };
    switch (params.order) {
      case (#byId(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let iter = db.actions.iterPrimary(iterDir, opts.from);
        AshrootQueryRuntime.drain(
          iter,
          func(entry : (Nat64, ActionTable.Types.Action)) : Bool {
            let (_pk, doc) = entry;
            return consider(doc);
          },
        );
      };
      case (#by_bySubject(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.actions.bySubject.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : ActionTable.Types.Action) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byActor(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Principal> = AshrootQueryRuntime.makeRange<Principal>(dir, opts.from, iterDir);
        let iter = db.actions.byActor.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : ActionTable.Types.Action) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byTime(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.actions.byTime.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : ActionTable.Types.Action) : Bool {
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
