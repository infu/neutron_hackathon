// Quorum backing, kept apart from the action log.
//
// A slot represents one moderator's vote for one subject and decision kind.
// Its uniqueness is the double-vote guard.
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
    public module Approval {
      public module Kind {
        public type Type = {
          #judge;
          #sponsor;
          #takedown;
        };
      };
      public type Kind = Kind.Type;
      public type Type = {
        id : Nat64;
        subject_id : Nat64;
        kind : Kind;
        moderator_id : Nat64;
        at : Nat64;
      };
      public module Mutation {
        public type Type = {
          var id : ?Nat64;
          var subject_id : ?Nat64;
          var kind : ?Kind;
          var moderator_id : ?Nat64;
          var at : ?Nat64;
        };
        public func new() : Type {
          {
            var id = null;
            var subject_id = null;
            var kind = null;
            var moderator_id = null;
            var at = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type Approval = Approval.Type;

    public module CreateApproval {
      public module Kind {
        public type Type = {
          #judge;
          #sponsor;
          #takedown;
        };
      };
      public type Kind = Kind.Type;
      public type Type = {
        subject_id : Nat64;
        kind : Kind;
        moderator_id : Nat64;
        at : Nat64;
      };
      public module Mutation {
        public type Type = {
          var subject_id : ?Nat64;
          var kind : ?Kind;
          var moderator_id : ?Nat64;
          var at : ?Nat64;
        };
        public func new() : Type {
          {
            var subject_id = null;
            var kind = null;
            var moderator_id = null;
            var at = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type CreateApproval = CreateApproval.Type;
  };

  public module Errors {
    public type Error = AshrootErrors.Error;
  };

  public type RelationDeletePolicy = AshrootRelations.DeletePolicy;

  public type ForeignKeyManager = AshrootRelations.ForeignKeyManager<Types.Approval, Types.CreateApproval, Errors.Error>;

  public type ForeignKeyRuntime = AshrootRelations.ForeignKeyRuntime<Types.Approval, Types.CreateApproval, Errors.Error>;

  public type RelationBundle = AshrootRelations.Bundle<Types.Approval, Types.CreateApproval, Errors.Error>;

  public type RelationRuntimeBundle = AshrootRelations.RuntimeBundle<Types.Approval, Types.CreateApproval, Errors.Error>;

  public type Init = {
    var nextId : Nat64;
    rows : List.List<?Types.Approval>;
    var deletedSlots : PureList.List<Nat64>;
    var rowCount : Nat;
    pk_index : Set.Set<(Nat64, Nat64)>;
    idx_bySlot : Set.Set<((Nat64, Nat, Nat64), Nat64)>;
    idx_bySubject : Set.Set<((Nat64, Nat), Nat64)>;
  };

  public func init() : Init {
    {
      var nextId = Nat64.fromNat(1);
      rows = List.empty<?Types.Approval>();
      var deletedSlots = null;
      var rowCount = 0;
      pk_index = Set.empty<(Nat64, Nat64)>();
      idx_bySlot = Set.empty<((Nat64, Nat, Nat64), Nat64)>();
      idx_bySubject = Set.empty<((Nat64, Nat), Nat64)>();
    };
  };

  public type IndexRange<K> = IndexRuntime.IndexRange<K>;

  public type RangeDeleteResult = IndexRuntime.RangeDeleteResult;

  public type IndexDescriptor<K> = IndexRuntime.IndexDescriptor<K>;

  public type IndexOps<K> = IndexRuntime.IndexOps<K, Types.Approval, Errors.Error>;

  public type Use = AshrootTableOps.Common<Types.Approval, Types.CreateApproval, Errors.Error, Nat64> and {
    iterPrimary : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Types.Approval)>;
    iter : (IndexCore.Direction) -> Iter.Iter<Types.Approval>;
    bySlot : IndexOps<(Nat64, Nat, Nat64)>;
    bySubject : IndexOps<(Nat64, Nat)>;
  };

  public type UseBundle = AshrootUseBundle.Bundle<Use, Types.Approval, Types.CreateApproval, Errors.Error>;

  public func use(store : Init) : UseBundle {
    let cmpPK = Nat64.compare;

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

    let cmpK_bySubject = func(lhs : (Nat64, Nat), rhs : (Nat64, Nat)) : {
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
      #equal;
    };
    let cmpStore_bySubject = IndexCore.cmpStoreKey<(Nat64, Nat)>(cmpK_bySubject);

    let keep_bySlot : IndexCore.Keep = #all;
    let keep_bySubject : IndexCore.Keep = #all;

    let rowsStore = store.rows;
    let pk_indexStore = store.pk_index;
    let idx_bySlotStore = store.idx_bySlot;
    let idx_bySubjectStore = store.idx_bySubject;
    let cmpPKStore = IndexCore.cmpStoreKey<Nat64>(Nat64.compare);

    func slotToNat(slot : Nat64) : Nat { Nat64.toNat(slot) };

    func rowsGet(slot : Nat64) : ?Types.Approval {
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

    func rowsPut(slot : Nat64, doc : Types.Approval) : () {
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

    func allocSlot(doc : Types.Approval) : Nat64 {
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

    func projectPk(doc : Types.Approval) : Nat64 { doc.id };

    let rowAccess : IndexRuntime.RowStore<Types.Approval> = {
      get = rowsGet;
      has = rowsHas;
    };

    let nextIdManager = AshrootUseRuntime.manageNextId(store);

    type UniqueFields = {
      bySlot : AshrootUniqueRuntime.FieldChange<(Nat64, Nat, Nat64)>;
    };
    type UniqueChange = AshrootUniqueRuntime.UniqueChange<UniqueFields>;

    func compute_unique_change(prev : Types.Approval, next : Types.Approval) : UniqueChange {
      AshrootUniqueRuntime.compute(
        prev,
        next,
        func(prevDoc : Types.Approval, nextDoc : Types.Approval) : UniqueFields {
          {
            bySlot = do {
              let prevKey = (func(prevDoc : Types.Approval) : (Nat64, Nat, Nat64) { (prevDoc.subject_id, switch (prevDoc.kind) { case (#judge) 0; case (#sponsor) 1; case (#takedown) 2 }, prevDoc.moderator_id) })(prevDoc);
              let nextKey = (func(nextDoc : Types.Approval) : (Nat64, Nat, Nat64) { (nextDoc.subject_id, switch (nextDoc.kind) { case (#judge) 0; case (#sponsor) 1; case (#takedown) 2 }, nextDoc.moderator_id) })(nextDoc);
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

    func index_add_all(slot : Nat64, d : Types.Approval) : () {
      let key_bySlot = (func(d : Types.Approval) : (Nat64, Nat, Nat64) { (d.subject_id, switch (d.kind) { case (#judge) 0; case (#sponsor) 1; case (#takedown) 2 }, d.moderator_id) })(d);
      IndexCore.insertWithRetention(idx_bySlotStore, cmpStore_bySlot, keep_bySlot, (key_bySlot, slot));
      let key_bySubject = (func(d : Types.Approval) : (Nat64, Nat) { (d.subject_id, switch (d.kind) { case (#judge) 0; case (#sponsor) 1; case (#takedown) 2 }) })(d);
      IndexCore.insertWithRetention(idx_bySubjectStore, cmpStore_bySubject, keep_bySubject, (key_bySubject, slot));
    };

    func index_del_all(slot : Nat64, d : Types.Approval) : () {
      let key_bySlot = (func(d : Types.Approval) : (Nat64, Nat, Nat64) { (d.subject_id, switch (d.kind) { case (#judge) 0; case (#sponsor) 1; case (#takedown) 2 }, d.moderator_id) })(d);
      IndexCore.deleteKey(idx_bySlotStore, cmpStore_bySlot, (key_bySlot, slot));
      let key_bySubject = (func(d : Types.Approval) : (Nat64, Nat) { (d.subject_id, switch (d.kind) { case (#judge) 0; case (#sponsor) 1; case (#takedown) 2 }) })(d);
      IndexCore.deleteKey(idx_bySubjectStore, cmpStore_bySubject, (key_bySubject, slot));
    };

    func index_refresh_on_update(slot : Nat64, prev : Types.Approval, next : Types.Approval, change : UniqueChange) : () {
      let delta_bySlot = change.fields.bySlot;
      if (delta_bySlot.changed) {
        IndexCore.deleteKey(idx_bySlotStore, cmpStore_bySlot, (delta_bySlot.prev, slot));
        IndexCore.insertWithRetention(idx_bySlotStore, cmpStore_bySlot, keep_bySlot, (delta_bySlot.next, slot));
      };

      let prevKey_bySubject = (func(prev : Types.Approval) : (Nat64, Nat) { (prev.subject_id, switch (prev.kind) { case (#judge) 0; case (#sponsor) 1; case (#takedown) 2 }) })(prev);
      let nextKey_bySubject = (func(next : Types.Approval) : (Nat64, Nat) { (next.subject_id, switch (next.kind) { case (#judge) 0; case (#sponsor) 1; case (#takedown) 2 }) })(next);
      var changed_bySubject : Bool = false;
      if (cmpK_bySubject(prevKey_bySubject, nextKey_bySubject) != #equal) {
        IndexCore.deleteKey(idx_bySubjectStore, cmpStore_bySubject, (prevKey_bySubject, slot));
        IndexCore.insertWithRetention(idx_bySubjectStore, cmpStore_bySubject, keep_bySubject, (nextKey_bySubject, slot));
        changed_bySubject := true;
      };
    };

    func ensure_unique_bySlot(d : Types.Approval, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      let uniqueKey_bySlot = (func(d : Types.Approval) : (Nat64, Nat, Nat64) { (d.subject_id, switch (d.kind) { case (#judge) 0; case (#sponsor) 1; case (#takedown) 2 }, d.moderator_id) })(d);
      switch (IndexRuntime.indexKeyConflict(idx_bySlotStore, cmpStore_bySlot, cmpK_bySlot, rowAccess, projectPk, uniqueKey_bySlot, skipPk)) {
        case (?owner) { return #err(#AlreadyExists(owner)) };
        case null {};
      };
      #ok();
    };

    func ensure_unique_constraints(d : Types.Approval, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      switch (ensure_unique_bySlot(d, skipPk)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      #ok();
    };

    func validateCreateConstraints(data : Types.CreateApproval) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func validateDocConstraints(doc : Types.Approval) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func makeDoc(id : Nat64, data : Types.CreateApproval) : Types.Approval {
      {
        id = id;
        subject_id = data.subject_id;
        kind = data.kind;
        moderator_id = data.moderator_id;
        at = data.at;
      };
    };

    func insertOne(data : Types.CreateApproval) : Result.Result<Nat64, Errors.Error> {
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

    func getOne(pk : Nat64) : ?Types.Approval {
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

    func updateOne(doc : Types.Approval) : Result.Result<Types.Approval, Errors.Error> {
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

    func upsertOne(doc : Types.Approval) : Result.Result<{ #inserted; #updated }, Errors.Error> {
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

    func insertManyImpl(records : [Types.CreateApproval]) : Result.Result<[Nat64], Errors.Error> {
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

    func upsertManyImpl(records : [Types.Approval]) : Result.Result<{ inserted : Nat; updated : Nat }, Errors.Error> {
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

    func getManyImpl(pks : [Nat64]) : [(Nat64, ?Types.Approval)] {
      Array.tabulate<(Nat64, ?Types.Approval)>(
        Array.size(pks),
        func(i : Nat) : (Nat64, ?Types.Approval) {
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

    let deleteDoc = func(slot : Nat64, d : Types.Approval) : Result.Result<(), Errors.Error> {
      index_del_all(slot, d);
      removePkEntry(d.id, slot);
      freeSlot(slot);
      if (store.rowCount > 0) { store.rowCount -= 1 };
      #ok();
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

    func encodeBySubjectCursor(dir : IndexCore.Direction, entry : ((Nat64, Nat), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1) = storeKey;
      Cursors.encodeComposite(dir, "Nat64_Nat", [Cursors.encodeSegmentNat64(k0), Cursors.encodeSegmentNat(k1)], pk);
    };

    func decodeBySubjectCursor(token : Cursors.Token) : ?((Nat64, Nat), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat64_Nat", 2)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat64(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentNat(segments[1]) else return null;
          let key = (k0, k1);
          ?(key, pk);
        };
        case null null;
      };
    };

    let bySlotFind = func(dir : IndexCore.Direction, start : (Nat64, Nat, Nat64), limit : Nat) : Iter.Iter<Types.Approval> {
      IndexRuntime.makeFindIter<(Nat64, Nat, Nat64), Types.Approval>(rowAccess, idx_bySlotStore, cmpStore_bySlot, cmpK_bySlot, dir, start, limit);
    };

    let bySubjectFind = func(dir : IndexCore.Direction, start : (Nat64, Nat), limit : Nat) : Iter.Iter<Types.Approval> {
      IndexRuntime.makeFindIter<(Nat64, Nat), Types.Approval>(rowAccess, idx_bySubjectStore, cmpStore_bySubject, cmpK_bySubject, dir, start, limit);
    };

    let bySlotOps = IndexRuntime.makeIndexOps<(Nat64, Nat, Nat64), Types.Approval, Errors.Error>(
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

    let bySubjectOps = IndexRuntime.makeIndexOps<(Nat64, Nat), Types.Approval, Errors.Error>(
      "bySubject",
      idx_bySubjectStore,
      cmpK_bySubject,
      cmpStore_bySubject,
      keep_bySubject,
      rowAccess,
      projectPk,
      decodeBySubjectCursor,
      encodeBySubjectCursor,
      bySubjectFind,
      deleteDoc,
    );

    let iterPrimary = AshrootPrimaryIter.make(rowAccess, pk_indexStore, cmpPKStore);
    let iter = AshrootListIter.make(rowsStore);
    let mapIter = func<R>(dir : IndexCore.Direction, f : Types.Approval -> R) : Iter.Iter<R> {
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
    let foldIter = func<A>(dir : IndexCore.Direction, init : A, f : (A, Types.Approval) -> A) : A {
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
      bySubject = bySubjectOps;
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
