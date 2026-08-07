import Iter "mo:core/Iter";
import List "mo:core/List";

import IndexCore "./index_core";

module {
    public func make<Doc>(rows : List.List<?Doc>) : (IndexCore.Direction) -> Iter.Iter<Doc> {
        func build(dir : IndexCore.Direction) : Iter.Iter<Doc> {
            let raw = switch (dir) {
                case (#fwd) List.values(rows);
                case (#bwd) List.reverseValues(rows);
            };

            func nextDoc() : ?Doc {
                label scan while (true) {
                    switch (raw.next()) {
                        case null { return null };
                        case (?entry) {
                            switch (entry) {
                                case (?doc) { return ?doc };
                                case null { continue scan };
                            };
                        };
                    };
                };
                null;
            };

            {
                next = func () : ?Doc { nextDoc() };
            };
        };

        func iter(dir : IndexCore.Direction) : Iter.Iter<Doc> {
            build(dir);
        };

        iter;
    };
}
