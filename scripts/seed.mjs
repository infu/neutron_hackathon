#!/usr/bin/env node
/**
 * Seed a local network with demo people so the directory pages are not empty
 * while building UI.
 *
 * Each person is registered under a different icblast identity (`--id N`),
 * which is what the unique `byPrincipal` index requires — one profile per
 * principal. Approving judges needs a controller, so those calls use identity
 * 0, the same one `upload.mjs` registers as a controller.
 *
 * Handles are deliberately spread across the alphabet so the A-Z index has
 * something to show, and bio lengths vary so the six-line clamp is visible.
 *
 * Usage:
 *   node scripts/seed.mjs [--environment local] [--scale N]
 *   node scripts/seed.mjs --season          # create a draft, but do not seal
 *   node scripts/seed.mjs --start-season    # local-only, after a manual seal
 *   node scripts/seed.mjs --advance --apps 12 --mixed
 *                                           # mixed UI-review fixture
 *   node scripts/seed.mjs --advance --apps 7 --fixture-votes
 *                                           # explicit live-round ballots
 *
 * This fixture is permanently local-only. It installs deterministic demo
 * identities and grants some of them privileged roles, so no confirmation
 * flag or environment variable can make it target a deployed event.
 *
 * `--scale N` adds N generated participants on top of the hand-written ones,
 * every seventh applying to judge. Use it to exercise pagination and search at
 * the size the real event expects (~1000 participants, ~200 judges):
 *
 *   node scripts/seed.mjs --scale 1000
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
// icblast supplies the deterministic per-`id` identities; the calls go through
// @dfinity/agent with the generated bindings, because icblast's dynamic actor
// fetches controller-gated `candid:service` metadata and these seed identities
// are deliberately not controllers.
import { hashIdentity } from "icblast";

import { idlFactory } from "../frontend/src/declarations/hackathon.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const LONG =
  " Beyond that I want to understand how the install path treats module hashes, " +
  "what a kernel replacement does to in-flight state, and whether the capability " +
  "declarations actually constrain anything at runtime or are advisory. This bio " +
  "is deliberately long so the six-line clamp on the cards is visible.";

const PARTICIPANTS = [
  {
    id: 1,
    handle: "ada",
    displayName: "Ada Lovelace",
    bio: "Building a notes app for Neutron. Interested in stable memory layouts and how the kernel recompiles the actor on install.",
    links: [
      { kind: "github", url: "https://github.com/ada" },
      { kind: "site", url: "https://ada.example" },
      { kind: "mastodon", url: "https://mas.to/@ada" },
    ],
  },
  {
    id: 2,
    handle: "grace",
    displayName: "Grace Hopper",
    bio: `Compiler person. Poking at the Motoko-to-wasm path and what the kernel does with app modules at install time.${LONG}`,
    links: [
      { kind: "github", url: "https://github.com/grace" },
      { kind: "writing", url: "https://grace.example/notes" },
    ],
  },
  {
    id: 3,
    handle: "linus",
    displayName: "Linus Vale",
    bio: "Short bio.",
    links: [{ kind: "github", url: "https://github.com/linus" }],
  },
  {
    id: 4,
    handle: "mira",
    displayName: "Mira Okonkwo",
    bio: "Frontend and design systems. Curious whether tile isolation holds up when apps want to share state.",
    links: [
      { kind: "portfolio", url: "https://mira.example" },
      { kind: "github", url: "https://github.com/mira" },
      { kind: "dribbble", url: "https://dribbble.com/mira" },
    ],
  },
  {
    id: 5,
    handle: "priya",
    displayName: "Priya Raman",
    bio: "Distributed systems. Looking at what happens to in-flight messages during a kernel replacement.",
    links: [{ kind: "github", url: "https://github.com/priya" }],
  },
  // No bio, no links — the sparse case still has to look right.
  { id: 6, handle: "sven", displayName: "Sven Aaltonen", bio: "" },
  {
    id: 7,
    handle: "zoe",
    displayName: "Zoe Marchetti",
    bio: `Security. Reading the capability inventory closely.${LONG}`,
    links: [
      { kind: "github", url: "https://github.com/zoe" },
      { kind: "advisories", url: "https://zoe.example/advisories" },
    ],
  },
];

/**
 * Test ICRC-1 ledgers standing on the local replica, if `npm run
 * ledgers:local` has been run. The mainnet ids below are real and make the
 * sponsor page look right, but nothing can actually be transferred to them
 * locally — these are the ones a local money test can move.
 */
const LOCAL_LEDGERS = (() => {
  const path = new URL("../local-ledgers.json", import.meta.url);
  try {
    return Object.values(JSON.parse(readFileSync(path, "utf8"))).map((token) => ({
      id: token.id,
      sns: false,
    }));
  } catch {
    return [];
  }
})();

const SPONSORS = [
  {
    id: 40,
    handle: "helix",
    logo: "/logos/helix.png",
    ledgers: [
      { id: "ryjl3-tyaaa-aaaaa-aaaba-cai", sns: false }, // ICP
      { id: "mxzaz-hqaaa-aaaar-qaada-cai", sns: false }, // ckBTC
      { id: "zfcdd-tqaaa-aaaaq-aaaga-cai", sns: true }, // Dragginz
      ...LOCAL_LEDGERS,
    ],
    displayName: "Helix Labs",
    org: "Helix Labs",
    website: "https://helix.example",
    blurb: "Developer tooling for sovereign compute. Backing the prize pool.",
    links: [
      { kind: "github", url: "https://github.com/helixlabs" },
      { kind: "careers", url: "https://helix.example/careers" },
      { kind: "blog", url: "https://helix.example/blog" },
    ],
    approve: true,
  },
  {
    id: 41,
    handle: "meridian",
    logo: "/logos/meridian.png",
    ledgers: [
      { id: "cngnf-vqaaa-aaaar-qag4q-cai", sns: false }, // ckUSDT
      ...LOCAL_LEDGERS,
    ],
    displayName: "Meridian",
    org: "Meridian Systems",
    website: "https://meridian.example",
    blurb: "Infrastructure for on-chain applications.",
    links: [
      { kind: "docs", url: "https://meridian.example/docs" },
      { kind: "status", url: "https://status.meridian.example" },
    ],
    approve: true,
  },
  {
    id: 42,
    handle: "northgate",
    logo: "/logos/northgate.png",
    displayName: "Northgate",
    org: "Northgate Capital",
    website: "",
    blurb: "Waiting on verification.",
    links: [],
    approve: false,
  },
];

const JUDGES = [
  {
    id: 20,
    handle: "alan",
    displayName: "Alan Turing",
    title: "CTO of Bletchley Systems",
    bio: "Judging this one. Mostly interested in whether apps compose without stepping on each other, and whether the capability model actually constrains anything.",
    links: [
      { kind: "github", url: "https://github.com/alan" },
      { kind: "site", url: "https://bletchley.example" },
    ],
    approve: true,
  },
  {
    id: 21,
    handle: "katherine",
    displayName: "Katherine Johnson",
    title: "Principal Engineer, Orbital",
    bio: "Looking for correctness under upgrade. If it survives a kernel replacement with state intact, that counts for a lot.",
    links: [{ kind: "papers", url: "https://katherine.example/papers" }],
    approve: true,
  },
  {
    id: 22,
    handle: "rosalind",
    displayName: "Rosalind Chen",
    title: "Founder, Helix Labs",
    bio: "Interested in developer experience — how long from `apps/hello` to something installed and running.",
    links: [
      { kind: "github", url: "https://github.com/rosalind" },
      { kind: "helix", url: "https://helix.example" },
    ],
    approve: false,
  },
];

/**
 * What the seeded hackers submit under `--season`. Keyed by the identity id
 * so an entry always comes from the same person on a re-run.
 *
 * `slug` is the app's permanent id: 5 to 50 characters of `a-z` and `_`, one
 * per app across everybody, and fixed the moment the entry is created. It is
 * what the downloaded build is named — `<slug>.neutron` — so these are the
 * project titles lowercased, which is what a real submission would pick, and
 * they are distinct because each project belongs to a different hacker.
 */
