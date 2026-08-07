import Blob "mo:core/Blob";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Test "mo:test";

import Assets "../backend/lib/Assets";
import Painless "../backend/lib/Painless";

persistent actor AssetTests {

    func fresh() : Assets.Use = Assets.Use(Assets.init());

    func get(url : Text) : Painless.Request = {
        method = "GET";
        url;
        headers = [];
        body = "" : Blob;
        certificate_version = ?2;
    };

    // A `Painless.CallbackFunc` has to be a real shared query function. `ash`
    // skips it as a test because it takes an argument.
    public query func chunk_callback(token : Painless.Token) : async Painless.Callback {
        fresh().callback(token);
    };

    func store(a : Assets.Use, key : Text, body : Blob) : Result.Result<(), Text> {
        a.upload(
            #store({
                key;
                contentType = "text/plain";
                contentEncoding = "identity";
                chunks = 1;
                content = body;
            }),
            null,
            Assets.defaultLimits,
        );
    };

    func mustStore(a : Assets.Use, key : Text, body : Blob) {
        switch (store(a, key, body)) {
            case (#ok) {};
            case (#err(e)) Runtime.trap("store failed: " # e);
        };
    };

    // ── User uploads ─────────────────────────────────────────────────────────

    /// What an upload is for comes from the folder it goes into, never from
    /// the caller. When the caller declared it, every cap was advisory: ask for
    /// the package limit and a 1.9 MB avatar went through.
    public func the_folder_decides_how_large_an_upload_may_be() : async Test.Metrics {
        Test.test(
            func() {
                let scope = "/u/7/";

                assert Assets.kindFor(scope # "avatar/1.png", scope) == ?#avatar;
                // An icon has its own class now: it is drawn at a few dozen pixels
                // and is held to the same 100 KB cap as an avatar.
                assert Assets.kindFor(scope # "icon/1.png", scope) == ?#icon;
                assert Assets.kindFor(scope # "shots/1.png", scope) == ?#media;
                assert Assets.kindFor(scope # "pkg/1700000000000.neutron", scope) == ?#package;

                // Participant URLs have one exact browser-stable spelling.
                for (ext in [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"].vals()) {
                    assert Assets.kindFor(scope # "icon/app_1-x" # ext, scope) == ?#icon;
                };
                for (key in [
                    scope # "icon/a.svg",
                    scope # "icon/a.html",
                    scope # "icon/a.png.exe",
                    scope # "icon/a.b.png",
                    scope # "icon/sub/a.png",
                    scope # "pkg/setup.exe",
                    scope # "pkg/build.neutron",
                    scope # "pkg/1.zip",
                    scope # "pkg/sub/1.neutron",
                    scope # "pkg/1.neutron.neutron",
                ].vals()) {
                    assert Assets.kindFor(key, scope) == null;
                };

                // Not a folder we know, so not an upload we take.
                assert Assets.kindFor(scope # "anything/1.png", scope) == null;
                assert Assets.kindFor(scope # "1.png", scope) == null;
                // The old avatar shape was a prefix, not a folder.
                assert Assets.kindFor(scope # "avatar-123", scope) == null;
                // Somebody else's namespace, however plausible the folder.
                assert Assets.kindFor("/u/8/pkg/1.neutron", scope) == null;

                // And the folder a caller cannot pick maps to a real cap.
                assert Assets.limitsFor(#avatar).maxBytes == 100_000;
                assert Assets.limitsFor(#icon).maxBytes == 100_000;
                assert Assets.limitsFor(#media).maxBytes == 400_000;
                assert Assets.limitsFor(#package).maxBytes > 1_000_000;
                assert Assets.limitsFor(#icon).maxBytes < Assets.limitsFor(#media).maxBytes;
                assert Assets.limitsFor(#avatar).maxBytes == Assets.limitsFor(#icon).maxBytes;

                // Avatar/logo uploads remain available to ordinary accounts;
                // app material requires the hacker role. Deletes are handled
                // separately by the actor and remain available to both.
                assert not Assets.isAppKind(#avatar);
                assert Assets.isAppKind(#icon);
                assert Assets.isAppKind(#media);
                assert Assets.isAppKind(#package);
                assert Assets.mayWriteKind(#avatar, false);
                assert not Assets.mayWriteKind(#icon, false);
                assert not Assets.mayWriteKind(#media, false);
                assert not Assets.mayWriteKind(#package, false);
                assert Assets.mayWriteKind(#package, true);

                assert Assets.maxKeysFor(false) == 2;
                assert Assets.maxKeysFor(true) == 64;
                // Two complete small slots let an avatar/logo replacement
                // land before the displaced key is removed.
                assert Assets.maxBytesFor(false) == 262_144;
                assert Assets.maxBytesFor(true) == 32_000_000;
            }
        );
    };

    /// A `#clear` names a prefix rather than a key, and wiping a prefix is not
    /// something a participant does. It has no key, so it has no folder, so it
    /// cannot reach the user upload path at all.
    public func a_user_upload_command_always_names_one_key() : async Test.Metrics {
        Test.test(
            func() {
                assert Assets.keyOf(#store({
                    key = "/u/7/icon/a.png";
                    contentType = "image/png";
                    contentEncoding = "identity";
                    chunks = 1;
                    content = "" : Blob;
                })) == ?"/u/7/icon/a.png";
                assert Assets.keyOf(#chunk({ key = "/u/7/pkg/a"; index = 1; content = "" : Blob })) == ?"/u/7/pkg/a";
                assert Assets.keyOf(#delete({ key = "/u/7/icon/a.png" })) == ?"/u/7/icon/a.png";
                assert Assets.keyOf(#clear({ prefix = "/u/" })) == null;
            }
        );
    };

    /// A key is bounded, and bounded *here* rather than by whoever calls.
    ///
    /// A key outlives the call three times over — as the map key, as the
    /// certification tree's key blob, and as a byte array inside the merkle
    /// node — so an unbounded one is several times its own length in heap,
    /// bought with a single message and never handed back. `MAX_KEY` used to be
    /// enforced only by the row layers that *reference* a key, so an upload no
    /// row ever pointed at skipped it entirely. On a canister that seals itself
    /// there is no controller left to clear the result.
    public func a_key_longer_than_the_limit_is_refused() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                var long = "/u/7/icon/";
                while (long.size() <= Assets.MAX_KEY) long #= "aaaaaaaaaa";
                long #= ".png";

                switch (store(a, long, "x" : Blob)) {
                    case (#err(_)) {};
                    case (#ok) Runtime.trap("an oversized key was accepted");
                };
                // Nothing was written, so nothing is serving it either.
                assert a.info(long) == null;

                // Every command that names something is bounded, not just the
                // one that writes bytes — `#clear` names a prefix.
                switch (a.upload(#delete({ key = long }), null, Assets.defaultLimits)) {
                    case (#err(_)) {};
                    case (#ok) Runtime.trap("an oversized key was accepted by delete");
                };
                switch (a.upload(#clear({ prefix = long }), null, Assets.defaultLimits)) {
                    case (#err(_)) {};
                    case (#ok) Runtime.trap("an oversized prefix was accepted by clear");
                };

                // A short Unicode string can still be an expensive retained
                // key. The byte limit is the resource boundary for new rows.
                var wide = "/u/7/icon/";
                while (Text.encodeUtf8(wide # ".png").size() <= Assets.MAX_KEY_BYTES) {
                    wide #= "🧪";
                };
                wide #= ".png";
                assert wide.size() < Assets.MAX_KEY;
                assert Text.encodeUtf8(wide).size() > Assets.MAX_KEY_BYTES;
                switch (store(a, wide, "x" : Blob)) {
                    case (#err(_)) {};
                    case (#ok) Runtime.trap("a byte-oversized key was accepted");
                };
                // Cleanup keeps the old scalar boundary so a legacy key can
                // never become impossible to remove during account deletion.
                switch (a.upload(#delete({ key = wide }), null, Assets.defaultLimits)) {
                    case (#ok) {};
                    case (#err(e)) Runtime.trap("legacy-compatible delete failed: " # e);
                };

                var edge = "/u/7/icon/";
                while (Text.encodeUtf8(edge # ".png").size() < Assets.MAX_KEY_BYTES) {
                    edge #= "a";
                };
                edge #= ".png";
                assert Text.encodeUtf8(edge).size() == Assets.MAX_KEY_BYTES;
                mustStore(a, edge, "x" : Blob);

                // And a key of a reasonable length still works, so the bound is
                // a bound rather than a wall.
                mustStore(a, "/u/7/icon/a.png", "x" : Blob);
            }
        );
    };

    /// One user's namespace is not a prefix of another's.
    ///
    /// `/u/1/` and `/u/11/` differ by the trailing slash and nothing else, and
    /// the slash is the whole reason user 1 cannot write into user 11's files.
    /// That is correct by construction rather than by coverage, which is
    /// exactly the kind of thing somebody simplifies away — so it is pinned.
    public func a_scope_is_not_a_prefix_of_a_longer_id() : async Test.Metrics {
        Test.test(
            func() {
                assert Assets.inScope("/u/11/icon/a.png", ?"/u/1/") == false;
                assert Assets.inScope("/u/1/icon/a.png", ?"/u/1/") == true;
                // The same trap one level down: a folder is a folder, not a
                // prefix of a longer name.
                assert Assets.kindFor("/u/1/iconography/a.png", "/u/1/") == null;
                // And traversal still does not get out, however it is dressed.
                assert Assets.inScope("/u/1/../11/icon/a.png", ?"/u/1/") == false;
                assert Assets.inScope("/u/1//icon/a.png", ?"/u/1/") == false;
                assert Assets.inScope("/u/1/icon/./a.png", ?"/u/1/") == false;
                assert Assets.inScope("/u/1/icon/%2e/a.png", ?"/u/1/") == false;
                assert Assets.inScope("/u/1/icon/a.png?reviewed", ?"/u/1/") == false;
                assert Assets.inScope("/u/1/icon/a.png#reviewed", ?"/u/1/") == false;
                assert Assets.inScope("/u/1/icon/dir\\a.png", ?"/u/1/") == false;
            }
        );
    };

    // ── Where the bytes live ─────────────────────────────────────────────────

    /// The reason this store exists: a slot handed back must be reused, or the
    /// canister reserves stable memory for every file it has ever held.
    public func replacing_a_file_reuses_its_slot() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/one.txt", "aaaa");
                mustStore(a, "/two.txt", "bbbb");
                let before = a.storage().reserved;

                // Same key, new bytes, many times over.
                var i = 0;
                while (i < 20) {
                    mustStore(a, "/one.txt", "cccc");
                    i += 1;
                };
                assert a.storage().reserved == before;
                assert a.info("/one.txt") != null;
                assert a.info("/two.txt") != null;
            }
        );
    };

    public func deleting_a_file_hands_its_slot_back() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/keep.txt", "aaaa");
                mustStore(a, "/going.txt", "bbbb");
                let before = a.storage().reserved;
                assert a.storage().liveSlots == 2;

                ignore a.upload(#delete({ key = "/going.txt" }), null, Assets.defaultLimits);
                assert a.storage().liveSlots == 1;

                // The freed slot is taken by the next file rather than growing.
                mustStore(a, "/new.txt", "cccc");
                assert a.storage().reserved == before;
                assert a.storage().liveSlots == 2;
            }
        );
    };

    public func a_deleted_file_does_not_serve_its_successors_bytes() : async Test.Metrics {
        Test.test(
            func() {
                // The failure a slot store makes possible: one file removed,
                // its slot reused, and the old key still serving — now with
                // somebody else's content.
                let a = fresh();
                mustStore(a, "/keep.txt", "keep");
                mustStore(a, "/secret.txt", "hunter2");
                ignore a.upload(#delete({ key = "/secret.txt" }), null, Assets.defaultLimits);
                mustStore(a, "/public.txt", "harmless");

                assert a.info("/secret.txt") == null;
                let gone = a.http(get("/secret.txt"), chunk_callback);
                assert gone.status_code == 404;
                assert a.http(get("/public.txt"), chunk_callback).body == "harmless";
                assert a.http(get("/keep.txt"), chunk_callback).body == "keep";
            }
        );
    };

    public func clearing_a_prefix_hands_every_slot_back() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/u/1/a.txt", "aaaa");
                mustStore(a, "/u/1/b.txt", "bbbb");
                mustStore(a, "/other.txt", "cccc");
                assert a.storage().liveSlots == 3;

                ignore a.upload(#clear({ prefix = "/u/1/" }), null, Assets.defaultLimits);
                assert a.storage().liveSlots == 1;
                assert a.info("/other.txt") != null;
            }
        );
    };

    /// Prefix enumeration is also the hot path for participant key quotas.
    /// It must return only the contiguous ordered range even when unrelated
    /// keys sort on both sides of it.
    public func keys_seek_to_the_requested_prefix_range() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/before.txt", "a");
                mustStore(a, "/u/2/avatar/a.png", "b");
                mustStore(a, "/u/2/icon/b.png", "c");
                mustStore(a, "/u/20/avatar/not-user-two.png", "d");
                mustStore(a, "/z-after.txt", "e");

                assert a.keys("/u/2/", 10) == [
                    "/u/2/avatar/a.png",
                    "/u/2/icon/b.png",
                ];
                assert a.keys("/u/2/", 1) == ["/u/2/avatar/a.png"];
                assert a.keys("/missing/", 10) == [];
                assert a.keys("", 2) == ["/before.txt", "/u/2/avatar/a.png"];
            }
        );
    };

    public func the_index_knows_a_size_without_reading_the_file() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/sized.txt", "0123456789");
                let ?info = a.info("/sized.txt") else Runtime.trap("no info");
                assert info.size == 10;
            }
        );
    };

    // ── Serving ──────────────────────────────────────────────────────────────

    public func serves_a_single_chunk_asset() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/", "<html>hi</html>");
                let res = a.http(get("/"), chunk_callback);
                assert res.status_code == 200;
                assert res.body == "<html>hi</html>";
                assert res.streaming_strategy == null;
            }
        );
    };

    public func returns_404_for_a_missing_key() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                // No /index.html stored, so nothing to fall back to.
                assert a.http(get("/nope"), chunk_callback).status_code == 404;
            }
        );
    };

    /// Verified against a real replica: the gateway accepts the /index.html
    /// witness for a path that is absent from the tree, so SPA deep links
    /// return 200 instead of the 503 an uncertified 404 would produce.
    public func falls_back_to_index_html_for_unknown_paths() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/", "<html>app</html>");
                mustStore(a, "/index.html", "<html>app</html>");
                mustStore(a, "/assets/app.js", "code");

                for (path in ["/participants", "/u/alice", "/deep/nested/route"].vals()) {
                    let res = a.http(get(path), chunk_callback);
                    assert res.status_code == 200;
                    assert res.body == "<html>app</html>";
                };

                // Real assets still win over the fallback.
                assert a.http(get("/assets/app.js"), chunk_callback).body == "code";
            }
        );
    };

    public func does_not_fall_back_when_index_is_incomplete() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                switch (
                    a.upload(
                        #store({
                            key = "/index.html";
                            contentType = "text/html";
                            contentEncoding = "identity";
                            chunks = 2;
                            content = "half";
                        }),
                        null,
                        Assets.defaultLimits,
                    )
                ) { case (#ok) {}; case (#err(e)) Runtime.trap(e) };

                assert a.http(get("/anything"), chunk_callback).status_code == 404;
            }
        );
    };

    public func ignores_query_string_and_fragment() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/", "index");
                assert a.http(get("/?tab=profile"), chunk_callback).body == "index";
                assert a.http(get("/#/judges"), chunk_callback).body == "index";
                assert Assets.canonical("/a/b.js?v=1#x") == "/a/b.js";
            }
        );
    };

    public func rejects_non_get_methods() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/", "index");
                let post = { get("/") with method = "POST" };
                assert a.http(post, chunk_callback).status_code == 404;
            }
        );
    };

    public func attaches_content_type_and_certificate_headers() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/app.js", "console.log(1)");
                let res = a.http(get("/app.js"), chunk_callback);
                var sawType = false;
                var sawCert = false;
                var sawImmutableCache = false;
                for ((name, value) in res.headers.vals()) {
                    if (name == "content-type" and value == "text/plain") sawType := true;
                    if (name == "ic-certificate") sawCert := true;
                    if (name == "cache-control" and value == "public, no-cache") sawImmutableCache := true;
                };
                assert sawType;
                assert sawCert;
                assert sawImmutableCache;
            }
        );
    };

    /// Signup and app forms preview a chosen image through URL.createObjectURL
    /// before uploading it. That URL has the `blob:` scheme; keep it available
    /// to app pages without weakening the sandbox on participant files.
    public func app_csp_allows_local_blob_previews_without_relaxing_uploads() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/", "<html>app</html>");
                mustStore(a, "/u/7/avatar/photo.jpg", "photo");

                var appPolicy = "";
                var appPolicies = 0;
                for ((name, value) in a.http(get("/"), chunk_callback).headers.vals()) {
                    if (name == "content-security-policy") {
                        appPolicy := value;
                        appPolicies += 1;
                    };
                };
                assert appPolicies == 1;
                assert appPolicy == "img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

                var uploadPolicy = "";
                var uploadPolicies = 0;
                var disposition = "";
                for ((name, value) in a.http(get("/u/7/avatar/photo.jpg"), chunk_callback).headers.vals()) {
                    if (name == "content-security-policy") {
                        uploadPolicy := value;
                        uploadPolicies += 1;
                    };
                    if (name == "content-disposition") disposition := value;
                };
                assert uploadPolicies == 1;
                assert uploadPolicy == "default-src 'none'; sandbox";
                assert disposition == "attachment";
            }
        );
    };

    public func marks_hashed_bundle_paths_immutable() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/assets/main-abc123.js", "x");
                let res = a.http(get("/assets/main-abc123.js"), chunk_callback);
                var cache = "";
                for ((name, value) in res.headers.vals()) {
                    if (name == "cache-control") cache := value;
                };
                assert cache == "public, max-age=31536000, immutable";
            }
        );
    };

    public func omits_content_encoding_for_identity() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/plain.txt", "hello");
                for ((name, _) in a.http(get("/plain.txt"), chunk_callback).headers.vals()) {
                    assert name != "content-encoding";
                };

                switch (
                    a.upload(
                        #store({
                            key = "/z.js";
                            contentType = "application/javascript";
                            contentEncoding = "gzip";
                            chunks = 1;
                            content = "\1F\8B";
                        }),
                        null,
                        Assets.defaultLimits,
                    )
                ) {
                    case (#ok) {};
                    case (#err(e)) Runtime.trap(e);
                };
                var sawGzip = false;
                for ((name, value) in a.http(get("/z.js"), chunk_callback).headers.vals()) {
                    if (name == "content-encoding" and value == "gzip") sawGzip := true;
                };
                assert sawGzip;
            }
        );
    };

    // ── Chunking ─────────────────────────────────────────────────────────────

    public func streams_a_multi_chunk_asset() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                switch (
                    a.upload(
                        #store({
                            key = "/big.bin";
                            contentType = "application/octet-stream";
                            contentEncoding = "identity";
                            chunks = 3;
                            content = "aaa";
                        }),
                        null,
                        Assets.defaultLimits,
                    )
                ) { case (#ok) {}; case (#err(e)) Runtime.trap(e) };

                // Not servable until every chunk has arrived.
                assert a.http(get("/big.bin"), chunk_callback).status_code == 404;

                switch (a.upload(#chunk({ key = "/big.bin"; index = 1; content = "bbb" }), null, Assets.defaultLimits)) {
                    case (#ok) {};
                    case (#err(e)) Runtime.trap(e);
                };
                assert a.http(get("/big.bin"), chunk_callback).status_code == 404;

                switch (a.upload(#chunk({ key = "/big.bin"; index = 2; content = "ccc" }), null, Assets.defaultLimits)) {
                    case (#ok) {};
                    case (#err(e)) Runtime.trap(e);
                };

                let res = a.http(get("/big.bin"), chunk_callback);
                assert res.status_code == 200;
                assert res.body == "aaa";
                assert res.streaming_strategy != null;

                let token : Painless.Token = {
                    key = "/big.bin";
                    sha256 = null;
                    index = 1;
                    content_encoding = "";
                };
                let second = a.callback(token);
                assert second.body == "bbb";
                assert second.token != null;

                let third = a.callback({ token with index = 2 });
                assert third.body == "ccc";
                assert third.token == null;
            }
        );
    };

    public func rejects_out_of_order_chunks() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                switch (
                    a.upload(
                        #store({
                            key = "/big.bin";
                            contentType = "application/octet-stream";
                            contentEncoding = "identity";
                            chunks = 3;
                            content = "aaa";
                        }),
                        null,
                        Assets.defaultLimits,
                    )
                ) { case (#ok) {}; case (#err(e)) Runtime.trap(e) };

                switch (a.upload(#chunk({ key = "/big.bin"; index = 2; content = "ccc" }), null, Assets.defaultLimits)) {
                    case (#err(_)) {};
                    case (#ok) Runtime.trap("expected out-of-order rejection");
                };
            }
        );
    };

    public func rejects_a_chunk_for_an_unknown_key() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                switch (a.upload(#chunk({ key = "/ghost"; index = 1; content = "x" }), null, Assets.defaultLimits)) {
                    case (#err(_)) {};
                    case (#ok) Runtime.trap("expected error");
                };
            }
        );
    };

    public func rejects_zero_chunk_uploads() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                switch (
                    a.upload(
                        #store({
                            key = "/x";
                            contentType = "text/plain";
                            contentEncoding = "identity";
                            chunks = 0;
                            content = "";
                        }),
                        null,
                        Assets.defaultLimits,
                    )
                ) { case (#err(_)) {}; case (#ok) Runtime.trap("expected error") };
            }
        );
    };

    // ── Scoping ──────────────────────────────────────────────────────────────

    public func confines_a_scoped_caller_to_its_prefix() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                let scope = ?"/u/7/";
                let ok = a.upload(
                    #store({
                        key = "/u/7/avatar.png";
                        contentType = "image/png";
                        contentEncoding = "identity";
                        chunks = 1;
                        content = "\89PNG";
                    }),
                    scope,
                    Assets.avatarLimits,
                );
                switch (ok) { case (#ok) {}; case (#err(e)) Runtime.trap(e) };

                let bad = a.upload(
                    #store({
                        key = "/index.html";
                        contentType = "text/html";
                        contentEncoding = "identity";
                        chunks = 1;
                        content = "pwned";
                    }),
                    scope,
                    Assets.avatarLimits,
                );
                switch (bad) { case (#err(_)) {}; case (#ok) Runtime.trap("scope escape") };
            }
        );
    };

    public func rejects_traversal_and_relative_keys() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                for (key in ["/u/7/../../index.html", "no-leading-slash", "/a//b"].vals()) {
                    switch (store(a, key, "x")) {
                        case (#err(_)) {};
                        case (#ok) Runtime.trap("accepted bad key: " # key);
                    };
                };
            }
        );
    };

    public func stops_a_scoped_clear_from_wiping_the_site() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/index.html", "site");
                switch (a.upload(#clear({ prefix = "/" }), ?"/u/7/", Assets.avatarLimits)) {
                    case (#err(_)) {};
                    case (#ok) Runtime.trap("scope escape via clear");
                };
                assert a.http(get("/index.html"), chunk_callback).status_code == 200;
            }
        );
    };

    // ── Deletion ─────────────────────────────────────────────────────────────

    public func deletes_one_asset() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/a.txt", "a");
                mustStore(a, "/b.txt", "b");
                switch (a.upload(#delete({ key = "/a.txt" }), null, Assets.defaultLimits)) {
                    case (#ok) {};
                    case (#err(e)) Runtime.trap(e);
                };
                assert a.http(get("/a.txt"), chunk_callback).status_code == 404;
                assert a.http(get("/b.txt"), chunk_callback).status_code == 200;
                assert a.size() == 1;
            }
        );
    };

    public func clears_a_prefix() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/assets/one.js", "1");
                mustStore(a, "/assets/two.js", "2");
                mustStore(a, "/index.html", "keep");
                switch (a.upload(#clear({ prefix = "/assets/" }), null, Assets.defaultLimits)) {
                    case (#ok) {};
                    case (#err(e)) Runtime.trap(e);
                };
                assert a.size() == 1;
                assert a.http(get("/index.html"), chunk_callback).status_code == 200;
                assert a.info("/assets/one.js") == null;
                assert a.info("/assets/two.js") == null;
                // A cleared *file* is gone, not silently replaced by the SPA
                // shell: a stale link to a removed package should fail rather
                // than download HTML under a .neutron name.
                assert a.http(get("/assets/one.js"), chunk_callback).status_code == 404;
            }
        );
    };

    public func routes_fall_back_but_files_do_not() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/index.html", "shell");

                // A deep link has no dot in its last segment, so it is a route
                // and the SPA shell answers it — that is what makes hash-free
                // navigation work at all.
                let route = a.http(get("/season/2"), chunk_callback);
                assert route.status_code == 200;
                assert route.body == "shell";

                // Anything that looks like a file is answered honestly.
                assert a.http(get("/u/1/pkg/app.neutron"), chunk_callback).status_code == 404;
                assert a.http(get("/shots/gone.webp"), chunk_callback).status_code == 404;
            }
        );
    };

    // ── Listing ──────────────────────────────────────────────────────────────

    public func lists_assets_by_prefix() : async Test.Metrics {
        Test.test(
            func() {
                let a = fresh();
                mustStore(a, "/assets/one.js", "1");
                mustStore(a, "/assets/two.js", "22");
                mustStore(a, "/index.html", "x");
                mustStore(a, "/u/7/pkg/private.neutron", "private");

                assert a.list("/assets/", 10).size() == 2;
                assert a.list("/", 10).size() == 3;
                assert a.list("/u/", 10).size() == 0;
                assert a.list("/nothing", 10).size() == 0;

                let ?info = a.info("/assets/two.js") else Runtime.trap("no info");
                assert info.size == 2;
                assert info.chunks == 1;
                assert info.complete;
                assert info.contentType == "text/plain";
            }
        );
    };
};
