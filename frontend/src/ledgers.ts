/**
 * Known ICRC-1 ledgers. **Generated — do not edit by hand.**
 *
 *   npm --prefix frontend run ledgers
 *
 * SNS ledgers come from the SNS aggregator canister and are flagged
 * `sns: true`; ICP and the chain-key tokens are verified against mainnet
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
  { id: "ryjl3-tyaaa-aaaaa-aaaba-cai", symbol: "ICP", name: "Internet Computer", decimals: 8, sns: false },
  { id: "mxzaz-hqaaa-aaaar-qaada-cai", symbol: "ckBTC", name: "ckBTC", decimals: 8, sns: false },
  { id: "ss2fx-dyaaa-aaaar-qacoq-cai", symbol: "ckETH", name: "ckETH", decimals: 18, sns: false },
  { id: "xevnm-gaaaa-aaaar-qafnq-cai", symbol: "ckUSDC", name: "ckUSDC", decimals: 6, sns: false },
  { id: "cngnf-vqaaa-aaaar-qag4q-cai", symbol: "ckUSDT", name: "ckUSDT", decimals: 6, sns: false },
  { id: "g4tto-rqaaa-aaaar-qageq-cai", symbol: "ckLINK", name: "ckLINK", decimals: 18, sns: false },
  { id: "pe5t5-diaaa-aaaar-qahwa-cai", symbol: "ckEURC", name: "ckEURC", decimals: 6, sns: false },
  { id: "bptq2-faaaa-aaaar-qagxq-cai", symbol: "ckWBTC", name: "ckWBTC", decimals: 8, sns: false },
  { id: "j2tuh-yqaaa-aaaar-qahcq-cai", symbol: "ckWSTETH", name: "ckWSTETH", decimals: 18, sns: false },
  { id: "ilzky-ayaaa-aaaar-qahha-cai", symbol: "ckUNI", name: "ckUNI", decimals: 18, sns: false },
  { id: "etik7-oiaaa-aaaar-qagia-cai", symbol: "ckPEPE", name: "ckPEPE", decimals: 18, sns: false },
  { id: "fxffn-xiaaa-aaaar-qagoa-cai", symbol: "ckSHIB", name: "ckSHIB", decimals: 18, sns: false },
  { id: "ebo5g-cyaaa-aaaar-qagla-cai", symbol: "ckOCT", name: "ckOCT", decimals: 18, sns: false },
  { id: "nza5v-qaaaa-aaaar-qahzq-cai", symbol: "ckXAUT", name: "ckXAUT", decimals: 6, sns: false },
  { id: "itgqj-7qaaa-aaaaq-aadoa-cai", symbol: "---", name: "----", decimals: 8, sns: true },
  { id: "rffwt-piaaa-aaaaq-aabqq-cai", symbol: "--SEER--", name: "--ex Seers--", decimals: 8, sns: true },
  { id: "oj6if-riaaa-aaaaq-aaeha-cai", symbol: "ALICE", name: "ALICE", decimals: 8, sns: true },
  { id: "vtrom-gqaaa-aaaaq-aabia-cai", symbol: "BOOM", name: "BOOM", decimals: 8, sns: true },
  { id: "p7vqo-eyaaa-aaaaq-aaeca-cai", symbol: "CANI", name: "CANI DAO", decimals: 8, sns: true },
  { id: "5bqmf-wyaaa-aaaaq-aaa5q-cai", symbol: "CAT", name: "CatalyzeDAO", decimals: 8, sns: true },
  { id: "jg2ra-syaaa-aaaaq-aaewa-cai", symbol: "CECIL", name: "Cecil The Lion DAO", decimals: 8, sns: true },
  { id: "2ouva-viaaa-aaaaq-aaamq-cai", symbol: "CHAT", name: "CHAT", decimals: 8, sns: true },
  { id: "4c4fd-caaaa-aaaaq-aaa3a-cai", symbol: "CLAY", name: "Mimic Clay", decimals: 8, sns: true },
  { id: "uf2wh-taaaa-aaaaq-aabna-cai", symbol: "CTZ", name: "CatalyzeDAO", decimals: 8, sns: true },
  { id: "ixqp7-kqaaa-aaaaq-aaetq-cai", symbol: "DAO", name: "Personal DAO", decimals: 8, sns: true },
  { id: "xsi2v-cyaaa-aaaaq-aabfq-cai", symbol: "DCD", name: "DecideAI", decimals: 8, sns: true },
  { id: "zfcdd-tqaaa-aaaaq-aaaga-cai", symbol: "DKP", name: "Draggin Karma Points", decimals: 8, sns: true },
  { id: "6rdgd-kyaaa-aaaaq-aaavq-cai", symbol: "DOLR", name: "DOLR AI", decimals: 8, sns: true },
  { id: "gemj7-oyaaa-aaaaq-aacnq-cai", symbol: "ELNA", name: "ELNA", decimals: 8, sns: true },
  { id: "wedc6-xiaaa-aaaaq-aabaq-cai", symbol: "EMC", name: "EdgeMatrixComputing", decimals: 8, sns: true },
  { id: "bliq2-niaaa-aaaaq-aac4q-cai", symbol: "EST", name: "ESTATE", decimals: 8, sns: true },
  { id: "nfjys-2iaaa-aaaaq-aaena-cai", symbol: "FUEL", name: "FUEL", decimals: 8, sns: true },
  { id: "4q2s2-oqaaa-aaaaq-aaaya-cai", symbol: "GHOST", name: "GHOST", decimals: 8, sns: true },
  { id: "tyyy3-4aaaa-aaaaq-aab7a-cai", symbol: "GOLDAO", name: "GOLDAO", decimals: 8, sns: true },
  { id: "ifwyg-gaaaa-aaaaq-aaeqq-cai", symbol: "ICE", name: "ICExplorer", decimals: 8, sns: true },
  { id: "ddsp7-7iaaa-aaaaq-aacqq-cai", symbol: "ICFC", name: "ICFC", decimals: 8, sns: true },
  { id: "hhaaz-2aaaa-aaaaq-aacla-cai", symbol: "ICL", name: "ICLighthouse DAO", decimals: 8, sns: true },
  { id: "ca6gz-lqaaa-aaaaq-aacwa-cai", symbol: "ICS", name: "ICPSwap Token", decimals: 8, sns: true },
  { id: "p3dpy-ryaaa-aaaaq-aad7q-cai", symbol: "ICTO", name: "ICTO", decimals: 8, sns: true },
  { id: "m6xut-mqaaa-aaaaq-aadua-cai", symbol: "ICVC", name: "ICVC", decimals: 8, sns: true },
  { id: "lvfsa-2aaaa-aaaaq-aaeyq-cai", symbol: "ICX", name: "ICPEx", decimals: 8, sns: true },
  { id: "mmrdk-aaaaa-aaaaq-aadxa-cai", symbol: "JUNOBUILD", name: "Juno Build", decimals: 8, sns: true },
  { id: "73mez-iiaaa-aaaaq-aaasq-cai", symbol: "KINIC", name: "KINIC", decimals: 8, sns: true },
  { id: "o7oak-iyaaa-aaaaq-aadzq-cai", symbol: "KONG", name: "KongSwap", decimals: 8, sns: true },
  { id: "wrett-waaaa-aaaaq-aabda-cai", symbol: "MOD", name: "Modclub", decimals: 8, sns: true },
  { id: "bzohd-byaaa-aaaaq-aac7q-cai", symbol: "MORA", name: "MORA DAO", decimals: 8, sns: true },
  { id: "k45jy-aiaaa-aaaaq-aadcq-cai", symbol: "MOTOKO", name: "Motoko", decimals: 8, sns: true },
  { id: "mih44-vaaaa-aaaaq-aaekq-cai", symbol: "NFIDW", name: "NFID Wallet", decimals: 8, sns: true },
  { id: "f54if-eqaaa-aaaaq-aacea-cai", symbol: "NTN", name: "Neutrinite", decimals: 8, sns: true },
  { id: "rxdbk-dyaaa-aaaaq-aabtq-cai", symbol: "NUA", name: "Nuance", decimals: 8, sns: true },
  { id: "lkwrt-vyaaa-aaaaq-aadhq-cai", symbol: "OGY", name: "ORIGYN", decimals: 8, sns: true },
  { id: "b5yyv-uyaaa-aaaaq-aafca-cai", symbol: "ONICAI", name: "ONICAI", decimals: 8, sns: true },
  { id: "druyg-tyaaa-aaaaq-aactq-cai", symbol: "PANDA", name: "ICPanda", decimals: 8, sns: true },
  { id: "np5km-uyaaa-aaaaq-aadrq-cai", symbol: "PHASMA", name: "PHASMA", decimals: 8, sns: true },
  { id: "sotaq-jqaaa-aaaaq-aab2a-cai", symbol: "QRO", name: "Querio", decimals: 8, sns: true },
  { id: "viusj-4iaaa-aaaaq-aabkq-cai", symbol: "SEER", name: "SEER", decimals: 8, sns: true },
  { id: "hvgxa-wqaaa-aaaaq-aacia-cai", symbol: "SNEED", name: "Sneed DAO", decimals: 8, sns: true },
  { id: "7ajy4-sqaaa-aaaaq-aaaqa-cai", symbol: "SOC", name: "SONIC", decimals: 8, sns: true },
  { id: "qbizb-wiaaa-aaaaq-aabwq-cai", symbol: "SONIC", name: "Sonic", decimals: 8, sns: true },
  { id: "lrtnw-paaaa-aaaaq-aadfa-cai", symbol: "SWAMP", name: "Swampies", decimals: 8, sns: true },
  { id: "kknbx-zyaaa-aaaaq-aae4a-cai", symbol: "TACO", name: "TACO", decimals: 8, sns: true },
  { id: "kylwo-viaaa-aaaaq-aae7a-cai", symbol: "TENDY", name: "Tendies", decimals: 8, sns: true },
  { id: "tn7jw-5iaaa-aaaaq-aab4q-cai", symbol: "TRAX", name: "TRAX", decimals: 8, sns: true },
  { id: "emww2-4yaaa-aaaaq-aacbq-cai", symbol: "TRAX", name: "TRAX", decimals: 8, sns: true },
  { id: "o4zzi-qaaaa-aaaaq-aaeeq-cai", symbol: "WELL", name: "FomoWell", decimals: 8, sns: true },
  { id: "jcmow-hyaaa-aaaaq-aadlq-cai", symbol: "WTN", name: "WaterNeuron", decimals: 8, sns: true },
  { id: "atbfz-diaaa-aaaaq-aacyq-cai", symbol: "YUKU", name: "Yuku AI", decimals: 8, sns: true },
];

export const LEDGER_BY_ID = new Map(LEDGERS.map((l) => [l.id, l]));