const PROJECTS = [
  {
    id: 1,
    slug: "sable",
    title: "Sable",
    icon: "/icons/sable.png",
    shots: ["/shots/sable.webp", "/shots/sable-2.webp", "/shots/sable-3.webp"],
    links: [
      { kind: "demo video", url: "https://youtu.be/dQw4w9WgXcQ" },
      { kind: "x", url: "https://x.com/ada" },
      { kind: "docs", url: "https://sable.example/docs" },
    ],
    pkg: { bytes: 148_000 },
    log: [
      ["0.3.0", "Sharing dialog: pick who can read a note without leaking the key."],
      ["0.2.0", "Settings pane, and per-note passphrases."],
      ["0.1.0", "First build. Notes encrypt before they leave the tile."],
    ],
    summary:
      "A confidential notes app. Everything is encrypted before it leaves the tile, and the kernel never sees a plaintext byte.",
    url: "https://github.com/ada/sable",
  },
  {
    id: 2,
    slug: "rewind",
    title: "Rewind",
    icon: "/icons/rewind.png",
    shots: ["/shots/rewind.webp", "/shots/rewind-2.webp"],
    links: [
      { kind: "demo video", url: "https://youtu.be/aqz-KE-bpKQ" },
      { kind: "github", url: "https://github.com/grace/rewind" },
    ],
    pkg: { bytes: 96_000 },
    log: [
      ["0.2.0", "Side-by-side diff between any two recorded states."],
      ["0.1.0", "Records inbound messages and replays them."],
    ],
    summary:
      "Time-travel debugging for Neutron apps. Records every inbound message and replays them against a rebuilt module.",
    url: "https://github.com/grace/rewind",
  },
  {
    id: 3,
    slug: "tilecast",
    title: "Tilecast",
    icon: "/icons/tilecast.png",
    shots: ["/shots/tilecast.webp"],
    links: [{ kind: "x", url: "https://x.com/linus" }],
    pkg: { bytes: 84_000 },
    log: [["0.1.0", "Tiles can subscribe to each other without sharing memory."]],
    summary: "Shared state between tiles without giving up isolation.",
    url: "",
  },
  {
    id: 4,
    slug: "lantern",
    title: "Lantern",
    icon: "/icons/lantern.png",
    shots: ["/shots/lantern.webp"],
    links: [{ kind: "storybook", url: "https://lantern.example/storybook" }],
    pkg: { bytes: 112_000 },
    log: [["0.1.0", "Twelve components that hold up at a quarter of the screen."]],
    summary:
      "A design system for tiles — components that stay legible whether an app gets a quarter of the screen or all of it.",
    url: "https://lantern.example",
  },
  {
    id: 5,
    slug: "prism",
    title: "Prism",
    icon: "/icons/prism.png",
    shots: ["/shots/prism.webp"],
    links: [],
    pkg: { bytes: 72_000 },
    log: [["0.1.0", "Shows what an app can reach, and what it only thinks it can."]],
    summary:
      "A capability inspector. Shows exactly what an app can reach, and what it only thinks it can.",
    url: "https://github.com/priya/prism",
  },
  ...[
    {
      id: 1000,
      slug: "orbit",
      title: "Orbit",
      icon: "/icons/sable.png",
      shots: ["/shots/sable.webp"],
      summary: "A visual scheduler for canister jobs, retries, and long-running workflows.",
      note: "Calendar and retry timelines are ready for the first review.",
    },
    {
      id: 1001,
      slug: "relay",
      title: "Relay",
      icon: "/icons/rewind.png",
      shots: ["/shots/rewind.webp"],
      summary: "Webhook relays with inspectable delivery attempts and deterministic replay.",
      note: "Added signed deliveries and a compact attempt log.",
    },
    {
      id: 1002,
      slug: "forge",
      title: "Forge",
      icon: "/icons/prism.png",
      shots: ["/shots/prism.webp"],
      summary: "A small package builder that checks capabilities before publishing a Neutron app.",
      note: "The package check now explains every requested capability.",
    },
    {
      id: 1003,
      slug: "mosaic",
      title: "Mosaic",
      icon: "/icons/lantern.png",
      shots: ["/shots/lantern.webp"],
      summary: "Composable dashboards that keep each data tile isolated and replaceable.",
      note: "Shipped rearrangeable tiles and keyboard navigation.",
    },
    {
      id: 1004,
      slug: "beacon",
      title: "Beacon",
      icon: "/icons/tilecast.png",
      shots: ["/shots/tilecast.webp"],
      summary: "Health checks and incident signals for apps running across several tiles.",
      note: "Added latency thresholds and incident acknowledgements.",
    },
    {
      id: 1005,
      slug: "atlas",
      title: "Atlas",
      icon: null,
      shots: [],
      summary: "A dependency map for understanding which apps can reach which services.",
      note: "First dependency graph with cycle detection.",
    },
    {
      id: 1006,
      slug: "grove",
      title: "Grove",
      icon: "/icons/sable.png",
      shots: ["/shots/sable-2.webp"],
      summary: "Shared research collections with encrypted notes and explicit reader access.",
      note: "Collections can now be shared without sharing their edit key.",
    },
    {
      id: 1007,
      slug: "signal",
      title: "Signal",
      icon: "/icons/lantern.png",
      shots: [],
      summary: "A focused notification inbox for events emitted by installed applications.",
      note: "Introduced mute windows and per-app routing.",
    },
    {
      id: 1008,
      slug: "quill",
      title: "Quill",
      icon: "/icons/rewind.png",
      shots: ["/shots/rewind-2.webp"],
      summary: "Versioned technical writing with reviewable changes and portable exports.",
      note: "Added side-by-side review and Markdown export.",
    },
    {
      id: 1009,
      slug: "drift",
      title: "Drift",
      icon: null,
      shots: [],
      summary: "A minimal load simulator for finding message backlogs before deployment.",
      note: "Added repeatable traffic profiles and percentile summaries.",
    },
  ].map(({ note, ...project }, index) => ({
    ...project,
    links: [{ kind: "github", url: `https://github.com/neutron-demo/${project.slug}` }],
    pkg: { bytes: 52_000 + index * 4_000 },
    log: [["0.1.0", note]],
    url: `https://${project.slug}.example`,
  })),
];

/**
 * Rotate the roster instead of replaying the same first apps every week.
 * Week 2 deliberately reaches the long-tail demo projects; weeks 3 and 4
 * start at different safe points, away from the entries the mixed week-2
 * fixture takes down. A full-size request still visits every project once.
 */
export function projectsForWeek(week, count) {
  const offsets = [0, 0, 5, 2, 4];
  const offset = offsets[week] ?? ((week - 1) * 3) % PROJECTS.length;
  const take = Math.max(1, Math.min(count, PROJECTS.length));
  return Array.from({ length: take }, (_, index) => PROJECTS[(offset + index) % PROJECTS.length]);
}

/** Which seeded person owns which project id. */
const HANDLE_OF = {
  1: "ada",
  2: "grace",
  3: "linus",
  4: "mira",
  5: "priya",
  1000: "arbor_0000",
  1001: "basalt_0001",
  1002: "cinder_0002",
  1003: "delta_0003",
  1004: "ember_0004",
  1005: "flint_0005",
  1006: "gossamer_0006",
  1007: "harbor_0007",
  1008: "indigo_0008",
  1009: "juniper_0009",
};

/**
 * Stand-in bytes for a `.neutron` build.
 *
 * Deterministic rather than random so a re-run produces the identical asset,
 * and prefixed so a downloaded file is recognisably a placeholder rather than
 * something that looks like a real package.
 */
function demoPackage(size) {
  const bytes = new Uint8Array(size);
  const header = new TextEncoder().encode("NEUTRON-DEMO-PACKAGE\n");
  bytes.set(header, 0);
  for (let i = header.length; i < size; i += 1) bytes[i] = (i * 31) % 251;
  return bytes;
}

/** Round numbers. Keep in sync with Season.mo. */
const QUALIFIERS = 4;
const FINAL = 6;

/** Gateway port for the managed local network; keep in sync with icp.yaml. */
const LOCAL_PORT = 8943;
const LOCAL_DESCRIPTOR = resolve(ROOT, ".icp", "cache", "networks", "local", "descriptor.json");

