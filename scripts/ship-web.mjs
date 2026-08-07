/**
 * Build the frontend and put it in the canister, in one command.
 *
 *   npm run web            # local
 *   npm run web -- -e ic   # mainnet
 *
 * The reason this exists rather than `build:web && upload` living in a
 * package.json line: those two steps can silently disagree. Building without
 * uploading leaves the canister serving the previous bundle, and the only
 * symptom is that a change you made appears not to have worked — which sends
 * you looking at the code you just changed rather than at the deploy. It is a
 * genuinely confusing half hour, and it is entirely avoidable.
 *
 * They can disagree about *where*, too, and that one is not merely confusing.
 * `frontend/src/ic.ts` reads VITE_ICP_NETWORK at build time: when it says
 * local, the agent skips query-signature verification and takes its root key
 * from whichever host served the page. Vite bakes that decision into the
 * bundle and the minifier folds the branch away entirely — so a bundle built
 * against a local `.env` and uploaded to `ic` is a mainnet site that trusts
 * its endpoint, with no guard left in the output for anyone to notice. Only
 * the `.env` on disk at build time decides, and `build:web` does not write it.
 *
 * `icp deploy` gets this right because icp.yaml orders write-env ahead of the
 * build. This path has to order it itself, so: write `.env` for the target
 * first, then refuse to upload anything unless the bundle that came out
 * actually carries the target's ids.
 *
 * And it verifies afterwards: the canister's whole-site digest and every
 * certified gateway response (including the SPA fallback) must match the
 * files just built. A skipped or failed mainnet verification is a failed
 * release, not a URL printed with optimistic instructions.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "frontend", "dist");
const ENV_FILE = join(ROOT, ".env");
/** Must match `gateway.port` in icp.yaml. */
const LOCAL_PORT = 8943;
const LOCAL_GATEWAY = `http://localhost:${LOCAL_PORT}`;

const release = { environment: "local", id: 0, graceMs: 30_000 };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "-e" || arg === "--environment") release.environment = args[++i];
  else if (arg === "--id") release.id = Number(args[++i]);
  else if (arg === "--grace-ms") release.graceMs = Number(args[++i]);
  else throw new Error(`unknown argument: ${arg}`);
}
if (!release.environment) throw new Error("-e/--environment needs a value");
if (release.environment !== "local" && release.environment !== "ic") {
  throw new Error(`unsupported environment "${release.environment}"; expected local or ic`);
}
if (!Number.isSafeInteger(release.id) || release.id < 0 || release.id > 65_535) {
  throw new Error("--id must be an integer in [0,65535]");
}
if (!Number.isSafeInteger(release.graceMs) || release.graceMs < 0 || release.graceMs > 60_000) {
  throw new Error("--grace-ms must be an integer from 0 to 60000");
}
const environment = release.environment;

/**
 * Mainnet is the environment named `ic`, and no other name is. That is not a
 * guess made here: write-env.mjs, upload.mjs and ic.ts each key off that exact
 * string to decide local-or-not, and all three have to reach the same answer
 * or the bundle and its destination disagree. Naming it once means the checks
 * below are checking the same thing they are.
 */
const network = environment === "ic" ? "ic" : "local";
const mainnet = network === "ic";

/**
 * A child environment that ambient exports cannot redirect.
 *
 * Three different sets of names could otherwise decide where this goes, and
 * they are not the same names: the icp CLI reads ICP_ENVIRONMENT and
 * ICP_NETWORK, the scripts here read icp-cli's sync-step variables
 * (ICP_CLI_ENVIRONMENT, ICP_CLI_NETWORK, ICP_CLI_CID_*), and Vite merges any
 * ambient VITE_* over the `.env` file it loads. One stale export of any single
 * one of them is enough to build for one network and publish to another. So
 * every child below gets the target pinned and the rest cleared, rather than
 * inheriting whatever the shell happens to be carrying.
 */
function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ICP_CLI_") || key.startsWith("VITE_")) delete env[key];
  }
  delete env.ICP_NETWORK;
  env.ICP_ENVIRONMENT = environment;
  env.ICP_CLI_ENVIRONMENT = environment;
  return env;
}

const run = (cmd, argv) =>
  execFileSync(cmd, argv, { cwd: ROOT, stdio: "inherit", encoding: "utf8", env: childEnv() });

const quiet = (cmd, argv) =>
  execFileSync(cmd, argv, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: childEnv(),
  }).trim();

const refuse = (headline, lines) => {
  console.error(`\n${headline}\n${lines.map((line) => `  ${line}`).join("\n")}`);
  console.error("\nNothing was uploaded.");
  process.exit(1);
};

/** `.env` is `KEY=value` lines written by write-env.mjs; read it back as a map. */
function readEnv() {
  const values = new Map();
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) values.set(match[1], match[2].trim());
  }
  return values;
}

/**
 * What the frontend is about to believe, held against where we are publishing.
 *
 * Checked before the build and again after it. `.env` is a shared file — a
 * concurrent `icp deploy`, or someone running `npm run env` in another
 * terminal, rewrites it — and a rewrite landing mid-build produces a bundle
 * these numbers no longer describe.
 */
