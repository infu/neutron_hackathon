import { useCallback, useEffect, useState } from "react";

import * as api from "../api";
import type { CostOrder, User } from "../api";
import { Avatar } from "./Avatar";
import type { ConfirmRequest } from "./Confirm";

/**
 * Who is costing the canister most, and the two levers for when the answer is
 * "somebody deliberately".
 *
 * A canister pays for every instruction and every fixed storage slot, and both
 * are spent on somebody's behalf. The totals are cumulative for the whole event —
 * this is a record of who has been expensive, not a rate limiter, and resetting
 * it would erase the history a moderator is here to read.
 */
export function Cost({ ask }: { ask: (r: ConfirmRequest) => Promise<string | null> }) {
  const [order, setOrder] = useState<CostOrder>("instructions");
  const [rows, setRows] = useState<User[] | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [people, config] = await Promise.all([api.costliest(order), api.getConfig()]);
      setRows(people);
      setOpen(config.registrationOpen);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setRows([]);
    }
  }, [order]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (what: string, action: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mod-block">
      <h2>What people cost</h2>

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="control">
        <div>
          <strong>New registrations {open === false ? "are closed" : "are open"}</strong>
          <small className="muted">
            Not a switch anybody presses. The doors close when a season starts
            and open again when it finishes, so the field is fixed for the
            whole run.
          </small>
        </div>
      </div>

      <nav className="tabs" aria-label="Sort by">
        {(["instructions", "bytes"] as CostOrder[]).map((which) => (
          <button
            key={which}
            className={which === order ? "active" : undefined}
            onClick={() => setOrder(which)}
          >
            {which === "instructions" ? "Instructions" : "Storage allowance"}
          </button>
        ))}
      </nav>

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nobody has cost anything yet.</p>
      ) : (
        <ul className="cost-list">
          {rows.map((person) => (
            <li key={person.handle} className={person.frozen ? "frozen" : undefined}>
              <Avatar user={person} size={28} />
              <span className="cost-who">
                <strong>{person.displayName || person.handle}</strong>
                <small className="muted">@{person.handle}</small>
              </span>
              <span className="cost-figure">
                {order === "instructions"
                  ? compact(person.instructions)
                  : api.formatBytes(person.bytes)}
                <small className="muted">
                  {order === "instructions" ? "instructions" : "reserved slots"}
                </small>
              </span>
              {person.frozen ? <span className="badge frozen">frozen</span> : null}
              {/*
                Thaw only. Freezing is automatic — the meter does it when an
                account crosses its instruction allowance, which is a
                measurement rather than a judgement and needs no button. What a
                moderator needs is the other half: somebody's client had a bug,
                let them back in.
              */}
              {person.frozen ? (
                <button
                  className="btn small"
                  disabled={busy !== null}
                  onClick={async () => {
                    const reset = await ask({
                      title: `Let @${person.handle} write again?`,
                      body:
                        "They went over their instruction allowance for the season. " +
                        "Unfreezing without clearing what they have spent lasts one " +
                        "call — they are still over, so the next one freezes them again.",
                      confirm: "Unfreeze and reset their allowance",
                      tone: "default",
                    });
                    if (reset === null) return;
                    await run(person.handle, () => api.thawUser(person.handle, true));
                  }}
                >
                  {busy === person.handle ? "…" : "Unfreeze"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Instruction counts run to billions; nobody reads those digit by digit. */
function compact(n: bigint): string {
  const value = Number(n);
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}
