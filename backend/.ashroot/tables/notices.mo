// ── Reports ─────────────────────────────────────────────────────────────────
// Public notice text and its moderation state live here. Time and reporter
// indexes support admission limits, cleanup, and the review queue.
import Map "mo:core/Map";
import Set "mo:core/Set";
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
    public module Notice {
      public module State {
        public type Type = {
          #fresh;
          #reviewed;
          #dismissed;
        };
      };
      public type State = State.Type;
      public type HandledBy = Nat64;
      public type Type = {
        id : Nat64;
        reporter : Principal;
        body : Text;
        at : Nat64;
        state : State;
        handledBy : ?HandledBy;
        handledAt : Nat64;
      };
      public module Mutation {
        public type Type = {
          var id : ?Nat64;
          var reporter : ?Principal;
          var body : ?Text;
          var at : ?Nat64;
          var state : ?State;
          var handledBy : ??HandledBy;
          var handledAt : ?Nat64;
        };
        public func new() : Type {
          {
            var id = null;
            var reporter = null;
            var body = null;
            var at = null;
            var state = null;
            var handledBy = null;
            var handledAt = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type Notice = Notice.Type;

    public module CreateNotice {
      public module State {
        public type Type = {
          #fresh;
          #reviewed;
          #dismissed;
        };
      };
      public type State = State.Type;
      public type HandledBy = Nat64;
      public type Type = {
        reporter : Principal;
        body : Text;
        at : Nat64;
        state : State;
        handledBy : ?HandledBy;
        handledAt : Nat64;
      };
      public module Mutation {
        public type Type = {
          var reporter : ?Principal;
          var body : ?Text;
          var at : ?Nat64;
          var state : ?State;
          var handledBy : ??HandledBy;
          var handledAt : ?Nat64;
        };
        public func new() : Type {
          {
            var reporter = null;
            var body = null;
            var at = null;
            var state = null;
            var handledBy = null;
            var handledAt = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type CreateNotice = CreateNotice.Type;
  };

  public module Errors {
    public type Error = AshrootErrors.Error;
  };

  public type RelationDeletePolicy = AshrootRelations.DeletePolicy;

  public type ForeignKeyManager = AshrootRelations.ForeignKeyManager<Types.Notice, Types.CreateNotice, Errors.Error>;

  public type ForeignKeyRuntime = AshrootRelations.ForeignKeyRuntime<Types.Notice, Types.CreateNotice, Errors.Error>;

  public type RelationBundle = AshrootRelations.Bundle<Types.Notice, Types.CreateNotice, Errors.Error>;

  public type RelationRuntimeBundle = AshrootRelations.RuntimeBundle<Types.Notice, Types.CreateNotice, Errors.Error>;

  public type Init = {
    var nextId : Nat64;
    rows : List.List<?Types.Notice>;
    var deletedSlots : PureList.List<Nat64>;
    var rowCount : Nat;
    pk_index : Set.Set<(Nat64, Nat64)>;
    idx_byTime : Set.Set<(Nat64, Nat64)>;
    idx_byReporter : Set.Set<(Principal, Nat64)>;
  };

  public func init() : Init {
    {
      var nextId = Nat64.fromNat(1);
      rows = List.empty<?Types.Notice>();
      var deletedSlots = null;
      var rowCount = 0;
      pk_index = Set.empty<(Nat64, Nat64)>();
      idx_byTime = Set.empty<(Nat64, Nat64)>();
      idx_byReporter = Set.empty<(Principal, Nat64)>();
    };
  };

  public type IndexRange<K> = IndexRuntime.IndexRange<K>;

  public type RangeDeleteResult = IndexRuntime.RangeDeleteResult;

  public type IndexDescriptor<K> = IndexRuntime.IndexDescriptor<K>;

  public type IndexOps<K> = IndexRuntime.IndexOps<K, Types.Notice, Errors.Error>;

  public type Use = AshrootTableOps.Common<Types.Notice, Types.CreateNotice, Errors.Error, Nat64> and {
    iterPrimary : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Types.Notice)>;
    iter : (IndexCore.Direction) -> Iter.Iter<Types.Notice>;
    byTime : IndexOps<Nat64>;
    byReporter : IndexOps<Principal>;
  };

  public type UseBundle = AshrootUseBundle.Bundle<Use, Types.Notice, Types.CreateNotice, Errors.Error>;

  public func use(store : Init) : UseBundle {
    let cmpPK = Nat64.compare;

    let cmpK_byTime = Nat64.compare;
    let cmpStore_byTime = IndexCore.cmpStoreKey<Nat64>(cmpK_byTime);

    let cmpK_byReporter = Principal.compare;
    let cmpStore_byReporter = IndexCore.cmpStoreKey<Principal>(cmpK_byReporter);

    let keep_byTime : IndexCore.Keep = #all;
    let keep_byReporter : IndexCore.Keep = #all;

    let rowsStore = store.rows;
    let pk_indexStore = store.pk_index;
    let idx_byTimeStore = store.idx_byTime;
    let idx_byReporterStore = store.idx_byReporter;
    let cmpPKStore = IndexCore.cmpStoreKey<Nat64>(Nat64.compare);

    func slotToNat(slot : Nat64) : Nat { Nat64.toNat(slot) };

    func rowsGet(slot : Nat64) : ?Types.Notice {
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

    func rowsPut(slot : Nat64, doc : Types.Notice) : () {
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

    func allocSlot(doc : Types.Notice) : Nat64 {
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

    func projectPk(doc : Types.Notice) : Nat64 { doc.id };

    let rowAccess : IndexRuntime.RowStore<Types.Notice> = {
      get = rowsGet;
      has = rowsHas;
    };

    let nextIdManager = AshrootUseRuntime.manageNextId(store);

    func index_add_all(slot : Nat64, d : Types.Notice) : () {
      let key_byTime = d.at;
      IndexCore.insertWithRetention(idx_byTimeStore, cmpStore_byTime, keep_byTime, (key_byTime, slot));
      let key_byReporter = d.reporter;
      IndexCore.insertWithRetention(idx_byReporterStore, cmpStore_byReporter, keep_byReporter, (key_byReporter, slot));
    };

    func index_del_all(slot : Nat64, d : Types.Notice) : () {
      let key_byTime = d.at;
      IndexCore.deleteKey(idx_byTimeStore, cmpStore_byTime, (key_byTime, slot));
      let key_byReporter = d.reporter;
      IndexCore.deleteKey(idx_byReporterStore, cmpStore_byReporter, (key_byReporter, slot));
    };

    func index_refresh_on_update(slot : Nat64, prev : Types.Notice, next : Types.Notice) : () {
      let prevKey_byTime = prev.at;
      let nextKey_byTime = next.at;
      var changed_byTime : Bool = false;
      if (cmpK_byTime(prevKey_byTime, nextKey_byTime) != #equal) {
        IndexCore.deleteKey(idx_byTimeStore, cmpStore_byTime, (prevKey_byTime, slot));
        IndexCore.insertWithRetention(idx_byTimeStore, cmpStore_byTime, keep_byTime, (nextKey_byTime, slot));
        changed_byTime := true;
      };

      let prevKey_byReporter = prev.reporter;
      let nextKey_byReporter = next.reporter;
      var changed_byReporter : Bool = false;
      if (cmpK_byReporter(prevKey_byReporter, nextKey_byReporter) != #equal) {
        IndexCore.deleteKey(idx_byReporterStore, cmpStore_byReporter, (prevKey_byReporter, slot));
        IndexCore.insertWithRetention(idx_byReporterStore, cmpStore_byReporter, keep_byReporter, (nextKey_byReporter, slot));
        changed_byReporter := true;
      };
    };

    func validateCreateConstraints(data : Types.CreateNotice) : Result.Result<(), Errors.Error> {
      let len_body = Text.size(data.body);
      if (len_body > 500) {
        return #err(#ConstraintViolation({ field = "body"; message = "length must be <= 500" }));
      };
      #ok();
    };

    func validateDocConstraints(doc : Types.Notice) : Result.Result<(), Errors.Error> {
      let len_body = Text.size(doc.body);
      if (len_body > 500) {
        return #err(#ConstraintViolation({ field = "body"; message = "length must be <= 500" }));
      };
      #ok();
    };

    func makeDoc(id : Nat64, data : Types.CreateNotice) : Types.Notice {
      {
        id = id;
        reporter = data.reporter;
        body = data.body;
        at = data.at;
        state = data.state;
        handledBy = data.handledBy;
        handledAt = data.handledAt;
      };
    };

    func insertOne(data : Types.CreateNotice) : Result.Result<Nat64, Errors.Error> {
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

    func getOne(pk : Nat64) : ?Types.Notice {
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

    func updateOne(doc : Types.Notice) : Result.Result<Types.Notice, Errors.Error> {
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

    func upsertOne(doc : Types.Notice) : Result.Result<{ #inserted; #updated }, Errors.Error> {
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

    func insertManyImpl(records : [Types.CreateNotice]) : Result.Result<[Nat64], Errors.Error> {
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

    func upsertManyImpl(records : [Types.Notice]) : Result.Result<{ inserted : Nat; updated : Nat }, Errors.Error> {
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

    func getManyImpl(pks : [Nat64]) : [(Nat64, ?Types.Notice)] {
      Array.tabulate<(Nat64, ?Types.Notice)>(
        Array.size(pks),
        func(i : Nat) : (Nat64, ?Types.Notice) {
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

    let deleteDoc = func(slot : Nat64, d : Types.Notice) : Result.Result<(), Errors.Error> {
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

    func encodePrincipalCursor(dir : IndexCore.Direction, entry : (Principal, Nat64)) : Cursors.Token {
      let (k, pk) = entry;
      Cursors.encodePrincipal(dir, k, pk);
    };

    let byTimeFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Notice> {
      IndexRuntime.makeFindIter<Nat64, Types.Notice>(rowAccess, idx_byTimeStore, cmpStore_byTime, cmpK_byTime, dir, start, limit);
    };

    let byReporterFind = func(dir : IndexCore.Direction, start : Principal, limit : Nat) : Iter.Iter<Types.Notice> {
      IndexRuntime.makeFindIter<Principal, Types.Notice>(rowAccess, idx_byReporterStore, cmpStore_byReporter, cmpK_byReporter, dir, start, limit);
    };

    let byTimeOps = IndexRuntime.makeIndexOps<Nat64, Types.Notice, Errors.Error>(
      "byTime",
      idx_byTimeStore,
      cmpK_byTime,
      cmpStore_byTime,
      keep_byTime,
      rowAccess,
      projectPk,
      Cursors.decodeNat64,
      encodeNat64Cursor,
      byTimeFind,
      deleteDoc,
    );

    let byReporterOps = IndexRuntime.makeIndexOps<Principal, Types.Notice, Errors.Error>(
      "byReporter",
      idx_byReporterStore,
      cmpK_byReporter,
      cmpStore_byReporter,
      keep_byReporter,
      rowAccess,
      projectPk,
      Cursors.decodePrincipal,
      encodePrincipalCursor,
      byReporterFind,
      deleteDoc,
    );

    let iterPrimary = AshrootPrimaryIter.make(rowAccess, pk_indexStore, cmpPKStore);
    let iter = AshrootListIter.make(rowsStore);
    let mapIter = func<R>(dir : IndexCore.Direction, f : Types.Notice -> R) : Iter.Iter<R> {
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
    let foldIter = func<A>(dir : IndexCore.Direction, init : A, f : (A, Types.Notice) -> A) : A {
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
      byTime = byTimeOps;
      byReporter = byReporterOps;
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
