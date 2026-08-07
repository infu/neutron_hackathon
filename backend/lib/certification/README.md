# Vendored: ic-certification

These three files are copied verbatim from
[`ic-certification`](https://github.com/nomeata/ic-certification) **v1.1.0**
(mops package `ic-certification`), with one mechanical change:

```
"mo:base@0/…"      ->  "mo:base/…"
"mo:sha2@0/Sha256" ->  "mo:sha2/Sha256"
```

## Why vendored instead of a mops dependency

`ash` validates `.ash.json` package aliases against `^[A-Za-z][A-Za-z0-9_-]*$`
(`../ash/src/../ash.schema.json`), which rejects the `@` in mops' versioned
aliases. Depending on `ic-certification` directly makes `base@0`, `sha2@0` and
`cbor@4` appear in `mops sources`, and then no valid `.ash.json` can be written
— the test suite becomes unbuildable.

Only `CertTree`, `MerkleTree` and `Dyadic` are vendored. `ReqData.mo` and
`CanisterSigs.mo` are left behind: they implement canister signatures and
request signing, which we do not use, and they are the sole reason the upstream
package depends on `cbor`.

## Refreshing

```sh
mops add ic-certification            # temporarily, to populate .mops/
SRC=.mops/ic-certification@<ver>/src
for f in CertTree MerkleTree Dyadic; do
  sed -e 's|"mo:base@0/|"mo:base/|g' \
      -e 's|"mo:sha2@0/|"mo:sha2/|g' \
      $SRC/$f.mo > backend/lib/certification/$f.mo
done
mops remove ic-certification
```

## License

Upstream is Apache License 2.0 — see `LICENSE` in this directory. That license
covers these three files only; the rest of this repository is proprietary (see
the root `LICENSE`).
