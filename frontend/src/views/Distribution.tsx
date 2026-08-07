import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../api";
import type { ConfirmRequest } from "./Confirm";
import { formatAmount, knownToken } from "../tokens";
import { TokenLogo, useToken } from "./LedgerPicker";
import { Award } from "./Award";
import { Avatar } from "./Avatar";

export function fundingStatus(season: api.Season) {
  return {
    ready: season.fundingReady,
    attempts: Number(season.fundingAttempts),
    failures: season.fundingFailures,
  };
}

/** Final funding checks either settle or become an explicit failure record. */
export function FundingReconciliation({ season }: { season: api.Season }) {
  const funding = fundingStatus(season);
  const shown = funding.failures.slice(0, 12);
  const remaining = funding.failures.length - shown.length;
  const failures = shown.length > 0 ? (
    <ul className="funding-failures" aria-label="Recorded funding reconciliation failures">
      {shown.map((failure) => (
        <li key={failure.ledger.toText()}>
          <code>{failure.ledger.toText()}</code>
          <span>{failure.reason}</span>
        </li>
      ))}
      {remaining > 0 ? <li>And {remaining} more recorded failures.</li> : null}
    </ul>
  ) : null;

  if (funding.ready) {
    if (funding.failures.length > 0) {
      return (
        <div className="notice warn funding-status" role="status">
          <strong>Funding closed with recorded reconciliation failures.</strong>{" "}
          After {funding.attempts} completed {funding.attempts === 1 ? "check" : "checks"},
          an affected sponsor deposit check or final central pool read below had not completed.
          Already-swept balances on ledgers the final snapshot could reach still
          form the frozen payout; the canister does not guess a pool it could not
          observe.
          {failures}
        </div>
      );
    }
    if (funding.attempts <= 1) return null;
    return (
      <p className="muted small" role="status">
        Funding and the final pool snapshot reconciled after {funding.attempts} completed{" "}
        {funding.attempts === 1 ? "check" : "checks"}.
      </p>
    );
  }

  return (
    <div className="notice warn funding-status" role="status">
      <strong>Funding reconciliation is pending.</strong>{" "}
      New collections are closed. The canister is waiting for any collection already sent
      to a ledger, then rechecking sponsor deposits and the central prize pools. Unavailable
      reads retry normally once a minute. Persistent failures are recorded only after at
      least 15 complete checks and a complete check begun after the five-minute grace. A
      transfer already sent may take longer because repeating it could move the funds twice.
      {funding.attempts > 0 ? (
        <span>
          {" "}{funding.attempts} completed {funding.attempts === 1 ? "check" : "checks"} so far.
        </span>
      ) : null}
      {failures}
    </div>
  );
}

/**
 * Paying a finished season out.
 *
 * Final funding reconciliation atomically freezes every payout amount before
 * it records funding as ready. This screen only observes that result. Sending
 * normally runs from the canister's timer; Resume is the moderator recovery
 * path if an eligible send needs another attempt.
 *
 * Sending is resumable. If a run stops halfway the button comes back and picks
 * up what is left, re-sending identical arguments; the ledger's own
 * deduplication is what makes that safe rather than anything here.
 */
