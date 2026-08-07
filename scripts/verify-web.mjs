/**
 * Does the canister serve the frontend in this checkout?
 *
 *   npm run verify:web                         # against the local replica
 *   npm run verify:web -- -e ic                # against mainnet
 *   npm run verify:web -- -e ic --expect-sealed
 *   npm run verify:web -- --canister-id <id>   # no named CLI target needed
 *
 * A canister that hosts its own frontend is asking you to trust that the page
 * you loaded is the code in the repository. That is a claim, and claims about
 * software should be checkable. This recomputes the digest the canister
 * publishes at `frontend_hash()` from `frontend/dist` and holds the two
 * against each other.
 *
 * ## What the digest is, exactly
 *
 * For every asset the canister serves that is *not* under `/u/` (those belong
 * to participants and change constantly), sorted by key:
 *
 *     sha256( for each file: len(key)  key
 *                            len(type) type
 *                            len(enc)  enc
 *                            len(32)   sha256(bytes) )
 *
 * where every `len` is eight big-endian bytes.
 *
 * Two details do real work. **Sorting** makes it independent of the order the
 * files were uploaded in — a rolling hash folded in upload order could not be
 * reproduced here, and would disagree for a build that was byte-for-byte
 * identical. **Length prefixes** make the stream unambiguous: without them
 * `("ab", "c")` and `("a", "bc")` hash the same, and a file could be renamed
 * into another's type without changing the answer.
 *
 * ## Reproducing it means reproducing the upload exactly
 *
 * The digest covers the *stored* bytes, so this has to make the same choices
 * `scripts/upload.mjs` makes: the same content type from the extension, the
 * same gzip decision, the same gzip level, and the same two keys for
 * `index.html` (it is stored at `/` as well). Any drift between the two shows
 * up as a mismatch, which is the honest outcome — a verifier that quietly
 * disagrees with the uploader is worse than none.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, posix, relative, resolve, sep } from "node:path";

import { Actor, CanisterStatus, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "frontend", "dist");

// Imported, not copied. These four decide what actually gets stored — the
// content type, whether it is gzipped, and under which keys — and the digest is
// over the stored bytes. A second copy here would be a second definition that
// has to agree with the first, and it already did not: `js` was
// `application/javascript` there and `text/javascript` in the copy, which would
// have made every verification fail for a build that was perfectly fine.
import { assetKeys, mime, shouldGzip } from "./upload.mjs";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Eight big-endian bytes. */
function lengthOf(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(n));
  return buf;
}

/**
 * The digest itself, over an already-assembled set of assets.
 *
 * Split out from `digestOf` so a test can prove the canister's implementation
 * and this one agree without going through a directory and a deploy. That
 * agreement is the whole feature — two implementations of a hash that were
 * never checked against each other are two hashes.
 *
 * `assets` maps key -> {contentType, contentEncoding, sha256}.
 */
export function digestOfAssets(assets) {
  const digest = createHash("sha256");
  for (const key of [...assets.keys()].sort()) {
    const asset = assets.get(key);
    for (const part of [
      Buffer.from(key, "utf8"),
      Buffer.from(asset.contentType, "utf8"),
      Buffer.from(asset.contentEncoding, "utf8"),
      asset.sha256,
    ]) {
      digest.update(lengthOf(part.length));
      digest.update(part);
    }
  }
  return digest.digest("hex");
}

export function digestOf(distDir) {
  /** key -> {contentType, contentEncoding, sha256} */
  const assets = new Map();

  for (const file of walk(distDir)) {
    const body = readFileSync(file);
    const contentType = mime(file);
    const gzip = shouldGzip(contentType);
    // Level 9, exactly as the uploader does: the digest is over the stored
    // bytes, and a different level is a different file.
    const stored = gzip ? gzipSync(body, { level: 9 }) : body;
    const sha256 = createHash("sha256").update(stored).digest();

    // The prefix the uploader uses for the site itself. `assetKeys` returns
    // two keys for `index.html`, because it is served at `/` as well.
    for (const key of assetKeys(relative(distDir, file), "/")) {
      assets.set(key, {
        contentType,
        contentEncoding: gzip ? "gzip" : "identity",
        sha256,
      });
    }
  }

  return { hash: digestOfAssets(assets), count: assets.size };
}

