/// Reads for moderator backing records.
///
/// Composite keys scope quorum checks to the exact decision kind, subject, and
/// moderator while retaining deterministic audit order.
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

import ApprovalTable "../tables/approvals";

module {
  public type OrderDirection = AshrootQueryDir.OrderDirection;

  public let defaultDir = AshrootQueryDir.defaultDir;

  public let toIterDir = AshrootQueryDir.toIterDir;

  public type Order = {
    #byId : { dir : ?OrderDirection; from : ?Nat64 };
    #by_bySlot : { dir : ?OrderDirection; from : ?(Nat64, Nat, Nat64) };
    #by_bySubject : { dir : ?OrderDirection; from : ?(Nat64, Nat) };
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
    #moderator_id_eq : Nat64;
    #moderator_id_gt : Nat64;
    #moderator_id_gte : Nat64;
    #moderator_id_lt : Nat64;
    #moderator_id_lte : Nat64;
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
    doc : ApprovalTable.Types.Approval;
  };

  public type Result = { rows : [Row]; hasMore : Bool };

  public type Db = {
    approvals : ApprovalTable.Use;
  };

  func matches(doc : ApprovalTable.Types.Approval, filter : Filter) : Bool {
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
      case (#moderator_id_eq(value)) {
        doc.moderator_id == value;
      };
      case (#moderator_id_gt(value)) {
        Nat64.compare(doc.moderator_id, value) == #greater;
      };
      case (#moderator_id_gte(value)) {
        Nat64.compare(doc.moderator_id, value) != #less;
      };
      case (#moderator_id_lt(value)) {
        Nat64.compare(doc.moderator_id, value) == #less;
      };
      case (#moderator_id_lte(value)) {
        Nat64.compare(doc.moderator_id, value) != #greater;
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

  public func passes(doc : ApprovalTable.Types.Approval, filters : [Filter]) : Bool {
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
    func push(doc : ApprovalTable.Types.Approval) : () {
      List.add<Row>(rows, { doc = doc });
      produced += 1;
    };
    func consider(doc : ApprovalTable.Types.Approval) : Bool {
      if (not passes(doc, filters)) return false;
      if (not underLimit()) { hasMore := true; return true };
      push(doc);
      false;
    };
    switch (params.order) {
      case (#byId(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let iter = db.approvals.iterPrimary(iterDir, opts.from);
        AshrootQueryRuntime.drain(
          iter,
          func(entry : (Nat64, ApprovalTable.Types.Approval)) : Bool {
            let (_pk, doc) = entry;
            return consider(doc);
          },
        );
      };
      case (#by_bySlot(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat64, Nat, Nat64)> = AshrootQueryRuntime.makeRange<(Nat64, Nat, Nat64)>(dir, opts.from, iterDir);
        let iter = db.approvals.bySlot.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : ApprovalTable.Types.Approval) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_bySubject(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat64, Nat)> = AshrootQueryRuntime.makeRange<(Nat64, Nat)>(dir, opts.from, iterDir);
        let iter = db.approvals.bySubject.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : ApprovalTable.Types.Approval) : Bool {
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
