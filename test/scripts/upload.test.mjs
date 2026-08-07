import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  assertPreparedProduction,
  identityForEnvironment,
  parseArgs,
  productionUploadMode,
  pruneStaleAfterVerification,
  verifyDesiredSite,
} from "../../scripts/upload.mjs";
import { frontendTarget } from "../../scripts/frontend-target.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");

describe("frontend publication target guards", () => {
  it("lets explicit targets discard ambient sync canister ids", () => {
    const ambient = {
      ICP_CLI_ENVIRONMENT: "local",
      ICP_CLI_CID: "ambient-canister",
    };
    const explicitEnvironment = parseArgs(["-e", "ic"], ambient);
    assert.equal(explicitEnvironment.environment, "ic");
    assert.equal(explicitEnvironment.canisterId, undefined);

    const explicitCanister = parseArgs(
      ["-e", "local", "--canister-id", "explicit-canister"],
      ambient,
    );
    assert.equal(explicitCanister.canisterId, "explicit-canister");
    assert.equal(explicitCanister.canisterIdExplicit, true);
  });

  it("gives an explicit write-env target precedence over every ambient target", () => {
    const ambient = {
      ICP_CLI_ENVIRONMENT: "local",
      ICP_CLI_NETWORK: "local",
      ICP_CLI_CID_HACKATHON: "ambient-canister",
    };
    assert.deepEqual(frontendTarget(["ic"], ambient), {
      environment: "ic",
      network: "ic",
      inheritSyncCanisterIds: false,
    });
    assert.deepEqual(frontendTarget([], ambient), {
      environment: "local",
      network: "local",
      inheritSyncCanisterIds: true,
    });
  });

  it("wires every production entrypoint through checked publication", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const manifest = readFileSync(join(ROOT, "icp.yaml"), "utf8");
    assert.equal(pkg.scripts["upload:ic"], "npm run web -- -e ic");
    assert.match(manifest, /node scripts\/upload\.mjs --prepared/);
  });

  it("refuses a direct mainnet mutation but accepts its checked release handoff", () => {
    assert.equal(productionUploadMode(parseArgs(["-e", "ic"], {})), "refuse");
    assert.equal(
      productionUploadMode(parseArgs(["-e", "ic", "--prepared"], {})),
      "prepared",
    );
    assert.equal(productionUploadMode(parseArgs(["-e", "ic", "--dry-run"], {})), "direct");
    assert.equal(productionUploadMode(parseArgs(["-e", "local"], {})), "direct");

    const direct = spawnSync(process.execPath, ["scripts/upload.mjs", "-e", "ic"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(direct.status, 1);
    assert.match(direct.stderr, /direct mainnet upload is disabled/);
  });

  it("uses only the strict existing-key loader for production", async () => {
    const calls = [];
    const localIdentity = { getPrincipal: () => ({ toText: () => "local-principal" }) };
    const productionIdentity = {
      getPrincipal: () => ({ toText: () => "production-principal" }),
    };
    const loaders = {
      localLoader: async (id) => {
        calls.push(`local:${id}`);
        return localIdentity;
      },
      productionLoader: async (id) => {
        calls.push(`production:${id}`);
        return {
          identity: productionIdentity,
          principal: "production-principal",
          secretPath: "/secure/existing/key",
        };
      },
    };

    assert.equal((await identityForEnvironment("local", 4, loaders)).principal, "local-principal");
    assert.equal((await identityForEnvironment("ic", 7, loaders)).principal, "production-principal");
    assert.deepEqual(calls, ["local:4", "production:7"]);
  });

  it("does not generate a missing production identity", () => {
    const config = mkdtempSync(join(tmpdir(), "neutron-missing-key-"));
    const env = { ...process.env, XDG_CONFIG_HOME: config };
    delete env.SECRET;
    try {
      const whoami = spawnSync(
        process.execPath,
        ["scripts/upload.mjs", "--whoami", "-e", "ic"],
        { cwd: ROOT, encoding: "utf8", env },
      );
      assert.equal(whoami.status, 1);
      assert.match(whoami.stderr, /refusing to generate or replace it/);
      assert.equal(existsSync(join(config, "blast", "secret")), false);
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it("rechecks the generated environment and built bundle before mainnet upload", () => {
    const temp = mkdtempSync(join(tmpdir(), "neutron-release-"));
    const dist = join(temp, "dist");
    const assets = join(dist, "assets");
    const envPath = join(temp, ".env");
    const canisterId = "aaaaa-aa";
    mkdirSync(assets, { recursive: true });
    writeFileSync(
      envPath,
      [
        "VITE_ICP_ENVIRONMENT=ic",
        "VITE_ICP_NETWORK=ic",
        `VITE_CANISTER_ID_HACKATHON=${canisterId}`,
        "VITE_IDENTITY_PROVIDER=https://id.ai",
      ].join("\n"),
    );
    writeFileSync(join(assets, "index-release.js"), `${canisterId} https://id.ai`);

    const args = {
      environment: "ic",
      prepared: true,
      dir: dist,
      prefix: "/",
    };
    try {
      assert.doesNotThrow(() =>
        assertPreparedProduction({ args, canisterId, envPath, distDir: dist }),
      );
      writeFileSync(
        envPath,
        [
          "VITE_ICP_ENVIRONMENT=local",
          "VITE_ICP_NETWORK=local",
          `VITE_CANISTER_ID_HACKATHON=${canisterId}`,
          "VITE_IDENTITY_PROVIDER=https://id.ai",
        ].join("\n"),
      );
      assert.throws(
        () => assertPreparedProduction({ args, canisterId, envPath, distDir: dist }),
        /does not match this mainnet upload/,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

describe("rolling frontend pruning", () => {
  it("does not prune anything when switched-site verification fails", async () => {
    const dist = mkdtempSync(join(tmpdir(), "neutron-upload-"));
    const index = join(dist, "index.html");
    writeFileSync(index, "new release");
    const removed = [];
    let waited = false;

    try {
      await assert.rejects(
        pruneStaleAfterVerification({
          verify: () =>
            verifyDesiredSite({
              files: [index],
              sourceDir: dist,
              prefix: "/",
              environment: "ic",
              canisterId: "aaaaa-aa",
              fetchImpl: async () => new Response("previous release"),
              delayImpl: async () => {},
            }),
          stale: ["/assets/old.js", "/old.css"],
          graceMs: 30_000,
          delayImpl: async () => {
            waited = true;
          },
          remove: async (key) => removed.push(key),
        }),
        /pre-prune verification failed/,
      );
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }

    assert.equal(waited, false);
    assert.deepEqual(removed, []);
  });

  it("verifies, observes the grace period, then prunes in order", async () => {
    const events = [];
    await pruneStaleAfterVerification({
      verify: async () => events.push("verified"),
      stale: ["/a", "/b"],
      graceMs: 30_000,
      delayImpl: async (milliseconds) => events.push(`wait:${milliseconds}`),
      remove: async (key) => events.push(`remove:${key}`),
    });
    assert.deepEqual(events, ["verified", "wait:30000", "remove:/a", "remove:/b"]);
  });
});
