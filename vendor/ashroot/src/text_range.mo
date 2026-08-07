import Char "mo:core/Char";
import Text "mo:core/Text";

import IndexCore "./index_core";
import IndexRuntime "./index_runtime";

module {
    // Spec §Indexes: compute Text prefix bounds once to reuse across tables.
    public func prefixRange(prefix : Text, dir : IndexCore.Direction) : IndexRuntime.IndexRange<Text> {
        let maxSuffixChar = Text.fromChar(Char.fromNat32(0x10FFFF));
        if (Text.size(prefix) == 0) {
            {
                gt = null;
                gte = null;
                lt = null;
                lte = null;
                dir;
            };
        } else {
            {
                gt = null;
                gte = ?prefix;
                lt = ?(prefix # maxSuffixChar);
                lte = null;
                dir;
            };
        };
    };
}
