#!/usr/bin/env node
/** Verify the canonical in-app Rules source and its backend acceptance tag. */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const read = (...parts) => readFileSync(resolve(ROOT, ...parts), "utf8");
const fail = (message) => {
  console.error(`rules verification failed: ${message}`);
  process.exit(1);
};

for (const obsolete of ["rules.md", "srppa.md"]) {
  if (existsSync(resolve(ROOT, obsolete))) {
    fail(`${obsolete} duplicates the canonical in-app Rules source`);
  }
}

const agreement = read("frontend", "src", "views", "rules-text.ts");
const guide = read("frontend", "src", "views", "Rules.tsx");
const profiles = read("backend", "lib", "Profiles.mo");
const assets = read("backend", "lib", "Assets.mo");
const moderation = read("backend", "lib", "Moderation.mo");
const notices = read("backend", "lib", "Notices.mo");
const review = read("backend", "lib", "Review.mo");
const season = read("backend", "lib", "Season.mo");
const main = read("backend", "main.mo");
const controllers = read("backend", "lib", "Controllers.mo");
const frontendApi = read("frontend", "src", "api.ts");

const frontendVersion = agreement.match(/export const RULES_VERSION = (\d+);/)?.[1];
const effectiveIso = agreement.match(
  /export const RULES_EFFECTIVE_AT = "([^"]+)";/,
)?.[1];
const backendVersion = profiles.match(/public let TERMS_VERSION : Nat = (\d+);/)?.[1];
const backendNanos = profiles.match(
  /public let TERMS_EFFECTIVE_AT : Nat64 = ([\d_]+);/,
)?.[1];
const fixedRecoveryController = "extk7-gaaaa-aaaaq-aacda-cai";
const backendRecoveryController = controllers.match(
  /public let NEUTRINITE_DAO_TEXT = "([^"]+)";/,
)?.[1];
const frontendRecoveryController = frontendApi.match(
  /export const NEUTRINITE_DAO_CONTROLLER = "([^"]+)";/,
)?.[1];

if (!frontendVersion || !effectiveIso || !backendVersion || !backendNanos) {
  fail("could not read the frontend and backend terms version/effective date");
}
if (frontendVersion !== backendVersion) {
  fail(`frontend version ${frontendVersion} does not match backend version ${backendVersion}`);
}
if (
  backendRecoveryController !== fixedRecoveryController ||
  frontendRecoveryController !== fixedRecoveryController
) {
  fail("frontend and backend must use the fixed Neutrinite DAO recovery principal");
}

const effectiveMillis = Date.parse(effectiveIso);
if (!Number.isFinite(effectiveMillis)) fail(`invalid effective date ${effectiveIso}`);
const frontendNanos = BigInt(effectiveMillis) * 1_000_000n;
if (frontendNanos !== BigInt(backendNanos.replaceAll("_", ""))) {
  fail(`frontend effective date ${effectiveIso} does not match backend TERMS_EFFECTIVE_AT`);
}

function verifyNatConstant(source, name, expected) {
  const value = source.match(
    new RegExp(`(?:public\\s+)?let\\s+${name}(?:\\s*:\\s*[A-Za-z0-9_]+)?\\s*=\\s*([\\d_]+)`),
  )?.[1];
  if (!value) fail(`could not read backend limit ${name}`);
  if (BigInt(value.replaceAll("_", "")) !== BigInt(expected)) {
    fail(`${name} changed; update the Participant Guide and its verification together`);
  }
}

for (const [source, name, expected] of [
  [profiles, "MAX_ACCOUNTS", 1_200],
  [profiles, "MAX_HACKERS", 1_000],
  [profiles, "MAX_APPROVED_SPONSORS", 64],
  [profiles, "MAX_MODERATORS", 8],
  [assets, "MAX_HACKER_KEYS", 64],
  [assets, "MAX_NON_HACKER_KEYS", 2],
  [assets, "MAX_HACKER_BYTES", 32_000_000],
  [assets, "MAX_NON_HACKER_BYTES", 262_144],
  [assets, "MAX_LIVE_SLOTS", 80_000],
  [assets, "MAX_RESERVED_BYTES", 70_332_186_624],
  [season, "MAX_QUALIFIER_ENTRIES", 1_000],
  [season, "MAX_LAUNCH_LEDGERS", 7],
  [review, "MAX_HISTORY", 8],
  [review, "MAX_REASON", 2_000],
  [moderation, "MAX_HISTORY_PER_SUBJECT", 32],
  [notices, "MAX_BODY", 500],
  [notices, "MAX_NOTICES", 10_000],
  [notices, "PER_WINDOW", 3],
  [notices, "GLOBAL_PER_WINDOW", 100],
  [main, "CONTROLLER_RECOVERY_NEEDED", 3],
]) {
  verifyNatConstant(source, name, expected);
}