export function parseArgs(argv, env = process.env) {
  const args = {
    environment: env.ICP_CLI_ENVIRONMENT ?? "local",
    scale: 0,
    /** Create the one season as a draft. This never seals or starts it. */
    season: false,
    /** Start the existing draft as Ada, after a separately verified seal. */
    startSeason: false,
    /**
     * Which qualifier week the caller expects to find open.
     *
     * It used to say where to stop playing. Nothing can play a season forward
     * any more — see `playSeason` — so this is now a statement about the
     * replica, and a season that is somewhere else is reported rather than
     * marched to it.
     */
    open: null,
    /** Have the approved sponsors actually transfer, on the local ledgers. */
    fund: false,
    /** Also fund the recorded human sponsor in an interactive showcase. */
    fundSponsor: null,
    /** Populate whatever week the clock has left open. */
    advance: false,
    /** How many projects enter the open week under `--advance`. */
    apps: 5,
    /** Leave a realistic mix of review and takedown states for UI work. */
    mixed: false,
    /** Cast the showcase ballots for a later live qualifier. */
    fixtureVotes: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--environment" || argv[i] === "-e") args.environment = argv[++i];
    else if (argv[i] === "--scale") args.scale = Number(argv[++i]);
    else if (argv[i] === "--season") args.season = true;
    else if (argv[i] === "--start-season") args.startSeason = true;
    else if (argv[i] === "--open") {
      args.open = Number(argv[++i]);
      if (!Number.isInteger(args.open) || args.open < 1 || args.open > QUALIFIERS) {
        throw new Error(`--open takes a qualifier week, 1 to ${QUALIFIERS}`);
      }
    } else if (argv[i] === "--fund") args.fund = true;
    else if (argv[i] === "--fund-sponsor") {
      const handle = argv[++i]?.replace(/^@/, "") ?? "";
      if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
        throw new Error("--fund-sponsor takes one valid handle");
      }
      args.fundSponsor = handle;
    } else if (argv[i] === "--advance") args.advance = true;
    else if (argv[i] === "--apps") args.apps = Number(argv[++i]);
    else if (argv[i] === "--mixed") args.mixed = true;
    else if (argv[i] === "--fixture-votes") args.fixtureVotes = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if ([args.season, args.startSeason, args.advance].filter(Boolean).length > 1) {
    throw new Error(
      "choose one lifecycle action: --season (draft), --start-season, or --advance",
    );
  }
  if (args.season && args.fund) {
    throw new Error("a draft cannot accept funding; use --fund after --start-season");
  }
  if (args.fundSponsor !== null && !args.fund) {
    throw new Error("--fund-sponsor is only valid with --fund");
  }
  if (args.open !== null && !args.startSeason) {
    throw new Error("--open only describes the week expected by --start-season");
  }
  if (!Number.isInteger(args.apps) || args.apps < 1 || args.apps > PROJECTS.length) {
    throw new Error(`--apps takes a whole number from 1 to ${PROJECTS.length}`);
  }
  if (args.mixed && !args.advance) {
    throw new Error("--mixed is only valid with --advance");
  }
  if (args.fixtureVotes && !args.advance) {
    throw new Error("--fixture-votes is only valid with --advance");
  }
  if (args.fixtureVotes && args.apps < 3) {
    throw new Error("--fixture-votes needs at least 3 apps for distinct ballots");
  }
  if (args.mixed && args.apps < 7) {
    throw new Error("--mixed needs at least 7 apps to leave useful public, review, and takedown states");
  }
  return args;
}

/** The only environment this fixture is allowed to mutate. */
const LOCAL_ENVIRONMENT = "local";

/**
 * Fail before resolving a canister or deriving an identity. Demo users,
 * moderators, submissions and votes never belong on any persistent target,
 * so there is deliberately no override or confirmation escape hatch.
 */
export function requireLocalTarget(args) {
  if (args.environment === LOCAL_ENVIRONMENT) return;
  throw new Error(
    `refusing to seed non-local environment "${args.environment}".\n\n` +
      "This script installs deterministic demo accounts, roles, apps and votes. " +
      "It has no production override; use the real UI and moderator workflow.",
  );
}

const WORDS = [
  "arbor", "basalt", "cinder", "delta", "ember", "flint", "gossamer", "harbor",
  "indigo", "juniper", "kelvin", "lumen", "marrow", "nimbus", "onyx", "pallas",
  "quartz", "rivet", "solstice", "tundra", "umbra", "vellum", "wicker", "xenon",
  "yarrow", "zephyr",
];

/** Deterministic spread across the alphabet so the A-Z index has substance. */
function bulkPerson(n) {
  const word = WORDS[n % WORDS.length];
  const handle = `${word}_${String(n).padStart(4, "0")}`;
  return {
    id: 1000 + n,
    handle,
    displayName: `${word[0].toUpperCase()}${word.slice(1)} ${1000 + n}`,
    links:
      n % 3 === 0
        ? [
            { kind: "github", url: `https://github.com/${handle}` },
            ...(n % 6 === 0 ? [{ kind: "site", url: `https://${word}.example` }] : []),
          ]
        : [],
    bio:
      n % 4 === 0
        ? ""
        : `Generated participant ${n}. ${n % 3 === 0 ? LONG : "Here to build something on Neutron."}`,
    judge: n % 7 === 0,
  };
}

