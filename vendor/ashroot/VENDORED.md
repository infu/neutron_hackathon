# Vendored database runtime

This directory contains only the static Motoko runtime used by the canister.
Development tools, examples, caches, and unrelated dependencies are not part of
the production snapshot.

- Upstream: `git@github.com:Neutrinomic/ashroot.git`
- Commit: `321e31a95fbf0ad509ec522e8243eb4d564461f6`
- Source package: `ashroot/`
- Vendored files: `ashroot/src/*.mo` plus a minimal package manifest

To refresh this snapshot, replace `src/*.mo` from the named upstream commit,
keep only Ashroot's runtime dependency (`core`) in the local manifest, update
the commit above, then run `npm run deps`, `npm run typecheck`, and the full
test suite. Application tables remain in `backend/.ashroot/`; they are project
source and are not part of this runtime snapshot.
