/**
 * What each participant costs, and the levers that stop one who costs too much.
 *
 * The counters are the sort of thing that looks right the moment you add it —
 * a number goes up — and is wrong in ways you only find by asking whether it
 * matches something independent. So these tests check the fixed-slot tally
 * against the asset store itself, and check that a *failed* call is charged,
 * not just a successful one.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { bootstrap, closeWeek, identity, ok, phaseOf, register, walletFor } from "./harness.mjs";

const store = (key, size, contentType = "image/png") => ({
  store: {
    key,
    content: new Uint8Array(size),
    contentType,
    contentEncoding: "identity",
    chunks: 1n,
  },
});

const SLOT = { small: 131_072n, image: 458_752n, build: 2_097_152n };

function slotCharge(size) {
  if (size <= 131_072n) return SLOT.small;
  if (size <= 458_752n) return SLOT.image;
  return SLOT.build;
}

/** Fixed-slot storage independently reconstructed from the served files. */
async function realStorage(actor, userId) {
  // User namespaces are intentionally omitted from the public asset listing.
  // Read the concrete fixture keys over the public HTTP path instead; that is
  // still independent of the profile counter and also proves deleted builds
  // are no longer served.
  const keys = [
    `/u/${userId}/avatar/big.png`,
    `/u/${userId}/icon/a.png`,
    `/u/${userId}/shots/b.png`,
    `/u/${userId}/pkg/1.neutron`,
    `/u/${userId}/pkg/2.neutron`,
    `/u/${userId}/pkg/9000.neutron`,
  ];
  let total = 0n;
  for (const url of keys) {
    const response = await actor.http_request({
      url,
      method: "GET",
      body: new Uint8Array(),
      headers: [],
      certificate_version: [],
    });
    if (response.status_code === 200) total += slotCharge(BigInt(response.body.byteLength));
  }
  return total;
}

describe("counting what a caller costs", () => {
  let env;
  let hacker;
  let id;

  before(async () => {
    env = await bootstrap();
    hacker = await register(env.as, identity(8000), "spender");
    // Nothing stands between registration and the role. One acceptance, taken
    // at signup, covers every role somebody later assumes — see agreement §3 on the Rules page,
    // where the role rules are part of the one agreement rather than a second
    // thing to tick.
    ok(await hacker.set_hacker(true));
    id = (await hacker.me())[0].id;
  });

  after(async () => {
    await env?.teardown();
  });

  it("charges the caller who made the call, and nobody else", async () => {
    const other = await register(env.as, identity(8001), "bystander");
    const before = (await hacker.me())[0].instructions;
    const idle = (await other.me())[0].instructions;

    // An edit carries the same acceptance a registration does — `terms` is a
    // field of the one profile record and `validate` runs on both paths, so
    // there is no way to write a profile that has agreed to nothing.
    ok(await hacker.update_profile({
      handle: "spender", displayName: "Spender", title: [], bio: "x", links: [],
      terms: true,
    }));

    assert.ok((await hacker.me())[0].instructions > before, "the caller is charged");
    assert.equal((await other.me())[0].instructions, idle, "nobody else is");
  });

  it("charges a call that fails as well as one that succeeds", async () => {
    // This is the case that matters: a flood of rejected calls costs the
    // canister exactly what a flood of accepted ones does, so a meter that
    // only counted successes would report nothing during an attack.
    const before = (await hacker.me())[0].instructions;
    const refused = await hacker.update_profile({
      handle: "bystander", displayName: "", title: [], bio: "", links: [],
      terms: true,
    });
    assert.ok("err" in refused, "taking a taken handle is refused");
    assert.ok(
      (await hacker.me())[0].instructions > before,
      "a refused call still costs instructions and must still be charged",
    );
  });

  it("only ever goes up", async () => {
    const before = (await hacker.me())[0].instructions;
    ok(await hacker.set_hacker(false));
    ok(await hacker.set_hacker(true));
    assert.ok((await hacker.me())[0].instructions > before);
  });
});

