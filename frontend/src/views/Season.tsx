import { useCallback, useEffect, useId, useRef, useState } from "react";

import * as api from "../api";
import { networkNow, syncNetworkClock } from "../ic";
import type { PublicUser, Season as SeasonRow, SeasonEntry, SeasonView, User } from "../api";
import { Award } from "./Award";
import { FundingReconciliation, PayoutLines, PayoutTally } from "./Distribution";
import { TokenPill } from "./LedgerPicker";
import { EntryModal } from "./EntryModal";
import { Popout, SeasonMap } from "./SeasonMap";

const ENTRY_PAGE_SIZE = 200;

/**
 * One local timer, driven by the deadline already returned with the season.
 *
 * Each tick is scheduled at the next displayed-second boundary and recomputes
 * from the last explicitly synchronized network time, so background-tab
 * throttling cannot accumulate drift and a time-shifted local PocketIC still
 * reads correctly. It deliberately stops at zero and never calls the backend;
 * refreshing remains an explicit, bounded action beside the clock.
 */
function useDeadlineNow(deadlineMs: number | null): number {
  const [now, setNow] = useState(() => networkNow());

  useEffect(() => {
    if (deadlineMs === null) return;
    let timer: number | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const current = networkNow();
      setNow(current);
      const left = deadlineMs - current;
      if (left <= 0) return;

      // `ceil(left / 1000)` changes when the millisecond remainder reaches
      // zero. Aim at that boundary, then continue once per second.
      const remainder = left % 1000;
      timer = window.setTimeout(tick, remainder === 0 ? 1000 : remainder);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [deadlineMs]);

  return now;
}

function formatCountdown(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}

/**
 * The competition itself: one week at a time.
 *
 * Weeks 1–4 are qualifiers you submit into; 5 and 6 are carried forward, so
 * they are read-only by construction — nothing here has to enforce that, the
 * backend refuses and the form simply isn't offered.
 *
 * The format is written down on the Rules page; this page is only its display.
 */
export function Season({ me, number }: { me: User | null; number: number | null }) {
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [season, setSeason] = useState<SeasonRow | null>(null);
  const [mine, setMine] = useState<SeasonEntry[]>([]);
  const [votesLeft, setVotesLeft] = useState(0);
  const [openWeek, setOpenWeek] = useState<SeasonView[]>([]);
  const [openWeekNext, setOpenWeekNext] = useState<bigint | null>(null);
  const [openWeekTotal, setOpenWeekTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReloadKey, setMapReloadKey] = useState(0);
  const [refreshingMap, setRefreshingMap] = useState(false);
  const loadRequest = useRef(0);
  const pageRequest = useRef(0);

  const load = useCallback(async (refreshClock = false) => {
    const request = ++loadRequest.current;
    pageRequest.current += 1;
    setLoadingMore(false);
    try {
      if (refreshClock) await syncNetworkClock();
      const all = await api.listSeasons();
      // No number in the URL means "whatever is current"; a number pins a
      // past season, which is read-only wherever it matters.
      const viewed =
        (number === null
          ? (all.find((s) => api.phaseOf(s) === "running") ?? all[0])
          : all.find((s) => Number(s.number) === number)) ?? null;

      // Entry and votes are only meaningful for the season actually running.
      const live = viewed !== null && api.phaseOf(viewed) === "running";
      const [own, left, weekPage] = await Promise.all([
        me && live ? api.myEntries() : Promise.resolve([] as SeasonEntry[]),
        me && live ? api.myVotesLeft() : Promise.resolve(0),
        // The open week's entries, so a judge can be shown exactly what is
        // still waiting on them rather than having to hunt the bracket.
        viewed && live
          ? api.weekEntriesPage(viewed.id, Number(viewed.week), null, ENTRY_PAGE_SIZE)
          : Promise.resolve({ rows: [], next: null, total: 0 } as api.SeasonWeekPage),
      ]);
      if (request !== loadRequest.current) return;
      setSeasons(all);
      setSeason(viewed);
      setMine(own);
      setVotesLeft(left);
      setOpenWeek(weekPage.rows);
      setOpenWeekNext(weekPage.next);
      setOpenWeekTotal(weekPage.total);
      setLoadingMore(false);
      setError(null);
    } catch (cause) {
      if (request !== loadRequest.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [me, number]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(
    () => () => {
      loadRequest.current += 1;
      pageRequest.current += 1;
    },
    [],
  );

  const deadlineMs =
    season && api.phaseOf(season) === "running"
      ? (api.deadlineFor(season, Number(season.week))?.getTime() ?? null)
      : null;
  const clockNow = useDeadlineNow(deadlineMs);
  const withdrawalsLocked =
    deadlineMs !== null && deadlineMs - clockNow <= api.VOTE_WITHDRAWAL_LOCK_MS;

  if (loading) return <p className="muted">Loading…</p>;

  if (!season) {
    // The page, not a sentence where the page should be. Somebody arriving
    // before the first season still wants to know what the prize pool holds,
    // who is sponsoring it and how the season works — an empty screen
    // answers none of that and reads as something being broken.
    return (
      <section className="season">
        {seasons.length > 0 ? <SeasonSwitcher seasons={seasons} viewing={null} /> : null}

        {error ? (
          <div className="notice error" role="alert">
            <p>Could not load the season: {error}</p>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                setLoading(true);
                void load(true);
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="notice" role="status">
            {number === null ? (
              <>
                <strong>No season is running.</strong> When one opens, the whole
                bracket below fills in — the whole season on one screen.
              </>
            ) : (
              <>
                <strong>There is no season {number}.</strong> Pick one above, or
                use the separately configured canister for another season.
              </>
            )}
          </p>
        )}

        <TreasuryPanel />

        {/* Empty, but drawn. The shape is what somebody arriving early came to
            understand — four qualifier weeks, five places each, two duels and
            a final —
            and it is the same shape whether or not anybody has entered. */}
        <SeasonMap
          season={null}
          liveWeek={0}
          canVote={false}
          votesLeft={0}
          withdrawalsLocked={false}
          reloadKey={0}
          onVoted={load}
        />

        <Sponsors />
      </section>
    );
  }

  const phase = api.phaseOf(season);
  const liveWeek = Number(season.week);
  const judging = me ? api.judgeState(me) === "approved" : false;
  const qualifierOpen = phase === "running" && api.isQualifier(liveWeek);
  const editableMine = mine.filter((entry) => !api.takenDown(entry));
  const exactMine = editableMine.length === 1 ? editableMine[0] : null;
  const canManage =
    (Boolean(me?.hacker) && qualifierOpen) ||
    (phase === "running" && editableMine.length > 0);

  const refreshBracket = async () => {
    if (refreshingMap) return;
    setRefreshingMap(true);
    try {
      // Refresh the surrounding season state as well as the map. At a round
      // boundary that replaces the expired deadline with the next round's;
      // between boundaries it also keeps this judge's queue and allowance in
      // step with the newly fetched tallies.
      await load(true);
      setMapReloadKey((key) => key + 1);
    } finally {
      setRefreshingMap(false);
    }
  };

  const loadMore = async () => {
    if (openWeekNext === null || loadingMore || phase !== "running") return;
    const request = ++pageRequest.current;
    const seasonId = season.id;
    const week = liveWeek;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.weekEntriesPage(
        seasonId,
        week,
        openWeekNext,
        ENTRY_PAGE_SIZE,
      );
      if (request !== pageRequest.current) return;
      setOpenWeek((current) => {
        const seen = new Set(current.map((view) => view.entry.id));
        return [...current, ...page.rows.filter((view) => !seen.has(view.entry.id))];
      });
      setOpenWeekNext(page.next);
      setOpenWeekTotal(page.total);
    } catch (cause) {
      if (request === pageRequest.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (request === pageRequest.current) setLoadingMore(false);
    }
  };

  return (
    <section className="season">
      <SeasonSwitcher seasons={seasons} viewing={season} />

      {phase === "draft" ? (
        <p className="season-draft-note" role="status">
          <strong>Season {Number(season.number)} has not started yet.</strong>{" "}
          The bracket below is empty until week 1 opens, and nothing can be
          submitted or judged before then. Sponsors can apply and prepare
          enabled ledgers now; deposit addresses and funding open at the start.
        </p>
      ) : null}

      <SeasonBar season={season} phase={phase} liveWeek={liveWeek} />

      <TreasuryPanel />

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      {canManage ? (
        <div className="my-entry">
          <div>
            <strong>
              {exactMine
                ? exactMine.title
                : editableMine.length > 1
                  ? `${editableMine.length} apps active`
                  : `Submit for ${api.weekName(liveWeek)}`}
            </strong>
            <small className="muted">
              {qualifierOpen
                ? "App details, images, links, and packages are managed together in Your apps."
                : "Publish this round's version and package from Your apps."}
            </small>
          </div>
          <a
            className="btn small"
            href={exactMine ? `#/profile/entries/${exactMine.id}` : "#/profile/entries"}
          >
            {qualifierOpen
              ? (exactMine ? "Edit app" : "Submit app")
              : "Publish update"}
          </a>
        </div>
      ) : null}

      {/* For everybody, not just judges. The week's apps are the season's
          public face — an observer deciding whether to enter, a sponsor
          deciding whether to fund and a hacker sizing up the competition all
          want this list, and it was previously drawn only for approved
          judges, so most visitors saw a bracket and nothing else. `canVote`
          still decides whether the cards carry a button. */}
      {phase === "running" ? (
        <ToVote
          entries={openWeek}
          total={openWeekTotal}
          hasMore={openWeekNext !== null}
          loadingMore={loadingMore}
          votesLeft={votesLeft}
          week={liveWeek}
          season={season}
          canVote={judging}
          withdrawalsLocked={withdrawalsLocked}
          onVoted={load}
          onLoadMore={loadMore}
        />
      ) : null}

      {/* The map draws either way. A draft season is six empty weeks, which is
          exactly what somebody wants to see before deciding whether to enter —
          hiding it behind a sentence taught them nothing about the shape of
          the thing they were being invited into. */}
      <SeasonMap
        season={season}
        liveWeek={liveWeek}
        canVote={judging}
        votesLeft={votesLeft}
        withdrawalsLocked={withdrawalsLocked}
        reloadKey={mapReloadKey}
        onVoted={load}
      />

      {phase === "running" && deadlineMs !== null ? (
        <RoundClock
          week={liveWeek}
          deadlineMs={deadlineMs}
          now={clockNow}
          withdrawalsLocked={withdrawalsLocked}
          refreshing={refreshingMap}
          onRefresh={refreshBracket}
        />
      ) : null}

      {/* Only ever on a finished season: a distribution cannot be drafted
          before the final closes, so earlier there is nothing to ask for. */}
      {phase === "finished" ? <Payouts season={season} /> : null}

      <Sponsors />

      <SeasonApps
        season={season}
        through={phase === "finished" ? api.FINAL : phase === "running" ? liveWeek : 0}
        liveWeek={liveWeek}
        canVote={phase === "running" && judging}
        votesLeft={votesLeft}
        withdrawalsLocked={withdrawalsLocked}
        reloadKey={mapReloadKey}
        onChanged={load}
      />
    </section>
  );
}

/**
 * Where the prize pool went, once the season has settled.
 *
 * Behind a button, and nothing is fetched until it is pressed. This is a
 * receipt: it matters enormously to the twenty people in it and is noise to
 * everybody reading the bracket, so it sits under the map rather than in it.
 *
 * Public on purpose. The pool is other people's money, the plan is derived
 * rather than decided — pools read off the ledgers, split over the winners as
 * described under Rewards on the Rules page, and sent to wallets their owners
 * set — and `payout_plan` is a query
 * anyone may call. Showing it is what makes that auditability worth anything.
 */
function Payouts({ season }: { season: SeasonRow }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<api.PayoutLine[] | null>(null);
  const [progress, setProgress] = useState<api.Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();

  const phase = api.payoutPhase(season);
  const waiting = WAITING[phase];

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    // A settled plan is frozen, so it is read once. One still being sent moves
    // under us — the counters change with every hourly round — so it is read
    // again each time it is opened.
    if (!next || (lines !== null && phase === "paid")) return;
    setBusy(true);
    try {
      const [plan, made] = await Promise.all([
        api.payoutPlan(season.id),
        api.payoutProgress(season.id),
      ]);
      setLines(plan);
      setProgress(made);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  // Nothing has been drafted, so there is nothing to fetch and nothing to
  // expand. Saying so beats a button that opens onto an empty box.
  if (phase === "none") {
    return (
      <section className="payout">
        <h2 className="section-title">Rewards</h2>
        <FundingReconciliation season={season} />
        <p className="muted small">
          The season is over and nothing has gone out yet. The distribution is
          drafted from what the sponsors put in, then sent; when it is, every
          payment lands here — the app, who was paid, in which token, and the
          account it went to.
        </p>
      </section>
    );
  }

  return (
    <section className="payout">
      <h2 className="section-title">Rewards</h2>
      <FundingReconciliation season={season} />
      <p className="muted small">
        Every payment this season made: the app, who was paid, the amount and
        token, and the account it went to.
      </p>

      <div className="payout-actions">
        <button
          type="button"
          className="btn small ghost"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {busy ? "Reading…" : open ? "Hide the payouts" : "Show the payouts"}
        </button>
      </div>

      {open ? (
        <div id={panelId}>
          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : null}

          {/* A list that is not finished looks broken unless it says why. */}
          {waiting ? <p className="notice">{waiting}</p> : null}

          {lines === null ? null : lines.length === 0 ? (
            <p className="muted small">
              The distribution is drafted but carries no lines — no award was
              won, or the pool was too small to cover a single transfer fee.
            </p>
          ) : (
            <>
              {progress ? <PayoutTally progress={progress} /> : null}
              <PayoutLines seasonId={season.id} lines={lines} />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Why the list is not finished yet, for a distribution that is still moving.
 *
 * Only the states where something is outstanding say anything: a settled plan
 * and one that does not exist are both fully described by the list itself.
 */
const WAITING: Record<api.PayoutPhase, string | null> = {
  none: null,
  proposed:
    "Drafted and waiting to go out. Every amount was frozen at drafting, so " +
    "what is listed is exactly what will move.",
  approved:
    "Drafted and waiting to go out. Every amount was frozen at drafting, so " +
    "what is listed is exactly what will move.",
  paying:
    "Still going out. The canister comes back to eligible unsent rows on its " +
    "bounded retry schedule; a line already marked failed is terminal and is not retried.",
  failed:
    "Some lines could not be sent and are no longer being retried; everything " +
    "else was paid. Failed lines keep their frozen amount, arguments, and error " +
    "for inspection; this screen does not offer a retry that could imply otherwise.",
  paid: null,
};

type AppWeek = { week: number; entries: SeasonView[] };

/**
 * Every public app in every round reached so far, kept compact beneath the
 * sponsor list. The bracket deliberately shows only its leading places; this
 * is the complete record, including apps that did not win and entries whose
 * content moderators later removed.
 */
function SeasonApps({
  season,
  through,
  liveWeek,
  canVote,
  votesLeft,
  withdrawalsLocked,
  reloadKey,
  onChanged,
}: {
  season: SeasonRow;
  through: number;
  liveWeek: number;
  canVote: boolean;
  votesLeft: number;
  withdrawalsLocked: boolean;
  reloadKey: number;
  onChanged: () => Promise<void>;
}) {
  const [weeks, setWeeks] = useState<AppWeek[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SeasonView | null>(null);
  const [hover, setHover] = useState<{ view: SeasonView; x: number; y: number } | null>(
    null,
  );
  const requestId = useRef(0);
  const archiveKey = `${season.id}:${through}`;

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setError(null);

    const loadWeek = async (week: number): Promise<AppWeek> => {
      const entries: SeasonView[] = [];
      const seen = new Set<string>();
      let after: bigint | null = null;

      do {
        const page = await api.weekEntriesPage(season.id, week, after, ENTRY_PAGE_SIZE);
        for (const view of page.rows) {
          const id = String(view.entry.id);
          if (!seen.has(id)) {
            seen.add(id);
            entries.push(view);
          }
        }
        const next = page.next;
        if (next !== null && next === after) throw new Error(`Week ${week} did not advance`);
        after = next;
      } while (after !== null);

      return { week, entries };
    };

    try {
      const weekNumbers = Array.from({ length: through }, (_, index) => index + 1);
      const found = await Promise.all(weekNumbers.map(loadWeek));
      if (request !== requestId.current) return;
      setWeeks(found);
      setLoadedKey(archiveKey);
      setOpen((current) => {
        if (!current) return null;
        return (
          found.flatMap((week) => week.entries).find((view) => view.entry.id === current.entry.id) ??
          null
        );
      });
    } catch (cause) {
      if (request !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [archiveKey, season.id, through]);

  useEffect(() => {
    setOpen(null);
    setHover(null);
  }, [archiveKey]);

  useEffect(() => {
    if (through > 0) void load();
  }, [load, reloadKey, through]);

  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  if (through === 0) return null;

  const ready = loadedKey === archiveKey;
  return (
    <section className="season-apps">
      <h2 className="section-title">All apps</h2>

      {!ready ? (
        error ? (
          <div className="notice error" role="alert">
            <p>Could not load all season apps: {error}</p>
            <button type="button" className="btn ghost small" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : (
          <p className="muted small" role="status">
            Loading every app…
          </p>
        )
      ) : (
        <>
          {error ? (
            <p className="notice error" role="alert">
              Could not refresh the complete app list: {error}
            </p>
          ) : null}
          <ol className="season-app-weeks">
            {weeks.map((week) => (
              <li className="season-app-week" key={week.week}>
                <strong>{api.weekName(week.week)}</strong>
                {week.entries.length === 0 ? (
                  <small className="muted">No apps yet.</small>
                ) : (
                  <ul aria-label={`${api.weekName(week.week)} apps`}>
                    {week.entries.map((view) => {
                      const icon = view.entry.icon[0] ?? null;
                      return (
                        <li key={String(view.entry.id)}>
                          <button
                            type="button"
                            className="season-app-icon"
                            title={`Open ${view.entry.title}`}
                            aria-label={`Open ${view.entry.title} by ${view.displayName}`}
                            onMouseMove={(event) =>
                              setHover({ view, x: event.clientX, y: event.clientY })
                            }
                            onMouseLeave={() => setHover(null)}
                            onFocus={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              setHover({ view, x: rect.right, y: rect.top });
                            }}
                            onBlur={() => setHover(null)}
                            onClick={() => {
                              setHover(null);
                              setOpen(view);
                            }}
                          >
                            {icon ? (
                              <img src={icon} alt="" loading="lazy" />
                            ) : (
                              <span aria-hidden="true">
                                {view.entry.title.trim().charAt(0).toUpperCase() || "?"}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {open ? (
        <EntryModal
          view={open}
          canVote={canVote && Number(open.entry.week) === liveWeek}
          votesLeft={votesLeft}
          withdrawalsLocked={withdrawalsLocked}
          onClose={() => setOpen(null)}
          onChanged={async () => {
            await onChanged();
            await load();
          }}
        />
      ) : null}

      {hover && !open ? <Popout {...hover} /> : null}
    </section>
  );
}

/**
 * Who paid for the prize pool, and what they actually put in.
 *
 * The amounts are the swept totals recorded on each sponsor when their deposit
 * was collected — the same numbers that add up to the pool above, not pledges.
 * A pledged ledger nothing has arrived on is left out, so this says what was
 * given rather than what was promised.
 */
function Sponsors() {
  const [sponsors, setSponsors] = useState<PublicUser[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listPage("sponsors", null, null, 50)
      .then((page) => {
        if (!cancelled) setSponsors(page.rows);
      })
      .catch(() => {
        if (!cancelled) setSponsors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (sponsors === null || sponsors.length === 0) return null;

  return (
    <section className="season-sponsors">
      <h2 className="section-title">Sponsors</h2>
      <ul className="sponsor-lines">
        {sponsors.map((user) => (
          <SponsorLine key={user.handle} user={user} />
        ))}
      </ul>
    </section>
  );
}

function SponsorLine({ user }: { user: PublicUser }) {
  const info = api.sponsorInfo(user);
  // Only what actually landed. A ledger they pledged and never paid into
  // carries a zero, and a zero is not a contribution.
  const given = api.sponsorGifts(user).filter((gift) => gift.amount > 0n);
  const logo = info?.logo[0] ?? null;

  return (
    <li className="sponsor-line">
      <a className="sponsor-who" href={`#/u/${user.handle}`}>
        {logo ? (
          <img src={logo} alt="" />
        ) : (
          <span className="sponsor-mark" aria-hidden="true">
            {(info?.org || user.displayName || user.handle).trim().charAt(0).toUpperCase()}
          </span>
        )}
        <span>
          <strong>{info?.org || user.displayName || user.handle}</strong>
          <small className="muted">@{user.handle}</small>
        </span>
      </a>

      {given.length > 0 ? (
        <ul className="treasury-list">
          {given.map((gift) => (
            <TokenPill key={gift.ledger.toText()} ledger={gift.ledger.toText()} amount={gift.amount} />
          ))}
        </ul>
      ) : (
        <small className="muted">Nothing collected yet.</small>
      )}
    </li>
  );
}

/**
 * What the prize pool actually holds right now.
 *
 * Read from the ledgers themselves rather than from anything the canister
 * stores: the treasury's balance is the ledger's opinion, and a number we
 * cached could be wrong the moment a sponsor tops up.
 *
 * Loaded after the page rather than with it — it is an update call per token
 * across canister boundaries, and the bracket should not wait on it.
 */
function TreasuryPanel() {
  const [holdings, setHoldings] = useState<{ ledger: string; amount: bigint }[] | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void api
      .treasuryHoldings()
      .then((found) => {
        if (!cancelled) setHoldings(found);
      })
      .catch(() => {
        if (!cancelled) setHoldings([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only tokens actually in the pool: a pledged ledger nobody has funded is
  // not a prize. There is no "unreachable" case any more — the figures come
  // from the canister's own books, not from asking each ledger.
  const funded = holdings?.filter((held) => held.amount > 0n) ?? null;

  // Nothing in the pool yet: a panel saying "0 tokens" would be noise.
  if (funded !== null && funded.length === 0) return null;

  return (
    <section className="treasury">
      <span className="owner-legend">Prize pool</span>
      {funded === null ? (
        <p className="muted small">Reading the ledgers…</p>
      ) : (
        <ul className="treasury-list">
          {funded.map((held) => (
            <TokenPill key={held.ledger} ledger={held.ledger} amount={held.amount!} />
          ))}
        </ul>
      )}
    </section>
  );
}


/**
 * What is still waiting on this judge.
 *
 * Two votes a week, never your own entry, never the same one twice — so the
 * list is simply the week's entries minus those. Having it here means a judge
 * does not have to work out from the bracket which boxes they have already
 * dealt with.
 */
function ToVote({
  entries,
  total,
  hasMore,
  loadingMore,
  votesLeft,
  week,
  season,
  canVote,
  withdrawalsLocked,
  onVoted,
  onLoadMore,
}: {
  entries: SeasonView[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  votesLeft: number;
  week: number;
  season: SeasonRow;
  canVote: boolean;
  withdrawalsLocked: boolean;
  onVoted: () => Promise<void>;
  onLoadMore: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ view: SeasonView; x: number; y: number } | null>(null);
  const [open, setOpen] = useState<SeasonView | null>(null);

  const cast = entries.filter((view) => view.voted);

  const vote = async (id: bigint, voted: boolean) => {
    setBusy(id);
    setError(null);
    try {
      // A voted row stays on the board now, so its button is a toggle. It was
      // cast-only when the row vanished the moment it received a vote.
      if (voted) await api.withdrawVote(id);
      else await api.castVote(id);
      await onVoted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="to-vote">
      <header>
        <h2 className="section-title">This week's apps</h2>
        <p className="muted small">
          {total} {total === 1 ? "app" : "apps"} in{" "}
          {api.weekName(week).toLowerCase()} of season {Number(season.number)}
          {canVote
            ? ` — you have ${votesLeft} of ${api.VOTES_PER_JUDGE} votes left. Two votes, two different apps, never your own.`
            : "."}
        </p>
      </header>

      {/*
        A banner, not a replacement. Spending both votes used to swap the whole
        board for this sentence, so the moment a judge finished voting was the
        moment they lost the ability to look at anything — including the apps
        they had just chosen, and the ones they had not.
      */}
      {canVote && votesLeft === 0 ? (
        <p className="notice ok">
          Both your votes for {api.weekName(week).toLowerCase()} are cast
          {cast.length > 0 ? ` — ${cast.map((v) => v.entry.title).join(" and ")}` : ""}.
          {withdrawalsLocked
            ? " The final hour has begun, so those votes are now final."
            : " You may withdraw one until the final hour begins."}
        </p>
      ) : null}

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="muted small">Nothing has been submitted this week yet.</p>
      ) : (
        <ul className="to-vote-list">
          {/*
            Every app in the week, for everybody — not a judge's worklist.
            The board is the season's public face: an observer deciding
            whether to enter, a sponsor deciding whether to fund, and a hacker
            checking their competition all want the same list, and a judge
            wants it too once their votes are spent. Vote state is shown *on*
            a card rather than by leaving it out.
          */}
          {entries.map((view) => (
            <li key={String(view.entry.id)}>
              {/* The row opens the app; the Vote button is deliberately
                  outside it, so scoring something is never a stray click on
                  the way to reading it. */}
              <button
                type="button"
                className="to-vote-open"
                onMouseMove={(e) => setHover({ view, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  setHover(null);
                  setOpen(view);
                }}
              >
                {view.entry.icon[0] ? (
                  <img src={view.entry.icon[0]} alt="" />
                ) : (
                  <span className="entry-line-icon placeholder" aria-hidden="true">
                    {view.entry.title.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="to-vote-copy">
                  <strong>{view.entry.title}</strong>
                  <small className="muted">
                    {view.displayName} · {Number(view.entry.votes)}{" "}
                    {Number(view.entry.votes) === 1 ? "vote" : "votes"}
                  </small>
                </span>
              </button>
              {canVote && view.mine ? (
                <small className="muted to-vote-tag">Yours</small>
              ) : canVote ? (
                <button
                  className={view.voted ? "btn ghost small" : "btn small"}
                  disabled={
                    busy !== null ||
                    (view.voted ? withdrawalsLocked : votesLeft === 0)
                  }
                  title={
                    view.voted && withdrawalsLocked
                      ? "Votes cannot be withdrawn during the final hour"
                      : !view.voted && votesLeft === 0
                      ? "Both votes are spent — withdraw one to move it"
                      : undefined
                  }
                  onClick={() => void vote(view.entry.id, view.voted)}
                >
                  {busy === view.entry.id
                    ? "…"
                    : view.voted
                      ? withdrawalsLocked
                        ? "Vote locked"
                        : "Voted"
                      : "Vote"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="load-more">
          <button
            type="button"
            className="btn ghost small"
            disabled={loadingMore}
            onClick={() => void onLoadMore()}
          >
            {loadingMore ? "Loading…" : "Load more apps"}
          </button>
          <small className="muted">
            Showing {entries.length} of {total}
          </small>
        </div>
      ) : null}

      {open ? (
        <EntryModal
          view={open}
          canVote={canVote}
          votesLeft={votesLeft}
          withdrawalsLocked={withdrawalsLocked}
          onClose={() => setOpen(null)}
          onChanged={onVoted}
        />
      ) : null}

      {hover && !open ? <Popout {...hover} /> : null}
    </section>
  );
}

function RoundClock({
  week,
  deadlineMs,
  now,
  withdrawalsLocked,
  refreshing,
  onRefresh,
}: {
  week: number;
  deadlineMs: number;
  now: number;
  withdrawalsLocked: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  const seconds = Math.max(0, Math.ceil((deadlineMs - now) / 1000));
  const ended = seconds === 0;
  const deadline = new Date(deadlineMs);

  return (
    <div className={withdrawalsLocked ? "round-clock locked" : "round-clock"}>
      <span className="round-clock-label">
        {ended ? `${api.weekName(week)} ended` : `${api.weekName(week)} ends in`}
      </span>
      <time
        role="timer"
        aria-live="off"
        dateTime={deadline.toISOString()}
        title={deadline.toLocaleString()}
      >
        {formatCountdown(seconds)}
      </time>
      {ended ? (
        <small>Refresh for the next round</small>
      ) : withdrawalsLocked ? (
        <small>Withdrawals locked</small>
      ) : null}
      <button
        type="button"
        className="btn ghost small round-refresh"
        disabled={refreshing}
        aria-busy={refreshing}
        onClick={() => void onRefresh()}
        title="Refresh the bracket and vote totals"
        aria-label="Refresh the bracket and vote totals"
      >
        <span aria-hidden="true">↻</span>
        Refresh
      </button>
    </div>
  );
}

/**
 * One band carrying everything about the season that is not the bracket:
 * which season, what state it is in, and what is being played for.
 *
 * These were three stacked blocks of prose — a title, a sentence of status, a
 * hint, then a Rewards heading with its own paragraph and three tall cards.
 * That is a screenful before the bracket even starts, for facts that fit on
 * two lines.
 */
function SeasonBar({
  season,
  phase,
  liveWeek,
}: {
  season: SeasonRow;
  phase: api.PhaseName;
  liveWeek: number;
}) {
  // Kept to one line: the bracket below says far more about the format than a
  // sentence can, so this only has to place you in it.
  const status =
    phase === "draft"
      ? "not started, judges still open"
      : phase === "running"
        ? `${api.weekName(liveWeek).toLowerCase()} live, judges frozen`
        : "finished, results final";

  return (
    <header className="season-bar">
      <div className="season-id">
        <h1>Season {Number(season.number)}</h1>
        <span className={`badge phase-${phase}`}>{phase}</span>
      </div>

      <p className="season-meta">
        4 weeks + 2 days · 4 qualifiers → semi → final → rewards · {status}
      </p>

      <div className="season-prizes">
        <ul title={`${api.POOL_TOTAL}% of the pool is distributed`}>
          {api.MEDALS.map((tier) => (
            <li className={`prize ${tier.medal}`} key={tier.medal}>
              <Award medal={tier.medal} size={17} />
              <b>{api.formatPercent(api.shareEach(tier.medal))}</b>
              <small>{tier.short}</small>
            </li>
          ))}
        </ul>
        <small className="prize-note">
          Share of the sponsor pool · each app's best finish
        </small>
      </div>
    </header>
  );
}

/**
 * Every season that has run, as small numbered boxes.
 *
 * Past seasons stay fully browsable — the bracket, the entries and their
 * screenshots are all still there, just frozen. The running one is marked so
 * it is obvious which is which.
 */
function SeasonSwitcher({
  seasons,
  viewing,
}: {
  seasons: SeasonRow[];
  viewing: SeasonRow | null;
}) {
  if (seasons.length < 2 && viewing) return null;

  // Listed newest first by the canister; count up so the numbers read in order.
  const ordered = [...seasons].sort((a, b) => Number(a.number) - Number(b.number));

  return (
    <nav className="season-switch" aria-label="Seasons">
      <span className="season-switch-label">Seasons</span>
      {ordered.map((row) => {
        const n = Number(row.number);
        const phase = api.phaseOf(row);
        const here = viewing !== null && row.id === viewing.id;
        return (
          <a
            key={String(row.id)}
            href={`#/season/${n}`}
            className={`season-chip ${phase}${here ? " on" : ""}`}
            aria-current={here ? "page" : undefined}
            title={`Season ${n} — ${phase}`}
          >
            {n}
            {phase === "running" ? <em aria-label="running" /> : null}
          </a>
        );
      })}
    </nav>
  );
}
