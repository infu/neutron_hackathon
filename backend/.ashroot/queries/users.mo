/*
  PARTICIPANT DIRECTORY

  Identity and handle lookups share this surface with sparse role lists and
  resource-usage orderings. Every public listing remains cursor-bounded.
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

import UserTable "../tables/users";

module {
  public type OrderDirection = AshrootQueryDir.OrderDirection;

  public let defaultDir = AshrootQueryDir.defaultDir;

  public let toIterDir = AshrootQueryDir.toIterDir;

  public type Order = {
    #byId : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byPrincipal : { dir : ?OrderDirection; from : ?Principal };
    #by_byHandle : { dir : ?OrderDirection; from : ?Text };
    #by_byCreated : { dir : ?OrderDirection; from : ?Nat64 };
    #by_byHackerHandle : { dir : ?OrderDirection; from : ?Text };
    #by_byObserverHandle : { dir : ?OrderDirection; from : ?Text };
    #by_byModeratorHandle : { dir : ?OrderDirection; from : ?Text };
    #by_byJudgeHandle : { dir : ?OrderDirection; from : ?(Nat, Text) };
    #by_bySponsorHandle : { dir : ?OrderDirection; from : ?(Nat, Text) };
    #by_byInstructions : { dir : ?OrderDirection; from : ?Nat };
    #by_byBytes : { dir : ?OrderDirection; from : ?Nat };
    #by_byAgent : { dir : ?OrderDirection; from : ?Principal };
  };

  public type Filter = {
    #id_eq : Nat64;
    #id_gt : Nat64;
    #id_gte : Nat64;
    #id_lt : Nat64;
    #id_lte : Nat64;
    #handle_eq : Text;
    #displayName_eq : Text;
    #title_eq : Text;
    #title_is_null;
    #bio_eq : Text;
    #avatar_eq : Text;
    #avatar_is_null;
    #moderator_eq : Bool;
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
    #hacker_eq : Bool;
    #instructions_eq : Nat;
    #instructions_gt : Nat;
    #instructions_gte : Nat;
    #instructions_lt : Nat;
    #instructions_lte : Nat;
    #bytes_eq : Nat;
    #bytes_gt : Nat;
    #bytes_gte : Nat;
    #bytes_lt : Nat;
    #bytes_lte : Nat;
    #frozen_eq : Bool;
    #rewardOptOut_eq : Bool;
    #termsAt_eq : Nat64;
    #termsAt_gt : Nat64;
    #termsAt_gte : Nat64;
    #termsAt_lt : Nat64;
    #termsAt_lte : Nat64;
    #termsVersion_eq : Nat;
    #termsVersion_gt : Nat;
    #termsVersion_gte : Nat;
    #termsVersion_lt : Nat;
    #termsVersion_lte : Nat;
    #anonymized_eq : Bool;
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
    doc : UserTable.Types.User;
  };

  public type Result = { rows : [Row]; hasMore : Bool };

  public type Db = {
    users : UserTable.Use;
  };

  func matches(doc : UserTable.Types.User, filter : Filter) : Bool {
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
      case (#handle_eq(value)) {
        doc.handle == value;
      };
      case (#displayName_eq(value)) {
        doc.displayName == value;
      };
      case (#title_eq(value)) {
        switch (doc.title) { case (?inner) { inner == value }; case null false };
      };
      case (#title_is_null) {
        switch (doc.title) { case null true; case _ false };
      };
      case (#bio_eq(value)) {
        doc.bio == value;
      };
      case (#avatar_eq(value)) {
        switch (doc.avatar) {
          case (?inner) { inner == value };
          case null false;
        };
      };
      case (#avatar_is_null) {
        switch (doc.avatar) { case null true; case _ false };
      };
      case (#moderator_eq(value)) {
        doc.moderator == value;
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
      case (#hacker_eq(value)) {
        doc.hacker == value;
      };
      case (#instructions_eq(value)) {
        doc.instructions == value;
      };
      case (#instructions_gt(value)) {
        Nat.compare(doc.instructions, value) == #greater;
      };
      case (#instructions_gte(value)) {
        Nat.compare(doc.instructions, value) != #less;
      };
      case (#instructions_lt(value)) {
        Nat.compare(doc.instructions, value) == #less;
      };
      case (#instructions_lte(value)) {
        Nat.compare(doc.instructions, value) != #greater;
      };
      case (#bytes_eq(value)) {
        doc.bytes == value;
      };
      case (#bytes_gt(value)) {
        Nat.compare(doc.bytes, value) == #greater;
      };
      case (#bytes_gte(value)) {
        Nat.compare(doc.bytes, value) != #less;
      };
      case (#bytes_lt(value)) {
        Nat.compare(doc.bytes, value) == #less;
      };
      case (#bytes_lte(value)) {
        Nat.compare(doc.bytes, value) != #greater;
      };
      case (#frozen_eq(value)) {
        doc.frozen == value;
      };
      case (#rewardOptOut_eq(value)) {
        doc.rewardOptOut == value;
      };
      case (#termsAt_eq(value)) {
        doc.termsAt == value;
      };
      case (#termsAt_gt(value)) {
        Nat64.compare(doc.termsAt, value) == #greater;
      };
      case (#termsAt_gte(value)) {
        Nat64.compare(doc.termsAt, value) != #less;
      };
      case (#termsAt_lt(value)) {
        Nat64.compare(doc.termsAt, value) == #less;
      };
      case (#termsAt_lte(value)) {
        Nat64.compare(doc.termsAt, value) != #greater;
      };
      case (#termsVersion_eq(value)) {
        doc.termsVersion == value;
      };
      case (#termsVersion_gt(value)) {
        Nat.compare(doc.termsVersion, value) == #greater;
      };
      case (#termsVersion_gte(value)) {
        Nat.compare(doc.termsVersion, value) != #less;
      };
      case (#termsVersion_lt(value)) {
        Nat.compare(doc.termsVersion, value) == #less;
      };
      case (#termsVersion_lte(value)) {
        Nat.compare(doc.termsVersion, value) != #greater;
      };
      case (#anonymized_eq(value)) {
        doc.anonymized == value;
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

  public func passes(doc : UserTable.Types.User, filters : [Filter]) : Bool {
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
    func push(doc : UserTable.Types.User) : () {
      List.add<Row>(rows, { doc = doc });
      produced += 1;
    };
    func consider(doc : UserTable.Types.User) : Bool {
      if (not passes(doc, filters)) return false;
      if (not underLimit()) { hasMore := true; return true };
      push(doc);
      false;
    };
    switch (params.order) {
      case (#byId(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let iter = db.users.iterPrimary(iterDir, opts.from);
        AshrootQueryRuntime.drain(
          iter,
          func(entry : (Nat64, UserTable.Types.User)) : Bool {
            let (_pk, doc) = entry;
            return consider(doc);
          },
        );
      };
      case (#by_byPrincipal(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Principal> = AshrootQueryRuntime.makeRange<Principal>(dir, opts.from, iterDir);
        let iter = db.users.byPrincipal.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byHandle(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Text> = AshrootQueryRuntime.makeRange<Text>(dir, opts.from, iterDir);
        let iter = db.users.byHandle.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byCreated(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat64> = AshrootQueryRuntime.makeRange<Nat64>(dir, opts.from, iterDir);
        let iter = db.users.byCreated.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byHackerHandle(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Text> = AshrootQueryRuntime.makeRange<Text>(dir, opts.from, iterDir);
        let iter = db.users.byHackerHandle.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byObserverHandle(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Text> = AshrootQueryRuntime.makeRange<Text>(dir, opts.from, iterDir);
        let iter = db.users.byObserverHandle.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byModeratorHandle(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Text> = AshrootQueryRuntime.makeRange<Text>(dir, opts.from, iterDir);
        let iter = db.users.byModeratorHandle.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byJudgeHandle(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat, Text)> = AshrootQueryRuntime.makeRange<(Nat, Text)>(dir, opts.from, iterDir);
        let iter = db.users.byJudgeHandle.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_bySponsorHandle(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<(Nat, Text)> = AshrootQueryRuntime.makeRange<(Nat, Text)>(dir, opts.from, iterDir);
        let iter = db.users.bySponsorHandle.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byInstructions(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat> = AshrootQueryRuntime.makeRange<Nat>(dir, opts.from, iterDir);
        let iter = db.users.byInstructions.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byBytes(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Nat> = AshrootQueryRuntime.makeRange<Nat>(dir, opts.from, iterDir);
        let iter = db.users.byBytes.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
            return consider(doc);
          },
        );
      };
      case (#by_byAgent(opts)) {
        let dir = defaultDir(opts.dir);
        let iterDir = toIterDir(dir);
        let range : IndexRuntime.IndexRange<Principal> = AshrootQueryRuntime.makeRange<Principal>(dir, opts.from, iterDir);
        let iter = db.users.byAgent.rangeIter(range, null);
        AshrootQueryRuntime.drain(
          iter,
          func(doc : UserTable.Types.User) : Bool {
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
