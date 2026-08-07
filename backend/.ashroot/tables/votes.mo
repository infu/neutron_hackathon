/*
    Judge ballots.

    Each ballot carries judge, entry, season, and week identity. Duplicate
    checks, allowance reads, withdrawals, and tallies cannot cross rounds.
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
    public module Vote {
      public type Type = {
        id : Nat64;
        entry_id : Nat64;
        judge_id : Nat64;
        season_id : Nat64;
        week : Nat;
        at : Nat64;
      };
      public module Mutation {
        public type Type = {
          var id : ?Nat64;
          var entry_id : ?Nat64;
          var judge_id : ?Nat64;
          var season_id : ?Nat64;
          var week : ?Nat;
          var at : ?Nat64;
        };
        public func new() : Type {
          {
            var id = null;
            var entry_id = null;
            var judge_id = null;
            var season_id = null;
            var week = null;
            var at = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type Vote = Vote.Type;

    public module CreateVote {
      public type Type = {
        entry_id : Nat64;
        judge_id : Nat64;
        season_id : Nat64;
        week : Nat;
        at : Nat64;
      };
      public module Mutation {
        public type Type = {
          var entry_id : ?Nat64;
          var judge_id : ?Nat64;
          var season_id : ?Nat64;
          var week : ?Nat;
          var at : ?Nat64;
        };
        public func new() : Type {
          {
            var entry_id = null;
            var judge_id = null;
            var season_id = null;
            var week = null;
            var at = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type CreateVote = CreateVote.Type;
  };

  public module Errors {
    public type Error = AshrootErrors.Error;
  };

  public type RelationDeletePolicy = AshrootRelations.DeletePolicy;

  public type ForeignKeyManager = AshrootRelations.ForeignKeyManager<Types.Vote, Types.CreateVote, Errors.Error>;

  public type ForeignKeyRuntime = AshrootRelations.ForeignKeyRuntime<Types.Vote, Types.CreateVote, Errors.Error>;

  public type RelationBundle = AshrootRelations.Bundle<Types.Vote, Types.CreateVote, Errors.Error>;

  public type RelationRuntimeBundle = AshrootRelations.RuntimeBundle<Types.Vote, Types.CreateVote, Errors.Error>;

  public type Init = {
    var nextId : Nat64;
    rows : List.List<?Types.Vote>;
    var deletedSlots : PureList.List<Nat64>;
    var rowCount : Nat;
    pk_index : Set.Set<(Nat64, Nat64)>;
    idx_byJudgeEntry : Set.Set<((Nat64, Nat64), Nat64)>;
    idx_byJudgeWeek : Set.Set<((Nat64, Nat64, Nat), Nat64)>;
    idx_byEntry : Set.Set<(Nat64, Nat64)>;
    idx_byJudge : Set.Set<(Nat64, Nat64)>;
  };

  public func init() : Init {
    {
      var nextId = Nat64.fromNat(1);
      rows = List.empty<?Types.Vote>();
      var deletedSlots = null;
      var rowCount = 0;
      pk_index = Set.empty<(Nat64, Nat64)>();
      idx_byJudgeEntry = Set.empty<((Nat64, Nat64), Nat64)>();
      idx_byJudgeWeek = Set.empty<((Nat64, Nat64, Nat), Nat64)>();
      idx_byEntry = Set.empty<(Nat64, Nat64)>();
      idx_byJudge = Set.empty<(Nat64, Nat64)>();
    };
  };

  public type IndexRange<K> = IndexRuntime.IndexRange<K>;

  public type RangeDeleteResult = IndexRuntime.RangeDeleteResult;

  public type IndexDescriptor<K> = IndexRuntime.IndexDescriptor<K>;

  public type IndexOps<K> = IndexRuntime.IndexOps<K, Types.Vote, Errors.Error>;

  public type Use = AshrootTableOps.Common<Types.Vote, Types.CreateVote, Errors.Error, Nat64> and {
    iterPrimary : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Types.Vote)>;
    iter : (IndexCore.Direction) -> Iter.Iter<Types.Vote>;
    byJudgeEntry : IndexOps<(Nat64, Nat64)>;
    byJudgeWeek : IndexOps<(Nat64, Nat64, Nat)>;
    byEntry : IndexOps<Nat64>;
    byJudge : IndexOps<Nat64>;
  };

  public type UseBundle = AshrootUseBundle.Bundle<Use, Types.Vote, Types.CreateVote, Errors.Error>;

  public func use(store : Init) : UseBundle {
    let cmpPK = Nat64.compare;

    let cmpK_byJudgeEntry = func(lhs : (Nat64, Nat64), rhs : (Nat64, Nat64)) : {
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
      #equal;
    };
    let cmpStore_byJudgeEntry = IndexCore.cmpStoreKey<(Nat64, Nat64)>(cmpK_byJudgeEntry);

    let cmpK_byJudgeWeek = func(lhs : (Nat64, Nat64, Nat), rhs : (Nat64, Nat64, Nat)) : {
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
      let cmp2 = Nat.compare(lhs.2, rhs.2);
      switch (cmp2) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      #equal;
    };
    let cmpStore_byJudgeWeek = IndexCore.cmpStoreKey<(Nat64, Nat64, Nat)>(cmpK_byJudgeWeek);

    let cmpK_byEntry = Nat64.compare;
    let cmpStore_byEntry = IndexCore.cmpStoreKey<Nat64>(cmpK_byEntry);

    let cmpK_byJudge = Nat64.compare;
    let cmpStore_byJudge = IndexCore.cmpStoreKey<Nat64>(cmpK_byJudge);

    let keep_byJudgeEntry : IndexCore.Keep = #all;
    let keep_byJudgeWeek : IndexCore.Keep = #all;
    let keep_byEntry : IndexCore.Keep = #all;
    let keep_byJudge : IndexCore.Keep = #all;

    let rowsStore = store.rows;
    let pk_indexStore = store.pk_index;
    let idx_byJudgeEntryStore = store.idx_byJudgeEntry;
    let idx_byJudgeWeekStore = store.idx_byJudgeWeek;
    let idx_byEntryStore = store.idx_byEntry;
    let idx_byJudgeStore = store.idx_byJudge;
    let cmpPKStore = IndexCore.cmpStoreKey<Nat64>(Nat64.compare);

    func slotToNat(slot : Nat64) : Nat { Nat64.toNat(slot) };

    func rowsGet(slot : Nat64) : ?Types.Vote {
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

    func rowsPut(slot : Nat64, doc : Types.Vote) : () {
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

    func allocSlot(doc : Types.Vote) : Nat64 {
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

    func projectPk(doc : Types.Vote) : Nat64 { doc.id };

    let rowAccess : IndexRuntime.RowStore<Types.Vote> = {
      get = rowsGet;
      has = rowsHas;
    };

    let nextIdManager = AshrootUseRuntime.manageNextId(store);

    type UniqueFields = {
      byJudgeEntry : AshrootUniqueRuntime.FieldChange<(Nat64, Nat64)>;
    };
    type UniqueChange = AshrootUniqueRuntime.UniqueChange<UniqueFields>;

    func compute_unique_change(prev : Types.Vote, next : Types.Vote) : UniqueChange {
      AshrootUniqueRuntime.compute(
        prev,
        next,
        func(prevDoc : Types.Vote, nextDoc : Types.Vote) : UniqueFields {
          {
            byJudgeEntry = do {
              let prevKey = (func(prevDoc : Types.Vote) : (Nat64, Nat64) { (prevDoc.judge_id, prevDoc.entry_id) })(prevDoc);
              let nextKey = (func(nextDoc : Types.Vote) : (Nat64, Nat64) { (nextDoc.judge_id, nextDoc.entry_id) })(nextDoc);
              {
                changed = cmpK_byJudgeEntry(prevKey, nextKey) != #equal;
                prev = prevKey;
                next = nextKey;
              };
            };
          };
        },
        func(fields : UniqueFields) : Bool {
          fields.byJudgeEntry.changed;
        },
      );
    };

    func index_add_all(slot : Nat64, d : Types.Vote) : () {
      let key_byJudgeEntry = (func(d : Types.Vote) : (Nat64, Nat64) { (d.judge_id, d.entry_id) })(d);
      IndexCore.insertWithRetention(idx_byJudgeEntryStore, cmpStore_byJudgeEntry, keep_byJudgeEntry, (key_byJudgeEntry, slot));
      let key_byJudgeWeek = (func(d : Types.Vote) : (Nat64, Nat64, Nat) { (d.judge_id, d.season_id, d.week) })(d);
      IndexCore.insertWithRetention(idx_byJudgeWeekStore, cmpStore_byJudgeWeek, keep_byJudgeWeek, (key_byJudgeWeek, slot));
      let key_byEntry = d.entry_id;
      IndexCore.insertWithRetention(idx_byEntryStore, cmpStore_byEntry, keep_byEntry, (key_byEntry, slot));
      let key_byJudge = d.judge_id;
      IndexCore.insertWithRetention(idx_byJudgeStore, cmpStore_byJudge, keep_byJudge, (key_byJudge, slot));
    };

    func index_del_all(slot : Nat64, d : Types.Vote) : () {
      let key_byJudgeEntry = (func(d : Types.Vote) : (Nat64, Nat64) { (d.judge_id, d.entry_id) })(d);
      IndexCore.deleteKey(idx_byJudgeEntryStore, cmpStore_byJudgeEntry, (key_byJudgeEntry, slot));
      let key_byJudgeWeek = (func(d : Types.Vote) : (Nat64, Nat64, Nat) { (d.judge_id, d.season_id, d.week) })(d);
      IndexCore.deleteKey(idx_byJudgeWeekStore, cmpStore_byJudgeWeek, (key_byJudgeWeek, slot));
      let key_byEntry = d.entry_id;
      IndexCore.deleteKey(idx_byEntryStore, cmpStore_byEntry, (key_byEntry, slot));
      let key_byJudge = d.judge_id;
      IndexCore.deleteKey(idx_byJudgeStore, cmpStore_byJudge, (key_byJudge, slot));
    };

    func index_refresh_on_update(slot : Nat64, prev : Types.Vote, next : Types.Vote, change : UniqueChange) : () {
      let delta_byJudgeEntry = change.fields.byJudgeEntry;
      if (delta_byJudgeEntry.changed) {
        IndexCore.deleteKey(idx_byJudgeEntryStore, cmpStore_byJudgeEntry, (delta_byJudgeEntry.prev, slot));
        IndexCore.insertWithRetention(idx_byJudgeEntryStore, cmpStore_byJudgeEntry, keep_byJudgeEntry, (delta_byJudgeEntry.next, slot));
      };

      let prevKey_byJudgeWeek = (func(prev : Types.Vote) : (Nat64, Nat64, Nat) { (prev.judge_id, prev.season_id, prev.week) })(prev);
      let nextKey_byJudgeWeek = (func(next : Types.Vote) : (Nat64, Nat64, Nat) { (next.judge_id, next.season_id, next.week) })(next);
      var changed_byJudgeWeek : Bool = false;
      if (cmpK_byJudgeWeek(prevKey_byJudgeWeek, nextKey_byJudgeWeek) != #equal) {
        IndexCore.deleteKey(idx_byJudgeWeekStore, cmpStore_byJudgeWeek, (prevKey_byJudgeWeek, slot));
        IndexCore.insertWithRetention(idx_byJudgeWeekStore, cmpStore_byJudgeWeek, keep_byJudgeWeek, (nextKey_byJudgeWeek, slot));
        changed_byJudgeWeek := true;
      };

      let prevKey_byEntry = prev.entry_id;
      let nextKey_byEntry = next.entry_id;
      var changed_byEntry : Bool = false;
      if (cmpK_byEntry(prevKey_byEntry, nextKey_byEntry) != #equal) {
        IndexCore.deleteKey(idx_byEntryStore, cmpStore_byEntry, (prevKey_byEntry, slot));
        IndexCore.insertWithRetention(idx_byEntryStore, cmpStore_byEntry, keep_byEntry, (nextKey_byEntry, slot));
        changed_byEntry := true;
      };

      let prevKey_byJudge = prev.judge_id;
      let nextKey_byJudge = next.judge_id;
      var changed_byJudge : Bool = false;
      if (cmpK_byJudge(prevKey_byJudge, nextKey_byJudge) != #equal) {
        IndexCore.deleteKey(idx_byJudgeStore, cmpStore_byJudge, (prevKey_byJudge, slot));
        IndexCore.insertWithRetention(idx_byJudgeStore, cmpStore_byJudge, keep_byJudge, (nextKey_byJudge, slot));
        changed_byJudge := true;
      };
    };

    func ensure_unique_byJudgeEntry(d : Types.Vote, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      let uniqueKey_byJudgeEntry = (func(d : Types.Vote) : (Nat64, Nat64) { (d.judge_id, d.entry_id) })(d);
      switch (IndexRuntime.indexKeyConflict(idx_byJudgeEntryStore, cmpStore_byJudgeEntry, cmpK_byJudgeEntry, rowAccess, projectPk, uniqueKey_byJudgeEntry, skipPk)) {
        case (?owner) { return #err(#AlreadyExists(owner)) };
        case null {};
      };
      #ok();
    };

    func ensure_unique_constraints(d : Types.Vote, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      switch (ensure_unique_byJudgeEntry(d, skipPk)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      #ok();
    };

    func validateCreateConstraints(data : Types.CreateVote) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func validateDocConstraints(doc : Types.Vote) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func makeDoc(id : Nat64, data : Types.CreateVote) : Types.Vote {
      {
        id = id;
        entry_id = data.entry_id;
        judge_id = data.judge_id;
        season_id = data.season_id;
        week = data.week;
        at = data.at;
      };
    };

    func insertOne(data : Types.CreateVote) : Result.Result<Nat64, Errors.Error> {
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

    func getOne(pk : Nat64) : ?Types.Vote {
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

    func updateOne(doc : Types.Vote) : Result.Result<Types.Vote, Errors.Error> {
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
                if (uniqueChange.fields.byJudgeEntry.changed) {
                  switch (ensure_unique_byJudgeEntry(doc, ?pk)) {
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

    func upsertOne(doc : Types.Vote) : Result.Result<{ #inserted; #updated }, Errors.Error> {
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
                if (uniqueChange.fields.byJudgeEntry.changed) {
                  switch (ensure_unique_byJudgeEntry(doc, ?pk)) {
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

    func insertManyImpl(records : [Types.CreateVote]) : Result.Result<[Nat64], Errors.Error> {
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

    func upsertManyImpl(records : [Types.Vote]) : Result.Result<{ inserted : Nat; updated : Nat }, Errors.Error> {
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

    func getManyImpl(pks : [Nat64]) : [(Nat64, ?Types.Vote)] {
      Array.tabulate<(Nat64, ?Types.Vote)>(
        Array.size(pks),
        func(i : Nat) : (Nat64, ?Types.Vote) {
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

    let deleteDoc = func(slot : Nat64, d : Types.Vote) : Result.Result<(), Errors.Error> {
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

    func encodeByJudgeEntryCursor(dir : IndexCore.Direction, entry : ((Nat64, Nat64), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1) = storeKey;
      Cursors.encodeComposite(dir, "Nat64_Nat64", [Cursors.encodeSegmentNat64(k0), Cursors.encodeSegmentNat64(k1)], pk);
    };

    func decodeByJudgeEntryCursor(token : Cursors.Token) : ?((Nat64, Nat64), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat64_Nat64", 2)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat64(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentNat64(segments[1]) else return null;
          let key = (k0, k1);
          ?(key, pk);
        };
        case null null;
      };
    };

    func encodeByJudgeWeekCursor(dir : IndexCore.Direction, entry : ((Nat64, Nat64, Nat), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1, k2) = storeKey;
      Cursors.encodeComposite(dir, "Nat64_Nat64_Nat", [Cursors.encodeSegmentNat64(k0), Cursors.encodeSegmentNat64(k1), Cursors.encodeSegmentNat(k2)], pk);
    };

    func decodeByJudgeWeekCursor(token : Cursors.Token) : ?((Nat64, Nat64, Nat), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat64_Nat64_Nat", 3)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat64(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentNat64(segments[1]) else return null;
          let ?k2 = Cursors.decodeSegmentNat(segments[2]) else return null;
          let key = (k0, k1, k2);
          ?(key, pk);
        };
        case null null;
      };
    };

    let byJudgeEntryFind = func(dir : IndexCore.Direction, start : (Nat64, Nat64), limit : Nat) : Iter.Iter<Types.Vote> {
      IndexRuntime.makeFindIter<(Nat64, Nat64), Types.Vote>(rowAccess, idx_byJudgeEntryStore, cmpStore_byJudgeEntry, cmpK_byJudgeEntry, dir, start, limit);
    };

    let byJudgeWeekFind = func(dir : IndexCore.Direction, start : (Nat64, Nat64, Nat), limit : Nat) : Iter.Iter<Types.Vote> {
      IndexRuntime.makeFindIter<(Nat64, Nat64, Nat), Types.Vote>(rowAccess, idx_byJudgeWeekStore, cmpStore_byJudgeWeek, cmpK_byJudgeWeek, dir, start, limit);
    };

    let byEntryFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Vote> {
      IndexRuntime.makeFindIter<Nat64, Types.Vote>(rowAccess, idx_byEntryStore, cmpStore_byEntry, cmpK_byEntry, dir, start, limit);
    };

    let byJudgeFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Vote> {
      IndexRuntime.makeFindIter<Nat64, Types.Vote>(rowAccess, idx_byJudgeStore, cmpStore_byJudge, cmpK_byJudge, dir, start, limit);
    };

    let byJudgeEntryOps = IndexRuntime.makeIndexOps<(Nat64, Nat64), Types.Vote, Errors.Error>(
      "byJudgeEntry",
      idx_byJudgeEntryStore,
      cmpK_byJudgeEntry,
      cmpStore_byJudgeEntry,
      keep_byJudgeEntry,
      rowAccess,
      projectPk,
      decodeByJudgeEntryCursor,
      encodeByJudgeEntryCursor,
      byJudgeEntryFind,
      deleteDoc,
    );

    let byJudgeWeekOps = IndexRuntime.makeIndexOps<(Nat64, Nat64, Nat), Types.Vote, Errors.Error>(
      "byJudgeWeek",
      idx_byJudgeWeekStore,
      cmpK_byJudgeWeek,
      cmpStore_byJudgeWeek,
      keep_byJudgeWeek,
      rowAccess,
      projectPk,
      decodeByJudgeWeekCursor,
      encodeByJudgeWeekCursor,
      byJudgeWeekFind,
      deleteDoc,
    );

    let byEntryOps = IndexRuntime.makeIndexOps<Nat64, Types.Vote, Errors.Error>(
      "byEntry",
      idx_byEntryStore,
      cmpK_byEntry,
      cmpStore_byEntry,
      keep_byEntry,
      rowAccess,
      projectPk,
      Cursors.decodeNat64,
      encodeNat64Cursor,
      byEntryFind,
      deleteDoc,
    );

    let byJudgeOps = IndexRuntime.makeIndexOps<Nat64, Types.Vote, Errors.Error>(
      "byJudge",
      idx_byJudgeStore,
      cmpK_byJudge,
      cmpStore_byJudge,
      keep_byJudge,
      rowAccess,
      projectPk,
      Cursors.decodeNat64,
      encodeNat64Cursor,
      byJudgeFind,
      deleteDoc,
    );

    let iterPrimary = AshrootPrimaryIter.make(rowAccess, pk_indexStore, cmpPKStore);
    let iter = AshrootListIter.make(rowsStore);
    let mapIter = func<R>(dir : IndexCore.Direction, f : Types.Vote -> R) : Iter.Iter<R> {
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
    let foldIter = func<A>(dir : IndexCore.Direction, init : A, f : (A, Types.Vote) -> A) : A {
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

    var rel_entry_id_parentExists : (Nat64 -> Bool) = func(_) : Bool { false };
    var rel_entry_id_installed : Bool = false;
    func rel_entry_id_range(value : Nat64) : IndexRuntime.IndexRange<Nat64> {
      {
        gt = null;
        gte = ?value;
        lt = null;
        lte = ?value;
        dir = #fwd;
      };
    };
    func rel_entry_id_checkParent(id : Nat64) : Result.Result<(), Errors.Error> {
      if (not rel_entry_id_installed) {
        return #err(#Internal("foreign key votes.entry_id parent lookup not installed"));
      };
      if (rel_entry_id_parentExists(id)) {
        #ok();
      } else {
        return #err(#Internal("referential integrity violation: entries.id " # Nat64.toText(id) # " not found for votes.entry_id"));
      };
    };
    func rel_entry_id_validateCreate(data : Types.CreateVote) : Result.Result<(), Errors.Error> {
      return rel_entry_id_checkParent(data.entry_id);
    };
    func rel_entry_id_validateDoc(doc : Types.Vote) : Result.Result<(), Errors.Error> {
      return rel_entry_id_checkParent(doc.entry_id);
    };
    func rel_entry_id_countDependents(parentId : Nat64) : Nat {
      let iter = Set.valuesFrom(idx_byEntryStore, cmpStore_byEntry, (parentId, Nat64.fromNat(0)));
      var total : Nat = 0;
      label scan while (true) {
        switch (iter.next()) {
          case null { return total };
          case (?entry) {
            let (key, slot) = entry;
            switch (cmpK_byEntry(key, parentId)) {
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
    func rel_entry_id_deleteDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      let range = rel_entry_id_range(parentId);
      var cursor : ?Cursors.Token = null;
      var hasMore = true;
      let chunk : Nat = 1024;
      while (hasMore) {
        switch (byEntryOps.rangeDelete(range, chunk, cursor)) {
          case (#ok(outcome)) {
            cursor := outcome.cursor;
            hasMore := outcome.hasMore;
          };
          case (#err(e)) { return #err(e) };
        };
      };
      #ok();
    };
    func rel_entry_id_setNullDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      #err(#Internal("setNull not supported for votes.entry_id"));
    };
    func rel_entry_id_installParent(checker : Nat64 -> Bool) : () {
      rel_entry_id_parentExists := checker;
      rel_entry_id_installed := true;
    };
    let entry_idManager_runtime : ForeignKeyRuntime = {
      field = "entry_id";
      parentTable = "entries";
      notNull = true;
      onDelete = #cascade;
      installParentExists = rel_entry_id_installParent;
      validateCreate = rel_entry_id_validateCreate;
      validateDoc = rel_entry_id_validateDoc;
      countDependents = rel_entry_id_countDependents;
      deleteDependents = rel_entry_id_deleteDependents;
      setNullDependents = rel_entry_id_setNullDependents;
      formatError = formatError;
    };

    let entry_idManager : ForeignKeyManager = entry_idManager_runtime;

    var rel_judge_id_parentExists : (Nat64 -> Bool) = func(_) : Bool { false };
    var rel_judge_id_installed : Bool = false;
    func rel_judge_id_range(value : Nat64) : IndexRuntime.IndexRange<Nat64> {
      {
        gt = null;
        gte = ?value;
        lt = null;
        lte = ?value;
        dir = #fwd;
      };
    };
    func rel_judge_id_checkParent(id : Nat64) : Result.Result<(), Errors.Error> {
      if (not rel_judge_id_installed) {
        return #err(#Internal("foreign key votes.judge_id parent lookup not installed"));
      };
      if (rel_judge_id_parentExists(id)) {
        #ok();
      } else {
        return #err(#Internal("referential integrity violation: users.id " # Nat64.toText(id) # " not found for votes.judge_id"));
      };
    };
    func rel_judge_id_validateCreate(data : Types.CreateVote) : Result.Result<(), Errors.Error> {
      return rel_judge_id_checkParent(data.judge_id);
    };
    func rel_judge_id_validateDoc(doc : Types.Vote) : Result.Result<(), Errors.Error> {
      return rel_judge_id_checkParent(doc.judge_id);
    };
    func rel_judge_id_countDependents(parentId : Nat64) : Nat {
      let iter = Set.valuesFrom(idx_byJudgeStore, cmpStore_byJudge, (parentId, Nat64.fromNat(0)));
      var total : Nat = 0;
      label scan while (true) {
        switch (iter.next()) {
          case null { return total };
          case (?entry) {
            let (key, slot) = entry;
            switch (cmpK_byJudge(key, parentId)) {
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
    func rel_judge_id_deleteDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      let range = rel_judge_id_range(parentId);
      var cursor : ?Cursors.Token = null;
      var hasMore = true;
      let chunk : Nat = 1024;
      while (hasMore) {
        switch (byJudgeOps.rangeDelete(range, chunk, cursor)) {
          case (#ok(outcome)) {
            cursor := outcome.cursor;
            hasMore := outcome.hasMore;
          };
          case (#err(e)) { return #err(e) };
        };
      };
      #ok();
    };
    func rel_judge_id_setNullDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      #err(#Internal("setNull not supported for votes.judge_id"));
    };
    func rel_judge_id_installParent(checker : Nat64 -> Bool) : () {
      rel_judge_id_parentExists := checker;
      rel_judge_id_installed := true;
    };
    let judge_idManager_runtime : ForeignKeyRuntime = {
      field = "judge_id";
      parentTable = "users";
      notNull = true;
      onDelete = #restrict;
      installParentExists = rel_judge_id_installParent;
      validateCreate = rel_judge_id_validateCreate;
      validateDoc = rel_judge_id_validateDoc;
      countDependents = rel_judge_id_countDependents;
      deleteDependents = rel_judge_id_deleteDependents;
      setNullDependents = rel_judge_id_setNullDependents;
      formatError = formatError;
    };

    let judge_idManager : ForeignKeyManager = judge_idManager_runtime;

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
      byJudgeEntry = byJudgeEntryOps;
      byJudgeWeek = byJudgeWeekOps;
      byEntry = byEntryOps;
      byJudge = byJudgeOps;
    };

    let relations : RelationBundle = {
      foreignKeys = [entry_idManager, judge_idManager];
    };
    let relationsInternal : RelationRuntimeBundle = {
      foreignKeys = [entry_idManager_runtime, judge_idManager_runtime];
    };

    { table; relations; relationsInternal };

  };
};
