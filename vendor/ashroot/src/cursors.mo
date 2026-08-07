import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Nat8 "mo:core/Nat8";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Principal "mo:core/Principal";
import List "mo:core/List";
import Char "mo:core/Char";

import IndexCore "./index_core";

module {
    public type Direction = IndexCore.Direction;

    public type Token = {
        dir : Direction;
        marker : Text;
    };

    public func make(dir : Direction, marker : Text) : Token {
        { dir; marker };
    };

    public func encodeNat32(dir : Direction, key : Nat32, pk : Nat64) : Token {
        make(dir, "n32:" # Nat.toText(Nat32.toNat(key)) # ":" # Nat64.toText(pk));
    };

    public func decodeNat32(token : Token) : ?(Nat32, Nat64) {
        decodePrefixNat(token, "n32", func (n : Nat) : ?Nat32 { safeNat32(n) });
    };

    public func encodeNat(dir : Direction, key : Nat, pk : Nat64) : Token {
        make(dir, "nat:" # Nat.toText(key) # ":" # Nat64.toText(pk));
    };

    public func decodeNat(token : Token) : ?(Nat, Nat64) {
        decodePrefixNat(token, "nat", func (n : Nat) : ?Nat { ?n });
    };

    public func encodeNat64(dir : Direction, key : Nat64, pk : Nat64) : Token {
        make(dir, "n64:" # Nat64.toText(key) # ":" # Nat64.toText(pk));
    };

    public func decodeNat64(token : Token) : ?(Nat64, Nat64) {
        decodePrefixNat(token, "n64", func (n : Nat) : ?Nat64 { safeNat64(n) });
    };

    public func encodeInt(dir : Direction, key : Int, pk : Nat64) : Token {
        make(dir, "int:" # Int.toText(key) # ":" # Nat64.toText(pk));
    };

    public func decodeInt(token : Token) : ?(Int, Nat64) {
        let parts = split(token.marker, 3);
        switch (parts) {
            case (?arr) {
                if (arr[0] != "int") return null;
                let ?keyInt = Int.fromText(arr[1]) else return null;
                let ?pkNat = Nat.fromText(arr[2]) else return null;
                let ?pk = safeNat64(pkNat) else return null;
                ?(keyInt, pk);
            };
            case null null;
        };
    };

    public func encodeText(dir : Direction, key : Text, pk : Nat64) : Token {
        make(dir, "txt:" # escape(key) # ":" # Nat64.toText(pk));
    };

    public func decodeText(token : Token) : ?(Text, Nat64) {
        let parts = split(token.marker, 3);
        switch (parts) {
            case (?arr) {
                if (arr[0] != "txt") return null;
                let ?decoded = unescape(arr[1]) else return null;
                let ?pkNat = Nat.fromText(arr[2]) else return null;
                let ?pk = safeNat64(pkNat) else return null;
                ?(decoded, pk);
            };
            case null null;
        };
    };

    public func encodeTextNat32(dir : Direction, key : (Text, Nat32), pk : Nat64) : Token {
        let (name, lvl) = key;
        make(
            dir,
            "pair:" # escape(name) # ":" # Nat.toText(Nat32.toNat(lvl)) # ":" # Nat64.toText(pk)
        );
    };

    public func decodeTextNat32(token : Token) : ?((Text, Nat32), Nat64) {
        let parts = split(token.marker, 4);
        switch (parts) {
            case (?arr) {
                if (arr[0] != "pair") return null;
                let ?name = unescape(arr[1]) else return null;
                let ?lvlNat = Nat.fromText(arr[2]) else return null;
                let ?lvl = safeNat32(lvlNat) else return null;
                let ?pkNat = Nat.fromText(arr[3]) else return null;
                let ?pk = safeNat64(pkNat) else return null;
                ?((name, lvl), pk);
            };
            case null null;
        };
    };

    public func encodePrincipal(dir : Direction, key : Principal, pk : Nat64) : Token {
        make(dir, "prn:" # blobToHex(Principal.toBlob(key)) # ":" # Nat64.toText(pk));
    };

    public func decodePrincipal(token : Token) : ?(Principal, Nat64) {
        let parts = split(token.marker, 3);
        switch (parts) {
            case (?arr) {
                if (arr[0] != "prn") return null;
                let ?blob = hexToBlob(arr[1]) else return null;
                let principal = Principal.fromBlob(blob);
                let ?pkNat = Nat.fromText(arr[2]) else return null;
                let ?pk = safeNat64(pkNat) else return null;
                ?(principal, pk);
            };
            case null null;
        };
    };

    public func encodeBlob(dir : Direction, key : Blob, pk : Nat64) : Token {
        make(dir, "blb:" # blobToHex(key) # ":" # Nat64.toText(pk));
    };

    public func decodeBlob(token : Token) : ?(Blob, Nat64) {
        let parts = split(token.marker, 3);
        switch (parts) {
            case (?arr) {
                if (arr[0] != "blb") return null;
                let ?blob = hexToBlob(arr[1]) else return null;
                let ?pkNat = Nat.fromText(arr[2]) else return null;
                let ?pk = safeNat64(pkNat) else return null;
                ?(blob, pk);
            };
            case null null;
        };
    };

    public func encodeSegmentNat(key : Nat) : Text {
        Nat.toText(key);
    };

    public func decodeSegmentNat(text : Text) : ?Nat {
        Nat.fromText(text);
    };

    public func encodeSegmentNat32(key : Nat32) : Text {
        Nat.toText(Nat32.toNat(key));
    };

    public func decodeSegmentNat32(text : Text) : ?Nat32 {
        let ?value = Nat.fromText(text) else return null;
        safeNat32(value);
    };

    public func encodeSegmentNat64(key : Nat64) : Text {
        Nat64.toText(key);
    };

    public func decodeSegmentNat64(text : Text) : ?Nat64 {
        let ?value = Nat.fromText(text) else return null;
        safeNat64(value);
    };

    public func encodeSegmentInt(key : Int) : Text {
        Int.toText(key);
    };

    public func decodeSegmentInt(text : Text) : ?Int {
        Int.fromText(text);
    };

    public func encodeSegmentText(value : Text) : Text {
        escape(value);
    };

    public func decodeSegmentText(text : Text) : ?Text {
        unescape(text);
    };

    public func encodeSegmentPrincipal(value : Principal) : Text {
        blobToHex(Principal.toBlob(value));
    };

    public func decodeSegmentPrincipal(text : Text) : ?Principal {
        let ?blob = hexToBlob(text) else return null;
        ?Principal.fromBlob(blob);
    };

    public func encodeSegmentBlob(value : Blob) : Text {
        blobToHex(value);
    };

    public func decodeSegmentBlob(text : Text) : ?Blob {
        hexToBlob(text);
    };

    public func encodeComposite(dir : Direction, tag : Text, parts : [Text], pk : Nat64) : Token {
        var marker = "cmp:" # tag;
        for (part in parts.vals()) {
            marker #= ":" # part;
        };
        marker #= ":" # Nat64.toText(pk);
        make(dir, marker);
    };

    public func decodeComposite(token : Token, tag : Text, partCount : Nat) : ?([Text], Nat64) {
        let expected = partCount + 3;
        let parts = split(token.marker, expected);
        switch (parts) {
            case (?arr) {
                if (arr[0] != "cmp") return null;
                if (arr[1] != tag) return null;
                let ?pkNat = Nat.fromText(arr[expected - 1]) else return null;
                let ?pk = safeNat64(pkNat) else return null;
                let payload = Array.tabulate<Text>(
                    partCount,
                    func (i : Nat) : Text { arr[i + 2] }
                );
                ?(payload, pk);
            };
            case null null;
        };
    };

    func decodePrefixNat<K>(token : Token, prefix : Text, convert : Nat -> ?K) : ?(K, Nat64) {
        let parts = split(token.marker, 3);
        switch (parts) {
            case (?arr) {
                if (arr[0] != prefix) return null;
                let ?keyNat = Nat.fromText(arr[1]) else return null;
                let ?pkNat = Nat.fromText(arr[2]) else return null;
                let ?pk = safeNat64(pkNat) else return null;
                switch (convert(keyNat)) {
                    case (?k) { ?(k, pk) };
                    case null null;
                };
            };
            case null null;
        };
    };

    func split(text : Text, expected : Nat) : ?[Text] {
        let arr = Iter.toArray(Text.split(text, #char ':'));
        if (Array.size(arr) == expected) {
            ?arr;
        } else {
            null;
        };
    };

    func blobToHex(blob : Blob) : Text {
        var out = "";
        for (byte in Blob.toArray(blob).vals()) {
            out #= byteToHex(byte);
        };
        out;
    };

    func byteToHex(byte : Nat8) : Text {
        let value = Nat8.toNat(byte);
        let hi = value / 16;
        let lo = value % 16;
        Text.fromChar(hexDigit(hi)) # Text.fromChar(hexDigit(lo));
    };

    func hexToBlob(text : Text) : ?Blob {
        let size = Text.size(text);
        if (size % 2 != 0) return null;
        let buffer = List.empty<Nat8>();
        let chars = text.chars();
        label decode while (true) {
            switch (chars.next()) {
                case null { break decode; };
                case (?hiChar) {
                    let ?loChar = chars.next() else return null;
                    let ?hi = hexValue(hiChar) else return null;
                    let ?lo = hexValue(loChar) else return null;
                    List.add(buffer, Nat8.fromNat(hi * 16 + lo));
                };
            };
        };
        let bytes = List.toArray(buffer);
        ?Blob.fromArray(bytes);
    };

    func escape(text : Text) : Text {
        var out = "";
        for (c in text.chars()) {
            switch (c) {
                case ('%') { out #= "%25"; };
                case (':') { out #= "%3A"; };
                case (_) { out #= Text.fromChar(c); };
            };
        };
        out;
    };

    func unescape(text : Text) : ?Text {
        var out = "";
        let chars = text.chars();

        func step() : ?Text {
            switch (chars.next()) {
                case null { ?out };
                case (?c) {
                    if (c == '%') {
                        let ?c1 = chars.next() else return null;
                        let ?c2 = chars.next() else return null;
                        if (c1 == '2' and c2 == '5') {
                            out #= "%";
                        } else if (c1 == '3' and (c2 == 'A' or c2 == 'a')) {
                            out #= ":";
                        } else {
                            return null;
                        };
                    } else {
                        out #= Text.fromChar(c);
                    };
                    step();
                };
            };
        };

        step();
    };

    func hexDigit(n : Nat) : Char {
        let base = if (n < 10) 48 else 87;
        Char.fromNat32(Nat32.fromNat(base + n));
    };

    func hexValue(c : Char) : ?Nat {
        let code = Char.toNat32(c);
        if (code >= 48 and code <= 57) {
            return ?Nat32.toNat(code - 48);
        };
        if (code >= 65 and code <= 70) {
            return ?Nat32.toNat(code - 65 + 10);
        };
        if (code >= 97 and code <= 102) {
            return ?Nat32.toNat(code - 97 + 10);
        };
        null;
    };

    func safeNat32(n : Nat) : ?Nat32 {
        let max = Nat32.toNat(Nat32.maxValue);
        if (Nat.compare(n, max) == #greater) {
            null;
        } else {
            ?Nat32.fromNat(n);
        };
    };

    func safeNat64(n : Nat) : ?Nat64 {
        let max = Nat64.toNat(Nat64.maxValue);
        if (Nat.compare(n, max) == #greater) {
            null;
        } else {
            ?Nat64.fromNat(n);
        };
    };
}
