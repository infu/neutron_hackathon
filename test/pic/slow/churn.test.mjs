/**
 * Does the allocator actually reuse space, or does it just grow?
 *
 * Filling a store proves nothing about an allocator — every design looks the
 * same on the way up. What separates them is churn: replacing a file, deleting
 * one, swapping a build for a bigger build. A store that reserves fresh space
 * on every replace looks fine in a scale test and runs a canister out of stable
 * memory in a fortnight.
 *
 * So these all watch one number, `stableReserved`, across repeated replacement.
 * It may never fall — a region cannot shrink — but it must stop rising.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { bootstrap, identity, ok, register } from "../harness.mjs";

const KB = 1024;
const MiB = 1024 * KB;

/** A file of `size` bytes whose first byte is `mark`, so a mix-up is visible. */
const file = (key, size, mark, type = "image/png") => ({
  store: {
    key,
    content: Uint8Array.from({ length: size }, (_, i) => (i === 0 ? mark : 7)),
    contentType: type,
    contentEncoding: "identity",
    chunks: 1n,
  },
});

const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 100));
const mb = (n) => `${(Number(n) / MiB).toFixed(2)} MiB`;

async function mem(actor) {
  const m = await actor.memory();
  return {
    heap: Number(m.heap),
    reserved: Number(m.stableReserved),
    live: Number(m.stableLive),
    files: Number(m.files),
  };
}

describe("replacing a file over and over", () => {
  let env, hacker, id;

  before(async () => {
    env = await bootstrap();
    hacker = await register(env.as, identity(40500), "churner");
    ok(await hacker.set_hacker(true));
    id = (await hacker.me())[0].id;
  });
  after(async () => await env?.teardown());

  it("reserves no more after the first write", async () => {
    const key = `/u/${id}/shots/one.png`;
    ok(await hacker.my_upload(file(key, 300 * KB, 1)));
    const first = await mem(env.actor);

    // Twenty replacements of the same key. Each is a free-then-allocate, and
    // the freed slot must be the one the next write takes.
    for (let i = 2; i <= 21; i += 1) {
      ok(await hacker.my_upload(file(key, 300 * KB, i)), `replace ${i}`);
    }
    const after = await mem(env.actor);

    console.log(
      `\n  one 300 KB file replaced 20×: reserved ${mb(first.reserved)} → ${mb(after.reserved)}`,
    );
    assert.equal(
      after.reserved,
      first.reserved,
      "replacing must reuse the slot, not reserve another",
    );
    assert.equal(after.files, 1);
  });

  it("still serves the newest bytes, not a previous tenant's", async () => {
    // The cheap way to make `reserved` flat is to overwrite in place and get
    // the bookkeeping wrong. This is the check that says it did it properly.
    const key = `/u/${id}/shots/one.png`;
    ok(await hacker.my_upload(file(key, 300 * KB, 99)));
    const res = await env.actor.http_request({
      url: key,
      method: "GET",
      body: new Uint8Array(),
      headers: [],
      certificate_version: [],
    });
    assert.equal(res.status_code, 200);
    assert.equal(res.body.length, 300 * KB, "the whole file, not the slot");
    assert.equal(res.body[0], 99, "the newest bytes");
  });

  it("does not grow when a file is deleted and another takes its place", async () => {
    const a = `/u/${id}/shots/a.png`;
    const b = `/u/${id}/shots/b.png`;
    ok(await hacker.my_upload(file(a, 200 * KB, 1)));
    ok(await hacker.my_upload(file(b, 200 * KB, 2)));
    const two = await mem(env.actor);

    for (let i = 0; i < 10; i += 1) {
      ok(await hacker.my_upload({ delete: { key: b } }));
      ok(await hacker.my_upload(file(b, 200 * KB, 3)));
    }
    const after = await mem(env.actor);
    console.log(`  delete+recreate ×10: reserved ${mb(two.reserved)} → ${mb(after.reserved)}`);
    assert.equal(after.reserved, two.reserved, "the freed slot is taken back each time");
  });
});

