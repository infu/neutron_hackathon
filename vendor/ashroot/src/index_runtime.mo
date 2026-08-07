import Array "mo:core/Array";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Order "mo:core/Order";
import Result "mo:core/Result";
import Set "mo:core/Set";
import Text "mo:core/Text";

import Cursors "./cursors";
import IndexCore "./index_core";

module {
    func emptyIter<V>() : Iter.Iter<V> = {
        next = func () : ?V { null };
    };
    public type IndexRange<K> = {
        gt : ?K;
        gte : ?K;
        lt : ?K;
        lte : ?K;
        dir : IndexCore.Direction;
    };

    public type RangeDeleteResult = {
        deleted : Nat;
        cursor : ?Cursors.Token;
        hasMore : Bool;
    };

    public type RowStore<V> = {
        get : Nat64 -> ?V;
        has : Nat64 -> Bool;
    };

    public type IndexDescriptor<K> = {
        name : Text;
        keep : IndexCore.Keep;
        cmpKey : (K, K) -> Order.Order;
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order);
    };

    public type IndexOps<K, V, E> = {
        descriptor : IndexDescriptor<K>;
        find : (IndexCore.Direction, K, Nat) -> Iter.Iter<V>;
        rangeDelete : (IndexRange<K>, Nat, ?Cursors.Token) -> Result.Result<RangeDeleteResult, E>;
        exists : K -> Bool;
        locate : K -> ?Nat64;
        countInRange : (IndexRange<K>, ?Nat) -> Nat;
        size : () -> Nat;
        rangeIter : (IndexRange<K>, ?Cursors.Token) -> Iter.Iter<V>;
        mapRange : <R>(IndexRange<K>, V -> R) -> Iter.Iter<R>;
        foldRange : <A>(IndexRange<K>, A, (A, V) -> A) -> A;
    };

    public func rangeToIndexCore<K>(range : IndexRange<K>) : IndexCore.Range<K> {
        IndexCore.makeRange<K>(range.dir, range.gt, range.gte, range.lt, range.lte);
    };

    public func cursorAfter<K>(
        range : IndexRange<K>,
        cursor : ?Cursors.Token,
        decode : Cursors.Token -> ?(K, Nat64)
    ) : ?(K, Nat64) {
        switch (cursor) {
            case (?tok) {
                if (tok.dir == range.dir) {
                    decode(tok);
                } else {
                    null;
                };
            };
            case null null;
        };
    };

    func buildCursorFromLast<K>(
        range : IndexRange<K>,
        encode : (IndexCore.Direction, (K, Nat64)) -> Cursors.Token,
        last : ?(K, Nat64),
        hasMore : Bool
    ) : ?Cursors.Token {
        if (hasMore) {
            switch (last) {
                case (?storeKey) { ?encode(range.dir, storeKey) };
                case null null;
            };
        } else {
            null;
        };
    };

    public func runRangeDelete<K, V, E>(
        rows : RowStore<V>,
        idx : Set.Set<(K, Nat64)>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        cmpKey : (K, K) -> Order.Order,
        range : IndexRange<K>,
        limit : Nat,
        cursor : ?Cursors.Token,
        decode : Cursors.Token -> ?(K, Nat64),
        encode : (IndexCore.Direction, (K, Nat64)) -> Cursors.Token,
        deleteDoc : (Nat64, V) -> Result.Result<(), E>
    ) : Result.Result<RangeDeleteResult, E> {
        if (limit == 0) {
            return #ok({ deleted = 0; cursor = null; hasMore = false });
        };

        let idxRange = rangeToIndexCore(range);
        let after = cursorAfter<K>(range, cursor, decode);
        let startSeed = switch (after) {
            case (?boundary) ?boundary;
            case null setRangeSeed(range);
        };

        let iter = stableSetIter(idx, cmpStore, idxRange.dir, startSeed);
        let targets = List.empty<(K, Nat64)>();
        var skip = after;
        var pending = iter.next();
        var selected : Nat = 0;
        var last : ?(K, Nat64) = null;
        var finished = false;

        label collect while (not finished and selected < limit) {
            switch (pending) {
                case null {
                    finished := true;
                };
                case (?storeKey) {
                    let (k, pk) = storeKey;

                    switch (skip) {
                        case (?boundary) {
                            let cmpWithBoundary = cmpStore((k, pk), boundary);
                            switch (idxRange.dir) {
                                case (#fwd) {
                                    if (cmpWithBoundary != #greater) {
                                        pending := iter.next();
                                        continue collect;
                                    };
                                };
                                case (#bwd) {
                                    if (cmpWithBoundary != #less) {
                                        pending := iter.next();
                                        continue collect;
                                    };
                                };
                            };
                            skip := null;
                        };
                        case null {};
                    };

                    let bounds = evaluateBounds(range, cmpKey, k);

                    switch (idxRange.dir) {
                        case (#fwd) {
                            if (not bounds.upperOk) {
                                finished := true;
                                pending := null;
                                continue collect;
                            };
                            if (not bounds.lowerOk) {
                                pending := iter.next();
                                continue collect;
                            };
                        };
                        case (#bwd) {
                            if (not bounds.lowerOk) {
                                finished := true;
                                pending := null;
                                continue collect;
                            };
                            if (not bounds.upperOk) {
                                pending := iter.next();
                                continue collect;
                            };
                        };
                    };

                    List.add(targets, storeKey);
                    selected += 1;
                    last := ?storeKey;
                    pending := iter.next();
                };
            };
        };

        let hasMore = switch (pending) {
            case null false;
            case (?nextStoreKey) {
                let (nextKey, _) = nextStoreKey;
                let bounds = evaluateBounds(range, cmpKey, nextKey);
                bounds.lowerOk and bounds.upperOk;
            };
        };

        var deleted : Nat = 0;
        for (storeKey in List.values(targets)) {
            let (_, slot) = storeKey;
            switch (rows.get(slot)) {
                case null {};
                case (?row) {
                    switch (deleteDoc(slot, row)) {
                        case (#ok()) { deleted += 1; };
                        case (#err(e)) { return #err(e); };
                    };
                };
            };
        };
        #ok({
            deleted;
            cursor = buildCursorFromLast(range, encode, last, hasMore);
            hasMore;
        });
    };

    func evaluateBounds<K>(
        range : IndexRange<K>,
        cmpKey : (K, K) -> Order.Order,
        key : K
    ) : { lowerOk : Bool; upperOk : Bool } {
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

    func rangeIsUnbounded<K>(range : IndexRange<K>) : Bool {
        switch (range.gt, range.gte, range.lt, range.lte) {
            case (null, null, null, null) true;
            case _ false;
        };
    };

    func rangeSingleKey<K>(
        range : IndexRange<K>,
        cmpKey : (K, K) -> Order.Order
    ) : ?K {
        switch (range.gt, range.gte, range.lt, range.lte) {
            case (null, ?gteKey, null, ?lteKey) {
                switch (cmpKey(gteKey, lteKey)) {
                    case (#equal) ?gteKey;
                    case _ null;
                };
            };
            case _ null;
        };
    };

    public func indexKeyExists<K, V>(
        idx : Set.Set<(K, Nat64)>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        cmpKey : (K, K) -> Order.Order,
        key : K,
        rows : RowStore<V>
    ) : Bool {
        let iter = Set.valuesFrom(idx, cmpStore, (key, Nat64.fromNat(0)));
        switch (iter.next()) {
            case (?candidate) {
                let (candidateKey, slot) = candidate;
                switch (cmpKey(candidateKey, key)) {
                    case (#equal) rows.has(slot);
                    case _ false;
                };
            };
            case null false;
        };
    };

    // Return the first primary key whose index key equals `key` without
    // materializing any indexed document.
    public func indexLocate<K, V>(
        idx : Set.Set<(K, Nat64)>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        cmpKey : (K, K) -> Order.Order,
        key : K,
        rows : RowStore<V>,
        projectPk : V -> Nat64
    ) : ?Nat64 {
        indexKeyConflict<K, V>(idx, cmpStore, cmpKey, rows, projectPk, key, null);
    };

    func isSkip(pk : Nat64, skipPk : ?Nat64) : Bool {
        switch (skipPk) {
            case (?s) { Nat64.compare(pk, s) == #equal };
            case null false;
        };
    };

    public func indexKeyConflict<K, V>(
        idx : Set.Set<(K, Nat64)>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        cmpKey : (K, K) -> Order.Order,
        rows : RowStore<V>,
        projectPk : V -> Nat64,
        key : K,
        skipPk : ?Nat64
    ) : ?Nat64 {
        let iter = Set.valuesFrom(idx, cmpStore, (key, Nat64.fromNat(0)));
        var nextEntry = iter.next();
        label scanLoop while (true) {
            switch (nextEntry) {
                case null { return null; };
                case (?candidate) {
                    let (candidateKey, slot) = candidate;
                    switch (cmpKey(candidateKey, key)) {
                        case (#equal) {
                            switch (rows.get(slot)) {
                                case null {
                                    nextEntry := iter.next();
                                    continue scanLoop;
                                };
                                case (?doc) {
                                    let pk = projectPk(doc);
                                    if (isSkip(pk, skipPk)) {
                                        nextEntry := iter.next();
                                        continue scanLoop;
                                    };
                                    return ?pk;
                                };
                            };
                        };
                        case (#greater) {
                            return null;
                        };
                        case (#less) {
                            nextEntry := iter.next();
                        };
                    };
                };
            };
        };
        null;
    };

    func coversEntireIndex<K>(
        idx : Set.Set<(K, Nat64)>,
        cmpKey : (K, K) -> Order.Order,
        range : IndexRange<K>
    ) : Bool {
        switch (Set.min(idx), Set.max(idx)) {
            case (null, _) true;
            case (_, null) true;
            case (?minEntry, ?maxEntry) {
                let minKey = minEntry.0;
                let maxKey = maxEntry.0;

                func lowerMatches() : Bool {
                    switch (range.gt, range.gte) {
                        case (?_, _) false;
                        case (null, null) true;
                        case (null, ?key) { cmpKey(key, minKey) == #equal };
                    };
                };

                func upperMatches() : Bool {
                    switch (range.lt, range.lte) {
                        case (?_, _) false;
                        case (null, null) true;
                        case (null, ?key) { cmpKey(key, maxKey) == #equal };
                    };
                };

                lowerMatches() and upperMatches();
            };
        };
    };

    public func indexCountRange<K>(
        idx : Set.Set<(K, Nat64)>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        cmpKey : (K, K) -> Order.Order,
        range : IndexRange<K>,
        limit : ?Nat
    ) : Nat {
        let size = Set.size(idx);
        if (size == 0) {
            return 0;
        };
        if (coversEntireIndex(idx, cmpKey, range)) {
            return switch (limit) {
                case null size;
                case (?cap) Nat.min(size, cap);
            };
        };
        IndexCore.countRange<K>(idx, cmpStore, cmpKey, rangeToIndexCore(range), limit);
    };

    type Bound<K> = { value : K; exclusive : Bool };

    func upperBound<K>(range : IndexRange<K>) : ?Bound<K> {
        switch (range.lt) {
            case (?val) ?{ value = val; exclusive = true };
            case null {
                switch (range.lte) {
                    case (?val) ?{ value = val; exclusive = false };
                    case null null;
                };
            };
        };
    };

    public func makeRangeIter<K, V>(
        rows : RowStore<V>,
        idx : Set.Set<(K, Nat64)>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        cmpKey : (K, K) -> Order.Order,
        range : IndexRange<K>,
        cursor : ?Cursors.Token,
        decode : Cursors.Token -> ?(K, Nat64)
    ) : Iter.Iter<V> {
        let idxRange = rangeToIndexCore(range);
        let startAfter = cursorAfter<K>(range, cursor, decode);

        let rawIter = switch (startAfter) {
            case (?boundary) {
                switch (idxRange.dir) {
                    case (#fwd) Set.valuesFrom(idx, cmpStore, boundary);
                    case (#bwd) Set.reverseValuesFrom(idx, cmpStore, boundary);
                };
            };
            case null {
                makeStoreIter(idx, cmpStore, idxRange);
            };
        };

        var pending = rawIter.next();
        var skip = startAfter;
        var finished = false;

        let upper = upperBound(range);
        let hasForwardLower = switch (range.gt, range.gte) {
            case (?_, _) true;
            case (_, ?_) true;
            case _ false;
        };
        let hasBackwardUpper = switch (range.lt, range.lte) {
            case (?_, _) true;
            case (_, ?_) true;
            case _ false;
        };
        let hasCursor = switch (startAfter) {
            case null false;
            case (?_) true;
        };
        var enforceForwardLower = idxRange.dir == #fwd and not hasCursor and hasForwardLower;
        var enforceBackwardUpper = idxRange.dir == #bwd and not hasCursor and hasBackwardUpper;

        func satisfiesForwardLower(key : K) : Bool {
            switch (range.gt) {
                case (?bound) {
                    cmpKey(key, bound) == #greater;
                };
                case null {
                    switch (range.gte) {
                        case (?bound) {
                            cmpKey(key, bound) != #less;
                        };
                        case null true;
                    };
                };
            };
        };

        func violatesForwardUpper(key : K) : Bool {
            switch (upper) {
                case null false;
                case (?bound) {
                    let cmp = cmpKey(key, bound.value);
                    if (bound.exclusive) {
                        cmp != #less;
                    } else {
                        cmp == #greater;
                    };
                };
            };
        };

        func satisfiesBackwardUpper(key : K) : Bool {
            switch (range.lt) {
                case (?bound) {
                    cmpKey(key, bound) == #less;
                };
                case null {
                    switch (range.lte) {
                        case (?bound) {
                            cmpKey(key, bound) != #greater;
                        };
                        case null true;
                    };
                };
            };
        };

        func violatesBackwardLower(key : K) : Bool {
            switch (range.gt) {
                case (?bound) {
                    cmpKey(key, bound) != #greater;
                };
                case null {
                    switch (range.gte) {
                        case (?bound) {
                            cmpKey(key, bound) == #less;
                        };
                        case null false;
                    };
                };
            };
        };

        func advanceForward() : ?V {
            label scan while (true) {
                switch (pending) {
                    case null {
                        finished := true;
                        return null;
                    };
                    case (?storeKey) {
                        let (k, slot) = storeKey;

                        switch (skip) {
                            case (?boundary) {
                                let cmpWithBoundary = cmpStore((k, slot), boundary);
                                if (cmpWithBoundary != #greater) {
                                    pending := rawIter.next();
                                    continue scan;
                                };
                                skip := null;
                        };
                        case null {};
                    };

                    if (enforceForwardLower) {
                        if (not satisfiesForwardLower(k)) {
                            pending := rawIter.next();
                            continue scan;
                        };
                        enforceForwardLower := false;
                    };

                    if (violatesForwardUpper(k)) {
                        finished := true;
                        pending := null;
                        return null;
                    };

                    switch (rows.get(slot)) {
                        case null {
                            pending := rawIter.next();
                            continue scan;
                            };
                            case (?row) {
                                pending := rawIter.next();
                                return ?row;
                            };
                        };
                    };
                };
            };
            return null;
        };

        func advanceBackward() : ?V {
            label scan while (true) {
                switch (pending) {
                    case null {
                        finished := true;
                        return null;
                    };
                    case (?storeKey) {
                        let (k, slot) = storeKey;

                        switch (skip) {
                            case (?boundary) {
                                let cmpWithBoundary = cmpStore((k, slot), boundary);
                                if (cmpWithBoundary != #less) {
                                    pending := rawIter.next();
                                    continue scan;
                                };
                                skip := null;
                        };
                        case null {};
                    };

                    if (enforceBackwardUpper) {
                        if (not satisfiesBackwardUpper(k)) {
                            pending := rawIter.next();
                            continue scan;
                        };
                        enforceBackwardUpper := false;
                    };

                    if (violatesBackwardLower(k)) {
                        finished := true;
                        pending := null;
                        return null;
                    };

                    switch (rows.get(slot)) {
                        case null {
                            pending := rawIter.next();
                            continue scan;
                            };
                            case (?row) {
                                pending := rawIter.next();
                                return ?row;
                            };
                        };
                    };
                };
            };
            return null;
        };

        func nextValue() : ?V {
            if (finished) {
                return null;
            };
            switch (idxRange.dir) {
                case (#fwd) advanceForward();
                case (#bwd) advanceBackward();
            };
        };

        {
            next = func () : ?V {
                nextValue();
            };
        };
    };

    public func foldFromIter<V, A>(iter : Iter.Iter<V>, init : A, f : (A, V) -> A) : A {
        var acc = init;
        for (value in iter) {
            acc := f(acc, value);
        };
        acc;
    };

    public func limitIter<V>(iter : Iter.Iter<V>, limit : Nat) : Iter.Iter<V> {
        if (limit == 0) {
            return emptyIter<V>();
        };
        var remaining = limit;
        {
            next = func () : ?V {
                if (remaining == 0) {
                    return null;
                };
                switch (iter.next()) {
                    case (?value) {
                        remaining -= 1;
                        ?value;
                    };
                    case null null;
                };
            };
        };
    };

    func makeStoreIter<K>(
        idx : Set.Set<(K, Nat64)>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        idxRange : IndexCore.Range<K>
    ) : Iter.Iter<(K, Nat64)> {
        switch (idxRange.dir) {
            case (#fwd) {
                switch (idxRange.gte) {
                    case (?k) Set.valuesFrom(idx, cmpStore, (k, Nat64.fromNat(0)));
                    case null {
                        switch (idxRange.gt) {
                            case (?k) Set.valuesFrom(idx, cmpStore, (k, Nat64.fromNat(0)));
                            case null Set.values(idx);
                        };
                    };
                };
            };
            case (#bwd) {
                switch (idxRange.lte) {
                    case (?k) Set.reverseValuesFrom(idx, cmpStore, (k, Nat64.maxValue));
                    case null {
                        switch (idxRange.lt) {
                            case (?k) Set.reverseValuesFrom(idx, cmpStore, (k, Nat64.maxValue));
                            case null Set.reverseValues(idx);
                        };
                    };
                };
            };
        };
    };

    func setRangeSeed<K>(range : IndexRange<K>) : ?(K, Nat64) {
        switch (range.dir) {
            case (#fwd) {
                switch (range.gte) {
                    case (?k) ?(k, Nat64.fromNat(0));
                    case null {
                        switch (range.gt) {
                            case (?k) ?(k, Nat64.fromNat(0));
                            case null null;
                        };
                    };
                };
            };
            case (#bwd) {
                switch (range.lte) {
                    case (?k) ?(k, Nat64.maxValue);
                    case null {
                        switch (range.lt) {
                            case (?k) ?(k, Nat64.maxValue);
                            case null null;
                        };
                    };
                };
            };
        };
    };

    func stableSetIter<K>(
        idx : Set.Set<(K, Nat64)>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        dir : IndexCore.Direction,
        start : ?(K, Nat64)
    ) : Iter.Iter<(K, Nat64)> {
        var nextSeed = start;
        var seedExclusive = false;
        var exhausted = false;

        func skipForward(iter : Iter.Iter<(K, Nat64)>, boundary : (K, Nat64)) : ?(K, Nat64) {
            var candidate = iter.next();
            label drop while (true) {
                switch (candidate) {
                    case null return null;
                    case (?entry) {
                        switch (cmpStore(entry, boundary)) {
                            case (#less) {
                                candidate := iter.next();
                                continue drop;
                            };
                            case (#equal) {
                                candidate := iter.next();
                                continue drop;
                            };
                            case (#greater) return ?entry;
                        };
                    };
                };
            };
            null;
        };

        func skipBackward(iter : Iter.Iter<(K, Nat64)>, boundary : (K, Nat64)) : ?(K, Nat64) {
            var candidate = iter.next();
            label drop while (true) {
                switch (candidate) {
                    case null return null;
                    case (?entry) {
                        switch (cmpStore(entry, boundary)) {
                            case (#greater) {
                                candidate := iter.next();
                                continue drop;
                            };
                            case (#equal) {
                                candidate := iter.next();
                                continue drop;
                            };
                            case (#less) return ?entry;
                        };
                    };
                };
            };
            null;
        };

        func nextForward() : ?(K, Nat64) {
            let iter = switch (nextSeed) {
                case (?seed) Set.valuesFrom(idx, cmpStore, seed);
                case null Set.values(idx);
            };
            if (seedExclusive) {
                switch (nextSeed) {
                    case (?boundary) return skipForward(iter, boundary);
                    case null seedExclusive := false;
                };
            };
            iter.next();
        };

        func nextBackward() : ?(K, Nat64) {
            let iter = switch (nextSeed) {
                case (?seed) Set.reverseValuesFrom(idx, cmpStore, seed);
                case null Set.reverseValues(idx);
            };
            if (seedExclusive) {
                switch (nextSeed) {
                    case (?boundary) return skipBackward(iter, boundary);
                    case null seedExclusive := false;
                };
            };
            iter.next();
        };

        {
            next = func () : ?(K, Nat64) {
                if (exhausted) {
                    return null;
                };
                let candidate = switch (dir) {
                    case (#fwd) nextForward();
                    case (#bwd) nextBackward();
                };
                switch (candidate) {
                    case null {
                        exhausted := true;
                        null;
                    };
                    case (?entry) {
                        nextSeed := ?entry;
                        seedExclusive := true;
                        ?entry;
                    };
                };
            };
        };
    };

    public func makeFindIter<K, V>(
        rows : RowStore<V>,
        idx : Set.Set<(K, Nat64)>,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        cmpKey : (K, K) -> Order.Order,
        dir : IndexCore.Direction,
        start : K,
        limit : Nat
    ) : Iter.Iter<V> {
        if (limit == 0) {
            return emptyIter<V>();
        };
        let range : IndexRange<K> = {
            gt = null;
            gte = ?start;
            lt = null;
            lte = null;
            dir;
        };
        let iter = makeRangeIter<K, V>(rows, idx, cmpStore, cmpKey, range, null, func (_ : Cursors.Token) : ?(K, Nat64) {
            null;
        });
        limitIter(iter, limit);
    };

    public func makeDescriptor<K>(
        name : Text,
        keep : IndexCore.Keep,
        cmpKey : (K, K) -> Order.Order,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order)
    ) : IndexDescriptor<K> {
        {
            name;
            keep;
            cmpKey;
            cmpStore;
        };
    };

    public func makeIndexOps<K, V, E>(
        name : Text,
        idx : Set.Set<(K, Nat64)>,
        cmpKey : (K, K) -> Order.Order,
        cmpStore : (((K, Nat64), (K, Nat64)) -> Order.Order),
        keep : IndexCore.Keep,
        rows : RowStore<V>,
        projectPk : V -> Nat64,
        decode : Cursors.Token -> ?(K, Nat64),
        encode : (IndexCore.Direction, (K, Nat64)) -> Cursors.Token,
        findStart : (IndexCore.Direction, K, Nat) -> Iter.Iter<V>,
        deleteDoc : (Nat64, V) -> Result.Result<(), E>
    ) : IndexOps<K, V, E> {
        let descriptor = makeDescriptor<K>(name, keep, cmpKey, cmpStore);

        {
            descriptor;
            find = findStart;
            rangeDelete = func (range : IndexRange<K>, limit : Nat, cursor : ?Cursors.Token) : Result.Result<RangeDeleteResult, E> {
                runRangeDelete<K, V, E>(rows, idx, cmpStore, cmpKey, range, limit, cursor, decode, encode, deleteDoc);
            };
            exists = func (key : K) : Bool {
                indexKeyExists<K, V>(idx, cmpStore, cmpKey, key, rows);
            };
            locate = func (key : K) : ?Nat64 {
                indexLocate<K, V>(idx, cmpStore, cmpKey, key, rows, projectPk);
            };
            countInRange = func (range : IndexRange<K>, limitOpt : ?Nat) : Nat {
                indexCountRange<K>(idx, cmpStore, cmpKey, range, limitOpt);
            };
            size = func () : Nat {
                Set.size(idx);
            };
            rangeIter = func (range : IndexRange<K>, cursor : ?Cursors.Token) : Iter.Iter<V> {
                makeRangeIter<K, V>(rows, idx, cmpStore, cmpKey, range, cursor, decode);
            };
            mapRange = func <R>(range : IndexRange<K>, f : V -> R) : Iter.Iter<R> {
                let base = makeRangeIter<K, V>(rows, idx, cmpStore, cmpKey, range, null, decode);
                {
                    next = func () : ?R {
                        switch (base.next()) {
                            case (?value) ?f(value);
                            case null null;
                        };
                    };
                };
            };
            foldRange = func <A>(range : IndexRange<K>, init : A, f : (A, V) -> A) : A {
                let iter = makeRangeIter<K, V>(rows, idx, cmpStore, cmpKey, range, null, decode);
                foldFromIter(iter, init, f);
            };
        };
    };
}
