// Canister-wide settings.
//
// Launch policy changes far less often than participant data. Keeping it in a
// compact singleton also makes multi-field updates explicit and atomic.
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Text "mo:core/Text";

import AshrootStoreRuntime "mo:ashroot/store_runtime";

module {
  public module Types {
    public module Store {
      public module LedgerAllowlist {
        public type Element = Principal;
        public type Type = [Element];
      };
      public type LedgerAllowlist = LedgerAllowlist.Type;
      public type Type = {
        siteTitle : Text;
        registrationOpen : Bool;
        frontendHash : Text;
        instructionCap : Nat;
        ledgerAllowlistSet : Bool;
        ledgerAllowlist : LedgerAllowlist;
        nextSeasonUrl : Text;
      };
      public module Mutation {
        public type Type = {
          var siteTitle : ?Text;
          var registrationOpen : ?Bool;
          var frontendHash : ?Text;
          var instructionCap : ?Nat;
          var ledgerAllowlistSet : ?Bool;
          var ledgerAllowlist : ?LedgerAllowlist;
          var nextSeasonUrl : ?Text;
        };
        public func new() : Type {
          {
            var siteTitle = null;
            var registrationOpen = null;
            var frontendHash = null;
            var instructionCap = null;
            var ledgerAllowlistSet = null;
            var ledgerAllowlist = null;
            var nextSeasonUrl = null;
          };
        };
      };
      public type Mutation = Mutation.Type;
      public func mut() : Mutation {
        Mutation.new();
      };
    };
    public type Store = Store.Type;
  };

  public type FieldAccess<T> = { set : (T) -> () };

  public type StoreAccess = {
    get : () -> Types.Store;
    set : (Types.Store) -> ();
    siteTitle : FieldAccess<Text>;
    registrationOpen : FieldAccess<Bool>;
    frontendHash : FieldAccess<Text>;
    instructionCap : FieldAccess<Nat>;
    ledgerAllowlistSet : FieldAccess<Bool>;
    ledgerAllowlist : FieldAccess<Types.Store.LedgerAllowlist>;
    nextSeasonUrl : FieldAccess<Text>;
    apply : Types.Store.Mutation -> ();
  };

  func merge_Store(current : Types.Store, mutation : Types.Store.Mutation) : Types.Store {
    let siteTitle_next = AshrootStoreRuntime.mergeField<Text, Text>(current.siteTitle, mutation.siteTitle, func(_current : Text, next : Text) : Text { next });
    let registrationOpen_next = AshrootStoreRuntime.mergeField<Bool, Bool>(current.registrationOpen, mutation.registrationOpen, func(_current : Bool, next : Bool) : Bool { next });
    let frontendHash_next = AshrootStoreRuntime.mergeField<Text, Text>(current.frontendHash, mutation.frontendHash, func(_current : Text, next : Text) : Text { next });
    let instructionCap_next = AshrootStoreRuntime.mergeField<Nat, Nat>(current.instructionCap, mutation.instructionCap, func(_current : Nat, next : Nat) : Nat { next });
    let ledgerAllowlistSet_next = AshrootStoreRuntime.mergeField<Bool, Bool>(current.ledgerAllowlistSet, mutation.ledgerAllowlistSet, func(_current : Bool, next : Bool) : Bool { next });
    let ledgerAllowlist_next = AshrootStoreRuntime.mergeField<Types.Store.LedgerAllowlist, Types.Store.LedgerAllowlist>(current.ledgerAllowlist, mutation.ledgerAllowlist, func(_current : Types.Store.LedgerAllowlist, next : Types.Store.LedgerAllowlist) : Types.Store.LedgerAllowlist { next });
    let nextSeasonUrl_next = AshrootStoreRuntime.mergeField<Text, Text>(current.nextSeasonUrl, mutation.nextSeasonUrl, func(_current : Text, next : Text) : Text { next });
    {
      siteTitle = siteTitle_next;
      registrationOpen = registrationOpen_next;
      frontendHash = frontendHash_next;
      instructionCap = instructionCap_next;
      ledgerAllowlistSet = ledgerAllowlistSet_next;
      ledgerAllowlist = ledgerAllowlist_next;
      nextSeasonUrl = nextSeasonUrl_next;
    };
  };

  public func mut() : Types.Store.Mutation {
    Types.Store.mut();
  };

  public func apply(obj : Types.Store, mutation : Types.Store.Mutation) : Types.Store {
    merge_Store(obj, mutation);
  };

  func makeStoreAccess(
    getter : () -> Types.Store,
    setter : (Types.Store) -> (),
  ) : StoreAccess {
    let siteTitleAccess = AshrootStoreRuntime.fieldAccess<Types.Store, Text>(
      getter,
      setter,
      func(current : Types.Store, next : Text) : Types.Store {
        { current with siteTitle = next };
      },
    );
    let registrationOpenAccess = AshrootStoreRuntime.fieldAccess<Types.Store, Bool>(
      getter,
      setter,
      func(current : Types.Store, next : Bool) : Types.Store {
        { current with registrationOpen = next };
      },
    );
    let frontendHashAccess = AshrootStoreRuntime.fieldAccess<Types.Store, Text>(
      getter,
      setter,
      func(current : Types.Store, next : Text) : Types.Store {
        { current with frontendHash = next };
      },
    );
    let instructionCapAccess = AshrootStoreRuntime.fieldAccess<Types.Store, Nat>(
      getter,
      setter,
      func(current : Types.Store, next : Nat) : Types.Store {
        { current with instructionCap = next };
      },
    );
    let ledgerAllowlistSetAccess = AshrootStoreRuntime.fieldAccess<Types.Store, Bool>(
      getter,
      setter,
      func(current : Types.Store, next : Bool) : Types.Store {
        { current with ledgerAllowlistSet = next };
      },
    );
    let ledgerAllowlistAccess = AshrootStoreRuntime.fieldAccess<Types.Store, Types.Store.LedgerAllowlist>(
      getter,
      setter,
      func(current : Types.Store, next : Types.Store.LedgerAllowlist) : Types.Store {
        { current with ledgerAllowlist = next };
      },
    );
    let nextSeasonUrlAccess = AshrootStoreRuntime.fieldAccess<Types.Store, Text>(
      getter,
      setter,
      func(current : Types.Store, next : Text) : Types.Store {
        { current with nextSeasonUrl = next };
      },
    );
    func applyMutation(mutation : Types.Store.Mutation) : () {
      let current = getter();
      let next = merge_Store(current, mutation);
      setter(next);
    };
    {
      get = getter;
      set = setter;
      siteTitle = siteTitleAccess;
      registrationOpen = registrationOpenAccess;
      frontendHash = frontendHashAccess;
      instructionCap = instructionCapAccess;
      ledgerAllowlistSet = ledgerAllowlistSetAccess;
      ledgerAllowlist = ledgerAllowlistAccess;
      nextSeasonUrl = nextSeasonUrlAccess;
      apply = applyMutation;
    };
  };

  public type Init = { var value : ?Types.Store };
  public func init() : Init { { var value = null } };

  public func ensure(slot : Init, defaults : Types.Store) : () {
    if (slot.value == null) {
      slot.value := ?defaults;
    };
  };

  public type Use = StoreAccess;

  public func use(slot : Init) : Use {
    let missingMsg = "Ashroot store value missing; call ensure() before use.";
    let runtime = AshrootStoreRuntime.wrap(slot, missingMsg);
    let storeAccess = makeStoreAccess(runtime.get, runtime.set);
    storeAccess;
  };
};