describe("counting what a caller stores", () => {
  let env;
  let hacker;
  let mod;
  let id;
  let draft;

  before(async () => {
    env = await bootstrap();
    hacker = await register(env.as, identity(8100), "hoarder");
    ok(await hacker.set_hacker(true));
    // Somewhere to be paid, or `submit_entry` never gets as far as the entry —
    // and this describe submits one to make the canister delete a build. Not
    // the principal they signed in with, which is what `walletFor` guarantees.
    ok(await hacker.set_wallet(walletFor(8100)));
    id = (await hacker.me())[0].id;
    // A real moderator, appointed here because this is the last moment there
    // will ever be somebody who can appoint one. `set_moderator` is
    // controller-only and the seal below removes the external controller,
    // so the flag on this profile row is the only moderation authority this
    // canister will have for the rest of its life.
    mod = await register(env.as, identity(8101), "hoardmod");
    ok(await env.actor.set_moderator("hoardmod", true, []), "appoint a moderator");

    // Readiness is checked before the irreversible seal, so the season must
    // already exist as an exact draft while controllers can still repair it.
    draft = ok(await mod.create_season(), "create the launch draft");

    // The point of no return, and the fixture's last controller action.
    // Everything a season needs has to be arranged before it: moderators
    // appointed, uploads done, the allowance set. Afterwards `set_config`,
    // `set_moderator`, `set_instruction_cap` and `assets_upload` are refused
    // for ever, and `Profiles.canModerate` stops treating the installer as a
    // moderator — which is why every approval below is `mod`'s.
    ok(await env.seal(), "seal");
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "the sealed canister keeps only itself as controller",
    );
  });

  after(async () => {
    await env?.teardown();
  });

  it("adds what an upload actually stored", async () => {
    ok(await hacker.my_upload(store(`/u/${id}/icon/a.png`, 4_000)));
    const row = (await hacker.me())[0].bytes;
    assert.equal(row, SLOT.small);
    assert.equal(row, await realStorage(env.actor, id), "and agrees with the allocator slots");
  });

  it("nets out a replacement rather than adding it twice", async () => {
    ok(await hacker.my_upload(store(`/u/${id}/icon/a.png`, 9_000)));
    const row = (await hacker.me())[0].bytes;
    assert.equal(row, SLOT.small, "a same-class replacement remains one small slot");
    assert.equal(row, await realStorage(env.actor, id));
  });

  it("gives the space back on delete", async () => {
    ok(await hacker.my_upload(store(`/u/${id}/shots/b.png`, 5_000)));
    assert.equal((await hacker.me())[0].bytes, 2n * SLOT.small);

    ok(await hacker.my_upload({ delete: { key: `/u/${id}/shots/b.png` } }));
    const row = (await hacker.me())[0].bytes;
    assert.equal(row, SLOT.small);
    assert.equal(row, await realStorage(env.actor, id), "still agrees with the store");
  });

  it("charges the 458,753-byte boundary as a 2 MiB build slot", async () => {
    const before = (await hacker.me())[0].bytes;
    const key = `/u/${id}/pkg/9000.neutron`;
    ok(await hacker.my_upload(store(key, 458_753, "application/octet-stream")));
    assert.equal((await hacker.me())[0].bytes, before + SLOT.build);
    assert.equal((await hacker.me())[0].bytes, await realStorage(env.actor, id));

    ok(await hacker.my_upload({ delete: { key } }));
    assert.equal((await hacker.me())[0].bytes, before, "delete returns the entire slot allowance");
  });

  it("stops build-shaped files at the account allowance, not the global reserve", async () => {
    const before = (await hacker.me())[0].bytes;
    const keys = [];
    for (let i = 0; i < 15; i += 1) {
      const key = `/u/${id}/pkg/${9100 + i}.neutron`;
      keys.push(key);
      ok(await hacker.my_upload(store(key, 458_753, "application/octet-stream")), `slot ${i + 1}`);
    }
    assert.equal((await hacker.me())[0].bytes, before + 15n * SLOT.build);
    const refused = await hacker.my_upload(
      store(`/u/${id}/pkg/9115.neutron`, 458_753, "application/octet-stream"),
    );
    assert.match(refused.err ?? "", /32 MB account storage allowance/);

    for (const key of keys) ok(await hacker.my_upload({ delete: { key } }));
    assert.equal((await hacker.me())[0].bytes, before, "all fifteen slot charges are reusable");
  });

  it("charges nothing for an upload that was refused", async () => {
    const before = (await hacker.me())[0].bytes;
    const tooBig = await hacker.my_upload(store(`/u/${id}/avatar/big.png`, 200_000));
    assert.ok("err" in tooBig, "200 KB is over the 100 KB avatar cap");
    assert.equal((await hacker.me())[0].bytes, before, "a refused upload stores nothing");
    assert.equal(before, await realStorage(env.actor, id));
  });

  it("still agrees with the store after a package is replaced", async () => {
    // publish_update deletes the build it replaces, which has to come off the
    // tally too — a path that runs inside the canister, not from my_upload.
    //
    // A moderator starts the draft prepared before the seal, because after the
    // seal the launch configuration is latched and nobody can draft another.
    ok(await mod.start_season(draft.id), "a moderator starts it, on a sealed canister");
    assert.equal(await env.actor.am_moderator(), false, "the installer moderates nothing");
    assert.deepEqual(
      await env.actor.create_season(),
      { err: { NotAllowed: null } },
      "and cannot draft a season either",
    );

    // An entry carries a package now, so the build has to be uploaded before
    // the entry can be proposed at all. The app id is chosen here and never
    // moves; it is what the download ends up called, not the upload key.
    ok(await hacker.my_upload(store(`/u/${id}/pkg/1.neutron`, 30_000, "application/octet-stream")));
    const entry = ok(await hacker.submit_entry({
      title: "Hoard", summary: "", url: "", icon: [], shots: [], links: [],
      slug: "hoarder_app",
      pkg: { key: `/u/${id}/pkg/1.neutron` },
    }));
    // Proposals only reach the bracket once a moderator agrees, and that means
    // somebody carrying the flag on their profile row — the one authority a
    // sealed canister can never hand out again.
    assert.deepEqual(
      await env.actor.approve_revision(entry.id),
      { err: { NotAllowed: null } },
      "and cannot approve its way into the bracket either",
    );
    ok(await mod.approve_revision(entry.id));
    const [current] = await hacker.my_entry();
    assert.ok(current, "the approved app is the exact version target");

    const first = ok(await hacker.publish_update(current.id, {
      version: "0.1", note: "first", pkg: [{ key: `/u/${id}/pkg/1.neutron` }],
    }));
    ok(await mod.approve_revision(first.id));

    ok(await hacker.my_upload(store(`/u/${id}/pkg/2.neutron`, 12_000, "application/octet-stream")));
    const second = ok(await hacker.publish_update(current.id, {
      version: "0.2", note: "second", pkg: [{ key: `/u/${id}/pkg/2.neutron` }],
    }));
    ok(await mod.approve_revision(second.id));

    assert.equal(
      (await hacker.me())[0].bytes,
      await realStorage(env.actor, id),
      "the tally follows the store when the canister deletes a replaced build",
    );
  });
});

