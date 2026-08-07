/*
 * Durable moderation events.
 * Append-oriented rows are indexed by both the affected account and the
 * actor principal that made the decision.
 */
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
    public module Action {
      public module Kind {
        public type Type = {
          #judge_approved;
          #judge_rejected;
          #judge_reset;
          #judge_revoked;
          #moderator_granted;
          #moderator_revoked;
          #sponsor_approved;
          #sponsor_rejected;
          #sponsor_reset;
          #sponsor_revoked;
        };
      };
      public type Kind = Kind.Type;
      public type Note = Text;
      public type Type = {
        id : Nat64;
        subject_id : Nat64;
        actorPrincipal : Principal;
        kind : Kind;
        note : ?Note;
        at : Nat64;
      };
      public module Mutation {
        public type Type = {
          var id : ?Nat64;
          var subject_id : ?Nat64;
          var actorPrincipal : ?Principal;
          var kind : ?Kind;
          var note : ??Note;
          var at : ?Nat64;
        };
        public func new() : Type {
          {
            var id = null;
            var subject_id = null;
            var actorPrincipal = null;
            var kind = null;
            var note = null;
            var at = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type Action = Action.Type;

    public module CreateAction {
      public module Kind {
        public type Type = {
          #judge_approved;
          #judge_rejected;
          #judge_reset;
          #judge_revoked;
          #moderator_granted;
          #moderator_revoked;
          #sponsor_approved;
          #sponsor_rejected;
          #sponsor_reset;
          #sponsor_revoked;
        };
      };
      public type Kind = Kind.Type;
      public type Note = Text;
      public type Type = {
        subject_id : Nat64;
        actorPrincipal : Principal;
        kind : Kind;
        note : ?Note;
        at : Nat64;
      };
      public module Mutation {
        public type Type = {
          var subject_id : ?Nat64;
          var actorPrincipal : ?Principal;
          var kind : ?Kind;
          var note : ??Note;
          var at : ?Nat64;
        };
        public func new() : Type {
          {
            var subject_id = null;
            var actorPrincipal = null;
            var kind = null;
            var note = null;
            var at = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type CreateAction = CreateAction.Type;
  };

  public module Errors {
    public type Error = AshrootErrors.Error;
  };

  public type RelationDeletePolicy = AshrootRelations.DeletePolicy;

  public type ForeignKeyManager = AshrootRelations.ForeignKeyManager<Types.Action, Types.CreateAction, Errors.Error>;

  public type ForeignKeyRuntime = AshrootRelations.ForeignKeyRuntime<Types.Action, Types.CreateAction, Errors.Error>;

  public type RelationBundle = AshrootRelations.Bundle<Types.Action, Types.CreateAction, Errors.Error>;

  public type RelationRuntimeBundle = AshrootRelations.RuntimeBundle<Types.Action, Types.CreateAction, Errors.Error>;

  public type Init = {
    var nextId : Nat64;
    rows : List.List<?Types.Action>;
    var deletedSlots : PureList.List<Nat64>;
    var rowCount : Nat;
    pk_index : Set.Set<(Nat64, Nat64)>;
    idx_bySubject : Set.Set<(Nat64, Nat64)>;
    idx_byActor : Set.Set<(Principal, Nat64)>;
    idx_byTime : Set.Set<(Nat64, Nat64)>;
  };

  public func init() : Init {
    {
      var nextId = Nat64.fromNat(1);
      rows = List.empty<?Types.Action>();
      var deletedSlots = null;
      var rowCount = 0;
      pk_index = Set.empty<(Nat64, Nat64)>();
      idx_bySubject = Set.empty<(Nat64, Nat64)>();
      idx_byActor = Set.empty<(Principal, Nat64)>();
      idx_byTime = Set.empty<(Nat64, Nat64)>();
    };
  };

  public type IndexRange<K> = IndexRuntime.IndexRange<K>;

  public type RangeDeleteResult = IndexRuntime.RangeDeleteResult;

  public type IndexDescriptor<K> = IndexRuntime.IndexDescriptor<K>;

  public type IndexOps<K> = IndexRuntime.IndexOps<K, Types.Action, Errors.Error>;

  public type Use = AshrootTableOps.Common<Types.Action, Types.CreateAction, Errors.Error, Nat64> and {
    iterPrimary : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Types.Action)>;
    iter : (IndexCore.Direction) -> Iter.Iter<Types.Action>;
    bySubject : IndexOps<Nat64>;
    byActor : IndexOps<Principal>;
    byTime : IndexOps<Nat64>;
  };

  public type UseBundle = AshrootUseBundle.Bundle<Use, Types.Action, Types.CreateAction, Errors.Error>;

  public func use(store : Init) : UseBundle {
    let cmpPK = Nat64.compare;

    let cmpK_bySubject = Nat64.compare;
    let cmpStore_bySubject = IndexCore.cmpStoreKey<Nat64>(cmpK_bySubject);

    let cmpK_byActor = Principal.compare;
    let cmpStore_byActor = IndexCore.cmpStoreKey<Principal>(cmpK_byActor);

    let cmpK_byTime = Nat64.compare;
    let cmpStore_byTime = IndexCore.cmpStoreKey<Nat64>(cmpK_byTime);

    let keep_bySubject : IndexCore.Keep = #all;
    let keep_byActor : IndexCore.Keep = #all;
    let keep_byTime : IndexCore.Keep = #all;

    let rowsStore = store.rows;
    let pk_indexStore = store.pk_index;
    let idx_bySubjectStore = store.idx_bySubject;
    let idx_byActorStore = store.idx_byActor;
    let idx_byTimeStore = store.idx_byTime;
    let cmpPKStore = IndexCore.cmpStoreKey<Nat64>(Nat64.compare);

    func slotToNat(slot : Nat64) : Nat { Nat64.toNat(slot) };

    func rowsGet(slot : Nat64) : ?Types.Action {
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

    func rowsPut(slot : Nat64, doc : Types.Action) : () {
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

    func allocSlot(doc : Types.Action) : Nat64 {
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

    func projectPk(doc : Types.Action) : Nat64 { doc.id };

    let rowAccess : IndexRuntime.RowStore<Types.Action> = {
      get = rowsGet;
      has = rowsHas;
    };

    let nextIdManager = AshrootUseRuntime.manageNextId(store);

    func index_add_all(slot : Nat64, d : Types.Action) : () {
      let key_bySubject = d.subject_id;
      IndexCore.insertWithRetention(idx_bySubjectStore, cmpStore_bySubject, keep_bySubject, (key_bySubject, slot));
      let key_byActor = d.actorPrincipal;
      IndexCore.insertWithRetention(idx_byActorStore, cmpStore_byActor, keep_byActor, (key_byActor, slot));
      let key_byTime = d.at;
      IndexCore.insertWithRetention(idx_byTimeStore, cmpStore_byTime, keep_byTime, (key_byTime, slot));
    };

    func index_del_all(slot : Nat64, d : Types.Action) : () {
      let key_bySubject = d.subject_id;
      IndexCore.deleteKey(idx_bySubjectStore, cmpStore_bySubject, (key_bySubject, slot));
      let key_byActor = d.actorPrincipal;
      IndexCore.deleteKey(idx_byActorStore, cmpStore_byActor, (key_byActor, slot));
      let key_byTime = d.at;
      IndexCore.deleteKey(idx_byTimeStore, cmpStore_byTime, (key_byTime, slot));
    };

    func index_refresh_on_update(slot : Nat64, prev : Types.Action, next : Types.Action) : () {
      let prevKey_bySubject = prev.subject_id;
      let nextKey_bySubject = next.subject_id;
      var changed_bySubject : Bool = false;
      if (cmpK_bySubject(prevKey_bySubject, nextKey_bySubject) != #equal) {
        IndexCore.deleteKey(idx_bySubjectStore, cmpStore_bySubject, (prevKey_bySubject, slot));
        IndexCore.insertWithRetention(idx_bySubjectStore, cmpStore_bySubject, keep_bySubject, (nextKey_bySubject, slot));
        changed_bySubject := true;
      };

      let prevKey_byActor = prev.actorPrincipal;
      let nextKey_byActor = next.actorPrincipal;
      var changed_byActor : Bool = false;
      if (cmpK_byActor(prevKey_byActor, nextKey_byActor) != #equal) {
        IndexCore.deleteKey(idx_byActorStore, cmpStore_byActor, (prevKey_byActor, slot));
        IndexCore.insertWithRetention(idx_byActorStore, cmpStore_byActor, keep_byActor, (nextKey_byActor, slot));
        changed_byActor := true;
      };

      let prevKey_byTime = prev.at;
      let nextKey_byTime = next.at;
      var changed_byTime : Bool = false;
      if (cmpK_byTime(prevKey_byTime, nextKey_byTime) != #equal) {
        IndexCore.deleteKey(idx_byTimeStore, cmpStore_byTime, (prevKey_byTime, slot));
        IndexCore.insertWithRetention(idx_byTimeStore, cmpStore_byTime, keep_byTime, (nextKey_byTime, slot));
        changed_byTime := true;
      };
    };

    func validateCreateConstraints(data : Types.CreateAction) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func validateDocConstraints(doc : Types.Action) : Result.Result<(), Errors.Error> {
      #ok();
    };

    func makeDoc(id : Nat64, data : Types.CreateAction) : Types.Action {
      {
        id = id;
        subject_id = data.subject_id;
        actorPrincipal = data.actorPrincipal;
        kind = data.kind;
        note = data.note;
        at = data.at;
      };
    };

    func insertOne(data : Types.CreateAction) : Result.Result<Nat64, Errors.Error> {
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

    func getOne(pk : Nat64) : ?Types.Action {
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

    func updateOne(doc : Types.Action) : Result.Result<Types.Action, Errors.Error> {
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

    func upsertOne(doc : Types.Action) : Result.Result<{ #inserted; #updated }, Errors.Error> {
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

    func insertManyImpl(records : [Types.CreateAction]) : Result.Result<[Nat64], Errors.Error> {
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

    func upsertManyImpl(records : [Types.Action]) : Result.Result<{ inserted : Nat; updated : Nat }, Errors.Error> {
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

    func getManyImpl(pks : [Nat64]) : [(Nat64, ?Types.Action)] {
      Array.tabulate<(Nat64, ?Types.Action)>(
        Array.size(pks),
        func(i : Nat) : (Nat64, ?Types.Action) {
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

    let deleteDoc = func(slot : Nat64, d : Types.Action) : Result.Result<(), Errors.Error> {
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

    let bySubjectFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Action> {
      IndexRuntime.makeFindIter<Nat64, Types.Action>(rowAccess, idx_bySubjectStore, cmpStore_bySubject, cmpK_bySubject, dir, start, limit);
    };

    let byActorFind = func(dir : IndexCore.Direction, start : Principal, limit : Nat) : Iter.Iter<Types.Action> {
      IndexRuntime.makeFindIter<Principal, Types.Action>(rowAccess, idx_byActorStore, cmpStore_byActor, cmpK_byActor, dir, start, limit);
    };

    let byTimeFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.Action> {
      IndexRuntime.makeFindIter<Nat64, Types.Action>(rowAccess, idx_byTimeStore, cmpStore_byTime, cmpK_byTime, dir, start, limit);
    };

    let bySubjectOps = IndexRuntime.makeIndexOps<Nat64, Types.Action, Errors.Error>(
      "bySubject",
      idx_bySubjectStore,
      cmpK_bySubject,
      cmpStore_bySubject,
      keep_bySubject,
      rowAccess,
      projectPk,
      Cursors.decodeNat64,
      encodeNat64Cursor,
      bySubjectFind,
      deleteDoc,
    );

    let byActorOps = IndexRuntime.makeIndexOps<Principal, Types.Action, Errors.Error>(
      "byActor",
      idx_byActorStore,
      cmpK_byActor,
      cmpStore_byActor,
      keep_byActor,
      rowAccess,
      projectPk,
      Cursors.decodePrincipal,
      encodePrincipalCursor,
      byActorFind,
      deleteDoc,
    );

    let byTimeOps = IndexRuntime.makeIndexOps<Nat64, Types.Action, Errors.Error>(
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

    let iterPrimary = AshrootPrimaryIter.make(rowAccess, pk_indexStore, cmpPKStore);
    let iter = AshrootListIter.make(rowsStore);
    let mapIter = func<R>(dir : IndexCore.Direction, f : Types.Action -> R) : Iter.Iter<R> {
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
    let foldIter = func<A>(dir : IndexCore.Direction, init : A, f : (A, Types.Action) -> A) : A {
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

    var rel_subject_id_parentExists : (Nat64 -> Bool) = func(_) : Bool { false };
    var rel_subject_id_installed : Bool = false;
    func rel_subject_id_range(value : Nat64) : IndexRuntime.IndexRange<Nat64> {
      {
        gt = null;
        gte = ?value;
        lt = null;
        lte = ?value;
        dir = #fwd;
      };
    };
    func rel_subject_id_checkParent(id : Nat64) : Result.Result<(), Errors.Error> {
      if (not rel_subject_id_installed) {
        return #err(#Internal("foreign key actions.subject_id parent lookup not installed"));
      };
      if (rel_subject_id_parentExists(id)) {
        #ok();
      } else {
        return #err(#Internal("referential integrity violation: users.id " # Nat64.toText(id) # " not found for actions.subject_id"));
      };
    };
    func rel_subject_id_validateCreate(data : Types.CreateAction) : Result.Result<(), Errors.Error> {
      return rel_subject_id_checkParent(data.subject_id);
    };
    func rel_subject_id_validateDoc(doc : Types.Action) : Result.Result<(), Errors.Error> {
      return rel_subject_id_checkParent(doc.subject_id);
    };
    func rel_subject_id_countDependents(parentId : Nat64) : Nat {
      let iter = Set.valuesFrom(idx_bySubjectStore, cmpStore_bySubject, (parentId, Nat64.fromNat(0)));
      var total : Nat = 0;
      label scan while (true) {
        switch (iter.next()) {
          case null { return total };
          case (?entry) {
            let (key, slot) = entry;
            switch (cmpK_bySubject(key, parentId)) {
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
    func rel_subject_id_deleteDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      let range = rel_subject_id_range(parentId);
      var cursor : ?Cursors.Token = null;
      var hasMore = true;
      let chunk : Nat = 1024;
      while (hasMore) {
        switch (bySubjectOps.rangeDelete(range, chunk, cursor)) {
          case (#ok(outcome)) {
            cursor := outcome.cursor;
            hasMore := outcome.hasMore;
          };
          case (#err(e)) { return #err(e) };
        };
      };
      #ok();
    };
    func rel_subject_id_setNullDependents(parentId : Nat64) : Result.Result<(), Errors.Error> {
      #err(#Internal("setNull not supported for actions.subject_id"));
    };
    func rel_subject_id_installParent(checker : Nat64 -> Bool) : () {
      rel_subject_id_parentExists := checker;
      rel_subject_id_installed := true;
    };
    let subject_idManager_runtime : ForeignKeyRuntime = {
      field = "subject_id";
      parentTable = "users";
      notNull = true;
      onDelete = #restrict;
      installParentExists = rel_subject_id_installParent;
      validateCreate = rel_subject_id_validateCreate;
      validateDoc = rel_subject_id_validateDoc;
      countDependents = rel_subject_id_countDependents;
      deleteDependents = rel_subject_id_deleteDependents;
      setNullDependents = rel_subject_id_setNullDependents;
      formatError = formatError;
    };

    let subject_idManager : ForeignKeyManager = subject_idManager_runtime;

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
      bySubject = bySubjectOps;
      byActor = byActorOps;
      byTime = byTimeOps;
    };

    let relations : RelationBundle = {
      foreignKeys = [subject_idManager];
    };
    let relationsInternal : RelationRuntimeBundle = {
      foreignKeys = [subject_idManager_runtime];
    };

    { table; relations; relationsInternal };

  };
};
