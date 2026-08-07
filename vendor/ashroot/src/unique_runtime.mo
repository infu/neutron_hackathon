module {
    public type FieldChange<T> = {
        changed : Bool;
        prev : T;
        next : T;
    };

    public type UniqueChange<Fields> = {
        changed : Bool;
        fields : Fields;
    };

    public func required<Doc, Key>(
        prev : Doc,
        next : Doc,
        extract : (Doc) -> Key,
        compare : (Key, Key) -> { #less; #equal; #greater },
    ) : FieldChange<Key> {
        let prevKey = extract(prev);
        let nextKey = extract(next);
        {
            changed = compare(prevKey, nextKey) != #equal;
            prev = prevKey;
            next = nextKey;
        };
    };

    public func optional<Doc, Key>(
        prev : Doc,
        next : Doc,
        extract : (Doc) -> ?Key,
        compare : (Key, Key) -> { #less; #equal; #greater },
    ) : FieldChange<?Key> {
        let prevKey = extract(prev);
        let nextKey = extract(next);
        let changed = switch (prevKey, nextKey) {
            case (?prevVal, ?nextVal) { compare(prevVal, nextVal) != #equal };
            case (?_, null) true;
            case (null, ?_) true;
            case (null, null) false;
        };
        {
            changed;
            prev = prevKey;
            next = nextKey;
        };
    };

    public func compute<Doc, Fields>(
        prev : Doc,
        next : Doc,
        build : (Doc, Doc) -> Fields,
        summarize : (Fields) -> Bool,
    ) : UniqueChange<Fields> {
        let fields = build(prev, next);
        {
            changed = summarize(fields);
            fields = fields;
        };
    };
}
