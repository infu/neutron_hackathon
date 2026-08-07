import Nat64 "mo:core/Nat64";
import Text "mo:core/Text";

module {
    public type ConstraintViolation = { field : Text; message : Text };
    public type Error = {
        #AlreadyExists : Nat64;
        #NotFound : Nat64;
        #ConstraintViolation : ConstraintViolation;
        #Internal : Text;
    };
}
