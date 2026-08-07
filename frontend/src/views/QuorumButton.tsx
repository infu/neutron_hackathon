import { useEffect, useState, type ReactNode } from "react";

import * as api from "../api";

/**
 * Where each of a page's pending decisions stands, in one query.
 *
 * `reloadKey` is how a caller says "a vote was just cast" — it has to be
 * separate from the id list, because casting a first vote changes nothing
 * about *which* rows are pending, only about how far along one of them is.
 * Keying the effect on the ids alone would leave the button reading 0 of 2
 * immediately after the press that made it 1 of 2.
 */
export function useQuorums(
  kind: api.QuorumKind,
  ids: bigint[],
  reloadKey?: unknown,
): Map<bigint, api.Quorum> {
  const [tallies, setTallies] = useState<Map<bigint, api.Quorum>>(new Map());
  // Ids are bigints in a fresh array each render, so the array identity is
  // never stable. The joined string is.
  const key = ids.map(String).join(",");

  useEffect(() => {
    if (key === "") {
      setTallies(new Map());
      return;
    }
    let live = true;
    const read = () => {
      void api
        .approvalTallies(kind, key.split(",").map(BigInt))
        // A failure here costs the bars, not the buttons: `QuorumButton` falls
        // back to a plain button when it has no tally, so moderation still
        // works when this query does not.
        .then((found) => { if (live) setTallies(found); })
        .catch(() => { if (live) setTallies(new Map()); });
    };
    read();

    // A quorum is two people, and two people work the queue at once — so the
    // vote that changes this button is usually cast in somebody else's
    // browser, where no local reload key will ever fire. Without this, the
    // moderator whose press would carry the decision out is the one who cannot
    // see that it would.
    //
    // Paused when the tab is hidden: this is a background poll on a canister,
    // and a console left open overnight should cost nothing.
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, 15_000);
    const onShow = () => { if (document.visibilityState === "visible") read() };
    document.addEventListener("visibilitychange", onShow);

    return () => {
      live = false;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [kind, key, reloadKey]);

  return tallies;
}

/**
 * A button for a decision that takes more than one moderator.
 *
 * The button fills as votes come in — half-full at one of two — so the state
 * of a decision is visible in the control that changes it, rather than in a
 * sentence somebody has to find and read. There are only three of these
 * (approving a judge, approving a sponsor, taking an app's content down), and
 * they are the three decisions that are hardest to walk back, so the cost of a
 * moderator misreading one is high.
 *
 * The states it has to tell apart, which is the whole reason it exists:
 *
 * * **Empty.** Nobody has backed it. Pressing casts the first vote and does
 *   nothing else — deliberately undramatic, because it is not the press that
 *   deletes anything.
 * * **Part full, and not yours.** A colleague has agreed. *Your press
 *   completes it.* This is the dangerous one, and it is the one that looks
 *   most like an ordinary button, so it says so in words as well.
 * * **Part full, and yours.** You have already agreed and are waiting on
 *   somebody else. There is nothing useful to press, so it is disabled — a
 *   live-looking button whose press provably does nothing is how a moderator
 *   comes to believe the quorum is broken.
 *
 * `mine` cannot be derived from `votes`; only the canister knows whose votes
 * those are. See `Moderation.progressFor`.
 */
export function QuorumButton({
  quorum,
  onClick,
  disabled,
  className = "",
  children,
  title,
  casts = true,
}: {
  quorum: api.Quorum | null;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
  /**
   * Does pressing this cast the vote, or does it only open the thing that
   * does? An opener still shows the bar — that is the glanceable state a
   * moderator wants before deciding to look — but it must never disable or
   * relabel itself, because reading a decision you already backed is a
   * perfectly reasonable thing to want to do.
   */
  casts?: boolean;
}) {
  // No tally yet (still loading, or the caller is not a moderator): draw an
  // ordinary button rather than an empty bar. A bar that fills in a moment
  // later reads as a vote having just been cast.
  if (!quorum) {
    return (
      <button className={`btn ${className}`} onClick={onClick} disabled={disabled} title={title}>
        {children}
      </button>
    );
  }

  const { votes, needed, mine } = quorum;
  // A single-vote action — a controller, which needs no second — gets no bar.
  // A one-segment progress bar is noise: it can only be empty or done, and it
  // is empty until the moment the action happens.
  if (needed <= 1) {
    return (
      <button className={`btn ${className}`} onClick={onClick} disabled={disabled} title={title}>
        {children}
      </button>
    );
  }

  const remaining = Math.max(0, needed - votes);
  const waiting = casts && mine && remaining > 0;
  const completes = casts && !mine && votes > 0 && remaining <= 1;

  return (
    <button
      className={`btn quorum ${waiting ? "quorum-waiting" : ""} ${
        completes ? "quorum-completes" : ""
      } ${className}`}
      style={{ ["--quorum-fill" as string]: `${(votes / needed) * 100}%` }}
      onClick={onClick}
      disabled={disabled || waiting}
      title={
        title ??
        (waiting
          ? "You have already agreed. It needs another moderator."
          : completes
            ? "Another moderator has agreed — this press carries it out."
            : `Takes ${needed} moderators. Your press is the first.`)
      }
    >
      <span className="quorum-fill" aria-hidden="true" />
      <span className="quorum-label">
        {waiting ? "Waiting for a second" : children}
        <span className="quorum-count">
          {votes}/{needed}
        </span>
      </span>
    </button>
  );
}

/**
 * The same information as a sentence, for places with no button to fill —
 * a confirmation dialog, mainly, where the decision is being described rather
 * than offered.
 */
export function quorumNote(quorum: api.Quorum | null): string | null {
  if (!quorum || quorum.needed <= 1) return null;
  const remaining = Math.max(0, quorum.needed - quorum.votes);
  if (quorum.mine && remaining > 0) {
    return `You have already agreed. ${remaining} more moderator${
      remaining === 1 ? "" : "s"
    } needed.`;
  }
  if (quorum.votes === 0) {
    return `This takes ${quorum.needed} moderators. Yours would be the first — nothing happens yet.`;
  }
  return remaining <= 1
    ? `${quorum.votes} of ${quorum.needed} moderators have agreed. This carries it out.`
    : `${quorum.votes} of ${quorum.needed} moderators have agreed.`;
}