describe("a build replaced every week, as a season really does", () => {
  let env, hackers;
  /// Per-round readings, shared because the heap claim below is about their
  /// *shape* and a single one of them proves nothing.
  let marks = [];
  const COUNT = 25;
  const ROUNDS = 6;

  before(async () => {
    env = await bootstrap();
    hackers = [];
    for (let i = 0; i < COUNT; i += 1) {
      const who = await register(env.as, identity(40600 + i), `ship_${i}`);
      ok(await who.set_hacker(true));
      hackers.push({ actor: who, id: (await who.me())[0].id });
    }
  });
  after(async () => await env?.teardown());

  it("holds steady across six rounds of new builds", async () => {
    marks = [];
    for (let round = 1; round <= ROUNDS; round += 1) {
      for (const h of hackers) {
        // Same key each round, which is what a hacker shipping a new build of
        // the same app does.
        ok(
          await h.actor.my_upload(
            file(`/u/${h.id}/pkg/1.neutron`, 1_500_000, round, "application/octet-stream"),
          ),
          `round ${round}`,
        );
      }
      marks.push({ round, ...(await mem(env.actor)) });
    }

    console.log(`\n  ${COUNT} hackers shipping a 1.5 MB build, ${ROUNDS} rounds:`);
    for (const m of marks) {
      console.log(
        `    round ${m.round}  reserved ${mb(m.reserved).padStart(10)}  ` +
          `live ${mb(m.live).padStart(10)}  heap ${mb(m.heap).padStart(10)}`,
      );
    }

    const first = marks[0];
    const last = marks[marks.length - 1];
    assert.equal(
      last.reserved,
      first.reserved,
      `${ROUNDS} rounds of replacement must not reserve more than one round`,
    );
    assert.equal(last.files, COUNT, "still one build each");

    // What the fixed slot costs: 2 MiB holding 1.5 MB.
    const waste = last.reserved - last.live;
    console.log(
      `    slot waste ${mb(waste)} of ${mb(last.reserved)} reserved — ${pct(waste, last.reserved)}%`,
    );
    assert.ok(waste > 0, "fixed slots always waste something; that is the trade");
    assert.ok(
      pct(waste, last.reserved) < 40,
      `slot waste is ${pct(waste, last.reserved)}% — the slot is too big for what it holds`,
    );
  });

  it("keeps the file bytes off the heap", async () => {
    // A single heap reading is not evidence, and this test used to rest on one.
    // `rts_heap_size` counts garbage not yet collected, so across the six rounds
    // above it swings by more than 100 MiB in both directions — and comparing
    // whichever value the last round happened to land on against half the bytes
    // written is a coin toss that only looks deterministic because PocketIC is.
    //
    // What *is* evidence is the shape of the series. Six rounds push 225 MB
    // through the store while only one round's worth is ever live, so a
    // heap-backed design would climb by the total and could never come down.
    // Two claims, then, and neither depends on where the collector happened to
    // be when the last sample was taken.
    const written = COUNT * 1_500_000 * ROUNDS;
    const heaps = marks.map((m) => m.heap);
    console.log(
      `    ${mb(written)} written over ${ROUNDS} rounds; heap ranged ` +
        `${mb(Math.min(...heaps))}–${mb(Math.max(...heaps))}, ` +
        `stable holds ${mb(marks[marks.length - 1].live)}`,
    );

    // It comes back down. Storage that never released would only ever rise.
    assert.ok(
      heaps.some((heap, i) => i > 0 && heap < heaps[i - 1]),
      `heap only ever rose (${heaps.map(mb).join(", ")}) — that is what heap-backed storage looks like`,
    );
    // And it never approaches the cumulative total, which is the other half of
    // the same claim: the bytes went to stable memory, not into the heap.
    assert.ok(
      Math.max(...heaps) < written,
      `heap peaked at ${mb(Math.max(...heaps))} of ${mb(written)} written — the bytes are on the heap`,
    );
    assert.ok(
      marks.every((m) => m.live > 0),
      "stable memory should report the bytes it holds",
    );
  });
});

describe("churn that crosses a size class", () => {
  let env, hacker, id;

  before(async () => {
    env = await bootstrap();
    hacker = await register(env.as, identity(40700), "grower");
    ok(await hacker.set_hacker(true));
    id = (await hacker.me())[0].id;
  });
  after(async () => await env?.teardown());

  it("strands the old class's slot, which is the cost of size classes", async () => {
    // A 50 KB icon replaced by a 350 KB one moves from the small class to the
    // image class. The small slot is freed but only another small file can use
    // it — that is inherent to size classes and worth measuring rather than
    // discovering later.
    const key = `/u/${id}/shots/moving.png`;
    ok(await hacker.my_upload(file(key, 50 * KB, 1)));
    const small = await mem(env.actor);

    ok(await hacker.my_upload(file(key, 350 * KB, 2)));
    const big = await mem(env.actor);

    console.log(
      `\n  50 KB → 350 KB: reserved ${mb(small.reserved)} → ${mb(big.reserved)} ` +
        `(the small slot is freed but idle)`,
    );
    assert.ok(big.reserved > small.reserved, "a bigger class had to be opened");

    // The freed small slot is genuinely reusable — by a small file.
    const before = await mem(env.actor);
    ok(await hacker.my_upload(file(`/u/${id}/icon/tiny.png`, 40 * KB, 3)));
    const after = await mem(env.actor);
    console.log(`  a small file then reuses it: reserved ${mb(before.reserved)} → ${mb(after.reserved)}`);
    assert.equal(after.reserved, before.reserved, "the stranded small slot was taken back");
  });
});
