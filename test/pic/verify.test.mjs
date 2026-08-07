/**
 * Does the canister's frontend digest agree with the one you can compute here?
 *
 * The feature is a claim about trust: load the site, ask the canister for
 * `frontend_hash()`, recompute it from a checkout with `npm run verify:web`,
 * and if they match you know the page came from that source. The whole value is
 * in the two numbers agreeing — a canister-side hash that nothing ever checked
 * against the local one is not a verification feature, it is a number.
 *
 * So these drive both implementations over the same inputs. The Motoko is in
 * `Assets.Use.frontendHash`; the JavaScript is `digestOfAssets` in
 * `scripts/verify-web.mjs`, the same function `verify:web` uses.
 *
 * The cases that matter are the ones where a weaker construction would still
 * pass: upload order, and the ambiguity a hash without length prefixes has.
 *
 * The last group is about what the number is worth rather than what it is. A
 * digest over a frontend somebody can still replace describes what is served
 * this minute and promises nothing about the next, so these end where a real
 * deployment ends: `seal_canister()` leaves exactly the canister itself as
 * controller and removes every external controller. That is also why every
 * upload above happens first: `assets_upload` is controller-gated, and after
 * sealing the installer is no longer a controller.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { digestOfAssets } from "../../scripts/verify-web.mjs";
import { MINUTE, bigints, bootstrap, identity, ok, register } from "./harness.mjs";

/** What `assets_upload` needs, and what the digest is computed over. */
const file = (key, body, contentType = "text/plain") => ({
  key,
  contentType,
  contentEncoding: "identity",
  body: Buffer.from(body),
});

const clearAll = { clear: { prefix: "/" } };

const store = (f) => ({
  store: {
    key: f.key,
    contentType: f.contentType,
    contentEncoding: f.contentEncoding,
    chunks: 1n,
    content: new Uint8Array(f.body),
  },
});

/** The same shape `digestOf` builds from a directory. */
const expectedFor = (files) =>
  digestOfAssets(
    new Map(
      files.map((f) => [
        f.key,
        {
          contentType: f.contentType,
          contentEncoding: f.contentEncoding,
          sha256: createHash("sha256").update(f.body).digest(),
        },
      ]),
    ),
  );

