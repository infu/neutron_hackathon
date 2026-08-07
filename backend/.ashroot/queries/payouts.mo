/* Payout reads

   Frozen transfers can be paged by season, recipient, or transfer slot.
   Execution state and transfer metadata remain available as filters.
*/
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

import PayoutTable "../tables/payouts";

module {
  public type OrderDirection = AshrootQueryDir.OrderDirection;

  public let defaultDir = AshrootQueryDir.defaultDir;

  public let toIterDir = AshrootQueryDir.toIterDir;

  public type Order = {
    #byId : { dir : ?OrderDirection; from : ?Nat64 };
    #by_bySlot : {
      dir : ?OrderDirection;
      from : ?(Nat64, Nat64, Principal, Nat64);
    };
    #by_bySeason : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byUser : { dir : ?OrderDirection; from : ?Nat64 };
  };

  public type Filter = {
    #id_eq : Nat64;
    #id_gt : Nat64;
    #id_gte : Nat64;
    #id_lt : Nat64;
    #id_lte : Nat64;
    #season_id_eq : Nat64;
    #season_id_gt : Nat64;
    #season_id_gte : Nat64;
    #season_id_lt : Nat64;
    #season_id_lte : Nat64;
    #user_id_eq : Nat64;
    #user_id_gt : Nat64;
    #user_id_gte : Nat64;
    #user_id_lt : Nat64;
    #user_id_lte : Nat64;
    #entry_id_eq : Nat64;
    #entry_id_gt : Nat64;
    #entry_id_gte : Nat64;
    #entry_id_lt : Nat64;
    #entry_id_lte : Nat64;
    #gross_eq : Nat;
    #gross_gt : Nat;
    #gross_gte : Nat;
    #gross_lt : Nat;
    #gross_lte : Nat;
    #fee_eq : Nat;
    #fee_gt : Nat;
    #fee_gte : Nat;
    #fee_lt : Nat;
    #fee_lte : Nat;
    #net_eq : Nat;
    #net_gt : Nat;
    #net_gte : Nat;
    #net_lt : Nat;
    #net_lte : Nat;
    #createdAtTime_eq : Nat64;
    #createdAtTime_gt : Nat64;
    #createdAtTime_gte : Nat64;
    #createdAtTime_lt : Nat64;
    #createdAtTime_lte : Nat64;
    #attempts_eq : Nat;
    #attempts_gt : Nat;
    #attempts_gte : Nat;
    #attempts_lt : Nat;
    #attempts_lte : Nat;
    #note_eq : Text;
    #dust_eq : Nat;
    #dust_gt : Nat;
    #dust_gte : Nat;
    #dust_lt : Nat;
    #dust_lte : Nat;
    #block_eq : Nat;
    #block_is_null;
    #block_gt : Nat;
    #block_gte : Nat;
    #block_lt : Nat;
    #block_lte : Nat;
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
    doc : PayoutTable.Types.Payout;
  };

  public type Result = { rows : [Row]; hasMore : Bool };

  public type Db = {
    payouts : PayoutTable.Use;
  };

  func matches(doc : PayoutTable.Types.Payout, filter : Filter) : Bool {
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
      case (#user_id_eq(value)) {
        doc.user_id == value;
      };
      case (#user_id_gt(value)) {
        Nat64.compare(doc.user_id, value) == #greater;
      };
      case (#user_id_gte(value)) {
        Nat64.compare(doc.user_id, value) != #less;
      };
      case (#user_id_lt(value)) {
        Nat64.compare(doc.user_id, value) == #less;
      };
      case (#user_id_lte(value)) {
        Nat64.compare(doc.user_id, value) != #greater;
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
      case (#gross_eq(value)) {
        doc.gross == value;
      };
      case (#gross_gt(value)) {
        Nat.compare(doc.gross, value) == #greater;
      };
      case (#gross_gte(value)) {
        Nat.compare(doc.gross, value) != #less;
      };
      case (#gross_lt(value)) {
        Nat.compare(doc.gross, value) == #less;
      };
      case (#gross_lte(value)) {
        Nat.compare(doc.gross, value) != #greater;
      };
      case (#fee_eq(value)) {
        doc.fee == value;
      };
      case (#fee_gt(value)) {
        Nat.compare(doc.fee, value) == #greater;
      };
      case (#fee_gte(value)) {
        Nat.compare(doc.fee, value) != #less;
      };
      case (#fee_lt(value)) {
        Nat.compare(doc.fee, value) == #less;
      };
      case (#fee_lte(value)) {
        Nat.compare(doc.fee, value) != #greater;
      };
      case (#net_eq(value)) {
        doc.net == value;
      };
      case (#net_gt(value)) {
        Nat.compare(doc.net, value) == #greater;
      };
      case (#net_gte(value)) {
        Nat.compare(doc.net, value) != #less;
      };
      case (#net_lt(value)) {
        Nat.compare(doc.net, value) == #less;
      };
      case (#net_lte(value)) {
        Nat.compare(doc.net, value) != #greater;
      };
      case (#createdAtTime_eq(value)) {
        doc.createdAtTime == value;
      };
      case (#createdAtTime_gt(value)) {
        Nat64.compare(doc.createdAtTime, value) == #greater;
      };
      case (#createdAtTime_gte(value)) {
        Nat64.compare(doc.createdAtTime, value) != #less;
      };
      case (#createdAtTime_lt(value)) {
        Nat64.compare(doc.createdAtTime, value) == #less;
      };
      case (#createdAtTime_lte(value)) {
        Nat64.compare(doc.createdAtTime, value) != #greater;
      };
      case (#attempts_eq(value)) {
        doc.attempts == value;
      };
      case (#attempts_gt(value)) {
        Nat.compare(doc.attempts, value) == #greater;
      };
      case (#attempts_gte(value)) {
        Nat.compare(doc.attempts, value) != #less;
      };
      case (#attempts_lt(value)) {
        Nat.compare(doc.attempts, value) == #less;
      };
      case (#attempts_lte(value)) {
        Nat.compare(doc.attempts, value) != #greater;
      };
      case (#note_eq(value)) {
        doc.note == value;
      };
      case (#dust_eq(value)) {
        doc.dust == value;
      };
      case (#dust_gt(value)) {
        Nat.compare(doc.dust, value) == #greater;
      };
      case (#dust_gte(value)) {
        Nat.compare(doc.dust, value) != #less;
      };
      case (#dust_lt(value)) {
        Nat.compare(doc.dust, value) == #less;
      };
      case (#dust_lte(value)) {
        Nat.compare(doc.dust, value) != #greater;
      };
      case (#block_eq(value)) {
        switch (doc.block) { case (?inner) { inner == value }; case null false };
      };
      case (#block_is_null) {
        switch (doc.block) { case null true; case _ false };
      };
      case (#block_gt(value)) {
        switch (doc.block) {
          case (?inner) { Nat.compare(inner, value) == #greater };
          case null false;
        };
      };
      case (#block_gte(value)) {
        switch (doc.block) {
          case (?inner) { Nat.compare(inner, value) != #less };
          case null false;
        };
      };
      case (#block_lt(value)) {
        switch (doc.block) {
          case (?inner) { Nat.compare(inner, value) == #less };
          case null false;
        };
      };
      case (#block_lte(value)) {
        switch (doc.block) {
          case (?inner) { Nat.compare(inner, value) != #greater };
          case null false;
        };
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

  public func passes(doc : PayoutTable.Types.Payout, filters : [Filter]) : Bool {
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
    func push(doc : PayoutTable.Types.Payout) : () {
      List.add<Row>(rows, { doc = doc });
      produced += 1;
    };
    func consider(doc : PayoutTable.Types.Payout) : Bool {
      if (not passes(doc, filters)) return false;
      if (not underLimit()) { hasMore := true; return true };
      push(doc);
      false;
    };
    switch (params.order) {
      case (#byId(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let iter = db.payouts.iterPrimary(iterDir, opts.from);
        AshrootQueryRuntime.drain(
          iter,
          func(entry : (Nat64, PayoutTable.Types.Payout)) : Bool {
            let (_pk, doc) = entry;
            return consider(doc);
          },
        );
      };
      case (#by_bySlot(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat64, Nat64, Principal, Nat64)> = AshrootQueryRuntime.makeRange<(Nat64, Nat64, Principal, Nat64)>(dir, opts.from, iterDir);
        let iter = db.payouts.bySlot.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : PayoutTable.Types.Payout) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_bySeason(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.payouts.bySeason.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : PayoutTable.Types.Payout) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byUser(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.payouts.byUser.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : PayoutTable.Types.Payout) : Bool {
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
