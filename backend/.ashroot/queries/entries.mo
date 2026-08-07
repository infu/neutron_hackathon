/*
 * Entry lookup plans used by brackets, profiles, and app identity.
 *
 * Exact slots and rankings are indexed alongside the bounded user, season,
 * and slug views.
 */
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

import EntryTable "../tables/entries";

module {
  public type OrderDirection = AshrootQueryDir.OrderDirection;

  public let defaultDir = AshrootQueryDir.defaultDir;

  public let toIterDir = AshrootQueryDir.toIterDir;

  public type Order = {
    #byId : { dir : ?OrderDirection; from : ?Nat64 };
    #by_bySlot : { dir : ?OrderDirection; from : ?(Nat64, Nat, Nat64, Nat64) };
    #by_byRank : { dir : ?OrderDirection; from : ?(Nat64, Nat, Nat, Nat64) };
    #by_byUser : { dir : ?OrderDirection; from : ?Nat64 };
    #by_bySeason : { dir : ?OrderDirection; from : ?Nat64 };
    #by_bySlug : { dir : ?OrderDirection; from : ?Text };
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
    #week_eq : Nat;
    #week_gt : Nat;
    #week_gte : Nat;
    #week_lt : Nat;
    #week_lte : Nat;
    #title_eq : Text;
    #summary_eq : Text;
    #url_eq : Text;
    #icon_eq : Text;
    #icon_is_null;
    #votes_eq : Nat;
    #votes_gt : Nat;
    #votes_gte : Nat;
    #votes_lt : Nat;
    #votes_lte : Nat;
    #origin_id_eq : Nat64;
    #origin_id_is_null;
    #origin_id_gt : Nat64;
    #origin_id_gte : Nat64;
    #origin_id_lt : Nat64;
    #origin_id_lte : Nat64;
    #createdAt_eq : Nat64;
    #createdAt_gt : Nat64;
    #createdAt_gte : Nat64;
    #createdAt_lt : Nat64;
    #createdAt_lte : Nat64;
    #updatedAt_eq : Nat64;
    #updatedAt_gt : Nat64;
    #updatedAt_gte : Nat64;
    #updatedAt_lt : Nat64;
    #updatedAt_lte : Nat64;
    #slug_eq : Text;
    #takedownAt_eq : Nat64;
    #takedownAt_gt : Nat64;
    #takedownAt_gte : Nat64;
    #takedownAt_lt : Nat64;
    #takedownAt_lte : Nat64;
    #takedownReason_eq : Text;
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
    doc : EntryTable.Types.Entry;
  };

  public type Result = { rows : [Row]; hasMore : Bool };

  public type Db = {
    entries : EntryTable.Use;
  };

  func matches(doc : EntryTable.Types.Entry, filter : Filter) : Bool {
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
      case (#title_eq(value)) {
        doc.title == value;
      };
      case (#summary_eq(value)) {
        doc.summary == value;
      };
      case (#url_eq(value)) {
        doc.url == value;
      };
      case (#icon_eq(value)) {
        switch (doc.icon) { case (?inner) { inner == value }; case null false };
      };
      case (#icon_is_null) {
        switch (doc.icon) { case null true; case _ false };
      };
      case (#votes_eq(value)) {
        doc.votes == value;
      };
      case (#votes_gt(value)) {
        Nat.compare(doc.votes, value) == #greater;
      };
      case (#votes_gte(value)) {
        Nat.compare(doc.votes, value) != #less;
      };
      case (#votes_lt(value)) {
        Nat.compare(doc.votes, value) == #less;
      };
      case (#votes_lte(value)) {
        Nat.compare(doc.votes, value) != #greater;
      };
      case (#origin_id_eq(value)) {
        switch (doc.origin_id) {
          case (?inner) { inner == value };
          case null false;
        };
      };
      case (#origin_id_is_null) {
        switch (doc.origin_id) { case null true; case _ false };
      };
      case (#origin_id_gt(value)) {
        switch (doc.origin_id) {
          case (?inner) { Nat64.compare(inner, value) == #greater };
          case null false;
        };
      };
      case (#origin_id_gte(value)) {
        switch (doc.origin_id) {
          case (?inner) { Nat64.compare(inner, value) != #less };
          case null false;
        };
      };
      case (#origin_id_lt(value)) {
        switch (doc.origin_id) {
          case (?inner) { Nat64.compare(inner, value) == #less };
          case null false;
        };
      };
      case (#origin_id_lte(value)) {
        switch (doc.origin_id) {
          case (?inner) { Nat64.compare(inner, value) != #greater };
          case null false;
        };
      };
      case (#createdAt_eq(value)) {
        doc.createdAt == value;
      };
      case (#createdAt_gt(value)) {
        Nat64.compare(doc.createdAt, value) == #greater;
      };
      case (#createdAt_gte(value)) {
        Nat64.compare(doc.createdAt, value) != #less;
      };
      case (#createdAt_lt(value)) {
        Nat64.compare(doc.createdAt, value) == #less;
      };
      case (#createdAt_lte(value)) {
        Nat64.compare(doc.createdAt, value) != #greater;
      };
      case (#updatedAt_eq(value)) {
        doc.updatedAt == value;
      };
      case (#updatedAt_gt(value)) {
        Nat64.compare(doc.updatedAt, value) == #greater;
      };
      case (#updatedAt_gte(value)) {
        Nat64.compare(doc.updatedAt, value) != #less;
      };
      case (#updatedAt_lt(value)) {
        Nat64.compare(doc.updatedAt, value) == #less;
      };
      case (#updatedAt_lte(value)) {
        Nat64.compare(doc.updatedAt, value) != #greater;
      };
      case (#slug_eq(value)) {
        doc.slug == value;
      };
      case (#takedownAt_eq(value)) {
        doc.takedownAt == value;
      };
      case (#takedownAt_gt(value)) {
        Nat64.compare(doc.takedownAt, value) == #greater;
      };
      case (#takedownAt_gte(value)) {
        Nat64.compare(doc.takedownAt, value) != #less;
      };
      case (#takedownAt_lt(value)) {
        Nat64.compare(doc.takedownAt, value) == #less;
      };
      case (#takedownAt_lte(value)) {
        Nat64.compare(doc.takedownAt, value) != #greater;
      };
      case (#takedownReason_eq(value)) {
        doc.takedownReason == value;
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

  public func passes(doc : EntryTable.Types.Entry, filters : [Filter]) : Bool {
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
    func push(doc : EntryTable.Types.Entry) : () {
      List.add<Row>(rows, { doc = doc });
      produced += 1;
    };
    func consider(doc : EntryTable.Types.Entry) : Bool {
      if (not passes(doc, filters)) return false;
      if (not underLimit()) { hasMore := true; return true };
      push(doc);
      false;
    };
    switch (params.order) {
      case (#byId(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let iter = db.entries.iterPrimary(iterDir, opts.from);
        AshrootQueryRuntime.drain(
          iter,
          func(entry : (Nat64, EntryTable.Types.Entry)) : Bool {
            let (_pk, doc) = entry;
            return consider(doc);
          },
        );
      };
      case (#by_bySlot(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat64, Nat, Nat64, Nat64)> = AshrootQueryRuntime.makeRange<(Nat64, Nat, Nat64, Nat64)>(dir, opts.from, iterDir);
        let iter = db.entries.bySlot.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : EntryTable.Types.Entry) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byRank(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat64, Nat, Nat, Nat64)> = AshrootQueryRuntime.makeRange<(Nat64, Nat, Nat, Nat64)>(dir, opts.from, iterDir);
        let iter = db.entries.byRank.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : EntryTable.Types.Entry) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byUser(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.entries.byUser.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : EntryTable.Types.Entry) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_bySeason(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.entries.bySeason.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : EntryTable.Types.Entry) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_bySlug(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Text> = AshrootQueryRuntime.makeRange<Text>(dir, opts.from, iterDir);
        let iter = db.entries.bySlug.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : EntryTable.Types.Entry) : Bool {
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
