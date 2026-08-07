import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../api";
import type {
  Counts,
  Cursor,
  Entry,
  JudgeState,
  LogCursor,
  PublicUser,
  Revision,
} from "../api";
import { Avatar } from "./Avatar";
import { useConfirm, type ConfirmRequest } from "./Confirm";
import { QuorumButton, quorumNote, useQuorums } from "./QuorumButton";
import { CopyButton } from "./CopyButton";
import { Cost } from "./Cost";
import { Distribution } from "./Distribution";
import { TokenRow } from "./LedgerPicker";
import type { ModerateTab } from "../App";

// Ten at a time: a review queue is work to get through, not a list to skim,
// and a shorter page makes the remaining count visible instead of hiding it.
const QUEUE_SIZE = 10;
const LOG_SIZE = 25;
const NOTICE_TOAST_MS = 2_500;

/**
 * The longest a rejection may run. Mirrors `Review.MAX_REASON`.
 *
 * Enough for a specific explanation and suggested fixes. Longer automated
 * reports can be linked instead of copied into retained canister state.
 */
const MAX_REASON = 2_000;

/**
 * Moderator console, built for the real shape of the event: roughly a
 * thousand participants and a couple of hundred judges. Nothing here loads a
 * whole table — every list is a page, and finding one person is a search
 * rather than a scroll.
 *
 * Everything is also doable from the CLI; this is a convenience, not a
 * separate source of truth, and every action lands in the same audit log.
 */
const TABS: { id: ModerateTab; label: string; count?: keyof Counts }[] = [
  { id: "judges", label: "Judges", count: "pending" },
  { id: "sponsors", label: "Sponsors", count: "sponsorsPending" },
  // No `count` key: revisions are not people, so they are absent from `stats`
  // and counted by `review_pending` instead. See `queued` below.
  { id: "review", label: "Review" },
  { id: "notices", label: "Notices" },
  { id: "season", label: "Season" },
  { id: "payout", label: "Payout" },
  { id: "cost", label: "Cost" },
  { id: "find", label: "Find", },
  { id: "log", label: "Log" },
];

export function Moderate({ tab }: { tab: ModerateTab }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [reviewerId, setReviewerId] = useState<bigint | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  /** Revisions waiting on a decision. Counted apart from `counts` — see TABS. */
  const [queued, setQueued] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  /**
   * The judge roster freezes permanently at season start (see Roles on the
   * Rules page): who decides is fixed before any entry is seen, so no judge can
   * later be approved, rejected, or revoked on this one-season canister.
   *
   * The canister already refuses it. The tab goes too, because a tab that only
   * ever answers "not while a season is running" is a tab that teaches
   * moderators to distrust the ones that do work.
   */
  const [judgesFrozen, setJudgesFrozen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [tally, waiting] = await Promise.all([api.stats(), api.reviewPending()]);
      setCounts(tally);
      setQueued(waiting);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [ok, frozen, me] = await Promise.all([
        api.amModerator(),
        api.judgesFrozen(),
        api.getMe(),
      ]);
      setAllowed(ok);
      setJudgesFrozen(frozen);
      setReviewerId(ok ? (me?.id ?? null) : null);
      if (ok) await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), NOTICE_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // A notice belongs to the action's tab, not the whole moderator console.
  useEffect(() => {
    setToast(null);
  }, [tab]);

  /** Every action confirms with an optional note, then reloads what changed. */
  const act = async (
    user: PublicUser,
    state: JudgeState,
    prompt: ConfirmRequest,
    after: () => void,
    kind: "judge" | "sponsor" = "judge",
  ) => {
    const note = await ask({ note: "Note", notePlaceholder: "Why — optional", ...prompt });
    // Cancelling cancels the action; an empty note is fine.
    if (note === null) return;
    setBusy(user.handle);
    setError(null);
    setToast(null);
    try {
      if (kind === "sponsor") await api.setSponsor(user, state, note);
      else await api.setJudge(user, state, note);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof api.ApiNotice) setToast(message);
      else setError(message);
    } finally {
      setBusy(null);
      // Refreshed on the way out rather than on success, because the most
      // interesting outcome here is a *failure*: `NeedsSecond` throws, and it
      // throws having recorded a vote. Refreshing only on success would leave
      // the button reading 0 of 2 straight after the press that made it 1.
      after();
      void refresh();
    }
  };

  if (allowed === null) return <p className="muted">Loading…</p>;

  if (!allowed) {
    return (
      <section className="page">
        <h1>Moderators only</h1>
        <p className="muted">
          This page is for the people moderating the event. Moderators are
          appointed by a canister controller.
        </p>
        <div className="actions">
          <a className="btn ghost" href="#/">
            Back home
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="page moderate">
      <header className="page-head">
        <div>
          <h1>Moderation</h1>
          <p className="muted">
            {counts
              ? `${counts.users} registered · ${counts.judges} judging · ${counts.moderators} moderator${counts.moderators === 1n ? "" : "s"}`
              : " "}
          </p>
        </div>
      </header>

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {toast ? (
        <p className="notice moderation-toast" role="status" aria-atomic="true">
          {toast}
        </p>
      ) : null}

      <nav className="tabs" aria-label="Moderation sections">
        {TABS.filter(
          (t) => !(judgesFrozen && (t.id === "judges" || t.id === "sponsors")),
        ).map((t) => {
          const pending =
            t.id === "review" ? queued : t.count && counts ? Number(counts[t.count]) : 0;
          return (
            <a
              key={t.id}
              href={`#/moderate/${t.id}`}
              className={t.id === tab ? "active" : undefined}
            >
              {t.label}
              {pending > 0 ? <span className="count">{pending}</span> : null}
            </a>
          );
        })}
      </nav>

      {tab === "judges" ? (
        judgesFrozen ? (
          <p className="notice">
            The judge roster was permanently frozen when the season started.
            Who decides was settled before the first entry was seen; it cannot
            be approved, rejected, or revoked on this canister now.
          </p>
        ) : (
          <Queue busy={busy} act={act} pending={counts ? Number(counts.pending) : 0} />
        )
      ) : null}
      {tab === "sponsors" ? (
        judgesFrozen ? (
          <p className="notice">
            The sponsor roster and its enabled ledgers were permanently frozen
            when the season started. Applications cannot be approved, rejected,
            changed, or withdrawn on this canister now.
          </p>
        ) : (
          <SponsorQueue
            busy={busy}
            act={act}
            pending={counts ? Number(counts.sponsorsPending) : 0}
          />
        )
      ) : null}
      {tab === "review" ? (
        <ReviewQueue reviewerId={reviewerId} ask={ask} onDecided={refresh} />
      ) : null}
      {tab === "notices" ? <NoticeQueue /> : null}
      {tab === "season" ? <SeasonControls ask={ask} /> : null}
      {tab === "payout" ? <Distribution ask={ask} /> : null}
      {tab === "cost" ? <Cost ask={ask} /> : null}
      {tab === "find" ? <Lookup busy={busy} act={act} /> : null}
      {tab === "log" ? <Log /> : null}

      {dialog}

    </section>
  );
}

