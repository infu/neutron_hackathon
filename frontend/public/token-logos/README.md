# Reviewed token logos

These are 96×96 raster fallbacks for five ledgers in
`production-ledgers.json`. They remain same-origin and work before a live
metadata query completes. TOKO and cICP also publish acceptable raster logos in
their live metadata, so they do not need fallbacks.

- `ntn.png`, `ckbtc.png`, `ckusdc.png` and `ckusdt.png` were rasterized from
  each ledger's live `icrc1:logo` metadata on 5 August 2026. The ck ledgers
  publish SVG, which the frontend deliberately does not pass through from an
  arbitrary canister.
- `icp.png` was rasterized from `icp-rounded.svg` in DFINITY's `nns-dapp` at
  commit `407e416eefa84b3319bf6ccaa3a6c374d7b7d23a` because the ICP ledger does
  not publish `icrc1:logo`.
