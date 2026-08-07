import IndexCore "./index_core";

module {
    public type OrderDirection = { #asc; #desc };

    public func defaultDir(dir : ?OrderDirection) : OrderDirection {
        switch (dir) {
            case (?value) value;
            case null #asc;
        };
    };

    public func toIterDir(dir : OrderDirection) : IndexCore.Direction {
        switch (dir) {
            case (#asc) #fwd;
            case (#desc) #bwd;
        };
    };
}