describe("the frontend digest", () => {
  let env;
  /** Appointed while there is still a controller to appoint one. */
  let moderator;
  /** Drafted before the seal, started after it. */
  let drafted;

  before(async () => {
    env = await bootstrap();
  });
  after(async () => await env?.teardown());

  it("agrees with the digest computed off the filesystem", async () => {
    const files = [
      file("/index.html", "<!doctype html><title>Neutron</title>", "text/html"),
      file("/", "<!doctype html><title>Neutron</title>", "text/html"),
      file("/assets/index-abc123.js", "console.log(1)", "application/javascript"),
      file("/assets/index-def456.css", "body{margin:0}", "text/css"),
    ];
    for (const f of files) ok(await env.actor.assets_upload(store(f)), `upload ${f.key}`);

    assert.equal(await env.actor.frontend_hash(), expectedFor(files));
  });

  it("does not depend on the order the files were uploaded in", async () => {
    // A rolling hash folded in upload order would pass every other test here
    // and fail this one — and would be unreproducible from a checkout, because
    // a directory listing does not record what order anybody uploaded in.
    const first = await env.actor.frontend_hash();

    ok(await env.actor.assets_upload(clearAll), "clear");
    const reversed = [
      file("/assets/index-def456.css", "body{margin:0}", "text/css"),
      file("/assets/index-abc123.js", "console.log(1)", "application/javascript"),
      file("/", "<!doctype html><title>Neutron</title>", "text/html"),
      file("/index.html", "<!doctype html><title>Neutron</title>", "text/html"),
    ];
    for (const f of reversed) ok(await env.actor.assets_upload(store(f)), `upload ${f.key}`);
    assert.equal(await env.actor.frontend_hash(), first, "the reverse order hashes the same");
  });

  it("changes when a byte of any file changes", async () => {
    const before = await env.actor.frontend_hash();
    ok(
      await env.actor.assets_upload(
        store(file("/assets/index-abc123.js", "console.log(2)", "application/javascript")),
      ),
    );
    assert.notEqual(await env.actor.frontend_hash(), before, "a changed file is a changed build");
  });

  it("changes when only a content type changes", async () => {
    // The bytes are identical; what the browser is told to do with them is not.
    // A digest over content alone would call these the same build.
    const before = await env.actor.frontend_hash();
    ok(await env.actor.assets_upload(store(file("/assets/plain.txt", "hello", "text/plain"))));
    const withText = await env.actor.frontend_hash();
    assert.notEqual(withText, before);

    ok(await env.actor.assets_upload(store(file("/assets/plain.txt", "hello", "text/html"))));
    assert.notEqual(await env.actor.frontend_hash(), withText, "the type is part of the build");
  });

  it("cannot be fooled by moving a boundary between key and type", async () => {
    // The length-prefix case. Without a prefix per field, `("ab", "c")` and
    // `("a", "bc")` produce the same byte stream and therefore the same digest,
    // and a file could be renamed into another's content type without the
    // digest noticing. These two builds differ only in where that boundary
    // falls, so a construction that concatenated would call them identical.
    ok(await env.actor.assets_upload(clearAll), "clear");
    ok(await env.actor.assets_upload(store(file("/ab", "x", "c"))));
    const left = await env.actor.frontend_hash();

    ok(await env.actor.assets_upload(clearAll), "clear");
    ok(await env.actor.assets_upload(store(file("/a", "x", "bc"))));
    assert.notEqual(await env.actor.frontend_hash(), left);
  });

  it("ignores what participants upload, and only that", async () => {
    // A hacker's screenshot is not part of the build, and the digest has to
    // stay still while a season fills up with them — otherwise it would change
    // hourly and verify nothing.
    const before = await env.actor.frontend_hash();

    // Registration is the whole of the acceptance, and it covers every role, so
    // taking the hacker seat asks for nothing beyond having an account.
    const hacker = await register(env.as, identity(7700), "digest_hacker");
    ok(await hacker.set_hacker(true));
    const [me] = await hacker.me();
    ok(
      await hacker.my_upload(
        store(file(`/u/${me.id}/icon/a.png`, "not really a png", "image/png")),
      ),
      "a participant's own upload",
    );

    assert.equal(await env.actor.frontend_hash(), before, "user files are not the build");
  });

  it("is a stable answer, not a fresh one each time", async () => {
    const once = await env.actor.frontend_hash();
    assert.equal(await env.actor.frontend_hash(), once);
    assert.match(once, /^[0-9a-f]{64}$/, "a sha256, in lower-case hex");
  });

  // ── From here the canister is sealed, and stays that way ─────────────────
  //
  // These run last because they cannot be undone. Everything above needed a
  // controller to upload with; nothing below has one. The order is the order a
  // real deployment goes in — appoint the full cast, upload, create the exact
  // draft, close registration, seal, then start — and it is not a preference,
  // it is the only order that works.

  it("will not start a season while anybody still holds the keys", async () => {
    // The digest claims the build cannot be swapped. That claim is only true
    // after the seal, so `start_season` asks the replica who controls the
    // canister rather than trusting whoever ran the deploy to have remembered.
    // A season begun a moment early would look identical from outside to one
    // begun correctly, and its rules would still be somebody's to rewrite.
    moderator = await register(env.as, identity(7701), "digest_mod");
    ok(await env.actor.set_moderator("digest_mod", true, []), "appoint a moderator");

    // A moderator's call, not the installer's: after the seal there is no
    // external controller, so an ingress controller gate would be impassable.
    drafted = ok(await moderator.create_season(), "draft a season");

    const refused = await moderator.start_season(drafted.id);
    assert.ok(
      refused.err?.Invalid,
      `expected a refusal, got ${JSON.stringify(refused, bigints)}`,
    );
    assert.match(refused.err.Invalid, /not sealed|seal_canister/, "and it says why");
  });

  it("ends up controlled only by the canister itself", async () => {
    assert.equal(await env.actor.launch_latched(), false, "the durable latch starts open");
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()).sort(),
      [env.canisterId.toText(), env.controller.getPrincipal().toText()].sort(),
      "the fixture starts with the canister and installer holding the keys",
    );

    ok(await env.seal(), "seal");

    // The check that matters is certified replica state, not a flag the
    // canister set on itself. The exact singleton self list is the whole claim.
    const after = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      after.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the canister itself is the sole controller",
    );
    assert.equal(
      await env.actor.launch_latched(),
      true,
      "seal_canister leaves a public durable witness until launch",
    );
  });

  it("lets a moderator start the season the controller no longer can", async () => {
    // The authority that survives sealing is whatever the installed code
    // grants. That is why the moderator was appointed two tests ago, while
    // there was still a controller able to appoint one.
    const started = ok(await moderator.start_season(drafted.id), "a moderator starts it");
    assert.equal(Object.keys(started.phase)[0], "running");
    assert.equal(await env.actor.launch_latched(), false, "the running phase replaces the latch");
  });

  it("can never be handed another build", async () => {
    // The identity that installed this canister and uploaded every file above
    // has no powers left at all — so the digest published now is the digest for
    // the rest of the canister's life.
    const sealed = await env.actor.frontend_hash();
    const refused = await env.actor.assets_upload(
      store(file("/index.html", "<!doctype html><title>Swapped</title>", "text/html")),
    );
    assert.ok(refused.err, `expected a refusal, got ${JSON.stringify(refused, bigints)}`);
    assert.equal(await env.actor.frontend_hash(), sealed, "and the build is untouched");
  });

  it("can never be handed another module either", async () => {
    // A digest is only worth as much as the code computing it. A canister that
    // could still be upgraded could be given a `frontend_hash` that returns
    // whatever a checkout expects while serving something else entirely, and
    // the two numbers would agree for the wrong reason. `install_code` needs a
    // controller to accept it from, and there is none.
    //
    // The clock has to move first. A replica rate-limits `install_code` for
    // minutes after an install, and *that* rejection would pass this test
    // while proving nothing — so the wait clears it, and the message is
    // matched rather than merely counted, to pin which refusal this is.
    await env.advance(30 * MINUTE);
    await assert.rejects(
      env.upgrade(),
      /Only controllers/,
      "the former deployer cannot upgrade a sealed canister",
    );
  });
});