describe("ordinary avatar replacement headroom", () => {
  let env;

  before(async () => {
    env = await bootstrap();
  });

  after(async () => {
    await env?.teardown();
  });

  it("holds the old and new small slots until the profile swap cleans up", async () => {
    const observer = await register(env.as, identity(8150), "portrait");
    const id = (await observer.me())[0].id;
    const old = `/u/${id}/avatar/old.png`;
    const fresh = `/u/${id}/avatar/fresh.png`;

    ok(await observer.my_upload(store(old, 1_000)));
    ok(await observer.set_avatar([old]));
    ok(await observer.my_upload(store(fresh, 1_000)), "the second small slot is replacement headroom");
    assert.equal((await observer.me())[0].bytes, 2n * SLOT.small);

    ok(await observer.set_avatar([fresh]));
    assert.equal((await observer.me())[0].bytes, SLOT.small, "the displaced avatar slot is returned");
  });
});

describe("freezing", () => {
  let env;
  let victim;
  let id;

  before(async () => {
    env = await bootstrap();
    victim = await register(env.as, identity(8200), "frosty");
    ok(await victim.set_hacker(true));
    id = (await victim.me())[0].id;
    // Nobody freezes anybody by hand any more — there is no `set_frozen`.
    // Freezing is what the meter does, in the same write that records a call's
    // spend, when an account crosses `instructionCap`. So the way to get a
    // frozen account is to set an allowance nothing fits under and let this
    // one make a call: the call that crosses the line still finishes, because
    // refusing work already done would charge for it and throw it away, and
    // the freeze applies from the next one.
    ok(await env.actor.set_instruction_cap(1n));
    ok(await victim.set_hacker(true), "the call that spends the allowance still runs");
    // Nothing after this line: the point of the call above is that it is the
    // one that crosses the allowance, so everything from here is refused.
    assert.equal((await victim.me())[0].frozen, true, "and leaves them frozen behind it");
  });

  after(async () => {
    await env?.teardown();
  });

  /**
   * Every update a participant can reach. A method added later that forgets
   * the guard shows up here as a call that went through while frozen — which
   * is the whole point of listing them rather than spot-checking three.
   */
  it("refuses every update a participant can reach", async () => {
    const blank = {
      handle: "frosty", displayName: "F", title: [], bio: "", links: [],
      terms: true,
    };
    const attempts = {
      update_profile: () => victim.update_profile(blank),
      set_hacker: () => victim.set_hacker(false),
      apply_as_judge: () => victim.apply_as_judge(),
      // Every entry here must be refused for being frozen rather than for
      // anything else, which is what makes the table a guard check rather than
      // a collection of unrelated refusals. `Meter.open` runs first in every
      // one of these methods, so nothing further along ever gets a chance to
      // answer — that ordering is the property under test.
      apply_as_sponsor: () =>
        victim.apply_as_sponsor({ org: "X", website: "", logo: [], blurb: "b", ledgers: [] }),
      withdraw_sponsor: () => victim.withdraw_sponsor(),
      set_avatar: () => victim.set_avatar([`/u/${id}/avatar/a.png`]),
      my_upload: () => victim.my_upload(store(`/u/${id}/icon/a.png`, 100)),
      submit_entry: () =>
        victim.submit_entry({
          title: "T", summary: "", url: "", icon: [], shots: [], links: [],
          slug: "frosty_app",
          pkg: { key: `/u/${id}/pkg/1.neutron` },
        }),
      cast_vote: () => victim.cast_vote(1n),
      withdraw_vote: () => victim.withdraw_vote(1n),
      publish_update: () => victim.publish_update(0n, { version: "1", note: "n", pkg: [] }),
      notify_deposits: () => victim.notify_deposits(),
      notify_deposit: () => victim.notify_deposit(env.canisterId),
      withdraw: () =>
        victim.withdraw(env.canisterId, { owner: env.canisterId, subaccount: [] }),
    };

    const leaked = [];
    for (const [name, call] of Object.entries(attempts)) {
      const res = await call();
      if (!("err" in res)) leaked.push(`${name} was ACCEPTED`);
      else if (!JSON.stringify(res.err).includes("rozen")) {
        leaked.push(`${name} refused for another reason: ${JSON.stringify(res.err)}`);
      }
    }
    assert.deepEqual(leaked, [], "a frozen account must not change anything");
  });

  it("leaves reading alone", async () => {
    assert.ok((await victim.me()).length, "their profile is still theirs to read");
    assert.ok((await victim.my_votes_left()) >= 0n);
    assert.ok(Array.isArray(await victim.seasons(5n)));
  });

  it("costs them nothing more, because nothing runs", async () => {
    const before = (await victim.me())[0].instructions;
    await victim.update_profile({
      handle: "frosty", displayName: "F", title: [], bio: "", links: [],
      terms: true,
    });
    assert.equal(
      (await victim.me())[0].instructions,
      before,
      "a refused-at-the-door call does no work to charge",
    );
  });

  it("thaws", async () => {
    // A moderator gets one half of this and not the other: the meter freezes,
    // they let somebody back in. `reset` hands the spend back too, and without
    // it a thaw lasts exactly one call — the account is still over the line,
    // so the next `close` puts it back. Lifting the cap (0 means no cap at
    // all) is what makes this one stick.
    ok(await env.actor.set_instruction_cap(0n));
    ok(await env.actor.thaw_user("frosty", true));
    assert.equal((await victim.me())[0].instructions, 0n, "reset gives the allowance back");

    ok(await victim.update_profile({
      handle: "frosty", displayName: "Frosty", title: [], bio: "back", links: [],
      terms: true,
    }));
    assert.equal((await victim.me())[0].frozen, false, "and they stay writable");
  });

  it("never freezes a moderator, however much they spend", async () => {
    // The rule outlived the mechanism. It used to be a refusal on the way in —
    // a moderator could not be frozen by hand — and it is now the meter
    // skipping them when it decides who is over budget, for the same reason:
    // one runaway script in a moderator's client would take the event's
    // moderation offline, and there is nobody left to thaw them.
    ok(await env.actor.set_moderator("frosty", true, []));
    ok(await env.actor.set_instruction_cap(1n));

    const edit = {
      handle: "frosty", displayName: "Frosty", title: [], bio: "moderating", links: [],
      terms: true,
    };
    ok(await victim.update_profile(edit));
    assert.equal((await victim.me())[0].frozen, false, "over the cap and still not frozen");
    ok(await victim.update_profile(edit), "and the call after it goes through too");
  });

  it("is a moderator's and a controller's lever, not anyone's", async () => {
    const stranger = await register(env.as, identity(8201), "nosy");
    // Thawing is moderation; the allowance everybody is held to is a
    // controller's setting, because it is policy for the whole event. Which is
    // also why it has to be decided before the canister is sealed — sealing
    // removes the external controller that could change it — and why this
    // suite deliberately never seals.
    assert.deepEqual(await stranger.thaw_user("nosy", false), { err: "not allowed" });
    assert.deepEqual(
      await stranger.set_instruction_cap(1n),
      { err: "caller is not a controller" },
    );
  });
});

