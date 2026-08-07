# Neutron Hackathon

Neutron Hackathon is an ICP competition for AI-assisted Neutron apps. One
Motoko canister stores the event state and serves the React application over
certified HTTP. Participants sign in with Internet Identity.

## How the competition works

- One canister hosts one season: four seven-day qualifiers, a one-day
  semifinal, and a one-day final.
- Roles stack. A participant may be a hacker, judge, sponsor, moderator, or
  any valid combination of those roles.
- Approved judges receive two votes in each open round. They cannot vote twice
  for one entry or vote for their own entry.
- App submissions and updates enter a review queue. One moderator can approve
  or reject an app, but moderators cannot review their own submissions.
- Sponsors fund approved ICRC-1 ledgers. After the final, the canister
  reconciles those funds and pays rewards directly to the wallets frozen into
  the payout plan.
- Qualifier winners advance automatically. Timers also drive funding and
  payout work; a moderator can re-arm overdue automation from durable state but
  cannot choose a different result, destination, or amount.

The in-app **Rules** page is the participant-facing source of truth. It combines
the practical guide, accepted agreement, live schedule, current limits, and
approved ledger set. Do not copy live dates, pool totals, or ledger state into
this README.

## Verify the production build with Docker

The Docker build uses the locked Node/npm packages, pinned ICP CLI `1.0.2`,
Mops `1.12.0`, Motoko `0.16.3`, and didc `0.5.3`. It runs the real
`icp build hackathon --environment ic` backend path and the complete TypeScript,
rules, and Vite frontend build.

```sh
docker build --platform linux/amd64 -t neutron-hackathon-build .
docker run --rm neutron-hackathon-build
```

The second command prints a deterministic manifest containing both the raw
Wasm SHA-256 and the submitted gzip SHA-256, plus hashes of the built frontend
files and their certified upload representation. Two Docker builders on the
same reviewed commit and public build configuration should print the same
manifest. The default frontend target is
`4576f-3aaaa-aaaam-ajgpq-cai`; use
`--build-arg VITE_CANISTER_ID_HACKATHON=<canister-id>` when verifying another
deployment. This build does not use an identity, deploy code, or upload assets.

## Requirements

The pinned and checked toolchain is:

- Node.js `24.11.1`
- npm `11.6.2`
- Mops `1.12.0`
- Motoko `0.16.3`
- didc `0.5.3`
- ICP CLI `1.0.2`

Local deployment additionally requires `gzip`. The Motoko unit suite also
requires the Ash test runner. Repository checks reject incompatible versions
of the pinned tools; the Docker path pins the complete build environment.

## Run locally

Install dependencies and verify the toolchain:

```sh
npm ci
npm run deps
npm run toolchain
```

Start the local network and deploy both the canister and frontend:

```sh
npm run network
npm run deploy
```

The deployed application is available at:

```text
http://hackathon.local.localhost:8943/
```

For frontend work with hot reload:

```sh
npm run dev
```

Open:

```text
http://hackathon.local.localhost:5174/
```

The Vite server proxies canister traffic to the local gateway on port `8943`.
The deploy flow writes the ignored `.env` file automatically.

Useful development commands:

```sh
npm run bindings       # regenerate committed Candid bindings after API changes
npm run web            # rebuild and publish only the local frontend
npm run network:stop   # stop the managed local network
```

## Checks

```sh
npm run typecheck      # compile-check the Motoko backend
npm run build:web      # TypeScript, rules, and production frontend build
npm run bindings:check # verify bindings match the current Motoko interface
npm test               # Motoko unit tests
npm run test:logic     # PocketIC lifecycle and integration tests
npm run test:public    # script and source-level frontend contracts
npm run test:memory    # slower allocator and memory scenarios
npm run test:capacity  # bounded capacity sample and projection
npm run release:check  # public release checks
```

`npm run test:all` runs the unit, PocketIC logic, and memory suites. It does not
include `test:public` or `test:capacity`.

## Production release

A production season must be bound to a clean, reviewed commit. Run both manual
release gates because they cover different checks:

```sh
reviewed_commit="$(git rev-parse HEAD)"
npm run release:check
npm run release:full -- --reviewed-commit "$reviewed_commit"
```

On the first deployment, create the project canister with both the selected ICP
identity and the hardened frontend uploader as controllers. The create command
uses the ICP CLI's default initial cycles balance unless `--cycles` is supplied.

```sh
deployer="$(icp identity principal)"
uploader="$(node scripts/upload.mjs --whoami -e ic)"
icp canister create hackathon -e ic \
  --controller "$deployer" \
  --controller "$uploader"
npm run deploy:ic
```

Before accepting sponsor applications, apply the reviewed ledger catalog. Once
the launch roles and frontend are final, add the canister itself as a controller
and prepare the seal attestation:

```sh
npm run ledgers:allow -- -e ic --confirm ic
canister_id="$(icp canister status hackathon -e ic -i)"
icp canister settings update "$canister_id" \
  --environment ic \
  --add-controller "$canister_id" \
  --force
npm run release:attest -- prepare \
  --reviewed-commit "$reviewed_commit" \
  --canister-id "$canister_id"
# Run the exact seal command printed by the prepare step.
npm run release:attest -- verify
```

All code, frontend assets, ledgers, and launch roles must be final before
sealing. Sealing removes external controllers and leaves the canister itself as
its sole controller. Three distinct current moderator account owners can later
invoke the fixed recovery path, which adds only the Neutrinite DAO controller
defined in the backend.

## Repository layout

```text
backend/                    Motoko actor, domain logic, and certified assets
frontend/                   React, TypeScript, and Vite application
scripts/                    build, release, moderation, and local demo tools
test/                       unit, PocketIC, script, memory, and capacity tests
vendor/                     pinned third-party Motoko dependencies
icp.yaml                    canisters, networks, and production resource settings
production-ledgers.json     reviewed mainnet ledger catalog
```

## License

This repository is proprietary and all rights are reserved. The vendored
certification components retain their stated third-party licence. See
[LICENSE](./LICENSE).