function checkEnv(when) {
  const values = readEnv();
  const problems = [];

  const wrote = values.get("VITE_ICP_ENVIRONMENT") ?? "unset";
  if (wrote !== environment) {
    problems.push(`VITE_ICP_ENVIRONMENT is "${wrote}", not the "${environment}" being published to`);
  }

  // The invariant that matters, spelled the way both sides of it are spelled:
  // ic.ts reads `IS_LOCAL = VITE_ICP_NETWORK !== "ic"`, upload.mjs picks its
  // host with `environment !== "ic"`. Those two booleans have to be one
  // boolean. Compared as booleans rather than as strings so that an
  // environment named something other than `local` on a local network is
  // allowed through, which is what both of them already do.
  const baked = values.get("VITE_ICP_NETWORK") ?? "unset";
  if ((baked === "ic") !== mainnet) {
    problems.push(
      `VITE_ICP_NETWORK is "${baked}", so the bundle is built for ` +
        `${baked === "ic" ? "mainnet" : "a local network"} while the upload goes to ` +
        `${mainnet ? "mainnet" : "a local network"} — ic.ts decides whether to verify query ` +
        "signatures from exactly that value",
    );
  }

  if (problems.length) {
    refuse(`The environment ${when} does not match the upload target (${environment}):`, problems);
  }
  return values;
}

// ── Build, for the environment we are actually shipping to ──────────────────

if (mainnet) {
  console.log("\n▸ checking the existing hardened production upload identity");
  // `--whoami -e ic` uses icblast's strict existing-key loader. It fails on a
  // missing/insecure key and never creates a replacement privileged identity.
  run("node", ["scripts/upload.mjs", "--whoami", "-e", "ic", "--id", String(release.id)]);
}

console.log(`\n▸ writing .env for ${environment}`);
run("node", ["scripts/write-env.mjs", environment]);
checkEnv("just written");

console.log(`\n▸ building the frontend`);
// `build:web`, not vite directly: it verifies that the canonical in-app Rules
// source still matches the backend-owned acceptance version and effective date.
run("npm", ["run", "build:web"]);

const built = readdirSync(join(DIST, "assets")).find(
  (name) => name.startsWith("index-") && name.endsWith(".js"),
);
if (!built) {
  console.error("\nNo index-*.js in frontend/dist/assets — did the build produce anything?");
  process.exit(1);
}

const env = checkEnv("the build read");

// ── Is the bundle actually the one those values describe? ───────────────────
//
// The check above says what the build was *told*. This says what it produced.
// Vite inlines both of these as string literals, so finding them in the output
// is direct evidence of which network the bundle was built for — and, because
// IS_LOCAL is derived from the same file, of which agent settings the minifier
// folded in. Belt and braces: the .env could be right and the build still
// stale, if `build:web` failed in a way that left the previous dist in place.

const bundle = readFileSync(join(DIST, "assets", built), "utf8");
const missingValues = [
  ["canister id", env.get("VITE_CANISTER_ID_HACKATHON")],
  ["identity provider", env.get("VITE_IDENTITY_PROVIDER")],
].filter(([, value]) => value && !bundle.includes(value));

if (missingValues.length) {
  refuse(
    `/assets/${built} was not built from the ${environment} environment.`,
    missingValues.map(([label, value]) => `it does not contain the ${label} ${value}`),
  );
}

if (mainnet) {
  // The hazard itself, checked directly rather than inferred from the inputs.
  // With VITE_ICP_NETWORK=ic these local branches fold out of the bundle; if
  // their text survives in a mainnet build then the guard resolved the other
  // way, and the published site would accept unverified query responses and
  // take its root key from whatever host is serving it.
  const localOnly = [
    "Could not synchronize the local PocketIC agent clock.",
    `.localhost:${LOCAL_PORT}`,
  ].filter((marker) => bundle.includes(marker));
  if (localOnly.length) {
    refuse(`/assets/${built} carries local-only settings but is bound for mainnet.`, [
      ...localOnly.map((marker) => `found ${marker}`),
      "A local bundle drops query-signature verification and fetches a local root key.",
      "Delete frontend/dist and build again.",
    ]);
  }
}

console.log(`\n▸ built /assets/${built} for ${environment} (network ${network})`);

// ── Upload ──────────────────────────────────────────────────────────────────

console.log(`\n▸ uploading to the canister (${environment})`);
// Always explicit, never inherited: upload.mjs falls back to
// ICP_CLI_ENVIRONMENT, and that is one of the variables childEnv() had to
// clear precisely because it cannot be trusted to say where we are going.
run("node", [
  "scripts/upload.mjs",
  "--prepared",
  "-e",
  environment,
  "--id",
  String(release.id),
  "--grace-ms",
  String(release.graceMs),
]);

// ── Did it actually land? ───────────────────────────────────────────────────

const canisterId = quiet("icp", ["canister", "status", "hackathon", "--id-only", "-e", environment]);
console.log(`\n▸ verifying canister state and certified gateway responses (${environment})`);
// Never pass `--hash-only` here. A release is successful only when both the
// on-canister inventory digest and the public HTTP responses match this build.
run("node", [
  "scripts/verify-web.mjs",
  "-e",
  environment,
  "--canister-id",
  canisterId,
]);

const live = mainnet
  ? `https://${canisterId}.icp0.io/`
  : `${LOCAL_GATEWAY}/?canisterId=${canisterId}`;
console.log(`Live: ${live}`);
console.log(`.env is now written for ${environment}; run \`npm run env\` before \`npm run dev\`.`);
