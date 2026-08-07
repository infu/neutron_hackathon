// Participant state
// ================
// Profiles, roles, reward wallets, delegation, and resource accounting share
// one identity row. Sparse indexes keep role lists proportional to membership.
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
import TextRange "mo:ashroot/text_range";
import AshrootTextIndexOps "mo:ashroot/text_index_ops";

module {
  public module Types {
    public module User {
      public type Title = Text;
      public type Avatar = Text;
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
      public module JudgeStatus {
        public type Type = {
          #no;
          #pending;
          #approved;
        };
      };
      public type JudgeStatus = JudgeStatus.Type;
      public module SponsorStatus {
        public type Type = {
          #no;
          #pending;
          #approved;
        };
      };
      public type SponsorStatus = SponsorStatus.Type;
      public module Sponsor {
        public type Logo = Text;
        public module Ledgers {
          public module Element {
            public type Type = {
              id : Principal;
              sns : Bool;
            };
            public module Mutation {
              public type Type = {
                var id : ?Principal;
                var sns : ?Bool;
              };
              public func new() : Type {
                {
                  var id = null;
                  var sns = null;
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
        public type Ledgers = Ledgers.Type;
        public module Given {
          public module Element {
            public type Type = {
              ledger : Principal;
              amount : Nat;
              at : Nat64;
            };
            public module Mutation {
              public type Type = {
                var ledger : ?Principal;
                var amount : ?Nat;
                var at : ?Nat64;
              };
              public func new() : Type {
                {
                  var ledger = null;
                  var amount = null;
                  var at = null;
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
        public type Given = Given.Type;
        public type Type = {
          org : Text;
          website : Text;
          logo : ?Logo;
          blurb : Text;
          ledgers : Ledgers;
          given : Given;
        };
        public module Mutation {
          public type Type = {
            var org : ?Text;
            var website : ?Text;
            var logo : ??Logo;
            var blurb : ?Text;
            var ledgers : ?Ledgers;
            var given : ?Given;
          };
          public func new() : Type {
            {
              var org = null;
              var website = null;
              var logo = null;
              var blurb = null;
              var ledgers = null;
              var given = null;
            };
          };
        };
        public type Mutation = Mutation.Type;
        public func mut() : Mutation {
          Mutation.new();
        };
      };
      public type Sponsor = Sponsor.Type;
      public type Wallet = Principal;
      public type Agent = Principal;
      public type Type = {
        id : Nat64;
        principal : Principal;
        handle : Text;
        displayName : Text;
        title : ?Title;
        bio : Text;
        avatar : ?Avatar;
        links : Links;
        judgeStatus : JudgeStatus;
        moderator : Bool;
        createdAt : Nat64;
        updatedAt : Nat64;
        sponsorStatus : SponsorStatus;
        sponsor : ?Sponsor;
        hacker : Bool;
        instructions : Nat;
        bytes : Nat;
        frozen : Bool;
        wallet : ?Wallet;
        agent : ?Agent;
        rewardOptOut : Bool;
        termsAt : Nat64;
        termsVersion : Nat;
        anonymized : Bool;
      };
      public module Mutation {
        public type Type = {
          var id : ?Nat64;
          var principal : ?Principal;
          var handle : ?Text;
          var displayName : ?Text;
          var title : ??Title;
          var bio : ?Text;
          var avatar : ??Avatar;
          var links : ?Links;
          var judgeStatus : ?JudgeStatus;
          var moderator : ?Bool;
          var createdAt : ?Nat64;
          var updatedAt : ?Nat64;
          var sponsorStatus : ?SponsorStatus;
          var sponsor : ??Sponsor;
          var hacker : ?Bool;
          var instructions : ?Nat;
          var bytes : ?Nat;
          var frozen : ?Bool;
          var wallet : ??Wallet;
          var agent : ??Agent;
          var rewardOptOut : ?Bool;
          var termsAt : ?Nat64;
          var termsVersion : ?Nat;
          var anonymized : ?Bool;
        };
        public func new() : Type {
          {
            var id = null;
            var principal = null;
            var handle = null;
            var displayName = null;
            var title = null;
            var bio = null;
            var avatar = null;
            var links = null;
            var judgeStatus = null;
            var moderator = null;
            var createdAt = null;
            var updatedAt = null;
            var sponsorStatus = null;
            var sponsor = null;
            var hacker = null;
            var instructions = null;
            var bytes = null;
            var frozen = null;
            var wallet = null;
            var agent = null;
            var rewardOptOut = null;
            var termsAt = null;
            var termsVersion = null;
            var anonymized = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type User = User.Type;

    public module CreateUser {
      public type Title = Text;
      public type Avatar = Text;
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
      public module JudgeStatus {
        public type Type = {
          #no;
          #pending;
          #approved;
        };
      };
      public type JudgeStatus = JudgeStatus.Type;
      public module SponsorStatus {
        public type Type = {
          #no;
          #pending;
          #approved;
        };
      };
      public type SponsorStatus = SponsorStatus.Type;
      public module Sponsor {
        public type Logo = Text;
        public module Ledgers {
          public module Element {
            public type Type = {
              id : Principal;
              sns : Bool;
            };
            public module Mutation {
              public type Type = {
                var id : ?Principal;
                var sns : ?Bool;
              };
              public func new() : Type {
                {
                  var id = null;
                  var sns = null;
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
        public type Ledgers = Ledgers.Type;
        public module Given {
          public module Element {
            public type Type = {
              ledger : Principal;
              amount : Nat;
              at : Nat64;
            };
            public module Mutation {
              public type Type = {
                var ledger : ?Principal;
                var amount : ?Nat;
                var at : ?Nat64;
              };
              public func new() : Type {
                {
                  var ledger = null;
                  var amount = null;
                  var at = null;
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
        public type Given = Given.Type;
        public type Type = {
          org : Text;
          website : Text;
          logo : ?Logo;
          blurb : Text;
          ledgers : Ledgers;
          given : Given;
        };
        public module Mutation {
          public type Type = {
            var org : ?Text;
            var website : ?Text;
            var logo : ??Logo;
            var blurb : ?Text;
            var ledgers : ?Ledgers;
            var given : ?Given;
          };
          public func new() : Type {
            {
              var org = null;
              var website = null;
              var logo = null;
              var blurb = null;
              var ledgers = null;
              var given = null;
            };
          };
        };
        public type Mutation = Mutation.Type;
        public func mut() : Mutation {
          Mutation.new();
        };
      };
      public type Sponsor = Sponsor.Type;
      public type Wallet = Principal;
      public type Agent = Principal;
      public type Type = {
        principal : Principal;
        handle : Text;
        displayName : Text;
        title : ?Title;
        bio : Text;
        avatar : ?Avatar;
        links : Links;
        judgeStatus : JudgeStatus;
        moderator : Bool;
        createdAt : Nat64;
        updatedAt : Nat64;
        sponsorStatus : SponsorStatus;
        sponsor : ?Sponsor;
        hacker : Bool;
        instructions : Nat;
        bytes : Nat;
        frozen : Bool;
        wallet : ?Wallet;
        agent : ?Agent;
        rewardOptOut : Bool;
        termsAt : Nat64;
        termsVersion : Nat;
        anonymized : Bool;
      };
      public module Mutation {
        public type Type = {
          var principal : ?Principal;
          var handle : ?Text;
          var displayName : ?Text;
          var title : ??Title;
          var bio : ?Text;
          var avatar : ??Avatar;
          var links : ?Links;
          var judgeStatus : ?JudgeStatus;
          var moderator : ?Bool;
          var createdAt : ?Nat64;
          var updatedAt : ?Nat64;
          var sponsorStatus : ?SponsorStatus;
          var sponsor : ??Sponsor;
          var hacker : ?Bool;
          var instructions : ?Nat;
          var bytes : ?Nat;
          var frozen : ?Bool;
          var wallet : ??Wallet;
          var agent : ??Agent;
          var rewardOptOut : ?Bool;
          var termsAt : ?Nat64;
          var termsVersion : ?Nat;
          var anonymized : ?Bool;
        };
        public func new() : Type {
          {
            var principal = null;
            var handle = null;
            var displayName = null;
            var title = null;
            var bio = null;
            var avatar = null;
            var links = null;
            var judgeStatus = null;
            var moderator = null;
            var createdAt = null;
            var updatedAt = null;
            var sponsorStatus = null;
            var sponsor = null;
            var hacker = null;
            var instructions = null;
            var bytes = null;
            var frozen = null;
            var wallet = null;
            var agent = null;
            var rewardOptOut = null;
            var termsAt = null;
            var termsVersion = null;
            var anonymized = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type CreateUser = CreateUser.Type;
  };

  public module Errors {
    public type Error = AshrootErrors.Error;
  };

  public type RelationDeletePolicy = AshrootRelations.DeletePolicy;

  public type ForeignKeyManager = AshrootRelations.ForeignKeyManager<Types.User, Types.CreateUser, Errors.Error>;

  public type ForeignKeyRuntime = AshrootRelations.ForeignKeyRuntime<Types.User, Types.CreateUser, Errors.Error>;

  public type RelationBundle = AshrootRelations.Bundle<Types.User, Types.CreateUser, Errors.Error>;

  public type RelationRuntimeBundle = AshrootRelations.RuntimeBundle<Types.User, Types.CreateUser, Errors.Error>;

  public type Init = {
    var nextId : Nat64;
    rows : List.List<?Types.User>;
    var deletedSlots : PureList.List<Nat64>;
    var rowCount : Nat;
    pk_index : Set.Set<(Nat64, Nat64)>;
    idx_byPrincipal : Set.Set<(Principal, Nat64)>;
    idx_byHandle : Set.Set<(Text, Nat64)>;
    idx_byCreated : Set.Set<(Nat64, Nat64)>;
    idx_byHackerHandle : Set.Set<(Text, Nat64)>;
    idx_byObserverHandle : Set.Set<(Text, Nat64)>;
    idx_byModeratorHandle : Set.Set<(Text, Nat64)>;
    idx_byJudgeHandle : Set.Set<((Nat, Text), Nat64)>;
    idx_bySponsorHandle : Set.Set<((Nat, Text), Nat64)>;
    idx_byInstructions : Set.Set<(Nat, Nat64)>;
    idx_byBytes : Set.Set<(Nat, Nat64)>;
    idx_byAgent : Set.Set<(Principal, Nat64)>;
  };

  public func init() : Init {
    {
      var nextId = Nat64.fromNat(1);
      rows = List.empty<?Types.User>();
      var deletedSlots = null;
      var rowCount = 0;
      pk_index = Set.empty<(Nat64, Nat64)>();
      idx_byPrincipal = Set.empty<(Principal, Nat64)>();
      idx_byHandle = Set.empty<(Text, Nat64)>();
      idx_byCreated = Set.empty<(Nat64, Nat64)>();
      idx_byHackerHandle = Set.empty<(Text, Nat64)>();
      idx_byObserverHandle = Set.empty<(Text, Nat64)>();
      idx_byModeratorHandle = Set.empty<(Text, Nat64)>();
      idx_byJudgeHandle = Set.empty<((Nat, Text), Nat64)>();
      idx_bySponsorHandle = Set.empty<((Nat, Text), Nat64)>();
      idx_byInstructions = Set.empty<(Nat, Nat64)>();
      idx_byBytes = Set.empty<(Nat, Nat64)>();
      idx_byAgent = Set.empty<(Principal, Nat64)>();
    };
  };

  public type IndexRange<K> = IndexRuntime.IndexRange<K>;

  public type RangeDeleteResult = IndexRuntime.RangeDeleteResult;

  public type IndexDescriptor<K> = IndexRuntime.IndexDescriptor<K>;

  public type IndexOps<K> = IndexRuntime.IndexOps<K, Types.User, Errors.Error>;

  public type TextIndexOps = AshrootTextIndexOps.Ops<Types.User, Errors.Error>;

  public type Use = AshrootTableOps.Common<Types.User, Types.CreateUser, Errors.Error, Nat64> and {
    iterPrimary : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Types.User)>;
    iter : (IndexCore.Direction) -> Iter.Iter<Types.User>;
    byPrincipal : IndexOps<Principal>;
    byHandle : TextIndexOps;
    byCreated : IndexOps<Nat64>;
    byHackerHandle : TextIndexOps;
    byObserverHandle : TextIndexOps;
    byModeratorHandle : TextIndexOps;
    byJudgeHandle : IndexOps<(Nat, Text)>;
    bySponsorHandle : IndexOps<(Nat, Text)>;
    byInstructions : IndexOps<Nat>;
    byBytes : IndexOps<Nat>;
    byAgent : IndexOps<Principal>;
  };

  public type UseBundle = AshrootUseBundle.Bundle<Use, Types.User, Types.CreateUser, Errors.Error>;

  public func use(store : Init) : UseBundle {
    let cmpPK = Nat64.compare;

    let cmpK_byPrincipal = Principal.compare;
    let cmpStore_byPrincipal = IndexCore.cmpStoreKey<Principal>(cmpK_byPrincipal);

    let cmpK_byHandle = Text.compare;
    let cmpStore_byHandle = IndexCore.cmpStoreKey<Text>(cmpK_byHandle);

    let cmpK_byCreated = Nat64.compare;
    let cmpStore_byCreated = IndexCore.cmpStoreKey<Nat64>(cmpK_byCreated);

    let cmpK_byHackerHandle = Text.compare;
    let cmpStore_byHackerHandle = IndexCore.cmpStoreKey<Text>(cmpK_byHackerHandle);

    let cmpK_byObserverHandle = Text.compare;
    let cmpStore_byObserverHandle = IndexCore.cmpStoreKey<Text>(cmpK_byObserverHandle);

    let cmpK_byModeratorHandle = Text.compare;
    let cmpStore_byModeratorHandle = IndexCore.cmpStoreKey<Text>(cmpK_byModeratorHandle);

    let cmpK_byJudgeHandle = func(lhs : (Nat, Text), rhs : (Nat, Text)) : {
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
      let cmp1 = Text.compare(lhs.1, rhs.1);
      switch (cmp1) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      #equal;
    };
    let cmpStore_byJudgeHandle = IndexCore.cmpStoreKey<(Nat, Text)>(cmpK_byJudgeHandle);

    let cmpK_bySponsorHandle = func(lhs : (Nat, Text), rhs : (Nat, Text)) : {
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
      let cmp1 = Text.compare(lhs.1, rhs.1);
      switch (cmp1) {
        case (#less) return #less;
        case (#greater) return #greater;
        case (#equal) {};
      };
      #equal;
    };
    let cmpStore_bySponsorHandle = IndexCore.cmpStoreKey<(Nat, Text)>(cmpK_bySponsorHandle);

    let cmpK_byInstructions = Nat.compare;
    let cmpStore_byInstructions = IndexCore.cmpStoreKey<Nat>(cmpK_byInstructions);

    let cmpK_byBytes = Nat.compare;
    let cmpStore_byBytes = IndexCore.cmpStoreKey<Nat>(cmpK_byBytes);

    let cmpK_byAgent = Principal.compare;
    let cmpStore_byAgent = IndexCore.cmpStoreKey<Principal>(cmpK_byAgent);

    func key_byHackerHandle(d : Types.User) : ?Text {
      (func(d : Types.User) : ?Text { if (d.hacker) ?d.handle else null })(d);
    };

    func key_byObserverHandle(d : Types.User) : ?Text {
      (func(d : Types.User) : ?Text { if (not d.hacker and d.judgeStatus == #no and d.sponsorStatus == #no and not d.moderator) ?d.handle else null })(d);
    };

    func key_byModeratorHandle(d : Types.User) : ?Text {
      (func(d : Types.User) : ?Text { if (d.moderator) ?d.handle else null })(d);
    };

    func key_byJudgeHandle(d : Types.User) : ?(Nat, Text) {
      (func(d : Types.User) : ?(Nat, Text) { switch (d.judgeStatus) { case (#no) null; case (#pending) ?(1, d.handle); case (#approved) ?(2, d.handle) } })(d);
    };

    func key_bySponsorHandle(d : Types.User) : ?(Nat, Text) {
      (func(d : Types.User) : ?(Nat, Text) { switch (d.sponsorStatus) { case (#no) null; case (#pending) ?(1, d.handle); case (#approved) ?(2, d.handle) } })(d);
    };

    func key_byAgent(d : Types.User) : ?Principal {
      (func(d : Types.User) : ?Principal { d.agent })(d);
    };

    let keep_byPrincipal : IndexCore.Keep = #all;
    let keep_byHandle : IndexCore.Keep = #all;
    let keep_byCreated : IndexCore.Keep = #all;
    let keep_byHackerHandle : IndexCore.Keep = #all;
    let keep_byObserverHandle : IndexCore.Keep = #all;
    let keep_byModeratorHandle : IndexCore.Keep = #all;
    let keep_byJudgeHandle : IndexCore.Keep = #all;
    let keep_bySponsorHandle : IndexCore.Keep = #all;
    let keep_byInstructions : IndexCore.Keep = #all;
    let keep_byBytes : IndexCore.Keep = #all;
    let keep_byAgent : IndexCore.Keep = #all;

    let rowsStore = store.rows;
    let pk_indexStore = store.pk_index;
    let idx_byPrincipalStore = store.idx_byPrincipal;
    let idx_byHandleStore = store.idx_byHandle;
    let idx_byCreatedStore = store.idx_byCreated;
    let idx_byHackerHandleStore = store.idx_byHackerHandle;
    let idx_byObserverHandleStore = store.idx_byObserverHandle;
    let idx_byModeratorHandleStore = store.idx_byModeratorHandle;
    let idx_byJudgeHandleStore = store.idx_byJudgeHandle;
    let idx_bySponsorHandleStore = store.idx_bySponsorHandle;
    let idx_byInstructionsStore = store.idx_byInstructions;
    let idx_byBytesStore = store.idx_byBytes;
    let idx_byAgentStore = store.idx_byAgent;
    let cmpPKStore = IndexCore.cmpStoreKey<Nat64>(Nat64.compare);

    func slotToNat(slot : Nat64) : Nat { Nat64.toNat(slot) };

    func rowsGet(slot : Nat64) : ?Types.User {
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

    func rowsPut(slot : Nat64, doc : Types.User) : () {
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

    func allocSlot(doc : Types.User) : Nat64 {
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

    func projectPk(doc : Types.User) : Nat64 { doc.id };

    let rowAccess : IndexRuntime.RowStore<Types.User> = {
      get = rowsGet;
      has = rowsHas;
    };

    let nextIdManager = AshrootUseRuntime.manageNextId(store);

    type UniqueFields = {
      byPrincipal : AshrootUniqueRuntime.FieldChange<Principal>;
      byHandle : AshrootUniqueRuntime.FieldChange<Text>;
      byAgent : AshrootUniqueRuntime.FieldChange<?Principal>;
    };
    type UniqueChange = AshrootUniqueRuntime.UniqueChange<UniqueFields>;

    func compute_unique_change(prev : Types.User, next : Types.User) : UniqueChange {
      AshrootUniqueRuntime.compute(
        prev,
        next,
        func(prevDoc : Types.User, nextDoc : Types.User) : UniqueFields {
          {
            byPrincipal = do {
              let prevKey = prevDoc.principal;
              let nextKey = nextDoc.principal;
              {
                changed = cmpK_byPrincipal(prevKey, nextKey) != #equal;
                prev = prevKey;
                next = nextKey;
              };
            };
            byHandle = do {
              let prevKey = prevDoc.handle;
              let nextKey = nextDoc.handle;
              {
                changed = cmpK_byHandle(prevKey, nextKey) != #equal;
                prev = prevKey;
                next = nextKey;
              };
            };
            byAgent = do {
              let prevKey = key_byAgent(prevDoc);
              let nextKey = key_byAgent(nextDoc);
              {
                changed = switch (prevKey, nextKey) {
                  case (?prevVal, ?nextVal) {
                    cmpK_byAgent(prevVal, nextVal) != #equal;
                  };
                  case (?_, null) true;
                  case (null, ?_) true;
                  case (null, null) false;
                };
                prev = prevKey;
                next = nextKey;
              };
            };
          };
        },
        func(fields : UniqueFields) : Bool {
          fields.byPrincipal.changed or fields.byHandle.changed or fields.byAgent.changed;
        },
      );
    };

    func index_add_all(slot : Nat64, d : Types.User) : () {
      let key_byPrincipal = d.principal;
      IndexCore.insertWithRetention(idx_byPrincipalStore, cmpStore_byPrincipal, keep_byPrincipal, (key_byPrincipal, slot));
      let key_byHandle = d.handle;
      IndexCore.insertWithRetention(idx_byHandleStore, cmpStore_byHandle, keep_byHandle, (key_byHandle, slot));
      let key_byCreated = d.createdAt;
      IndexCore.insertWithRetention(idx_byCreatedStore, cmpStore_byCreated, keep_byCreated, (key_byCreated, slot));
      switch (key_byHackerHandle(d)) {
        case (?k) {
          IndexCore.insertWithRetention(idx_byHackerHandleStore, cmpStore_byHackerHandle, keep_byHackerHandle, (k, slot));
        };
        case null {};
      };
      switch (key_byObserverHandle(d)) {
        case (?k) {
          IndexCore.insertWithRetention(idx_byObserverHandleStore, cmpStore_byObserverHandle, keep_byObserverHandle, (k, slot));
        };
        case null {};
      };
      switch (key_byModeratorHandle(d)) {
        case (?k) {
          IndexCore.insertWithRetention(idx_byModeratorHandleStore, cmpStore_byModeratorHandle, keep_byModeratorHandle, (k, slot));
        };
        case null {};
      };
      switch (key_byJudgeHandle(d)) {
        case (?k) {
          IndexCore.insertWithRetention(idx_byJudgeHandleStore, cmpStore_byJudgeHandle, keep_byJudgeHandle, (k, slot));
        };
        case null {};
      };
      switch (key_bySponsorHandle(d)) {
        case (?k) {
          IndexCore.insertWithRetention(idx_bySponsorHandleStore, cmpStore_bySponsorHandle, keep_bySponsorHandle, (k, slot));
        };
        case null {};
      };
      let key_byInstructions = d.instructions;
      IndexCore.insertWithRetention(idx_byInstructionsStore, cmpStore_byInstructions, keep_byInstructions, (key_byInstructions, slot));
      let key_byBytes = d.bytes;
      IndexCore.insertWithRetention(idx_byBytesStore, cmpStore_byBytes, keep_byBytes, (key_byBytes, slot));
      switch (key_byAgent(d)) {
        case (?k) {
          IndexCore.insertWithRetention(idx_byAgentStore, cmpStore_byAgent, keep_byAgent, (k, slot));
        };
        case null {};
      };
    };

    func index_del_all(slot : Nat64, d : Types.User) : () {
      let key_byPrincipal = d.principal;
      IndexCore.deleteKey(idx_byPrincipalStore, cmpStore_byPrincipal, (key_byPrincipal, slot));
      let key_byHandle = d.handle;
      IndexCore.deleteKey(idx_byHandleStore, cmpStore_byHandle, (key_byHandle, slot));
      let key_byCreated = d.createdAt;
      IndexCore.deleteKey(idx_byCreatedStore, cmpStore_byCreated, (key_byCreated, slot));
      switch (key_byHackerHandle(d)) {
        case (?k) {
          IndexCore.deleteKey(idx_byHackerHandleStore, cmpStore_byHackerHandle, (k, slot));
        };
        case null {};
      };
      switch (key_byObserverHandle(d)) {
        case (?k) {
          IndexCore.deleteKey(idx_byObserverHandleStore, cmpStore_byObserverHandle, (k, slot));
        };
        case null {};
      };
      switch (key_byModeratorHandle(d)) {
        case (?k) {
          IndexCore.deleteKey(idx_byModeratorHandleStore, cmpStore_byModeratorHandle, (k, slot));
        };
        case null {};
      };
      switch (key_byJudgeHandle(d)) {
        case (?k) {
          IndexCore.deleteKey(idx_byJudgeHandleStore, cmpStore_byJudgeHandle, (k, slot));
        };
        case null {};
      };
      switch (key_bySponsorHandle(d)) {
        case (?k) {
          IndexCore.deleteKey(idx_bySponsorHandleStore, cmpStore_bySponsorHandle, (k, slot));
        };
        case null {};
      };
      let key_byInstructions = d.instructions;
      IndexCore.deleteKey(idx_byInstructionsStore, cmpStore_byInstructions, (key_byInstructions, slot));
      let key_byBytes = d.bytes;
      IndexCore.deleteKey(idx_byBytesStore, cmpStore_byBytes, (key_byBytes, slot));
      switch (key_byAgent(d)) {
        case (?k) {
          IndexCore.deleteKey(idx_byAgentStore, cmpStore_byAgent, (k, slot));
        };
        case null {};
      };
    };

    func index_refresh_on_update(slot : Nat64, prev : Types.User, next : Types.User, change : UniqueChange) : () {
      let delta_byPrincipal = change.fields.byPrincipal;
      if (delta_byPrincipal.changed) {
        IndexCore.deleteKey(idx_byPrincipalStore, cmpStore_byPrincipal, (delta_byPrincipal.prev, slot));
        IndexCore.insertWithRetention(idx_byPrincipalStore, cmpStore_byPrincipal, keep_byPrincipal, (delta_byPrincipal.next, slot));
      };

      let delta_byHandle = change.fields.byHandle;
      if (delta_byHandle.changed) {
        IndexCore.deleteKey(idx_byHandleStore, cmpStore_byHandle, (delta_byHandle.prev, slot));
        IndexCore.insertWithRetention(idx_byHandleStore, cmpStore_byHandle, keep_byHandle, (delta_byHandle.next, slot));
      };

      let prevKey_byCreated = prev.createdAt;
      let nextKey_byCreated = next.createdAt;
      var changed_byCreated : Bool = false;
      if (cmpK_byCreated(prevKey_byCreated, nextKey_byCreated) != #equal) {
        IndexCore.deleteKey(idx_byCreatedStore, cmpStore_byCreated, (prevKey_byCreated, slot));
        IndexCore.insertWithRetention(idx_byCreatedStore, cmpStore_byCreated, keep_byCreated, (nextKey_byCreated, slot));
        changed_byCreated := true;
      };

      let prevOpt_byHackerHandle = key_byHackerHandle(prev);
      let nextOpt_byHackerHandle = key_byHackerHandle(next);
      var changed_byHackerHandle : Bool = false;
      switch (prevOpt_byHackerHandle, nextOpt_byHackerHandle) {
        case (null, null) {};
        case (?prevKey, ?nextKey) {
          if (cmpK_byHackerHandle(prevKey, nextKey) != #equal) {
            IndexCore.deleteKey(idx_byHackerHandleStore, cmpStore_byHackerHandle, (prevKey, slot));
            IndexCore.insertWithRetention(idx_byHackerHandleStore, cmpStore_byHackerHandle, keep_byHackerHandle, (nextKey, slot));
            changed_byHackerHandle := true;
          };
        };
        case (?prevKey, null) {
          IndexCore.deleteKey(idx_byHackerHandleStore, cmpStore_byHackerHandle, (prevKey, slot));
          changed_byHackerHandle := true;
        };
        case (null, ?nextKey) {
          IndexCore.insertWithRetention(idx_byHackerHandleStore, cmpStore_byHackerHandle, keep_byHackerHandle, (nextKey, slot));
          changed_byHackerHandle := true;
        };
      };

      let prevOpt_byObserverHandle = key_byObserverHandle(prev);
      let nextOpt_byObserverHandle = key_byObserverHandle(next);
      var changed_byObserverHandle : Bool = false;
      switch (prevOpt_byObserverHandle, nextOpt_byObserverHandle) {
        case (null, null) {};
        case (?prevKey, ?nextKey) {
          if (cmpK_byObserverHandle(prevKey, nextKey) != #equal) {
            IndexCore.deleteKey(idx_byObserverHandleStore, cmpStore_byObserverHandle, (prevKey, slot));
            IndexCore.insertWithRetention(idx_byObserverHandleStore, cmpStore_byObserverHandle, keep_byObserverHandle, (nextKey, slot));
            changed_byObserverHandle := true;
          };
        };
        case (?prevKey, null) {
          IndexCore.deleteKey(idx_byObserverHandleStore, cmpStore_byObserverHandle, (prevKey, slot));
          changed_byObserverHandle := true;
        };
        case (null, ?nextKey) {
          IndexCore.insertWithRetention(idx_byObserverHandleStore, cmpStore_byObserverHandle, keep_byObserverHandle, (nextKey, slot));
          changed_byObserverHandle := true;
        };
      };

      let prevOpt_byModeratorHandle = key_byModeratorHandle(prev);
      let nextOpt_byModeratorHandle = key_byModeratorHandle(next);
      var changed_byModeratorHandle : Bool = false;
      switch (prevOpt_byModeratorHandle, nextOpt_byModeratorHandle) {
        case (null, null) {};
        case (?prevKey, ?nextKey) {
          if (cmpK_byModeratorHandle(prevKey, nextKey) != #equal) {
            IndexCore.deleteKey(idx_byModeratorHandleStore, cmpStore_byModeratorHandle, (prevKey, slot));
            IndexCore.insertWithRetention(idx_byModeratorHandleStore, cmpStore_byModeratorHandle, keep_byModeratorHandle, (nextKey, slot));
            changed_byModeratorHandle := true;
          };
        };
        case (?prevKey, null) {
          IndexCore.deleteKey(idx_byModeratorHandleStore, cmpStore_byModeratorHandle, (prevKey, slot));
          changed_byModeratorHandle := true;
        };
        case (null, ?nextKey) {
          IndexCore.insertWithRetention(idx_byModeratorHandleStore, cmpStore_byModeratorHandle, keep_byModeratorHandle, (nextKey, slot));
          changed_byModeratorHandle := true;
        };
      };

      let prevOpt_byJudgeHandle = key_byJudgeHandle(prev);
      let nextOpt_byJudgeHandle = key_byJudgeHandle(next);
      var changed_byJudgeHandle : Bool = false;
      switch (prevOpt_byJudgeHandle, nextOpt_byJudgeHandle) {
        case (null, null) {};
        case (?prevKey, ?nextKey) {
          if (cmpK_byJudgeHandle(prevKey, nextKey) != #equal) {
            IndexCore.deleteKey(idx_byJudgeHandleStore, cmpStore_byJudgeHandle, (prevKey, slot));
            IndexCore.insertWithRetention(idx_byJudgeHandleStore, cmpStore_byJudgeHandle, keep_byJudgeHandle, (nextKey, slot));
            changed_byJudgeHandle := true;
          };
        };
        case (?prevKey, null) {
          IndexCore.deleteKey(idx_byJudgeHandleStore, cmpStore_byJudgeHandle, (prevKey, slot));
          changed_byJudgeHandle := true;
        };
        case (null, ?nextKey) {
          IndexCore.insertWithRetention(idx_byJudgeHandleStore, cmpStore_byJudgeHandle, keep_byJudgeHandle, (nextKey, slot));
          changed_byJudgeHandle := true;
        };
      };

      let prevOpt_bySponsorHandle = key_bySponsorHandle(prev);
      let nextOpt_bySponsorHandle = key_bySponsorHandle(next);
      var changed_bySponsorHandle : Bool = false;
      switch (prevOpt_bySponsorHandle, nextOpt_bySponsorHandle) {
        case (null, null) {};
        case (?prevKey, ?nextKey) {
          if (cmpK_bySponsorHandle(prevKey, nextKey) != #equal) {
            IndexCore.deleteKey(idx_bySponsorHandleStore, cmpStore_bySponsorHandle, (prevKey, slot));
            IndexCore.insertWithRetention(idx_bySponsorHandleStore, cmpStore_bySponsorHandle, keep_bySponsorHandle, (nextKey, slot));
            changed_bySponsorHandle := true;
          };
        };
        case (?prevKey, null) {
          IndexCore.deleteKey(idx_bySponsorHandleStore, cmpStore_bySponsorHandle, (prevKey, slot));
          changed_bySponsorHandle := true;
        };
        case (null, ?nextKey) {
          IndexCore.insertWithRetention(idx_bySponsorHandleStore, cmpStore_bySponsorHandle, keep_bySponsorHandle, (nextKey, slot));
          changed_bySponsorHandle := true;
        };
      };

      let prevKey_byInstructions = prev.instructions;
      let nextKey_byInstructions = next.instructions;
      var changed_byInstructions : Bool = false;
      if (cmpK_byInstructions(prevKey_byInstructions, nextKey_byInstructions) != #equal) {
        IndexCore.deleteKey(idx_byInstructionsStore, cmpStore_byInstructions, (prevKey_byInstructions, slot));
        IndexCore.insertWithRetention(idx_byInstructionsStore, cmpStore_byInstructions, keep_byInstructions, (nextKey_byInstructions, slot));
        changed_byInstructions := true;
      };

      let prevKey_byBytes = prev.bytes;
      let nextKey_byBytes = next.bytes;
      var changed_byBytes : Bool = false;
      if (cmpK_byBytes(prevKey_byBytes, nextKey_byBytes) != #equal) {
        IndexCore.deleteKey(idx_byBytesStore, cmpStore_byBytes, (prevKey_byBytes, slot));
        IndexCore.insertWithRetention(idx_byBytesStore, cmpStore_byBytes, keep_byBytes, (nextKey_byBytes, slot));
        changed_byBytes := true;
      };

      let delta_byAgent = change.fields.byAgent;
      if (delta_byAgent.changed) {
        switch (delta_byAgent.prev) {
          case (?prevKey) {
            IndexCore.deleteKey(idx_byAgentStore, cmpStore_byAgent, (prevKey, slot));
          };
          case null {};
        };
        switch (delta_byAgent.next) {
          case (?nextKey) {
            IndexCore.insertWithRetention(idx_byAgentStore, cmpStore_byAgent, keep_byAgent, (nextKey, slot));
          };
          case null {};
        };
      };
    };

    func ensure_unique_byPrincipal(d : Types.User, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      let uniqueKey_byPrincipal = d.principal;
      switch (IndexRuntime.indexKeyConflict(idx_byPrincipalStore, cmpStore_byPrincipal, cmpK_byPrincipal, rowAccess, projectPk, uniqueKey_byPrincipal, skipPk)) {
        case (?owner) { return #err(#AlreadyExists(owner)) };
        case null {};
      };
      #ok();
    };

    func ensure_unique_byHandle(d : Types.User, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      let uniqueKey_byHandle = d.handle;
      switch (IndexRuntime.indexKeyConflict(idx_byHandleStore, cmpStore_byHandle, cmpK_byHandle, rowAccess, projectPk, uniqueKey_byHandle, skipPk)) {
        case (?owner) { return #err(#AlreadyExists(owner)) };
        case null {};
      };
      #ok();
    };

    func ensure_unique_byAgent(d : Types.User, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      switch (key_byAgent(d)) {
        case (?k) {
          switch (IndexRuntime.indexKeyConflict(idx_byAgentStore, cmpStore_byAgent, cmpK_byAgent, rowAccess, projectPk, k, skipPk)) {
            case (?owner) { return #err(#AlreadyExists(owner)) };
            case null {};
          };
        };
        case null {};
      };
      #ok();
    };

    func ensure_unique_constraints(d : Types.User, skipPk : ?Nat64) : Result.Result<(), Errors.Error> {
      switch (ensure_unique_byPrincipal(d, skipPk)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      switch (ensure_unique_byHandle(d, skipPk)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      switch (ensure_unique_byAgent(d, skipPk)) {
        case (#ok()) {};
        case (#err(e)) { return #err(e) };
      };
      #ok();
    };

    func validateCreateConstraints(data : Types.CreateUser) : Result.Result<(), Errors.Error> {
      let len_handle = Text.size(data.handle);
      if (len_handle < 3) {
        return #err(#ConstraintViolation({ field = "handle"; message = "length must be >= 3" }));
      };
      if (len_handle > 32) {
        return #err(#ConstraintViolation({ field = "handle"; message = "length must be <= 32" }));
      };
      let len_displayName = Text.size(data.displayName);
      if (len_displayName > 64) {
        return #err(#ConstraintViolation({ field = "displayName"; message = "length must be <= 64" }));
      };
      let len_bio = Text.size(data.bio);
      if (len_bio > 1000) {
        return #err(#ConstraintViolation({ field = "bio"; message = "length must be <= 1000" }));
      };
      #ok();
    };

    func validateDocConstraints(doc : Types.User) : Result.Result<(), Errors.Error> {
      let len_handle = Text.size(doc.handle);
      if (len_handle < 3) {
        return #err(#ConstraintViolation({ field = "handle"; message = "length must be >= 3" }));
      };
      if (len_handle > 32) {
        return #err(#ConstraintViolation({ field = "handle"; message = "length must be <= 32" }));
      };
      let len_displayName = Text.size(doc.displayName);
      if (len_displayName > 64) {
        return #err(#ConstraintViolation({ field = "displayName"; message = "length must be <= 64" }));
      };
      let len_bio = Text.size(doc.bio);
      if (len_bio > 1000) {
        return #err(#ConstraintViolation({ field = "bio"; message = "length must be <= 1000" }));
      };
      #ok();
    };

    func makeDoc(id : Nat64, data : Types.CreateUser) : Types.User {
      {
        id = id;
        principal = data.principal;
        handle = data.handle;
        displayName = data.displayName;
        title = data.title;
        bio = data.bio;
        avatar = data.avatar;
        links = data.links;
        judgeStatus = data.judgeStatus;
        moderator = data.moderator;
        createdAt = data.createdAt;
        updatedAt = data.updatedAt;
        sponsorStatus = data.sponsorStatus;
        sponsor = data.sponsor;
        hacker = data.hacker;
        instructions = data.instructions;
        bytes = data.bytes;
        frozen = data.frozen;
        wallet = data.wallet;
        agent = data.agent;
        rewardOptOut = data.rewardOptOut;
        termsAt = data.termsAt;
        termsVersion = data.termsVersion;
        anonymized = data.anonymized;
      };
    };

    func insertOne(data : Types.CreateUser) : Result.Result<Nat64, Errors.Error> {
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

    func getOne(pk : Nat64) : ?Types.User {
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

    func updateOne(doc : Types.User) : Result.Result<Types.User, Errors.Error> {
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
                if (uniqueChange.fields.byPrincipal.changed) {
                  switch (ensure_unique_byPrincipal(doc, ?pk)) {
                    case (#ok()) {};
                    case (#err(e)) { return #err(e) };
                  };
                };
                if (uniqueChange.fields.byHandle.changed) {
                  switch (ensure_unique_byHandle(doc, ?pk)) {
                    case (#ok()) {};
                    case (#err(e)) { return #err(e) };
                  };
                };
                if (uniqueChange.fields.byAgent.changed) {
                  switch (ensure_unique_byAgent(doc, ?pk)) {
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

    func upsertOne(doc : Types.User) : Result.Result<{ #inserted; #updated }, Errors.Error> {
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
                if (uniqueChange.fields.byPrincipal.changed) {
                  switch (ensure_unique_byPrincipal(doc, ?pk)) {
                    case (#ok()) {};
                    case (#err(e)) { return #err(e) };
                  };
                };
                if (uniqueChange.fields.byHandle.changed) {
                  switch (ensure_unique_byHandle(doc, ?pk)) {
                    case (#ok()) {};
                    case (#err(e)) { return #err(e) };
                  };
                };
                if (uniqueChange.fields.byAgent.changed) {
                  switch (ensure_unique_byAgent(doc, ?pk)) {
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

    func insertManyImpl(records : [Types.CreateUser]) : Result.Result<[Nat64], Errors.Error> {
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

    func upsertManyImpl(records : [Types.User]) : Result.Result<{ inserted : Nat; updated : Nat }, Errors.Error> {
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

    func getManyImpl(pks : [Nat64]) : [(Nat64, ?Types.User)] {
      Array.tabulate<(Nat64, ?Types.User)>(
        Array.size(pks),
        func(i : Nat) : (Nat64, ?Types.User) {
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

    let deleteDoc = func(slot : Nat64, d : Types.User) : Result.Result<(), Errors.Error> {
      index_del_all(slot, d);
      removePkEntry(d.id, slot);
      freeSlot(slot);
      if (store.rowCount > 0) { store.rowCount -= 1 };
      #ok();
    };

    func encodePrincipalCursor(dir : IndexCore.Direction, entry : (Principal, Nat64)) : Cursors.Token {
      let (k, pk) = entry;
      Cursors.encodePrincipal(dir, k, pk);
    };

    func encodeTextCursor(dir : IndexCore.Direction, entry : (Text, Nat64)) : Cursors.Token {
      let (k, pk) = entry;
      Cursors.encodeText(dir, k, pk);
    };

    func encodeNat64Cursor(dir : IndexCore.Direction, entry : (Nat64, Nat64)) : Cursors.Token {
      let (k, pk) = entry;
      Cursors.encodeNat64(dir, k, pk);
    };

    func encodeNatCursor(dir : IndexCore.Direction, entry : (Nat, Nat64)) : Cursors.Token {
      let (k, pk) = entry;
      Cursors.encodeNat(dir, k, pk);
    };

    func encodeByJudgeHandleCursor(dir : IndexCore.Direction, entry : ((Nat, Text), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1) = storeKey;
      Cursors.encodeComposite(dir, "Nat_Text", [Cursors.encodeSegmentNat(k0), Cursors.encodeSegmentText(k1)], pk);
    };

    func decodeByJudgeHandleCursor(token : Cursors.Token) : ?((Nat, Text), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat_Text", 2)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentText(segments[1]) else return null;
          let key = (k0, k1);
          ?(key, pk);
        };
        case null null;
      };
    };

    func encodeBySponsorHandleCursor(dir : IndexCore.Direction, entry : ((Nat, Text), Nat64)) : Cursors.Token {
      let (storeKey, pk) = entry;
      let (k0, k1) = storeKey;
      Cursors.encodeComposite(dir, "Nat_Text", [Cursors.encodeSegmentNat(k0), Cursors.encodeSegmentText(k1)], pk);
    };

    func decodeBySponsorHandleCursor(token : Cursors.Token) : ?((Nat, Text), Nat64) {
      switch (Cursors.decodeComposite(token, "Nat_Text", 2)) {
        case (?(segments, pk)) {
          let ?k0 = Cursors.decodeSegmentNat(segments[0]) else return null;
          let ?k1 = Cursors.decodeSegmentText(segments[1]) else return null;
          let key = (k0, k1);
          ?(key, pk);
        };
        case null null;
      };
    };

    let byPrincipalFind = func(dir : IndexCore.Direction, start : Principal, limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<Principal, Types.User>(rowAccess, idx_byPrincipalStore, cmpStore_byPrincipal, cmpK_byPrincipal, dir, start, limit);
    };

    let byHandleFind = func(dir : IndexCore.Direction, start : Text, limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<Text, Types.User>(rowAccess, idx_byHandleStore, cmpStore_byHandle, cmpK_byHandle, dir, start, limit);
    };

    let byCreatedFind = func(dir : IndexCore.Direction, start : Nat64, limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<Nat64, Types.User>(rowAccess, idx_byCreatedStore, cmpStore_byCreated, cmpK_byCreated, dir, start, limit);
    };

    let byHackerHandleFind = func(dir : IndexCore.Direction, start : Text, limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<Text, Types.User>(rowAccess, idx_byHackerHandleStore, cmpStore_byHackerHandle, cmpK_byHackerHandle, dir, start, limit);
    };

    let byObserverHandleFind = func(dir : IndexCore.Direction, start : Text, limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<Text, Types.User>(rowAccess, idx_byObserverHandleStore, cmpStore_byObserverHandle, cmpK_byObserverHandle, dir, start, limit);
    };

    let byModeratorHandleFind = func(dir : IndexCore.Direction, start : Text, limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<Text, Types.User>(rowAccess, idx_byModeratorHandleStore, cmpStore_byModeratorHandle, cmpK_byModeratorHandle, dir, start, limit);
    };

    let byJudgeHandleFind = func(dir : IndexCore.Direction, start : (Nat, Text), limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<(Nat, Text), Types.User>(rowAccess, idx_byJudgeHandleStore, cmpStore_byJudgeHandle, cmpK_byJudgeHandle, dir, start, limit);
    };

    let bySponsorHandleFind = func(dir : IndexCore.Direction, start : (Nat, Text), limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<(Nat, Text), Types.User>(rowAccess, idx_bySponsorHandleStore, cmpStore_bySponsorHandle, cmpK_bySponsorHandle, dir, start, limit);
    };

    let byInstructionsFind = func(dir : IndexCore.Direction, start : Nat, limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<Nat, Types.User>(rowAccess, idx_byInstructionsStore, cmpStore_byInstructions, cmpK_byInstructions, dir, start, limit);
    };

    let byBytesFind = func(dir : IndexCore.Direction, start : Nat, limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<Nat, Types.User>(rowAccess, idx_byBytesStore, cmpStore_byBytes, cmpK_byBytes, dir, start, limit);
    };

    let byAgentFind = func(dir : IndexCore.Direction, start : Principal, limit : Nat) : Iter.Iter<Types.User> {
      IndexRuntime.makeFindIter<Principal, Types.User>(rowAccess, idx_byAgentStore, cmpStore_byAgent, cmpK_byAgent, dir, start, limit);
    };

    let byPrincipalOps = IndexRuntime.makeIndexOps<Principal, Types.User, Errors.Error>(
      "byPrincipal",
      idx_byPrincipalStore,
      cmpK_byPrincipal,
      cmpStore_byPrincipal,
      keep_byPrincipal,
      rowAccess,
      projectPk,
      Cursors.decodePrincipal,
      encodePrincipalCursor,
      byPrincipalFind,
      deleteDoc,
    );

    let byHandleBase = IndexRuntime.makeIndexOps<Text, Types.User, Errors.Error>(
      "byHandle",
      idx_byHandleStore,
      cmpK_byHandle,
      cmpStore_byHandle,
      keep_byHandle,
      rowAccess,
      projectPk,
      Cursors.decodeText,
      encodeTextCursor,
      byHandleFind,
      deleteDoc,
    );

    let byHandleOps : TextIndexOps = {
      descriptor = byHandleBase.descriptor;
      find = byHandleBase.find;
      rangeDelete = byHandleBase.rangeDelete;
      exists = byHandleBase.exists;
      locate = func(key : Text) : ?Nat64 {
        IndexRuntime.indexLocate<Text, Types.User>(idx_byHandleStore, cmpStore_byHandle, cmpK_byHandle, key, rowAccess, projectPk);
      };
      countInRange = byHandleBase.countInRange;
      size = byHandleBase.size;
      rangeIter = byHandleBase.rangeIter;
      mapRange = byHandleBase.mapRange;
      foldRange = byHandleBase.foldRange;
      prefixFind = func(dir : IndexCore.Direction, prefix : Text, limit : Nat) : Iter.Iter<Types.User> {
        let bounds = TextRange.prefixRange(prefix, dir);
        IndexRuntime.limitIter(byHandleBase.rangeIter(bounds, null), limit);
      };
    };

    let byCreatedOps = IndexRuntime.makeIndexOps<Nat64, Types.User, Errors.Error>(
      "byCreated",
      idx_byCreatedStore,
      cmpK_byCreated,
      cmpStore_byCreated,
      keep_byCreated,
      rowAccess,
      projectPk,
      Cursors.decodeNat64,
      encodeNat64Cursor,
      byCreatedFind,
      deleteDoc,
    );

    let byHackerHandleBase = IndexRuntime.makeIndexOps<Text, Types.User, Errors.Error>(
      "byHackerHandle",
      idx_byHackerHandleStore,
      cmpK_byHackerHandle,
      cmpStore_byHackerHandle,
      keep_byHackerHandle,
      rowAccess,
      projectPk,
      Cursors.decodeText,
      encodeTextCursor,
      byHackerHandleFind,
      deleteDoc,
    );

    let byHackerHandleOps : TextIndexOps = {
      descriptor = byHackerHandleBase.descriptor;
      find = byHackerHandleBase.find;
      rangeDelete = byHackerHandleBase.rangeDelete;
      exists = byHackerHandleBase.exists;
      locate = func(key : Text) : ?Nat64 {
        IndexRuntime.indexLocate<Text, Types.User>(idx_byHackerHandleStore, cmpStore_byHackerHandle, cmpK_byHackerHandle, key, rowAccess, projectPk);
      };
      countInRange = byHackerHandleBase.countInRange;
      size = byHackerHandleBase.size;
      rangeIter = byHackerHandleBase.rangeIter;
      mapRange = byHackerHandleBase.mapRange;
      foldRange = byHackerHandleBase.foldRange;
      prefixFind = func(dir : IndexCore.Direction, prefix : Text, limit : Nat) : Iter.Iter<Types.User> {
        let bounds = TextRange.prefixRange(prefix, dir);
        IndexRuntime.limitIter(byHackerHandleBase.rangeIter(bounds, null), limit);
      };
    };

    let byObserverHandleBase = IndexRuntime.makeIndexOps<Text, Types.User, Errors.Error>(
      "byObserverHandle",
      idx_byObserverHandleStore,
      cmpK_byObserverHandle,
      cmpStore_byObserverHandle,
      keep_byObserverHandle,
      rowAccess,
      projectPk,
      Cursors.decodeText,
      encodeTextCursor,
      byObserverHandleFind,
      deleteDoc,
    );

    let byObserverHandleOps : TextIndexOps = {
      descriptor = byObserverHandleBase.descriptor;
      find = byObserverHandleBase.find;
      rangeDelete = byObserverHandleBase.rangeDelete;
      exists = byObserverHandleBase.exists;
      locate = func(key : Text) : ?Nat64 {
        IndexRuntime.indexLocate<Text, Types.User>(idx_byObserverHandleStore, cmpStore_byObserverHandle, cmpK_byObserverHandle, key, rowAccess, projectPk);
      };
      countInRange = byObserverHandleBase.countInRange;
      size = byObserverHandleBase.size;
      rangeIter = byObserverHandleBase.rangeIter;
      mapRange = byObserverHandleBase.mapRange;
      foldRange = byObserverHandleBase.foldRange;
      prefixFind = func(dir : IndexCore.Direction, prefix : Text, limit : Nat) : Iter.Iter<Types.User> {
        let bounds = TextRange.prefixRange(prefix, dir);
        IndexRuntime.limitIter(byObserverHandleBase.rangeIter(bounds, null), limit);
      };
    };

    let byModeratorHandleBase = IndexRuntime.makeIndexOps<Text, Types.User, Errors.Error>(
      "byModeratorHandle",
      idx_byModeratorHandleStore,
      cmpK_byModeratorHandle,
      cmpStore_byModeratorHandle,
      keep_byModeratorHandle,
      rowAccess,
      projectPk,
      Cursors.decodeText,
      encodeTextCursor,
      byModeratorHandleFind,
      deleteDoc,
    );

    let byModeratorHandleOps : TextIndexOps = {
      descriptor = byModeratorHandleBase.descriptor;
      find = byModeratorHandleBase.find;
      rangeDelete = byModeratorHandleBase.rangeDelete;
      exists = byModeratorHandleBase.exists;
      locate = func(key : Text) : ?Nat64 {
        IndexRuntime.indexLocate<Text, Types.User>(idx_byModeratorHandleStore, cmpStore_byModeratorHandle, cmpK_byModeratorHandle, key, rowAccess, projectPk);
      };
      countInRange = byModeratorHandleBase.countInRange;
      size = byModeratorHandleBase.size;
      rangeIter = byModeratorHandleBase.rangeIter;
      mapRange = byModeratorHandleBase.mapRange;
      foldRange = byModeratorHandleBase.foldRange;
      prefixFind = func(dir : IndexCore.Direction, prefix : Text, limit : Nat) : Iter.Iter<Types.User> {
        let bounds = TextRange.prefixRange(prefix, dir);
        IndexRuntime.limitIter(byModeratorHandleBase.rangeIter(bounds, null), limit);
      };
    };

    let byJudgeHandleOps = IndexRuntime.makeIndexOps<(Nat, Text), Types.User, Errors.Error>(
      "byJudgeHandle",
      idx_byJudgeHandleStore,
      cmpK_byJudgeHandle,
      cmpStore_byJudgeHandle,
      keep_byJudgeHandle,
      rowAccess,
      projectPk,
      decodeByJudgeHandleCursor,
      encodeByJudgeHandleCursor,
      byJudgeHandleFind,
      deleteDoc,
    );

    let bySponsorHandleOps = IndexRuntime.makeIndexOps<(Nat, Text), Types.User, Errors.Error>(
      "bySponsorHandle",
      idx_bySponsorHandleStore,
      cmpK_bySponsorHandle,
      cmpStore_bySponsorHandle,
      keep_bySponsorHandle,
      rowAccess,
      projectPk,
      decodeBySponsorHandleCursor,
      encodeBySponsorHandleCursor,
      bySponsorHandleFind,
      deleteDoc,
    );

    let byInstructionsOps = IndexRuntime.makeIndexOps<Nat, Types.User, Errors.Error>(
      "byInstructions",
      idx_byInstructionsStore,
      cmpK_byInstructions,
      cmpStore_byInstructions,
      keep_byInstructions,
      rowAccess,
      projectPk,
      Cursors.decodeNat,
      encodeNatCursor,
      byInstructionsFind,
      deleteDoc,
    );

    let byBytesOps = IndexRuntime.makeIndexOps<Nat, Types.User, Errors.Error>(
      "byBytes",
      idx_byBytesStore,
      cmpK_byBytes,
      cmpStore_byBytes,
      keep_byBytes,
      rowAccess,
      projectPk,
      Cursors.decodeNat,
      encodeNatCursor,
      byBytesFind,
      deleteDoc,
    );

    let byAgentOps = IndexRuntime.makeIndexOps<Principal, Types.User, Errors.Error>(
      "byAgent",
      idx_byAgentStore,
      cmpK_byAgent,
      cmpStore_byAgent,
      keep_byAgent,
      rowAccess,
      projectPk,
      Cursors.decodePrincipal,
      encodePrincipalCursor,
      byAgentFind,
      deleteDoc,
    );

    let iterPrimary = AshrootPrimaryIter.make(rowAccess, pk_indexStore, cmpPKStore);
    let iter = AshrootListIter.make(rowsStore);
    let mapIter = func<R>(dir : IndexCore.Direction, f : Types.User -> R) : Iter.Iter<R> {
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
    let foldIter = func<A>(dir : IndexCore.Direction, init : A, f : (A, Types.User) -> A) : A {
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
      byPrincipal = byPrincipalOps;
      byHandle = byHandleOps;
      byCreated = byCreatedOps;
      byHackerHandle = byHackerHandleOps;
      byObserverHandle = byObserverHandleOps;
      byModeratorHandle = byModeratorHandleOps;
      byJudgeHandle = byJudgeHandleOps;
      bySponsorHandle = bySponsorHandleOps;
      byInstructions = byInstructionsOps;
      byBytes = byBytesOps;
      byAgent = byAgentOps;
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
