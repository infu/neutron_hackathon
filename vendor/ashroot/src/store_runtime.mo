import Runtime "mo:core/Runtime";

module {
    public func wrap<T>(slot : { var value : ?T }, missingMessage : Text) : {
        get : () -> T;
        set : (T) -> ();
    } {
        func get() : T {
            switch (slot.value) {
                case (?value) value;
                case null Runtime.trap(missingMessage);
            };
        };

        func set(value : T) : () {
            slot.value := ?value;
        };

        { get; set };
    };

    public func fieldAccess<Doc, Field>(
        getter : () -> Doc,
        setter : (Doc) -> (),
        assign : (Doc, Field) -> Doc
    ) : { set : (Field) -> () } {
        {
            set = func (next : Field) : () {
                let current = getter();
                setter(assign(current, next));
            };
        };
    };

    public func childHandles<Doc, Field>(
        getter : () -> Doc,
        setter : (Doc) -> (),
        project : (Doc) -> Field,
        assign : (Doc, Field) -> Doc
    ) : { get : () -> Field; set : (Field) -> () } {
        let getField = func () : Field {
            project(getter());
        };
        let setField = func (next : Field) : () {
            let current = getter();
            setter(assign(current, next));
        };
        { get = getField; set = setField };
    };

    public func mergeField<Field, Mutation>(
        current : Field,
        mutation : ?Mutation,
        update : (Field, Mutation) -> Field
    ) : Field {
        switch (mutation) {
            case null current;
            case (?next) update(current, next);
        };
    };
}
