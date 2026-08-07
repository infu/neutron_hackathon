/*
  One row is one frozen prize transfer.

  Recipient, ledger arguments, attempt ownership, and the terminal receipt are
  retained together so an interrupted direct-wallet send can resume safely.
*/
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
import Principal "mo:core/Principal";

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
    public module Payout {
      public module State {
        public type Type = {
          #planned;
          #sending;
          #paid;
          #skipped;
          #failed;
        };
      };
      public type State = State.Type;
      public module Award {
        public type Type = {
          #bronze;
          #silver;
          #gold;
        };
      };
      public type Award = Award.Type;
      public type Block = Nat;
      public type Type = {
        id : Nat64;
        season_id : Nat64;
        user_id : Nat64;
        entry_id : Nat64;
        ledger : Principal;
        gross : Nat;
        fee : Nat;
        net : Nat;
        createdAtTime : Nat64;
        state : State;
        attempts : Nat;
        note : Text;
        award : Award;
        to : Principal;
        dust : Nat;
        block : ?Block;
      };
      public module Mutation {
        public type Type = {
          var id : ?Nat64;
          var season_id : ?Nat64;
          var user_id : ?Nat64;
          var entry_id : ?Nat64;
          var ledger : ?Principal;
          var gross : ?Nat;
          var fee : ?Nat;
          var net : ?Nat;
          var createdAtTime : ?Nat64;
          var state : ?State;
          var attempts : ?Nat;
          var note : ?Text;
          var award : ?Award;
          var to : ?Principal;
          var dust : ?Nat;
          var block : ??Block;
        };
        public func new() : Type {
          {
            var id = null;
            var season_id = null;
            var user_id = null;
            var entry_id = null;
            var ledger = null;
            var gross = null;
            var fee = null;
            var net = null;
            var createdAtTime = null;
            var state = null;
            var attempts = null;
            var note = null;
            var award = null;
            var to = null;
            var dust = null;
            var block = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type Payout = Payout.Type;

    public module CreatePayout {
      public module State {
        public type Type = {
          #planned;
          #sending;
          #paid;
          #skipped;
          #failed;
        };
      };
      public type State = State.Type;
      public module Award {
        public type Type = {
          #bronze;
          #silver;
          #gold;
        };
      };
      public type Award = Award.Type;
      public type Block = Nat;
      public type Type = {
        season_id : Nat64;
        user_id : Nat64;
        entry_id : Nat64;
        ledger : Principal;
        gross : Nat;
        fee : Nat;
        net : Nat;
        createdAtTime : Nat64;
        state : State;
        attempts : Nat;
        note : Text;
        award : Award;
        to : Principal;
        dust : Nat;
        block : ?Block;
      };
      public module Mutation {
        public type Type = {
          var season_id : ?Nat64;
          var user_id : ?Nat64;
          var entry_id : ?Nat64;
          var ledger : ?Principal;
          var gross : ?Nat;
          var fee : ?Nat;
          var net : ?Nat;
          var createdAtTime : ?Nat64;
          var state : ?State;
          var attempts : ?Nat;
          var note : ?Text;
          var award : ?Award;
          var to : ?Principal;
          var dust : ?Nat;
          var block : ??Block;
        };
        public func new() : Type {
          {
            var season_id = null;
            var user_id = null;
            var entry_id = null;
            var ledger = null;
            var gross = null;
            var fee = null;
            var net = null;
            var createdAtTime = null;
            var state = null;
            var attempts = null;
            var note = null;
            var award = null;
            var to = null;
            var dust = null;
            var block = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type CreatePayout = CreatePayout.Type;
  };

  public module Errors {
    public type Error = AshrootErrors.Error;
  };

  public type RelationDeletePolicy = AshrootRelations.DeletePolicy;

  public type ForeignKeyManager = AshrootRelations.ForeignKeyManager<Types.Payout, Types.CreatePayout, Errors.Error>;

  public type ForeignKeyRuntime = AshrootRelations.ForeignKeyRuntime<Types.Payout, Types.CreatePayout, Errors.Error>;

  public type RelationBundle = AshrootRelations.Bundle<Types.Payout, Types.CreatePayout, Errors.Error>;

  public type RelationRuntimeBundle = AshrootRelations.RuntimeBundle<Types.Payout, Types.CreatePayout, Errors.Error>;

  public type Init = {
    var nextId : Nat64;
    rows : List.List<?Types.Payout>;
    var deletedSlots : PureList.List<Nat64>;
    var rowCount : Nat;
    pk_index : Set.Set<(Nat64, Nat64)>;
    idx_bySlot : Set.Set<((Nat64, Nat64, Principal, Nat64), Nat64)>;
    idx_bySeason : Set.Set<(Nat64, Nat64)>;
    idx_byUser : Set.Set<(Nat64, Nat64)>;
  };

  public func init() : Init {
    {
      var nextId = Nat64.fromNat(1);
      rows = List.empty<?Types.Payout>();
      var deletedSlots = null;
      var rowCount = 0;
      pk_index = Set.empty<(Nat64, Nat64)>();
      idx_bySlot = Set.empty<((Nat64, Nat64, Principal, Nat64), Nat64)>();
      idx_bySeason = Set.empty<(Nat64, Nat64)>();
      idx_byUser = Set.empty<(Nat64, Nat64)>();
    };
  };

  public type IndexRange<K> = IndexRuntime.IndexRange<K>;

  public type RangeDeleteResult = IndexRuntime.RangeDeleteResult;

  public type IndexDescriptor<K> = IndexRuntime.IndexDescriptor<K>;

  public type IndexOps<K> = IndexRuntime.IndexOps<K, Types.Payout, Errors.Error>;

  public type Use = AshrootTableOps.Common<Types.Payout, Types.CreatePayout, Errors.Error, Nat64> and {
    iterPrimary : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Types.Payout)>;
    iter : (IndexCore.Direction) -> Iter.Iter<Types.Payout>;
    bySlot : IndexOps<(Nat64, Nat64, Principal, Nat64)>;
    bySeason : IndexOps<Nat64>;
    byUser : IndexOps<Nat64>;
  };

  public type UseBundle = AshrootUseBundle.Bundle<Use, Types.Payout, Types.CreatePayout, Errors.Error>;

  public func use(store : Init) : UseBundle {
    let cmpPK = Nat64.compare;

    let cmpK_bySlot = func(lhs : (Nat64, Nat64, Principal, Nat64), rhs : (Nat64, Nat64, Principal, Nat64)) : {
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
      let cmp1 = Nat64.compare(lhs.1, rhs.1);
      switch (cmp1) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      let cmp2 = Principal.compare(lhs.2, rhs.2);
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
    let cmpStore_bySlot = IndexCore.cmpStoreKey<(Nat64, Nat64, Principal, Nat64)>(cmpK_bySlot);

    let cmpK_bySeason = Nat64.compare;
    let cmpStore_bySeason = IndexCore.cmpStoreKey<Nat64>(cmpK_bySeason);

    let cmpK_byUser = Nat64.compare;
    let cmpStore_byUser = IndexCore.cmpStoreKey<Nat64>(cmpK_byUser);

    let keep_bySlot : IndexCore.Keep = #all;
    let keep_bySeason : IndexCore.Keep = #all;
    let keep_byUser : IndexCore.Keep = #all;

    let rowsStore = store.rows;
    let pk_indexStore = store.pk_index;
    let idx_bySlotStore = store.idx_bySlot;
    let idx_bySeasonStore = store.idx_bySeason;
    let idx_byUserStore = store.idx_byUser;
    let cmpPKStore = IndexCore.cmpStoreKey<Nat64>(Nat64.compare);

    func slotToNat(slot : Nat64) : Nat { Nat64.toNat(slot) };

    func rowsGet(slot : Nat64) : ?Types.Payout {
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

    func rowsPut(slot : Nat64, doc : Types.Payout) : () {
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

    func allocSlot(doc : Types.Payout) : Nat64 {
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

    func projectPk(doc : Types.Payout) : Nat64 { doc.id };

    let rowAccess : IndexRuntime.RowStore<Types.Payout> = {
      get = rowsGet;
      has = rowsHas;
    };

    let nextIdManager = AshrootUseRuntime.manageNextId(store);

    type UniqueFields = {
      bySlot : AshrootUniqueRuntime.FieldChange<(Nat64, Nat64, Principal, Nat64)>;
    };
    type UniqueChange = AshrootUniqueRuntime.UniqueChange<UniqueFields>;

    func compute_unique_change(prev : Types.Payout, next : Types.Payout) : UniqueChange {
      AshrootUniqueRuntime.compute(
        prev,
        next,
        func(prevDoc : Types.Payout, nextDoc : Types.Payout) : UniqueFields {
          {
            bySlot = do {
              let prevKey = (func(prevDoc : Types.Payout) : (Nat64, Nat64, Principal, Nat64) { (prevDoc.season_id, prevDoc.user_id, prevDoc.ledger, prevDoc.entry_id) })(prevDoc);
              let nextKey = (func(nextDoc : Types.Payout) : (Nat64, Nat64, Principal, Nat64) { (nextDoc.season_id, nextDoc.user_id, nextDoc.ledger, nextDoc.entry_id) })(nextDoc);
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

    func index_add_all(slot : Nat64, d : Types.Payout) : () {
      let key_bySlot = (func(d : Types.Payout) : (Nat64, Nat64, Principal, Nat64) { (d.season_id, d.user_id, d.ledger, d.entry_id) })(d);
      IndexCore.insertWithRetention(idx_bySlotStore, cmpStore_bySlot, keep_bySlot, (key_bySlot, slot));
      let key_bySeason = d.season_id;
      IndexCore.insertWithRetention(idx_bySeasonStore, cmpStore_bySeason, keep_bySeason, (key_bySeason, slot));
      let key_byUser = d.user_id;
      IndexCore.insertWithRetention(idx_byUserStore, cmpStore_byUser, keep_byUser, (key_byUser, slot));
    };

    func index_del_all(slot : Nat64, d : Types.Payout) : () {
      let key_bySlot = (func(d : Types.Payout) : (Nat64, Nat64, Principal, Nat64) { (d.season_id, d.user_id, d.ledger, d.entry_id) })(d);
      IndexCore.deleteKey(idx_bySlotStore, cmpStore_bySlot, (key_bySlot, slot));
      let key_bySeason = d.season_id;
      IndexCore.deleteKey(idx_bySeasonStore, cmpStore_bySeason, (key_bySeason, slot));
      let key_byUser = d.user_id;
      IndexCore.deleteKey(idx_byUserStore, cmpStore_byUser, (key_byUser, slot));
    };

    func index_refresh_on_update(slot : Nat64, prev : Types.Payout, next : Types.Payout, change : UniqueChange) : () {
      let delta_bySlot = change.fields.bySlot;
      if (delta_bySlot.changed) {
        IndexCore.deleteKey(idx_bySlotStore, cmpStore_bySlot, (delta_bySlot.prev, slot));
        IndexCore.insertWithRetention(idx_bySlotStore, cmpStore_bySlot, keep_bySlot, (delta_bySlot.next, slot));
      };

      let prevKey_bySeason = prev.season_id;
      let nextKey_bySeason = next.season_id;
      var changed_bySeason : Bool = false;
      if (cmpK_bySeason(prevKey_bySeason, nextKey_bySeason) != #equal) {
        IndexCore.deleteKey(idx_bySeasonStore, cmpStore_bySeason, (prevKey_bySeason, slot));
        IndexCore.insertWithRetention(idx_bySeasonStore, cmpStore_bySeason, keep_bySeason, (nextKey_bySeason, slot));
        changed_bySeason := true;
      };

      let prevKey_byUser = prev.user_id;
      let nextKey_byUser = next.user_id;
      var changed_byUser : Bool = false;
      if (cmpK_byUser(prevKey_byUser, nextKey_byUser) != #equal) {
        IndexCore.deleteKey(idx_byUserStore, cmpStore_byUser, (prevKey_byUser, slot));
        IndexCore.insertWithRetention(idx_byUserStore, cmpStore_byUser, keep_byUser, (nextKey_byUser, slot));
        changed_byUser := true;
      };
    };

    func ensure_unique_bySlot(d : Types.Payout, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      let uniqueKey_bySlot = (func(d : Types.Payout) : (Nat64, Nat64, Principal, Nat64) { (d.season_id, d.user_id, d.ledger, d.entry_id) })(d);
      switch (IndexRuntime.indexKeyConflict(idx_bySlotStore, cmpStore_bySlot, cmpK_bySlot, rowAccess, projectPk, uniqueKey_bySlot, skipPk)) {
        case (?owner) { return #err(#AlreadyExists(owner)) };
        case null {};
      };
      #ok();
    };

    func ensure_unique_constraints(d : Types.Payout, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      switch (ensure_unique_bySlot(d, skipPk)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      #ok();
    };

    func validateCreateConstraints(data : Types.CreatePayout) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func validateDocConstraints(doc : Types.Payout) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func makeDoc(id : Nat64, data : Types.CreatePayout) : Types.Payout {
      {
        id = id;
        season_id = data.season_id;
        user_id = data.user_id;
        entry_id = data.entry_id;
        ledger = data.ledger;
        gross = data.gross;
        fee = data.fee;
        net = data.net;
        createdAtTime = data.createdAtTime;
        state = data.state;
        attempts = data.attempts;
        note = data.note;
        award = data.award;
        to = data.to;
        dust = data.dust;
        block = data.block;
      };
    };

    func insertOne(data : Types.CreatePayout) : Result.Result<Nat64, Errors.Error> {
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

    func getOne(pk : Nat64) : ?Types.Payout {
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

    func updateOne(doc : Types.Payout) : Result.Result<Types.Payout, Errors.Error> {
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

    func upsertOne(doc : Types.Payout) : Result.Result<{ #inserted; #updated }, Errors.Error> {
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

    func insertManyImpl(records : [Types.CreatePayout]) : Result.Result<[Nat64], Errors.Error> {
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

    func upsertManyImpl(records : [Types.Payout]) : Result.Result<{ inserted : Nat; updated : Nat }, Errors.Error> {
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

    func getManyImpl(pks : [Nat64]) : [(Nat64, ?Types.Payout)] {
      Array.tabulate<(Nat64, ?Types.Payout)>(
        Array.size(pks),
        func(i : Nat) : (Nat64, ?Types.Payout) {
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

    let deleteDoc = func(slot : Nat64, d : Types.Payout) : Result.Result<(), Errors.Error> {
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

    func encodeBySlotCursor(dir : IndexCore.Direction, entry : ((Nat64, Nat64, Principal, Nat64), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1, k2, k3) = storeKey;
      Cursors.encodeComposite(dir, "Nat64_Nat64_Principal_Nat64", [Cursors.encodeSegmentNat64(k0), Cursors.encodeSegmentNat64(k1), Cursors.encodeSegmentPrincipal(k2), Cursors.encodeSegmentNat64(k3)], pk);
    };

    func decodeBySlotCursor(token : Cursors.Token) : ?((Nat64, Nat64, Principal, Nat64), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat64_Nat64_Principal_Nat64", 4)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat64(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentNat64(segments[1]) else return null;
          let ?k2 = Cursors.decodeSegmentPrincipal(segments[2]) else return null;
          let ?k3 = Cursors.decodeSegmentNat64(segments[3]) else return null;
          let key = (k0, k1, k2, k3);
          ?(key, pk);
        };
        case null null;
      };
    };

    let bySlotFind = func(dir : IndexCore.Direction, start : (Nat64, Nat64, Principal, Nat64), limit : Nat) : Iter.Iter<Types.Payout> {
      IndexRuntime.makeFindIter<(Nat64, Nat64, Principal, Nat64), Types.Payout>(rowAccess, idx_bySlotStore, cmpStore_bySlot, cmpK_bySlot, dir, start, limit);
    };

    let bySeasonFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Payout> {
      IndexRuntime.makeFindIter<Nat64, Types.Payout>(rowAccess, idx_bySeasonStore, cmpStore_bySeason, cmpK_bySeason, dir, start, limit);
    };

    let byUserFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Payout> {
      IndexRuntime.makeFindIter<Nat64, Types.Payout>(rowAccess, idx_byUserStore, cmpStore_byUser, cmpK_byUser, dir, start, limit);
    };

    let bySlotOps = IndexRuntime.makeIndexOps<(Nat64, Nat64, Principal, Nat64), Types.Payout, Errors.Error>(
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

    let bySeasonOps = IndexRuntime.makeIndexOps<Nat64, Types.Payout, Errors.Error>(
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

    let byUserOps = IndexRuntime.makeIndexOps<Nat64, Types.Payout, Errors.Error>(
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

    let iterPrimary = AshrootPrimaryIter.make(rowAccess, pk_indexStore, cmpPKStore);
    let iter = AshrootListIter.make(rowsStore);
    let mapIter = func<R>(dir : IndexCore.Direction, f : Types.Payout -> R) : Iter.Iter<R> {
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
    let foldIter = func<A>(dir : IndexCore.Direction, init : A, f : (A, Types.Payout) -> A) : A {
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
      bySlot = bySlotOps;
      bySeason = bySeasonOps;
      byUser = byUserOps;
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
