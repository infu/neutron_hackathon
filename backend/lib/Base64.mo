/// Minimal standard base64 encoder.
///
/// Only used to build the `ic-certificate` response header, so it is
/// encode-only and does not need to be fast. `mo:core@1` has no Base64 module.

import Blob "mo:core/Blob";
import Nat8 "mo:core/Nat8";
import Text "mo:core/Text";

module {

    // Must be a literal: module-level `let` has to be a static expression.
    let ALPHABET : [Char] = [
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
        'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f',
        'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
        'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '/',
    ];

    func chr(i : Nat) : Text = Text.fromChar(ALPHABET[i]);

    public func encode(input : Blob) : Text {
        let bytes = Blob.toArray(input);
        let n = bytes.size();
        var out = "";
        var i = 0;

        while (i + 3 <= n) {
            let b0 = Nat8.toNat(bytes[i]);
            let b1 = Nat8.toNat(bytes[i + 1]);
            let b2 = Nat8.toNat(bytes[i + 2]);
            out #= chr(b0 / 4);
            out #= chr((b0 % 4) * 16 + b1 / 16);
            out #= chr((b1 % 16) * 4 + b2 / 64);
            out #= chr(b2 % 64);
            i += 3;
        };

        switch (n - i : Nat) {
            case 1 {
                let b0 = Nat8.toNat(bytes[i]);
                out #= chr(b0 / 4);
                out #= chr((b0 % 4) * 16);
                out #= "==";
            };
            case 2 {
                let b0 = Nat8.toNat(bytes[i]);
                let b1 = Nat8.toNat(bytes[i + 1]);
                out #= chr(b0 / 4);
                out #= chr((b0 % 4) * 16 + b1 / 16);
                out #= chr((b1 % 16) * 4);
                out #= "=";
            };
            case _ {};
        };

        out;
    };
};