/** The public gateway URL for one canister path. */
export function gatewayUrl(canisterId, environment, path) {
  const encoded = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  if (environment === "ic") return `https://${canisterId}.icp0.io${encoded}`;
  const url = new URL(`http://127.0.0.1:8943${encoded}`);
  url.searchParams.set("canisterId", canisterId);
  return url.toString();
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Fetch every built file through the certified HTTP gateway and compare it to
 * the checkout byte-for-byte (after ordinary HTTP content decoding).
 *
 * A matching `frontend_hash()` proves what the canister stored. These reads
 * prove what the public gateway actually serves: root document, exact asset
 * paths, and the certified SPA fallback used by a deep link.
 */
export async function verifyGateway({ distDir, canisterId, environment, fetchImpl = fetch }) {
  const files = walk(distDir).sort();
  if (files.length === 0) throw new Error(`${distDir} is empty`);

  const expected = files.flatMap((file) => {
    const rel = relative(distDir, file).split(sep).join(posix.sep);
    const paths = rel === "index.html" ? ["/", "/index.html"] : [`/${rel}`];
    return paths.map((path) => ({ path, file }));
  });
  const index = join(distDir, "index.html");
  if (!expected.some(({ file }) => file === index)) {
    throw new Error("frontend/dist has no index.html");
  }
  expected.push({ path: "/__release_verifier__/deep-link", file: index });

  for (const { path, file } of expected) {
    const response = await fetchImpl(gatewayUrl(canisterId, environment, path));
    if (!response.ok) throw new Error(`gateway returned HTTP ${response.status} for ${path}`);

    const wantType = mime(file);
    const gotType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim();
    if (gotType !== wantType) {
      throw new Error(`${path} has content-type ${gotType || "(missing)"}, expected ${wantType}`);
    }

    const want = readFileSync(file);
    const got = Buffer.from(await response.arrayBuffer());
    if (sha256(got) !== sha256(want)) {
      throw new Error(`${path} does not match ${relative(ROOT, file)} byte-for-byte`);
    }
  }
  return expected.length;
}

const verifyInterface = ({ IDL }) =>
  IDL.Service({
    frontend_hash: IDL.Func([], [IDL.Text], ["query"]),
  });

export function selfControlled(controllers, canisterId) {
  return controllers.length === 1 && controllers[0].toText() === canisterId;
}

/** Read only certified release facts; no generated bindings or Ash installation. */
async function publicState(canisterId, environment, includeControllers) {
  const local = environment !== "ic";
  const agent = await HttpAgent.create({
    host: local ? "http://127.0.0.1:8943" : "https://icp-api.io",
  });
  if (local) await agent.fetchRootKey();
  const principal = Principal.fromText(canisterId);
  const actor = Actor.createActor(verifyInterface, { agent, canisterId: principal });
  const [hash, status] = await Promise.all([
    actor.frontend_hash(),
    includeControllers
      ? CanisterStatus.request({
          agent,
          canisterId: principal,
          paths: ["controllers"],
        })
      : null,
  ]);
  if (status === null) return { hash, controllers: null };
  const controllers = status.get("controllers");
  if (!Array.isArray(controllers)) {
    throw new Error("certified state tree returned no controller list");
  }
  return { hash, controllers };
}

function parseArgs(argv) {
  const args = {
    environment: process.env.ICP_CLI_ENVIRONMENT ?? "local",
    canisterId: null,
    hashOnly: false,
    expectSealed: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "-e" || argv[i] === "--environment") args.environment = argv[++i];
    else if (argv[i] === "--canister-id") args.canisterId = argv[++i];
    else if (argv[i] === "--hash-only") args.hashOnly = true;
    else if (argv[i] === "--expect-sealed") args.expectSealed = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.environment) throw new Error("-e/--environment needs a value");
  if (args.canisterId === "") throw new Error("--canister-id needs a value");
  return args;
}

function resolveCanisterId(environment) {
  return execFileSync(
    "icp",
    ["canister", "status", "hackathon", "--id-only", "--environment", environment],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const canisterId = args.canisterId ?? resolveCanisterId(args.environment);

  const local = digestOf(DIST);
  console.log(`\n▸ built    ${local.hash}`);
  console.log(`  from     ${local.count} files in frontend/dist`);

  const served = await publicState(canisterId, args.environment, args.expectSealed);
  console.log(`▸ serving  ${served.hash}`);

  if (served.hash !== local.hash) {
    console.error(
      "\nThe canister is not serving this build.\n" +
        "That is either a stale deploy — run `npm run web` — or a real\n" +
        "difference between what is published and what is in this checkout.",
    );
    process.exit(1);
  }

  if (args.expectSealed) {
    const controllerTexts = served.controllers.map((principal) => principal.toText());
    const selfSealed = selfControlled(served.controllers, canisterId);
    console.log(
      `▸ control  ${selfSealed ? `sealed ([${canisterId}])` : `${controllerTexts.length} principal(s)`}`,
    );
    if (!selfSealed) {
      throw new Error(
        `expected the canister to be its own sole controller; found [${controllerTexts.join(", ")}]`,
      );
    }
  }

  if (!args.hashOnly) {
    const checked = await verifyGateway({
      distDir: DIST,
      canisterId,
      environment: args.environment,
    });
    console.log(`▸ gateway  ${checked} certified HTTP path(s) match the checkout`);
  }
  console.log("\nThe public canister and gateway are serving exactly this build.\n");
}