describe("closing registrations", () => {
  let env;
  let mod;

  before(async () => {
    env = await bootstrap();
    // Appointed while there is still somebody who can appoint: `set_moderator`
    // is controller-only and this suite seals below. A moderator is also the
    // only caller who can draft or start a season afterwards, so a fixture that
    // forgot this one would have a canister nobody could ever run a season on.
    mod = await register(env.as, identity(8302), "doorman");
    ok(await env.actor.set_moderator("doorman", true, []), "appoint a moderator");
  });

  after(async () => {
    await env?.teardown();
  });

  /**
   * Registration is closed deliberately before the irreversible seal. Launch
   * readiness refuses both sealing and starting while it remains open, so the
   * field is fixed before nobody can repair the configuration.
   */
  it("turns newcomers away before sealing and permanently thereafter", async () => {
    const existing = await register(env.as, identity(8300), "already");
    const late = {
      handle: "late", displayName: "L", title: [], bio: "", links: [],
      terms: true,
    };

    const draft = ok(await mod.create_season());

    // Complete the same launch checklist `seal` uses. This adds only missing
    // governance seats, settles applications, and closes registration.
    await env.prepareLaunch();
    const newcomer = env.as(identity(8301));
    assert.deepEqual(
      await newcomer.register(late),
      { err: { Closed: null } },
      "registration has to be closed before the point of no return",
    );

    // Nothing starts while somebody still holds the keys. A season begun with
    // a controller outstanding is one whose code, frontend and settings could
    // be rewritten halfway through, and from outside it would look identical
    // to one that could not — so `start_season` asks the management canister
    // rather than assuming, on every start.
    const unsealed = await mod.start_season(draft.id);
    assert.ok("Invalid" in (unsealed.err ?? {}), `unsealed start: ${JSON.stringify(unsealed)}`);
    const stillHeld = await env.pic.getControllers(env.canisterId);
    assert.ok(stillHeld.length > 0, "because there are still controllers");

    // The one-way door. Everything the event needs is already arranged, and
    // from here the only authority that exists is what the installed code
    // grants.
    ok(await env.seal(), "seal");
    const held = await env.pic.getControllers(env.canisterId);
    assert.deepEqual(
      held.map((who) => who.toText()),
      [env.canisterId.toText()],
      "a participant can verify the exact self-only controller list",
    );

    ok(await mod.start_season(draft.id), "start the sealed, ready draft");

    assert.deepEqual(await newcomer.register(late), { err: { Closed: null } });
    ok(
      await existing.update_profile({
        handle: "already", displayName: "Already", title: [], bio: "fine", links: [],
        terms: true,
      }),
      "somebody already registered is unaffected",
    );

    // And there is no lever to open them again — not for the account that
    // installed the canister, not for anybody, not ever. `set_config` is
    // controller-gated and the external controller is removed for good, so this
    // refusal outlives the season rather than lasting six weeks.
    assert.deepEqual(
      await env.actor.set_config("Neutron", true),
      { err: "caller is not a controller" },
    );
    // Nor is there a way to install code that would open them. An upgrade is a
    // controller's call to the management canister, and the replica has nobody
    // left to accept one from — so this fails at the replica, before any of
    // this canister's own code is consulted.
    //
    // The reason is checked, not just the failure: an `install_code` refused
    // for anything else — the replica rate-limits them for minutes after an
    // install — would make a bare `rejects` pass on an unsealed canister too,
    // which is the opposite of what this line is here to say.
    await assert.rejects(
      env.upgrade(),
      (err) => /Only controllers|InvalidController/.test(String(err)),
      "a sealed canister can never be upgraded, and not for some passing reason",
    );

    let season;
    for (let week = 1; week <= 6; week += 1) season = await closeWeek(env);
    assert.equal(phaseOf(season), "finished", "the season has to be over, not merely late");

    assert.deepEqual(
      await newcomer.register(late),
      { err: { Closed: null } },
      "registration never reopens after the one allowed season",
    );
  });
});