export function Distribution({
  ask,
}: {
  ask: (r: ConfirmRequest) => Promise<string | null>;
}) {
  const [seasons, setSeasons] = useState<api.Season[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [plan, setPlan] = useState<api.PayoutLine[]>([]);
  const [progress, setProgress] = useState<api.Progress | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loadRequest = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const all = await api.listSeasons();
        const finished = all.filter((season) => api.phaseOf(season) === "finished");
        setSeasons(finished);
        setPick((current) => current ?? finished[0]?.id.toString() ?? null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setSeasons([]);
      }
    })();
  }, []);

  const season = seasons?.find((s) => s.id.toString() === pick) ?? null;
  const selectedSeasonId = season?.id ?? null;
  const selectedSeasonKey = selectedSeasonId?.toString() ?? null;

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    if (selectedSeasonId === null || selectedSeasonKey === null) {
      setPlan([]);
      setProgress(null);
      setLoadedFor(null);
      return;
    }
    try {
      const [lines, made] = await Promise.all([
        api.payoutPlan(selectedSeasonId),
        api.payoutProgress(selectedSeasonId),
      ]);
      if (request !== loadRequest.current) return;
      setPlan(lines);
      setProgress(made);
      setLoadedFor(selectedSeasonKey);
    } catch (cause) {
      if (request === loadRequest.current) throw cause;
    }
  }, [selectedSeasonId, selectedSeasonKey]);

  useEffect(() => {
    let active = true;
    setError(null);
    void load().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
      loadRequest.current += 1;
    };
  }, [load]);

  // Re-reading the season list is what refreshes the phase badge — the phase
  // lives on the season row, not on the lines.
  const refresh = async () => {
    const all = await api.listSeasons();
    setSeasons(all.filter((s) => api.phaseOf(s) === "finished"));
    await load();
  };

  const act = async (what: string, action: () => Promise<unknown>, done: string) => {
    setBusy(what);
    setError(null);
    setNote(null);
    try {
      await action();
      await refresh();
      setNote(done);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  if (seasons === null) return <p className="muted">Loading…</p>;

  if (seasons.length === 0) {
    return (
      <div className="mod-block">
        <h2>Distribution</h2>
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        {!error ? (
          <p className="muted">
            No season has finished yet. Final close reconciles funding and freezes
            the distribution automatically once the awards are settled.
          </p>
        ) : null}
      </div>
    );
  }

  const phase = season ? api.payoutPhase(season) : "none";
  const funding = season ? fundingStatus(season) : null;
  const dataReady = selectedSeasonKey !== null && loadedFor === selectedSeasonKey;
  const shownPlan = dataReady ? plan : [];
  const shownProgress = dataReady ? progress : null;

  return (
    <div className="mod-block payout">
      <h2>
        Distribution
        <span className={`badge payout-${phase}`}>{PHASE_LABEL[phase]}</span>
      </h2>

      {seasons.length > 1 ? (
        <nav className="season-switch" aria-label="Finished seasons">
          <span className="season-switch-label">Season</span>
          {seasons.map((s) => (
            <button
              key={s.id.toString()}
              type="button"
              className={`season-chip${s.id.toString() === pick ? " on" : ""}`}
              onClick={() => setPick(s.id.toString())}
            >
              {Number(s.number)}
            </button>
          ))}
        </nav>
      ) : null}

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="notice ok">{note}</p> : null}

      {season ? <FundingReconciliation season={season} /> : null}

      {!dataReady && !error ? (
        <p className="muted small" role="status">Loading the payout record…</p>
      ) : null}

      {phase === "none" && funding?.ready ? (
        <div className="notice error" role="alert">
          <strong>The recorded payout state is incomplete.</strong>{" "}
          Funding is marked final, but no frozen payout result exists. This
          screen will not take a new ledger snapshot or draft a plan after the
          funding cutoff.
        </div>
      ) : null}

      <p className="muted small">{EXPLAIN[phase]}</p>

      {phase === "approved" || phase === "paying" ? (
        <div className="payout-actions">
          <button
            className="btn small"
            disabled={busy !== null || !dataReady}
            onClick={async () => {
              const left = shownProgress ? Number(shownProgress.left) : shownPlan.length;
              const ok = await ask({
                title:
                  phase === "approved" ? "Send the distribution?" : "Check payout progress?",
                body:
                  `Transfers ${left} payment${left === 1 ? "" : "s"}, one at a time. ` +
                  "Each payment goes to the winner's frozen wallet. Eligible retries run " +
                  "at most hourly, so a request during cooldown may only refresh progress. " +
                  "Every retry keeps the same frozen arguments.",
                confirm: phase === "approved" ? "Send it" : "Check now",
                tone: "danger",
              });
              if (ok === null) return;
              await act(
                "run",
                async () => {
                  const made = await api.runPayout(season!.id);
                  setProgress(made);
                },
                phase === "approved"
                  ? "Send request checked; progress refreshed."
                  : "Request checked; progress refreshed. The canister retries at most hourly and may defer this request during cooldown.",
              );
            }}
          >
            {busy === "run"
              ? "Sending…"
              : phase === "approved"
                ? "Send the distribution"
                : "Check / resume sending"}
          </button>
        </div>
      ) : null}

      {shownProgress && phase !== "none" ? <PayoutTally progress={shownProgress} /> : null}

      {season && shownPlan.length > 0 ? (
        <PayoutLines seasonId={season.id} lines={shownPlan} />
      ) : phase === "none" || !dataReady ? null : (
        <p className="muted small">No lines.</p>
      )}
    </div>
  );
}

const PHASE_LABEL: Record<api.PayoutPhase, string> = {
  none: "finalizing",
  proposed: "drafted",
  approved: "approved",
  paying: "part sent",
  paid: "sent",
  failed: "terminal failures",
};

