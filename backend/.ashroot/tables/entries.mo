/// Apps as they appear in the competition bracket.
///
/// Qualifier origins remain distinct rows. Slot and rank keys drive
/// deterministic advancement; owner, season, and slug keys serve public views.
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
import TextRange "mo:ashroot/text_range";
import AshrootTextIndexOps "mo:ashroot/text_index_ops";

module {
  public module Types {
    public module Entry {
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
      public module Pkg {
        public type Type = {
          key : Text;
          name : Text;
          size : Nat;
          version : Text;
          at : Nat64;
        };
        public module Mutation {
          public type Type = {
            var key : ?Text;
            var name : ?Text;
            var size : ?Nat;
            var version : ?Text;
            var at : ?Nat64;
          };
          public func new() : Type {
            {
              var key = null;
              var name = null;
              var size = null;
              var version = null;
              var at = null;
            };
          };
        };
        public type Mutation = Mutation.Type;
        public func mut() : Mutation {
          Mutation.new();
        };
      };
      public type Pkg = Pkg.Type;
      public module Updates {
        public module Element {
          public module Upload {
            public type Type = {
              name : Text;
              size : Nat;
            };
            public module Mutation {
              public type Type = {
                var name : ?Text;
                var size : ?Nat;
              };
              public func new() : Type {
                {
                  var name = null;
                  var size = null;
                };
              };
            };
            public type Mutation = Mutation.Type;
            public func mut() : Mutation {
              Mutation.new();
            };
          };
          public type Upload = Upload.Type;
          public type Type = {
            version : Text;
            note : Text;
            at : Nat64;
            upload : ?Upload;
          };
          public module Mutation {
            public type Type = {
              var version : ?Text;
              var note : ?Text;
              var at : ?Nat64;
              var upload : ??Upload;
            };
            public func new() : Type {
              {
                var version = null;
                var note = null;
                var at = null;
                var upload = null;
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
      public type Updates = Updates.Type;
      public module Outcome {
        public type Type = {
          #none;
          #rewarded;
          #advanced;
          #won;
        };
      };
      public type Outcome = Outcome.Type;
      public type OriginId = Nat64;
      public type Type = {
        id : Nat64;
        season_id : Nat64;
        user_id : Nat64;
        week : Nat;
        title : Text;
        summary : Text;
        url : Text;
        icon : ?Icon;
        shots : Shots;
        links : Links;
        pkg : ?Pkg;
        updates : Updates;
        votes : Nat;
        outcome : Outcome;
        origin_id : ?OriginId;
        createdAt : Nat64;
        updatedAt : Nat64;
        slug : Text;
        takedownAt : Nat64;
        takedownReason : Text;
      };
      public module Mutation {
        public type Type = {
          var id : ?Nat64;
          var season_id : ?Nat64;
          var user_id : ?Nat64;
          var week : ?Nat;
          var title : ?Text;
          var summary : ?Text;
          var url : ?Text;
          var icon : ??Icon;
          var shots : ?Shots;
          var links : ?Links;
          var pkg : ??Pkg;
          var updates : ?Updates;
          var votes : ?Nat;
          var outcome : ?Outcome;
          var origin_id : ??OriginId;
          var createdAt : ?Nat64;
          var updatedAt : ?Nat64;
          var slug : ?Text;
          var takedownAt : ?Nat64;
          var takedownReason : ?Text;
        };
        public func new() : Type {
          {
            var id = null;
            var season_id = null;
            var user_id = null;
            var week = null;
            var title = null;
            var summary = null;
            var url = null;
            var icon = null;
            var shots = null;
            var links = null;
            var pkg = null;
            var updates = null;
            var votes = null;
            var outcome = null;
            var origin_id = null;
            var createdAt = null;
            var updatedAt = null;
            var slug = null;
            var takedownAt = null;
            var takedownReason = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type Entry = Entry.Type;

    public module CreateEntry {
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
      public module Pkg {
        public type Type = {
          key : Text;
          name : Text;
          size : Nat;
          version : Text;
          at : Nat64;
        };
        public module Mutation {
          public type Type = {
            var key : ?Text;
            var name : ?Text;
            var size : ?Nat;
            var version : ?Text;
            var at : ?Nat64;
          };
          public func new() : Type {
            {
              var key = null;
              var name = null;
              var size = null;
              var version = null;
              var at = null;
            };
          };
        };
        public type Mutation = Mutation.Type;
        public func mut() : Mutation {
          Mutation.new();
        };
      };
      public type Pkg = Pkg.Type;
      public module Updates {
        public module Element {
          public module Upload {
            public type Type = {
              name : Text;
              size : Nat;
            };
            public module Mutation {
              public type Type = {
                var name : ?Text;
                var size : ?Nat;
              };
              public func new() : Type {
                {
                  var name = null;
                  var size = null;
                };
              };
            };
            public type Mutation = Mutation.Type;
            public func mut() : Mutation {
              Mutation.new();
            };
          };
          public type Upload = Upload.Type;
          public type Type = {
            version : Text;
            note : Text;
            at : Nat64;
            upload : ?Upload;
          };
          public module Mutation {
            public type Type = {
              var version : ?Text;
              var note : ?Text;
              var at : ?Nat64;
              var upload : ??Upload;
            };
            public func new() : Type {
              {
                var version = null;
                var note = null;
                var at = null;
                var upload = null;
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
      public type Updates = Updates.Type;
      public module Outcome {
        public type Type = {
          #none;
          #rewarded;
          #advanced;
          #won;
        };
      };
      public type Outcome = Outcome.Type;
      public type OriginId = Nat64;
      public type Type = {
        season_id : Nat64;
        user_id : Nat64;
        week : Nat;
        title : Text;
        summary : Text;
        url : Text;
        icon : ?Icon;
        shots : Shots;
        links : Links;
        pkg : ?Pkg;
        updates : Updates;
        votes : Nat;
        outcome : Outcome;
        origin_id : ?OriginId;
        createdAt : Nat64;
        updatedAt : Nat64;
        slug : Text;
        takedownAt : Nat64;
        takedownReason : Text;
      };
      public module Mutation {
        public type Type = {
          var season_id : ?Nat64;
          var user_id : ?Nat64;
          var week : ?Nat;
          var title : ?Text;
          var summary : ?Text;
          var url : ?Text;
          var icon : ??Icon;
          var shots : ?Shots;
          var links : ?Links;
          var pkg : ??Pkg;
          var updates : ?Updates;
          var votes : ?Nat;
          var outcome : ?Outcome;
          var origin_id : ??OriginId;
          var createdAt : ?Nat64;
          var updatedAt : ?Nat64;
          var slug : ?Text;
          var takedownAt : ?Nat64;
          var takedownReason : ?Text;
        };
        public func new() : Type {
          {
            var season_id = null;
            var user_id = null;
            var week = null;
            var title = null;
            var summary = null;
            var url = null;
            var icon = null;
            var shots = null;
            var links = null;
            var pkg = null;
            var updates = null;
            var votes = null;
            var outcome = null;
            var origin_id = null;
            var createdAt = null;
            var updatedAt = null;
            var slug = null;
            var takedownAt = null;
            var takedownReason = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type CreateEntry = CreateEntry.Type;
  };

  public module Errors {
    public type Error = AshrootErrors.Error;
  };

  public type RelationDeletePolicy = AshrootRelations.DeletePolicy;

  public type ForeignKeyManager = AshrootRelations.ForeignKeyManager<Types.Entry, Types.CreateEntry, Errors.Error>;

  public type ForeignKeyRuntime = AshrootRelations.ForeignKeyRuntime<Types.Entry, Types.CreateEntry, Errors.Error>;

  public type RelationBundle = AshrootRelations.Bundle<Types.Entry, Types.CreateEntry, Errors.Error>;

  public type RelationRuntimeBundle = AshrootRelations.RuntimeBundle<Types.Entry, Types.CreateEntry, Errors.Error>;

  public type Init = {
    var nextId : Nat64;
    rows : List.List<?Types.Entry>;
    var deletedSlots : PureList.List<Nat64>;
    var rowCount : Nat;
    pk_index : Set.Set<(Nat64, Nat64)>;
    idx_bySlot : Set.Set<((Nat64, Nat, Nat64, Nat64), Nat64)>;
    idx_byRank : Set.Set<((Nat64, Nat, Nat, Nat64), Nat64)>;
    idx_byUser : Set.Set<(Nat64, Nat64)>;
    idx_bySeason : Set.Set<(Nat64, Nat64)>;
    idx_bySlug : Set.Set<(Text, Nat64)>;
  };

  public func init() : Init {
    {
      var nextId = Nat64.fromNat(1);
      rows = List.empty<?Types.Entry>();
      var deletedSlots = null;
      var rowCount = 0;
      pk_index = Set.empty<(Nat64, Nat64)>();
      idx_bySlot = Set.empty<((Nat64, Nat, Nat64, Nat64), Nat64)>();
      idx_byRank = Set.empty<((Nat64, Nat, Nat, Nat64), Nat64)>();
      idx_byUser = Set.empty<(Nat64, Nat64)>();
      idx_bySeason = Set.empty<(Nat64, Nat64)>();
      idx_bySlug = Set.empty<(Text, Nat64)>();
    };
  };

  public type IndexRange<K> = IndexRuntime.IndexRange<K>;

  public type RangeDeleteResult = IndexRuntime.RangeDeleteResult;

  public type IndexDescriptor<K> = IndexRuntime.IndexDescriptor<K>;

  public type IndexOps<K> = IndexRuntime.IndexOps<K, Types.Entry, Errors.Error>;

  public type TextIndexOps = AshrootTextIndexOps.Ops<Types.Entry, Errors.Error>;

  public type Use = AshrootTableOps.Common<Types.Entry, Types.CreateEntry, Errors.Error, Nat64> and {
    iterPrimary : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Types.Entry)>;
    iter : (IndexCore.Direction) -> Iter.Iter<Types.Entry>;
    bySlot : IndexOps<(Nat64, Nat, Nat64, Nat64)>;
    byRank : IndexOps<(Nat64, Nat, Nat, Nat64)>;
    byUser : IndexOps<Nat64>;
    bySeason : IndexOps<Nat64>;
    bySlug : TextIndexOps;
  };

  public type UseBundle = AshrootUseBundle.Bundle<Use, Types.Entry, Types.CreateEntry, Errors.Error>;

  public func use(store : Init) : UseBundle {
    let cmpPK = Nat64.compare;

    let cmpK_bySlot = func(lhs : (Nat64, Nat, Nat64, Nat64), rhs : (Nat64, Nat, Nat64, Nat64)) : {
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
      let cmp3 = Nat64.compare(lhs.3, rhs.3);
      switch (cmp3) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      #equal;
    };
    let cmpStore_bySlot = IndexCore.cmpStoreKey<(Nat64, Nat, Nat64, Nat64)>(cmpK_bySlot);

    let cmpK_byRank = func(lhs : (Nat64, Nat, Nat, Nat64), rhs : (Nat64, Nat, Nat, Nat64)) : {
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
      let cmp2 = Nat.compare(lhs.2, rhs.2);
      switch (cmp2) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      let cmp3 = Nat64.compare(lhs.3, rhs.3);
      switch (cmp3) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      #equal;
    };
    let cmpStore_byRank = IndexCore.cmpStoreKey<(Nat64, Nat, Nat, Nat64)>(cmpK_byRank);

    let cmpK_byUser = Nat64.compare;
    let cmpStore_byUser = IndexCore.cmpStoreKey<Nat64>(cmpK_byUser);

    let cmpK_bySeason = Nat64.compare;
    let cmpStore_bySeason = IndexCore.cmpStoreKey<Nat64>(cmpK_bySeason);

    let cmpK_bySlug = Text.compare;
    let cmpStore_bySlug = IndexCore.cmpStoreKey<Text>(cmpK_bySlug);

    let keep_bySlot : IndexCore.Keep = #all;
    let keep_byRank : IndexCore.Keep = #all;
    let keep_byUser : IndexCore.Keep = #all;
    let keep_bySeason : IndexCore.Keep = #all;
    let keep_bySlug : IndexCore.Keep = #all;

    let rowsStore = store.rows;
    let pk_indexStore = store.pk_index;
    let idx_bySlotStore = store.idx_bySlot;
    let idx_byRankStore = store.idx_byRank;
    let idx_byUserStore = store.idx_byUser;
    let idx_bySeasonStore = store.idx_bySeason;
    let idx_bySlugStore = store.idx_bySlug;
    let cmpPKStore = IndexCore.cmpStoreKey<Nat64>(Nat64.compare);

    func slotToNat(slot : Nat64) : Nat { Nat64.toNat(slot) };

    func rowsGet(slot : Nat64) : ?Types.Entry {
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

    func rowsPut(slot : Nat64, doc : Types.Entry) : () {
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

    func allocSlot(doc : Types.Entry) : Nat64 {
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

    func projectPk(doc : Types.Entry) : Nat64 { doc.id };

    let rowAccess : IndexRuntime.RowStore<Types.Entry> = {
      get = rowsGet;
      has = rowsHas;
    };

    let nextIdManager = AshrootUseRuntime.manageNextId(store);

    type UniqueFields = {
      bySlot : AshrootUniqueRuntime.FieldChange<(Nat64, Nat, Nat64, Nat64)>;
    };
    type UniqueChange = AshrootUniqueRuntime.UniqueChange<UniqueFields>;

    func compute_unique_change(prev : Types.Entry, next : Types.Entry) : UniqueChange {
      AshrootUniqueRuntime.compute(
        prev,
        next,
        func(prevDoc : Types.Entry, nextDoc : Types.Entry) : UniqueFields {
          {
            bySlot = do {
              let prevKey = (func(prevDoc : Types.Entry) : (Nat64, Nat, Nat64, Nat64) { (prevDoc.season_id, prevDoc.week, prevDoc.user_id, switch (prevDoc.origin_id) { case (?o) o; case null 0 }) })(prevDoc);
              let nextKey = (func(nextDoc : Types.Entry) : (Nat64, Nat, Nat64, Nat64) { (nextDoc.season_id, nextDoc.week, nextDoc.user_id, switch (nextDoc.origin_id) { case (?o) o; case null 0 }) })(nextDoc);
              {
                changed = cmpK_bySlot(prevKey, nextKey) != #equal;
                prev = prevKey;
                next = nextKey;
              };
            };
          };
        },
        func(fields : UniqueFields) : Bool {
          fields.bySlot.changed;
        },
      );
    };

    func index_add_all(slot : Nat64, d : Types.Entry) : () {
      let key_bySlot = (func(d : Types.Entry) : (Nat64, Nat, Nat64, Nat64) { (d.season_id, d.week, d.user_id, switch (d.origin_id) { case (?o) o; case null 0 }) })(d);
      IndexCore.insertWithRetention(idx_bySlotStore, cmpStore_bySlot, keep_bySlot, (key_bySlot, slot));
      let key_byRank = (func(d : Types.Entry) : (Nat64, Nat, Nat, Nat64) { (d.season_id, d.week, d.votes, (18_446_744_073_709_551_615 : Nat64) - d.id) })(d);
      IndexCore.insertWithRetention(idx_byRankStore, cmpStore_byRank, keep_byRank, (key_byRank, slot));
      let key_byUser = d.user_id;
      IndexCore.insertWithRetention(idx_byUserStore, cmpStore_byUser, keep_byUser, (key_byUser, slot));
      let key_bySeason = d.season_id;
      IndexCore.insertWithRetention(idx_bySeasonStore, cmpStore_bySeason, keep_bySeason, (key_bySeason, slot));
      let key_bySlug = d.slug;
      IndexCore.insertWithRetention(idx_bySlugStore, cmpStore_bySlug, keep_bySlug, (key_bySlug, slot));
    };

    func index_del_all(slot : Nat64, d : Types.Entry) : () {
      let key_bySlot = (func(d : Types.Entry) : (Nat64, Nat, Nat64, Nat64) { (d.season_id, d.week, d.user_id, switch (d.origin_id) { case (?o) o; case null 0 }) })(d);
      IndexCore.deleteKey(idx_bySlotStore, cmpStore_bySlot, (key_bySlot, slot));
      let key_byRank = (func(d : Types.Entry) : (Nat64, Nat, Nat, Nat64) { (d.season_id, d.week, d.votes, (18_446_744_073_709_551_615 : Nat64) - d.id) })(d);
      IndexCore.deleteKey(idx_byRankStore, cmpStore_byRank, (key_byRank, slot));
      let key_byUser = d.user_id;
      IndexCore.deleteKey(idx_byUserStore, cmpStore_byUser, (key_byUser, slot));
      let key_bySeason = d.season_id;
      IndexCore.deleteKey(idx_bySeasonStore, cmpStore_bySeason, (key_bySeason, slot));
      let key_bySlug = d.slug;
      IndexCore.deleteKey(idx_bySlugStore, cmpStore_bySlug, (key_bySlug, slot));
    };

    func index_refresh_on_update(slot : Nat64, prev : Types.Entry, next : Types.Entry, change : UniqueChange) : () {
      let delta_bySlot = change.fields.bySlot;
      if (delta_bySlot.changed) {
        IndexCore.deleteKey(idx_bySlotStore, cmpStore_bySlot, (delta_bySlot.prev, slot));
        IndexCore.insertWithRetention(idx_bySlotStore, cmpStore_bySlot, keep_bySlot, (delta_bySlot.next, slot));
      };

      let prevKey_byRank = (func(prev : Types.Entry) : (Nat64, Nat, Nat, Nat64) { (prev.season_id, prev.week, prev.votes, (18_446_744_073_709_551_615 : Nat64) - prev.id) })(prev);
      let nextKey_byRank = (func(next : Types.Entry) : (Nat64, Nat, Nat, Nat64) { (next.season_id, next.week, next.votes, (18_446_744_073_709_551_615 : Nat64) - next.id) })(next);
      var changed_byRank : Bool = false;
      if (cmpK_byRank(prevKey_byRank, nextKey_byRank) != #equal) {
        IndexCore.deleteKey(idx_byRankStore, cmpStore_byRank, (prevKey_byRank, slot));
        IndexCore.insertWithRetention(idx_byRankStore, cmpStore_byRank, keep_byRank, (nextKey_byRank, slot));
        changed_byRank := true;
      };

      let prevKey_byUser = prev.user_id;
      let nextKey_byUser = next.user_id;
      var changed_byUser : Bool = false;
      if (cmpK_byUser(prevKey_byUser, nextKey_byUser) != #equal) {
        IndexCore.deleteKey(idx_byUserStore, cmpStore_byUser, (prevKey_byUser, slot));
        IndexCore.insertWithRetention(idx_byUserStore, cmpStore_byUser, keep_byUser, (nextKey_byUser, slot));
        changed_byUser := true;
      };

      let prevKey_bySeason = prev.season_id;
      let nextKey_bySeason = next.season_id;
      var changed_bySeason : Bool = false;
      if (cmpK_bySeason(prevKey_bySeason, nextKey_bySeason) != #equal) {
        IndexCore.deleteKey(idx_bySeasonStore, cmpStore_bySeason, (prevKey_bySeason, slot));
        IndexCore.insertWithRetention(idx_bySeasonStore, cmpStore_bySeason, keep_bySeason, (nextKey_bySeason, slot));
        changed_bySeason := true;
      };

      let prevKey_bySlug = prev.slug;
      let nextKey_bySlug = next.slug;
      var changed_bySlug : Bool = false;
      if (cmpK_bySlug(prevKey_bySlug, nextKey_bySlug) != #equal) {
        IndexCore.deleteKey(idx_bySlugStore, cmpStore_bySlug, (prevKey_bySlug, slot));
        IndexCore.insertWithRetention(idx_bySlugStore, cmpStore_bySlug, keep_bySlug, (nextKey_bySlug, slot));
        changed_bySlug := true;
      };
    };

    func ensure_unique_bySlot(d : Types.Entry, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      let uniqueKey_bySlot = (func(d : Types.Entry) : (Nat64, Nat, Nat64, Nat64) { (d.season_id, d.week, d.user_id, switch (d.origin_id) { case (?o) o; case null 0 }) })(d);
      switch (IndexRuntime.indexKeyConflict(idx_bySlotStore, cmpStore_bySlot, cmpK_bySlot, rowAccess, projectPk, uniqueKey_bySlot, skipPk)) {
        case (?owner) { return #err(#AlreadyExists(owner)) };
        case null {};
      };
      #ok();
    };

    func ensure_unique_constraints(d : Types.Entry, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      switch (ensure_unique_bySlot(d, skipPk)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      #ok();
    };

    func validateCreateConstraints(data : Types.CreateEntry) : Result.Result<(), Errors.Error> {
      let len_title = Text.size(data.title);
      if (len_title < 1) {
        return #err(#ConstraintViolation({ field = "title"; message = "length must be >= 1" }));
      };
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
      let len_slug = Text.size(data.slug);
      if (len_slug < 5) {
        return #err(#ConstraintViolation({ field = "slug"; message = "length must be >= 5" }));
      };
      if (len_slug > 50) {
        return #err(#ConstraintViolation({ field = "slug"; message = "length must be <= 50" }));
      };
      let len_takedownReason = Text.size(data.takedownReason);
      if (len_takedownReason > 500) {
        return #err(#ConstraintViolation({ field = "takedownReason"; message = "length must be <= 500" }));
      };
      #ok();
    };

    func validateDocConstraints(doc : Types.Entry) : Result.Result<(), Errors.Error> {
      let len_title = Text.size(doc.title);
      if (len_title < 1) {
        return #err(#ConstraintViolation({ field = "title"; message = "length must be >= 1" }));
      };
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
      let len_slug = Text.size(doc.slug);
      if (len_slug < 5) {
        return #err(#ConstraintViolation({ field = "slug"; message = "length must be >= 5" }));
      };
      if (len_slug > 50) {
        return #err(#ConstraintViolation({ field = "slug"; message = "length must be <= 50" }));
      };
      let len_takedownReason = Text.size(doc.takedownReason);
      if (len_takedownReason > 500) {
        return #err(#ConstraintViolation({ field = "takedownReason"; message = "length must be <= 500" }));
      };
      #ok();
    };

    func makeDoc(id : Nat64, data : Types.CreateEntry) : Types.Entry {
      {
        id = id;
        season_id = data.season_id;
        user_id = data.user_id;
        week = data.week;
        title = data.title;
        summary = data.summary;
        url = data.url;
        icon = data.icon;
        shots = data.shots;
        links = data.links;
        pkg = data.pkg;
        updates = data.updates;
        votes = data.votes;
        outcome = data.outcome;
        origin_id = data.origin_id;
        createdAt = data.createdAt;
        updatedAt = data.updatedAt;
        slug = data.slug;
        takedownAt = data.takedownAt;
        takedownReason = data.takedownReason;
      };
    };

    func insertOne(data : Types.CreateEntry) : Result.Result<Nat64, Errors.Error> {
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
      switch (ensure_unique_constraints(doc, null)) {
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

    func getOne(pk : Nat64) : ?Types.Entry {
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

    func updateOne(doc : Types.Entry) : Result.Result<Types.Entry, Errors.Error> {
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
              let uniqueChange = compute_unique_change(prev, doc);
              if (uniqueChange.changed) {
                if (uniqueChange.fields.bySlot.changed) {
                  switch (ensure_unique_bySlot(doc, ?pk)) {
                    case (#ok()) {};
                    case (#err(e)) { return #err(e) };
                  };
                };
              };
              rowsPut(slot, doc);
              index_refresh_on_update(slot, prev, doc, uniqueChange);
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

    func upsertOne(doc : Types.Entry) : Result.Result<{ #inserted; #updated }, Errors.Error> {
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
              let uniqueChange = compute_unique_change(prev, doc);
              if (uniqueChange.changed) {
                if (uniqueChange.fields.bySlot.changed) {
                  switch (ensure_unique_bySlot(doc, ?pk)) {
                    case (#ok()) {};
                    case (#err(e)) { return #err(e) };
                  };
                };
              };
              rowsPut(slot, doc);
              index_refresh_on_update(slot, prev, doc, uniqueChange);
              nextIdManager.ensureAfter(pk);
              #ok(#updated);
            };
          };
        };
        case null {
          switch (ensure_unique_constraints(doc, null)) {
            case (#ok()) {};
            case (#err(e)) { return #err(e) };
          };
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

    func insertManyImpl(records : [Types.CreateEntry]) : Result.Result<[Nat64], Errors.Error> {
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

    func upsertManyImpl(records : [Types.Entry]) : Result.Result<{ inserted : Nat; updated : Nat }, Errors.Error> {
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

    func getManyImpl(pks : [Nat64]) : [(Nat64, ?Types.Entry)] {
      Array.tabulate<(Nat64, ?Types.Entry)>(
        Array.size(pks),
        func(i : Nat) : (Nat64, ?Types.Entry) {
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

    let deleteDoc = func(slot : Nat64, d : Types.Entry) : Result.Result<(), Errors.Error> {
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

    func encodeTextCursor(dir : IndexCore.Direction, entry : (Text, Nat64)) : Cursors.Token {
      let (k, pk) = entry;
      Cursors.encodeText(dir, k, pk);
    };

    func encodeBySlotCursor(dir : IndexCore.Direction, entry : ((Nat64, Nat, Nat64, Nat64), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1, k2, k3) = storeKey;
      Cursors.encodeComposite(dir, "Nat64_Nat_Nat64_Nat64", [Cursors.encodeSegmentNat64(k0), Cursors.encodeSegmentNat(k1), Cursors.encodeSegmentNat64(k2), Cursors.encodeSegmentNat64(k3)], pk);
    };

    func decodeBySlotCursor(token : Cursors.Token) : ?((Nat64, Nat, Nat64, Nat64), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat64_Nat_Nat64_Nat64", 4)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat64(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentNat(segments[1]) else return null;
          let ?k2 = Cursors.decodeSegmentNat64(segments[2]) else return null;
          let ?k3 = Cursors.decodeSegmentNat64(segments[3]) else return null;
          let key = (k0, k1, k2, k3);
          ?(key, pk);
        };
        case null null;
      };
    };

    func encodeByRankCursor(dir : IndexCore.Direction, entry : ((Nat64, Nat, Nat, Nat64), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1, k2, k3) = storeKey;
      Cursors.encodeComposite(dir, "Nat64_Nat_Nat_Nat64", [Cursors.encodeSegmentNat64(k0), Cursors.encodeSegmentNat(k1), Cursors.encodeSegmentNat(k2), Cursors.encodeSegmentNat64(k3)], pk);
    };

    func decodeByRankCursor(token : Cursors.Token) : ?((Nat64, Nat, Nat, Nat64), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat64_Nat_Nat_Nat64", 4)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat64(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentNat(segments[1]) else return null;
          let ?k2 = Cursors.decodeSegmentNat(segments[2]) else return null;
          let ?k3 = Cursors.decodeSegmentNat64(segments[3]) else return null;
          let key = (k0, k1, k2, k3);
          ?(key, pk);
        };
        case null null;
      };
    };

    let bySlotFind = func(dir : IndexCore.Direction, start : (Nat64, Nat, Nat64, Nat64), limit : Nat) : Iter.Iter<Types.Entry> {
      IndexRuntime.makeFindIter<(Nat64, Nat, Nat64, Nat64), Types.Entry>(rowAccess, idx_bySlotStore, cmpStore_bySlot, cmpK_bySlot, dir, start, limit);
    };

    let byRankFind = func(dir : IndexCore.Direction, start : (Nat64, Nat, Nat, Nat64), limit : Nat) : Iter.Iter<Types.Entry> {
      IndexRuntime.makeFindIter<(Nat64, Nat, Nat, Nat64), Types.Entry>(rowAccess, idx_byRankStore, cmpStore_byRank, cmpK_byRank, dir, start, limit);
    };

    let byUserFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Entry> {
      IndexRuntime.makeFindIter<Nat64, Types.Entry>(rowAccess, idx_byUserStore, cmpStore_byUser, cmpK_byUser, dir, start, limit);
    };

    let bySeasonFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Entry> {
      IndexRuntime.makeFindIter<Nat64, Types.Entry>(rowAccess, idx_bySeasonStore, cmpStore_bySeason, cmpK_bySeason, dir, start, limit);
    };

    let bySlugFind = func(dir : IndexCore.Direction, start : Text, limit : Nat) : Iter.Iter<Types.Entry> {
      IndexRuntime.makeFindIter<Text, Types.Entry>(rowAccess, idx_bySlugStore, cmpStore_bySlug, cmpK_bySlug, dir, start, limit);
    };

    let bySlotOps = IndexRuntime.makeIndexOps<(Nat64, Nat, Nat64, Nat64), Types.Entry, Errors.Error>(
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

    let byRankOps = IndexRuntime.makeIndexOps<(Nat64, Nat, Nat, Nat64), Types.Entry, Errors.Error>(
      "byRank",
      idx_byRankStore,
      cmpK_byRank,
      cmpStore_byRank,
      keep_byRank,
      rowAccess,
      projectPk,
      decodeByRankCursor,
      encodeByRankCursor,
      byRankFind,
      deleteDoc,
    );

    let byUserOps = IndexRuntime.makeIndexOps<Nat64, Types.Entry, Errors.Error>(
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

    let bySeasonOps = IndexRuntime.makeIndexOps<Nat64, Types.Entry, Errors.Error>(
      "bySeason",
      idx_bySeasonStore,
      cmpK_bySeason,
      cmpStore_bySeason,
      keep_bySeason,
      rowAccess,
      projectPk,
      Cursors.decodeNat64,
      encodeNat64Cursor,
      bySeasonFind,
      deleteDoc,
    );

    let bySlugBase = IndexRuntime.makeIndexOps<Text, Types.Entry, Errors.Error>(
      "bySlug",
      idx_bySlugStore,
      cmpK_bySlug,
      cmpStore_bySlug,
      keep_bySlug,
      rowAccess,
      projectPk,
      Cursors.decodeText,
      encodeTextCursor,
      bySlugFind,
      deleteDoc,
    );

    let bySlugOps : TextIndexOps = {
      descriptor = bySlugBase.descriptor;
      find = bySlugBase.find;
      rangeDelete = bySlugBase.rangeDelete;
      exists = bySlugBase.exists;
      locate = func(key : Text) : ?Nat64 {
        IndexRuntime.indexLocate<Text, Types.Entry>(idx_bySlugStore, cmpStore_bySlug, cmpK_bySlug, key, rowAccess, projectPk);
      };
      countInRange = bySlugBase.countInRange;
      size = bySlugBase.size;
      rangeIter = bySlugBase.rangeIter;
      mapRange = bySlugBase.mapRange;
      foldRange = bySlugBase.foldRange;
      prefixFind = func(dir : IndexCore.Direction, prefix : Text, limit : Nat) : Iter.Iter<Types.Entry> {
        let bounds = TextRange.prefixRange(prefix, dir);
        IndexRuntime.limitIter(bySlugBase.rangeIter(bounds, null), limit);
      };
    };

    let iterPrimary = AshrootPrimaryIter.make(rowAccess, pk_indexStore, cmpPKStore);
    let iter = AshrootListIter.make(rowsStore);
    let mapIter = func<R>(dir : IndexCore.Direction, f : Types.Entry -> R) : Iter.Iter<R> {
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
    let foldIter = func<A>(dir : IndexCore.Direction, init : A, f : (A, Types.Entry) -> A) : A {
      let base = iter(dir);
      IndexRuntime.foldFromIter(base, init, f);
    };

    func formatError(e : Errors.Error) : Text {
      switch (e) {
        case (#AlreadyExists(id)) { "already exists " # Nat64.toText(id) };
        case (#NotFound(id)) { "not found " # Nat64.toText(id) };
        case (#Internal(msg)) { msg };
      };
    };

    var rel_season_id_parentExists : (Nat64 -> Bool) = func(_) : Bool { false };
    var rel_season_id_installed : Bool = false;
    func rel_season_id_range(value : Nat64) : IndexRuntime.IndexRange<Nat64> {
      {
        gt = null;
        gte = ?value;
        lt = null;
        lte = ?value;
        dir = #fwd;
      };
    };
    func rel_season_id_checkParent(id : Nat64) : Result.Result<(), Errors.Error> {
      if (not rel_season_id_installed) {
        return #err(#Internal("foreign key entries.season_id parent lookup not installed"));
      };
      if (rel_season_id_parentExists(id)) {
        #ok();
      } else {
        return #err(#Internal("referential integrity violation: seasons.id " # Nat64.toText(id) # " not found for entries.season_id"));
      };
    };
    func rel_season_id_validateCreate(data : Types.CreateEntry) : Result.Result<(), Errors.Error> {
      return rel_season_id_checkParent(data.season_id);
    };
    func rel_season_id_validateDoc(doc : Types.Entry) : Result.Result<(), Errors.Error> {
      return rel_season_id_checkParent(doc.season_id);
    };
    func rel_season_id_countDependents(parentId : Nat64) : Nat {
      let iter = Set.valuesFrom(idx_bySeasonStore, cmpStore_bySeason, (parentId, Nat64.fromNat(0)));
      var total : Nat = 0;
      label scan while (true) {
        switch (iter.next()) {
          case null { return total };
          case (?entry) {
            let (key, slot) = entry;
            switch (cmpK_bySeason(key, parentId)) {
              case (#equal) {
                if (rowsHas(slot)) { total += 1 };
                continue scan;
              };
              case (#greater) { return total };
              case (#less) { continue scan };
            };
          };
        };
      };
      total;
    };
    func rel_season_id_deleteDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      let range = rel_season_id_range(parentId);
      var cursor : ?Cursors.Token = null;
      var hasMore = true;
      let chunk : Nat = 1024;
      while (hasMore) {
        switch (bySeasonOps.rangeDelete(range, chunk, cursor)) {
          case (#ok(outcome)) {
            cursor := outcome.cursor;
            hasMore := outcome.hasMore;
          };
          case (#err(e)) { return #err(e) };
        };
      };
      #ok();
    };
    func rel_season_id_setNullDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      #err(#Internal("setNull not supported for entries.season_id"));
    };
    func rel_season_id_installParent(checker : Nat64 -> Bool) : () {
      rel_season_id_parentExists := checker;
      rel_season_id_installed := true;
    };
    let season_idManager_runtime : ForeignKeyRuntime = {
      field = "season_id";
      parentTable = "seasons";
      notNull = true;
      onDelete = #restrict;
      installParentExists = rel_season_id_installParent;
      validateCreate = rel_season_id_validateCreate;
      validateDoc = rel_season_id_validateDoc;
      countDependents = rel_season_id_countDependents;
      deleteDependents = rel_season_id_deleteDependents;
      setNullDependents = rel_season_id_setNullDependents;
      formatError = formatError;
    };

    let season_idManager : ForeignKeyManager = season_idManager_runtime;

    var rel_user_id_parentExists : (Nat64 -> Bool) = func(_) : Bool { false };
    var rel_user_id_installed : Bool = false;
    func rel_user_id_range(value : Nat64) : IndexRuntime.IndexRange<Nat64> {
      {
        gt = null;
        gte = ?value;
        lt = null;
        lte = ?value;
        dir = #fwd;
      };
    };
    func rel_user_id_checkParent(id : Nat64) : Result.Result<(), Errors.Error> {
      if (not rel_user_id_installed) {
        return #err(#Internal("foreign key entries.user_id parent lookup not installed"));
      };
      if (rel_user_id_parentExists(id)) {
        #ok();
      } else {
        return #err(#Internal("referential integrity violation: users.id " # Nat64.toText(id) # " not found for entries.user_id"));
      };
    };
    func rel_user_id_validateCreate(data : Types.CreateEntry) : Result.Result<(), Errors.Error> {
      return rel_user_id_checkParent(data.user_id);
    };
    func rel_user_id_validateDoc(doc : Types.Entry) : Result.Result<(), Errors.Error> {
      return rel_user_id_checkParent(doc.user_id);
    };
    func rel_user_id_countDependents(parentId : Nat64) : Nat {
      let iter = Set.valuesFrom(idx_byUserStore, cmpStore_byUser, (parentId, Nat64.fromNat(0)));
      var total : Nat = 0;
      label scan while (true) {
        switch (iter.next()) {
          case null { return total };
          case (?entry) {
            let (key, slot) = entry;
            switch (cmpK_byUser(key, parentId)) {
              case (#equal) {
                if (rowsHas(slot)) { total += 1 };
                continue scan;
              };
              case (#greater) { return total };
              case (#less) { continue scan };
            };
          };
        };
      };
      total;
    };
    func rel_user_id_deleteDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      let range = rel_user_id_range(parentId);
      var cursor : ?Cursors.Token = null;
      var hasMore = true;
      let chunk : Nat = 1024;
      while (hasMore) {
        switch (byUserOps.rangeDelete(range, chunk, cursor)) {
          case (#ok(outcome)) {
            cursor := outcome.cursor;
            hasMore := outcome.hasMore;
          };
          case (#err(e)) { return #err(e) };
        };
      };
      #ok();
    };
    func rel_user_id_setNullDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      #err(#Internal("setNull not supported for entries.user_id"));
    };
    func rel_user_id_installParent(checker : Nat64 -> Bool) : () {
      rel_user_id_parentExists := checker;
      rel_user_id_installed := true;
    };
    let user_idManager_runtime : ForeignKeyRuntime = {
      field = "user_id";
      parentTable = "users";
      notNull = true;
      onDelete = #restrict;
      installParentExists = rel_user_id_installParent;
      validateCreate = rel_user_id_validateCreate;
      validateDoc = rel_user_id_validateDoc;
      countDependents = rel_user_id_countDependents;
      deleteDependents = rel_user_id_deleteDependents;
      setNullDependents = rel_user_id_setNullDependents;
      formatError = formatError;
    };

    let user_idManager : ForeignKeyManager = user_idManager_runtime;

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
      bySlot = bySlotOps;
      byRank = byRankOps;
      byUser = byUserOps;
      bySeason = bySeasonOps;
      bySlug = bySlugOps;
    };

    let relations : RelationBundle = {
      foreignKeys = [season_idManager, user_idManager];
    };
    let relationsInternal : RelationRuntimeBundle = {
      foreignKeys = [season_idManager_runtime, user_idManager_runtime];
    };

    { table; relations; relationsInternal };

  };
};
