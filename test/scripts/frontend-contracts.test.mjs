/**
 * Narrow source-level release contracts for the two high-risk UI branches.
 *
 * The frontend intentionally has no DOM runner yet; the production TypeScript
 * build is the executable check. These assertions pin the authorization and
 * call-shape decisions that build alone cannot see, without pretending to be
 * browser interaction coverage.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const ROOT = resolve(import.meta.dirname, "..", "..");
const source = (name) => readFileSync(resolve(ROOT, "frontend", "src", "views", name), "utf8");
const frontendSource = (name) =>
  readFileSync(resolve(ROOT, "frontend", "src", name), "utf8");

describe("frontend release contracts", () => {
  it("makes a first app one package-bearing entry proposal, never a version proposal", () => {
    const form = source("AppSubmissionForm.tsx");
    assert.match(
      form,
      /const wantsRelease\s*=\s*!isNew\s*&&/,
      "a new entry must make the version branch unreachable",
    );
    assert.match(form, /await api\.submitEntry\(\{[\s\S]*?pkg:\s*\{ key: buildKey \}/);
    assert.match(form, /if \(packageFile && !packageDraft\)/, "one local package draft is reused");
    assert.equal(
      (form.match(/await api\.publishUpdate\(/g) ?? []).length,
      1,
      "there is one explicit update call site, behind wantsRelease",
    );
  });

  it("keeps the exact carried app selected through a version proposal", () => {
    const app = frontendSource("App.tsx");
    const api = frontendSource("api.ts");
    const form = source("AppSubmissionForm.tsx");
    const modal = source("EntryModal.tsx");
    const moderate = source("Moderate.tsx");
    const profile = source("Profile.tsx");
    const season = source("Season.tsx");

    assert.match(
      modal,
      /href=\{`#\/profile\/entries\/\$\{view\.entry\.id\}`\}/,
      "an app opened from the bracket carries its exact entry id to the editor",
    );
    assert.match(
      season,
      /api\.myEntries\(\)/,
      "the season shortcut loads every current seat",
    );
    assert.match(
      season,
      /href=\{exactMine \? `#\/profile\/entries\/\$\{exactMine\.id\}` : "#\/profile\/entries"\}/,
      "one seat is linked exactly and multiple seats route to the selector",
    );
    assert.match(app, /const \[head, tail, target\] = path\.split\("\/"\)/);
    assert.match(app, /const parsed = BigInt\(target\)/, "Nat64 ids are not rounded through Number");

    const selectionStart = profile.indexOf("const editable =");
    const selectionEnd = profile.indexOf("const pendingCurrent", selectionStart);
    const selection = profile.slice(selectionStart, selectionEnd);
    assert.ok(selectionStart >= 0 && selectionEnd > selectionStart, "the entry selection exists");
    assert.match(
      selection,
      /entryId !== null[\s\S]*?editable\.find\(\(entry\) => entry\.id === entryId\) \?\? null/,
      "an explicit target either matches exactly or selects nothing",
    );
    assert.match(
      selection,
      /editable\.length === 1[\s\S]*?editable\[0\][\s\S]*?: null/,
      "only the unambiguous single-app case chooses automatically",
    );
    assert.match(selection, /const needsChoice = entryId === null && editable\.length > 1/);
    assert.match(
      selection,
      /!invalidTarget && !needsChoice/,
      "a stale target and an unchosen multi-seat round cannot reach the form",
    );
    assert.doesNotMatch(
      selection,
      /editable\.length > 1[\s\S]*?editable\[0\]/,
      "multi-seat users never silently fall back to seat zero",
    );
    assert.match(
      profile,
      /editable\.length > 1[\s\S]*?<option value="">Choose an app…<\/option>/,
      "multi-seat users get an explicit choice",
    );
    assert.match(
      profile,
      /return title \? `\$\{title\} \(\$\{entry\.slug\}\)` : entry\.slug/,
      "same-title apps remain distinguishable by their unique stored slug",
    );
    assert.match(
      moderate,
      /const target = title \? `\$\{title\} \(\$\{identity\}\)` : identity/,
      "moderators see the same unique app identity with the title",
    );

    assert.match(
      form,
      /if \(entry === null\) throw new Error\("Choose the app this version belongs to\."\);[\s\S]*?await api\.publishUpdate\(entry\.id,/,
      "the selected id crosses the final UI boundary into the update call",
    );
    assert.match(
      api,
      /publishUpdate\(entryId: bigint, input: UpdateInput\)[\s\S]*?publish_update\(entryId, input\)/,
      "the typed API forwards that same id to the canister",
    );
  });

  it("keeps moderator distribution recovery available for unfinished runs", () => {
    const distribution = source("Distribution.tsx");
    assert.doesNotMatch(
      distribution,
      /amController|isController|controllerOnly/,
      "the moderator UI must not invent a controller-only gate",
    );
    assert.match(
      distribution,
      /phase === "approved" \|\| phase === "paying"/,
    );
    assert.doesNotMatch(
      distribution,
      /phase === "approved" \|\| phase === "paying" \|\| phase === "failed"/,
      "terminal failures are inspectable, not an unbounded retry button",
    );
    assert.match(distribution, /failed rows are retained for inspection and are not retryable/);
    assert.match(distribution, /await api\.runPayout\(season!\.id\)/);
    assert.match(distribution, /repeating it could move the funds twice/);
    assert.doesNotMatch(distribution, /bounded cutoff|retried forever/);
  });

  it("keeps lifecycle recovery a no-input moderator check", () => {
    const moderate = source("Moderate.tsx");
    const api = frontendSource("api.ts");
    const styles = frontendSource("styles.css");

    assert.match(api, /\(await backend\(\)\)\.wake_automation\(\)/);
    assert.match(moderate, /await api\.wakeAutomation\(\)/);
    assert.match(moderate, /Before work is due[\s\S]*?cannot advance early/);
    assert.match(moderate, /No duplicate pass was started/);
    assert.doesNotMatch(moderate, /wakeAutomation\([^)]/);
    assert.match(
      styles,
      /@media \(max-width: 640px\)[\s\S]*?\.season-controls \.control \{[\s\S]*?flex-direction: column;/,
      "the recovery explanation and action stack instead of squeezing on phones",
    );
  });

  it("leaves controller status to the IC dashboard and recovery policy to the backend", () => {
    const moderate = source("Moderate.tsx");
    const api = frontendSource("api.ts");
    const candid = frontendSource("declarations/hackathon.did");

    assert.match(
      api,
      /export const NEUTRINITE_DAO_CONTROLLER = "extk7-gaaaa-aaaaq-aacda-cai";/,
      "the browser displays the same fixed recovery controller installed in the canister",
    );
    assert.match(
      api,
      /function canisterDashboardUrl\(\)[\s\S]*?https:\/\/dashboard\.internetcomputer\.org\/canister\/\$\{canisterId\(\)\}/,
      "the browser links to the certified public canister status",
    );
    assert.doesNotMatch(api, /\(await backend\(\)\)\.controllers\(\)/);
    assert.doesNotMatch(api, /function (?:selfControlled|daoRecoveryEnabled)\(/);
    assert.match(
      candid,
      /controller_recovery_tally: \(\) -> \(opt ControllerRecovery\) query;/,
      "recovery progress is a no-input authenticated query",
    );
    assert.match(
      candid,
      /recover_canister: \(\) -> \(Result_\d+\);/,
      "the recovery action accepts no caller-selected controller or repair instruction",
    );
    assert.match(api, /\(await backend\(\)\)\.controller_recovery_tally\(\)/);
    assert.match(api, /\(await backend\(\)\)\.recover_canister\(\)/);
    assert.doesNotMatch(moderate, /api\.controllers\(\)/);
    assert.doesNotMatch(moderate, /api\.(?:selfControlled|daoRecoveryEnabled)\(/);
    assert.match(moderate, /const dashboardUrl = api\.canisterDashboardUrl\(\)/);
    assert.match(
      moderate,
      /The canister independently refuses to start unless it is its own sole[\s\S]*?controller\./,
      "the start button relies on the backend's exact controller check",
    );
    assert.match(moderate, /api\.controllerRecoveryTally\(\)/);
    assert.match(moderate, /await api\.recoverCanister\(\)/);
    assert.match(
      moderate,
      /one of three distinct moderator approvals[\s\S]*?NEUTRINITE_DAO_CONTROLLER[\s\S]*?visibly ends the sealed state/,
      "the confirmation explains the quorum, fixed recipient, and loss of the seal",
    );
    assert.match(moderate, /<strong>Emergency canister recovery<\/strong>/);
    assert.match(moderate, /This is separate from re-arming automation\./);
    assert.match(
      moderate,
      /If recovery already completed, checking again is idempotent/,
      "the action remains safe and useful when dashboard status is already recovered",
    );
  });

  it("does not count skipped gross twice after dust is carried", () => {
    const distribution = source("Distribution.tsx");
    assert.match(distribution, /export function ledgerPoolTotal/);
    assert.match(
      distribution,
      /const hasCarrier = lines\.some\(\(line\) => line\.dust > 0n\)/,
      "a positive dust carrier selects the absorbed-skips accounting path",
    );
    assert.match(
      distribution,
      /hasCarrier && api\.payoutState\(line\) === "skipped" \? sum : sum \+ line\.gross/,
      "skipped gross is excluded only when a carrier already absorbed it",
    );
  });

  it("shows launch-token faces and loads metadata for local ledger choices", () => {
    const picker = source("LedgerPicker.tsx");
    const distribution = source("Distribution.tsx");
    const tokens = readFileSync(resolve(ROOT, "frontend", "src", "tokens.ts"), "utf8");
    const production = JSON.parse(
      readFileSync(resolve(ROOT, "production-ledgers.json"), "utf8"),
    );

    assert.match(
      picker,
      /matches\.map[\s\S]*?<TokenRow id=\{id\} \/>/,
      "visible local options must invoke the existing live metadata row",
    );
    assert.match(picker, /const known = knownToken\(ledger\)/);
    assert.match(distribution, /<TokenLogo id=\{ledger\} meta=\{meta\} symbol=\{symbol\} \/>/);

    const trusted = new Map(
      [...tokens.matchAll(/\["([^"]+)", "(\/token-logos\/[^"]+\.png)"\]/g)].map(
        (match) => [match[1], match[2]],
      ),
    );
    const productionIds = new Set(production.ledgers.map((ledger) => ledger.id));
    for (const [id, publicPath] of trusted) {
      assert.ok(productionIds.has(id), `${id} is still an enabled production ledger`);
      const png = readFileSync(resolve(ROOT, "frontend", "public", publicPath.slice(1)));
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    }
    assert.equal(trusted.size, 5, "five ledgers retain reviewed same-origin fallbacks");
    assert.deepEqual(
      production.ledgers
        .filter((ledger) => !trusted.has(ledger.id))
        .map(({ symbol, id }) => [symbol, id]),
      [
        ["TOKO", "n5r46-eqaaa-aaaae-qfzba-cai"],
        ["cICP", "n6tkf-tqaaa-aaaal-qsneq-cai"],
      ],
      "TOKO and cICP use the acceptable raster logos published by their ledgers",
    );

    assert.match(tokens, /const LOGO_TYPES = \["png", "jpeg", "jpg", "webp", "gif", "avif"\]/);
    assert.match(tokens, /logo: logoOf\(logo\) \?\? trustedTokenLogo\(id\)/);
  });

  it("copies screenshot selections before clearing the live file input", () => {
    const form = source("AppSubmissionForm.tsx");
    const snapshot = form.indexOf("const selected = Array.from(files);");
    const update = form.indexOf("setShots((current) =>", snapshot);

    assert.ok(snapshot >= 0, "the input FileList is copied immediately");
    assert.ok(update > snapshot, "the stable copy is made before the React state updater");
    assert.match(form, /selected\.slice\(0, room\)\.map\(newShot\)/);
  });

  it("shows the useful cause inside entry-review season errors", () => {
    const api = frontendSource("api.ts");
    const form = source("AppSubmissionForm.tsx");
    const season = api.indexOf('if (has("Season"))');
    const wallet = api.indexOf('if (has("NoWallet"))');
    const walletGuard = form.indexOf("if (isNew && user.wallet.length === 0)");
    const firstUpload = form.indexOf("await api.uploadFile");

    assert.ok(season >= 0 && season < wallet, "the nested season error is unwrapped first");
    assert.match(api, /return describe\(\(error as \{ Season: SeasonError \}\)\.Season\)/);
    assert.match(api, /Set a reward wallet before submitting an app/);
    assert.ok(
      walletGuard >= 0 && walletGuard < firstUpload,
      "a missing wallet is explained before any app asset is uploaded",
    );
  });

  it("explains and prevents self-review in the moderation queue", () => {
    const moderate = source("Moderate.tsx");
    const styles = frontendSource("styles.css");

    assert.match(moderate, /reviewerId=\{reviewerId\}/);
    assert.match(moderate, /own=\{reviewerId === rev\.user_id\}/);
    assert.match(
      moderate,
      /<small className="muted mod-own-review">[\s\S]*?Moderators cannot review their own apps;/,
      "self-authored rows explain the rule in the wide details column",
    );
    assert.match(moderate, /\{own \? null : \(\s*<div className="mod-actions">/);
    assert.doesNotMatch(
      moderate,
      /<div className="mod-actions">\s*\{own \?/,
      "the explanatory sentence must not be squeezed into the button column",
    );
    assert.match(styles, /\.mod-own-review\s*\{[\s\S]*?max-width:\s*64ch;/);
  });

  it("shows a recorded first quorum vote as a brief notice rather than an error", () => {
    const moderate = source("Moderate.tsx");
    const api = frontendSource("api.ts");
    const styles = frontendSource("styles.css");

    assert.match(api, /export class ApiNotice extends ApiError/);
    assert.match(
      api,
      /"NeedsSecond" in result\.err[\s\S]*?throw new ApiNotice\(message\)/,
      "the backend's recorded first vote is classified separately from a failed action",
    );
    assert.match(moderate, /const NOTICE_TOAST_MS = 2_500;/);
    assert.match(
      moderate,
      /cause instanceof api\.ApiNotice\) setToast\(message\);\s*else setError\(message\)/,
      "only the quorum notice bypasses persistent error state",
    );
    assert.match(
      moderate,
      /window\.setTimeout\(\(\) => setToast\(null\), NOTICE_TOAST_MS\)/,
      "the notice dismisses itself after 2.5 seconds",
    );
    assert.match(
      moderate,
      /useEffect\(\(\) => \{\s*setToast\(null\);\s*\}, \[tab\]\)/,
      "switching moderation tabs clears the old notice",
    );
    assert.match(
      moderate,
      /className="notice moderation-toast" role="status"/,
      "the quorum outcome is an informational live-region toast",
    );
    assert.match(
      styles,
      /\.moderation-toast\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?pointer-events:\s*none;/,
    );
  });

  it("forwards the exact displayed role snapshot to moderation calls", () => {
    const moderate = source("Moderate.tsx");
    const api = frontendSource("api.ts");

    assert.match(
      moderate,
      /const act = async \(\s*user: PublicUser,[\s\S]*?api\.setSponsor\(user, state, note\)[\s\S]*?api\.setJudge\(user, state, note\)/,
      "the shared action keeps the displayed user row instead of reducing it to a mutable handle",
    );
    assert.doesNotMatch(
      moderate,
      /act\(\s*user\.handle,/,
      "role buttons never discard the immutable account and role snapshot",
    );
    assert.match(
      api,
      /export async function setSponsor\(\s*user: ProfileUser,[\s\S]*?set_sponsor\(\s*\{\s*id: user\.id,\s*expectedStatus: user\.sponsorStatus,\s*expectedUpdatedAt: user\.updatedAt,/,
      "sponsor decisions bind the id, application state, and row version that were reviewed",
    );
    assert.match(
      api,
      /export async function setJudge\(\s*user: ProfileUser,[\s\S]*?set_judge\(\s*\{\s*id: user\.id,\s*expectedStatus: user\.judgeStatus,\s*expectedUpdatedAt: user\.updatedAt,/,
      "judge decisions bind the id, role state, and row version that were reviewed",
    );
  });

  it("shows the complete pending sponsor application before approval", () => {
    const moderate = source("Moderate.tsx");
    const styles = frontendSource("styles.css");
    const previewStart = moderate.indexOf("function SponsorApplicationDetails");
    const previewEnd = moderate.indexOf("/**\n * The ledgers this sponsor", previewStart);
    const preview = moderate.slice(previewStart, previewEnd);
    const styleStart = styles.indexOf("/* A sponsor approval shows");
    const styleEnd = styles.indexOf(".mod-log {", styleStart);
    const previewStyles = styles.slice(styleStart, styleEnd);

    assert.ok(previewStart >= 0 && previewEnd > previewStart, "the sponsor preview exists");
    assert.match(
      moderate,
      /details=\{<SponsorApplicationDetails user=\{user\} \/>\}/,
      "each pending sponsor row shows its own application",
    );
    assert.match(preview, /api\.sponsorInfo\(user\)/);
    assert.match(preview, /api\.sponsorLogo\(user\)/);
    assert.match(preview, /<img src=\{logo\}[\s\S]*?loading="lazy"/);
    assert.match(preview, /<strong>\{info\.org\}<\/strong>/);
    assert.match(preview, /<p className="mod-sponsor-blurb">\{info\.blurb\}<\/p>/);
    assert.match(
      preview,
      /href=\{info\.website\}[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"[\s\S]*?\{info\.website\}/,
      "the complete reviewed URL is both visible and safely openable",
    );
    assert.match(preview, /<Pledged user=\{user\} \/>/, "the detailed ledger identity row is reused");
    for (const empty of [
      "Sponsor details unavailable.",
      "No logo supplied.",
      "No blurb supplied.",
      "No website supplied.",
    ]) {
      assert.match(preview, new RegExp(empty.replace(".", "\\.")));
    }
    assert.match(
      moderate,
      /No ledgers pledged — nothing they send could be collected\./,
      "an empty pledge remains explicit",
    );
    assert.doesNotMatch(preview, /prettyHost|slice\(|line-clamp|ellipsis/);

    assert.ok(styleStart >= 0 && styleEnd > styleStart, "the review layout styles exist");
    assert.match(
      previewStyles,
      /\.mod-sponsor-application\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*\d+px minmax\(0,\s*1fr\);/,
      "logo and complete application copy share a readable desktop grid",
    );
    assert.match(
      previewStyles,
      /\.mod-sponsor-copy dd,\s*\.mod-sponsor-blurb\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/,
      "organisation, blurb, and website values all wrap at their permitted maxima",
    );
    assert.match(previewStyles, /\.mod-sponsor-blurb\s*\{[\s\S]*?white-space:\s*pre-wrap;/);
    assert.doesNotMatch(previewStyles, /line-clamp|text-overflow:\s*ellipsis/);
    assert.match(
      styles,
      /@media \(max-width: 560px\)[\s\S]*?\.mod-sponsor-application\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
      "the sponsor application becomes one readable column on phones",
    );
  });

  it("runs the bracket clock locally and makes refreshing an explicit action", () => {
    const season = source("Season.tsx");
    const clockStart = season.indexOf("function useDeadlineNow");
    const clockEnd = season.indexOf("function formatCountdown", clockStart);
    const clock = season.slice(clockStart, clockEnd);

    assert.ok(clockStart >= 0 && clockEnd > clockStart, "the local deadline clock exists");
    assert.match(clock, /networkNow\(\)/, "ticks recompute from synchronized absolute time");
    assert.match(clock, /window\.setTimeout\(tick,/);
    assert.doesNotMatch(clock, /api\./, "the ticking path never calls the canister");
    assert.doesNotMatch(clock, /setInterval/, "there is no polling interval hidden in the clock");

    const ic = frontendSource("ic.ts");
    assert.match(ic, /return Date\.now\(\) \+ networkClockOffsetMs/);
    assert.match(ic, /if \(!IS_LOCAL\)[\s\S]*?networkClockOffsetMs = 0/);
    assert.match(ic, /networkClockOffsetMs = \(await localAgent\([\s\S]*?getTimeDiffMsecs\(\)/);
    assert.doesNotMatch(ic, /POCKETIC_CONFIG_PORT|\/instances\//);
    assert.doesNotMatch(ic, /disableTimeVerification/);
    assert.match(season, /if \(refreshClock\) await syncNetworkClock\(\)/);
    assert.match(season, /void load\(true\)/);

    assert.match(season, /api\.deadlineFor\(season, Number\(season\.week\)\)/);
    assert.match(
      season,
      /deadlineMs - clockNow <= api\.VOTE_WITHDRAWAL_LOCK_MS/,
      "the controls switch at the same visible one-hour boundary",
    );
    assert.match(season, /await load\(true\);\s*setMapReloadKey/);
    assert.match(season, /reloadKey=\{mapReloadKey\}/);
    assert.match(season, /onClick=\{\(\) => void onRefresh\(\)\}/);
    assert.match(season, /aria-busy=\{refreshing\}/);
    assert.doesNotMatch(
      season,
      /refreshing \? "Refreshing…" : "Refresh"/,
      "refreshing keeps a fixed-width label",
    );

    const map = source("SeasonMap.tsx");
    const loadStart = map.indexOf("const load = useCallback");
    const loadEnd = map.indexOf("}, [season, seasonKey]);", loadStart);
    const loader = map.slice(loadStart, loadEnd);
    assert.doesNotMatch(loader, /setLoading\(true\)/, "refresh leaves the mounted map in place");
    assert.match(map, /error && loadedSeasonKey !== seasonKey/);
    assert.match(map, /The last loaded map is still shown/);
  });

  it("syncs agents to a time-travelling local replica without changing mainnet", () => {
    const ic = frontendSource("ic.ts");
    const tokens = frontendSource("tokens.ts");
    const vite = readFileSync(resolve(ROOT, "frontend", "vite.config.ts"), "utf8");
    const envWriter = readFileSync(resolve(ROOT, "scripts", "write-env.mjs"), "utf8");
    const ship = readFileSync(resolve(ROOT, "scripts", "ship-web.mjs"), "utf8");

    assert.match(
      ic,
      /localAgentPromise \?\?=[\s\S]*?shouldFetchRootKey: true,[\s\S]*?shouldSyncTime: true,[\s\S]*?agent\.replaceIdentity\(identity\);[\s\S]*?if \(IS_LOCAL\)[\s\S]*?localAgent\(identity\)[\s\S]*?else \{[\s\S]*?HttpAgent\.create\(\{[\s\S]*?identity,[\s\S]*?\}\);/,
      "the app actor uses the agent's supported PocketIC clock synchronization",
    );
    assert.match(ic, /networkClockOffsetMs = \(await localAgent\([\s\S]*?getTimeDiffMsecs\(\)/);
    assert.doesNotMatch(ic, /POCKETIC_CONFIG_PORT|\/instances\//);
    assert.doesNotMatch(envWriter, /VITE_POCKETIC_CONFIG_PORT|VITE_POCKETIC_INSTANCE_ID/);
    assert.doesNotMatch(ship, /\/read\/get_time/);
    assert.match(ship, /Could not synchronize the local PocketIC agent clock\./);
    assert.match(
      tokens,
      /const localReplica = host === HERE && IS_LOCAL;[\s\S]*?localReplica[\s\S]*?shouldFetchRootKey: true,[\s\S]*?shouldSyncTime: true,/,
      "local ledger queries sync while mainnet metadata queries retain wall time",
    );
    assert.match(
      vite,
      /server:\s*\{[\s\S]*?host: "0\.0\.0\.0",[\s\S]*?port: 5174,/,
      "the showcase hostname is reachable over IPv4 instead of only IPv6 loopback",
    );
    assert.match(
      vite,
      /"\/u\/":\s*\{[\s\S]*?raw\.localhost:8943[\s\S]*?changeOrigin: true/,
      "Vite serves user art from the local canister instead of its SPA fallback",
    );
  });

  it("shows every reached week's apps below sponsors", () => {
    const season = source("Season.tsx");
    const sponsors = season.lastIndexOf("<Sponsors />");
    const archiveUse = season.indexOf("<SeasonApps", sponsors);
    const archiveStart = season.indexOf("function SeasonApps");
    const archiveEnd = season.indexOf("function Sponsors", archiveStart);
    const archive = season.slice(archiveStart, archiveEnd);

    assert.ok(sponsors >= 0 && archiveUse > sponsors, "the complete app list follows sponsors");
    assert.match(archive, /api\.weekEntriesPage\(season\.id, week, after, ENTRY_PAGE_SIZE\)/);
    assert.match(archive, /while \(after !== null\)/, "every page is followed to completion");
    assert.doesNotMatch(archive, /outcomeOf|medalFor|\.outcome/, "losers are not filtered out");
    assert.match(archive, /<Popout \{\.\.\.hover\} \/>/);
    assert.match(archive, /<EntryModal/);
    assert.match(archive, /className="season-app-icon"/);
  });

  it("gives builders one public, agent-guided path from the homepage to submission", () => {
    const app = frontendSource("App.tsx");
    const landing = source("Landing.tsx");
    const build = source("Build.tsx");
    const styles = frontendSource("styles.css");

    assert.match(app, /\| \{ name: "build" \}/);
    assert.match(app, /case "build":\s*return \{ name: "build" \};/);
    assert.match(app, /case "build":\s*return <Build \/>;/);
    assert.match(
      app,
      /<NavLink href="#\/build"[\s\S]*?match="build"[\s\S]*?>\s*Build\s*<\/NavLink>\s*<\/nav>/,
      "Build is the last navbar destination",
    );

    assert.match(landing, /className="page build-cta"/);
    assert.match(landing, /href="#\/build"[\s\S]*?Open the build guide/);
    assert.doesNotMatch(
      landing,
      /What you(?:'|&apos;)re building for|github\.com\/infu\/neutron\/tree\/main\/apps\/hello/,
      "the full builder material lives on its own route",
    );

    assert.match(build, /<h1>How to build a Neutron app<\/h1>/);
    assert.match(build, /<p>In under 2 hours<\/p>/);
    assert.match(
      build,
      /id="build-weeks"[\s\S]*?className="build-reward-note"[\s\S]*?Win up to 4 rewards[\s\S]*?each distinct app that places[\s\S]*?same app is paid once, for its best finish[\s\S]*?className="build-options"/,
      "the headline states the four-reward opportunity without promising duplicate app payouts",
    );
    for (const destination of [
      "https://ntron.net",
      "https://github.com/infu/neutron",
      "https://github.com/infu/neutron/tree/main/apps/hello",
      "https://github.com/infu/neutron/tree/main/apps/kitchensink",
    ]) {
      assert.ok(build.includes(destination), `${destination} is available from the guide`);
    }
    assert.equal(
      (build.match(/^\s+title: "/gm) ?? []).length,
      6,
      "the guide keeps the six requested workflow steps",
    );
    assert.match(build, /change only that app&apos;s folder/);
    assert.match(build, /human interface and agent-tool behaviour/);
    assert.match(build, /Agent calls still pass through Neutron&apos;s permission model/);
    assert.match(build, /Submit the same app again in a later qualifier week/);
    assert.match(build, /Submit a different app in each of the four qualifier weeks/);
    assert.match(build, /href="#\/profile\/entries"/);
    assert.doesNotMatch(
      build,
      /npm (?:run|install)|git clone/,
      "changing repository commands are left to the builder's agent and current docs",
    );

    assert.match(styles, /\.build-cta-button\s*\{[\s\S]*?padding: 14px 22px;/);
    assert.match(styles, /\.build-surfaces\s*\{[\s\S]*?grid-template-columns: repeat\(2,/);
    assert.match(
      styles,
      /\.build-reward-note strong\s*\{[\s\S]*?font-family: var\(--ui\);[\s\S]*?font-size: 15px;/,
      "the reward headline uses the readable UI face rather than the pixel display face",
    );
    assert.match(
      styles,
      /@media \(max-width: 620px\)[\s\S]*?\.build-surfaces,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
      "the builder cards collapse to one readable column on phones",
    );
    assert.match(
      styles,
      /@media \(max-width: 1100px\)[\s\S]*?\.topbar\s*\{[\s\S]*?display: grid;[\s\S]*?\.nav\s*\{[\s\S]*?grid-column: 1 \/ -1;/,
      "the longer signed-in navbar gets its own row before it can overflow",
    );
  });
});
