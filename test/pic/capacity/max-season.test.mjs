/**
 * A bounded whole-season sample and a maximum-capacity planning projection.
 *
 * Materialising all 1,000 hackers, 4,000 maximum apps and 64,400 files took
 * hours while mostly repeating the same linear work. This fixture instead
 * drives 32 hackers through the real six-round lifecycle, including maximum
 * metadata, retained review history, voting, timer recovery, sponsor sweeps
 * and all 140 ledger payouts. Every hacker still reaches the real 64-key
 * account ceiling.
 *
 * The projection has two deliberately different inputs:
 *
 * - Stable memory is exact slot arithmetic. Representative files exercise
 *   every slab class, a maximum package is read back in each qualifier, and
 *   the report computes the configured 1,000-user envelopes byte-for-byte.
 * - Heap-resident asset metadata uses the checked-in 1,200-profile / 24,000-key
 *   calibration captured by the production actor before this test was made
 *   bounded. Published row and text limits supply modeled entry, revision,
 *   changelog, moderation, notice and runtime allowances. GC-dependent live
 *   heap floors from the short run remain diagnostics and are never scaled.
 *
 * Every bounded ingress batch advances PocketIC by one virtual second and
 * executes one extra tick. The target is to finish within ten wall-clock
 * minutes. The resulting range is a projection, not a claim that 64,400 rows
 * were inserted.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

import { Principal } from "@dfinity/principal";

import {
  bootstrap,
  identity,
  ok,
  SECOND,
} from "../harness.mjs";
import {
  derivedSubaccount,
  installPayoutLedger,
  principalAccount,
} from "../payout-ledger.mjs";
import {
  approveWithTwo,
  assertDepositBalances,
  assertSponsorAccounting,
  collectSponsors,
  creditSponsors,
  expectFinalReconciliation,
  fundingModel,
  inBatches,
  join,
  loadSponsorDeposits,
  makeHackers,
  makeModerators,
  makeSponsors,
  pocketIcPacer,
  recoverAutomationAt,
  recoverDueRound,
  safeNumber,
  variant,
  waitOneSweepWindow,
} from "../scenario.mjs";

const TARGET_HACKERS = 1_000;
const TARGET_ACCOUNTS = 1_200;
const TARGET_SPONSORS = 64;
const TARGET_APPS = TARGET_HACKERS * 4;
const TARGET_NON_HACKERS = TARGET_ACCOUNTS - TARGET_HACKERS;

const HACKERS = 32;
const ACCOUNTS = 40;
const NON_HACKERS = ACCOUNTS - HACKERS;
const SPONSORS = 8;
const MODERATORS = 5;
const LEDGERS = 7;
const QUALIFIERS = 4;
const SHOTS = 6;
const EXTRA_HACKER_KEYS = 32;
const CHURN_HACKERS = 8;

const ICON_BYTES = 100_000;
const SHOT_BYTES = 400_000;
const PACKAGE_BYTES = 1_900_000;
const TINY_BYTES = 64;
const PAGE = 65_536;
const SMALL_SLOT = 2 * PAGE;
const IMAGE_SLOT = 7 * PAGE;
const BUILD_SLOT = 32 * PAGE;
const MIB = 1_048_576n;
const HEAP_ARENA = 64n * MIB;
const HEAP_PREFERRED = 2n * 1_073_741_824n;
const HEAP_MODEL_GUARD = 3n * 1_073_741_824n;
const WASM32_HEAP_CEILING = 4n * 1_073_741_824n;
const WALL_RUNTIME_TARGET_MS = 10 * 60_000;
const WALL_RUNTIME_LIMIT_MS = 12 * 60_000;

const APP_FILES = HACKERS * QUALIFIERS * (1 + SHOTS + 1);
const MAX_APP_LIVE = ICON_BYTES + SHOTS * SHOT_BYTES + PACKAGE_BYTES;
// All sampled files enter their production slab class. One app per qualifier
// uses the published byte caps; the other 31 use the first byte in that class.
const COMPACT_APP_LIVE = TINY_BYTES + SHOTS * (SMALL_SLOT + 1) + (IMAGE_SLOT + 1);
const APP_LIVE = BigInt(QUALIFIERS) *
  BigInt(MAX_APP_LIVE + (HACKERS - 1) * COMPACT_APP_LIVE);
const APP_RESERVED = BigInt(HACKERS * QUALIFIERS) *
  BigInt(SMALL_SLOT + SHOTS * IMAGE_SLOT + BUILD_SLOT);
const EXTRA_FILES = HACKERS * EXTRA_HACKER_KEYS + NON_HACKERS * 2;
const FINAL_FILES = APP_FILES + EXTRA_FILES;
const FINAL_LIVE = APP_LIVE + BigInt(EXTRA_FILES * TINY_BYTES);
const FINAL_RESERVED = APP_RESERVED + BigInt(EXTRA_FILES * SMALL_SLOT);
const CHURN_RESERVED = BigInt(CHURN_HACKERS) * BigInt(SMALL_SLOT + IMAGE_SLOT + BUILD_SLOT);
const CHURN_LIVE = BigInt(CHURN_HACKERS) * BigInt(8 + SMALL_SLOT + 1 + IMAGE_SLOT + 1);
// The tiny files reuse the freed small slots. The empty image/build slabs
// remain at their Region high-water marks until the first app uploads reuse
// them, so they still count at this intermediate checkpoint.
const KEY_BASE_RESERVED =
  BigInt(EXTRA_FILES * SMALL_SLOT) +
  BigInt(CHURN_HACKERS) * BigInt(IMAGE_SLOT + BUILD_SLOT);
const TARGET_APP_FILES = TARGET_APPS * (1 + SHOTS + 1);
const TARGET_APP_LIVE = BigInt(TARGET_APPS * MAX_APP_LIVE);
const TARGET_APP_RESERVED = BigInt(TARGET_APPS) *
  BigInt(SMALL_SLOT + SHOTS * IMAGE_SLOT + BUILD_SLOT);
const TARGET_EXTRA_FILES = TARGET_HACKERS * EXTRA_HACKER_KEYS + TARGET_NON_HACKERS * 2;
const TARGET_FINAL_FILES = TARGET_APP_FILES + TARGET_EXTRA_FILES;
const TARGET_FIXTURE_LIVE = TARGET_APP_LIVE + BigInt(TARGET_EXTRA_FILES * TINY_BYTES);
const TARGET_FIXTURE_RESERVED =
  TARGET_APP_RESERVED + BigInt(TARGET_EXTRA_FILES * SMALL_SLOT);
// All four maximum apps plus the largest remaining payload that fits each
// hacker's 32 remaining keys and fixed-slot quota. Package-path files may use
// any slab class. Twenty-four full image slots plus eight full small slots use
// all 184 remaining pages without allocator waste.
const TARGET_SIMULTANEOUS_RESERVED = 32_033_996_800n;
const TARGET_SIMULTANEOUS_LIVE = 29_698_624_000n;
// Across the quota without requiring four retained apps, two maximum packages,
// sixty full image-class package bodies and two full small-class bodies use 64
// keys and all 488 available pages with the greatest reachable live payload.
const TARGET_ABSOLUTE_LIVE = 31_627_264_000n;
const TARGET_PARTICIPANT_HIGH_WATER = 69_258_444_800n;
// Controller publication is trusted and bypasses participant admission before
// sealing. This is therefore a release budget, not a separate upload guard.
const TRUSTED_FRONTEND_ALLOWANCE = 1_073_741_824n;
const TARGET_PLANNING_RESERVED =
  TARGET_PARTICIPANT_HIGH_WATER + TRUSTED_FRONTEND_ALLOWANCE;
const COMPILER_STABLE_LIMIT = 80n * 1_073_741_824n;
const FUNDING_GRACE_NANOS = 300_000_000_000n;
const VOTE_LOCK_NANOS = 3_600_000_000_000n;
const CLAIMS = 20;
const PAYOUT_ROWS = CLAIMS * LEDGERS;
const REVISION_HISTORY = 8;
const REJECTION_REASON_SCALARS = 2_000;
const ASSET_KEY_BYTES = 64;
// @dfinity/pic's createCanister default; bootstrap does not override it.
const POCKET_IC_PROVISIONED_CYCLES = 1_000_000_000_000_000_000n;
const REPORT = resolve(import.meta.dirname, "..", "..", "..", ".build", "capacity-report.json");

assert.equal(APP_FILES, 1_024);
assert.equal(EXTRA_FILES, 1_040);
assert.equal(FINAL_FILES, 2_064);
assert.equal(TARGET_APP_FILES, 32_000);
assert.equal(TARGET_APP_LIVE, 17_600_000_000n);
assert.equal(TARGET_APP_RESERVED, 19_922_944_000n);
assert.equal(TARGET_EXTRA_FILES, 32_400);
assert.equal(TARGET_FINAL_FILES, 64_400);
assert.equal(TARGET_FIXTURE_LIVE, 17_602_073_600n);
assert.equal(TARGET_FIXTURE_RESERVED, 24_169_676_800n);
assert.equal(TARGET_SIMULTANEOUS_RESERVED, 32_033_996_800n);
assert.equal(TARGET_SIMULTANEOUS_LIVE, 29_698_624_000n);
assert.equal(TARGET_ABSOLUTE_LIVE, 31_627_264_000n);
assert.equal(TARGET_PLANNING_RESERVED, 70_332_186_624n);
assert.equal(COMPILER_STABLE_LIMIT - TARGET_PLANNING_RESERVED, 15_567_159_296n);
assert.equal(CHURN_RESERVED, 21_495_808n);
assert.equal(CHURN_LIVE, 4_718_672n);
assert.equal(KEY_BASE_RESERVED, 156_762_112n);
assert.equal(FINAL_LIVE, 172_078_180n);
assert.equal(FINAL_RESERVED, 773_849_088n);

const ceilDiv = (value, divisor) => (value + divisor - 1n) / divisor;
const roundUp = (value, quantum) => ceilDiv(value, quantum) * quantum;

// Captured with this production actor, compiler and 64-byte UTF-8 key rule:
// a 1,200-profile capacity roster (1,000 hackers, 1,005 judges and five
// moderators) = 256 MiB claimed, then 320/384/448 MiB at 8k/16k/24k
// maximum-length retained keys. `heapClaimed` grows in 64 MiB arenas, so the
// upper projection adds one arena and 10% tree-depth slack. Separate profile
// and role slack below covers maximum text and the remaining stacked roles.
const CALIBRATION_PROFILE_HEAP = 256n * MIB;
const CALIBRATION_24K_HEAP = 448n * MIB;
const CALIBRATION_FILES = 24_000n;
const PROJECTED_ASSET_HEAP_CENTRAL =
  CALIBRATION_PROFILE_HEAP +
  ceilDiv(
    (CALIBRATION_24K_HEAP - CALIBRATION_PROFILE_HEAP) * BigInt(TARGET_FINAL_FILES),
    CALIBRATION_FILES,
  );
const PROJECTED_ASSET_HEAP_UPPER = roundUp(
  CALIBRATION_PROFILE_HEAP +
    ceilDiv(
      (CALIBRATION_24K_HEAP - CALIBRATION_PROFILE_HEAP + HEAP_ARENA) *
        BigInt(TARGET_FINAL_FILES) *
        110n,
      CALIBRATION_FILES * 100n,
    ),
  HEAP_ARENA,
);
const sampledAssetAllowance = (files) => ceilDiv(
  (CALIBRATION_24K_HEAP - CALIBRATION_PROFILE_HEAP + HEAP_ARENA) *
    BigInt(files) *
    110n,
  CALIBRATION_FILES * 100n,
);

const TARGET_ENTRY_ROWS = TARGET_APPS + 4 + 2;
// Hacker seats are reusable before launch. All registered accounts can retain
// eight rejected revisions after deleting the referenced files and leaving the
// role, even though at most 1,000 are hackers simultaneously.
const TARGET_REVISION_ROWS = TARGET_ACCOUNTS * REVISION_HISTORY;
const TARGET_VOTE_ROWS = TARGET_ACCOUNTS * 2 * 6;
const TARGET_ACTION_ROWS = TARGET_ACCOUNTS * 32;
const TARGET_NOTICE_ROWS = 10_000;
const TARGET_TAKEDOWN_APPROVAL_ROWS = TARGET_ENTRY_ROWS * 8;
const TARGET_ROLE_APPROVAL_ROWS = (TARGET_ACCOUNTS + TARGET_SPONSORS) * 2;
const TARGET_APPROVAL_ROWS =
  TARGET_TAKEDOWN_APPROVAL_ROWS + TARGET_ROLE_APPROVAL_ROWS;

// Changelog rows are not numerous enough in a 32-hacker sample to measure
// above GC noise. This raw ceiling includes 30 updates on all 4,006 retained
// qualifier/carried rows, maximum four-byte version/note text, and a maximum
// derived package name. The row/index allowance is modeled at 1.5× and 2×.
const TARGET_CHANGELOG_RAW =
  BigInt(TARGET_ENTRY_ROWS * 30 * ((24 + 500) * 4 + (50 + 8)));
const PROJECTED_CHANGELOG_CENTRAL = roundUp(TARGET_CHANGELOG_RAW * 3n / 2n, HEAP_ARENA);
const PROJECTED_CHANGELOG_UPPER = roundUp(TARGET_CHANGELOG_RAW * 2n, HEAP_ARENA);
// Count every entry text/key field even where takedown state makes some
// combinations mutually exclusive. That deliberate double count also exceeds
// the few extra UTF-8 bytes possible with the shorter accepted `http://`
// prefix. A retained entry revision uses the larger full-entry shape plus its
// maximum four-byte rejection reason. Fixed fields, arrays and multi-indexed
// rows live in the 1.5×/2× modeled overhead.
const MAX_ENTRY_STATIC_RAW =
  BigInt((80 + 600 + 6 * 24 + 500) * 4) +
  BigInt((8 + (256 - 8) * 4) * 7) +
  BigInt(64 + 6 * 64 + 64 + (50 + 8) + 24 * 4 + 50);
const MAX_REVISION_RAW =
  BigInt((80 + 600 + 6 * 24 + 2_000) * 4) +
  BigInt((8 + (256 - 8) * 4) * 7) +
  BigInt(64 + 6 * 64 + 64 + 40);
const TARGET_ENTRY_REVISION_RAW =
  BigInt(TARGET_ENTRY_ROWS) * MAX_ENTRY_STATIC_RAW +
  BigInt(TARGET_REVISION_ROWS) * MAX_REVISION_RAW;
const PROJECTED_ENTRY_REVISION_CENTRAL =
  roundUp(TARGET_ENTRY_REVISION_RAW * 3n / 2n, HEAP_ARENA);
const PROJECTED_ENTRY_REVISION_UPPER =
  roundUp(TARGET_ENTRY_REVISION_RAW * 2n, HEAP_ARENA);
const TARGET_PROFILE_TEXT_RAW =
  // Sponsor applications remain on rejected/withdrawn accounts, so model the
  // maximum application text on every registered profile, not only 64 winners.
  BigInt(TARGET_ACCOUNTS * (
    ((64 + 80 + 1_000 + 8 * (24 + 256) + 80 + 256 + 500) * 4) +
    32 + 64 + 64
  ));
const PROJECTED_PROFILE_UNICODE_CENTRAL = 32n * MIB;
const PROJECTED_PROFILE_UNICODE_UPPER = 64n * MIB;
// The largest text-bearing control tables dominate this component: newest-32
// moderation trails, notices, and one maximum takedown context per moderator
// and entry. Two times their raw text plus one arena is the central allowance.
// The planning upper uses four times raw text, leaving roughly 385 MB for
// records, B-tree indexes, principals, 14,400 vote rows, 34,576 approval rows,
// 448 sponsor/ledger pairs, 140 payouts, season state and transient
// reconciliation work.
const TARGET_CONTROL_TEXT_RAW =
  BigInt(TARGET_ACTION_ROWS * 280 * 4) +
  BigInt(TARGET_NOTICE_ROWS * 500 * 4) +
  BigInt(TARGET_TAKEDOWN_APPROVAL_ROWS * 500 * 4);
const PROJECTED_CONTROL_CENTRAL =
  roundUp(TARGET_CONTROL_TEXT_RAW * 2n + HEAP_ARENA, HEAP_ARENA);
const PROJECTED_CONTROL_UPPER =
  roundUp(TARGET_CONTROL_TEXT_RAW * 4n, HEAP_ARENA);

assert.equal(PROJECTED_ASSET_HEAP_CENTRAL, 808_661_812n);
assert.equal(PROJECTED_ASSET_HEAP_UPPER, 1_073_741_824n);
assert.equal(TARGET_ENTRY_ROWS, 4_006);
assert.equal(TARGET_REVISION_ROWS, 9_600);
assert.equal(TARGET_VOTE_ROWS, 14_400);
assert.equal(TARGET_ACTION_ROWS, 38_400);
assert.equal(TARGET_TAKEDOWN_APPROVAL_ROWS, 32_048);
assert.equal(TARGET_APPROVAL_ROWS, 34_576);
assert.equal(TARGET_ENTRY_REVISION_RAW, 233_066_872n);
assert.equal(TARGET_CHANGELOG_RAW, 258_867_720n);
assert.equal(TARGET_PROFILE_TEXT_RAW, 20_448_000n);
assert.equal(TARGET_CONTROL_TEXT_RAW, 127_104_000n);
assert.equal(PROJECTED_CHANGELOG_CENTRAL, 384n * MIB);
assert.equal(PROJECTED_CHANGELOG_UPPER, 512n * MIB);
assert.equal(PROJECTED_ENTRY_REVISION_CENTRAL, 384n * MIB);
assert.equal(PROJECTED_ENTRY_REVISION_UPPER, 448n * MIB);
assert.equal(PROJECTED_CONTROL_CENTRAL, 320n * MIB);
assert.equal(PROJECTED_CONTROL_UPPER, 512n * MIB);

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function bytes(size, marker) {
  const out = new Uint8Array(size);
  out.fill(marker & 0xff);
  if (size >= PNG.length) out.set(PNG, 0);
  return out;
}

function fixedScalars(prefix, length, fill = "🧪") {
  const used = Array.from(prefix).length;
  assert.ok(used <= length, `${prefix} exceeds its fixture field`);
  const value = prefix + fill.repeat(length - used);
  assert.equal(Array.from(value).length, length);
  return value;
}

function longImageKey(person, folder, suffix) {
  const prefix = `/u/${person.id}/${folder}/`;
  const fixedBytes = new TextEncoder().encode(prefix + suffix).length;
  const remaining = ASSET_KEY_BYTES - fixedBytes;
  assert.ok(remaining > 0);
  // Participant asset leaves deliberately use a narrow ASCII URL grammar, so
  // fill the exact byte ceiling without introducing a second browser spelling.
  const key = prefix + "x".repeat(remaining) + suffix;
  assert.equal(new TextEncoder().encode(key).length, ASSET_KEY_BYTES);
  assert.ok(Array.from(key).length <= 160);
  return key;
}

function appKeys(person, week) {
  const scope = `/u/${person.id}/`;
  return {
    icon: longImageKey(person, "icon", `-week-${week}.png`),
    shots: Array.from({ length: SHOTS }, (_, shot) =>
      longImageKey(person, "shots", `-week-${week}-${shot}.png`)),
    // Season.packageName deliberately accepts digits only.
    pkg: `${scope}pkg/${week}.neutron`,
  };
}

function entryInput(person, week) {
  const keys = appKeys(person, week);
  const slug = `capacity_${safeNumber(week)}_${safeNumber(person.id)}`;
  assert.ok(slug.length >= 5 && slug.length <= 40 && /^[a-z_]+$/.test(slug));
  return {
    title: fixedScalars(`Capacity week ${week} by ${person.handle}: `, 80),
    summary: fixedScalars(`Capacity entry ${week} from ${person.handle}. `, 600),
    url: fixedScalars("https://example.com/app/", 256),
    icon: [keys.icon],
    shots: keys.shots,
    links: Array.from({ length: 6 }, (_, index) => ({
      kind: fixedScalars(`link-${index}-`, 24),
      url: fixedScalars(`https://example.com/link/${index}/`, 256),
    })),
    pkg: { key: keys.pkg },
    slug,
  };
}

/** Exactly the production 64-byte UTF-8 key limit in the participant grammar. */
function longTinyKey(person, folder, slot) {
  return longImageKey(person, folder, `-${slot}.png`);
}