function canisterIdFor(environment) {
  return execFileSync(
    "icp",
    ["canister", "status", "hackathon", "--id-only", "--environment", environment],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

/**
 * A staged PocketIC showcase may be days ahead of the workstation clock.
 * Scope that clock to this disposable Node process so ingress expiries and
 * certificate checks use the replica's time without weakening either check.
 */
async function alignLocalProcessClock() {
  const descriptor = JSON.parse(readFileSync(LOCAL_DESCRIPTOR, "utf8"));
  if (descriptor.network !== "local" || resolve(descriptor["project-dir"] ?? "") !== ROOT) {
    throw new Error("the PocketIC descriptor does not belong to this local project");
  }
  const port = descriptor["pocketic-config-port"];
  const instance = descriptor["pocketic-instance-id"];
  if (!Number.isInteger(port) || !Number.isInteger(instance)) {
    throw new Error("the local PocketIC descriptor has no usable clock endpoint");
  }
  const clockUrl = `http://127.0.0.1:${port}/instances/${instance}/read/get_time`;
  let response = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    response = await fetch(clockUrl);
    if (response.status !== 409) break;
    await new Promise((resume) => setTimeout(resume, 25));
  }
  if (response === null) throw new Error("could not contact PocketIC time");
  if (!response.ok) throw new Error(`could not read PocketIC time (HTTP ${response.status})`);
  const clock = await response.json();
  if (typeof clock.nanos_since_epoch !== "number") {
    throw new Error("PocketIC returned no local clock value");
  }

  const WallDate = globalThis.Date;
  const wallNow = WallDate.now.bind(WallDate);
  const offset = Math.trunc(clock.nanos_since_epoch / 1_000_000) - wallNow();
  class ReplicaDate extends WallDate {
    constructor(...args) {
      super(...(args.length === 0 ? [wallNow() + offset] : args));
    }

    static now() {
      return wallNow() + offset;
    }
  }
  globalThis.Date = ReplicaDate;
  if (Math.abs(offset) >= 60_000) {
    console.log(`using PocketIC's local clock (${Math.round(offset / 1000)}s from wall time)`);
  }
}

async function connect(canisterId, idNum, host, local) {
  const identity = await hashIdentity(idNum);
  const agent = await HttpAgent.create({
    identity,
    host,
    ...(local ? { verifyQuerySignatures: false } : {}),
  });
  if (local) await agent.fetchRootKey();
  return {
    canister: Actor.createActor(idlFactory, { agent, canisterId }),
    principal: identity.getPrincipal().toText(),
  };
}

/**
 * Where a seeded hacker's rewards go.
 *
 * `set_wallet` refuses the anonymous principal and refuses the principal the
 * caller signed in with — a login identity holds no tokens, and accepting it
 * would only postpone the discovery to distribution day. So this derives a
 * *different* icblast identity from the same number: stable per person across
 * re-runs, and far enough from the seeded range that it is nobody's login.
 */
/**
 * `icblast`'s `hashIdentity` takes an integer in [0, 65535], so the offset has
 * to stay inside sixteen bits — 900 000 overflowed it and the seed died after
 * registering everybody, which is the worst place to fail.
 */
const WALLET_OFFSET = 40_000;

async function walletFor(idNum) {
  return (await hashIdentity(idNum + WALLET_OFFSET)).getPrincipal();
}

function report(label, result) {
  if (result && typeof result === "object" && "err" in result) {
    console.log(
      `  skip ${label}: ${JSON.stringify(result.err, (_, value) =>
        typeof value === "bigint" ? value.toString() : value,
      )}`,
    );
    return false;
  }
  console.log(`  ok   ${label}`);
  return true;
}

/** A lifecycle step must land; continuing would make the demo lie about state. */
function required(label, result) {
  if (result && typeof result === "object" && "err" in result) {
    throw new Error(
      `${label}: ${JSON.stringify(result.err, (_, value) =>
        typeof value === "bigint" ? value.toString() : value,
      )}`,
    );
  }
  console.log(`  ok   ${label}`);
  return result?.ok;
}

/**
 * Register, or update in place if the identity already has a profile.
 *
 * Without this a re-run is a no-op — every call comes back
 * AlreadyRegistered — so changing the seed data would mean wiping the
 * canister. `update_profile` is caller-scoped, and each seed identity owns
 * its own handle, so the update always applies to the right row.
 *
 * Registration also shuts for the length of a season now — `Season.start`
 * closes the doors and finishing reopens them, and there is no switch to
 * override it. So a re-run against a replica with a season running refreshes
 * everybody who is already here and reports `Closed` for anybody new, which is
 * the right answer rather than a failure: signing up in week four is exactly
 * what the closed door is for.
 */
/**
 * Copy a file from `frontend/public` into a user's own asset namespace.
 *
 * An entry, an avatar and a sponsor's logo may only name uploads under
 * `/u/<id>/`, in the folder matching what they are (rules.md §3). The demo art
 * ships as site-global paths, which nothing can point at — so each user
 * uploads their own copy, which is what a real one does anyway. The canister
 * derives the served content type from the extension, so keys keep theirs.
 */
async function uploadOwn(canister, userId, folder, file) {
  const source = resolve(ROOT, "frontend", "public", file.replace(/^\//, ""));
  if (!existsSync(source)) return null;
  const key = `/u/${userId}/${folder}/${basename(file)}`;
  const stored = await canister.my_upload({
    store: {
      key,
      content: new Uint8Array(readFileSync(source)),
      contentType: file.endsWith(".png") ? "image/png" : "image/webp",
      contentEncoding: "identity",
      chunks: 1n,
    },
  });
  if ("err" in stored) {
    // Re-entering the same app in a later qualifier reuses its static demo
    // art. The earlier round deliberately makes those bytes immutable, so an
    // attempted rewrite is refused — but the existing key is exactly what we
    // need and still resolves. Anything else must not silently turn into an
    // entry with no pictures.
    if (!reusablePublishedAsset(stored.err)) {
      console.log(`  skip ${key}: ${stored.err}`);
      return null;
    }
  }
  return key;
}

/** The immutable file is already present and safe to reference again. */
export function reusablePublishedAsset(error) {
  return String(error).includes("referenced by a published entry or pending review");
}

/** A project's icon and screenshots, in its own hacker's namespace. */
async function uploadArt(canister, userId, project) {
  const icon = project.icon ? await uploadOwn(canister, userId, "icon", project.icon) : null;
  const shots = [];
  for (const shot of project.shots ?? []) {
    const key = await uploadOwn(canister, userId, "shots", shot);
    if (key) shots.push(key);
  }
  if ((project.icon && !icon) || shots.length !== (project.shots ?? []).length) {
    throw new Error(`could not prepare all art for ${project.title}`);
  }
  return { icon, shots };
}

/**
 * Upload the build that the initial entry is judged on.
 *
 * A package is mandatory on `submit_entry`. The week is part of the key
 * because a closed round freezes every referenced asset; re-entering the same
 * project in a later qualifier therefore needs a new immutable build key.
 */
async function uploadPackage(canister, userId, project, week) {
  const key = `/u/${userId}/pkg/${1_690_000_000_000 + week * 100 + project.id}.neutron`;
  const stored = await canister.my_upload({
    store: {
      key,
      content: demoPackage(project.pkg.bytes),
      contentType: "application/octet-stream",
      contentEncoding: "identity",
      chunks: 1n,
    },
  });
  required(`${project.slug}.neutron (week ${week})`, stored);
  return { key };
}

/** Propose one revision and have the non-author seeded moderator land it. */
async function approve(reviewer, label, proposed) {
  const revision = required(`${label} proposed`, proposed);
  required(`${label} approved by @sven`, await reviewer.approve_revision(revision.id));
  return revision;
}

/**
 * Freeze the prize-ledger policy before the first sponsor row exists.
 *
 * `set_ledger_allowlist` validates each principal against its live ICRC
 * canister, so a stale `local-ledgers.json` fails here rather than after the
 * canister has been sealed. A matching existing policy makes a draft seed
 * safely re-runnable; a different one is an error, never silently replaced.
 */
async function configureLedgerAllowlist(admin) {
  const wanted = LOCAL_LEDGERS.map((ledger) => Principal.fromText(ledger.id));
  const config = await admin.config();
  if (config.ledgerAllowlistSet) {
    const existing = new Set(config.ledgerAllowlist.map((ledger) => ledger.toText()));
    const matches =
      existing.size === wanted.length &&
      wanted.every((ledger) => existing.has(ledger.toText()));
    if (!matches) {
      throw new Error("the configured ledger allowlist differs from local-ledgers.json");
    }
    console.log(`  skip: ${wanted.length} local prize ledgers are already fixed`);
    return;
  }

  required(
    `${wanted.length} local prize ledgers validated and fixed`,
    await admin.set_ledger_allowlist(wanted),
  );
}

async function upsert(canister, input, label) {
  const created = await canister.register(input);
  if (!("err" in created)) {
    console.log(`  ok   ${label}`);
    return true;
  }
  if ("AlreadyRegistered" in created.err) {
    return report(`${label} (updated)`, await canister.update_profile(input));
  }
  console.log(`  skip ${label}: ${JSON.stringify(created.err)}`);
  return false;
}

/** Candid `opt text` is `[]` or `[value]`. */
function opt(value) {
  return value ? [value] : [];
}

async function currentProfile(canister, handle) {
  const [user] = await canister.profile(handle);
  if (!user) throw new Error(`@${handle} is no longer registered`);
  return user;
}

async function setJudge(canister, handle, status, note = []) {
  const user = await currentProfile(canister, handle);
  return canister.set_judge(
    {
      id: user.id,
      expectedStatus: user.judgeStatus,
      expectedUpdatedAt: user.updatedAt,
    },
    status,
    note,
  );
}

async function setSponsor(canister, handle, status, note = []) {
  const user = await currentProfile(canister, handle);
  return canister.set_sponsor(
    {
      id: user.id,
      expectedStatus: user.sponsorStatus,
      expectedUpdatedAt: user.updatedAt,
    },
    status,
    note,
  );
}

async function setModerator(canister, handle, on, note = []) {
  const user = await currentProfile(canister, handle);
  return canister.set_moderator(
    {
      id: user.id,
      expectedOn: user.moderator,
      expectedUpdatedAt: user.updatedAt,
    },
    on,
    note,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireLocalTarget(args);
  const canisterId = canisterIdFor(args.environment);
  const local = args.environment !== "ic";
  const host = local ? `http://127.0.0.1:${LOCAL_PORT}` : "https://icp-api.io";
  if (local) await alignLocalProcessClock();

  if (args.season && !local) {
    throw new Error(
      "--season seeds deterministic demo identities and is local-only; create a real draft with a real moderator identity",
    );
  }
  if (args.season && LOCAL_LEDGERS.length === 0) {
    throw new Error(
      "--season needs verified local prize ledgers; run `npm run ledgers:local -- --fresh` first",
    );
  }

  // This is deliberately a second invocation, after the operator has manually
  // sealed and independently checked the controller list. Do not replay all
  // the controller-era setup on the far side of that one-way door.
  if (args.startSeason) {
    if (!local) {
      throw new Error(
        "--start-season is a disposable-local demo path; start a real season with its real moderator identity",
      );
    }
    const admin = await startSeededSeason({ canisterId, host, local }, args.open);
    if (args.fund) {
      await fundTreasury({
        admin,
        local,
        environment: args.environment,
        extraSponsor: args.fundSponsor,
      });
    }
    await summarise(admin, args, canisterId);
    return;
  }

  // The post-start actions must not replay controller-era registration,
  // sponsor, or role setup. Those calls are forbidden after the seal and, more
  // importantly, their failure would hide the action the operator asked for.
  if (args.advance || args.fund) {
    const { canister: moderator } = await connect(canisterId, 6, host, local);
    if (args.advance) {
      await advanceWeek(
        { admin: moderator, canisterId, host, local },
        { apps: args.apps, mixed: args.mixed, fixtureVotes: args.fixtureVotes },
      );
    }
    if (args.fund) {
      await fundTreasury({
        admin: moderator,
        local,
        environment: args.environment,
        extraSponsor: args.fundSponsor,
      });
    }
    await summarise(moderator, args, canisterId);
    return;
  }

  console.log(`seeding ${canisterId} on ${args.environment}\n`);

  console.log("participants");
  for (const person of PARTICIPANTS) {
    const { canister } = await connect(canisterId, person.id, host, local);
    await upsert(
      canister,
      {
        handle: person.handle,
        displayName: person.displayName,
        title: [],
        bio: person.bio,
        links: person.links ?? [],
        // The one versioned SRPPA acceptance covers every role. Profiles
        // records the current agreement version and timestamp server-side.
        terms: true,
      },
      person.handle,
    );
  }

  // Everyone registers the same way; roles are taken afterwards and stack.
  console.log("\nhackers (self-service, no approval)");
  // One hacker per project, so a qualifier week fills all five rewarded places.
  const hackerIds = new Set(PROJECTS.map((project) => project.id));
  for (const person of PARTICIPANTS.filter((p) => hackerIds.has(p.id))) {
    const { canister } = await connect(canisterId, person.id, host, local);
    // Somewhere to be paid, before there is anything to pay for: a hacker
    // without a reward wallet is refused at `submit_entry` with `#NoWallet`,
    // so the seed sets one here rather than discovering it a week later.
    report(`${person.handle} -> wallet`, await canister.set_wallet(await walletFor(person.id)));
    report(`${person.handle} -> hacker`, await canister.set_hacker(true));
  }

  // Identity 0 is the setup controller. It configures the fixed prize-ledger
  // policy and roles before sponsor applications are accepted, then disappears
  // permanently at the separately invoked seal.
  const { canister: admin } = await connect(canisterId, 0, host, local);
  if (args.season) await configureLedgerAllowlist(admin);

  console.log("\nsponsors (register, then apply)");
  // A season may not start with undecided sponsor applications. Keep the
  // deliberately pending Northgate card in an ordinary directory demo, but
  // omit it from the sealed-season fixture instead of manufacturing a pending
  // row that nobody could resolve later.
  const sponsors = args.season ? SPONSORS.filter((sponsor) => sponsor.approve) : SPONSORS;
  for (const sponsor of sponsors) {
    const { canister } = await connect(canisterId, sponsor.id, host, local);
    const made = await upsert(
      canister,
      {
        handle: sponsor.handle,
        displayName: sponsor.displayName,
        title: [],
        bio: "",
        links: sponsor.links ?? [],
        terms: true,
      },
      sponsor.handle,
    );
    if (made) {
      // A sponsor's logo goes through the same namespace rule as an entry's
      // art — it is rendered as an image on the sponsors board, so an
      // arbitrary path there is somebody else's server being called on every
      // visit.
      const who = await canister.me();
      const logo =
        sponsor.logo && who.length
          ? await uploadOwn(canister, who[0].id, "avatar", sponsor.logo)
          : null;
      report(
        `${sponsor.handle} applied`,
        await canister.apply_as_sponsor({
          org: sponsor.org,
          website: sponsor.website,
          logo: logo ? [logo] : [],
          // A disposable local season may only pledge the local ICRC fixtures.
          // Mainnet ids cannot answer metadata calls on this replica and must
          // never leak into the fixed season allowlist by looking plausible.
          ledgers: (args.season ? LOCAL_LEDGERS : (sponsor.ledgers ?? [])).map((l) => ({
            id: Principal.fromText(l.id),
            sns: l.sns,
          })),
          blurb: sponsor.blurb,
        }),
      );
    }
  }

  // Judges register exactly like everyone else, then opt in.
  console.log("\njudges (register, then apply)");
  for (const judge of JUDGES) {
    const { canister } = await connect(canisterId, judge.id, host, local);
    const ok = await upsert(
      canister,
      {
        handle: judge.handle,
        displayName: judge.displayName,
        title: opt(judge.title),
        bio: judge.bio,
        links: judge.links ?? [],
        terms: true,
      },
      judge.handle,
    );
    if (ok) report(`${judge.handle} applied`, await canister.apply_as_judge());
  }

  // Identity 0 is a controller (upload.mjs registers it), so it can appoint
  // the moderator bench needed on the far side of the seal. After that,
  // moderators handle judge applications —
  // and an approval now takes two of them, seconding each other. A controller
  // has no profile row to count as one of the two and still applies alone, so
  // the seed does the approving below rather than leaving one vote hanging
  // with nobody to second it.
  console.log("\nappointing moderators (controller-only, before the seal)");
  report("ada -> moderator", await setModerator(admin, "ada", true, ["seed"]));
  report("sven -> moderator", await setModerator(admin, "sven", true, ["seed"]));
  if (args.season) {
    report(
      "zoe -> moderator",
      await setModerator(admin, "zoe", true, ["seed launch bench"]),
    );
  }

  console.log("\napproving judges (a controller alone, or two moderators)");
  // A disposable sealed season needs three approved judges and no unresolved
  // applications. The ordinary directory fixture deliberately leaves
  // Rosalind pending; the launch fixture approves the complete bench.
  for (const judge of JUDGES.filter((j) => j.approve || args.season)) {
    report(
      `${judge.handle} -> judge`,
      await setJudge(admin, judge.handle, { approved: null }, ["seed"]),
    );
  }

  console.log("\napproving sponsors");
  for (const sponsor of SPONSORS.filter((s) => s.approve)) {
    report(
      `${sponsor.handle} -> sponsor`,
      await setSponsor(admin, sponsor.handle, { approved: null }, ["seed"]),
    );
  }
  if (args.season) {
    for (const sponsor of SPONSORS.filter((s) => !s.approve)) {
      const [profile] = await admin.profile(sponsor.handle);
      if (profile && variant(profile.sponsorStatus) === "pending") {
        report(
          `${sponsor.handle} -> sponsor application decided`,
          await setSponsor(
            admin,
            sponsor.handle,
            { no: null },
            ["not part of sealed demo"],
          ),
        );
      }
    }
  }

  if (args.scale > 0) {
    console.log(`\nbulk: ${args.scale} generated participants`);
    let made = 0;
    let applied = 0;
    for (let n = 0; n < args.scale; n += 1) {
      const person = bulkPerson(n);
      const { canister } = await connect(canisterId, person.id, host, local);
      const input = {
        handle: person.handle,
        displayName: person.displayName,
        title: [],
        bio: person.bio,
        links: person.links,
        terms: true,
      };
      let result = await canister.register(input);
      // Same upsert as above, so re-running refreshes generated users too
      // rather than silently skipping every one of them.
      if ("err" in result && "AlreadyRegistered" in result.err) {
        result = await canister.update_profile(input);
      }
      if (!("err" in result)) {
        made += 1;
        // Roles stack, so a bulk user can be both. No reward wallet: these
        // exist to fill the directory and never submit, and a hacker who has
        // signed up without saying where to be paid is a real state the
        // profile pages have to render anyway. The five who do submit get one
        // above, where it is actually required.
        const ownsProject = PROJECTS.some((project) => project.id === person.id);
        if (ownsProject) {
          await canister.set_wallet(await walletFor(person.id));
          await canister.set_hacker(true);
        } else if (n % 2 === 0) {
          await canister.set_hacker(true);
        }
        if (person.judge) {
          await canister.apply_as_judge();
          applied += 1;
          if (args.season) {
            await setJudge(
              admin,
              person.handle,
              { approved: null },
              ["seed launch bench"],
            );
          }
        }
      }
      if ((n + 1) % 100 === 0) console.log(`  ${n + 1}/${args.scale}…`);
    }
    console.log(`  ${made} created, ${applied} applied to judge`);
  }

  if (args.season) {
    await createDraft({ canisterId, host, local, environment: args.environment, admin });
  }

  await summarise(admin, args, canisterId);
}

const variant = (value) => Object.keys(value)[0];

/** Print the one-way steps, but never perform one of them. */
function printSealSteps(canisterId, environment) {
  console.log(
    "\nDRAFT ONLY — the demo has not sealed or started the canister." +
      "\nThe following sequence is irreversible. Use it only on a disposable local replica," +
      "\nafter every pre-seal check has passed and no more code or asset changes remain:\n" +
      `\n  icp canister settings update hackathon --environment ${environment} ` +
      `--add-controller ${canisterId} --force` +
      `\n  echo y | icp canister call hackathon seal_canister '()' --environment ${environment}` +
      `\n  npm run seed -- --start-season --environment ${environment}\n` +
      "\nThe last command reconnects as deterministic moderator @ada. The normal" +
      `\nstart call verifies that ${canisterId} is its sole controller, starts the draft,` +
      "\nand populates week 1.\n",
  );
}

/** Create the single season, and intentionally leave it in `#draft`. */
async function createDraft({ canisterId, host, local, environment, admin }) {
  console.log("\nseason draft");
  const { canister: ada } = await connect(canisterId, 1, host, local);
  const existing = await ada.seasons(10n);
  if (existing.length > 0) {
    const phase = variant(existing[0].phase);
    if (phase !== "draft") {
      throw new Error(`season ${existing[0].number} already exists in ${phase}`);
    }
    console.log(`  skip: season ${existing[0].number} is already a draft`);
  } else {
    const made = required("@ada created season 1 as a draft", await ada.create_season());
    if (variant(made.phase) !== "draft" || Number(made.week) !== 0) {
      throw new Error("create_season did not leave the season at draft week 0");
    }
  }
  const config = await admin.config();
  required(
    "registration closed before sealing",
    await admin.set_config(config.siteTitle, false),
  );
  printSealSteps(canisterId, environment);
}

/**
 * Start the pre-existing draft after the operator has sealed it by hand.
 *
 * The identities are load-bearing: Ada starts; Sven, the second moderator and
 * the only seeded moderator who owns no project,
 * appointed by the draft seed, reviews every entry/version before either
 * seeded judge votes. The installing identity is deliberately unused here —
 * after the seal it has no authority at all.
 */
async function startSeededSeason({ canisterId, host, local }, expectedWeek) {
  console.log(`starting the disposable local demo in ${canisterId}\n`);
  const [{ canister: ada }, { canister: sven }] = await Promise.all([
    connect(canisterId, 1, host, local),
    connect(canisterId, 6, host, local),
  ]);

  let [live] = await ada.season_running();
  if (!live) {
    const draft = (await ada.seasons(10n)).find((row) => variant(row.phase) === "draft");
    if (!draft) throw new Error("no draft season exists; run `npm run seed -- --season` before sealing");
    live = required("@ada started the draft (judges frozen)", await ada.start_season(draft.id));
  } else {
    console.log(`  skip: season ${live.number} is already running at week ${live.week}`);
  }

  await playSeason(
    { admin: ada, reviewer: sven, canisterId, host, local },
    { stopAt: expectedWeek },
  );
  return ada;
}

/**
 * Populate whatever week the clock has left open.
 *
 * It used to close the open week first and then fill the one that opened.
 * `close_week` is gone — the season keeps its own seven-day calendar and a
 * controller cannot bring a deadline forward — so this no longer steps the
 * bracket on; it fills the week already in front of it. Run it after a week
 * has genuinely turned over. Weeks 5 and 6 take no submissions — they are
 * carried into — so this only submits for a qualifier.
 *
 * The first two showcase weeks receive different fixture ballots, so the
 * historical bracket has meaningful but non-repeated results. Week 3 and
 * later receive no seeded votes unless the caller explicitly asks for the
 * later-round showcase ballots. That keeps the ordinary live board available
 * to the signed-in human judge while still letting the staged demo finish a
 * qualifier with a realistic, non-tied result.
 */
async function advanceWeek(
  { admin, canisterId, host, local },
  { apps, mixed, fixtureVotes },
) {
  console.log("\nfilling the open week");
  const live = await admin.season_running();
  if (live.length === 0) return console.log("  skip: no season is running");

  const season = live[0];
  const week = Number(season.week);
  console.log(`  ─── week ${week}`);

  if (week > QUALIFIERS) {
    console.log("  carried into, not submitted to — no entries to add");
    return;
  }

  const { canister: reviewer } = await connect(canisterId, 6, host, local);
  const entering = projectsForWeek(week, apps);
  // A mixed showcase keeps the last two proposals untouched. They are real
  // uploads and real review rows, but do not appear in the public bracket
  // until a moderator approves them — exactly the distinction the UI needs to
  // explain. Everything before them becomes a public app.
  const publicProjects = mixed ? entering.slice(0, -2) : entering;
  for (const [index, project] of entering.entries()) {
    const { canister } = await connect(canisterId, project.id, host, local);
    const who = await canister.me();
    if (who.length === 0) throw new Error(`@${HANDLE_OF[project.id]} is not registered`);
    const art = who.length
      ? await uploadArt(canister, who[0].id, project)
      : { icon: null, shots: [] };
    const pkg = await uploadPackage(canister, who[0].id, project, week);
    const proposed = await canister.submit_entry({
      // Fixed for this qualifier lineage and refused if it moves. Re-entering
      // in another qualifier deliberately starts a new suffixed lineage.
      slug: project.slug,
      title: project.title,
      summary: project.summary,
      url: project.url,
      icon: art.icon ? [art.icon] : [],
      shots: art.shots,
      links: project.links,
      pkg,
    });
    const revision = required(`entry: ${project.title} proposed`, proposed);
    if (mixed && index >= publicProjects.length) {
      console.log(`  hold entry: ${project.title} in the review queue`);
    } else {
      required(
        `entry: ${project.title} approved by @sven`,
        await reviewer.approve_revision(revision.id),
      );
    }
  }

  if (mixed) {
    // An approved app remains public while its next release is under review.
    // Leave one update waiting and reject another with a useful report so the
    // owner/moderator views exercise both histories without inventing states
    // that the real workflow cannot create.
    const pendingProject = publicProjects[0];
    const rejectedProject = publicProjects[1];
    const { canister: pendingOwner } = await connect(canisterId, pendingProject.id, host, local);
    const [pendingEntry] = await pendingOwner.my_entry();
    if (!pendingEntry) throw new Error(`${pendingProject.title} has no current entry`);
    required(
      `${pendingProject.title} 0.2.0 left pending`,
      await pendingOwner.publish_update(pendingEntry.id, {
        version: "0.2.0",
        note: "Release candidate submitted; moderator review is still pending.",
        pkg: [],
      }),
    );

    const { canister: rejectedOwner } = await connect(canisterId, rejectedProject.id, host, local);
    const [rejectedEntry] = await rejectedOwner.my_entry();
    if (!rejectedEntry) throw new Error(`${rejectedProject.title} has no current entry`);
    const rejected = required(
      `${rejectedProject.title} 0.2.0 proposed`,
      await rejectedOwner.publish_update(rejectedEntry.id, {
        version: "0.2.0",
        note: "A release with an incomplete capability explanation.",
        pkg: [],
      }),
    );
    required(
      `${rejectedProject.title} 0.2.0 rejected with a report`,
      await reviewer.reject_revision(
        rejected.id,
        "The build is valid, but the release notes do not explain the newly requested network capability. Add that disclosure and resubmit.",
      ),
    );
  }

  // Different historical winners, then a clean live board unless the staged
  // showcase explicitly asks for week 4's ballots.
  const views = await admin.season_week_view(season.id, season.week, 50n);
  const byTitle = new Map(views.map((view) => [view.entry.title, view]));
  const pick = (i) => byTitle.get(publicProjects[i]?.title);
  const ballotIndexes = advanceBallotIndexes(week, publicProjects.length, fixtureVotes);
  const ballots = ballotIndexes.map((picks, index) => ({
    id: index === 0 ? 20 : 21,
    handle: index === 0 ? "alan" : "katherine",
    picks: picks.map(pick),
  }));
  for (const ballot of ballots) {
    const { canister } = await connect(canisterId, ballot.id, host, local);
    const seen = new Set();
    for (const view of ballot.picks) {
      // Two votes must land on two different entries; with a very thin field
      // the picks above can collide.
      if (!view || seen.has(String(view.entry.id))) continue;
      seen.add(String(view.entry.id));
      report(`${ballot.handle} votes ${view.entry.title}`, await canister.cast_vote(view.entry.id));
    }
  }

  if (mixed) {
    const { canister: firstModerator } = await connect(canisterId, 1, host, local);
    const targets = publicProjects.slice(-3);
    const entriesByTitle = new Map(views.map((view) => [view.entry.title, view.entry]));

    for (const project of targets.slice(0, 2)) {
      const entry = entriesByTitle.get(project.title);
      if (!entry) throw new Error(`could not find ${project.title} for takedown`);
      const first = await firstModerator.takedown_app(
        entry.id,
        "Demo takedown: the submitted package included an asset without redistribution permission.",
      );
      if (!("err" in first) || !("NeedsSecond" in first.err)) {
        throw new Error(`${project.title} did not stop at the expected first-moderator quorum`);
      }
      console.log(`  ok   ${project.title} takedown backed by @ada (1 of 2)`);
      required(
        `${project.title} taken down by @sven (2 of 2)`,
        await reviewer.takedown_app(
          entry.id,
          "Demo takedown: the submitted package included an asset without redistribution permission.",
        ),
      );
    }

    const waiting = entriesByTitle.get(targets[2].title);
    if (!waiting) throw new Error(`could not find ${targets[2].title} for takedown review`);
    const first = await firstModerator.takedown_app(
      waiting.id,
      "Demo review in progress: ownership evidence for one screenshot has not been supplied.",
    );
    if (!("err" in first) || !("NeedsSecond" in first.err)) {
      throw new Error(`${targets[2].title} did not leave a one-of-two takedown decision`);
    }
    console.log(`  hold ${targets[2].title} takedown at 1 of 2 for another moderator`);
  }

  const after = await admin.season_week_view(season.id, season.week, 50n);
  for (const view of after) {
    console.log(`  ${String(view.entry.votes).padStart(2)} votes  ${view.entry.title}`);
  }
}

/**
 * The deterministic ballots used by `--advance`.
 *
 * Indexes are relative to that week's rotated roster. Week 4 backs its final
 * project twice and splits the other votes, producing a clear winner without
 * replaying either earlier result. It is opt-in because an ordinary live week
 * should begin with no votes manufactured for it.
 */
export function advanceBallotIndexes(week, projectCount, fixtureVotes = false) {
  const last = projectCount - 1;
  if (week === 1) return [[3, 5], [3, 4]]; // Lantern wins week 1.
  if (week === 2) return [[4, 1], [4, 2]]; // Beacon wins week 2.
  if (week === 4 && fixtureVotes) return [[last, 1], [last, 2]];
  return [];
}

/**
 * Put real tokens in the treasury.
 *
 * Each approved sponsor receives a transfer at their own deposit address on
 * every local test ledger they pledged. The seeded moderator then uses the
 * documented recovery sweep, avoiding the public one-notification-per-minute
 * throttle while still exercising the real ledger transfer and accounting
 * path. The transfer is signed by the CLI identity, which is where the test
 * supply sits; a real sponsor signs it from their own wallet.
 *
 * Requires a running season: the treasury does not accept deposits otherwise.
 */
async function fundTreasury({ admin, local, environment, extraSponsor }) {
  console.log("\nfunding the treasury");
  if (!local) return console.log("  skip: local ledgers only");

  const live = await admin.season_running();
  if (live.length === 0) return console.log("  skip: no season is running");

  let ledgers;
  try {
    const path = new URL("../local-ledgers.json", import.meta.url);
    ledgers = Object.values(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return console.log("  skip: no local-ledgers.json — run `npm run ledgers:local -- --fresh`");
  }

  const handles = [
    ...SPONSORS.filter((sponsor) => sponsor.approve).map((sponsor) => sponsor.handle),
    ...(extraSponsor ? [extraSponsor] : []),
  ];
  for (const handle of new Set(handles)) {
    const [user] = await admin.profile(handle);
    if (!user || !("approved" in user.sponsorStatus)) {
      throw new Error(`@${handle} is not an approved sponsor; refusing to transfer`);
    }
    const [deposit] = await admin.deposit_for(handle);
    if (!deposit) {
      console.log(`  skip ${handle}: no deposit address`);
      continue;
    }
    const to =
      `record { owner = principal "${deposit.account.owner.toText()}"; ` +
      `subaccount = opt vec { ${[...deposit.account.subaccount[0]].join("; ")} } }`;

    // Only ledgers this sponsor actually pledged. Transferring first and
    // asking afterwards would strand the tokens in a deposit subaccount that
    // nothing will ever sweep, and there is no refund path out of it.
    const info = user.sponsor[0];
    const pledged = new Set((info?.ledgers ?? []).map((ledger) => ledger.id.toText()));
    const given = new Map(
      (info?.given ?? []).map((gift) => [gift.ledger.toText(), gift.amount]),
    );
    const mine = ledgers.filter((token) => pledged.has(token.id));
    if (mine.length === 0) {
      console.log(`  skip ${handle}: pledged no local test ledger`);
      continue;
    }

    for (const token of mine) {
      const previous = given.get(token.id) ?? 0n;
      if (previous > 0n) {
        console.log(
          `  skip ${handle}: already gave ${whole(previous, token.decimals)} ${token.symbol}`,
        );
        continue;
      }
      // The u64-backed 18-decimal fixture can hold fewer than 19 whole
      // tokens. A fraction still exercises its awkward precision and payout
      // fees, while allowing many disposable showcases to reuse the ledger
      // instead of exhausting its holder after two runs.
      const gift =
        token.decimals >= 18
          ? 10n ** BigInt(token.decimals - 1) // 0.1 token
          : 10n ** BigInt(token.decimals) * 2_500n;
      // `--environment` spelled out, like every other icp call here. Without
      // it the CLI falls back to ICP_ENVIRONMENT — a different variable from
      // the ICP_CLI_ENVIRONMENT this script reads, so the two can point at
      // different networks. These ids come from local-ledgers.json and mean
      // nothing anywhere else; the transfer must go where `local` says it is.
      execFileSync(
        "icp",
        [
          "canister",
          "call",
          token.id,
          "icrc1_transfer",
          `(record { to = ${to}; amount = ${gift} : nat })`,
          "--environment",
          environment,
        ],
        { cwd: ROOT, encoding: "utf8", input: "y\n" },
      );
      const collected = await admin.sweep_sponsor(
        handle,
        Principal.fromText(token.id),
      );
      required(
        `${handle} gives ${whole(gift, token.decimals)} ${token.symbol}`,
        collected,
      );
    }
  }

  const pool = new Map(
    (await admin.prize_pool()).map(([ledger, amount]) => [ledger.toText(), amount]),
  );
  for (const token of ledgers) {
    const held = pool.get(token.id) ?? 0n;
    console.log(`  pool ${whole(held, token.decimals)} ${token.symbol}`);
  }
}

/** Base units as whole-token text, in bigint — 18 decimals overflows a float. */
function whole(raw, decimals) {
  const digits = raw.toString().padStart(decimals + 1, "0");
  const frac = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return `${digits.slice(0, digits.length - decimals)}${frac ? `.${frac}` : ""}`;
}

/**
 * Fill the week that Ada has already started.
 *
 * Starting is a separate, explicit post-seal step. This function has no
 * controller identity and no lifecycle authority: it uploads each mandatory
 * package, proposes the entry, waits for Sven to approve it, and only then
 * gives the judges something to vote on.
 *
 * `stopAt` is what is left of `--open`: the week the caller expected to find
 * open. Nothing here can move a season to it, so a mismatch is said out loud
 * rather than played towards.
 *
 * Approving judges has to happen before the start: the freeze is the whole
 * point of rules.md §2, and it is enforced, not advisory.
 */
async function playSeason({ admin, reviewer, canisterId, host, local }, { stopAt }) {
  // A designated winner per qualifier week, so that as the clock works through
  // them the semi-final is four distinct projects rather than the same one four
  // times. Only the open week's entry in this list is used on any one run.
  const winners = ["Sable", "Rewind", "Tilecast", "Lantern", "Prism"];

  const live = await admin.season_running();
  if (live.length === 0) return console.log("  the season is not running");
  const season = live[0];
  const week = Number(season.week);
  console.log(`  ─── week ${week}`);
  if (stopAt !== null && week !== stopAt) {
    console.log(
      `  note: --open asked for week ${stopAt}; a season starts at week ${week} and only its ` +
        "own clock moves it on. Filling what is open.",
    );
  }

  // Weeks 5 and 6 are carried into, never submitted to (rules.md §3). A season
  // that has just started is at week 1, so this is the ordinary path; the guard
  // stays because `--season` may also be pointed at a replica further along.
  if (week <= QUALIFIERS) {
    for (const project of PROJECTS) {
      const { canister } = await connect(canisterId, project.id, host, local);
      const who = await canister.me();
      if (who.length === 0) throw new Error(`@${HANDLE_OF[project.id]} is not registered`);
      const art = who.length
        ? await uploadArt(canister, who[0].id, project)
        : { icon: null, shots: [] };
      const pkg = await uploadPackage(canister, who[0].id, project, week);
      await approve(
        reviewer,
        `entry: ${project.title}`,
        await canister.submit_entry({
          // The app's permanent id. Chosen once and refused if it ever moves,
          // so re-entering the same project in a later week is an edit of the
          // same app rather than a second one.
          slug: project.slug,
          title: project.title,
          summary: project.summary,
          url: project.url,
          icon: art.icon ? [art.icon] : [],
          shots: art.shots,
          links: project.links,
          pkg,
        }),
      );
    }
  }

  // Changelogs for the week that is open — a closed week's entries are
  // immutable, and the modal is what shows this off. It used to be conditional
  // on where the seed stopped playing; the week it fills is now always the open
  // one, so the only condition left is that it takes submissions at all.
  if (week <= QUALIFIERS) {
    for (const project of PROJECTS) {
      const { canister } = await connect(canisterId, project.id, host, local);
      const user = await canister.profile(HANDLE_OF[project.id]);
      const [currentEntry] = await canister.my_entry();
      if (!currentEntry) throw new Error(`${project.title} has no current entry`);
      // Oldest first, so the newest ends up at the top of the log — and the
      // package rides with the newest, which is how a release reads.
      const log = [...project.log].reverse();
      for (const [version, note] of log) {
        const newest = version === log[log.length - 1][0];
        let pkg = [];
        if (newest && project.pkg && user.length > 0) {
          const key = `/u/${user[0].id}/pkg/${1_700_000_000_000 + week * 100 + project.id}.neutron`;
          const stored = await canister.my_upload({
            store: {
              key,
              content: demoPackage(project.pkg.bytes),
              contentType: "application/octet-stream",
              contentEncoding: "identity",
              chunks: 1n,
            },
          });
          // Named after the upload key here, but served as `<slug>.neutron`:
          // what somebody ends up with in their downloads folder says which app
          // it is, not which number the uploader happened to pick.
          if ("err" in stored) console.log(`  skip ${project.slug}.neutron: ${stored.err}`);
          else pkg = [{ key }];
        }
        await approve(
          reviewer,
          `${project.title} ${version}${pkg.length ? " + package" : ""}`,
          await canister.publish_update(currentEntry.id, { version, note, pkg }),
        );
      }
    }
  }

  const entries = await admin.season_week_view(season.id, season.week, 50n);
  for (const ballot of ballotsFor(week, entries, winners)) {
    const { canister } = await connect(canisterId, ballot.id, host, local);
    for (const entry of ballot.picks) {
      report(`${ballot.handle} votes ${entry.title}`, await canister.cast_vote(entry.id));
    }
  }

  console.log(`  left week ${week} open — the clock closes it, not the seed`);
}

/**
 * Two votes per judge, on two different entries, never their own.
 *
 * Qualifier weeks have a designated winner so the bracket fills with distinct
 * projects. The bracket rounds just back the ranked entries, with the second
 * judge splitting differently so nothing ends in a flat tie.
 */
function ballotsFor(week, entries, winners) {
  const pick = (title) => entries.find((e) => e.entry.title === title);
  const at = (i) => entries[i];
  const ids = (...views) =>
    views
      .filter(Boolean)
      .map((view) => ({ id: view.entry.id, title: view.entry.title }));

  if (week <= QUALIFIERS) {
    const winner = winners[week - 1];
    const runnerUp = winners[week % winners.length];
    const other = winners[(week + 1) % winners.length];
    return [
      { id: 20, handle: "alan", picks: ids(pick(winner), pick(runnerUp)) },
      { id: 21, handle: "katherine", picks: ids(pick(winner), pick(other)) },
    ];
  }
  // The final is two entries, so a judge spending both votes would tie it.
  // Voting is not compulsory (rules.md §4), so the second judge casts one.
  if (entries.length <= 2) {
    return [
      { id: 20, handle: "alan", picks: ids(at(0), at(1)) },
      { id: 21, handle: "katherine", picks: ids(at(0)) },
    ];
  }
  return [
    { id: 20, handle: "alan", picks: ids(at(0), at(1)) },
    { id: 21, handle: "katherine", picks: ids(at(0), at(2)) },
  ];
}

/** What the canister holds now, and what to do next. */
async function summarise(admin, args, canisterId) {
  const [counts, log] = await Promise.all([
    admin.stats(),
    admin.moderation_log([], 1n),
  ]);
  console.log(
    `\n${counts.users} users — ${counts.observers} observing, ${counts.hackers} hacking, ` +
      `${counts.judges} judging (${counts.pending} pending), ` +
      `${counts.sponsors} sponsoring (${counts.sponsorsPending} pending), ` +
      `${counts.moderators} moderating. ${log.total} logged action(s).`,
  );
  const live = await admin.season_running();
  if (live.length > 0) {
    // When the week turns over is the thing worth printing now that nobody can
    // bring it forward: it is the only answer to "when does the next one open".
    const [ends] = await admin.week_ends_at();
    console.log(
      `\nSeason ${live[0].number} is running — week ${live[0].week} of ${FINAL}` +
        (ends ? `, until ${new Date(Number(ends / 1_000_000n)).toISOString()}` : "") +
        ". The judges are frozen; judge changes are refused until it finishes." +
        "\nThe canister closes its own weeks. Once one has turned over, fill it with:" +
        "\n  npm run seed -- --advance",
    );
  } else {
    const draft = (await admin.seasons(10n)).find((row) => variant(row.phase) === "draft");
    if (draft) {
      console.log(`\nSeason ${draft.number} remains a draft at week 0.`);
      if (!args.season) printSealSteps(canisterId, args.environment);
    } else if (!args.season) {
    console.log("\nAdd a running season with entries and votes:\n  npm run seed -- --season");
    }
  }

  const pending = await admin.pending_judges(5n);
  // Suggesting this while a season runs would only produce a JudgesFrozen error.
  // A controller with no profile row still approves on its own — the two
  // moderators a judge otherwise needs are two *registered* moderators, and
  // `icp canister call` signs as the controller.
  if (pending.length > 0 && live.length === 0) {
    console.log("\nApprove a pending judge with:");
    for (const p of pending) {
      const expected = variant(p.judgeStatus);
      console.log(
        "  echo y | icp canister call hackathon set_judge " +
          `'(record { id = ${p.id} : nat64; expectedStatus = variant { ${expected} }; ` +
          `expectedUpdatedAt = ${p.updatedAt} : nat64 }, variant { approved }, null)'`,
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\nseed failed: ${error.message}`);
    process.exit(1);
  });
}
