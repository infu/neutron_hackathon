/**
 * Build the ledger catalogue.
 *
 *   npm --prefix frontend run ledgers
 *
 * Two sources, both authoritative:
 *
 *  * **SNS ledgers** come from the SNS aggregator canister, which lists every
 *    launched SNS along with its canister ids. They are marked `sns: true`.
 *  * **ICP and the ck tokens** are a candidate list checked against mainnet —
 *    each id is queried for `icrc1_metadata` and dropped if it does not answer.
 *    A hardcoded list can rot; one that has to respond cannot.
 *
 * Logos are deliberately *not* baked in. The aggregator carries them as
 * base64 data URIs running to tens of kilobytes each, and there are dozens of
 * SNSes — that is a bundle nobody should download to render a dropdown. The
 * app usually fetches the logo from the ledger itself when one is selected,
 * which is also the check that the ledger really works. A separate five-token
 * reviewed raster fallback lives in `tokens.ts`; it is not part of this broad
 * generated catalogue.
 */

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../src/ledgers.ts");

const AGGREGATOR = "https://3r4gx-wqaaa-aaaaq-aaaia-cai.icp0.io/v1/sns/list/page";

/**
 * ICP and the chain-key tokens. Verified against mainnet before being written,
 * so a typo or a retired ledger drops out rather than shipping broken.
 */
const CANDIDATES = [
  "ryjl3-tyaaa-aaaaa-aaaba-cai", // ICP
  "mxzaz-hqaaa-aaaar-qaada-cai", // ckBTC
  "ss2fx-dyaaa-aaaar-qacoq-cai", // ckETH
  "xevnm-gaaaa-aaaar-qafnq-cai", // ckUSDC
  "cngnf-vqaaa-aaaar-qag4q-cai", // ckUSDT
  "g4tto-rqaaa-aaaar-qageq-cai", // ckLINK
  "pe5t5-diaaa-aaaar-qahwa-cai", // ckEURC
  "bptq2-faaaa-aaaar-qagxq-cai", // ckWBTC
  "j2tuh-yqaaa-aaaar-qahcq-cai", // ckWSTETH
  "ilzky-ayaaa-aaaar-qahha-cai", // ckUNI
  "etik7-oiaaa-aaaar-qagia-cai", // ckPEPE
  "fxffn-xiaaa-aaaar-qagoa-cai", // ckSHIB
  "ebo5g-cyaaa-aaaar-qagla-cai", // ckOCT
  "nza5v-qaaaa-aaaar-qahzq-cai", // ckXAUT
];

const ledgerInterface = ({ IDL }) => {
  const Value = IDL.Rec();
  Value.fill(
    IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) }),
  );
  return IDL.Service({
    icrc1_metadata: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, Value))], ["query"]),
  });
};

function readMetadata(entries) {
  const pick = (key) => {
    const found = entries.find(([name]) => name === key);
    return found ? Object.values(found[1])[0] : null;
  };
  return {
    symbol: pick("icrc1:symbol"),
    name: pick("icrc1:name"),
    decimals: Number(pick("icrc1:decimals") ?? 8),
  };
}

async function fetchSnsLedgers() {
  const out = [];
  for (let page = 0; page < 20; page += 1) {
    const response = await fetch(`${AGGREGATOR}/${page}/slow.json`);
    if (!response.ok) break;
    const entries = await response.json();
    if (!Array.isArray(entries) || entries.length === 0) break;

    for (const entry of entries) {
      const id = entry.canister_ids?.ledger_canister_id;
      if (!id) continue;
      const meta = readMetadata(entry.icrc1_metadata ?? []);
      out.push({
        id,
        symbol: meta.symbol ?? entry.meta?.name ?? id,
        name: meta.name ?? entry.meta?.name ?? id,
        decimals: meta.decimals,
        sns: true,
      });
    }
    process.stderr.write(`  sns page ${page}: ${entries.length}\n`);
    // The aggregator pages are a fixed size; a short page is the last one.
    if (entries.length < 10) break;
  }
  return out;
}

async function verifyCandidates() {
  const agent = await HttpAgent.create({ host: "https://icp-api.io" });
  const out = [];
  for (const id of CANDIDATES) {
    try {
      const actor = Actor.createActor(ledgerInterface, {
        agent,
        canisterId: Principal.fromText(id),
      });
      const meta = readMetadata(await actor.icrc1_metadata());
      if (!meta.symbol) throw new Error("no symbol");
      out.push({ id, symbol: meta.symbol, name: meta.name ?? meta.symbol, decimals: meta.decimals, sns: false });
      process.stderr.write(`  ok   ${meta.symbol.padEnd(10)} ${id}\n`);
    } catch (error) {
      process.stderr.write(`  drop ${id}: ${error.message}\n`);
    }
  }
  return out;
}

const [chainKey, sns] = await Promise.all([verifyCandidates(), fetchSnsLedgers()]);

// Chain-key tokens first — they are what a sponsor most likely wants — then
// the SNS ledgers alphabetically.
sns.sort((a, b) => a.symbol.localeCompare(b.symbol));
const all = [...chainKey, ...sns];

const seen = new Set();
const unique = all.filter((l) => (seen.has(l.id) ? false : seen.add(l.id)));

const body = unique
  .map(
    (l) =>
      `  { id: ${JSON.stringify(l.id)}, symbol: ${JSON.stringify(l.symbol)}, ` +
      `name: ${JSON.stringify(l.name)}, decimals: ${l.decimals}, sns: ${l.sns} },`,
  )
  .join("\n");

await writeFile(
  OUT,
  `/**
 * Known ICRC-1 ledgers. **Generated — do not edit by hand.**
 *
 *   npm --prefix frontend run ledgers
 *
 * SNS ledgers come from the SNS aggregator canister and are flagged
 * \`sns: true\`; ICP and the chain-key tokens are verified against mainnet
 * before being written here, so an id that no longer answers drops out rather
 * than shipping broken.
 *
 * No catalogue logos: the aggregator carries them as base64 data URIs tens of
 * kilobytes each, which is not something to download in order to draw a
 * dropdown. The app usually reads a logo from the ledger itself when one is
 * picked. `tokens.ts` separately owns the five reviewed launch-token fallbacks.
 */

export type KnownLedger = {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Launched through the SNS, rather than a chain-key or native token. */
  sns: boolean;
};

export const LEDGERS: KnownLedger[] = [
${body}
];

export const LEDGER_BY_ID = new Map(LEDGERS.map((l) => [l.id, l]));
`,
  "utf8",
);

process.stderr.write(
  `\\nwrote ${unique.length} ledgers (${chainKey.length} chain-key, ${sns.length} SNS)\\n`,
);