async function put(person, key, content, label) {
  ok(
    await person.actor.my_upload({
      store: {
        key,
        content,
        contentType: "",
        contentEncoding: "identity",
        chunks: 1n,
      },
    }),
    label,
  );
}

async function drop(person, key, label) {
  ok(await person.actor.my_upload({ delete: { key } }), label);
}

function outcome(entry) {
  return variant(entry.outcome);
}

function accountKey(ledger, owner) {
  return `${ledger.id.toText()}|${owner.toText()}`;
}

function sponsorPairKey(sponsor, ledger) {
  return `${sponsor.id}|${ledger.id.toText()}`;
}

async function readWholeWeek(actor, seasonId, week) {
  const entries = [];
  let after = [];
  let total = null;
  for (let guard = 0; ; guard += 1) {
    assert.ok(guard < 10, `week ${week} paging did not terminate`);
    const page = await actor.season_week_page(seasonId, BigInt(week), after, 200n);
    total ??= page.total;
    assert.equal(page.total, total, `week ${week} total moved while paging`);
    entries.push(...page.rows.map((view) => view.entry));
    if (page.next.length === 0) break;
    after = page.next;
  }
  assert.equal(total, BigInt(HACKERS), `week ${week}: bounded field total`);
  assert.equal(entries.length, HACKERS, `week ${week}: paged every entry`);
  assert.equal(new Set(entries.map((entry) => entry.id.toString())).size, HACKERS);
  assert.equal(new Set(entries.map((entry) => entry.user_id.toString())).size, HACKERS);
  return entries;
}

