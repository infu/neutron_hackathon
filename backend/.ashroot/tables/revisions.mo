// App review proposals (pending and settled).
// The row is the review snapshot: exact metadata, package, images, author, and
// target stay fixed until approval, rejection, or expiry.
import Map "mo:core/Map";
import Set "mo:core/Set";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Text "mo:core/Text";
import Iter "mo:core/Iter";
import PureList "mo:core/pure/List";
import Array "mo:core/Array";
import List "mo:core/List";
import Runtime "mo:core/Runtime";
import Result "mo:core/Result";

import IndexCore "mo:ashroot/index_core";
import IndexRuntime "mo:ashroot/index_runtime";
import Cursors "mo:ashroot/cursors";
import AshrootErrors "mo:ashroot/errors";
import AshrootRelations "mo:ashroot/relations";
import AshrootUseBundle "mo:ashroot/use_bundle";
import AshrootTableOps "mo:ashroot/table_ops";
import AshrootUseRuntime "mo:ashroot/use_runtime";
import AshrootUniqueRuntime "mo:ashroot/unique_runtime";
import AshrootPrimaryIter "mo:ashroot/primary_iter";
import AshrootListIter "mo:ashroot/list_iter";

module {
  public module Types {
    public module Revision {
      public module Kind {
        public type Type = {
          #entry;
          #version;
        };
      };
      public type Kind = Kind.Type;
      public type TargetEntryId = Nat64;
      public type Icon = Text;
      public module Shots {
        public type Element = Text;
        public type Type = [Element];
      };
      public type Shots = Shots.Type;
      public module Links {
        public module Element {
          public type Type = {
            kind : Text;
            url : Text;
          };
          public module Mutation {
            public type Type = {
              var kind : ?Text;
              var url : ?Text;
            };
            public func new() : Type {
              {
                var kind = null;
                var url = null;
              };
            };
          };
          public type Mutation = Mutation.Type;
          public func mut() : Mutation {
            Mutation.new();
          };
        };
        public type Element = Element.Type;
        public type Type = [Element];
      };
      public type Links = Links.Type;
      public type PkgKey = Text;
      public module State {
        public type Type = {
          #pending;
          #approved;
          #rejected;
          #expired;
        };
      };
      public type State = State.Type;
      public type Reviewer = Nat64;
      public type Type = {
        id : Nat64;
        user_id : Nat64;
        season_id : Nat64;
        week : Nat;
        kind : Kind;
        targetEntryId : ?TargetEntryId;
        title : Text;
        summary : Text;
        url : Text;
        icon : ?Icon;
        shots : Shots;
        links : Links;
        version : Text;
        note : Text;
        pkgKey : ?PkgKey;
        state : State;
        reason : Text;
        reviewer : ?Reviewer;
        createdAt : Nat64;
        decidedAt : Nat64;
        slug : Text;
      };
      public module Mutation {
        public type Type = {
          var id : ?Nat64;
          var user_id : ?Nat64;
          var season_id : ?Nat64;
          var week : ?Nat;
          var kind : ?Kind;
          var targetEntryId : ??TargetEntryId;
          var title : ?Text;
          var summary : ?Text;
          var url : ?Text;
          var icon : ??Icon;
          var shots : ?Shots;
          var links : ?Links;
          var version : ?Text;
          var note : ?Text;
          var pkgKey : ??PkgKey;
          var state : ?State;
          var reason : ?Text;
          var reviewer : ??Reviewer;
          var createdAt : ?Nat64;
          var decidedAt : ?Nat64;
          var slug : ?Text;
        };
        public func new() : Type {
          {
            var id = null;
            var user_id = null;
            var season_id = null;
            var week = null;
            var kind = null;
            var targetEntryId = null;
            var title = null;
            var summary = null;
            var url = null;
            var icon = null;
            var shots = null;
            var links = null;
            var version = null;
            var note = null;
            var pkgKey = null;
            var state = null;
            var reason = null;
            var reviewer = null;
            var createdAt = null;
            var decidedAt = null;
            var slug = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type Revision = Revision.Type;

    public module CreateRevision {
      public module Kind {
        public type Type = {
          #entry;
          #version;
        };
      };
      public type Kind = Kind.Type;
      public type TargetEntryId = Nat64;
      public type Icon = Text;
      public module Shots {
        public type Element = Text;
        public type Type = [Element];
      };
      public type Shots = Shots.Type;
      public module Links {
        public module Element {
          public type Type = {
            kind : Text;
            url : Text;
          };
          public module Mutation {
            public type Type = {
              var kind : ?Text;
              var url : ?Text;
            };
            public func new() : Type {
              {
                var kind = null;
                var url = null;
              };
            };
          };
          public type Mutation = Mutation.Type;
          public func mut() : Mutation {
            Mutation.new();
          };
        };
        public type Element = Element.Type;
        public type Type = [Element];
      };
      public type Links = Links.Type;
      public type PkgKey = Text;
      public module State {
        public type Type = {
          #pending;
          #approved;
          #rejected;
          #expired;
        };
      };
      public type State = State.Type;
      public type Reviewer = Nat64;
      public type Type = {
        user_id : Nat64;
        season_id : Nat64;
        week : Nat;
        kind : Kind;
        targetEntryId : ?TargetEntryId;
        title : Text;
        summary : Text;
        url : Text;
        icon : ?Icon;
        shots : Shots;
        links : Links;
        version : Text;
        note : Text;
        pkgKey : ?PkgKey;
        state : State;
        reason : Text;
        reviewer : ?Reviewer;
        createdAt : Nat64;
        decidedAt : Nat64;
        slug : Text;
      };
      public module Mutation {
        public type Type = {
          var user_id : ?Nat64;
          var season_id : ?Nat64;
          var week : ?Nat;
          var kind : ?Kind;
          var targetEntryId : ??TargetEntryId;
          var title : ?Text;
          var summary : ?Text;
          var url : ?Text;
          var icon : ??Icon;
          var shots : ?Shots;
          var links : ?Links;
          var version : ?Text;
          var note : ?Text;
          var pkgKey : ??PkgKey;
          var state : ?State;
          var reason : ?Text;
          var reviewer : ??Reviewer;
          var createdAt : ?Nat64;
          var decidedAt : ?Nat64;
          var slug : ?Text;
        };
        public func new() : Type {
          {
            var user_id = null;
            var season_id = null;
            var week = null;
            var kind = null;
            var targetEntryId = null;
            var title = null;
            var summary = null;
            var url = null;
            var icon = null;
            var shots = null;
            var links = null;
            var version = null;
            var note = null;
            var pkgKey = null;
            var state = null;
            var reason = null;
            var reviewer = null;
            var createdAt = null;
            var decidedAt = null;
            var slug = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type CreateRevision = CreateRevision.Type;
  };

  public module Errors {
    public type Error = AshrootErrors.Error;
  };

  public type RelationDeletePolicy = AshrootRelations.DeletePolicy;

  public type ForeignKeyManager = AshrootRelations.ForeignKeyManager<Types.Revision, Types.CreateRevision, Errors.Error>;

  public type ForeignKeyRuntime = AshrootRelations.ForeignKeyRuntime<Types.Revision, Types.CreateRevision, Errors.Error>;

  public type RelationBundle = AshrootRelations.Bundle<Types.Revision, Types.CreateRevision, Errors.Error>;

  public type RelationRuntimeBundle = AshrootRelations.RuntimeBundle<Types.Revision, Types.CreateRevision, Errors.Error>;

  public type Init = {
    var nextId : Nat64;
    rows : List.List<?Types.Revision>;
    var deletedSlots : PureList.List<Nat64>;
    var rowCount : Nat;
    pk_index : Set.Set<(Nat64, Nat64)>;
    idx_byQueue : Set.Set<((Nat, Nat64), Nat64)>;
    idx_byUser : Set.Set<(Nat64, Nat64)>;
    idx_bySlot : Set.Set<((Nat64, Nat, Nat64), Nat64)>;
  };

  public func init() : Init {
    {
      var nextId = Nat64.fromNat(1);
      rows = List.empty<?Types.Revision>();
      var deletedSlots = null;
      var rowCount = 0;
      pk_index = Set.empty<(Nat64, Nat64)>();
      idx_byQueue = Set.empty<((Nat, Nat64), Nat64)>();
      idx_byUser = Set.empty<(Nat64, Nat64)>();
      idx_bySlot = Set.empty<((Nat64, Nat, Nat64), Nat64)>();
    };
  };

  public type IndexRange<K> = IndexRuntime.IndexRange<K>;

  public type RangeDeleteResult = IndexRuntime.RangeDeleteResult;

  public type IndexDescriptor<K> = IndexRuntime.IndexDescriptor<K>;

  public type IndexOps<K> = IndexRuntime.IndexOps<K, Types.Revision, Errors.Error>;

  public type Use = AshrootTableOps.Common<Types.Revision, Types.CreateRevision, Errors.Error, Nat64> and {
    iterPrimary : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Types.Revision)>;
    iter : (IndexCore.Direction) -> Iter.Iter<Types.Revision>;
    byQueue : IndexOps<(Nat, Nat64)>;
    byUser : IndexOps<Nat64>;
    bySlot : IndexOps<(Nat64, Nat, Nat64)>;
  };

  public type UseBundle = AshrootUseBundle.Bundle<Use, Types.Revision, Types.CreateRevision, Errors.Error>;

  public func use(store : Init) : UseBundle {
    let cmpPK = Nat64.compare;

    let cmpK_byQueue = func(lhs : (Nat, Nat64), rhs : (Nat, Nat64)) : {
      #less;
      #equal;
      #greater;
    } {
      let cmp0 = Nat.compare(lhs.0, rhs.0);
      switch (cmp0) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      let cmp1 = Nat64.compare(lhs.1, rhs.1);
      switch (cmp1) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      #equal;
    };
    let cmpStore_byQueue = IndexCore.cmpStoreKey<(Nat, Nat64)>(cmpK_byQueue);

    let cmpK_byUser = Nat64.compare;
    let cmpStore_byUser = IndexCore.cmpStoreKey<Nat64>(cmpK_byUser);

    let cmpK_bySlot = func(lhs : (Nat64, Nat, Nat64), rhs : (Nat64, Nat, Nat64)) : {
      #less;
      #equal;
      #greater;
    } {
      let cmp0 = Nat64.compare(lhs.0, rhs.0);
      switch (cmp0) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      let cmp1 = Nat.compare(lhs.1, rhs.1);
      switch (cmp1) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      let cmp2 = Nat64.compare(lhs.2, rhs.2);
      switch (cmp2) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      #equal;
    };
    let cmpStore_bySlot = IndexCore.cmpStoreKey<(Nat64, Nat, Nat64)>(cmpK_bySlot);

    let keep_byQueue : IndexCore.Keep = #all;
    let keep_byUser : IndexCore.Keep = #all;
    let keep_bySlot : IndexCore.Keep = #all;

    let rowsStore = store.rows;
    let pk_indexStore = store.pk_index;
    let idx_byQueueStore = store.idx_byQueue;
    let idx_byUserStore = store.idx_byUser;
    let idx_bySlotStore = store.idx_bySlot;
    let cmpPKStore = IndexCore.cmpStoreKey<Nat64>(Nat64.compare);

    func slotToNat(slot : Nat64) : Nat { Nat64.toNat(slot) };

    func rowsGet(slot : Nat64) : ?Types.Revision {
      let idx = slotToNat(slot);
      switch (List.get(rowsStore, idx)) {
        case null null;
        case (?entry) entry;
      };
    };

    func rowsHas(slot : Nat64) : Bool {
      switch (rowsGet(slot)) {
        case (?_) true;
        case null false;
      };
    };

    func rowsPut(slot : Nat64, doc : Types.Revision) : () {
      List.put(rowsStore, slotToNat(slot), ?doc);
    };

    func rowsClear(slot : Nat64) : () {
      List.put(rowsStore, slotToNat(slot), null);
    };

    func pushFreeSlot(slot : Nat64) : () {
      store.deletedSlots := ?(slot, store.deletedSlots);
    };

    func popFreeSlot() : ?Nat64 {
      switch (store.deletedSlots) {
        case null null;
        case (?node) {
          let (slot, rest) = node;
          store.deletedSlots := rest;
          ?slot;
        };
      };
    };

    func allocSlot(doc : Types.Revision) : Nat64 {
      switch (popFreeSlot()) {
        case (?slot) {
          rowsPut(slot, doc);
          slot;
        };
        case null {
          let idx = List.size(rowsStore);
          let slot = Nat64.fromNat(idx);
          List.add(rowsStore, ?doc);
          slot;
        };
      };
    };

    func freeSlot(slot : Nat64) : () {
      rowsClear(slot);
      pushFreeSlot(slot);
    };

    func findSlot(pk : Nat64) : ?Nat64 {
      let iter = Set.valuesFrom(pk_indexStore, cmpPKStore, (pk, Nat64.fromNat(0)));
      switch (iter.next()) {
        case null null;
        case (?entry) {
          let (candidatePk, slot) = entry;
          switch (Nat64.compare(candidatePk, pk)) {
            case (#equal) ?slot;
            case (#greater) null;
            case (#less) null;
          };
        };
      };
    };

    func insertPkEntry(pk : Nat64, slot : Nat64) : () {
      ignore Set.insert(pk_indexStore, cmpPKStore, (pk, slot));
    };

    func removePkEntry(pk : Nat64, slot : Nat64) : () {
      ignore Set.delete(pk_indexStore, cmpPKStore, (pk, slot));
    };

    func projectPk(doc : Types.Revision) : Nat64 { doc.id };

    let rowAccess : IndexRuntime.RowStore<Types.Revision> = {
      get = rowsGet;
      has = rowsHas;
    };

    let nextIdManager = AshrootUseRuntime.manageNextId(store);

    func index_add_all(slot : Nat64, d : Types.Revision) : () {
      let key_byQueue = (func(d : Types.Revision) : (Nat, Nat64) { (switch (d.state) { case (#pending) 0; case (#approved) 1; case (#rejected) 2; case (#expired) 3 }, d.id) })(d);
      IndexCore.insertWithRetention(idx_byQueueStore, cmpStore_byQueue, keep_byQueue, (key_byQueue, slot));
      let key_byUser = d.user_id;
      IndexCore.insertWithRetention(idx_byUserStore, cmpStore_byUser, keep_byUser, (key_byUser, slot));
      let key_bySlot = (func(d : Types.Revision) : (Nat64, Nat, Nat64) { (d.season_id, d.week, key_byUser) })(d);
      IndexCore.insertWithRetention(idx_bySlotStore, cmpStore_bySlot, keep_bySlot, (key_bySlot, slot));
    };

    func index_del_all(slot : Nat64, d : Types.Revision) : () {
      let key_byQueue = (func(d : Types.Revision) : (Nat, Nat64) { (switch (d.state) { case (#pending) 0; case (#approved) 1; case (#rejected) 2; case (#expired) 3 }, d.id) })(d);
      IndexCore.deleteKey(idx_byQueueStore, cmpStore_byQueue, (key_byQueue, slot));
      let key_byUser = d.user_id;
      IndexCore.deleteKey(idx_byUserStore, cmpStore_byUser, (key_byUser, slot));
      let key_bySlot = (func(d : Types.Revision) : (Nat64, Nat, Nat64) { (d.season_id, d.week, key_byUser) })(d);
      IndexCore.deleteKey(idx_bySlotStore, cmpStore_bySlot, (key_bySlot, slot));
    };

    func index_refresh_on_update(slot : Nat64, prev : Types.Revision, next : Types.Revision) : () {
      let prevKey_byQueue = (func(prev : Types.Revision) : (Nat, Nat64) { (switch (prev.state) { case (#pending) 0; case (#approved) 1; case (#rejected) 2; case (#expired) 3 }, prev.id) })(prev);
      let nextKey_byQueue = (func(next : Types.Revision) : (Nat, Nat64) { (switch (next.state) { case (#pending) 0; case (#approved) 1; case (#rejected) 2; case (#expired) 3 }, next.id) })(next);
      var changed_byQueue : Bool = false;
      if (cmpK_byQueue(prevKey_byQueue, nextKey_byQueue) != #equal) {
        IndexCore.deleteKey(idx_byQueueStore, cmpStore_byQueue, (prevKey_byQueue, slot));
        IndexCore.insertWithRetention(idx_byQueueStore, cmpStore_byQueue, keep_byQueue, (nextKey_byQueue, slot));
        changed_byQueue := true;
      };

      let prevKey_byUser = prev.user_id;
      let nextKey_byUser = next.user_id;
      var changed_byUser : Bool = false;
      if (cmpK_byUser(prevKey_byUser, nextKey_byUser) != #equal) {
        IndexCore.deleteKey(idx_byUserStore, cmpStore_byUser, (prevKey_byUser, slot));
        IndexCore.insertWithRetention(idx_byUserStore, cmpStore_byUser, keep_byUser, (nextKey_byUser, slot));
        changed_byUser := true;
      };

      let prevKey_bySlot = (func(prev : Types.Revision) : (Nat64, Nat, Nat64) { (prev.season_id, prev.week, prev.user_id) })(prev);
      let nextKey_bySlot = (func(next : Types.Revision) : (Nat64, Nat, Nat64) { (next.season_id, next.week, next.user_id) })(next);
      var changed_bySlot : Bool = false;
      if (cmpK_bySlot(prevKey_bySlot, nextKey_bySlot) != #equal) {
        IndexCore.deleteKey(idx_bySlotStore, cmpStore_bySlot, (prevKey_bySlot, slot));
        IndexCore.insertWithRetention(idx_bySlotStore, cmpStore_bySlot, keep_bySlot, (nextKey_bySlot, slot));
        changed_bySlot := true;
      };
    };

    func validateCreateConstraints(data : Types.CreateRevision) : Result.Result<(), Errors.Error> {
      let len_title = Text.size(data.title);
      if (len_title > 80) {
        return #err(#ConstraintViolation({ field = "title"; message = "length must be <= 80" }));
      };
      let len_summary = Text.size(data.summary);
      if (len_summary > 600) {
        return #err(#ConstraintViolation({ field = "summary"; message = "length must be <= 600" }));
      };
      let len_url = Text.size(data.url);
      if (len_url > 256) {
        return #err(#ConstraintViolation({ field = "url"; message = "length must be <= 256" }));
      };
      let len_version = Text.size(data.version);
      if (len_version > 24) {
        return #err(#ConstraintViolation({ field = "version"; message = "length must be <= 24" }));
      };
      let len_note = Text.size(data.note);
      if (len_note > 500) {
        return #err(#ConstraintViolation({ field = "note"; message = "length must be <= 500" }));
      };
      let len_reason = Text.size(data.reason);
      if (len_reason > 2000) {
        return #err(#ConstraintViolation({ field = "reason"; message = "length must be <= 2000" }));
      };
      let len_slug = Text.size(data.slug);
      if (len_slug > 50) {
        return #err(#ConstraintViolation({ field = "slug"; message = "length must be <= 50" }));
      };
      #ok();
    };

    func validateDocConstraints(doc : Types.Revision) : Result.Result<(), Errors.Error> {
      let len_title = Text.size(doc.title);
      if (len_title > 80) {
        return #err(#ConstraintViolation({ field = "title"; message = "length must be <= 80" }));
      };
      let len_summary = Text.size(doc.summary);
      if (len_summary > 600) {
        return #err(#ConstraintViolation({ field = "summary"; message = "length must be <= 600" }));
      };
      let len_url = Text.size(doc.url);
      if (len_url > 256) {
        return #err(#ConstraintViolation({ field = "url"; message = "length must be <= 256" }));
      };
      let len_version = Text.size(doc.version);
      if (len_version > 24) {
        return #err(#ConstraintViolation({ field = "version"; message = "length must be <= 24" }));
      };
      let len_note = Text.size(doc.note);
      if (len_note > 500) {
        return #err(#ConstraintViolation({ field = "note"; message = "length must be <= 500" }));
      };
      let len_reason = Text.size(doc.reason);
      if (len_reason > 2000) {
        return #err(#ConstraintViolation({ field = "reason"; message = "length must be <= 2000" }));
      };
      let len_slug = Text.size(doc.slug);
      if (len_slug > 50) {
        return #err(#ConstraintViolation({ field = "slug"; message = "length must be <= 50" }));
      };
      #ok();
    };

    func makeDoc(id : Nat64, data : Types.CreateRevision) : Types.Revision {
      {
        id = id;
        user_id = data.user_id;
        season_id = data.season_id;
        week = data.week;
        kind = data.kind;
        targetEntryId = data.targetEntryId;
        title = data.title;
        summary = data.summary;
        url = data.url;
        icon = data.icon;
        shots = data.shots;
        links = data.links;
        version = data.version;
        note = data.note;
        pkgKey = data.pkgKey;
        state = data.state;
        reason = data.reason;
        reviewer = data.reviewer;
        createdAt = data.createdAt;
        decidedAt = data.decidedAt;
        slug = data.slug;
      };
    };

    func insertOne(data : Types.CreateRevision) : Result.Result<Nat64, Errors.Error> {
      var candidate : Nat64 = nextIdManager.current();
      while (findSlot(candidate) != null) {
        if (candidate == Nat64.maxValue) {
          return #err(#Internal("auto-increment exhausted"));
        };
        candidate += 1;
      };
      switch (validateCreateConstraints(data)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      let doc = makeDoc(candidate, data);
      switch (validateDocConstraints(doc)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      let slot = allocSlot(doc);
      insertPkEntry(doc.id, slot);
      store.rowCount += 1;
      index_add_all(slot, doc);
      nextIdManager.ensureAfter(candidate);
      #ok(candidate);
    };

    func getOne(pk : Nat64) : ?Types.Revision {
      switch (findSlot(pk)) {
        case null null;
        case (?slot) rowsGet(slot);
      };
    };

    func existsOne(pk : Nat64) : Bool {
      switch (findSlot(pk)) {
        case (?slot) rowsHas(slot);
        case null false;
      };
    };

    func updateOne(doc : Types.Revision) : Result.Result<Types.Revision, Errors.Error> {
      let pk = doc.id;
      switch (findSlot(pk)) {
        case (?slot) {
          switch (rowsGet(slot)) {
            case null { return #err(#NotFound(pk)) };
            case (?prev) {
              switch (validateDocConstraints(doc)) {
                case (#ok()) {};
                case (#err(e)) { return #err(e) };
              };
              rowsPut(slot, doc);
              index_refresh_on_update(slot, prev, doc);
              nextIdManager.ensureAfter(pk);
              #ok(doc);
            };
          };
        };
        case null {
          #err(#NotFound(pk));
        };
      };
    };

    func upsertOne(doc : Types.Revision) : Result.Result<{ #inserted; #updated }, Errors.Error> {
      let pk = doc.id;
      switch (validateDocConstraints(doc)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      switch (findSlot(pk)) {
        case (?slot) {
          switch (rowsGet(slot)) {
            case null {
              return #err(#NotFound(pk));
            };
            case (?prev) {
              rowsPut(slot, doc);
              index_refresh_on_update(slot, prev, doc);
              nextIdManager.ensureAfter(pk);
              #ok(#updated);
            };
          };
        };
        case null {
          let slot = allocSlot(doc);
          insertPkEntry(doc.id, slot);
          store.rowCount += 1;
          index_add_all(slot, doc);
          nextIdManager.ensureAfter(pk);
          #ok(#inserted);
        };
      };
    };

    func deleteOne(pk : Nat64) : Result.Result<(), Errors.Error> {
      switch (findSlot(pk)) {
        case null { #err(#NotFound(pk)) };
        case (?slot) {
          switch (rowsGet(slot)) {
            case null { #err(#NotFound(pk)) };
            case (?doc) { deleteDoc(slot, doc) };
          };
        };
      };
    };

    func insertManyImpl(records : [Types.CreateRevision]) : Result.Result<[Nat64], Errors.Error> {
      let len = Array.size(records);
      let buf : [var Nat64] = Array.toVarArray(Array.repeat<Nat64>(Nat64.fromNat(0), len));
      var i : Nat = 0;
      for (rec in records.vals()) {
        switch (insertOne(rec)) {
          case (#ok(id)) {
            buf[i] := id;
            i += 1;
          };
          case (#err(e)) { return #err(e) };
        };
      };
      #ok(Array.fromVarArray(buf));
    };

    func upsertManyImpl(records : [Types.Revision]) : Result.Result<{ inserted : Nat; updated : Nat }, Errors.Error> {
      var inserted : Nat = 0;
      var updated : Nat = 0;
      for (rec in records.vals()) {
        switch (upsertOne(rec)) {
          case (#ok(#inserted)) { inserted += 1 };
          case (#ok(#updated)) { updated += 1 };
          case (#err(e)) { return #err(e) };
        };
      };
      #ok({ inserted; updated });
    };

    func getManyImpl(pks : [Nat64]) : [(Nat64, ?Types.Revision)] {
      Array.tabulate<(Nat64, ?Types.Revision)>(
        Array.size(pks),
        func(i : Nat) : (Nat64, ?Types.Revision) {
          let pk = pks[i];
          let value = switch (findSlot(pk)) {
            case (?slot) rowsGet(slot);
            case null null;
          };
          (pk, value);
        },
      );
    };

    func deleteManyImpl(pks : [Nat64]) : Result.Result<Nat, Errors.Error> {
      var removed : Nat = 0;
      for (pk in pks.vals()) {
        switch (deleteOne(pk)) {
          case (#ok()) { removed += 1 };
          case (#err(e)) { return #err(e) };
        };
      };
      #ok(removed);
    };

    let deleteDoc = func(slot : Nat64, d : Types.Revision) : Result.Result<(), Errors.Error> {
      index_del_all(slot, d);
      removePkEntry(d.id, slot);
      freeSlot(slot);
      if (store.rowCount > 0) { store.rowCount -= 1 };
      #ok();
    };

    func encodeNat64Cursor(dir : IndexCore.Direction, entry : (Nat64, Nat64)) : Cursors.Token {
      let (k, pk) = entry;
      Cursors.encodeNat64(dir, k, pk);
    };

    func encodeByQueueCursor(dir : IndexCore.Direction, entry : ((Nat, Nat64), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1) = storeKey;
      Cursors.encodeComposite(dir, "Nat_Nat64", [Cursors.encodeSegmentNat(k0), Cursors.encodeSegmentNat64(k1)], pk);
    };

    func decodeByQueueCursor(token : Cursors.Token) : ?((Nat, Nat64), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat_Nat64", 2)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentNat64(segments[1]) else return null;
          let key = (k0, k1);
          ?(key, pk);
        };
        case null null;
      };
    };

    func encodeBySlotCursor(dir : IndexCore.Direction, entry : ((Nat64, Nat, Nat64), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1, k2) = storeKey;
      Cursors.encodeComposite(dir, "Nat64_Nat_Nat64", [Cursors.encodeSegmentNat64(k0), Cursors.encodeSegmentNat(k1), Cursors.encodeSegmentNat64(k2)], pk);
    };

    func decodeBySlotCursor(token : Cursors.Token) : ?((Nat64, Nat, Nat64), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat64_Nat_Nat64", 3)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat64(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentNat(segments[1]) else return null;
          let ?k2 = Cursors.decodeSegmentNat64(segments[2]) else return null;
          let key = (k0, k1, k2);
          ?(key, pk);
        };
        case null null;
      };
    };

    let byQueueFind = func(dir : IndexCore.Direction, start : (Nat, Nat64), limit : Nat) : Iter.Iter<Types.Revision> {
      IndexRuntime.makeFindIter<(Nat, Nat64), Types.Revision>(rowAccess, idx_byQueueStore, cmpStore_byQueue, cmpK_byQueue, dir, start, limit);
    };

    let byUserFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Revision> {
      IndexRuntime.makeFindIter<Nat64, Types.Revision>(rowAccess, idx_byUserStore, cmpStore_byUser, cmpK_byUser, dir, start, limit);
    };

    let bySlotFind = func(dir : IndexCore.Direction, start : (Nat64, Nat, Nat64), limit : Nat) : Iter.Iter<Types.Revision> {
      IndexRuntime.makeFindIter<(Nat64, Nat, Nat64), Types.Revision>(rowAccess, idx_bySlotStore, cmpStore_bySlot, cmpK_bySlot, dir, start, limit);
    };

    let byQueueOps = IndexRuntime.makeIndexOps<(Nat, Nat64), Types.Revision, Errors.Error>(
      "byQueue",
      idx_byQueueStore,
      cmpK_byQueue,
      cmpStore_byQueue,
      keep_byQueue,
      rowAccess,
      projectPk,
      decodeByQueueCursor,
      encodeByQueueCursor,
      byQueueFind,
      deleteDoc,
    );

    let byUserOps = IndexRuntime.makeIndexOps<Nat64, Types.Revision, Errors.Error>(
      "byUser",
      idx_byUserStore,
      cmpK_byUser,
      cmpStore_byUser,
      keep_byUser,
      rowAccess,
      projectPk,
      Cursors.decodeNat64,
      encodeNat64Cursor,
      byUserFind,
      deleteDoc,
    );

    let bySlotOps = IndexRuntime.makeIndexOps<(Nat64, Nat, Nat64), Types.Revision, Errors.Error>(
      "bySlot",
      idx_bySlotStore,
      cmpK_bySlot,
      cmpStore_bySlot,
      keep_bySlot,
      rowAccess,
      projectPk,
      decodeBySlotCursor,
      encodeBySlotCursor,
      bySlotFind,
      deleteDoc,
    );

    let iterPrimary = AshrootPrimaryIter.make(rowAccess, pk_indexStore, cmpPKStore);
    let iter = AshrootListIter.make(rowsStore);
    let mapIter = func<R>(dir : IndexCore.Direction, f : Types.Revision -> R) : Iter.Iter<R> {
      let base = iter(dir);
      {
        next = func() : ?R {
          switch (base.next()) {
            case (?doc) { ?f(doc) };
            case null null;
          };
        };
      };
    };
    let foldIter = func<A>(dir : IndexCore.Direction, init : A, f : (A, Types.Revision) -> A) : A {
      let base = iter(dir);
      IndexRuntime.foldFromIter(base, init, f);
    };

    let table : Use = {
      insert = insertOne;
      insertMany = insertManyImpl;
      update = updateOne;
      upsert = upsertOne;
      upsertMany = upsertManyImpl;
      get = getOne;
      getMany = getManyImpl;
      exists = existsOne;
      delete = deleteOne;
      deleteMany = deleteManyImpl;
      size = func() : Nat {
        store.rowCount;
      };
      iterPrimary = iterPrimary;
      iter = iter;
      map = mapIter;
      fold = foldIter;
      byQueue = byQueueOps;
      byUser = byUserOps;
      bySlot = bySlotOps;
    };

    let relations : RelationBundle = {
      foreignKeys = [];
    };
    let relationsInternal : RelationRuntimeBundle = {
      foreignKeys = [];
    };

    { table; relations; relationsInternal };

  };
};