const EXPLAIN: Record<api.PayoutPhase, string> = {
  none:
    "Final close collects deposits, takes one central pool snapshot, and freezes the payout " +
    "before funding is marked ready. There is no manual post-cutoff draft.",
  proposed:
    "This is a legacy frozen draft. Current final reconciliation writes an approved result atomically; no human or DAO controller approval is part of that payout step.",
  approved:
    "Frozen and ready to send. The canister normally starts automatically; this button is a safe manual fallback.",
  paying:
    "Partly sent. Eligible rows retry on the at-most-hourly schedule with identical " +
    "arguments, so the ledger collapses any duplicate. This control also refreshes progress; rows already failed are terminal.",
  paid: "Every payable line settled directly to its winner's frozen wallet.",
  failed:
    "Settlement is terminal because final funding reconciliation recorded a failure, one or more payout rows failed, or both. Reachable balances and paid rows remain visible; failed rows are retained for inspection and are not retryable.",
};

/**
 * How far the run got.
 *
 * Exported alongside the list: the season page shows the same four counters,
 * and a public "3 paid, 1 failed" that disagreed with the moderator's would be
 * worse than no count at all.
 */
export function PayoutTally({ progress }: { progress: api.Progress }) {
  const cells = [
    { key: "paid", label: "paid", value: Number(progress.paid) },
    { key: "left", label: "to send", value: Number(progress.left) },
    { key: "skipped", label: "skipped", value: Number(progress.skipped) },
    { key: "failed", label: "failed", value: Number(progress.failed) },
  ].filter((cell) => cell.value > 0 || cell.key === "paid" || cell.key === "left");

  return (
    <ul className="payout-tally">
      {cells.map((cell) => (
        <li key={cell.key} className={cell.key}>
          <strong>{cell.value}</strong>
          <small>{cell.label}</small>
        </li>
      ))}
    </ul>
  );
}

/** The app a payout was earned by, as the bracket knows it. */
type AppFace = { title: string; icon: string | null };

/**
 * Which app earned each payout, keyed by the immutable entry lineage id.
 *
 * Current payout rows carry `entry_id`, so two distinct app lineages owned by
 * the same hacker can earn the same cup without colliding here. The bracket is
 * read separately for display metadata only; a missing title never hides the
 * payment. A handle fallback remains solely for legacy rows migrated without
 * an entry id.
 */