async function assertBeforeVoteLock(env, label) {
  const live = await env.live();
  assert.ok(live, `${label}: a round must still be running`);
  const now = BigInt(Math.floor(await env.pic.getTime())) * 1_000_000n;
  assert.ok(
    live.weekEndsAt > now + VOTE_LOCK_NANOS,
    `${label}: workload pacing reached the final-hour vote lock`,
  );
  return live;
}

function chooseAllowed(person, candidates, start, excluded = []) {
  const banned = new Set(excluded.map((entry) => entry.id.toString()));
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const entry = candidates[(start + offset) % candidates.length];
    if (entry.user_id !== person.id && !banned.has(entry.id.toString())) return entry;
  }
  throw new Error(`${person.handle} has no eligible ballot target`);
}

async function qualifierVotes(judges, targets, batches = inBatches) {
  const records = await batches(judges, 20, async (judge, index) => {
    const first = chooseAllowed(judge, targets, 0);
    const tails = targets.slice(1);
    const second = chooseAllowed(judge, tails, index % tails.length, [first]);
    ok(await judge.actor.cast_vote(first.id), `${judge.handle}: first qualifier vote`);
    ok(await judge.actor.cast_vote(second.id), `${judge.handle}: second qualifier vote`);
    return { judge, index, first, second };
  });

  await batches(records, 20, async (record) => {
    ok(await record.judge.actor.withdraw_vote(record.second.id), "withdraw qualifier vote");
    record.second = chooseAllowed(
      record.judge,
      targets.slice(1),
      (record.index + 1) % (targets.length - 1),
      [record.first],
    );
    ok(await record.judge.actor.cast_vote(record.second.id), "recast qualifier vote");
  });
  return records;
}

async function semifinalVotes(judges, desiredA, otherA, desiredB, otherB, batches = inBatches) {
  const records = await batches(judges, 20, async (judge) => {
    const first = chooseAllowed(judge, [desiredA, otherA], 0);
    const second = chooseAllowed(judge, [desiredB, otherB], 0, [first]);
    ok(await judge.actor.cast_vote(first.id), "semifinal A vote");
    ok(await judge.actor.cast_vote(second.id), "semifinal B vote");
    return { judge, first, second };
  });
  await batches(records, 20, async (record) => {
    ok(await record.judge.actor.withdraw_vote(record.second.id), "withdraw semifinal vote");
    ok(await record.judge.actor.cast_vote(record.second.id), "recast semifinal vote");
  });
  return records;
}

async function finalVotes(judges, champion, other, batches = inBatches) {
  const records = await batches(judges, 20, async (judge, index) => {
    const first = chooseAllowed(judge, [champion, other], 0);
    ok(await judge.actor.cast_vote(first.id), "final vote");
    let second = null;
    if (index % 2 === 0 && other.user_id !== judge.id && other.id !== first.id) {
      ok(await judge.actor.cast_vote(other.id), "second final vote");
      second = other;
    }
    return { judge, first, second };
  });
  await batches(records.filter((record) => record.second), 20, async (record) => {
    ok(await record.judge.actor.withdraw_vote(record.second.id), "withdraw final vote");
    ok(await record.judge.actor.cast_vote(record.second.id), "recast final vote");
  });
  return records;
}