type Act = (
  user: PublicUser,
  state: JudgeState,
  prompt: ConfirmRequest,
  after: () => void,
  kind?: "judge" | "sponsor",
) => void;

/** Pending applications, oldest first so nothing rots at the bottom. */
function Queue({ busy, act, pending }: { busy: string | null; act: Act; pending: number }) {
  const [rows, setRows] = useState<PublicUser[] | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (after: Cursor | null) => {
    setLoading(true);
    try {
      const page = await api.listPage("pending", null, after, QUEUE_SIZE);
      setRows((current) => (after ? [...(current ?? []), ...page.rows] : page.rows));
      setCursor(page.next[0] ?? null);
      setTotal(Number(page.total));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load, pending]);

  /**
   * Bumped after every action, and the only dependable signal that a tally
   * moved.
   *
   * `pending` and the row ids both look like reload keys and neither is: a
   * first vote leaves the application *still pending*, so the count is the
   * same number and the queue is the same rows. Keying on those left the
   * button reading 0 of 2 until the page was reloaded by hand — which is the
   * one moment a moderator most needs it to be right, since the next press is
   * the one that carries the decision out.
   */
  const [voted, setVoted] = useState(0);
  const reload = useCallback(() => {
    setVoted((n) => n + 1);
    void load(null);
  }, [load]);

  const tallies = useQuorums("judge", rows?.map((u) => u.id) ?? [], `${pending}:${voted}`);

  return (
    <section className="mod-block">
      <h2>
        Applications
        {total > 0 ? <span className="count">{total}</span> : null}
      </h2>
      {rows === null ? <p className="muted">Loading…</p> : null}
      {rows?.length === 0 ? <p className="muted">Nothing waiting.</p> : null}
      <ul className="mod-list">
        {rows?.map((user) => (
          <PersonRow key={String(user.id)} user={user}>
            <QuorumButton
              className="small"
              quorum={tallies.get(user.id) ?? null}
              disabled={busy === user.handle}
              onClick={() =>
                act(
                  user,
                  "approved",
                  {
                    title: `Approve @${user.handle} as a judge?`,
                    body: [
                      "They will appear on the judges list. They still compete.",
                      quorumNote(tallies.get(user.id) ?? null),
                    ]
                      .filter(Boolean)
                      .join(" "),
                    confirm: "Approve",
                  },
                  reload,
                )
              }
            >
              Approve
            </QuorumButton>
            <button
              className="btn ghost small"
              disabled={busy === user.handle}
              onClick={() =>
                act(
                  user,
                  "no",
                  {
                    title: `Reject @${user.handle}'s judge application?`,
                    body: "They keep their profile and every other role.",
                    confirm: "Reject",
                    tone: "danger",
                  },
                  reload,
                )
              }
            >
              Reject
            </button>
          </PersonRow>
        ))}
      </ul>
      {cursor ? (
        <div className="more">
          <button className="btn ghost small" onClick={() => load(cursor)} disabled={loading}>
            {loading ? "Loading…" : `Load more (${total - (rows?.length ?? 0)} left)`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Sponsor applications. A moderator verifies the organisation is real. */
function SponsorQueue({
  busy,
  act,
  pending,
}: {
  busy: string | null;
  act: Act;
  pending: number;
}) {
  const [rows, setRows] = useState<PublicUser[] | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (after: Cursor | null) => {
    setLoading(true);
    try {
      const page = await api.listPage("sponsorsPending", null, after, QUEUE_SIZE);
      setRows((current) => (after ? [...(current ?? []), ...page.rows] : page.rows));
      setCursor(page.next[0] ?? null);
      setTotal(Number(page.total));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load, pending]);

  // See `Queue` above for why the reload key cannot be `pending` alone.
  const [voted, setVoted] = useState(0);
  const reload = useCallback(() => {
    setVoted((n) => n + 1);
    void load(null);
  }, [load]);

  const tallies = useQuorums("sponsor", rows?.map((u) => u.id) ?? [], `${pending}:${voted}`);

  return (
    <section className="mod-block">
      <h2>
        Sponsor applications
        {total > 0 ? <span className="count">{total}</span> : null}
      </h2>
      {rows === null ? <p className="muted">Loading…</p> : null}
      {rows?.length === 0 ? <p className="muted">Nothing waiting.</p> : null}
      <ul className="mod-list">
        {rows?.map((user) => {
          const info = api.sponsorInfo(user);
          const ledgers = api.sponsorLedgers(user);
          return (
            <PersonRow
              key={String(user.id)}
              user={user}
              org={info?.org}
              details={<SponsorApplicationDetails user={user} />}
            >
              <QuorumButton
                className="small"
                quorum={tallies.get(user.id) ?? null}
                disabled={busy === user.handle}
                onClick={() =>
                  act(
                    user,
                    "approved",
                    {
                      title: `Approve ${info?.org ?? user.handle} as a sponsor?`,
                      body: [
                        "Their logo and blurb go on the sponsors board, and " +
                          (ledgers.length === 0
                            ? "they have pledged no ledger, so the treasury will not collect anything from them."
                            : `the ${ledgers.length === 1 ? "ledger" : `${ledgers.length} ledgers`} they pledged join the ones the treasury accepts.`),
                        quorumNote(tallies.get(user.id) ?? null),
                      ]
                        .filter(Boolean)
                        .join(" "),
                      confirm: "Approve",
                    },
                    reload,
                    "sponsor",
                  )
                }
              >
                Approve
              </QuorumButton>
              <button
                className="btn ghost small"
                disabled={busy === user.handle}
                onClick={() =>
                  act(
                    user,
                    "no",
                    {
                      title: `Reject ${info?.org ?? user.handle}?`,
                      body: "They keep their profile and can re-apply later.",
                      confirm: "Reject",
                      tone: "danger",
                    },
                    reload,
                    "sponsor",
                  )
                }
              >
                Reject
              </button>
            </PersonRow>
          );
        })}
      </ul>
      {cursor ? (
        <div className="more">
          <button className="btn ghost small" onClick={() => load(cursor)} disabled={loading}>
            {loading ? "Loading…" : `Load more (${total - (rows?.length ?? 0)} left)`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Everything a hacker has asked to publish, waiting on a decision.
 *
 * Nothing reaches the bracket on its own: `submit_entry` and `publish_update`
 * write a revision, and the entry keeps showing its last approved state until
 * somebody here says yes. So an unworked queue is not a backlog, it is an event
 * where nobody is competing.
 *
 * Oldest first, because a revision only applies while the week it was submitted
 * to is still open. One left long enough does not fail — it expires, and the
 * hacker's week is gone with it.
 */
/**
 * Takedown notices, from anybody at all.
 *
 * The people who most need this channel are the ones with no account here — a
 * rights holder who finds their artwork inside somebody's entry has no reason
 * to register. So `file_notice` takes no registration, and every anonymous
 * reporter shares the anonymous principal's three-an-hour allowance, which is
 * what stops an open write endpoint being an open invitation.
 *
 * Nothing here acts on the content. Marking a notice read or dismissed records
 * that a moderator saw it; taking something down is a separate, deliberate act
 * through the normal moderation tools. An endpoint anyone can call that hides
 * content is a censorship button with no lock on it.
 */
function NoticeQueue() {
  const [rows, setRows] = useState<api.Notice[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [limit, setLimit] = useState(QUEUE_SIZE * 2);
  const [busy, setBusy] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, pending] = await Promise.all([api.listNotices(limit), api.noticesPending()]);
      setRows(list);
      setWaiting(pending);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: bigint, reviewed: boolean) => {
    setBusy(id);
    setError(null);
    try {
      await api.resolveNotice(id, reviewed);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="queue">
      <h2>
        Takedown notices
        {waiting > 0 ? <span className="count">{waiting}</span> : null}
      </h2>
      <p className="muted">
        Anyone can send one of these, signed in or not. Reading one does not
        change anything on the site — if something has to come down, take it
        down through the app or the account it belongs to.
      </p>

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nobody has reported anything.</p>
      ) : (
        <ul className="notice-list">
          {rows.map((row) => {
            const state = Object.keys(row.state)[0];
            return (
              <li key={String(row.id)} className={state === "fresh" ? "fresh" : "settled"}>
                <div className="notice-head">
                  <span className={`badge ${state === "fresh" ? "pending" : ""}`}>{state}</span>
                  <time title={api.exactTime(row.at)}>{api.ago(row.at)}</time>
                  {/* Who sent it, as far as the canister knows. The anonymous
                      principal here means exactly that: not signed in. */}
                  <code className="muted">{row.reporter.toText()}</code>
                </div>
                {/* Somebody else's words, so they are rendered as text and
                    never as markup. */}
                <p className="notice-body">{row.body}</p>
                {state === "fresh" ? (
                  <div className="actions">
                    <button
                      className="btn small"
                      disabled={busy !== null}
                      onClick={() => decide(row.id, true)}
                    >
                      {busy === row.id ? "…" : "Mark read"}
                    </button>
                    <button
                      className="btn ghost small"
                      disabled={busy !== null}
                      onClick={() => decide(row.id, false)}
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {rows !== null && rows.length >= limit ? (
        <button className="btn ghost small" onClick={() => setLimit(limit + QUEUE_SIZE * 2)}>
          Load more
        </button>
      ) : null}
    </div>
  );
}

function ReviewQueue({
  reviewerId,
  ask,
  onDecided,
}: {
  reviewerId: bigint | null;
  ask: (r: ConfirmRequest) => Promise<string | null>;
  onDecided: () => void;
}) {
  const [rows, setRows] = useState<Revision[] | null>(null);
  const [season, setSeason] = useState<api.Season | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(QUEUE_SIZE);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The season comes along so a row whose week has already closed can say
      // so before anybody presses Approve — see `stale` below.
      const [queue, waiting, live] = await Promise.all([
        api.reviewQueue(limit),
        api.reviewPending(),
        api.getSeason(),
      ]);
      setRows(queue);
      setTotal(waiting);
      setSeason(live);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Whether approving this would apply anything.
   *
   * The canister re-checks the world at approval time: a revision names the
   * season and week it was written against, and if the calendar has moved past
   * them there is no longer an entry to write to. It answers `#expired` rather
   * than an error, because nobody did anything wrong.
   */
  const stale = (rev: Revision) =>
    !season ||
    api.phaseOf(season) !== "running" ||
    season.id !== rev.season_id ||
    season.week !== rev.week;

  const decide = async (rev: Revision, action: () => Promise<Revision>, done: string) => {
    setBusy(rev.id);
    setError(null);
    setNote(null);
    try {
      const saved = await action();
      // Approving is allowed to succeed and apply nothing. Saying "live" here
      // would send the hacker looking for an entry that was never written.
      setNote(
        api.revisionState(saved) === "expired"
          ? `${headline(rev)} expired — ${api.weekName(Number(rev.week))} closed before anyone reviewed it, so nothing was published. The author can submit again in the open week.`
          : done,
      );
      await load();
      onDecided();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const approve = async (rev: Revision) => {
    const ok = await ask({
      title: `Publish ${headline(rev)}?`,
      body: stale(rev)
        ? "The week this was submitted to has closed, so approving it now records it as expired and publishes nothing."
        : "version" in rev.kind
          ? "The build goes live on their entry and the version joins the changelog. Whatever it replaces stops resolving."
          : "It goes into the bracket under this week and can be voted for.",
      confirm: stale(rev) ? "Approve anyway" : "Publish",
    });
    if (ok === null) return;
    await decide(rev, () => api.approveRevision(rev.id), `${headline(rev)} is live.`);
  };

  const reject = async (rev: Revision, reason: string) => {
    const ok = await ask({
      title: `Refuse ${headline(rev)}?`,
      body: "The author reads your reason in full, and can fix it and submit again while the week is open.",
      confirm: "Send the rejection",
      tone: "danger",
    });
    if (ok === null) return;
    await decide(
      rev,
      () => api.rejectRevision(rev.id, reason),
      `${headline(rev)} refused. The author has your reason.`,
    );
  };

  return (
    <section className="mod-block">
      <h2>
        Waiting on review
        {total > 0 ? <span className="count">{total}</span> : null}
      </h2>

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="notice ok">{note}</p> : null}

      {rows === null ? <p className="muted">Loading…</p> : null}
      {rows?.length === 0 ? (
        <p className="muted">
          Nothing waiting. Every submission and every version published so far
          has been decided.
        </p>
      ) : null}

      <ul className="mod-list">
        {rows?.map((rev) => (
          <ReviewRow
            key={String(rev.id)}
            rev={rev}
            stale={stale(rev)}
            own={reviewerId === rev.user_id}
            busy={busy === rev.id}
            onApprove={() => approve(rev)}
            onReject={(reason) => reject(rev, reason)}
          />
        ))}
      </ul>

      {rows && rows.length < total ? (
        <div className="more">
          <button
            className="btn ghost small"
            onClick={() => setLimit(limit + QUEUE_SIZE)}
            disabled={loading}
          >
            {loading ? "Loading…" : `Load more (${total - rows.length} left)`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** What a revision is called in a sentence — a dialog title, a note. */
function headline(rev: Revision): string {
  if ("version" in rev.kind) {
    const identity =
      rev.slug ||
      (rev.targetEntryId[0] !== undefined
        ? `entry #${String(rev.targetEntryId[0])}`
        : `revision #${String(rev.id)}`);
    const title = rev.title.trim();
    const target = title ? `${title} (${identity})` : identity;
    return `v${rev.version} for ${target}`;
  }
  return rev.title.trim() || rev.slug || `revision #${String(rev.id)}`;
}

/**
 * One thing to decide, with everything it proposes on screen.
 *
 * The pictures are the point: an icon and screenshots are what most of an app
 * store is, and approving art nobody looked at is not review. They are shown as
 * the hacker uploaded them rather than by filename, since a filename says
 * nothing about what is in the file.
 */
function ReviewRow({
  rev,
  stale,
  own,
  busy,
  onApprove,
  onReject,
}: {
  rev: Revision;
  stale: boolean;
  own: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [full, setFull] = useState(false);
  const [complaint, setComplaint] = useState<string | null>(null);

  const isVersion = "version" in rev.kind;
  const icon = rev.icon[0] ?? null;
  const pkg = rev.pkgKey[0] ?? null;
  const fieldId = `reason-${rev.id}`;

  const send = () => {
    const body = reason.trim();
    // The canister refuses an empty reason, and rightly: a refusal the author
    // cannot act on is just a deletion with extra steps.
    if (body === "") {
      setComplaint("Say why. The author reads this, and it is the only thing they get.");
      return;
    }
    setComplaint(null);
    onReject(body);
  };

  return (
    <li className="mod-row">
      <div className="app-icon-preview">
        {icon ? (
          <img src={icon} alt={`Icon proposed for ${headline(rev)}`} />
        ) : (
          <span aria-hidden="true">{isVersion ? "V" : "?"}</span>
        )}
      </div>

      <div className="mod-who">
        <strong>{headline(rev)}</strong>
        <small>
          {isVersion ? "new version" : `new app · ${rev.slug}`}
          {` · ${api.weekName(Number(rev.week))} · user #${String(rev.user_id)} · submitted `}
          <time title={api.exactTime(rev.createdAt)}>{api.ago(rev.createdAt)}</time>
        </small>

        {stale ? (
          <p className="notice warn">
            {api.weekName(Number(rev.week))} has closed. Approving now records
            this as expired and publishes nothing — it is not a way to let it in
            late.
          </p>
        ) : null}

        {isVersion ? (
          rev.note.trim() ? (
            <p className="mod-note">{rev.note}</p>
          ) : (
            <small className="muted">No release note.</small>
          )
        ) : rev.summary.trim() ? (
          <p className="mod-note">{rev.summary}</p>
        ) : (
          <small className="muted">No summary.</small>
        )}

        {!isVersion && (rev.url || rev.links.length > 0) ? (
          <ul className="entry-links">
            {rev.url ? (
              <li>
                <a href={rev.url} target="_blank" rel="noreferrer noopener">
                  {hostOf(rev.url)}
                </a>
              </li>
            ) : null}
            {rev.links.map((link, i) => (
              <li key={`${link.url}-${i}`}>
                <a href={link.url} target="_blank" rel="noreferrer noopener">
                  {link.kind.trim() || hostOf(link.url)}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {pkg ? (
          <div className="entry-package">
            {/* Named after the app, as the entry itself serves it — a
                reviewer should get the same file a judge will. */}
            <a className="pkg-get" href={pkg} download={`${rev.slug}.neutron`}>
              <span className="pkg-mark" aria-hidden="true">
                ⬇
              </span>
              <span className="pkg-copy">
                <strong>{pkg.split("/").pop()}</strong>
                <small>the build this asks you to publish</small>
              </span>
            </a>
            <CopyButton
              value={new URL(pkg, window.location.origin).href}
              label="Copy URL"
              className="btn ghost small pkg-url"
            />
          </div>
        ) : isVersion ? (
          <small className="muted">Notes only — no new build.</small>
        ) : null}

        {rev.shots.length > 0 ? (
          <>
            {/*
              Thumbnails keep the queue scannable; the full frames are behind a
              press because six screenshots at column width is a page each and
              the queue is meant to be worked top to bottom.
            */}
            <ul className="shot-strip">
              {rev.shots.map((shot, i) => (
                <li key={shot}>
                  <img src={shot} alt={`Screenshot ${i + 1} of ${headline(rev)}`} loading="lazy" />
                </li>
              ))}
            </ul>
            <button
              className="btn ghost small"
              onClick={() => setFull(!full)}
              aria-expanded={full}
            >
              {full ? "Hide full size" : `Look at all ${rev.shots.length} full size`}
            </button>
            {full
              ? rev.shots.map((shot, i) => (
                  <div className="carousel single" key={`full-${shot}`}>
                    <img src={shot} alt={`Screenshot ${i + 1} of ${headline(rev)}, full size`} />
                  </div>
                ))
              : null}
          </>
        ) : isVersion ? null : (
          <small className="muted">No screenshots.</small>
        )}

        {refusing ? (
          <>
            <label htmlFor={fieldId}>
              <small>Why it is refused — the author reads this, all of it.</small>
            </label>
            <textarea
              id={fieldId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={6}
              maxLength={MAX_REASON}
              placeholder="What is wrong, and what would fix it…"
              autoFocus
            />
            <small className="muted">
              {reason.length.toLocaleString()}/{MAX_REASON.toLocaleString()} — explain what
              is wrong and what the author should change.
            </small>
            {complaint ? (
              <p className="notice error" role="alert">
                {complaint}
              </p>
            ) : null}
          </>
        ) : null}

        {own ? (
          <small className="muted mod-own-review">
            This is your submission. Moderators cannot review their own apps;
            another moderator must publish or refuse it.
          </small>
        ) : null}
      </div>

      {own ? null : (
        <div className="mod-actions">
          {refusing ? (
            <>
              <button className="btn small danger" disabled={busy} onClick={send}>
                {busy ? "…" : "Send rejection"}
              </button>
              <button
                className="btn ghost small"
                disabled={busy}
                onClick={() => {
                  setRefusing(false);
                  setComplaint(null);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn small" disabled={busy} onClick={onApprove}>
                {busy ? "…" : "Publish"}
              </button>
              <button
                className="btn ghost small"
                disabled={busy}
                onClick={() => setRefusing(true)}
              >
                Refuse
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Just the host, so a long URL does not push the row out of the column. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Find anyone by handle and act on them. At a thousand participants this is
 * the only sane way to reach a specific person — scrolling a list is not it.
 */
function Lookup({ busy, act }: { busy: string | null; act: Act }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const run = useCallback(async (term: string) => {
    const id = ++requestId.current;
    if (term.trim() === "") {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const hits = await api.searchUsers(term, "all", 20);
      if (id === requestId.current) setRows(hits);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(query), 220);
    return () => clearTimeout(timer);
  }, [query, run]);

  return (
    <section className="mod-block">
      <h2>Find someone</h2>
      <input
        className="search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search handle…"
        aria-label="Search users by handle"
        spellCheck={false}
      />
      {loading ? <p className="muted">Searching…</p> : null}
      <ul className="mod-list">
        {rows.map((user) => {
          const state = api.judgeState(user);
          return (
            <PersonRow key={String(user.id)} user={user}>
              {state !== "approved" ? (
                <button
                  className="btn small"
                  disabled={busy === user.handle}
                  onClick={() =>
                    act(
                      user,
                      "approved",
                      {
                        title: `Make @${user.handle} a judge?`,
                        body: "Skips the application — they go straight onto the judges list.",
                        confirm: "Make judge",
                      },
                      () => run(query),
                    )
                  }
                >
                  Make judge
                </button>
              ) : null}
              {state === "approved" ? (
                <>
                  <button
                    className="btn ghost small"
                    disabled={busy === user.handle}
                    onClick={() =>
                      act(
                        user,
                        "pending",
                        {
                          title: `Put @${user.handle} back to pending?`,
                          body: "Undoes an approval. They drop off the judges list until re-approved.",
                          confirm: "Back to pending",
                        },
                        () => run(query),
                      )
                    }
                  >
                    Back to pending
                  </button>
                  <button
                    className="btn ghost small"
                    disabled={busy === user.handle}
                    onClick={() =>
                      act(
                        user,
                        "no",
                        {
                          title: `Revoke @${user.handle}'s judge role?`,
                          body: "Removes it entirely. Recorded as a revocation, not a rejection.",
                          confirm: "Revoke",
                          tone: "danger",
                        },
                        () => run(query),
                      )
                    }
                  >
                    Revoke
                  </button>
                </>
              ) : null}
            </PersonRow>
          );
        })}
      </ul>

      <small>
        Moderator appointments are controller-only and must be completed from
        the CLI before sealing. A normal seal leaves only the canister itself as
        controller. After that, the roster can expand only if three moderators
        first enable the fixed DAO recovery and the DAO then appoints someone.
        <br />
        <code>npm run moderator -- @handle</code>
      </small>
    </section>
  );
}

function Log() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<LogCursor | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (after: LogCursor | null) => {
    setLoading(true);
    try {
      const page = await api.moderationLog(after, LOG_SIZE);
      setRows((current) => (after ? [...current, ...page.rows] : page.rows));
      setCursor(page.next[0] ?? null);
      setTotal(Number(page.total));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <section className="mod-block">
      <h2>
        History
        {total > 0 ? <span className="count">{total}</span> : null}
      </h2>
      {rows.length === 0 && !loading ? <p className="muted">Nothing yet.</p> : null}
      <ol className="mod-log">
        {rows.map((entry) => (
          <LogRow key={String(entry.id)} entry={entry} />
        ))}
      </ol>
      {cursor ? (
        <div className="more">
          <button className="btn ghost small" onClick={() => load(cursor)} disabled={loading}>
            {loading ? "Loading…" : `Load more (${total - rows.length} left)`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PersonRow({
  user,
  org,
  details,
  children,
}: {
  user: PublicUser;
  org?: string;
  /** Anything the decision needs, under the name rather than beside it. */
  details?: React.ReactNode;
  children: React.ReactNode;
}) {
  const title = api.title(user);
  return (
    <li className="mod-row">
      <Avatar user={user} size={36} />
      <div className="mod-who">
        <a href={`#/u/${user.handle}`}>{org || user.displayName || user.handle}</a>
        <small>
          @{user.handle}
          {title ? ` · ${title}` : ""}
          {api.rolesOf(user).filter((r) => r !== "observer").map((r) => ` · ${r}`)}
        </small>
        {details}
      </div>
      <div className="mod-actions">{children}</div>
    </li>
  );
}

/**
 * The exact public card fields a sponsor is asking moderators to approve.
 *
 * This is deliberately not the directory's `SponsorCard`: that card shortens
 * the website, clamps the blurb and includes funding totals. Review needs the
 * complete pending application, while `Pledged` below remains the single
 * rendering of ledger identity.
 */
function SponsorApplicationDetails({ user }: { user: PublicUser }) {
  const info = api.sponsorInfo(user);
  if (!info) {
    return <small className="muted">Sponsor details unavailable.</small>;
  }

  const logo = api.sponsorLogo(user);
  return (
    <div className="mod-sponsor-application">
      <div className="mod-sponsor-logo">
        {logo ? (
          <img src={logo} alt={`${info.org} proposed logo`} loading="lazy" />
        ) : (
          <small className="muted">No logo supplied.</small>
        )}
      </div>

      <dl className="mod-sponsor-copy">
        <div>
          <dt>Organisation</dt>
          <dd>
            <strong>{info.org}</strong>
          </dd>
        </div>
        <div>
          <dt>About</dt>
          <dd>
            {info.blurb ? (
              <p className="mod-sponsor-blurb">{info.blurb}</p>
            ) : (
              <small className="muted">No blurb supplied.</small>
            )}
          </dd>
        </div>
        <div>
          <dt>Website</dt>
          <dd>
            {info.website ? (
              <a
                className="mod-sponsor-website"
                href={info.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                {info.website}
              </a>
            ) : (
              <small className="muted">No website supplied.</small>
            )}
          </dd>
        </div>
      </dl>

      <div className="mod-sponsor-ledgers">
        <span className="mod-sponsor-label">Ledgers</span>
        <Pledged user={user} />
      </div>
    </div>
  );
}

/**
 * The ledgers this sponsor said they would pay in.
 *
 * On the row, before the decision, because approving is what puts them on the
 * treasury's list — `treasury_ledgers` is exactly the union of what approved
 * sponsors pledged, so a moderator waving through an unrecognised canister id
 * has admitted it to the prize pool and there is nothing to inspect afterwards.
 *
 * The canister id is spelled out in full rather than abbreviated: the symbol
 * comes from whatever that canister says about itself, and a ledger claiming to
 * be ICP is precisely the case this list exists to catch.
 */
function Pledged({ user }: { user: PublicUser }) {
  const ledgers = api.sponsorLedgers(user);
  if (ledgers.length === 0) {
    return <small className="muted">No ledgers pledged — nothing they send could be collected.</small>;
  }
  return (
    <ul className="ledger-chosen">
      {ledgers.map((ledger) => (
        <li key={ledger.id.toText()}>
          <TokenRow id={ledger.id.toText()} sns={ledger.sns} />
        </li>
      ))}
    </ul>
  );
}

function LogRow({ entry }: { entry: Entry }) {
  const note = api.actionNote(entry);
  const when = new Date(Number(entry.at / BigInt(1_000_000)));
  const subject = entry.subject[0];
  // Null when a raw controller acted rather than a registered moderator —
  // show the principal so they are still identifiable.
  const by = entry.by[0];

  return (
    <li className="mod-log-row">
      <span className={`badge ${api.actionKind(entry)}`}>{api.actionLabel(entry)}</span>
      <div className="mod-log-body">
        <p className="mod-log-who">
          {subject ? (
            <a href={`#/u/${subject}`}>@{subject}</a>
          ) : (
            <span className="muted">user #{String(entry.subjectId)}</span>
          )}
          <span className="muted"> by </span>
          {by ? (
            <a href={`#/u/${by}`}>@{by}</a>
          ) : (
            <span className="mono" title={entry.byPrincipal.toText()}>
              controller
            </span>
          )}
        </p>
        <small className="mono">
          {Number.isNaN(when.getTime()) ? "" : when.toLocaleString()}
        </small>
        {note ? <p className="mod-note">{note}</p> : null}
      </div>
    </li>
  );
}

/**
 * Running the competition: create a season, start it, close each week.
 *
 * Starting is the consequential one — it freezes the judge roster permanently,
 * so from that click no moderator can approve or revoke a judge again
 * (see Roles on the Rules page). Closing a week is equally one-way: it ranks, rewards
 * and carries entries forward. Both confirm.
 */
/**
 * The season, and the two buttons that start it.
 *
 * **Both are a moderator's**, not an external controller's. A season can begin
 * only once the canister is its own sole controller, so the only surviving
 * controller authority is what this installed code exposes. `create_season`
 * and `start_season` are both
 * `Profiles.canModerate`; this panel used to disable them unless the caller was
 * a controller, which was left over from before the seal and made the buttons
 * dead for exactly the people they belong to.
 *
 * Timer recovery and emergency controller recovery are deliberately separate:
 * one re-arms stored work without changing authority; the other needs three
 * moderators and visibly ends the self-only seal.
 */
function automationStageName(stage: api.AutomationStage): string {
  if (typeof stage === "object") return api.weekName(stage.round);
  return stage === "funding" ? "Funding reconciliation" : "Payout";
}

function automationNote(result: api.AutomationWake): string {
  if (result.kind === "idle") return "There is no live automation to recover.";
  if (result.kind === "settled") return "Settlement is complete; no timer is needed.";
  const stage = automationStageName(result.stage);
  if (result.kind === "armed") {
    return `${stage} is re-armed for ${api.exactTime(result.at)}. Nothing advanced early.`;
  }
  if (result.kind === "busy") {
    return result.stage === "funding"
      ? `Funding reconciliation or an admitted sweep is already in progress (since ${api.exactTime(result.since)}). No duplicate pass was started.`
      : `${stage} is already running (since ${api.exactTime(result.since)}). No duplicate run was started.`;
  }
  return result.nextAt
    ? `Automation ran from stored state. Current stage: ${stage}. The next check is ${api.exactTime(result.nextAt)}.`
    : `Automation ran from stored state. Current stage: ${stage}.`;
}

function SeasonControls({ ask }: { ask: (r: ConfirmRequest) => Promise<string | null> }) {
  const [season, setSeason] = useState<api.Season | null>(null);
  const [endsAt, setEndsAt] = useState<bigint | null>(null);
  const [controllerRecovery, setControllerRecovery] =
    useState<api.ControllerRecovery | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [live, due, recovery] = await Promise.all([
        api.getSeason(),
        api.weekEndsAt(),
        api.controllerRecoveryTally(),
      ]);
      setSeason(live);
      setEndsAt(due);
      setControllerRecovery(recovery);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (what: string, action: () => Promise<unknown>, done: string) => {
    setBusy(what);
    setError(null);
    setNote(null);
    try {
      await action();
      await refresh();
      setNote(done);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const phase = season ? api.phaseOf(season) : null;
  const week = season ? Number(season.week) : 0;
  const payout = season ? api.payoutPhase(season) : "none";
  const recoverable = Boolean(
    season &&
      (phase === "running" ||
        (phase === "finished" &&
          (!season.fundingReady || (payout !== "paid" && payout !== "failed")))),
  );
  const dashboardUrl = api.canisterDashboardUrl();

  const recover = async () => {
    const confirmed = await ask({
      title: "Check and re-arm automation?",
      body:
        "The canister reads its stored deadline and settlement state. Before work is due " +
        "this only re-arms the existing time. When due it may close one round, run one " +
        "eligible funding pass, or resume the frozen payout. It cannot advance early or " +
        "choose or shorten a deadline, ledger, amount, wallet, or payout plan.",
      confirm: "Check / re-arm",
    });
    if (confirmed === null) return;

    setBusy("automation");
    setError(null);
    setNote(null);
    try {
      const result = await api.wakeAutomation();
      await refresh();
      setNote(automationNote(result));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const recoverController = async () => {
    const confirmed = await ask({
      title: "Approve emergency canister recovery?",
      body:
        `This records one of three distinct moderator approvals. The third adds only ` +
        `Neutrinite DAO (${api.NEUTRINITE_DAO_CONTROLLER}) as a controller beside this ` +
        "canister. That visibly ends the sealed state and gives the DAO normal controller " +
        "power, including repairing or upgrading the code and frontend and changing settings. " +
        "This is separate from re-arming automation.",
      confirm: "Approve recovery",
      tone: "danger",
    });
    if (confirmed === null) return;

    setBusy("controller-recovery");
    setError(null);
    setNote(null);
    try {
      const result = await api.recoverCanister();
      await refresh();
      setNote(
        result.recovered
          ? `Recovery completed. Neutrinite DAO ${api.NEUTRINITE_DAO_CONTROLLER} is now a controller.`
          : `Your recovery approval is recorded: ${result.votes}/${result.needed}.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="season-controls">
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="notice">{note}</p> : null}

      {!season ? (
        <div className="control">
          <div>
            <strong>No season yet</strong>
            <small className="muted">
              A <b>draft</b> is a season that exists but has not begun: no week is
              open, nothing can be submitted, and no vote counts. It is the state
              in which you get the judge roster right; it becomes permanently
              immutable once the season starts.
            </small>
          </div>
          <button
            className="btn small"
            disabled={busy !== null}
            onClick={() => run("create", api.createSeason, "Draft season created.")}
          >
            {busy === "create" ? "…" : "Create season"}
          </button>
        </div>
      ) : phase === "finished" ? (
        <div className="control">
          <div>
            <strong>Season {Number(season.number)} is finished</strong>
            <small className="muted">
              {recoverable
                ? "The bracket is final. Funding or payout automation is still settling the recorded result."
                : "This canister hosts one season. Its roster, entries, funding, results, and settlement record are permanent; a next season requires a separately configured canister."}
            </small>
          </div>
          {recoverable ? (
            <button className="btn small" disabled={busy !== null} onClick={recover}>
              {busy === "automation" ? "Checking…" : "Check / re-arm automation"}
            </button>
          ) : (
            <span className="badge">permanent record</span>
          )}
        </div>
      ) : null}

      {season && phase !== "finished" ? (
        <div className="control">
          <div>
            <strong>
              Season {Number(season.number)} — {phase}
              {phase === "running" ? ` · ${api.weekName(week)}` : ""}
            </strong>
            <small className="muted">
              {phase === "draft"
                ? "A draft: no week is open and nothing counts yet. Approve or revoke judges now — you cannot once it runs."
                : endsAt
                  ? `Closes at ${api.exactTime(endsAt)} · the judge roster is permanently frozen`
                  : "The judge roster is permanently frozen."}
            </small>
          </div>

          {phase === "draft" ? (
            <div className="stack-tight">
              <button
                className="btn small"
                disabled={busy !== null}
                onClick={async () => {
                  const ok = await ask({
                    title: `Start season ${Number(season.number)}?`,
                    body:
                      "This permanently freezes the judge roster — no judge can ever be " +
                      "approved, rejected, or revoked on this canister afterwards. Week 1 " +
                      "opens for submissions immediately.",
                    confirm: "Start and seal the roster",
                    tone: "danger",
                  });
                  if (ok === null) return;
                  await run(
                    "start",
                    () => api.startSeason(season.id),
                    "Season started. Judge roster permanently frozen.",
                  );
                }}
              >
                {busy === "start" ? "…" : "Start season"}
              </button>
              <small className="muted">
                Verify the controller list on the{" "}
                <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
                  IC dashboard
                </a>
                . The canister independently refuses to start unless it is its own sole
                controller.
              </small>
            </div>
          ) : recoverable ? (
            <div className="stack-tight">
              <span className="muted">{`${api.weekName(week)} closes on its stored deadline.`}</span>
              <button className="btn small" disabled={busy !== null} onClick={recover}>
                {busy === "automation" ? "Checking…" : "Check / re-arm automation"}
              </button>
            </div>
          ) : (
            <span className="muted">No automation is pending.</span>
          )}
        </div>
      ) : null}

      {season ? (
        <div className="control">
          <div>
            <strong>Emergency canister recovery</strong>
            <small className="muted">
              Three distinct current moderators can add Neutrinite DAO{" "}
              {api.NEUTRINITE_DAO_CONTROLLER} as the only external controller. Verify the
              live controller list on the{" "}
              <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
                IC dashboard
              </a>
              . If recovery already completed, checking again is idempotent and leaves the
              fixed controller set unchanged.
            </small>
          </div>
          {controllerRecovery ? (
            <div className="stack-tight">
              <span className="muted">
                {controllerRecovery.votes}/{controllerRecovery.needed} moderator approvals
              </span>
              <button
                className="btn small danger"
                disabled={
                  busy !== null ||
                  (controllerRecovery.mine &&
                    controllerRecovery.votes < controllerRecovery.needed)
                }
                onClick={recoverController}
              >
                {busy === "controller-recovery"
                  ? "Recovering…"
                  : controllerRecovery.mine &&
                      controllerRecovery.votes < controllerRecovery.needed
                    ? "Your approval is recorded"
                    : "Approve / check recovery"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
