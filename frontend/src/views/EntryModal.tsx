import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import * as api from "../api";
import type { EntryDetail, SeasonView } from "../api";
import { Award } from "./Award";
import { CopyButton } from "./CopyButton";
import { LinkIcon } from "./LinkIcon";
import { QuorumButton } from "./QuorumButton";

/**
 * One entry, in full.
 *
 * Opened from the bracket, which only carries a summary — screenshots, links,
 * the package and the changelog all run to kilobytes each, and sending them
 * with every box would make the map grow with content nobody has asked for.
 * So the modal fetches its own detail and shows a skeleton meanwhile.
 *
 * Editing has one home in Profile. An owner viewing an editable entry gets a
 * link there instead of a second set of partial controls in this sheet.
 */
export function EntryModal({
  view,
  canVote,
  votesLeft,
  withdrawalsLocked,
  onClose,
  onChanged,
}: {
  view: SeasonView;
  canVote: boolean;
  votesLeft: number;
  withdrawalsLocked: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const id = view.entry.id;

  const load = useCallback(async () => {
    try {
      setDetail(await api.entryDetail(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();

    // Native close restores focus to the opener. Closing in cleanup also
    // removes the element from the top layer if its parent route disappears.
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const dismiss = useCallback(() => {
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  }, [onClose]);

  const entry = detail?.entry;
  const medal = api.medalFor(view.entry);
  const votes = Number(entry?.votes ?? view.entry.votes);
  const shots = entry?.shots ?? [];
  const links = entry?.links ?? [];
  const updates = entry?.updates ?? [];
  const pkg = entry ? (entry.pkg[0] ?? null) : null;

  const vote = async () => {
    setBusy(true);
    setError(null);
    try {
      if (view.voted) await api.withdrawVote(id);
      else await api.castVote(id);
      await onChanged();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /*
    Portalled to <body>, not rendered where it was opened from.
    
    A full-screen sheet that lives inside whichever section opened it inherits
    that section's CSS, and the bug that forced this was exactly that: the pool
    styles `header` as a column, the modal has a `<header>`, and a descendant
    selector at (0,1,1) quietly outranked the modal's own (0,1,0) class — so
    the same app looked correct opened from the bracket and stacked into a
    column opened from the list. Scoping that one rule fixes that one case;
    moving out of the tree fixes the category, for every section that will ever
    style a bare element.
  */
  return createPortal(
    <dialog
      className="modal entry-modal"
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        // Backdrop events are retargeted to the dialog. Coordinates distinguish
        // them from clicks on the dialog's own (zero-width) padding.
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;
        if (outside) dismiss();
      }}
    >
      <header className="entry-head">
          {view.entry.icon[0] ? (
            <img className="entry-icon" src={view.entry.icon[0]} alt="" />
          ) : null}
          {/*
            Title and author on one line. They used to be stacked, and in a
            narrow sheet the author line broke again into three — name, handle
            and badge each on their own row — so the top of an app was four
            lines of chrome before a word about the app. The name truncates
            rather than wraps; a long title is worth an ellipsis, not a
            paragraph.
          */}
          <div className="entry-title">
            <h2 id={titleId}>{view.entry.title}</h2>
            <span className="entry-by">
              <a href={`#/u/${view.handle}`}>{view.displayName}</a>
              <span className="muted">@{view.handle}</span>
              {view.judge ? <span className="badge">judge</span> : null}
            </span>
          </div>
          <div className="entry-head-right">
            {medal ? (
              <span className={`medal-tag ${medal}`}>
                <Award medal={medal} size={14} />
                {medal}
              </span>
            ) : null}
            <button
              type="button"
              className="entry-close"
              onClick={dismiss}
              aria-label="Close"
              title="Close"
              autoFocus
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                <path
                  d="M7 7l10 10M17 7L7 17"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
      </header>

        <div className={shots.length > 0 ? "entry-layout" : "entry-layout solo"}>
          {/*
            Everything about the entry except the pictures, in a column that
            scrolls on its own — so paging the carousel never moves the text
            and reading the changelog never moves the screenshot.
          */}
          <div className="entry-detail">
            {/*
              First, above everything. Somebody looking for the build should
              find out here rather than by scrolling to an empty download slot
              and wondering whether the page is broken.

              The entry, its author and its votes are all still here on
              purpose: judges voted on what was there, and removing the row would
              rewrite a week's arithmetic to cover for a moderation decision.
            */}
            {api.takenDown(view.entry) ? (
              <div className="notice warn entry-takedown" role="status">
                <strong>Content removed by moderators.</strong>{" "}
                {view.entry.takedownReason ||
                  "It broke the rules, or infringed somebody's copyright."}{" "}
                The entry and its votes stand — judges decide what it is worth
                without it. This app cannot be restored or resubmitted.
              </div>
            ) : null}

            {/*
              The vote, before the reading. A judge with two votes to spend is
              comparing apps, not studying one — making them scroll past the
              summary, the links, the download and the moderator tools to find
              the button put the whole point of the page last.
            */}
            <div className="entry-actions">
              <div className="entry-votes">
                <strong>{votes}</strong>
                <small>{votes === 1 ? "vote" : "votes"}</small>
              </div>

              {canVote && !view.mine ? (
                <button
                  className={view.voted ? "btn ghost small" : "btn small"}
                  disabled={
                    busy ||
                    (view.voted ? withdrawalsLocked : votesLeft === 0)
                  }
                  onClick={vote}
                  title={
                    view.voted && withdrawalsLocked
                      ? "Votes cannot be withdrawn during the final hour"
                      : !view.voted && votesLeft === 0
                        ? "Both votes are spent"
                        : undefined
                  }
                >
                  {busy
                    ? "…"
                    : view.voted
                      ? withdrawalsLocked
                        ? "Vote locked"
                        : "Withdraw vote"
                      : "Vote for this"}
                </button>
              ) : null}
              {canVote && view.mine ? <small className="muted">Your own entry.</small> : null}
            </div>

            <p className="entry-summary">{view.entry.summary || "No summary."}</p>

            {links.length > 0 || view.entry.url ? (
              <ul className="entry-links">
                {view.entry.url ? (
                  <li>
                    <a href={view.entry.url} target="_blank" rel="noreferrer">
                      <LinkIcon kind="" url={view.entry.url} />
                      <span>{hostOf(view.entry.url)}</span>
                    </a>
                  </li>
                ) : null}
                {links.map((link, i) => (
                  <li key={i}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      <LinkIcon kind={link.kind} url={link.url} />
                      <span>{link.kind.trim() || hostOf(link.url)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}

            {pkg ? <Package pkg={pkg} /> : null}

            {/* Only for moderators, and only while there is content to remove. */}
            {api.takenDown(view.entry) ? null : (
              <Takedown
                entryId={view.entry.id}
                onDone={async () => {
                  await load();
                  await onChanged();
                }}
              />
            )}

            <div className="entry-side">
              <dl className="entry-facts">
                <div>
                  <dt>Week</dt>
                  <dd>{api.weekName(Number(view.entry.week))}</dd>
                </div>
                {view.entry.origin_id[0] !== undefined ? (
                  <div>
                    <dt>Carried</dt>
                    <dd>from the round below</dd>
                  </div>
                ) : null}
                {pkg ? (
                  <div>
                    <dt>Version</dt>
                    <dd>{pkg.version}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            {(detail?.detailsEditable || detail?.versionsEditable) && view.mine ? (
              <div className="owner-tools">
                <div className="owner-bar">
                  <span className="owner-label">Yours</span>
                  <a
                    className="btn small"
                    href={`#/profile/entries/${view.entry.id}`}
                    onClick={dismiss}
                  >
                    Edit in Your apps
                  </a>
                </div>
              </div>
            ) : null}

            {updates.length > 0 ? (
              <section className="changelog">
                <h3>Changelog</h3>
                <ol>
                  {updates.map((update, i) => {
                    const upload = update.upload[0] ?? null;
                    return (
                      <li key={i}>
                        <div className="log-head">
                          <span className="log-version">{update.version}</span>
                          <time className="log-when" title={api.exactTime(update.at)}>
                            {api.ago(update.at)}
                          </time>
                        </div>
                        <p>{update.note}</p>
                        {upload ? (
                          <span className="log-upload">
                            <span aria-hidden="true">⬇</span>
                            {upload.name} · {api.formatBytes(upload.size)}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}

            {error ? (
              <p className="notice error" role="alert">
                {error}
              </p>
            ) : null}
            {!detail ? <p className="muted small">Loading the rest…</p> : null}
          </div>

          {shots.length > 0 ? (
            <div className="entry-media">
              <Carousel shots={shots} title={view.entry.title} />
            </div>
          ) : null}
        </div>
    </dialog>,
    document.body,
  );
}

/**
 * Taking an app's content down, for a moderator looking at it.
 *
 * Here rather than in a queue because this is where somebody actually sees the
 * thing they are judging — the screenshots, the build, the link. A takedown
 * decided from a list of titles is a takedown decided without looking.
 *
 * Two moderators, and the first press says so rather than appearing to fail.
 * It deletes files that cannot be recovered, so one person acting alone —
 * mistaken, pressured, or compromised — should not be able to erase an entry
 * from a competition it is winning.
 */
function Takedown({ entryId, onDone }: { entryId: bigint; onDone: () => Promise<void> }) {
  const [may, setMay] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [tally, setTally] = useState<api.Quorum | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.amModerator().then(async (yes) => {
      setMay(yes);
      if (yes) {
        const found = await api.takedownTally(entryId).catch(() => null);
        setTally(found);
        if (found?.context) setReason((current) => current.trim() || found.context || "");
      }
    });
  }, [entryId]);

  if (!may) return null;

  // A bar is truthful only for the reason currently in the form. Editing the
  // reason intentionally returns it to an empty-looking decision until the
  // canister confirms that exact context.
  const exactTally = tally?.context === reason.trim() ? tally : null;
  const backed = exactTally?.votes ?? 0;
  const needed = exactTally?.needed ?? 2;
  const mine = exactTally?.mine ?? false;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.takedownApp(entryId, reason.trim());
      await onDone();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      // Always, not just on failure: `NeedsSecond` throws having recorded the
      // vote, so the tally has moved on exactly the path that looks like an
      // error. Re-reading it here is what turns the button half-full.
      setTally(await api.takedownTally(entryId, reason.trim()).catch(() => null));
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.withdrawTakedown(entryId);
      const found = await api.takedownTally(entryId).catch(() => null);
      setTally(found);
      setReason(found?.context ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="entry-moderation">
      <h4>Moderator</h4>
      {backed > 0 ? (
        <p className="notice warn">
          {backed} of {needed} moderators have asked for this app's content to be
          removed.
          {mine
            ? " Yours is one of them — it needs a different moderator to finish."
            : backed >= needed - 1
              ? " Taking it down now carries it out."
              : ""}
          {tally?.context ? ` The exact reason is: “${tally.context}”` : ""}
        </p>
      ) : null}
      {mine ? (
        <button className="btn ghost small" onClick={() => void withdraw()} disabled={busy}>
          Withdraw my takedown vote
        </button>
      ) : null}

      {open ? (
        <>
          <label>
            <span>Why it has to come down</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Whose work it is, and how you know."
              autoFocus
            />
            {/* Shown on the entry itself, so the author and everybody else
                reads it. Worth writing as though they will. */}
            <small className="muted">
              {reason.length}/500 — shown on the entry, to everybody.
            </small>
          </label>

          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="actions">
            <button className="btn ghost small" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <QuorumButton
              className="small danger"
              quorum={exactTally}
              onClick={() => void submit()}
              disabled={busy || reason.trim().length === 0}
            >
              {busy ? "…" : "Take the content down"}
            </QuorumButton>
          </div>
        </>
      ) : (
        <QuorumButton
          className="ghost small danger"
          quorum={tally}
          casts={false}
          onClick={() => setOpen(true)}
        >
          Take content down…
        </QuorumButton>
      )}

      <small className="muted">
        Deletes the build and the images, permanently. The entry, its author and
        its votes stay — judges decide what it is worth without them. The app
        cannot be restored or submitted again after the takedown.
      </small>
    </div>
  );
}

/**
 * The build, with both ways of getting at it.
 *
 * Download and copy are separate controls rather than one link: a button
 * cannot live inside an anchor, and the URL is worth having on its own —
 * it is what you paste into a Neutron install command.
 */
function Package({ pkg }: { pkg: NonNullable<EntryDetail["entry"]["pkg"][0]> }) {
  const url = new URL(pkg.key, window.location.origin).href;

  return (
    <div className="entry-package">
      {/*
        `download={name}`, not a bare `download`. The bare form makes the
        browser take the filename from the last path segment — and the upload
        key is a number the hacker's client chose, so the build landed in
        somebody's downloads folder as `1738412345.neutron`. Naming it after
        the app is the whole reason the id exists.
      */}
      <a className="pkg-get" href={pkg.key} download={pkg.name}>
        <span className="pkg-mark" aria-hidden="true">
          ⬇
        </span>
        <span className="pkg-copy">
          <strong>{pkg.name}</strong>
          <small>
            v{pkg.version} · {api.formatBytes(pkg.size)} · uploaded{" "}
            <time title={api.exactTime(pkg.at)}>{api.ago(pkg.at)}</time>
          </small>
        </span>
      </a>
      <CopyButton value={url} label="Copy URL" className="btn ghost small pkg-url" />
    </div>
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

// ── Carousel ────────────────────────────────────────────────────────────────

/**
 * Up to six screenshots.
 *
 * Scroll-snap rather than a transform, so a trackpad swipe and the arrow keys
 * both work without reimplementing either — the dots follow the scroll
 * position instead of driving it.
 */
function Carousel({ shots, title }: { shots: string[]; title: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);

  const to = (index: number) => {
    const element = track.current;
    if (!element) return;
    element.scrollTo({ left: index * element.clientWidth, behavior: "smooth" });
  };

  if (shots.length === 1) {
    return (
      <div className="carousel single">
        <img src={shots[0]} alt={`${title} screenshot`} />
      </div>
    );
  }

  return (
    <div className="carousel">
      <div
        className="carousel-track"
        ref={track}
        onScroll={(event) => {
          const element = event.currentTarget;
          setAt(Math.round(element.scrollLeft / Math.max(1, element.clientWidth)));
        }}
      >
        {shots.map((shot, i) => (
          <img key={shot} src={shot} alt={`${title} screenshot ${i + 1}`} loading="lazy" />
        ))}
      </div>

      <button
        className="carousel-arrow left"
        onClick={() => to(Math.max(0, at - 1))}
        disabled={at === 0}
        aria-label="Previous screenshot"
      >
        ‹
      </button>
      <button
        className="carousel-arrow right"
        onClick={() => to(Math.min(shots.length - 1, at + 1))}
        disabled={at >= shots.length - 1}
        aria-label="Next screenshot"
      >
        ›
      </button>

      <div className="carousel-dots">
        {shots.map((shot, i) => (
          <button
            key={shot}
            className={i === at ? "on" : undefined}
            onClick={() => to(i)}
            aria-label={`Screenshot ${i + 1}`}
            aria-current={i === at}
          />
        ))}
      </div>
    </div>
  );
}
