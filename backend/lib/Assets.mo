/// Certified static asset store.
///
/// This module owns *everything* HTTP so the actor stays a thin shell:
/// chunked uploads, SHA-256 hashing, IC response certification (v1), the
/// `http_request` handler, and the streaming callback.
///
/// ## Certification
///
/// We use IC response verification **v1**: a single merkle tree mapping
/// `["http_assets", <url>]` to the SHA-256 of the response body, with the tree
/// root published as the canister's certified data. The gateway checks the
/// witness in the `ic-certificate` header against that root. This is enough to
/// serve assets from `https://<canister>.icp0.io` without `raw`.
///
/// Two consequences worth knowing:
///
///  * The hash covers the **stored bytes**, i.e. the gzipped body we hand back
///    verbatim, and the **whole** body across all chunks.
///  * A URL is only certified if it is literally in the tree. There is no
///    `/foo` -> `/foo/index.html` fallback, because a fallback response could
///    not be certified under the requested path. Use hash routing in the SPA.
///
/// ## Upload protocol
///
/// One file at a time, chunk 0 first:
///
///   #store  { key; contentType; contentEncoding; chunks = N; content = <chunk 0> }
///   #chunk  { key; index = 1; content = <chunk 1> }
///   ...
///   #chunk  { key; index = N-1; content = <chunk N-1> }
///
/// The asset is hashed, certified and becomes servable only once the final
/// chunk arrives. Incomplete assets return 404.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import CertifiedData "mo:core/CertifiedData";
import Char "mo:core/Char";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";

import CertTree "./certification/CertTree";
import SHA256 "mo:sha2/Sha256";

import Base64 "./Base64";
import Slab "./Slab";
import Painless "./Painless";