test("a bounded whole season projects the 1,000-hacker memory envelope", async () => {
  const wallStartedAtMs = Date.now();
  const env = await bootstrap();
  const replicaStartedAtMs = Math.floor(await env.pic.getTime());
  let replicaObservedAtMs = replicaStartedAtMs;
  const samples = [];
  const heapFloors = [];
  let peakHeapClaimed = 0n;
  let emptyAssetHeapFloor = null;
  let keyHeapFloor = null;
  let fundingHeapFloor = null;
  let participantHeapFloor = null;
  let finalHeapFloor = null;
  let phase = "bootstrap";
  let installedCycles = null;
  let observedCycles = null;
  let explicitCycleTopUps = 0n;
  const pace = pocketIcPacer(env);
  const pacedBatches = (items, size, job) => inBatches(items, size, job, { pace });
  const recordCycleTopUp = (amount) => {
    explicitCycleTopUps += BigInt(amount);
  };

  const cycleReport = () => {
    const setupConsumed = installedCycles === null
      ? null
      : POCKET_IC_PROVISIONED_CYCLES - installedCycles;
    const workloadConsumed = installedCycles === null || observedCycles === null
      ? null
      : installedCycles + explicitCycleTopUps - observedCycles;
    const totalConsumed = observedCycles === null
      ? null
      : POCKET_IC_PROVISIONED_CYCLES + explicitCycleTopUps - observedCycles;
    return {
      provisioned: POCKET_IC_PROVISIONED_CYCLES.toString(),
      installed: installedCycles?.toString() ?? null,
      observed: observedCycles?.toString() ?? null,
      explicitTopUps: explicitCycleTopUps.toString(),
      setupConsumed: setupConsumed?.toString() ?? null,
      workloadConsumed: workloadConsumed?.toString() ?? null,
      totalConsumed: totalConsumed?.toString() ?? null,
    };
  };

  const projectionReport = () => {
    if (
      emptyAssetHeapFloor === null ||
      keyHeapFloor === null ||
      fundingHeapFloor === null ||
      participantHeapFloor === null
    ) {
      return null;
    }
    const assetSampleRetained = keyHeapFloor.heap > emptyAssetHeapFloor.heap
      ? keyHeapFloor.heap - emptyAssetHeapFloor.heap
      : 0n;
    const moneySample = fundingHeapFloor.heap > keyHeapFloor.heap
      ? fundingHeapFloor.heap - keyHeapFloor.heap
      : 0n;
    const participantWithAssets = participantHeapFloor.heap > fundingHeapFloor.heap
      ? participantHeapFloor.heap - fundingHeapFloor.heap
      : 0n;
    const sampledAppFiles = participantHeapFloor.files > keyHeapFloor.files
      ? participantHeapFloor.files - keyHeapFloor.files
      : 0n;
    const appAssetAllowance = sampledAssetAllowance(sampledAppFiles);
    const participantSample = participantWithAssets > appAssetAllowance
      ? participantWithAssets - appAssetAllowance
      : 0n;
    const payoutSample = finalHeapFloor !== null && finalHeapFloor.heap > participantHeapFloor.heap
      ? finalHeapFloor.heap - participantHeapFloor.heap
      : 0n;
    const central = roundUp(
      PROJECTED_ASSET_HEAP_CENTRAL +
        PROJECTED_ENTRY_REVISION_CENTRAL +
        PROJECTED_CHANGELOG_CENTRAL +
        PROJECTED_PROFILE_UNICODE_CENTRAL +
        PROJECTED_CONTROL_CENTRAL,
      HEAP_ARENA,
    );
    const upper = roundUp(
      PROJECTED_ASSET_HEAP_UPPER +
        PROJECTED_ENTRY_REVISION_UPPER +
        PROJECTED_CHANGELOG_UPPER +
        PROJECTED_PROFILE_UNICODE_UPPER +
        PROJECTED_CONTROL_UPPER,
      HEAP_ARENA,
    );
    return {
      method: "captured asset-index calibration plus a bounded-state planning model",
      usesMeasuredTargetDelta: false,
      scope: "one configured season at published account, role, entry, and text limits",
      caveat:
        "central and upper are modeled planning estimates, not a physical 1,000-hacker measurement",
      calibration: {
        capacityRosterProfiles: TARGET_ACCOUNTS,
        capacityRosterHackers: TARGET_HACKERS,
        capacityRosterJudges: 1_005,
        capacityRosterModerators: 5,
        capacityRosterClaimed: CALIBRATION_PROFILE_HEAP.toString(),
        files: CALIBRATION_FILES.toString(),
        filesClaimed: CALIBRATION_24K_HEAP.toString(),
        arenaBytes: HEAP_ARENA.toString(),
      },
      // Live heap is intentionally diagnostic only. Its GC-dependent floors
      // were non-monotonic across identical runs, so scaling them would turn
      // collector timing into a fictitious multi-gigabyte retained cost.
      sampleFloorDiagnostics: {
        scaled: false,
        assetIndexRetained: assetSampleRetained.toString(),
        fundingAndSeason: moneySample.toString(),
        participantIncludingAssets: participantWithAssets.toString(),
        sampledAppFiles: sampledAppFiles.toString(),
        sampledAppAssetAllowance: appAssetAllowance.toString(),
        participantMetadata: participantSample.toString(),
        reconciliationAndPayout: payoutSample.toString(),
      },
      components: {
        assetAndFullRosterCentral: PROJECTED_ASSET_HEAP_CENTRAL.toString(),
        assetAndFullRosterUpper: PROJECTED_ASSET_HEAP_UPPER.toString(),
        entryRows: TARGET_ENTRY_ROWS,
        revisionRows: TARGET_REVISION_ROWS,
        entryRevisionRaw: TARGET_ENTRY_REVISION_RAW.toString(),
        entryRevisionCentral: PROJECTED_ENTRY_REVISION_CENTRAL.toString(),
        entryRevisionUpper: PROJECTED_ENTRY_REVISION_UPPER.toString(),
        changelogRaw: TARGET_CHANGELOG_RAW.toString(),
        changelogCentral: PROJECTED_CHANGELOG_CENTRAL.toString(),
        changelogUpper: PROJECTED_CHANGELOG_UPPER.toString(),
        profileTextRaw: TARGET_PROFILE_TEXT_RAW.toString(),
        profileUnicodeCentral: PROJECTED_PROFILE_UNICODE_CENTRAL.toString(),
        profileUnicodeUpper: PROJECTED_PROFILE_UNICODE_UPPER.toString(),
        voteRows: TARGET_VOTE_ROWS,
        actionRows: TARGET_ACTION_ROWS,
        noticeRows: TARGET_NOTICE_ROWS,
        approvalRows: TARGET_APPROVAL_ROWS,
        takedownContextRows: TARGET_TAKEDOWN_APPROVAL_ROWS,
        sponsorLedgerPairs: TARGET_SPONSORS * LEDGERS,
        payoutRows: PAYOUT_ROWS,
        controlTextRaw: TARGET_CONTROL_TEXT_RAW.toString(),
        controlAndRuntimeCentral: PROJECTED_CONTROL_CENTRAL.toString(),
        controlAndRuntimeUpper: PROJECTED_CONTROL_UPPER.toString(),
      },
      centralHeapBytes: central.toString(),
      upperHeapBytes: upper.toString(),
      preferredBytes: HEAP_PREFERRED.toString(),
      modelGuardBytes: HEAP_MODEL_GUARD.toString(),
      wasm32CeilingBytes: WASM32_HEAP_CEILING.toString(),
      centralBelowPreferred: central < HEAP_PREFERRED,
      upperBelowModelGuard: upper < HEAP_MODEL_GUARD,
    };
  };

  const writeReport = (status, error = null) => {
    const wallElapsedMs = Date.now() - wallStartedAtMs;
    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(
      REPORT,
      `${JSON.stringify({
        schema: "neutron-capacity-report/v2",
        status,
        phase,
        sample: {
          hackers: HACKERS,
          accounts: ACCOUNTS,
          sponsors: SPONSORS,
          ledgers: LEDGERS,
          sponsorLedgerPairs: SPONSORS * LEDGERS,
          apps: HACKERS * QUALIFIERS,
          files: FINAL_FILES,
          expectedLiveBytes: FINAL_LIVE.toString(),
          expectedReservedBytes: FINAL_RESERVED.toString(),
        },
        target: {
          hackers: TARGET_HACKERS,
          accounts: TARGET_ACCOUNTS,
          sponsors: TARGET_SPONSORS,
          ledgers: LEDGERS,
          sponsorLedgerPairs: TARGET_SPONSORS * LEDGERS,
          apps: TARGET_APPS,
          files: TARGET_FINAL_FILES,
          participantFixtureLiveBytes: TARGET_FIXTURE_LIVE.toString(),
          participantFixtureReservedBytes: TARGET_FIXTURE_RESERVED.toString(),
          participantSimultaneousLiveBytes: TARGET_SIMULTANEOUS_LIVE.toString(),
          participantSimultaneousReservedBytes: TARGET_SIMULTANEOUS_RESERVED.toString(),
          participantAbsoluteLiveBytes: TARGET_ABSOLUTE_LIVE.toString(),
          participantHistoricalHighWaterBytes: TARGET_PARTICIPANT_HIGH_WATER.toString(),
          trustedFrontendAllowanceBytes: TRUSTED_FRONTEND_ALLOWANCE.toString(),
          planningReservedBytes: TARGET_PLANNING_RESERVED.toString(),
          compilerStableLimitBytes: COMPILER_STABLE_LIMIT.toString(),
        },
        revisionHistoryPerAccount: REVISION_HISTORY,
        rejectionReasonScalars: REJECTION_REASON_SCALARS,
        assetKeyBytes: ASSET_KEY_BYTES,
        allocatorChurnHackers: CHURN_HACKERS,
        preferredHeapBytes: HEAP_PREFERRED.toString(),
        modeledHeapGuardBytes: HEAP_MODEL_GUARD.toString(),
        peakHeapClaimed: peakHeapClaimed.toString(),
        projection: projectionReport(),
        pacing: pace.stats(),
        replicaStartedAtMs,
        replicaObservedAtMs,
        replicaElapsedMs: replicaObservedAtMs - replicaStartedAtMs,
        wallRuntimeTargetMs: WALL_RUNTIME_TARGET_MS,
        wallRuntimeLimitMs: WALL_RUNTIME_LIMIT_MS,
        wallElapsedMs,
        wallRuntimeTargetMet: wallElapsedMs <= WALL_RUNTIME_TARGET_MS,
        cycles: cycleReport(),
        error: error === null ? null : String(error?.stack ?? error),
        heapFloors: heapFloors.map((row) => Object.fromEntries(
          Object.entries(row).map(([key, value]) =>
            [key, typeof value === "bigint" ? value.toString() : value]),
        )),
        samples: samples.map((sample) => Object.fromEntries(
          Object.entries(sample).map(([key, value]) =>
            [key, typeof value === "bigint" ? value.toString() : value]),
        )),
      }, null, 2)}\n`,
    );
  };

  const sample = async (label) => {
    const memory = await env.actor.memory();
    replicaObservedAtMs = Math.floor(await env.pic.getTime());
    installedCycles ??= memory.cycles;
    observedCycles = memory.cycles;
    assert.ok(
      memory.cycles <= POCKET_IC_PROVISIONED_CYCLES + explicitCycleTopUps,
      `${label}: cycle balance exceeds provisioned balance plus recorded top-ups`,
    );
    const pacing = pace.stats();
    assert.ok(
      replicaObservedAtMs - replicaStartedAtMs >= pacing.requestedAdvanceMs,
      `${label}: PocketIC did not apply the requested workload time advances`,
    );
    const row = {
      label,
      files: memory.files,
      heap: memory.heap,
      heapClaimed: memory.heapClaimed,
      stableReserved: memory.stableReserved,
      stableLive: memory.stableLive,
      cycles: memory.cycles,
      cyclesConsumed: installedCycles + explicitCycleTopUps - memory.cycles,
      pacingSteps: pacing.steps,
    };
    samples.push(row);
    if (row.heapClaimed > peakHeapClaimed) peakHeapClaimed = row.heapClaimed;
    console.log(
      `[capacity] ${label}: files=${row.files} heap=${(Number(row.heap) / 1e9).toFixed(2)} GB ` +
      `claimed=${(Number(row.heapClaimed) / 1e9).toFixed(2)} GB ` +
      `stable=${(Number(row.stableReserved) / 1e9).toFixed(2)} GB reserved/` +
      `${(Number(row.stableLive) / 1e9).toFixed(2)} GB live ` +
      `cost=${(Number(row.cyclesConsumed) / 1e12).toFixed(3)}T cycles`,
    );
    writeReport("running");
    assert.ok(
      row.heapClaimed < HEAP_MODEL_GUARD,
      `${label}: sampled Wasm main memory claimed ${row.heapClaimed} bytes; the 3 GiB model guard was reached`,
    );
    return row;
  };

  const settledHeapFloor = async (label, moderator) => {
    let floor = null;
    for (let batch = 0; batch < 4; batch += 1) {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => moderator.actor.wake_automation()),
      );
      for (const result of results) {
        assert.ok(result && "ok" in result, `${label}: an idle automation wake failed`);
      }
      await pace();
      const memory = await env.actor.memory();
      if (floor === null || memory.heap < floor.heap) floor = memory;
    }
    const row = {
      label,
      heap: floor.heap,
      heapClaimed: floor.heapClaimed,
      files: floor.files,
    };
    heapFloors.push(row);
    return row;
  };

  try {
    await sample("installed");

    phase = "profiles and roles";
    const ledgers = [];
    for (const fee of [10n, 25n, 100n, 250n, 500n, 1_000n, 2_500n]) {
      ledgers.push(await installPayoutLedger(env, fee));
    }
    assert.equal(ledgers.length, LEDGERS);
    ok(await env.actor.set_ledger_allowlist(ledgers.map((ledger) => ledger.id)), "allow payout ledgers");

    const moderators = await makeModerators(
      env,
      MODERATORS,
      8_000_000,
      "capacity_mod",
      { pace },
    );
    const hackers = await makeHackers(env, HACKERS, 8_010_000, { pace });

    // Roles stack in production. Every sampled hacker also judges, while the
    // checked-in calibration supplies the exact full-roster heap baseline.
    const judges = [...hackers, ...moderators];
    await pacedBatches(judges, 20, async (person) => {
      ok(await person.actor.apply_as_judge(), `${person.handle}: apply to judge`);
    });
    await pacedBatches(judges, 5, async (person) => {
      await approveWithTwo(
        moderators,
        person,
        (actor) => actor.set_judge(person.handle, { approved: null }, []),
        `approve judge ${person.handle}`,
      );
    });

    const sponsors = await makeSponsors(
      env,
      moderators,
      hackers,
      ledgers,
      SPONSORS,
      8_020_000,
      { allLedgers: true, pace },
    );

    const stackedSponsorAccounts = Math.min(
      SPONSORS,
      Math.min(5, HACKERS) + Math.min(2, MODERATORS),
    );
    const observerCount =
      ACCOUNTS - HACKERS - MODERATORS - (SPONSORS - stackedSponsorAccounts);
    assert.ok(observerCount >= 0);
    const observers = await pacedBatches(
      Array.from({ length: observerCount }, (_, index) => index),
      20,
      (index) => join(env, 8_030_000 + index, `capacity_observer_${safeNumber(index)}`),
    );

    // Exact 1,000-hacker, 64-sponsor and 1,200-account boundary checks live in
    // the fast Profiles tests. Repeating those rows here was the main source
    // of multi-hour runtime and adds no information to the retained-byte slope.
    const stats = await env.actor.stats();
    assert.equal(stats.users, BigInt(ACCOUNTS));
    assert.equal(stats.hackers, BigInt(HACKERS));
    assert.equal(stats.judges, BigInt(HACKERS + MODERATORS));
    assert.equal(stats.moderators, BigInt(MODERATORS));
    assert.equal(stats.sponsors, BigInt(SPONSORS));
    assert.equal(stats.pending, 0n);
    assert.equal(stats.sponsorsPending, 0n);
    await sample(`${ACCOUNTS} sampled profiles and all roles ready`);

    phase = "allocator churn";
    const churnHackers = hackers.slice(0, CHURN_HACKERS);
    const churn = [
      { key: (person) => `/u/${person.id}/icon/churn.png`, content: bytes(8, 1), label: "small" },
      {
        key: (person) => `/u/${person.id}/shots/churn.png`,
        content: bytes(SMALL_SLOT + 1, 2),
        label: "image",
      },
      {
        key: (person) => `/u/${person.id}/pkg/999.neutron`,
        content: bytes(IMAGE_SLOT + 1, 3),
        label: "build",
      },
    ];
    for (const probe of churn) {
      await pacedBatches(churnHackers, 16, (person) =>
        put(person, probe.key(person), probe.content, `${probe.label} churn upload`));
    }
    const churned = await sample(`${CHURN_HACKERS} hackers allocated all three slab classes`);
    assert.equal(churned.files, BigInt(CHURN_HACKERS * 3));
    assert.equal(churned.stableReserved, CHURN_RESERVED);
    assert.equal(churned.stableLive, CHURN_LIVE);

    for (const probe of churn) {
      await pacedBatches(churnHackers, 20, (person) =>
        drop(person, probe.key(person), `${probe.label} churn delete`));
    }
    const emptied = await sample("all churn files deleted");
    assert.equal(emptied.files, 0n);
    assert.equal(emptied.stableReserved, CHURN_RESERVED, "Region high-water marks do not shrink");
    assert.equal(emptied.stableLive, 0n);
    emptyAssetHeapFloor = await settledHeapFloor("empty participant-asset index", moderators[0]);

    phase = "maximum asset-key population";
    const tiny = bytes(TINY_BYTES, 9);
    for (let slot = 0; slot < EXTRA_HACKER_KEYS; slot += 1) {
      await pacedBatches(hackers, 24, (person) =>
        put(person, longTinyKey(person, "icon", slot), tiny, "hacker heap-key upload"));
      if ((slot + 1) % 8 === 0) await sample(`${slot + 1} extra keys per hacker`);
    }

    const hackerIds = new Set(hackers.map((person) => person.id.toString()));
    const nonHackerMap = new Map();
    for (const person of [...moderators, ...sponsors, ...observers]) {
      if (!hackerIds.has(person.id.toString())) nonHackerMap.set(person.id.toString(), person);
    }
    const nonHackers = [...nonHackerMap.values()];
    assert.equal(nonHackers.length, NON_HACKERS);
    for (let slot = 0; slot < 2; slot += 1) {
      await pacedBatches(nonHackers, 24, (person) =>
        put(person, longTinyKey(person, "avatar", slot), tiny, "non-hacker heap-key upload"));
    }
    const keyBase = await sample(`${EXTRA_FILES} maximum-length participant keys live`);
    assert.equal(keyBase.files, BigInt(EXTRA_FILES));
    assert.equal(keyBase.stableLive, BigInt(EXTRA_FILES * TINY_BYTES));
    assert.equal(keyBase.stableReserved, KEY_BASE_RESERVED);
    assert.ok(
      keyBase.heapClaimed <= CALIBRATION_PROFILE_HEAP + HEAP_ARENA,
      "the short asset sample exceeded the calibrated working set plus one heap arena",
    );
    const keyFloor = await settledHeapFloor("asset-index baseline", moderators[0]);
    keyHeapFloor = keyFloor;
    const retainedAssetDelta = keyFloor.heap > emptyAssetHeapFloor.heap
      ? keyFloor.heap - emptyAssetHeapFloor.heap
      : 0n;
    assert.ok(
      retainedAssetDelta <= HEAP_ARENA,
      `1,040 sampled keys retained ${retainedAssetDelta} heap bytes; the asset calibration is stale`,
    );

    phase = "launch and funding";
    const draft = ok(await moderators[0].actor.create_season(), "create capacity season");
    ok(await env.seal(), "seal capacity canister");
    assert.deepEqual(
      (await env.pic.getControllers(env.canisterId)).map((principal) => principal.toText()),
      [env.canisterId.toText()],
    );
    const season = ok(await moderators[0].actor.start_season(draft.id), "start capacity season");
    await loadSponsorDeposits(sponsors, { pace });

    const funding = fundingModel(ledgers);
    await creditSponsors(sponsors, funding, {
      repetitions: 3,
      base: 1_000_000n,
      pace,
    });

    // Anyone can transfer to a published sponsor account. The ledger does not
    // identify a sender, and reconciliation must treat the balance exactly as
    // it treats a transfer initiated by the sponsor.
    const outsiderSponsor = sponsors[0];
    const outsiderLedger = outsiderSponsor.ledgers[0];
    const outsiderDeposit = 777_777n;
    await outsiderLedger.actor.credit(outsiderSponsor.deposit, outsiderDeposit);
    await pace();
    const outsiderPair = sponsorPairKey(outsiderSponsor, outsiderLedger);
    funding.pending.set(outsiderPair, (funding.pending.get(outsiderPair) ?? 0n) + outsiderDeposit);

    await collectSponsors(sponsors, funding, { pace });
    await waitOneSweepWindow(env);
    await creditSponsors(sponsors, funding, {
      repetitions: 1,
      base: 2_000_000n,
      pace,
    });
    await collectSponsors(sponsors, funding, {
      select: (_sponsor, index) => index % 2 === 0,
      pace,
    });
    await waitOneSweepWindow(env);
    await creditSponsors(sponsors, funding, {
      repetitions: 1,
      base: 3_000_000n,
      pace,
    });

    // Empty one fully-funded deposit, then let a third party leave exactly one
    // transfer fee behind. There is no economical transfer the canister can
    // make from that balance; #Nothing must count as a healthy, finished pair.
    const dustSponsor = sponsors[sponsors.length - 1];
    const dustLedger = ledgers[ledgers.length - 1];
    await collectSponsors([dustSponsor], funding, { pace });
    await dustLedger.actor.credit(dustSponsor.deposit, dustLedger.fee);
    await pace();
    const dustPair = sponsorPairKey(dustSponsor, dustLedger);
    funding.pending.set(dustPair, dustLedger.fee);

    // A direct transfer to the central account is part of the pool snapshot;
    // it does not need a sponsor row and must not make settlement inconsistent.
    const central = principalAccount(env.canisterId);
    const earlyCentral = new Map();
    for (const [index, ledger] of ledgers.entries()) {
      const amount = 5_000_000n + BigInt(index * 1_000);
      await ledger.actor.credit(central, amount);
      funding.pools.set(ledger.id.toText(), (funding.pools.get(ledger.id.toText()) ?? 0n) + amount);
      earlyCentral.set(ledger.id.toText(), amount);
      await pace();
    }

    // Accounts are additive. Winners may already hold the token before a
    // reward arrives, and an unrelated funded subaccount must be ignored.
    const expectedWinners = hackers.slice(0, 20);
    const walletBaselines = new Map();
    for (const ledger of ledgers) {
      await pacedBatches(expectedWinners, 20, async (winner, index) => {
        const amount = 10_000n + BigInt(index);
        await ledger.actor.credit(principalAccount(winner.wallet), amount);
        walletBaselines.set(accountKey(ledger, winner.wallet), amount);
      });
    }
    const losingWallet = hackers[HACKERS - 1].wallet;
    const losingBaselines = new Map();
    const orphanAccounts = new Map();
    for (const [index, ledger] of ledgers.entries()) {
      const losing = 20_000n + BigInt(index);
      await ledger.actor.credit(principalAccount(losingWallet), losing);
      losingBaselines.set(ledger.id.toText(), losing);
      const orphan = {
        owner: env.canisterId,
        subaccount: [Array.from(derivedSubaccount(99, BigInt(index + 1)))],
      };
      const amount = 30_000n + BigInt(index);
      await ledger.actor.credit(orphan, amount);
      orphanAccounts.set(ledger.id.toText(), { account: orphan, amount });
      await pace();
    }
    const fundingFloor = await settledHeapFloor("season and sponsor-funding baseline", moderators[0]);
    fundingHeapFloor = fundingFloor;

    const qualifierWinners = [];
    const expectedClaims = new Map();
    const afterUploads = [];

    for (let week = 1; week <= QUALIFIERS; week += 1) {
      phase = `qualifier ${week} uploads`;
      const maxBodyPerson = hackers[(week - 1) * 5];
      const passes = [
        {
          size: ICON_BYTES,
          compactSize: TINY_BYTES,
          marker: week * 10 + 1,
          key: (person) => appKeys(person, week).icon,
        },
        ...Array.from({ length: SHOTS }, (_, shot) => ({
          size: SHOT_BYTES,
          compactSize: SMALL_SLOT + 1,
          marker: week * 10 + shot + 2,
          key: (person) => appKeys(person, week).shots[shot],
        })),
        {
          size: PACKAGE_BYTES,
          compactSize: IMAGE_SLOT + 1,
          marker: week * 10 + 9,
          key: (person) => appKeys(person, week).pkg,
        },
      ];
      for (const pass of passes) {
        const maximum = bytes(pass.size, pass.marker);
        const compact = bytes(pass.compactSize, pass.marker);
        await pacedBatches(hackers, 12, (person) =>
          put(
            person,
            pass.key(person),
            person.id === maxBodyPerson.id ? maximum : compact,
            `week ${week} representative asset upload`,
          ));
      }

      const uploaded = await sample(`qualifier ${week}: every slab class populated`);
      const expectedFiles = EXTRA_FILES + week * HACKERS * 8;
      const expectedLive = BigInt(EXTRA_FILES * TINY_BYTES) +
        BigInt(week) * BigInt(MAX_APP_LIVE + (HACKERS - 1) * COMPACT_APP_LIVE);
      const expectedReserved =
        BigInt(EXTRA_FILES + week * HACKERS) * BigInt(SMALL_SLOT) +
        BigInt(week * HACKERS * SHOTS) * BigInt(IMAGE_SLOT) +
        BigInt(week * HACKERS) * BigInt(BUILD_SLOT);
      assert.equal(uploaded.files, BigInt(expectedFiles));
      assert.equal(uploaded.stableLive, expectedLive);
      assert.equal(uploaded.stableReserved, expectedReserved);
      afterUploads.push(uploaded);

      if (week === QUALIFIERS) {
        const owner = hackers[0];
        const existing = longTinyKey(owner, "icon", 0);
        const replacement = longTinyKey(owner, "icon", 99);
        await put(owner, existing, tiny, "overwrite is allowed at the 64-key ceiling");
        await pace();
        const overflowKey = await owner.actor.my_upload({
          store: {
            key: replacement,
            content: tiny,
            contentType: "",
            contentEncoding: "identity",
            chunks: 1n,
          },
        });
        assert.ok(
          "err" in overflowKey && /at most 64 asset keys/.test(overflowKey.err),
          `the 65th key was not refused: ${JSON.stringify(overflowKey)}`,
        );
        await pace();
        await drop(owner, existing, "delete reopens one key slot");
        await pace();
        await put(owner, replacement, tiny, "a fresh key reuses the reopened slot");
        await pace();
      }

      // Read back a representative large body. Counters alone could agree
      // while a broken store failed to persist the bytes.
      const probeKey = appKeys(maxBodyPerson, week).pkg;
      const response = await env.actor.http_request({
        url: probeKey,
        method: "GET",
        body: new Uint8Array(),
        headers: [],
        certificate_version: [],
      });
      assert.equal(response.status_code, 200);
      const probe = Uint8Array.from(response.body);
      assert.equal(probe.length, PACKAGE_BYTES);
      assert.deepEqual([...probe.subarray(0, PNG.length)], [...PNG]);
      assert.equal(probe[probe.length - 1], week * 10 + 9);

      phase = `qualifier ${week} moderation`;
      if (week === 1) {
        phase = "maximum retained revision history";
        const reason = "🧪".repeat(REJECTION_REASON_SCALARS);
        assert.equal(Array.from(reason).length, REJECTION_REASON_SCALARS);
        assert.equal(new TextEncoder().encode(reason).length, REJECTION_REASON_SCALARS * 4);
        for (let attempt = 0; attempt < REVISION_HISTORY; attempt += 1) {
          const rejected = await pacedBatches(hackers, 15, async (person) => ({
            person,
            revision: ok(
              await person.actor.submit_entry(entryInput(person, week)),
              `submit retained rejection ${attempt + 1}`,
            ),
          }));
          await pacedBatches(rejected, 10, ({ revision }, index) =>
            moderators[(attempt + index) % moderators.length].actor
              .reject_revision(revision.id, reason)
              .then((result) => ok(result, "retain maximum rejection reason")));
        }
        assert.equal(await moderators[0].actor.review_pending(), 0n);
        assert.equal(
          (await hackers[0].actor.my_revisions(100n)).length,
          REVISION_HISTORY,
        );
        await sample(`${HACKERS} maximum retained rejection histories populated`);
        const revisionFloor = await settledHeapFloor("retained revision-history floor", moderators[0]);
        participantHeapFloor = revisionFloor;
        phase = `qualifier ${week} moderation`;
      }
      const proposals = await pacedBatches(hackers, 15, async (person) => ({
        person,
        revision: ok(await person.actor.submit_entry(entryInput(person, week)), "submit full entry"),
      }));
      assert.equal(await moderators[0].actor.review_pending(), BigInt(HACKERS));
      await pacedBatches(proposals, 10, ({ revision }) =>
        moderators[0].actor.approve_revision(revision.id).then((result) => ok(result, "approve entry")));
      assert.equal(await moderators[0].actor.review_pending(), 0n);
      if (week <= 2) {
        assert.equal(
          (await hackers[0].actor.my_revisions(100n)).length,
          REVISION_HISTORY,
          `week ${week}: revision history remains at its production cap`,
        );
      }

      const entries = await readWholeWeek(env.actor, season.id, week);
      const byUser = new Map(entries.map((entry) => [entry.user_id.toString(), entry]));
      const targets = hackers.slice((week - 1) * 5, week * 5).map((person) => {
        const entry = byUser.get(person.id.toString());
        assert.ok(entry, `${person.handle}: target entry missing`);
        return entry;
      });
      await sample(`qualifier ${week}: ${HACKERS} entries approved`);

      phase = `qualifier ${week} voting`;
      const ballots = await qualifierVotes(judges, targets, pacedBatches);
      assert.equal(await judges[0].actor.my_votes_left(), 0n);
      assert.equal(await judges[judges.length - 1].actor.my_votes_left(), 0n);
      await sample(`qualifier ${week}: votes withdrawn and recast`);
      const qualifierFloor = await settledHeapFloor(
        `qualifier ${week} retained-metadata floor`,
        moderators[0],
      );
      if (participantHeapFloor === null || qualifierFloor.heap > participantHeapFloor.heap) {
        participantHeapFloor = qualifierFloor;
      }

      const live = await assertBeforeVoteLock(env, `qualifier ${week}`);
      await env.pic.setTime(Number((live.weekEndsAt - VOTE_LOCK_NANOS) / 1_000_000n) + 1);
      assert.deepEqual(await ballots[ballots.length - 1].judge.actor.withdraw_vote(
        ballots[ballots.length - 1].second.id,
      ), { err: { VoteLocked: null } });

      const stableBeforeClose = await env.actor.memory();
      await recoverDueRound(env, moderators, { onTopUp: recordCycleTopUp });
      const closed = await env.actor.season_week(season.id, BigInt(week), 10n);
      assert.equal(closed.filter((entry) => outcome(entry) === "advanced").length, 1);
      assert.equal(closed.filter((entry) => outcome(entry) === "rewarded").length, 4);
      assert.equal(closed.filter((entry) => outcome(entry) !== "none").length, 5);
      for (const entry of closed.filter((row) => outcome(row) !== "none")) {
        const person = hackers.find((hacker) => hacker.id === entry.user_id);
        assert.ok(person, `qualifier claim owner ${entry.user_id} is a fixture hacker`);
        expectedClaims.set(entry.user_id.toString(), {
          person,
          entryId: entry.id,
          award: "bronze",
          weight: 250n,
        });
      }
      const winner = closed.find((entry) => outcome(entry) === "advanced");
      assert.ok(winner);
      assert.equal(winner.user_id, hackers[(week - 1) * 5].id);
      qualifierWinners.push(winner);
      const closedMemory = await sample(`qualifier ${week}: recovered through deadline`);
      assert.equal(closedMemory.stableReserved, stableBeforeClose.stableReserved);
      assert.equal(closedMemory.stableLive, stableBeforeClose.stableLive);
    }

    phase = "semifinal";
    const semi = await env.actor.season_week(season.id, 5n, 10n);
    assert.equal(semi.length, 4);
    const semiByUser = new Map(semi.map((entry) => [entry.user_id.toString(), entry]));
    const qa = qualifierWinners.map((winner) => semiByUser.get(winner.user_id.toString()));
    assert.ok(qa.every(Boolean));
    const semiBallots = await semifinalVotes(
      judges,
      qa[1],
      qa[0],
      qa[2],
      qa[3],
      pacedBatches,
    );
    assert.equal(await judges[0].actor.my_votes_left(), 0n);
    await sample("semifinal votes withdrawn and recast");
    const semifinalFloor = await settledHeapFloor("semifinal retained-metadata floor", moderators[0]);
    if (participantHeapFloor === null || semifinalFloor.heap > participantHeapFloor.heap) {
      participantHeapFloor = semifinalFloor;
    }
    let live = await assertBeforeVoteLock(env, "semifinal");
    await env.pic.setTime(Number((live.weekEndsAt - VOTE_LOCK_NANOS) / 1_000_000n) + 1);
    assert.deepEqual(await semiBallots[0].judge.actor.withdraw_vote(semiBallots[0].second.id), {
      err: { VoteLocked: null },
    });
    await recoverDueRound(env, moderators, { onTopUp: recordCycleTopUp });
    const closedSemi = await env.actor.season_week(season.id, 5n, 10n);
    assert.equal(closedSemi.filter((entry) => outcome(entry) === "advanced").length, 2);
    for (const entry of closedSemi.filter((row) => outcome(row) === "advanced")) {
      const claim = expectedClaims.get(entry.user_id.toString());
      assert.ok(claim, `semifinal claim ${entry.user_id} has a qualifier root`);
      expectedClaims.set(entry.user_id.toString(), {
        ...claim,
        entryId: entry.id,
        award: "silver",
        weight: 2_000n,
      });
    }
    await sample("semifinal recovered through deadline");

    phase = "final";
    const final = await env.actor.season_week(season.id, 6n, 10n);
    assert.equal(final.length, 2);
    const champion = final.find((entry) => entry.user_id === qualifierWinners[1].user_id);
    const runner = final.find((entry) => entry.id !== champion?.id);
    assert.ok(champion && runner);
    const finalBallots = await finalVotes(judges, champion, runner, pacedBatches);
    await sample("final votes withdrawn and recast");
    const finalBallotFloor = await settledHeapFloor("final retained-metadata floor", moderators[0]);
    participantHeapFloor = finalBallotFloor;
    live = await assertBeforeVoteLock(env, "final");
    await env.pic.setTime(Number((live.weekEndsAt - VOTE_LOCK_NANOS) / 1_000_000n) + 1);
    const lockBallot = finalBallots.find((ballot) => ballot.second);
    assert.deepEqual(await lockBallot.judge.actor.withdraw_vote(lockBallot.second.id), {
      err: { VoteLocked: null },
    });
    const finished = await recoverDueRound(env, moderators, { onTopUp: recordCycleTopUp });
    assert.deepEqual(finished.phase, { finished: null });
    const closedFinal = await env.actor.season_week(season.id, 6n, 10n);
    assert.equal(closedFinal.filter((entry) => outcome(entry) === "won").length, 1);
    const won = closedFinal.find((entry) => outcome(entry) === "won");
    assert.equal(won.user_id, champion.user_id);
    const gold = expectedClaims.get(won.user_id.toString());
    assert.ok(gold, "final claim has a qualifier root");
    expectedClaims.set(won.user_id.toString(), {
      ...gold,
      entryId: won.id,
      award: "gold",
      weight: 3_500n,
    });
    const finishedMemory = await sample("season finished; funding reconciliation armed");
    assert.equal(finishedMemory.files, BigInt(FINAL_FILES));
    assert.equal(finishedMemory.stableLive, FINAL_LIVE);
    assert.equal(finishedMemory.stableReserved, FINAL_RESERVED);

    phase = "funding reconciliation";
    expectFinalReconciliation(sponsors, funding);
    const fundingDue = Number((finished.endedAt + FUNDING_GRACE_NANOS) / 1_000_000n) + 1;
    // Funding completion arms payout for +1 second. Use one recovery caller
    // and no trailing ticks so the test can inspect the frozen all-planned
    // snapshot before intentionally allowing any transfer to run.
    await recoverAutomationAt(env, [moderators[0]], fundingDue, {
      settleTicks: 0,
      onTopUp: recordCycleTopUp,
    });
    let [funded] = await env.actor.season_by_number(season.number);
    for (let attempt = 0; !funded.fundingReady && attempt < 12; attempt += 1) {
      ok(await moderators[attempt % moderators.length].actor.wake_automation(), "continue funding");
      [funded] = await env.actor.season_by_number(season.number);
    }
    assert.equal(funded.fundingReady, true, "healthy ledgers freeze the funding snapshot");
    assert.deepEqual(funded.fundingFailures, []);
    // Do not advance time after fundingReady: the frozen plan must be captured
    // while every row is still #planned, before its +1 second payout timer.
    await assertDepositBalances(sponsors, funding);
    await assertSponsorAccounting(sponsors, funding);

    const frozenPlan = await env.actor.payout_plan(season.id);
    assert.equal(expectedClaims.size, CLAIMS);
    assert.equal(
      [...expectedClaims.values()].reduce((sum, claim) => sum + claim.weight, 0n),
      10_000n,
      "the full published award field carries exactly 10,000 weight",
    );
    assert.equal(frozenPlan.length, PAYOUT_ROWS, "twenty app claims across seven ledgers");
    const awardCounts = new Map();
    for (const row of frozenPlan) {
      const award = variant(row.award);
      awardCounts.set(award, (awardCounts.get(award) ?? 0) + 1);
      assert.equal(variant(row.state), "planned");
    }
    assert.equal(awardCounts.get("bronze"), 18 * LEDGERS);
    assert.equal(awardCounts.get("silver"), LEDGERS);
    assert.equal(awardCounts.get("gold"), LEDGERS);
    for (const ledger of ledgers) {
      const rows = frozenPlan.filter((row) => row.ledger.toText() === ledger.id.toText());
      assert.equal(rows.length, CLAIMS);
      assert.equal(
        rows.reduce((sum, row) => sum + row.gross, 0n),
        funding.pools.get(ledger.id.toText()),
      );

      // Expected independently from the plan rows: exact earning app, owner,
      // chosen wallet, published weight, fee, and deterministic dust carrier.
      const pool = funding.pools.get(ledger.id.toText());
      const shares = [...expectedClaims.values()].map((claim) =>
        (pool * claim.weight) / 10_000n);
      const remainder = pool - shares.reduce((sum, share) => sum + share, 0n);
      const rowsByEntry = new Map(rows.map((row) => [row.entry_id.toString(), row]));
      for (const [index, claim] of [...expectedClaims.values()].entries()) {
        const row = rowsByEntry.get(claim.entryId.toString());
        assert.ok(row, `${ledger.id}: missing independently expected entry ${claim.entryId}`);
        const carries = claim.award === "gold";
        const gross = shares[index] + (carries ? remainder : 0n);
        assert.equal(row.user_id, claim.person.id, `${claim.entryId}: claim owner`);
        assert.equal(row.handle, claim.person.handle, `${claim.entryId}: claim handle`);
        assert.equal(row.to.toText(), claim.person.wallet.toText(), `${claim.entryId}: reward wallet`);
        assert.equal(variant(row.award), claim.award, `${claim.entryId}: award`);
        assert.equal(row.gross, gross, `${claim.entryId}: weighted gross`);
        assert.equal(row.fee, ledger.fee, `${claim.entryId}: frozen fee`);
        assert.equal(row.net, gross - ledger.fee, `${claim.entryId}: wallet net`);
        assert.equal(row.dust, carries ? remainder : 0n, `${claim.entryId}: pool remainder`);
      }
    }
    await sample(`funding snapshot and ${PAYOUT_ROWS}-row payout plan frozen`);

    // Transfers after the one-time snapshot are unsupported, but permissionless
    // ledger accounts mean they are unavoidable. They must remain balances,
    // not invalidate or silently expand the already-frozen reward plan.
    const lateCentral = new Map();
    for (const [index, ledger] of ledgers.entries()) {
      const amount = 40_000n + BigInt(index);
      await ledger.actor.credit(central, amount);
      lateCentral.set(ledger.id.toText(), amount);
    }
    const lateSponsor = 50_000n;
    await outsiderLedger.actor.credit(outsiderSponsor.deposit, lateSponsor);
    assert.deepEqual(await env.actor.payout_plan(season.id), frozenPlan);

    phase = "payout";
    await env.pic.advanceTime(2 * SECOND);
    await env.pic.tick(8);
    let progress = await env.actor.payout_progress(season.id);
    for (let attempt = 0; progress.left > 0n && attempt < 12; attempt += 1) {
      ok(
        await moderators[attempt % moderators.length].actor.run_payout(season.id),
        "moderator payout continuation",
      );
      await env.pic.tick(12);
      progress = await env.actor.payout_progress(season.id);
    }
    assert.equal(progress.left, 0n);
    assert.equal(progress.failed, 0n);
    assert.equal(progress.paid, BigInt(PAYOUT_ROWS));

    const paidPlan = await env.actor.payout_plan(season.id);
    assert.equal(paidPlan.length, frozenPlan.length);
    assert.ok(paidPlan.every((row) => variant(row.state) === "paid" && row.block.length === 1));
    assert.equal(
      new Set(paidPlan.map((row) => `${row.ledger.toText()}|${row.block[0]}`)).size,
      paidPlan.length,
      "every payout has its own ledger receipt",
    );

    const expectedWallets = new Map(walletBaselines);
    for (const row of paidPlan) {
      const key = `${row.ledger.toText()}|${row.to.toText()}`;
      expectedWallets.set(key, (expectedWallets.get(key) ?? 0n) + row.net);
    }
    const ledgerById = new Map(ledgers.map((ledger) => [ledger.id.toText(), ledger]));
    for (const [key, expected] of expectedWallets) {
      const [ledgerId, wallet] = key.split("|");
      assert.equal(
        await ledgerById.get(ledgerId).actor.icrc1_balance_of(
          principalAccount(Principal.fromText(wallet)),
        ),
        expected,
        `${key}: payout adds to the wallet's pre-existing balance`,
      );
    }
    for (const ledger of ledgers) {
      assert.equal(
        await ledger.actor.icrc1_balance_of(principalAccount(losingWallet)),
        losingBaselines.get(ledger.id.toText()),
      );
      const orphan = orphanAccounts.get(ledger.id.toText());
      assert.equal(await ledger.actor.icrc1_balance_of(orphan.account), orphan.amount);
      assert.equal(
        await ledger.actor.icrc1_balance_of(central),
        lateCentral.get(ledger.id.toText()),
        "post-snapshot central tokens remain without blocking the frozen plan",
      );
    }
    assert.equal(
      await outsiderLedger.actor.icrc1_balance_of(outsiderSponsor.deposit),
      lateSponsor,
      "a post-snapshot sponsor deposit remains unsupported without blocking payout",
    );
    assert.equal(
      await dustLedger.actor.icrc1_balance_of(dustSponsor.deposit),
      dustLedger.fee,
      "fee-sized unsolicited dust remains without blocking payout",
    );

    const pools = new Map((await env.actor.prize_pool()).map(([ledger, amount]) => [ledger.toText(), amount]));
    for (const ledger of ledgers) {
      assert.equal(
        pools.get(ledger.id.toText()),
        0n,
        "the frozen accounting pool is paid even though an unsupported late ledger balance remains",
      );
    }
    const [paidSeason] = await env.actor.season_by_number(season.number);
    assert.deepEqual(paidSeason.payout, { paid: null });
    assert.equal(await env.actor.payout_armed(), false);
    assert.equal(await env.actor.withdrawals_locked(), false);
    assert.deepEqual(
      (await env.pic.getControllers(env.canisterId)).map((principal) => principal.toText()),
      [env.canisterId.toText()],
    );

    phase = "complete";
    const end = await sample("all rewards paid despite unsolicited token balances");
    assert.equal(end.files, BigInt(FINAL_FILES));
    assert.equal(end.stableLive, FINAL_LIVE);
    assert.equal(end.stableReserved, FINAL_RESERVED);
    assert.equal(await env.actor.assets_count(), BigInt(FINAL_FILES));
    assert.equal(afterUploads[afterUploads.length - 1].stableReserved, FINAL_RESERVED);
    const paidFloor = await settledHeapFloor("settled paid-state floor", moderators[0]);
    finalHeapFloor = paidFloor;
    const projection = projectionReport();
    assert.ok(projection, "all projection checkpoints were recorded");
    assert.ok(
      peakHeapClaimed < HEAP_MODEL_GUARD,
      `sample peak claimed heap ${peakHeapClaimed} crossed the ${HEAP_MODEL_GUARD}-byte model guard`,
    );
    assert.equal(
      projection.upperBelowModelGuard,
      true,
      `upper projected heap ${projection.upperHeapBytes} crossed the 3 GiB projection guard`,
    );
    assert.ok(
      BigInt(projection.upperHeapBytes) < WASM32_HEAP_CEILING,
      "upper projected heap crossed the actual wasm32 ceiling",
    );
    const wallElapsedMs = Date.now() - wallStartedAtMs;
    assert.ok(
      wallElapsedMs <= WALL_RUNTIME_LIMIT_MS,
      `bounded capacity test took ${wallElapsedMs} ms; its limit is ${WALL_RUNTIME_LIMIT_MS} ms`,
    );
    console.log(
      `[capacity] projected heap central=${(Number(projection.centralHeapBytes) / 1e9).toFixed(2)} GB ` +
      `upper=${(Number(projection.upperHeapBytes) / 1e9).toFixed(2)} GB; ` +
      `simultaneous participant stable=${(Number(TARGET_SIMULTANEOUS_RESERVED) / 1e9).toFixed(2)} GB reserved`,
    );
    writeReport("passed");
    console.log(`[capacity] report written to ${REPORT}`);
  } catch (error) {
    writeReport("failed", error);
    throw error;
  } finally {
    await env.teardown();
  }
});
