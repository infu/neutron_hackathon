import Nat64 "mo:core/Nat64";

module {
    public type NextIdManager = {
        current : () -> Nat64;
        ensureAfter : (Nat64) -> ();
    };

    public func manageNextId(store : { var nextId : Nat64 }) : NextIdManager {
        func current() : Nat64 = store.nextId;

        func ensureAfter(after : Nat64) : () {
            let next = if (after == Nat64.maxValue) { after } else { after + 1 };
            if (Nat64.compare(store.nextId, next) == #less) {
                store.nextId := next;
            };
        };

        { current; ensureAfter };
    };
}
