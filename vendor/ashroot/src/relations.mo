import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Result "mo:core/Result";

module {
    public type DeletePolicy = { #cascade; #restrict; #setNull };

    type ForeignKeyCommon<Doc, Create, Err> = {
        field : Text;
        parentTable : Text;
        notNull : Bool;
        onDelete : DeletePolicy;
        installParentExists : ((Nat64) -> Bool) -> ();
        validateCreate : Create -> Result.Result<(), Err>;
        validateDoc : Doc -> Result.Result<(), Err>;
        formatError : Err -> Text;
    };

    public type ForeignKeyManager<Doc, Create, Err> = ForeignKeyCommon<Doc, Create, Err>;

    public type ForeignKeyRuntime<Doc, Create, Err> = ForeignKeyCommon<Doc, Create, Err> and {
        countDependents : Nat64 -> Nat;
        deleteDependents : Nat64 -> Result.Result<(), Err>;
        setNullDependents : Nat64 -> Result.Result<(), Err>;
    };

    public type Bundle<Doc, Create, Err> = { foreignKeys : [ForeignKeyManager<Doc, Create, Err>] };
    public type RuntimeBundle<Doc, Create, Err> = { foreignKeys : [ForeignKeyRuntime<Doc, Create, Err>] };
}
