import Iter "mo:core/Iter";

import IndexCore "./index_core";
import IndexRuntime "./index_runtime";
import QueryDirection "./query_direction";

module {
    public func passes<Doc, Filter>(doc : Doc, filters : [Filter], matches : (Doc, Filter) -> Bool) : Bool {
        for (f in filters.vals()) {
            if (not matches(doc, f)) {
                return false;
            };
        };
        true;
    };

    public func drain<V>(iter : Iter.Iter<V>, handle : V -> Bool) : () {
        label scan while (true) {
            switch (iter.next()) {
                case null { break scan };
                case (?value) {
                    if (handle(value)) { break scan };
                };
            };
        };
    };

    public func makeRange<K>(
        dir : QueryDirection.OrderDirection,
        from : ?K,
        iterDir : IndexCore.Direction,
    ) : IndexRuntime.IndexRange<K> {
        {
            gt = switch (dir) { case (#asc) from; case (#desc) null };
            gte = null;
            lt = switch (dir) { case (#desc) from; case (#asc) null };
            lte = null;
            dir = iterDir;
        };
    };
}