describe("the durable launch-sealing latch", () => {
  let env;

  before(async () => {
    env = await bootstrap();
  });
  after(async () => await env?.teardown());

  it("fails closed when an operator removes controllers without seal_canister", async () => {
    const moderator = await register(env.as, identity(7790), "manual_blackhole_mod");
    ok(await env.actor.set_moderator("manual_blackhole_mod", true, []), "appoint moderator");
    const draft = ok(await moderator.create_season(), "create launch-ready draft");
    await env.prepareLaunch();

    // This deliberately reproduces the operator mistake. The replica really
    // is controllerless afterwards, but the canister never set its durable
    // sealing latch because `seal_canister` did not perform the transition.
    await env.pic.updateCanisterSettings({
      canisterId: env.canisterId,
      sender: env.controller.getPrincipal(),
      controllers: [],
    });
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(held, [], "the manual settings call really blackholed the canister");
    assert.equal(
      await env.actor.launch_latched(),
      false,
      "manual controller removal cannot forge the seal_canister witness",
    );

    const refused = await moderator.start_season(draft.id);
    assert.ok(
      refused.err?.Invalid,
      `expected a fail-closed refusal, got ${JSON.stringify(refused, bigints)}`,
    );
    assert.match(refused.err.Invalid, /seal_canister/, "the refusal names the only valid path");

    const [unchanged] = await env.actor.season();
    assert.ok("draft" in unchanged.phase, "manual blackholing cannot start or mutate the draft");
  });
});
