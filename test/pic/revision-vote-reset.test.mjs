import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { bootstrap, closeWeek, hacker, identity, ok, register } from "./harness.mjs";

const build = (key) => ({
  store: {
    key,
    contentType: "application/octet-stream",
    contentEncoding: "identity",
    chunks: 1n,
    content: new Uint8Array(64),
  },
});

const entry = (pkg, title) => ({
  title,
  summary: "",
  url: "",
  icon: [],
  shots: [],
  links: [],
  pkg: { key: pkg },
  slug: "lineage_reset",
});

const needsSecond = (result, what) => {
  assert.ok(
    "err" in result && "NeedsSecond" in result.err,
    `${what}: one reason-specific moderator vote must stay pending`,
  );
};

describe("revision approval invalidates stale takedown backing", () => {
  let env;

  after(async () => await env?.teardown());

  it("clears every exact reason on every copy of the edited lineage", async () => {
    env = await bootstrap();

    const modA = await register(env.as, identity(8_830), "reset_mod_a");
    const modB = await register(env.as, identity(8_831), "reset_mod_b");
    ok(await env.actor.set_moderator("reset_mod_a", true, []), "appoint first moderator");
    ok(await env.actor.set_moderator("reset_mod_b", true, []), "appoint second moderator");

    const author = await hacker(env, 8_832, "reset_author");
    const authorId = (await author.me())[0].id;
    const pkg = `/u/${authorId}/pkg/1.neutron`;
    ok(await author.my_upload(build(pkg)), "upload build");

    const draft = ok(await modA.create_season(), "create season");
    ok(await env.seal(), "seal canister");
    ok(await modA.start_season(draft.id), "start season");

    const firstRevision = ok(await author.submit_entry(entry(pkg, "Week One")), "submit week one");
    ok(await modA.approve_revision(firstRevision.id), "approve week one");
    const [weekOne] = await author.my_entry();
    assert.ok(weekOne, "week one copy exists");

    const weekTwoSeason = await closeWeek(env);
    assert.equal(weekTwoSeason.week, 2n, "the second qualifier is open");
    const secondRevision = ok(await author.submit_entry(entry(pkg, "Week Two")), "submit week two");
    ok(await modA.approve_revision(secondRevision.id), "approve week two");
    const [weekTwo] = await author.my_entry();
    assert.ok(weekTwo, "week two copy exists");

    const reasons = ["the published build is disputed", "the published artwork is disputed"];
    const copies = [weekOne, weekTwo];

    for (const copy of copies) {
      needsSecond(await modA.takedown_app(copy.id, reasons[0]), `first reason on entry ${copy.id}`);
      needsSecond(await modB.takedown_app(copy.id, reasons[1]), `second reason on entry ${copy.id}`);

      for (const reason of reasons) {
        const [tally] = await modA.takedown_tally(copy.id, [reason]);
        assert.equal(tally.votes, 1n, `entry ${copy.id} records one vote for ${reason}`);
      }
    }

    const edit = ok(
      await author.submit_entry(entry(pkg, "Week Two, revised")),
      "propose current content revision",
    );
    ok(await modA.approve_revision(edit.id), "approve current content revision");

    for (const copy of copies) {
      for (const reason of reasons) {
        const [tally] = await modA.takedown_tally(copy.id, [reason]);
        assert.equal(tally.votes, 0n, `entry ${copy.id} clears stale backing for ${reason}`);
        assert.equal(tally.mine, false, `entry ${copy.id} no longer treats the vote as mine`);
      }
    }
  });
});
