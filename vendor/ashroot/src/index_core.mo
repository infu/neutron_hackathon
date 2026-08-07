import Set "mo:core/Set";
import Order "mo:core/Order";
import Nat64 "mo:core/Nat64";
import Tuples "mo:core/Tuples";

module {
    public type Direction = { #fwd; #bwd };

    type Bounds = {
        lowerOk : Bool;
        upperOk : Bool;
    };

    // Spec §Indexes: retention policy exposed to generators (#all/#top/#bottom).
    public type Keep = {
        #all;
        #top : Nat;
        #bottom : Nat;
    };

    public type SecIndex<K> = Set.Set<(K, Nat64)>;

    public type Range<K> = {
        gt : ?K;
        gte : ?K;
        lt : ?K;
        lte : ?K;
        dir : Direction;
    };

    public type RangeMeta<K> = {
        last : ?(K, Nat64);
        hasMore : Bool;
    };

    public func countRange<K>(
        idx : SecIndex<K>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        cmpKey : (K, K) -> Order.Order,
        range : Range<K>,
        limit : ?Nat
    ) : Nat {
        let maxCount = switch (limit) {
            case (?l) l;
            case null { Set.size(idx) };
        };

        if (maxCount == 0) {
            return 0;
        };

        let iter = switch (range.dir) {
            case (#fwd) {
                switch (range.gte) {
                    case (?k) { Set.valuesFrom(idx, cmpStore, (k, Nat64.fromNat(0))) };
                    case null {
                        switch (range.gt) {
                            case (?k) { Set.valuesFrom(idx, cmpStore, (k, Nat64.fromNat(0))) };
                            case null { Set.values(idx) };
                        };
                    };
                };
            };
            case (#bwd) {
                switch (range.lte) {
                    case (?k) { Set.reverseValuesFrom(idx, cmpStore, (k, Nat64.maxValue)) };
                    case null {
                        switch (range.lt) {
                            case (?k) { Set.reverseValuesFrom(idx, cmpStore, (k, Nat64.maxValue)) };
                            case null { Set.reverseValues(idx) };
                        };
                    };
                };
            };
        };

        var count : Nat = 0;
        var nextEntry = iter.next();

        label scanLoop while (count < maxCount) {
            switch (nextEntry) {
                case null {
                    break scanLoop;
                };
                case (?storeKey) {
                    let (k, _) = storeKey;
                    let bounds = evaluateBounds(range, cmpKey, k);

                    switch (range.dir) {
                        case (#fwd) {
                            if (not bounds.upperOk) {
                                break scanLoop;
                            };
                            if (not bounds.lowerOk) {
                                nextEntry := iter.next();
                                continue scanLoop;
                            };
                        };
                        case (#bwd) {
                            if (not bounds.lowerOk) {
                                break scanLoop;
                            };
                            if (not bounds.upperOk) {
                                nextEntry := iter.next();
                                continue scanLoop;
                            };
                        };
                    };

                    count += 1;
                    nextEntry := iter.next();
                };
            };
        };

        count;
    };

    public func cmpStoreKey<K>(cmpK : (K, K) -> Order.Order) : (((K, Nat64), (K, Nat64)) -> Order.Order) {
        Tuples.Tuple2.makeCompare(cmpK, Nat64.compare);
    };

    // Spec §Indexes: insert while enforcing retention eviction on Set<(K,PK)> store.
    public func insertWithRetention<K>(
        idx : SecIndex<K>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        keep : Keep,
        storeKey : (K, Nat64)
    ) : () {
        switch (keep) {
            case (#all) {
                ignore Set.insert(idx, cmpStore, storeKey);
            };
            case (#top(n)) {
                if (n == 0) return ();
                if (Set.size(idx) < n) {
                    ignore Set.insert(idx, cmpStore, storeKey);
                    return;
                };
                switch (Set.min(idx)) {
                    case null {
                        ignore Set.insert(idx, cmpStore, storeKey);
                    };
                    case (?minKey) {
                        switch (cmpStore(storeKey, minKey)) {
                            case (#greater) {
                                ignore Set.insert(idx, cmpStore, storeKey);
                                ignore Set.delete(idx, cmpStore, minKey);
                            };
                            case _ {};
                        };
                    };
                };
            };
            case (#bottom(n)) {
                if (n == 0) return ();
                if (Set.size(idx) < n) {
                    ignore Set.insert(idx, cmpStore, storeKey);
                    return;
                };
                switch (Set.max(idx)) {
                    case null {
                        ignore Set.insert(idx, cmpStore, storeKey);
                    };
                    case (?maxKey) {
                        switch (cmpStore(storeKey, maxKey)) {
                            case (#less) {
                                ignore Set.insert(idx, cmpStore, storeKey);
                                ignore Set.delete(idx, cmpStore, maxKey);
                            };
                            case _ {};
                        };
                    };
                };
            };
        };
    };

    public func deleteKey<K>(
        idx : SecIndex<K>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        storeKey : (K, Nat64)
    ) : () {
        ignore Set.delete(idx, cmpStore, storeKey);
    };

    public func makeRange<K>(
        dir : Direction,
        gt : ?K,
        gte : ?K,
        lt : ?K,
        lte : ?K
    ) : Range<K> {
        {
            gt;
            gte;
            lt;
            lte;
            dir;
        };
    };

    // Spec §Indexes/#Cursors: forward/backward range scan over composite store keys with PK tiebreaker.
    public func scanRangeMeta<K>(
        idx : SecIndex<K>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        cmpKey : (K, K) -> Order.Order,
        hasRow : Nat64 -> Bool,
        range : Range<K>,
        limit : Nat,
        after : ?((K, Nat64))
    ) : RangeMeta<K> {
        if (limit == 0) {
            return { last = null; hasMore = false };
        };

        let iter = switch (range.dir) {
            case (#fwd) {
                switch (range.gte) {
                    case (?k) { Set.valuesFrom(idx, cmpStore, (k, Nat64.fromNat(0))) };
                    case null {
                        switch (range.gt) {
                            case (?k) { Set.valuesFrom(idx, cmpStore, (k, Nat64.fromNat(0))) };
                            case null { Set.values(idx) };
                        };
                    };
                };
            };
            case (#bwd) {
                switch (range.lte) {
                    case (?k) { Set.reverseValuesFrom(idx, cmpStore, (k, Nat64.maxValue)) };
                    case null {
                        switch (range.lt) {
                            case (?k) { Set.reverseValuesFrom(idx, cmpStore, (k, Nat64.maxValue)) };
                            case null { Set.reverseValues(idx) };
                        };
                    };
                };
            };
        };

        var last : ?(K, Nat64) = null;
        var count : Nat = 0;
        var hasMore = false;

        var nextEntry = iter.next();
        var skip = after;
        label scanLoop while (true) {
            switch (nextEntry) {
                case null {
                    break scanLoop;
                };
                case (?storeKey) {
                    let (k, slot) = storeKey;

                    switch (skip) {
                        case (?boundary) {
                            let cmpWithBoundary = cmpStore((k, slot), boundary);
                            switch (range.dir) {
                                case (#fwd) {
                                    if (cmpWithBoundary != #greater) {
                                        nextEntry := iter.next();
                                        continue scanLoop;
                                    };
                                };
                                case (#bwd) {
                                    if (cmpWithBoundary != #less) {
                                        nextEntry := iter.next();
                                        continue scanLoop;
                                    };
                                };
                            };
                            skip := null;
                        };
                        case null {};
                    };

                    let bounds = evaluateBounds(range, cmpKey, k);
                    let lowerOk = bounds.lowerOk;
                    let upperOk = bounds.upperOk;

                    switch (range.dir) {
                        case (#fwd) {
                            if (not upperOk) {
                                break scanLoop;
                            };
                            if (not lowerOk) {
                                nextEntry := iter.next();
                                continue scanLoop;
                            };
                        };
                        case (#bwd) {
                            if (not lowerOk) {
                                break scanLoop;
                            };
                            if (not upperOk) {
                                nextEntry := iter.next();
                                continue scanLoop;
                            };
                        };
                    };

                    if (hasRow(slot)) {
                        count += 1;
                        last := ?(k, slot);
                    };

                    if (count >= limit) {
                        var probe = iter.next();
                        label probeLoop while (true) {
                            switch (probe) {
                                case null {
                                    hasMore := false;
                                    break probeLoop;
                                };
                                case (?nextStoreKey) {
                                    let (nextKey, nextSlot) = nextStoreKey;
                                    let nextBounds = evaluateBounds(range, cmpKey, nextKey);
                                    switch (range.dir) {
                                        case (#fwd) {
                                            if (not nextBounds.upperOk) {
                                                hasMore := false;
                                                break probeLoop;
                                            };
                                            if (not nextBounds.lowerOk) {
                                                probe := iter.next();
                                                continue probeLoop;
                                            };
                                        };
                                        case (#bwd) {
                                            if (not nextBounds.lowerOk) {
                                                hasMore := false;
                                                break probeLoop;
                                            };
                                            if (not nextBounds.upperOk) {
                                                probe := iter.next();
                                                continue probeLoop;
                                            };
                                        };
                                    };
                                    if (hasRow(nextSlot)) {
                                        hasMore := true;
                                        break probeLoop;
                                    } else {
                                            probe := iter.next();
                                            continue probeLoop;
                                    };
                                };
                            };
                        };
                        break scanLoop;
                    };

                    nextEntry := iter.next();
                };
            };
        };

        { last; hasMore };
    };

    func evaluateBounds<K>(
        range : Range<K>,
        cmpKey : (K, K) -> Order.Order,
        key : K
    ) : Bounds {
        let passesGt = switch (range.gt) {
            case null true;
            case (?bound) {
                switch (cmpKey(key, bound)) {
                    case (#greater) true;
                    case _ false;
                };
            };
        };

        let passesGte = switch (range.gte) {
            case null true;
            case (?bound) {
                switch (cmpKey(key, bound)) {
                    case (#less) false;
                    case _ true;
                };
            };
        };

        let passesLt = switch (range.lt) {
            case null true;
            case (?bound) {
                switch (cmpKey(key, bound)) {
                    case (#less) true;
                    case _ false;
                };
            };
        };

        let passesLte = switch (range.lte) {
            case null true;
            case (?bound) {
                switch (cmpKey(key, bound)) {
                    case (#greater) false;
                    case _ true;
                };
            };
        };

        {
            lowerOk = passesGt and passesGte;
            upperOk = passesLt and passesLte;
        };
    };
}
