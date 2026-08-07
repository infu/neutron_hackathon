import Nat64 "mo:core/Nat64";
import Iter "mo:core/Iter";
import Order "mo:core/Order";
import Set "mo:core/Set";

import IndexCore "./index_core";
import IndexRuntime "./index_runtime";

module {

    public func make<Doc>(
        rows : IndexRuntime.RowStore<Doc>,
        pkIndex : Set.Set<(Nat64, Nat64)>,
        cmpStore : (((Nat64, Nat64), (Nat64, Nat64)) -> Order.Order)
    ) : (IndexCore.Direction, ?Nat64) -> Iter.Iter<(Nat64, Doc)> {
        func build(dir : IndexCore.Direction, after : ?Nat64) : Iter.Iter<(Nat64, Doc)> {
            let raw = switch (dir) {
                case (#fwd) {
                    switch (after) {
                        case (?pk) Set.valuesFrom(pkIndex, cmpStore, (pk, Nat64.fromNat(0)));
                        case null Set.values(pkIndex);
                    };
                };
                case (#bwd) {
                    switch (after) {
                        case (?pk) Set.reverseValuesFrom(pkIndex, cmpStore, (pk, Nat64.maxValue));
                        case null Set.reverseValues(pkIndex);
                    };
                };
            };

            var skip = after;
            var pending = raw.next();
            var finished = false;

            func advanceForward() : ?(Nat64, Doc) {
                label scan while (true) {
                    switch (pending) {
                        case null {
                            finished := true;
                            return null;
                        };
                        case (?entry) {
                            let (pk, slot) = entry;
                            switch (skip) {
                                case (?boundary) {
                                    if (Nat64.compare(pk, boundary) != #greater) {
                                        pending := raw.next();
                                        continue scan;
                                    };
                                    skip := null;
                                };
                                case null {};
                            };
                            switch (rows.get(slot)) {
                                case (?doc) {
                                    pending := raw.next();
                                    return ?(pk, doc);
                                };
                                case null {
                                    pending := raw.next();
                                    continue scan;
                                };
                            };
                        };
                    };
                };
                return null;
            };

            func advanceBackward() : ?(Nat64, Doc) {
                label scan while (true) {
                    switch (pending) {
                        case null {
                            finished := true;
                            return null;
                        };
                        case (?entry) {
                            let (pk, slot) = entry;
                            switch (skip) {
                                case (?boundary) {
                                    if (Nat64.compare(pk, boundary) != #less) {
                                        pending := raw.next();
                                        continue scan;
                                    };
                                    skip := null;
                                };
                                case null {};
                            };
                            switch (rows.get(slot)) {
                                case (?doc) {
                                    pending := raw.next();
                                    return ?(pk, doc);
                                };
                                case null {
                                    pending := raw.next();
                                    continue scan;
                                };
                            };
                        };
                    };
                };
                return null;
            };

            func nextValue() : ?(Nat64, Doc) {
                if (finished) { return null };
                switch (dir) {
                    case (#fwd) advanceForward();
                    case (#bwd) advanceBackward();
                };
            };

            {
                next = func () : ?(Nat64, Doc) { nextValue(); };
            };
        };

        func iter(dir : IndexCore.Direction, after : ?Nat64) : Iter.Iter<(Nat64, Doc)> {
            build(dir, after);
        };

        iter;
    };
}