module {

    // ── Types ────────────────────────────────────────────────────────────────

    public type Asset = {
        key : Text;
        chunks : Nat;
        /// Where each chunk's bytes live, one handle per chunk.
        ///
        /// The bytes themselves are in stable memory, not here — see `Slab`.
        /// A canister's heap is a few gigabytes and this event could hold
        /// several on art alone, so the one thing that scales with the number
        /// of participants is the one thing kept out of it. What stays on the
        /// heap is the index: a key, a couple of strings, a hash and these
        /// handles, which is tens of bytes per file rather than megabytes.
        parts : [Slab.Handle];
        contentType : Text;
        contentEncoding : Text;
        sha256 : Blob;
        complete : Bool;
    };

    /// Everything that must survive an upgrade. Keep this in a `stable var`.
    public type Mem = {
        files : Map.Map<Text, Asset>;
        cert : CertTree.Store;
        /// The bytes. Everything above is an index into this.
        slab : Slab.Mem;
    };

    public func init() : Mem = {
        files = Map.empty<Text, Asset>();
        slab = Slab.init();
        cert = CertTree.newStore();
    };

    public type Cmd = {
        #store : {
            key : Text;
            contentType : Text;
            contentEncoding : Text;
            chunks : Nat;
            content : Blob;
        };
        #chunk : { key : Text; index : Nat; content : Blob };
        #delete : { key : Text };
        #clear : { prefix : Text };
    };

    public type Info = {
        key : Text;
        size : Nat;
        chunks : Nat;
        contentType : Text;
        contentEncoding : Text;
        complete : Bool;
    };

    public type Limits = {
        /// Largest number of chunks a single asset may declare.
        maxChunks : Nat;
        /// Largest single chunk, in bytes. Keep below the ~2 MiB ingress limit.
        maxChunkBytes : Nat;
        /// Largest total asset size, in bytes.
        maxBytes : Nat;
    };

    public let defaultLimits : Limits = {
        maxChunks = 512;
        maxChunkBytes = 1_900_000;
        maxBytes = 32_000_000;
    };

    /// A face at display size. Generous for a 96px avatar and small enough
    /// that a thousand of them is a rounding error against a season's assets.
    public let avatarLimits : Limits = {
        maxChunks = 1;
        maxChunkBytes = 100_000;
        maxBytes = 100_000;
    };

    /// What a registered user is allowed to upload, and how much of it.
    ///
    /// One message each: a screenshot or a package arrives whole, so there is
    /// no half-written asset to reason about and nothing to garbage-collect if
    /// a browser gives up part way through. The ceiling is the ingress limit,
    /// not a policy — a single call cannot carry more.
    public type UserKind = { #avatar; #icon; #media; #package };

    func imageType(key : Text) : ?Text {
        if (Text.endsWith(key, #text ".png")) return ?"image/png";
        if (Text.endsWith(key, #text ".jpg")) return ?"image/jpeg";
        if (Text.endsWith(key, #text ".jpeg")) return ?"image/jpeg";
        if (Text.endsWith(key, #text ".webp")) return ?"image/webp";
        if (Text.endsWith(key, #text ".gif")) return ?"image/gif";
        if (Text.endsWith(key, #text ".avif")) return ?"image/avif";
        null;
    };

    func safeNameChar(c : Char) : Bool {
        (c >= 'a' and c <= 'z')
        or (c >= 'A' and c <= 'Z')
        or (c >= '0' and c <= '9')
        or c == '_'
        or c == '-';
    };

    /// A browser-stable image leaf: one non-empty ASCII stem, one known suffix,
    /// and no character a URL parser can reinterpret.
    func imageName(name : Text) : Bool {
        if (imageType(name) == null) return false;
        var beforeDot = 0;
        var sawDot = false;
        for (c in name.chars()) {
            if (c == '.') {
                if (sawDot or beforeDot == 0) return false;
                sawDot := true;
            } else {
                if (not safeNameChar(c)) return false;
                if (not sawDot) beforeDot += 1;
            };
        };
        sawDot;
    };

    /// A package leaf is the same shape accepted by `Season`: one to 32
    /// decimal digits followed by the fixed `.neutron` extension.
    func packageName(name : Text) : Bool {
        let ?stem = Text.stripEnd(name, #text ".neutron") else return false;
        if (stem.size() == 0 or stem.size() > 32) return false;
        for (c in stem.chars()) {
            if (c < '0' or c > '9') return false;
        };
        true;
    };

    func leafUnder(key : Text, scope : Text, folder : Text) : ?Text {
        if (not inScope(key, ?scope)) return null;
        Text.stripStart(key, #text(scope # folder # "/"));
    };

    /// The folder a user's upload has to sit in, and what that folder allows.
    ///
    /// Read from the key rather than taken as an argument. When the caller
    /// named the kind, the caps were advisory — anyone wanting a 1.9 MB avatar
    /// said `#package` and got one. A path says what a file is for, and a path
    /// is already checked against the owner's namespace.
    ///
    /// An unrecognised folder is refused outright rather than falling back to
    /// something permissive: a new kind of upload should be a deliberate entry
    /// here, not whatever the loosest existing limit happens to be.
    public func kindFor(key : Text, scope : Text) : ?UserKind {
        switch (leafUnder(key, scope, "avatar")) {
            case (?name) if (imageName(name)) return ?#avatar;
            case _ {};
        };
        switch (leafUnder(key, scope, "icon")) {
            case (?name) if (imageName(name)) return ?#icon;
            case _ {};
        };
        switch (leafUnder(key, scope, "shots")) {
            case (?name) if (imageName(name)) return ?#media;
            case _ {};
        };
        switch (leafUnder(key, scope, "pkg")) {
            case (?name) if (packageName(name)) return ?#package;
            case _ {};
        };
        null;
    };

    /// Is this key well-formed, and inside `scope` if one is given?
    ///
    /// Module-level rather than a method on `Use`, because the row layer needs
    /// exactly this predicate and has no asset store to ask. It used to be
    /// private here, so `Season.checkKey` and `Profiles.setAvatar` each
    /// re-derived a weaker one-line version — and both of those accepted
    /// `/u/1/../2/icon/x.png`.
    ///
    /// A key is a URL path. Traversal and doubled separators are refused
    /// outright rather than normalised: keys are exact, and a key that has to
    /// be canonicalised before it can be compared is a key that two pieces of
    /// code will canonicalise differently.
    public func inScope(key : Text, scope : ?Text) : Bool {
        if (not Text.startsWith(key, #text "/")) return false;
        if (Text.contains(key, #text "..")) return false;
        if (Text.contains(key, #text "//")) return false;
        switch (scope) {
            case null true;
            case (?prefix) {
                if (Text.contains(key, #text "/./")) return false;
                if (Text.endsWith(key, #text "/.")) return false;
                // `canonical()` strips query/fragment text for HTTP, URL
                // parsers decode percent-encoded dot segments, and WHATWG
                // treats backslashes as separators. A participant key must
                // never have a second spelling.
                if (Text.contains(key, #text "?")) return false;
                if (Text.contains(key, #text "#")) return false;
                if (Text.contains(key, #text "%")) return false;
                if (Text.contains(key, #text "\\")) return false;
                Text.startsWith(key, #text prefix);
            };
        };
    };

    /// Which of the four folders a key names, if any.
    ///
    /// The whole key must be legal first — inside the namespace, no traversal —
    /// because a folder read off an illegal key is a folder read off something
    /// that will resolve elsewhere.
    public func folderOf(key : Text, scope : Text) : ?Text {
        if (not inScope(key, ?scope)) return null;
        // `stripStart`, not `trimStart`: the trim variants strip a pattern
        // repeatedly, so a key that begins with the scope twice would be read
        // as though it began with it once.
        let ?rest = Text.stripStart(key, #text scope) else return null;
        for (folder in ["avatar", "icon", "shots", "pkg"].vals()) {
            if (Text.startsWith(rest, #text(folder # "/"))) return ?folder;
        };
        null;
    };

    /// The one predicate the row layer needs: is this exact, browser-stable key
    /// the caller's own, in the folder it claims to be in?
    ///
    /// Rows store keys and never bytes, so nothing else about an entry's art
    /// is checked anywhere. Prefix alone is not enough — `/u/1/../2/icon/x.png`
    /// starts with `/u/1/` and resolves to somebody else's file, because a
    /// browser removes dot-segments before it asks for anything.
    public func ownedKey(key : Text, scope : Text, folder : Text) : Bool {
        switch (kindFor(key, scope)) {
            case (?#avatar) folder == "avatar";
            case (?#icon) folder == "icon";
            case (?#media) folder == "shots";
            case (?#package) folder == "pkg";
            case null false;
        };
    };

    /// A generated browser key is currently 27–34 UTF-8 bytes and the widest
    /// package path accepted by `Season` is 52. The retained cost follows
    /// bytes, not Unicode scalar values: the certification tree keeps both a
    /// key blob and a word-array copy. Keep the old scalar ceiling as a cheap
    /// precheck and migration-safe delete/clear bound, while every newly
    /// persisted key must also fit the real byte allowance.
    public let MAX_KEY = 160;
    public let MAX_KEY_BYTES = 64;

    public func keyWithinLimit(key : Text) : Bool {
        if (key.size() > MAX_KEY) return false;
        Text.encodeUtf8(key).size() <= MAX_KEY_BYTES;
    };

    /// Account and event storage ceilings live beside the file limits they
    /// constrain.  The actor applies them before calling `upload`; exporting
    /// them from here keeps the capacity promise and the allocator ceiling
    /// from drifting apart.
    ///
    /// These are fixed-slot storage allowances, not payload-byte totals. A
    /// 458,753-byte file, for example, occupies one 2 MiB build slot and spends
    /// 2 MiB here. Hackers keep enough room for four distinct qualifier
    /// submissions. An observer keeps two small slots so a fresh avatar or
    /// sponsor logo can be uploaded before the displaced key is cleaned up.
    public let MAX_HACKER_KEYS = 64;
    public let MAX_NON_HACKER_KEYS = 2;
    public let MAX_HACKER_BYTES = 32_000_000;
    public let MAX_NON_HACKER_BYTES = 262_144; // two `Slab.#small` slots

    /// Whole-store ceilings. Each slab class has its own region and regions
    /// never shrink, so this is the sum of the worst historical high-water
    /// mark of all three classes, plus exactly 1 GiB for the shipped frontend:
    ///
    /// small  = (1,000 × 64 + 200 × 2) × 128 KiB =  8,441,036,800
    /// image  = 1,000 × 64 × 448 KiB              = 29,360,128,000
    /// build  = 1,000 × 15 × 2 MiB                = 31,457,280,000
    /// users  =                                      69,258,444,800
    /// policy = users + 1 GiB                       = 70,332,186,624
    ///
    /// The production compiler ceiling is 80 GiB, leaving another ~14.50 GiB
    /// above policy for runtime stable structures and a clean refusal margin.
    public let MAX_LIVE_SLOTS = 80_000;
    public let MAX_RESERVED_BYTES = 70_332_186_624;

    /// App folders are available only to hackers. Avatar remains available to
    /// every registered account because it is also where sponsor logos live.
    /// Callers should apply this only to writes: deleting a file must remain a
    /// way back under quota after somebody drops the hacker role.
    public func isAppKind(kind : UserKind) : Bool = switch (kind) {
        case (#avatar) false;
        case (#icon or #media or #package) true;
    };

    public func mayWriteKind(kind : UserKind, hacker : Bool) : Bool =
        not isAppKind(kind) or hacker;

    public func maxKeysFor(hacker : Bool) : Nat =
        if (hacker) MAX_HACKER_KEYS else MAX_NON_HACKER_KEYS;

    public func maxBytesFor(hacker : Bool) : Nat =
        if (hacker) MAX_HACKER_BYTES else MAX_NON_HACKER_BYTES;


    /// What a stored user upload is served as.
    ///
    /// Derived, never taken. `Assets.upload` used to store whatever
    /// `contentType` the caller sent and `headersFor` echoed it back, so a
    /// participant could upload `text/html` and have it executed on the origin
    /// that serves this app — where the sign-in session lives.
    ///
    /// No SVG. It is XML that can carry script; it will not run inside an
    /// `<img>`, but a direct navigation renders it as a document on our origin,
    /// which is the thing being prevented.
    public func typeFor(key : Text, kind : UserKind) : ?Text {
        switch (kind) {
            case (#package) ?"application/octet-stream";
            case (#avatar or #icon or #media) imageType(key);
        };
    };

    /// The key a command acts on, for the commands a user may issue.
    public func keyOf(cmd : Cmd) : ?Text = switch (cmd) {
        case (#store(req)) ?req.key;
        case (#chunk(req)) ?req.key;
        case (#delete(req)) ?req.key;
        // Clearing a whole prefix is not a user operation.
        case (#clear(_)) null;
    };

    /// The mark the bracket draws, at the size the bracket draws it. Same cap
    /// as an avatar: both are small square images shown at a few dozen pixels,
    /// and neither has any use for four hundred kilobytes.
    public let iconLimits : Limits = {
        maxChunks = 1;
        maxChunkBytes = 100_000;
        maxBytes = 100_000;
    };

    /// A screenshot. Six per entry, so this bounds one entry's art at 2.5 MB
    /// including its icon.
    public let mediaLimits : Limits = {
        maxChunks = 1;
        maxChunkBytes = 400_000;
        maxBytes = 400_000;
    };

    /// A `.neutron` package, capped just under the ~2 MiB ingress limit.
    public let packageLimits : Limits = {
        maxChunks = 1;
        maxChunkBytes = 1_900_000;
        maxBytes = 1_900_000;
    };

    public func limitsFor(kind : UserKind) : Limits = switch (kind) {
        case (#avatar) avatarLimits;
        case (#icon) iconLimits;
        case (#media) mediaLimits;
        case (#package) packageLimits;
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Strip `?query` and `#fragment`. The gateway certifies the full request
    /// path, but our keys are path-only, so both sides use this.
    /// Everything under here belongs to a participant, not to the build.
    public let USER_ROOT = "/u/";

    /// Eight big-endian bytes: the length prefix in the frontend digest.
    func lengthOf(n : Nat) : Blob {
        Blob.fromArray(
            Array.tabulate<Nat8>(
                8,
                func(i) = Nat8.fromNat((n / (256 ** (7 - i))) % 256),
            )
        );
    };

    func hex(blob : Blob) : Text {
        let digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];
        var out = "";
        for (byte in blob.vals()) {
            let n = Nat8.toNat(byte);
            out #= digits[n / 16] # digits[n % 16];
        };
        out;
    };

    public func canonical(url : Text) : Text {
        let noFragment = switch (Text.split(url, #char '#').next()) {
            case (?head) head;
            case null url;
        };
        switch (Text.split(noFragment, #char '?').next()) {
            case (?head) head;
            case null noFragment;
        };
    };

    /// Read off the handles, so asking how big a file is never reads the file.
    func assetSize(a : Asset) : Nat {
        var total = 0;
        for (part in a.parts.vals()) total += part.size;
        total;
    };

    func toInfo(a : Asset) : Info = {
        key = a.key;
        size = assetSize(a);
        chunks = a.chunks;
        contentType = a.contentType;
        contentEncoding = a.contentEncoding;
        complete = a.complete;
    };

    // ── Use ──────────────────────────────────────────────────────────────────

    public class Use(mem : Mem) {

        let ct = CertTree.Ops(mem.cert);
        let slab = Slab.Use(mem.slab);

        /// One chunk's bytes. Empty if the handle is stale, which can only
        /// happen if an asset row outlived its slots — a bug, but one that
        /// serves nothing rather than serving somebody else's file.
        func chunk(a : Asset, index : Nat) : Blob {
            if (index >= a.parts.size()) return "";
            switch (slab.read(a.parts[index])) {
                case (?bytes) bytes;
                case null "";
            };
        };

        /// What the file bytes are costing in stable memory.
        ///
        /// Worth exposing rather than keeping private: the whole point of the
        /// slot store is that reserved memory stops growing once slots start
        /// being reused, and that is a claim somebody should be able to check.
        /// A digest over every frontend file this canister is serving.
        ///
        /// The point is that somebody can check the site they are looking at
        /// against the repository it claims to come from — `npm run verify:web`
        /// recomputes the same number from `frontend/dist` and holds the two
        /// against each other. A canister that says it is running a published
        /// build should be checkable on that, not believed.
        ///
        /// **Order-independent, by sorting.** A rolling hash folded in upload
        /// order would depend on the order files happened to be uploaded in,
        /// which the local script has no way to reproduce — the digest would
        /// disagree for a build that was byte-for-byte identical. Sorting the
        /// keys first makes the answer a function of the content alone.
        ///
        /// **Length-prefixed, so it cannot be fooled.** Concatenating
        /// `key # type # hash` would let `("ab", "c")` and `("a", "bc")` land on
        /// the same digest. Every field goes in with its byte length first, so
        /// there is exactly one way to read the stream back.
        ///
        /// **User uploads are excluded.** Anything under `/u/` belongs to a
        /// participant and changes constantly; the frontend is what a
        /// verifiable build is a claim about.
        public func frontendHash() : Text {
            let sorted = frontendKeys();

            let digest = SHA256.Digest(#sha256);
            label each for (key in sorted.vals()) {
                let ?asset = get(key) else continue each;
                field(digest, Text.encodeUtf8(key));
                field(digest, Text.encodeUtf8(asset.contentType));
                field(digest, Text.encodeUtf8(asset.contentEncoding));
                // The file's own sha256, computed when the last chunk landed.
                // Hashing the hash rather than the bytes keeps this a cheap
                // query instead of a walk over every byte in stable memory.
                field(digest, asset.sha256);
            };
            hex(digest.sum());
        };

        /// Complete, site-owned keys in deterministic order. Release tooling
        /// uses this to prune an old frontend only after the replacement HTML
        /// has switched over; user namespaces are never part of that cleanup.
        public func frontendKeys() : [Text] {
            let keys = List.empty<Text>();
            for ((key, asset) in Map.entries(mem.files)) {
                if (asset.complete and not Text.startsWith(key, #text USER_ROOT)) {
                    List.add(keys, key);
                };
            };
            Array.sort(List.toArray(keys), Text.compare);
        };

        /// Certified data is cleared by an upgrade even though the stable tree
        /// survives it. Republish the existing root from a bare actor-body
        /// expression on every install/upgrade, before any asset mutation.
        public func republish() {
            ct.setCertifiedData();
        };

        /// Length-prefix a field into the digest, so the stream is unambiguous.
        func field(digest : SHA256.Digest, bytes : Blob) {
            digest.writeBlob(lengthOf(bytes.size()));
            digest.writeBlob(bytes);
        };

        public func storage() : Slab.Stats = slab.stats();

        /// What one more slot in this class would add to stable reservation.
        /// Zero means the slab already has a reusable interior or tail slot.
        public func reservationGrowth(class_ : Slab.Class) : Nat =
            slab.reservationGrowth(class_);

        /// Hand every slot back. Called before a row is replaced or removed —
        /// the slots are the only thing that does not go away with the row.
        func release(a : Asset) {
            for (part in a.parts.vals()) slab.drop(part);
        };

        /// Put a chunk in stable memory, or say why not.
        func stash(bytes : Blob) : Result.Result<Slab.Handle, Text> {
            switch (slab.write(bytes)) {
                case (#ok(handle)) #ok(handle);
                case (#err(e)) #err(Slab.describe(e));
            };
        };

        func treePath(key : Text) : CertTree.Path = ["http_assets", Text.encodeUtf8(key)];

        func get(key : Text) : ?Asset = Map.get(mem.files, Text.compare, key);

        func put(a : Asset) = Map.add(mem.files, Text.compare, a.key, a);

        /// Hash the concatenated body, publish it into the tree, republish the
        /// root. Only ever called from an update context.
        func certify(a : Asset) : Asset {
            let digest = SHA256.Digest(#sha256);
            var i = 0;
            while (i < a.parts.size()) {
                digest.writeBlob(chunk(a, i));
                i += 1;
            };
            let done = { a with sha256 = digest.sum(); complete = true };
            put(done);
            ct.put(treePath(done.key), done.sha256);
            ct.setCertifiedData();
            done;
        };

        // ── Writes ───────────────────────────────────────────────────────────

        /// Apply one upload command.
        ///
        /// `scope` restricts which keys the caller may touch: `null` means
        /// unrestricted (controllers), `?"/u/7/"` confines a user to their own
        /// namespace. Must be called from an update method — certification
        /// publishes certified data, which traps in a query.
        public func upload(cmd : Cmd, scope : ?Text, limits : Limits) : Result.Result<(), Text> {
            // Every command names something, and the name outlives the call in
            // three places: the map key, the certification tree's key blob, and
            // — worst — the merkle node's `prefix`, where `Blob.toArray` turns
            // each byte into a word. So an unbounded key is roughly five times
            // its own length in heap, bought with one message and never handed
            // back.
            //
            // `MAX_KEY` existed for exactly this and was enforced only by the
            // row layers that *reference* a key, so an upload no row ever
            // pointed at — an avatar, a stray file in one's own namespace —
            // skipped it entirely. Checked here rather than at the call sites
            // so that no future caller can be the one that forgets.
            let named = switch (cmd) {
                case (#store(req)) req.key;
                case (#chunk(req)) req.key;
                case (#delete(req)) req.key;
                case (#clear(req)) req.prefix;
            };
            // Delete/clear retain the former scalar limit so a key written by
            // an older Wasm remains removable. A chunk can only finish a row
            // that #store already admitted. The byte limit belongs on #store,
            // the only command that can create a new persistent key.
            if (named.size() > MAX_KEY) {
                return #err("key is longer than " # Nat.toText(MAX_KEY) # " characters");
            };

            switch (cmd) {

                case (#store(req)) {
                    if (not keyWithinLimit(req.key)) {
                        return #err(
                            "key is longer than " # Nat.toText(MAX_KEY_BYTES) # " UTF-8 bytes"
                        );
                    };
                    if (not inScope(req.key, scope)) return #err("key out of scope: " # req.key);
                    if (req.chunks == 0) return #err("chunks must be > 0");
                    if (req.chunks > limits.maxChunks) return #err("too many chunks");
                    if (req.content.size() > limits.maxChunkBytes) return #err("chunk too large");
                    if (req.content.size() * req.chunks > limits.maxBytes) return #err("asset too large");

                    // Whatever was here is being replaced, so its slots go
                    // back first. Before the write, not after: a failed write
                    // then leaves the key absent rather than pointing at slots
                    // that have been handed to somebody else.
                    switch (get(req.key)) { case (?old) release(old); case null {} };

                    let part = switch (stash(req.content)) {
                        case (#ok(p)) p;
                        case (#err(_)) {
                            // Make the promise above true. The old slots are
                            // already back in the free list, so the row still
                            // naming them has to go as well — otherwise `chunk`
                            // reads a released slot, `http_request` answers 200
                            // with an empty body, and the tree still holds the
                            // old hash, so the gateway turns that URL into a
                            // permanent 503 rather than an honest 404.
                            ignore Map.delete(mem.files, Text.compare, req.key);
                            ct.delete(treePath(req.key));
                            ct.setCertifiedData();
                            return #err("no room in stable memory");
                        };
                    };
                    let staged : Asset = {
                        key = req.key;
                        chunks = req.chunks;
                        parts = [part];
                        contentType = req.contentType;
                        contentEncoding = req.contentEncoding;
                        sha256 = "" : Blob;
                        complete = false;
                    };

                    if (req.chunks == 1) {
                        ignore certify(staged);
                    } else {
                        // Drop any stale certification while the new body is
                        // in flight, so a partially replaced asset is never
                        // served against an old hash.
                        ct.delete(treePath(req.key));
                        ct.setCertifiedData();
                        put(staged);
                    };
                    #ok;
                };

                case (#chunk(req)) {
                    if (not inScope(req.key, scope)) return #err("key out of scope: " # req.key);
                    let ?staged = get(req.key) else return #err("no upload in progress: " # req.key);
                    if (staged.complete) return #err("asset already complete: " # req.key);
                    if (req.index != staged.parts.size()) {
                        return #err(
                            "out of order chunk: expected " # Nat.toText(staged.parts.size())
                            # ", got " # Nat.toText(req.index)
                        );
                    };
                    if (req.content.size() > limits.maxChunkBytes) return #err("chunk too large");

                    let #ok(part) = stash(req.content) else return #err("no room in stable memory");
                    let grown = { staged with parts = Array.concat(staged.parts, [part]) };
                    if (assetSize(grown) > limits.maxBytes) {
                        slab.drop(part);
                        return #err("asset too large");
                    };

                    if (grown.parts.size() == grown.chunks) {
                        ignore certify(grown);
                    } else {
                        put(grown);
                    };
                    #ok;
                };

                case (#delete(req)) {
                    if (not inScope(req.key, scope)) return #err("key out of scope: " # req.key);
                    // The row goes with the map entry; the slots have to be
                    // handed back explicitly or they are reserved for ever.
                    switch (get(req.key)) { case (?gone) release(gone); case null {} };
                    ignore Map.delete(mem.files, Text.compare, req.key);
                    ct.delete(treePath(req.key));
                    ct.setCertifiedData();
                    // `#ok` is the takedown contract: neither the asset map nor
                    // the certified tree may retain the exact URL. Trap rather
                    // than return a partial deletion that a caller could
                    // accidentally commit.
                    if (get(req.key) != null or ct.lookup(treePath(req.key)) != null) {
                        Runtime.trap("deleted asset remained stored or certified");
                    };
                    #ok;
                };

                case (#clear(req)) {
                    switch (scope) {
                        case (?prefix) {
                            if (not Text.startsWith(req.prefix, #text prefix)) {
                                return #err("prefix out of scope: " # req.prefix);
                            };
                        };
                        case null {};
                    };
                    // Collect first: deleting while iterating is not safe.
                    for (key in keys(req.prefix, 100_000).vals()) {
                        switch (get(key)) { case (?gone) release(gone); case null {} };
                        ignore Map.delete(mem.files, Text.compare, key);
                        ct.delete(treePath(key));
                    };
                    ct.setCertifiedData();
                    #ok;
                };
            };
        };

        // ── Reads ────────────────────────────────────────────────────────────

        public func keys(prefix : Text, limit : Nat) : [Text] {
            let out = List.empty<Text>();
            // `mem.files` is ordered. Start at the first possible match and
            // stop as soon as the prefix range ends, instead of walking every
            // participant's files for each per-account quota check.
            label scan for ((key, _) in Map.entriesFrom(mem.files, Text.compare, prefix)) {
                if (List.size(out) >= limit) break scan;
                if (not Text.startsWith(key, #text prefix)) break scan;
                List.add(out, key);
            };
            List.toArray(out);
        };

        /// Publicly enumerable site assets. Participant uploads are reachable
        /// when a profile or entry gives somebody their exact URL, but `/u/`
        /// is not a directory index: rejected packages and abandoned drafts
        /// must not be discoverable just by walking this query.
        public func list(prefix : Text, limit : Nat) : [Info] {
            let out = List.empty<Info>();
            label scan for ((key, asset) in Map.entries(mem.files)) {
                if (List.size(out) >= limit) break scan;
                if (
                    not Text.startsWith(key, #text USER_ROOT)
                    and Text.startsWith(key, #text prefix)
                ) {
                    List.add(out, toInfo(asset));
                };
            };
            List.toArray(out);
        };

        public func info(key : Text) : ?Info = switch (get(key)) {
            case (?a) ?toInfo(a);
            case null null;
        };

        public func size() : Nat = Map.size(mem.files);

        // ── HTTP ─────────────────────────────────────────────────────────────

        /// The `ic-certificate` header for one URL. `getCertificate` only
        /// returns a value inside a query call, which is where this runs.
        func certificationHeader(url : Text) : Painless.HeaderField {
            let witness = ct.encodeWitness(ct.reveal(treePath(url)));
            let certificate = switch (CertifiedData.getCertificate()) {
                case (?c) c;
                case null ("" : Blob);
            };
            (
                "ic-certificate",
                "certificate=:" # Base64.encode(certificate) # ":, tree=:" # Base64.encode(witness) # ":",
            );
        };

        func headersFor(a : Asset, url : Text) : [Painless.HeaderField] {
            // One policy or the other, never both: two `content-security-policy`
            // headers are intersected by the browser, which makes the effective
            // policy something neither of them says.
            let theirs = Text.startsWith(url, #text "/u/");
            let base : [Painless.HeaderField] = [
                ("content-type", a.contentType),
                ("cache-control", cacheControl(url)),
                ("x-content-type-options", "nosniff"),
                certificationHeader(url),
            ] |> Array.concat(_, if (theirs) userUploadHeaders else appHeaders);
            if (a.contentEncoding == "identity" or a.contentEncoding == "") {
                base;
            } else {
                Array.concat<Painless.HeaderField>(base, [("content-encoding", a.contentEncoding)]);
            };
        };

        /// What the app's own pages are served with.
        ///
        /// Deliberately narrow rather than complete, and `img-src` is the
        /// directive that earns its place. A sponsor may nominate **any**
        /// canister as an ICRC-1 ledger — that is on purpose, it is a catalogue
        /// and not a whitelist — and the browser renders that ledger's logo. An
        /// arbitrary URL there is a tracking pixel firing at whichever moderator
        /// opens the review queue, which is the same bug `Profiles.checkLogo`
        /// already refuses for a sponsor's *own* logo. Everything this app draws
        /// is same-origin, a data URI, or a page-local blob URL used while an
        /// image is being previewed before upload. Remote HTTP images remain
        /// blocked.
        ///
        /// `script-src` and `connect-src` are deliberately **not** set. Both
        /// could be tightened — the canister serves its own frontend and talks
        /// to its own gateway — but a CSP that blocks the agent's calls fails in
        /// the worst possible way: silently, only in a browser, and only once
        /// deployed. They are worth adding against a real browser rather than
        /// guessing at from here.
        let appHeaders : [Painless.HeaderField] = [
            (
                "content-security-policy",
                "img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            ),
            // Nothing this app links to needs to know which page you came from,
            // and a season page's URL names the entry you were reading.
            ("referrer-policy", "no-referrer"),
        ];

        /// Belt and braces over everything a participant uploaded.
        ///
        /// `typeFor` decides what new uploads are served as, but a stored asset
        /// keeps the type it was stored with, and nothing rewrites the store on
        /// upgrade — so on a canister that has already run, deriving the type
        /// fixes only what arrives next. These apply to every byte already
        /// there.
        ///
        /// `content-disposition` affects navigations and never subresource
        /// loads, so `<img src>` keeps working. `sandbox` with no allow-list
        /// puts a directly-navigated response in an opaque origin, so even a
        /// document served from here cannot reach the app origin's storage —
        /// which is where the Internet Identity session lives.
        let userUploadHeaders : [Painless.HeaderField] = [
            ("content-disposition", "attachment"),
            ("content-security-policy", "default-src 'none'; sandbox"),
        ];

        /// Vite emits content-hashed filenames under /assets/, so those are
        /// immutable. Everything else stays revalidated.
        func cacheControl(url : Text) : Text {
            if (Text.startsWith(url, #text "/assets/")) {
                "public, max-age=31536000, immutable";
            } else {
                "public, no-cache";
            };
        };

        /// Response-verification v1 lets the gateway accept a witness for
        /// `/index.html` when the requested path is absent from the tree.
        /// That is what makes SPA deep links work: without it an unknown path
        /// returns an uncertified 404, which the gateway turns into a 503.
        public let INDEX_FALLBACK = "/index.html";

        /// `http_request`. Pass the actor's own streaming callback so Painless
        /// can attach it when the body spans several chunks.
        public func http(request : Painless.Request, cb : Painless.CallbackFunc) : Painless.Response {
            if (request.method != "GET") return Painless.NotFound(request.url);
            let url = canonical(request.url);

            switch (servable(url)) {
                case (?asset) serve(asset, url, request, cb);
                // Only routes fall back. A missing *file* — say a package that
                // has since been replaced — would otherwise download the SPA
                // shell under the old name, which is worse than a plain 404.
                case null {
                    if (looksLikeFile(url)) return Painless.NotFound(url);
                    switch (servable(INDEX_FALLBACK)) {
                        case (?index) serve(index, INDEX_FALLBACK, request, cb);
                        case null Painless.NotFound(url);
                    };
                };
            };
        };

        /// A dot in the last path segment: `/pkg/app.neutron` is a file,
        /// `/season/2` is a route.
        func looksLikeFile(url : Text) : Bool {
            var last = "";
            for (part in Text.split(url, #char '/')) { last := part };
            Text.contains(last, #text ".");
        };

        func servable(key : Text) : ?Asset {
            let ?asset = get(key) else return null;
            if (asset.complete) ?asset else null;
        };

        func serve(
            asset : Asset,
            url : Text,
            request : Painless.Request,
            cb : Painless.CallbackFunc,
        ) : Painless.Response {
            Painless.Request(
                { request with url },
                {
                    chunkFunc = func(_key : Text, _index : Nat) : Painless.Chunk {
                        if (asset.chunks > 1) #more(chunk(asset, 0)) else #end(chunk(asset, 0));
                    };
                    cbFunc = cb;
                    headers = headersFor(asset, url);
                },
            );
        };

        /// `http_request_streaming_callback`.
        public func callback(token : Painless.Token) : Painless.Callback {
            Painless.Callback(
                token,
                {
                    chunkFunc = func(key : Text, index : Nat) : Painless.Chunk {
                        let ?asset = get(key) else return #none;
                        if (not asset.complete) return #none;
                        if (asset.parts.size() != asset.chunks) return #none;
                        if (index >= asset.chunks) return #none;
                        if (index + 1 < asset.chunks) {
                            #more(chunk(asset, index));
                        } else {
                            #end(chunk(asset, index));
                        };
                    };
                },
            );
        };
    };
};
