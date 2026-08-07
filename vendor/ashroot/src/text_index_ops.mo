import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Result "mo:core/Result";
import Iter "mo:core/Iter";

import IndexRuntime "./index_runtime";
import IndexCore "./index_core";
import Cursors "./cursors";

module {
    public type Ops<Doc, Err> = {
        descriptor : IndexRuntime.IndexDescriptor<Text>;
        find : (IndexCore.Direction, Text, Nat) -> Iter.Iter<Doc>;
        rangeDelete : (IndexRuntime.IndexRange<Text>, Nat, ?Cursors.Token) -> Result.Result<IndexRuntime.RangeDeleteResult, Err>;
        exists : Text -> Bool;
        locate : Text -> ?Nat64;
        countInRange : (IndexRuntime.IndexRange<Text>, ?Nat) -> Nat;
        size : () -> Nat;
        rangeIter : (IndexRuntime.IndexRange<Text>, ?Cursors.Token) -> Iter.Iter<Doc>;
        mapRange : <R>(IndexRuntime.IndexRange<Text>, Doc -> R) -> Iter.Iter<R>;
        foldRange : <A>(IndexRuntime.IndexRange<Text>, A, (A, Doc) -> A) -> A;
        prefixFind : (IndexCore.Direction, Text, Nat) -> Iter.Iter<Doc>;
    };
}
