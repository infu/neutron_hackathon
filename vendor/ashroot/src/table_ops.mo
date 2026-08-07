import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Iter "mo:core/Iter";

import IndexCore "./index_core";
module {
    public type Common<Doc, Create, Err, Pk> = {
        insert : Create -> Result.Result<Pk, Err>;
        insertMany : [Create] -> Result.Result<[Pk], Err>;
        update : Doc -> Result.Result<Doc, Err>;
        upsert : Doc -> Result.Result<{ #inserted; #updated }, Err>;
        upsertMany : [Doc] -> Result.Result<{ inserted : Nat; updated : Nat }, Err>;
        get : Pk -> ?Doc;
        getMany : [Pk] -> [(Pk, ?Doc)];
        exists : Pk -> Bool;
        delete : Pk -> Result.Result<(), Err>;
        deleteMany : [Pk] -> Result.Result<Nat, Err>;
        size : () -> Nat;
        iterPrimary : (IndexCore.Direction, ?Pk) -> Iter.Iter<(Pk, Doc)>;
        iter : (IndexCore.Direction) -> Iter.Iter<Doc>;
        map : <R>(IndexCore.Direction, Doc -> R) -> Iter.Iter<R>;
        fold : <A>(IndexCore.Direction, A, (A, Doc) -> A) -> A;
    };
}
