# syntax=docker/dockerfile:1.7

# This digest is the linux/amd64 manifest for node:24.11.1-bookworm.
FROM --platform=linux/amd64 node:24.11.1-bookworm@sha256:fe306151aeafaf7c94e03dd3aff2435c91621f71a58bba3a09579c89d3ba730e AS builder

ENV CI=true
WORKDIR /workspace

# ICP CLI is locked through npm. didc and moc are installed from pinned,
# checksum-verified upstream releases used by the repository toolchain check.
RUN set -eux; \
    test "$(uname -m)" = x86_64; \
    apt-get update; \
    apt-get install -y --no-install-recommends libdbus-1-3; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    curl --proto '=https' --tlsv1.2 -fsSL \
      https://github.com/dfinity/motoko/releases/download/0.16.3/motoko-Linux-x86_64-0.16.3.tar.gz \
      -o /tmp/motoko.tar.gz; \
    echo '2173d702c3bd63eca0f0ae8bf5e32066c8c37ddaccc915659dc374e7e4a81a05  /tmp/motoko.tar.gz' | sha256sum -c -; \
    install -d /root/.cache/mops/moc/0.16.3; \
    tar -xzf /tmp/motoko.tar.gz -C /root/.cache/mops/moc/0.16.3 ./moc; \
    echo '1351eaf12dfa2262f691aa1f217c5a34c60dae5308f0d3821d2e529c4e0c01ce  /root/.cache/mops/moc/0.16.3/moc' | sha256sum -c -; \
    curl --proto '=https' --tlsv1.2 -fsSL \
      https://github.com/dfinity/candid/releases/download/2025-10-16/didc-linux64 \
      -o /usr/local/bin/didc; \
    echo '40a7dc485b48d75b584c3a13dc4786bcf4d8504ee7d00e634858a9f7b245bd78  /usr/local/bin/didc' | sha256sum -c -; \
    chmod 0755 /root/.cache/mops/moc/0.16.3/moc /usr/local/bin/didc; \
    rm /tmp/motoko.tar.gz

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --ignore-scripts --no-audit --no-fund \
 && npm --prefix frontend ci --no-audit --no-fund

COPY mops.toml mops.lock ./
RUN ./node_modules/.bin/mops install --no-toolchain --lock check

COPY . .

RUN npm run deps \
 && npm run toolchain \
 && test "$(./node_modules/.bin/icp --version)" = 'icp 1.0.2'

# This is the exact backend build path used by `icp deploy`; it produces the
# deterministic gzip that install_code receives.
RUN ./node_modules/.bin/icp build hackathon --environment ic \
 && gzip -t .icp/cache/artifacts/hackathon

ARG VITE_CANISTER_ID_HACKATHON=4576f-3aaaa-aaaam-ajgpq-cai
ENV VITE_ICP_ENVIRONMENT=ic \
    VITE_ICP_NETWORK=ic \
    VITE_IDENTITY_PROVIDER=https://id.ai \
    VITE_CANISTER_ID_HACKATHON=${VITE_CANISTER_ID_HACKATHON}

# The ambient checkout .env is excluded. These are the complete public inputs
# for the production Vite build.
RUN test -n "$VITE_CANISTER_ID_HACKATHON"; \
    printf '%s\n' \
      "VITE_ICP_ENVIRONMENT=$VITE_ICP_ENVIRONMENT" \
      "VITE_ICP_NETWORK=$VITE_ICP_NETWORK" \
      "VITE_CANISTER_ID_HACKATHON=$VITE_CANISTER_ID_HACKATHON" \
      "VITE_IDENTITY_PROVIDER=$VITE_IDENTITY_PROVIDER" > .env; \
    npm run build:web

RUN set -eux; \
    mkdir -p /artifacts/backend; \
    cp .icp/cache/artifacts/hackathon /artifacts/backend/hackathon.wasm.gz; \
    gzip -dc .icp/cache/artifacts/hackathon > /artifacts/backend/hackathon.wasm; \
    cp frontend/src/declarations/hackathon.did /artifacts/backend/hackathon.did; \
    cp -a frontend/dist /artifacts/frontend; \
    node scripts/build-manifest.mjs /artifacts/build-manifest.json

# The default image contains only the verified release artifacts and prints
# their stable hashes when run.
FROM --platform=linux/amd64 node:24.11.1-bookworm@sha256:fe306151aeafaf7c94e03dd3aff2435c91621f71a58bba3a09579c89d3ba730e AS verification
COPY --from=builder /artifacts /artifacts
CMD ["cat", "/artifacts/build-manifest.json"]
