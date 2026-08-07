import Relations "./relations";

module {
    public type Bundle<TUse, Doc, Create, Err> = {
        table : TUse;
        relations : Relations.Bundle<Doc, Create, Err>;
        relationsInternal : Relations.RuntimeBundle<Doc, Create, Err>;
    };
}
