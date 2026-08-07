import Blob "mo:core/Blob";
import Array "mo:core/Array";
import Nat8 "mo:core/Nat8";

module {
    public func blob(value : Blob, limit : Nat) : Blob {
        if (limit >= Blob.size(value)) {
            value;
        } else {
            let arr = Blob.toArray(value);
            Blob.fromArray(Array.tabulate<Nat8>(limit, func (idx : Nat) : Nat8 {
                arr[idx];
            }));
        };
    };
}