describe("the moderator's cost table", () => {
  let env;

  before(async () => {
    env = await bootstrap();
  });

  after(async () => {
    await env?.teardown();
  });

  it("sorts by each measure, most expensive first", async () => {
    const people = [];
    for (let i = 0; i < 4; i += 1) {
      const a = await register(env.as, identity(8400 + i), `cost_${i}`);
      ok(await a.set_hacker(true), "app asset storage is reserved for hackers");
      // Increasing work, and increasing storage, in opposite orders — so a
      // table that sorted by the wrong column would still look plausible.
      for (let n = 0; n <= i; n += 1) {
        ok(await a.update_profile({
          handle: `cost_${i}`, displayName: `C${n}`, title: [], bio: "", links: [],
          terms: true,
        }));
      }
      const id = (await a.me())[0].id;
      for (let file = 0; file < 4 - i; file += 1) {
        ok(await a.my_upload(store(`/u/${id}/icon/${file}.png`, 1_000)));
      }
      people.push(a);
    }

    const byWork = await env.actor.costliest({ instructions: null }, 10n);
    const work = byWork.map((u) => u.instructions);
    assert.deepEqual([...work].sort((a, b) => (b > a ? 1 : -1)), work, "descending by instructions");

    const bySize = await env.actor.costliest({ bytes: null }, 10n);
    const size = bySize.map((u) => u.bytes);
    assert.deepEqual([...size].sort((a, b) => (b > a ? 1 : -1)), size, "descending by bytes");
    assert.equal(bySize[0].handle, "cost_0", "cost_0 stored the most");
  });

  it("is not a public list", async () => {
    const stranger = await register(env.as, identity(8450), "curious");
    assert.deepEqual(await stranger.costliest({ instructions: null }, 10n), []);
  });
});
