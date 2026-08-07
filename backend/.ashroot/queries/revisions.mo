/// App review has three useful views:
///
/// - the moderator queue;
/// - one author's bounded history;
/// - the pending slot for an exact round.
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

import RevisionTable "../tables/revisions";

module {
  public type OrderDirection = AshrootQueryDir.OrderDirection;

  public let defaultDir = AshrootQueryDir.defaultDir;

  public let toIterDir = AshrootQueryDir.toIterDir;

  public type Order = {
    #byId : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byQueue : { dir : ?OrderDirection; from : ?(Nat, Nat64) };
    #by_byUser : { dir : ?OrderDirection; from : ?Nat64 };
    #by_bySlot : { dir : ?OrderDirection; from : ?(Nat64, Nat, Nat64) };
  };

  public type Filter = {
    #id_eq : Nat64;
    #id_gt : Nat64;
    #id_gte : Nat64;
    #id_lt : Nat64;
    #id_lte : Nat64;
    #user_id_eq : Nat64;
    #user_id_gt : Nat64;
    #user_id_gte : Nat64;
    #user_id_lt : Nat64;
    #user_id_lte : Nat64;
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
    #targetEntryId_eq : Nat64;
    #targetEntryId_is_null;
    #targetEntryId_gt : Nat64;
    #targetEntryId_gte : Nat64;
    #targetEntryId_lt : Nat64;
    #targetEntryId_lte : Nat64;
    #title_eq : Text;
    #summary_eq : Text;
    #url_eq : Text;
    #icon_eq : Text;
    #icon_is_null;
    #version_eq : Text;
    #note_eq : Text;
    #pkgKey_eq : Text;
    #pkgKey_is_null;
    #reason_eq : Text;
    #reviewer_eq : Nat64;
    #reviewer_is_null;
    #reviewer_gt : Nat64;
    #reviewer_gte : Nat64;
    #reviewer_lt : Nat64;
    #reviewer_lte : Nat64;
    #createdAt_eq : Nat64;
    #createdAt_gt : Nat64;
    #createdAt_gte : Nat64;
    #createdAt_lt : Nat64;
    #createdAt_lte : Nat64;
    #decidedAt_eq : Nat64;
    #decidedAt_gt : Nat64;
    #decidedAt_gte : Nat64;
    #decidedAt_lt : Nat64;
    #decidedAt_lte : Nat64;
    #slug_eq : Text;
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
    doc : RevisionTable.Types.Revision;
  };

  public type Result = { rows : [Row]; hasMore : Bool };

  public type Db = {
    revisions : RevisionTable.Use;
  };

  func matches(doc : RevisionTable.Types.Revision, filter : Filter) : Bool {
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
      case (#targetEntryId_eq(value)) {
        switch (doc.targetEntryId) {
          case (?inner) { inner == value };
          case null false;
        };
      };
      case (#targetEntryId_is_null) {
        switch (doc.targetEntryId) { case null true; case _ false };
      };
      case (#targetEntryId_gt(value)) {
        switch (doc.targetEntryId) {
          case (?inner) { Nat64.compare(inner, value) == #greater };
          case null false;
        };
      };
      case (#targetEntryId_gte(value)) {
        switch (doc.targetEntryId) {
          case (?inner) { Nat64.compare(inner, value) != #less };
          case null false;
        };
      };
      case (#targetEntryId_lt(value)) {
        switch (doc.targetEntryId) {
          case (?inner) { Nat64.compare(inner, value) == #less };
          case null false;
        };
      };
      case (#targetEntryId_lte(value)) {
        switch (doc.targetEntryId) {
          case (?inner) { Nat64.compare(inner, value) != #greater };
          case null false;
        };
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
      case (#version_eq(value)) {
        doc.version == value;
      };
      case (#note_eq(value)) {
        doc.note == value;
      };
      case (#pkgKey_eq(value)) {
        switch (doc.pkgKey) {
          case (?inner) { inner == value };
          case null false;
        };
      };
      case (#pkgKey_is_null) {
        switch (doc.pkgKey) { case null true; case _ false };
      };
      case (#reason_eq(value)) {
        doc.reason == value;
      };
      case (#reviewer_eq(value)) {
        switch (doc.reviewer) {
          case (?inner) { inner == value };
          case null false;
        };
      };
      case (#reviewer_is_null) {
        switch (doc.reviewer) { case null true; case _ false };
      };
      case (#reviewer_gt(value)) {
        switch (doc.reviewer) {
          case (?inner) { Nat64.compare(inner, value) == #greater };
          case null false;
        };
      };
      case (#reviewer_gte(value)) {
        switch (doc.reviewer) {
          case (?inner) { Nat64.compare(inner, value) != #less };
          case null false;
        };
      };
      case (#reviewer_lt(value)) {
        switch (doc.reviewer) {
          case (?inner) { Nat64.compare(inner, value) == #less };
          case null false;
        };
      };
      case (#reviewer_lte(value)) {
        switch (doc.reviewer) {
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
      case (#decidedAt_eq(value)) {
        doc.decidedAt == value;
      };
      case (#decidedAt_gt(value)) {
        Nat64.compare(doc.decidedAt, value) == #greater;
      };
      case (#decidedAt_gte(value)) {
        Nat64.compare(doc.decidedAt, value) != #less;
      };
      case (#decidedAt_lt(value)) {
        Nat64.compare(doc.decidedAt, value) == #less;
      };
      case (#decidedAt_lte(value)) {
        Nat64.compare(doc.decidedAt, value) != #greater;
      };
      case (#slug_eq(value)) {
        doc.slug == value;
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

  public func passes(doc : RevisionTable.Types.Revision, filters : [Filter]) : Bool {
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
    func push(doc : RevisionTable.Types.Revision) : () {
      List.add<Row>(rows, { doc = doc });
      produced += 1;
    };
    func consider(doc : RevisionTable.Types.Revision) : Bool {
      if (not passes(doc, filters)) return false;
      if (not underLimit()) { hasMore := true; return true };
      push(doc);
      false;
    };
    switch (params.order) {
      case (#byId(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let iter = db.revisions.iterPrimary(iterDir, opts.from);
        AshrootQueryRuntime.drain(
          iter,
          func(entry : (Nat64, RevisionTable.Types.Revision)) : Bool {
            let (_pk, doc) = entry;
            return consider(doc);
          },
        );
      };
      case (#by_byQueue(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat, Nat64)> = AshrootQueryRuntime.makeRange<(Nat, Nat64)>(dir, opts.from, iterDir);
        let iter = db.revisions.byQueue.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : RevisionTable.Types.Revision) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byUser(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.revisions.byUser.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : RevisionTable.Types.Revision) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_bySlot(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat64, Nat, Nat64)> = AshrootQueryRuntime.makeRange<(Nat64, Nat, Nat64)>(dir, opts.from, iterDir);
        let iter = db.revisions.bySlot.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : RevisionTable.Types.Revision) : Bool {
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
