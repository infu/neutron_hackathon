import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { MINUTE, bootstrap, identity, ok, register } from "./harness.mjs";

const NEUTRINITE_DAO = "extk7-gaaaa-aaaaq-aacda-cai";

/** Read PocketIC's controller list in the same plain-text form as the rules. */
async function controllers(env) {
  const held = await env.pic.getControllers(env.canisterId);
  return held.map((principal) => principal.toText());
}

describe("sealed controller recovery", () => {
  let env;

  after(async () => await env?.teardown());

  it("keeps only itself, then adds only the fixed DAO after three distinct moderator approvals", async () => {
    env = await bootstrap();

    const moderators = [];
    for (let index = 0; index < 3; index += 1) {
      const handle = `recovery_mod_${index}`;
      const moderator = await register(env.as, identity(8_900 + index), handle);
      ok(await env.actor.set_moderator(handle, true, []), `appoint ${handle}`);
      ok(await moderator.apply_as_judge(), `${handle} applies as judge`);
      ok(await env.actor.set_judge(handle, { approved: null }, []), `approve ${handle} as judge`);
      moderators.push(moderator);
    }
    const outsider = await register(env.as, identity(8_903), "recovery_outsider");
    const agentIdentity = identity(8_904);
    ok(
      await moderators[0].set_agent([agentIdentity.getPrincipal()]),
      "nominate a moderator agent",
    );
    const moderatorAgent = env.as(agentIdentity);

    const draft = ok(await moderators[0].create_season(), "create season");
    ok(await env.seal(), "seal canister");

    const self = env.canisterId.toText();
    assert.deepEqual(
      await controllers(env),
      [self],
      "the seal removes the installer but deliberately keeps the canister itself",
    );

    // Clear the replica's install-code rate limit so this proves authorization,
    // rather than merely observing the cooldown that follows installation.
    await env.advance(30 * MINUTE);
    await assert.rejects(
      () => env.upgrade(),
      /Only (?:the )?controllers/,
      "the old installer cannot upgrade a self-controlled sealed canister",
    );
    assert.deepEqual(await controllers(env), [self], "the refused upgrade changes no settings");

    ok(await moderators[0].start_season(draft.id), "start sealed season");

    assert.deepEqual(
      await outsider.controller_recovery_tally(),
      [],
      "a non-moderator cannot inspect the private approval tally",
    );
    assert.deepEqual(
      await outsider.recover_canister(),
      { err: "not allowed" },
      "a non-moderator cannot approve controller recovery",
    );
    assert.deepEqual(
      await moderatorAgent.recover_canister(),
      { err: "not allowed" },
      "a moderator's delegated agent cannot grant controller authority",
    );

    assert.deepEqual(
      ok(await moderators[0].recover_canister(), "first recovery approval"),
      { votes: 1n, needed: 3n, mine: true, recovered: false },
    );
    assert.deepEqual(
      ok(await moderators[0].recover_canister(), "duplicate recovery approval"),
      { votes: 1n, needed: 3n, mine: true, recovered: false },
      "repeating one moderator's approval must not advance the quorum",
    );
    assert.deepEqual(await controllers(env), [self], "one moderator cannot end the seal");

    assert.deepEqual(
      ok(await moderators[1].recover_canister(), "second recovery approval"),
      { votes: 2n, needed: 3n, mine: true, recovered: false },
    );
    assert.deepEqual(await controllers(env), [self], "two moderators cannot end the seal");

    assert.deepEqual(
      ok(await moderators[2].recover_canister(), "third recovery approval"),
      { votes: 3n, needed: 3n, mine: true, recovered: true },
    );
    assert.deepEqual(
      (await controllers(env)).toSorted(),
      [self, NEUTRINITE_DAO].toSorted(),
      "the third approval adds exactly the canister and the fixed Neutrinite DAO",
    );

    assert.deepEqual(
      ok(await moderators[0].recover_canister(), "repeat recovered call"),
      { votes: 3n, needed: 3n, mine: true, recovered: true },
      "recovery is idempotent once the DAO is present",
    );
    assert.deepEqual(
      (await controllers(env)).toSorted(),
      [self, NEUTRINITE_DAO].toSorted(),
      "an idempotent retry cannot add or replace a controller",
    );
  });
});
