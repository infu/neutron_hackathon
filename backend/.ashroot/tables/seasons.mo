/**
 * Authoritative season state.
 *
 * Deadlines, bracket phase, funding observations, and payout progress live on
 * the same durable row. Timer recovery has one place to resume from.
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
    public module Season {
      public module Phase {
        public type Type = {
          #draft;
          #running;
          #finished;
        };
      };
      public type Phase = Phase.Type;
      public module Payout {
        public type Type = {
          #none;
          #proposed;
          #approved;
          #paying;
          #paid;
          #failed;
        };
      };
      public type Payout = Payout.Type;
      public module FundingFailures {
        public module Element {
          public type Type = {
            ledger : Principal;
            reason : Text;
          };
          public module Mutation {
            public type Type = {
              var ledger : ?Principal;
              var reason : ?Text;
            };
            public func new() : Type {
              {
                var ledger = null;
                var reason = null;
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
      public type FundingFailures = FundingFailures.Type;
      public type Type = {
        id : Nat64;
        number : Nat;
        week : Nat;
        phase : Phase;
        payout : Payout;
        startedAt : Nat64;
        weekEndsAt : Nat64;
        endedAt : Nat64;
        fundingReady : Bool;
        fundingAttempts : Nat;
        fundingFailures : FundingFailures;
      };
      public module Mutation {
        public type Type = {
          var id : ?Nat64;
          var number : ?Nat;
          var week : ?Nat;
          var phase : ?Phase;
          var payout : ?Payout;
          var startedAt : ?Nat64;
          var weekEndsAt : ?Nat64;
          var endedAt : ?Nat64;
          var fundingReady : ?Bool;
          var fundingAttempts : ?Nat;
          var fundingFailures : ?FundingFailures;
        };
        public func new() : Type {
          {
            var id = null;
            var number = null;
            var week = null;
            var phase = null;
            var payout = null;
            var startedAt = null;
            var weekEndsAt = null;
            var endedAt = null;
            var fundingReady = null;
            var fundingAttempts = null;
            var fundingFailures = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type Season = Season.Type;

    public module CreateSeason {
      public module Phase {
        public type Type = {
          #draft;
          #running;
          #finished;
        };
      };
      public type Phase = Phase.Type;
      public module Payout {
        public type Type = {
          #none;
          #proposed;
          #approved;
          #paying;
          #paid;
          #failed;
        };
      };
      public type Payout = Payout.Type;
      public module FundingFailures {
        public module Element {
          public type Type = {
            ledger : Principal;
            reason : Text;
          };
          public module Mutation {
            public type Type = {
              var ledger : ?Principal;
              var reason : ?Text;
            };
            public func new() : Type {
              {
                var ledger = null;
                var reason = null;
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
      public type FundingFailures = FundingFailures.Type;
      public type Type = {
        number : Nat;
        week : Nat;
        phase : Phase;
        payout : Payout;
        startedAt : Nat64;
        weekEndsAt : Nat64;
        endedAt : Nat64;
        fundingReady : Bool;
        fundingAttempts : Nat;
        fundingFailures : FundingFailures;
      };
      public module Mutation {
        public type Type = {
          var number : ?Nat;
          var week : ?Nat;
          var phase : ?Phase;
          var payout : ?Payout;
          var startedAt : ?Nat64;
          var weekEndsAt : ?Nat64;
          var endedAt : ?Nat64;
          var fundingReady : ?Bool;
          var fundingAttempts : ?Nat;
          var fundingFailures : ?FundingFailures;
        };
        public func new() : Type {
          {
            var number = null;
            var week = null;
            var phase = null;
            var payout = null;
            var startedAt = null;
            var weekEndsAt = null;
            var endedAt = null;
            var fundingReady = null;
            var fundingAttempts = null;
            var fundingFailures = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type CreateSeason = CreateSeason.Type;
  };

  public module Errors {
    public type Error = AshrootErrors.Error;
  };

  public type RelationDeletePolicy = AshrootRelations.DeletePolicy;

  public type ForeignKeyManager = AshrootRelations.ForeignKeyManager<Types.Season, Types.CreateSeason, Errors.Error>;

  public type ForeignKeyRuntime = AshrootRelations.ForeignKeyRuntime<Types.Season, Types.CreateSeason, Errors.Error>;

  public type RelationBundle = AshrootRelations.Bundle<Types.Season, Types.CreateSeason, Errors.Error>;

  public type RelationRuntimeBundle = AshrootRelations.RuntimeBundle<Types.Season, Types.CreateSeason, Errors.Error>;

  public type Init = {
    var nextId : Nat64;
    rows : List.List<?Types.Season>;
    var deletedSlots : PureList.List<Nat64>;
    var rowCount : Nat;
    pk_index : Set.Set<(Nat64, Nat64)>;
    idx_byNumber : Set.Set<(Nat, Nat64)>;
    idx_byRunning : Set.Set<(Nat64, Nat64)>;
  };

  public func init() : Init {
    {
      var nextId = Nat64.fromNat(1);
      rows = List.empty<?Types.Season>();
      var deletedSlots = null;
      var rowCount = 0;
      pk_index = Set.empty<(Nat64, Nat64)>();
      idx_byNumber = Set.empty<(Nat, Nat64)>();
      idx_byRunning = Set.empty<(Nat64, Nat64)>();
    };
  };

  public type IndexRange<K> = IndexRuntime.IndexRange<K>;

  public type RangeDeleteResult = IndexRuntime.RangeDeleteResult;

  public type IndexDescriptor<K> = IndexRuntime.IndexDescriptor<K>;

  public type IndexOps<K> = IndexRuntime.IndexOps<K, Types.Season, Errors.Error>;

  public type Use = AshrootTableOps.Common<Types.Season, Types.CreateSeason, Errors.Error, Nat64> and {
    iterPrimary : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Types.Season)>;
    iter : (IndexCore.Direction) -> Iter.Iter<Types.Season>;
    byNumber : IndexOps<Nat>;
    byRunning : IndexOps<Nat64>;
  };

  public type UseBundle = AshrootUseBundle.Bundle<Use, Types.Season, Types.CreateSeason, Errors.Error>;

  public func use(store : Init) : UseBundle {
    let cmpPK = Nat64.compare;

    let cmpK_byNumber = Nat.compare;
    let cmpStore_byNumber = IndexCore.cmpStoreKey<Nat>(cmpK_byNumber);

    let cmpK_byRunning = Nat64.compare;
    let cmpStore_byRunning = IndexCore.cmpStoreKey<Nat64>(cmpK_byRunning);

    func key_byRunning(d : Types.Season) : ?Nat64 {
      (func(d : Types.Season) : ?Nat64 { switch (d.phase) { case (#running) ?d.id; case (_) null } })(d);
    };

    let keep_byNumber : IndexCore.Keep = #all;
    let keep_byRunning : IndexCore.Keep = #all;

    let rowsStore = store.rows;
    let pk_indexStore = store.pk_index;
    let idx_byNumberStore = store.idx_byNumber;
    let idx_byRunningStore = store.idx_byRunning;
    let cmpPKStore = IndexCore.cmpStoreKey<Nat64>(Nat64.compare);

    func slotToNat(slot : Nat64) : Nat { Nat64.toNat(slot) };

    func rowsGet(slot : Nat64) : ?Types.Season {
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

    func rowsPut(slot : Nat64, doc : Types.Season) : () {
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

    func allocSlot(doc : Types.Season) : Nat64 {
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

    func projectPk(doc : Types.Season) : Nat64 { doc.id };

    let rowAccess : IndexRuntime.RowStore<Types.Season> = {
      get = rowsGet;
      has = rowsHas;
    };

    let nextIdManager = AshrootUseRuntime.manageNextId(store);

    type UniqueFields = {
      byNumber : AshrootUniqueRuntime.FieldChange<Nat>;
    };
    type UniqueChange = AshrootUniqueRuntime.UniqueChange<UniqueFields>;

    func compute_unique_change(prev : Types.Season, next : Types.Season) : UniqueChange {
      AshrootUniqueRuntime.compute(
        prev,
        next,
        func(prevDoc : Types.Season, nextDoc : Types.Season) : UniqueFields {
          {
            byNumber = do {
              let prevKey = prevDoc.number;
              let nextKey = nextDoc.number;
              {
                changed = cmpK_byNumber(prevKey, nextKey) != #equal;
                prev = prevKey;
                next = nextKey;
              };
            };
          };
        },
        func(fields : UniqueFields) : Bool {
          fields.byNumber.changed;
        },
      );
    };

    func index_add_all(slot : Nat64, d : Types.Season) : () {
      let key_byNumber = d.number;
      IndexCore.insertWithRetention(idx_byNumberStore, cmpStore_byNumber, keep_byNumber, (key_byNumber, slot));
      switch (key_byRunning(d)) {
        case (?k) {
          IndexCore.insertWithRetention(idx_byRunningStore, cmpStore_byRunning, keep_byRunning, (k, slot));
        };
        case null {};
      };
    };

    func index_del_all(slot : Nat64, d : Types.Season) : () {
      let key_byNumber = d.number;
      IndexCore.deleteKey(idx_byNumberStore, cmpStore_byNumber, (key_byNumber, slot));
      switch (key_byRunning(d)) {
        case (?k) {
          IndexCore.deleteKey(idx_byRunningStore, cmpStore_byRunning, (k, slot));
        };
        case null {};
      };
    };

    func index_refresh_on_update(slot : Nat64, prev : Types.Season, next : Types.Season, change : UniqueChange) : () {
      let delta_byNumber = change.fields.byNumber;
      if (delta_byNumber.changed) {
        IndexCore.deleteKey(idx_byNumberStore, cmpStore_byNumber, (delta_byNumber.prev, slot));
        IndexCore.insertWithRetention(idx_byNumberStore, cmpStore_byNumber, keep_byNumber, (delta_byNumber.next, slot));
      };

      let prevOpt_byRunning = key_byRunning(prev);
      let nextOpt_byRunning = key_byRunning(next);
      var changed_byRunning : Bool = false;
      switch (prevOpt_byRunning, nextOpt_byRunning) {
        case (null, null) {};
        case (?prevKey, ?nextKey) {
          if (cmpK_byRunning(prevKey, nextKey) != #equal) {
            IndexCore.deleteKey(idx_byRunningStore, cmpStore_byRunning, (prevKey, slot));
            IndexCore.insertWithRetention(idx_byRunningStore, cmpStore_byRunning, keep_byRunning, (nextKey, slot));
            changed_byRunning := true;
          };
        };
        case (?prevKey, null) {
          IndexCore.deleteKey(idx_byRunningStore, cmpStore_byRunning, (prevKey, slot));
          changed_byRunning := true;
        };
        case (null, ?nextKey) {
          IndexCore.insertWithRetention(idx_byRunningStore, cmpStore_byRunning, keep_byRunning, (nextKey, slot));
          changed_byRunning := true;
        };
      };
    };

    func ensure_unique_byNumber(d : Types.Season, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      let uniqueKey_byNumber = d.number;
      switch (IndexRuntime.indexKeyConflict(idx_byNumberStore, cmpStore_byNumber, cmpK_byNumber, rowAccess, projectPk, uniqueKey_byNumber, skipPk)) {
        case (?owner) { return #err(#AlreadyExists(owner)) };
        case null {};
      };
      #ok();
    };

    func ensure_unique_constraints(d : Types.Season, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      switch (ensure_unique_byNumber(d, skipPk)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      #ok();
    };

    func validateCreateConstraints(data : Types.CreateSeason) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func validateDocConstraints(doc : Types.Season) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func makeDoc(id : Nat64, data : Types.CreateSeason) : Types.Season {
      {
        id = id;
        number = data.number;
        week = data.week;
        phase = data.phase;
        payout = data.payout;
        startedAt = data.startedAt;
        weekEndsAt = data.weekEndsAt;
        endedAt = data.endedAt;
        fundingReady = data.fundingReady;
        fundingAttempts = data.fundingAttempts;
        fundingFailures = data.fundingFailures;
      };
    };

    func insertOne(data : Types.CreateSeason) : Result.Result<Nat64, Errors.Error> {
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

    func getOne(pk : Nat64) : ?Types.Season {
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

    func updateOne(doc : Types.Season) : Result.Result<Types.Season, Errors.Error> {
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
                if (uniqueChange.fields.byNumber.changed) {
                  switch (ensure_unique_byNumber(doc, ?pk)) {
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

    func upsertOne(doc : Types.Season) : Result.Result<{ #inserted; #updated }, Errors.Error> {
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
                if (uniqueChange.fields.byNumber.changed) {
                  switch (ensure_unique_byNumber(doc, ?pk)) {
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

    func insertManyImpl(records : [Types.CreateSeason]) : Result.Result<[Nat64], Errors.Error> {
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

    func upsertManyImpl(records : [Types.Season]) : Result.Result<{ inserted : Nat; updated : Nat }, Errors.Error> {
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

    func getManyImpl(pks : [Nat64]) : [(Nat64, ?Types.Season)] {
      Array.tabulate<(Nat64, ?Types.Season)>(
        Array.size(pks),
        func(i : Nat) : (Nat64, ?Types.Season) {
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

    let deleteDoc = func(slot : Nat64, d : Types.Season) : Result.Result<(), Errors.Error> {
      index_del_all(slot, d);
      removePkEntry(d.id, slot);
      freeSlot(slot);
      if (store.rowCount > 0) { store.rowCount -= 1 };
      #ok();
    };

    func encodeNatCursor(dir : IndexCore.Direction, entry : (Nat, Nat64)) : Cursors.Token {
      let (k, pk) = entry;
      Cursors.encodeNat(dir, k, pk);
    };

    func encodeNat64Cursor(dir : IndexCore.Direction, entry : (Nat64, Nat64)) : Cursors.Token {
      let (k, pk) = entry;
      Cursors.encodeNat64(dir, k, pk);
    };

    let byNumberFind = func(dir : IndexCore.Direction, start : Nat, limit : Nat) : Iter.Iter<Types.Season> {
      IndexRuntime.makeFindIter<Nat, Types.Season>(rowAccess, idx_byNumberStore, cmpStore_byNumber, cmpK_byNumber, dir, start, limit);
    };

    let byRunningFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Season> {
      IndexRuntime.makeFindIter<Nat64, Types.Season>(rowAccess, idx_byRunningStore, cmpStore_byRunning, cmpK_byRunning, dir, start, limit);
    };

    let byNumberOps = IndexRuntime.makeIndexOps<Nat, Types.Season, Errors.Error>(
      "byNumber",
      idx_byNumberStore,
      cmpK_byNumber,
      cmpStore_byNumber,
      keep_byNumber,
      rowAccess,
      projectPk,
      Cursors.decodeNat,
      encodeNatCursor,
      byNumberFind,
      deleteDoc,
    );

    let byRunningOps = IndexRuntime.makeIndexOps<Nat64, Types.Season, Errors.Error>(
      "byRunning",
      idx_byRunningStore,
      cmpK_byRunning,
      cmpStore_byRunning,
      keep_byRunning,
      rowAccess,
      projectPk,
      Cursors.decodeNat64,
      encodeNat64Cursor,
      byRunningFind,
      deleteDoc,
    );

    let iterPrimary = AshrootPrimaryIter.make(rowAccess, pk_indexStore, cmpPKStore);
    let iter = AshrootListIter.make(rowsStore);
    let mapIter = func<R>(dir : IndexCore.Direction, f : Types.Season -> R) : Iter.Iter<R> {
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
    let foldIter = func<A>(dir : IndexCore.Direction, init : A, f : (A, Types.Season) -> A) : A {
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
      byNumber = byNumberOps;
      byRunning = byRunningOps;
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