function useSeasonApps(seasonId: bigint): Map<string, AppFace> {
  const [apps, setApps] = useState<Map<string, AppFace>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    setApps(new Map());
    void api
      .seasonMap(seasonId)
      .then((weeks) => {
        if (cancelled) return;
        const found = new Map<string, AppFace>();
        for (const week of weeks) {
          for (const view of week.entries) {
            const face = { title: view.entry.title, icon: view.entry.icon[0] ?? null };
            found.set(`entry:${view.entry.id}`, face);
            if (!found.has(`handle:${view.handle}`)) {
              found.set(`handle:${view.handle}`, face);
            }
          }
        }
        setApps(found);
      })
      .catch(() => {
        // The bracket being unreadable must not blank the money.
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  return apps;
}

/**
 * The distribution itself, a section per token.
 *
 * Grouped rather than listed flat because an amount means nothing away from its
 * ledger — two rows reading "500" are not comparable when one is ckBTC and the
 * other an SNS token, and each pool is split entirely on its own.
 *
 * Exported, and shown unchanged on the public season page. `payout_plan` is a
 * query anyone may call precisely so a distribution can be checked by the
 * people in it; two renderings of the same rows would be two things to keep
 * honest.
 */
export function PayoutLines({
  seasonId,
  lines,
}: {
  seasonId: bigint;
  lines: api.PayoutLine[];
}) {
  const apps = useSeasonApps(seasonId);
  const ledgers = [...new Set(lines.map((line) => line.ledger.toText()))];
  const carried = lines.some((line) => line.dust > 0n);
  const retried = lines.some((line) => Number(line.attempts) > 1);

  return (
    <>
      {ledgers.map((ledger) => (
        <LedgerLines
          key={ledger}
          ledger={ledger}
          apps={apps}
          lines={lines.filter((line) => line.ledger.toText() === ledger)}
        />
      ))}

      {/* Both of these read as faults and neither is one, so they are said
          once under the list rather than left to be guessed at from a column
          that has quietly gone up. */}
      {carried || retried ? (
        <p className="muted small">
          {carried
            ? "Exactly one row per token carries the pool's remainder. Splitting a pool " +
              "between winners divides unevenly, and handing the few units left over to " +
              "the largest payable share is how the treasury ends the season on zero. "
            : ""}
          {retried
            ? "Attempts record the bounded retry history. Eligible transient failures re-send " +
              "the same frozen arguments so the ledger collapses a duplicate instead of paying " +
              "twice; a row marked failed has stopped and will not be retried."
            : ""}
        </p>
      ) : null}
    </>
  );
}

function LedgerLines({
  ledger,
  lines,
  apps,
}: {
  ledger: string;
  lines: api.PayoutLine[];
  apps: Map<string, AppFace>;
}) {
  const meta = useToken(ledger);
  const known = knownToken(ledger);
  const symbol = meta?.symbol ?? known?.symbol ?? "…";
  const total = ledgerPoolTotal(lines);
  const show = (amount: bigint) =>
    meta ? formatAmount(amount, meta.decimals) : amount.toString();

  return (
    <section className="payout-ledger">
      <header>
        <TokenLogo id={ledger} meta={meta} symbol={symbol} />
        <strong>{symbol}</strong>
        <span className="muted small">
          {show(total)} across {lines.length} line{lines.length === 1 ? "" : "s"}
        </span>
        <code className="muted">{ledger}</code>
      </header>
      <ul className="payout-lines">
        {lines.map((line) => {
          const state = api.payoutState(line);
          const app =
            apps.get(`entry:${line.entry_id}`) ?? apps.get(`handle:${line.handle}`);
          // The destination is a bare principal with no subaccount, and that is
          // already the ICRC-1 textual form of such an account — the checksum
          // suffix only appears once a subaccount is involved. So this is the
          // address a wallet would show, not a shorthand for one.
          const to = line.to.toText();

          return (
            <li key={line.id.toString()} className={`payout-line ${state}`}>
              {app?.icon ? (
                <img className="avatar" style={ICON} src={app.icon} alt="" loading="lazy" />
              ) : (
                <Avatar
                  user={{ handle: line.handle, displayName: line.displayName, avatar: [] }}
                  size={28}
                />
              )}
              <span className="who">
                <strong>{app?.title || line.displayName || line.handle || "unknown"}</strong>
                <small className="muted">
                  {line.displayName || "unknown"}
                  {line.handle ? ` @${line.handle}` : ""}
                </small>
                <small className="muted" title={to}>
                  to <code>{to}</code>
                </small>
              </span>
              <Award medal={api.awardOf(line)} size={20} />
              <span className="amount">
                {show(line.net)}
                <small className="muted">
                  {show(line.gross)} less {show(line.fee)} fee
                </small>
              </span>
              <span className={`state ${state}`}>
                {state}
                {line.note ? <small className="muted">{line.note}</small> : null}
                {/* Read off `dust` rather than off the note that mentions it:
                    the note is cleared the moment the row is paid, and the one
                    row per token that is carrying the remainder is exactly the
                    thing somebody checking the arithmetic is looking for. */}
                {line.dust > 0n ? (
                  <small className="muted">+{show(line.dust)} remainder</small>
                ) : null}
                {Number(line.attempts) > 1 ? (
                  <small className="muted">{Number(line.attempts)} attempts</small>
                ) : null}
                {state === "paid" ? (
                  <small
                    className="muted"
                    title={`Memo ${memoOf(line.id)}, created at ${api.exactTime(line.createdAtTime)}`}
                  >
                    memo {memoOf(line.id)}
                  </small>
                ) : null}
                {/*
                  The ledger's own block index — the receipt. Everything else on
                  this row is the canister's account of what it did; this is the
                  number that lets somebody look the transfer up on the ledger
                  and check it independently. It was being discarded until now,
                  which left the payout list unverifiable by design.
                */}
                {line.block.length > 0 ? (
                  <small className="muted" title="The ledger's block index for this transfer">
                    block {String(line.block[0])}
                  </small>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The pool represented by one ledger's rows.
 *
 * Once a payable carrier has `dust`, its gross already includes the shares of
 * skipped rows. Counting those skipped gross amounts again would display more
 * than the ledger held. With no carrier (for example, every row is
 * uneconomic), the recorded skipped gross amounts are all the evidence left,
 * so they are summed normally.
 */
export function ledgerPoolTotal(lines: api.PayoutLine[]): bigint {
  const hasCarrier = lines.some((line) => line.dust > 0n);
  return lines.reduce(
    (sum, line) =>
      hasCarrier && api.payoutState(line) === "skipped" ? sum : sum + line.gross,
    0n,
  );
}

/** An app icon stands in for the avatar, so it is drawn at the same size. */
const ICON = { width: 28, height: 28 };

/**
 * How to find this row's transfer in the ledger's own log.
 *
 * Each successful row stores the ledger block index as its receipt. The memo
 * is the other stable lookup key: the payout row's id as eight big-endian
 * bytes, which keeps two otherwise identical transfers distinct. It is
 * derived from the id rather than stored beside it, so the two cannot drift.
 */
function memoOf(id: bigint): string {
  return `0x${id.toString(16).padStart(16, "0")}`;
}
