import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { Principal } from "@dfinity/principal";

import {
  digestOf,
  gatewayUrl,
  selfControlled,
  verifyGateway,
} from "../../scripts/verify-web.mjs";

describe("the public frontend verifier", () => {
  let dist;
  const files = new Map([
    ["/", ["<!doctype html><title>Release</title>", "text/html"]],
    ["/index.html", ["<!doctype html><title>Release</title>", "text/html"]],
    ["/assets/app.js", ["console.log('release')", "application/javascript"]],
    ["/assets/app.css", ["body{color:#fff}", "text/css"]],
    ["/__release_verifier__/deep-link", ["<!doctype html><title>Release</title>", "text/html"]],
  ]);

  before(() => {
    dist = mkdtempSync(join(tmpdir(), "neutron-verify-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), files.get("/")[0]);
    writeFileSync(join(dist, "assets", "app.js"), files.get("/assets/app.js")[0]);
    writeFileSync(join(dist, "assets", "app.css"), files.get("/assets/app.css")[0]);
  });

  after(() => rmSync(dist, { recursive: true, force: true }));

  const serving = (overrides = new Map()) => async (input) => {
    const path = new URL(input).pathname;
    const [body, contentType] = overrides.get(path) ?? files.get(path) ?? ["missing", "text/plain"];
    return new Response(body, {
      status: files.has(path) ? 200 : 404,
      headers: { "content-type": contentType },
    });
  };

  it("builds local and mainnet gateway URLs without a private toolchain", () => {
    assert.equal(
      gatewayUrl("aaaaa-aa", "local", "/assets/app.js"),
      "http://127.0.0.1:8943/assets/app.js?canisterId=aaaaa-aa",
    );
    assert.equal(
      gatewayUrl("aaaaa-aa", "ic", "/assets/app.js"),
      "https://aaaaa-aa.icp0.io/assets/app.js",
    );
  });

  it("recognizes only the canister itself as the exact sealed controller set", () => {
    const self = Principal.fromText("aaaaa-aa");
    const other = Principal.fromText("2vxsx-fae");
    assert.equal(selfControlled([self], self.toText()), true);
    assert.equal(selfControlled([], self.toText()), false);
    assert.equal(selfControlled([self, other], self.toText()), false);
    assert.equal(selfControlled([other], self.toText()), false);
  });

  it("hashes a checkout and verifies root, assets, and a deep route", async () => {
    assert.match(digestOf(dist).hash, /^[0-9a-f]{64}$/);
    assert.equal(
      await verifyGateway({
        distDir: dist,
        canisterId: "aaaaa-aa",
        environment: "local",
        fetchImpl: serving(),
      }),
      files.size,
    );
  });

  it("fails release verification when the gateway serves a stale byte", async () => {
    await assert.rejects(
      verifyGateway({
        distDir: dist,
        canisterId: "aaaaa-aa",
        environment: "ic",
        fetchImpl: serving(new Map([["/assets/app.js", ["console.log('old')", "application/javascript"]]])),
      }),
      /\/assets\/app\.js does not match/,
    );
  });

  it("fails when an asset is served under the wrong content type", async () => {
    await assert.rejects(
      verifyGateway({
        distDir: dist,
        canisterId: "aaaaa-aa",
        environment: "ic",
        fetchImpl: serving(new Map([["/assets/app.css", ["body{color:#fff}", "text/plain"]]])),
      }),
      /content-type text\/plain, expected text\/css/,
    );
  });
});