for (const [source, pattern, explanation] of [
  [
    agreement,
    /\*\*Version \$\{RULES_VERSION\} — effective \$\{effectiveDate\(RULES_EFFECTIVE_AT\)\}\*\*/,
    "agreement heading must use the canonical terms constants",
  ],
  [
    guide,
    /version: RULES_VERSION,\s*effectiveAt: new Date\(RULES_EFFECTIVE_AT\)/,
    "Rules fallback must use the canonical terms constants",
  ],
  [
    guide,
    /no more than seven reviewed ICRC-1 ledgers/,
    "Rules must publish the seven-ledger production ceiling",
  ],
  [
    guide,
    /deduplicate identical ICRC-1 transfers for at least\s*24 hours/,
    "Rules must publish the payout deduplication assumption",
  ],
  [guide, /Settlement is bounded to 24 rounds/, "Rules must publish bounded payout settlement"],
  [
    guide,
    /The final-hour voting lock also freezes app content/,
    "Rules must publish the final-hour revision freeze",
  ],
  [
    guide,
    /between three and eight current moderators, at least three approved judges, and\s+at least one approved sponsor naming an approved ledger/,
    "Rules must publish the bounded launch quorum",
  ],
  [
    guide,
    /every external controller is removed and the canister keeps only\s+itself as controller[\s\S]*?what these rules call sealed/,
    "Rules must define sealed as the exact self-only controller state",
  ],
  [
    agreement,
    /Sealed means that the canister itself is the sole controller[\s\S]*?no external caller can upgrade the code or frontend or change controller-only settings/,
    "agreement must define sealed as the exact self-only controller state",
  ],
  [
    guide,
    /Three distinct current moderators may\s+approve adding Neutrinite DAO[\s\S]*?NEUTRINITE_DAO_CONTROLLER[\s\S]*?third approval visibly ends the sealed state/,
    "Rules must explain the fixed three-moderator DAO recovery",
  ],
  [
    agreement,
    /Three distinct current, non-anonymised moderator account owners must independently approve it[\s\S]*?third approval adds Neutrinite DAO[\s\S]*?Adding the DAO visibly ends the sealed state/,
    "agreement must explain the fixed three-moderator DAO recovery",
  ],
  [
    agreement,
    /controller recovery is separate from lifecycle recovery/,
    "agreement must distinguish controller recovery from timer recovery",
  ],
  [
    guide,
    /1,200 profiles total; at most 1,000 hackers, 64 approved sponsors, and\s+eight moderators[\s\S]*Each qualifier accepts at most 1,000 entries/,
    "Rules must publish the production account, role, and qualifier-entry limits",
  ],
  [
    guide,
    /64 live asset keys and 32,000,000 bytes of fixed-slot storage per hacker/,
    "Rules must publish the hacker asset allowance",
  ],
  [
    guide,
    /Two live asset keys and 262,144 bytes of fixed-slot storage per account/,
    "Rules must publish the non-hacker asset allowance",
  ],
  [
    guide,
    /80,000 live slots and 70,332,186,624 bytes of reserved stable asset\s+capacity across the whole store, including the shipped site/,
    "Rules must publish the shared asset-store ceilings",
  ],
  [
    guide,
    /newest 32 judge, sponsor, and moderator status actions per profile/,
    "Rules must publish bounded account-status history",
  ],
  [
    guide,
    /content report is\s+limited to 500 characters; each caller may file three in a rolling hour, all\s+callers together may file 100 in a rolling hour, and at most 10,000 reports may\s+be stored at once/,
    "Rules must publish report admission limits",
  ],
  [
    guide,
    /cumulative write-instruction allowance configured before\s+sealing and shown on its own profile/,
    "Rules must publish the live configured instruction allowance",
  ],
  [
    guide,
    /Only one\s+entry-or-update revision per account may be waiting in a qualifier week/,
    "Rules must publish the pending-revision limit",
  ],
  [
    guide,
    /more than one of your apps is active in a round, choose the exact app[\s\S]*moderator decision apply only to that app/,
    "Rules must publish exact selected-app updates",
  ],
  [
    guide,
    /uploaded package or image URL cannot be shared by separate apps[\s\S]*completed takedown permanently\s+deletes that app's canister-hosted package, icon, and screenshots[\s\S]*deleted file URL stays reserved and cannot be uploaded again/,
    "Rules must publish cross-app key separation and permanent hosted-file deletion",
  ],
  [
    guide,
    /A sponsor may request collection at most once every 60 seconds/,
    "Rules must publish the sponsor collection rate limit",
  ],
  [
    guide,
    /up to 64 sponsors may each propose at most seven ledgers\s+from the fixed event allowlist of no more than seven reviewed ICRC-1 ledgers in\s+total/,
    "Rules must distinguish per-sponsor and event ledger limits",
  ],
  [
    agreement,
    /eventually returning a definite reply to an admitted sponsor collection transfer/,
    "agreement must publish the sponsor-sweep reply assumption",
  ],
]) {
  if (!pattern.test(source)) fail(explanation);
}

const quotedRecoveryPrincipal = "principal \\`" + fixedRecoveryController + "\\`";
if (!agreement.includes(quotedRecoveryPrincipal)) {
  fail("agreement must publish the fixed Neutrinite DAO recovery principal");
}
for (const [source, label] of [
  [guide, "Rules guide"],
  [agreement, "agreement"],
]) {
  if (
    /controller list is then permanently emptied|empties its controller list|verifies that it has no controllers/.test(
      source,
    )
  ) {
    fail(`${label} still describes the obsolete empty-controller seal`);
  }
}

for (const path of [
  "package.json",
  "icp.yaml",
  "scripts/ship-web.mjs",
]) {
  const source = read(...path.split("/"));
  if (/srppa\.md|sync-rules\.mjs|rules:check/.test(source)) {
    fail(`${path} still references the obsolete Markdown synchronization path`);
  }
}

const digest = createHash("sha256")
  .update(guide)
  .update("\0")
  .update(agreement)
  .digest("hex");

console.log(
  `  rules  canonical Rules page verified (version ${frontendVersion}, ${effectiveIso}, sha256 ${digest})`,
);
