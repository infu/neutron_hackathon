import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import * as api from "../api";
import type { Season as SeasonRow, SeasonView, WeekView } from "../api";
import { Award, AwardDefs } from "./Award";
import { EntryModal } from "./EntryModal";

/**
 * The season as a bracket, read bottom to top.
 *
 * ```
 *                        ┌───┐              champion
 *                  ┌───┐   ┌───┐            the final — two places
 *          ┌───┐ ┌───┐ ┌───┐ ┌───┐          the semi — one place per week
 *   [w1 × 5] [w2 × 5] [w3 × 5] [w4 × 5]     the qualifier weeks
 * ```
 *
 * Every position is drawn whether or not anything occupies it: a bracket is a
 * structure before it is a result, and an empty place says "still to be
 * decided" better than a missing one does. Each qualifier week shows five
 * boxes because five is what a week rewards.
 *
 * Places are assigned by descent, not by rank order. A carried entry records
 * the entry it was cloned from (`origin_id`), so the box above week 2 is
 * week 2's winner — not merely whoever happens to lead the semi-final. Weeks
 * still open get a faint projected line from whoever currently leads, since
 * rank 1 is what advances.
 */

/** A place in the bracket, and what (if anything) is standing in it. */
type Slot = {
  key: string;
  view: SeasonView | null;
};

type Line = { d: string; resolved: boolean };

/** Corner radius on the connectors. Tier spacing lives in the stylesheet. */
const CORNER = 8;

/**
 * Connector sources for the pairings themselves.
 *
 * A duel produces one winner, so its outgoing line leaves the middle of the
 * pairing — right above the `vs` — rather than one of the two places in it.
 * That also means the line exists before either place is filled.
 */
const FINAL_DUEL = "duel-final";
const SEMI_DUEL = (i: number) => `duel-semi-${i}`;

/**
 * An orthogonal path through `points` with rounded corners.
 *
 * Each corner is shortened by `r` on both sides and bridged with a quadratic
 * through the original vertex, so the turn stays exactly where it was but
 * reads as a curve rather than a hard elbow. Degenerate corners — where a
 * segment is shorter than the radius — fall back to a straight line.
 */
function orthogonal(points: [number, number][], r: number): string {
  const parts = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const cut = Math.min(r, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    if (cut <= 0.5) {
      parts.push(`L ${cx} ${cy}`);
      continue;
    }
    parts.push(`L ${cx - Math.sign(cx - px) * cut} ${cy - Math.sign(cy - py) * cut}`);
    parts.push(`Q ${cx} ${cy} ${cx + Math.sign(nx - cx) * cut} ${cy + Math.sign(ny - cy) * cut}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last[0]} ${last[1]}`);
  return parts.join(" ");
}

/** The whole bracket, resolved into the places it draws. */
type Bracket = {
  champion: Slot;
  final: Slot[];
  semi: Slot[];
  weeks: { week: number; total: number; slots: Slot[] }[];
  /** entry id -> the week it was submitted in, for tracing descent. */
  weekOf: Map<bigint, number>;
};

function build(weeks: WeekView[]): Bracket {
  const weekOf = new Map<bigint, number>();
  for (const week of weeks) {
    for (const view of week.entries) weekOf.set(view.entry.id, Number(week.week));
  }

  const empty = (key: string): Slot => ({ key, view: null });
  const of = (view: SeasonView | null, key: string): Slot =>
    view ? { key: `e${view.entry.id}`, view } : empty(key);

  // Qualifier weeks: exactly five places each, padded when fewer entered.
  const qualifiers = [];
  for (let w = 1; w <= api.QUALIFIERS; w += 1) {
    const info = weeks[w - 1];
    const entries = info?.entries ?? [];
    const slots: Slot[] = [];
    for (let i = 0; i < api.REWARDED_PER_WEEK; i += 1) {
      slots.push(of(entries[i] ?? null, `s-w${w}-${i}`));
    }
    qualifiers.push({ week: w, total: info ? Number(info.total) : 0, slots });
  }

  // The semi has one place per qualifier week, filled by that week's winner.
  const semiEntries = weeks[api.SEMI - 1]?.entries ?? [];
  const semi: Slot[] = [];
  for (let w = 1; w <= api.QUALIFIERS; w += 1) {
    const carried = semiEntries.find((view) => {
      const origin = view.entry.origin_id[0];
      return origin !== undefined && weekOf.get(origin) === w;
    });
    semi.push(of(carried ?? null, `s-semi-${w - 1}`));
  }

  // The final has two places. A finalist sits on the side its semi place was
  // on, so the bracket stays readable as a descent rather than a re-shuffle.
  const finalEntries = weeks[api.FINAL - 1]?.entries ?? [];
  const semiIndexOf = (id: bigint) => semi.findIndex((slot) => slot.view?.entry.id === id);
  const final: Slot[] = [empty("s-final-0"), empty("s-final-1")];
  const unplaced: SeasonView[] = [];
  for (const view of finalEntries) {
    const origin = view.entry.origin_id[0];
    const from = origin === undefined ? -1 : semiIndexOf(origin);
    const side = from < 0 ? -1 : from < api.QUALIFIERS / 2 ? 0 : 1;
    if (side >= 0 && !final[side].view) final[side] = of(view, final[side].key);
    else unplaced.push(view);
  }
  // Both finalists coming from the same half is legal — the semi is a
  // four-way round, not two pairings. Whoever is left takes the free place.
  for (const view of unplaced) {
    const free = final.findIndex((slot) => !slot.view);
    if (free >= 0) final[free] = of(view, final[free].key);
  }

  const won = finalEntries.find((view) => api.outcomeOf(view.entry) === "won") ?? null;
  const champion: Slot = won
    ? { key: `champ-e${won.entry.id}`, view: won }
    : empty("s-champion");

  return { champion, final, semi, weeks: qualifiers, weekOf };
}

export function SeasonMap({
  season,
  liveWeek,
  canVote,
  votesLeft,
  withdrawalsLocked,
  onVoted,
  reloadKey,
}: {
  /**
   * The season to draw, or `null` before there is one.
   *
   * A null season draws the bracket empty rather than drawing nothing. The
   * shape is the thing somebody arriving early wants to see — six rounds, five
   * places each, two duels and a final — and it is the same shape whether or
   * not anybody has entered yet. An absent map teaches them nothing and reads
   * as a page that failed to load.
   */
  season: SeasonRow | null;
  liveWeek: number;
  canVote: boolean;
  votesLeft: number;
  withdrawalsLocked: boolean;
  onVoted: () => void;
  reloadKey: number;
}) {
  const [weeks, setWeeks] = useState<WeekView[]>([]);
  const [selected, setSelected] = useState<SeasonView | null>(null);
  const [hover, setHover] = useState<{ view: SeasonView; x: number; y: number } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seasonKey = season?.id.toString() ?? "empty";
  /** The season whose request most recently settled, successfully or not. */
  const [settledSeasonKey, setSettledSeasonKey] = useState("");
  /** The season whose map is currently safe to leave on screen during a refresh. */
  const [loadedSeasonKey, setLoadedSeasonKey] = useState("");

  const mapRef = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    // A manual refresh is a background replacement: keep the existing map
    // mounted until the fresh rows arrive. Initial/route loading is still
    // covered by `loading` and the settled-season key below.
    setError(null);

    // Nothing to ask for. `build([])` pads every week out to its full set of
    // empty places, so the bracket draws itself from no data at all.
    if (!season) {
      setWeeks([]);
      setSelected(null);
      setLoadedSeasonKey(seasonKey);
      setSettledSeasonKey(seasonKey);
      setLoading(false);
      return;
    }

    try {
      const rows = await api.seasonMap(season.id);
      if (request !== requestId.current) return;

      setWeeks(rows);
      setLoadedSeasonKey(seasonKey);
      setSettledSeasonKey(seasonKey);
      // Keep the open panel pointed at fresh data — the vote count on the
      // entry you are looking at is the thing most likely to have changed.
      setSelected((current) => {
        if (!current) return null;
        for (const week of rows) {
          for (const view of week.entries) {
            if (view.entry.id === current.entry.id) return view;
          }
        }
        return null;
      });
    } catch (cause) {
      if (request !== requestId.current) return;
      // A failed refresh must not erase a map that was already usable. The
      // error is shown above that stale map; a first-load failure still gets
      // the dedicated error state below.
      setError(cause instanceof Error ? cause.message : String(cause));
      setSettledSeasonKey(seasonKey);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [season, seasonKey]);

  // A route change must never leave the previous season's bracket or modal on
  // screen while the next request is in flight. Invalidating the request also
  // makes late responses harmless.
  useEffect(() => {
    requestId.current += 1;
    setWeeks([]);
    setSelected(null);
    setHover(null);
    setLines([]);
    setError(null);
    boxes.current.clear();
  }, [seasonKey]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  const bracket = build(weeks);

  // Connector geometry is measured, not assumed: box positions depend on how
  // many entries a week has and on how wide the map is drawn.
  useLayoutEffect(() => {
    const draw = () => {
      const root = mapRef.current;
      if (!root) return;
      const origin = root.getBoundingClientRect();
      const out: Line[] = [];

      const edge = (key: string, side: "top" | "bottom") => {
        const element = boxes.current.get(key);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2 - origin.left + root.scrollLeft,
          y: (side === "top" ? rect.top : rect.bottom) - origin.top + root.scrollTop,
        };
      };

      /**
       * Source is always below its target, so every connector leaves the top
       * of one box and enters the bottom of another. The horizontal run sits
       * in the gap between tiers, which is empty by construction.
       */
      const link = (fromKey: string, toKey: string, resolved: boolean) => {
        const from = edge(fromKey, "top");
        const to = edge(toKey, "bottom");
        if (!from || !to) return;
        const laneY = (from.y + to.y) / 2;
        out.push({
          d: orthogonal(
            [
              [from.x, from.y],
              [from.x, laneY],
              [to.x, laneY],
              [to.x, to.y],
            ],
            CORNER,
          ),
          resolved,
        });
      };

      // Week -> semi. Resolved when the place is already taken by that week's
      // winner; projected from the current leader while the week is open.
      bracket.semi.forEach((slot, i) => {
        const week = bracket.weeks[i];
        if (!week) return;
        if (slot.view) {
          const origin_id = slot.view.entry.origin_id[0];
          if (origin_id !== undefined) link(`e${origin_id}`, slot.key, true);
          return;
        }
        const leader = week.slots[0];
        if (leader.view) link(leader.key, slot.key, false);
      });

      // Semi -> final, one line per duel, leaving the middle of the pairing.
      // Final place i is fed by duel i: build() seats a finalist on the side
      // its semi place was on, so the sides line up.
      bracket.final.forEach((slot, i) => {
        link(SEMI_DUEL(i), slot.key, Boolean(slot.view));
      });

      // Final -> champion, likewise off the pairing rather than off whichever
      // place is currently ahead.
      link(FINAL_DUEL, bracket.champion.key, Boolean(bracket.champion.view));

      setLines(out);
    };

    draw();
    const observer = new ResizeObserver(draw);
    if (mapRef.current) observer.observe(mapRef.current);
    window.addEventListener("resize", draw);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", draw);
    };
    // `bracket` is derived from `weeks`; selection changes the map width.
  }, [weeks, selected]);

  if (loading || settledSeasonKey !== seasonKey) {
    return (
      <p className="muted" role="status">
        Loading the map…
      </p>
    );
  }

  if (error && loadedSeasonKey !== seasonKey) {
    return (
      <div className="notice error" role="alert">
        <p>Could not load the season map: {error}</p>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const registerKey = (key: string) => (element: HTMLElement | null) => {
    if (element) boxes.current.set(key, element);
    else boxes.current.delete(key);
  };
  const register = (slot: Slot) => registerKey(slot.key);

  const box = (slot: Slot, size: "sm" | "md" | "lg" | "xl") => (
    <Box
      key={slot.key}
      slot={slot}
      size={size}
      selected={Boolean(slot.view) && selected?.entry.id === slot.view?.entry.id}
      register={register(slot)}
      onHover={setHover}
      onSelect={() => slot.view && setSelected(slot.view)}
    />
  );

  return (
    <>
      {error ? (
        <div className="notice error" role="alert">
          <p>Could not refresh the season map. The last loaded map is still shown: {error}</p>
          <button type="button" className="btn ghost small" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : null}

      <div className="map-pane">
        <AwardDefs />
        <div className="bracket" ref={mapRef}>
          <svg className="map-lines" aria-hidden="true">
            {lines.map((line, i) => (
              <path
                key={i}
                d={line.d}
                className={line.resolved ? "link resolved" : "link"}
                fill="none"
              />
            ))}
          </svg>

          <div className="tier tier-champion">
            <div className="place">
              <span className="tier-label">
                <Award medal="gold" size={14} />
                Grand prize
              </span>
              {box(bracket.champion, "xl")}
            </div>
          </div>

          {/* One duel: the two survivors meet for the grand prize. */}
          <div className="tier tier-final">
            <Duel
              left={box(bracket.final[0], "lg")}
              right={box(bracket.final[1], "lg")}
              register={registerKey(FINAL_DUEL)}
            />
            <TierName label="Final" week={api.FINAL} season={season} />
          </div>

          {/* Two duels: week 1 v week 2, week 3 v week 4 (see the Rules page). */}
          <div className="tier tier-semi">
            <Duel
              left={box(bracket.semi[0], "md")}
              right={box(bracket.semi[1], "md")}
              register={registerKey(SEMI_DUEL(0))}
            />
            <Duel
              left={box(bracket.semi[2], "md")}
              right={box(bracket.semi[3], "md")}
              register={registerKey(SEMI_DUEL(1))}
            />
            <TierName label="Semi-final" week={api.SEMI} season={season} medal="silver" />
          </div>

          <div className="tier tier-weeks">
            {bracket.weeks.map((week) => {
              const hidden = week.total - week.slots.filter((s) => s.view).length;
              return (
                <div className="week-group" key={week.week}>
                  <div className="week-row">{week.slots.map((slot) => box(slot, "sm"))}</div>
                  <span className={week.week === liveWeek ? "week-tag live" : "week-tag"}>
                    <Award medal="bronze" size={12} />
                    Week {week.week}
                    {week.week === liveWeek ? <em>live</em> : null}
                    {hidden > 0 ? <em className="more">+{hidden}</em> : null}
                  </span>
                  <When season={season} week={week.week} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected ? (
        <EntryModal
          view={selected}
          canVote={canVote && Number(selected.entry.week) === liveWeek}
          votesLeft={votesLeft}
          withdrawalsLocked={withdrawalsLocked}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            await load();
            onVoted();
          }}
        />
      ) : null}

      {hover && !selected ? <Popout {...hover} /> : null}
    </>
  );
}

/** Two places facing each other. The `vs` is the pairing, not decoration. */
function Duel({
  left,
  right,
  register,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  register?: (element: HTMLElement | null) => void;
}) {
  return (
    <div className="duel" ref={register}>
      {left}
      <span className="vs" aria-label="versus">
        vs
      </span>
      {right}
    </div>
  );
}

function TierName({
  label,
  week,
  season,
  medal,
}: {
  label: string;
  week: number;
  season: SeasonRow | null;
  /** The cup handed out at this stage, if one is. */
  medal?: api.Medal;
}) {
  return (
    <span className="tier-name">
      <span className="tier-line">
        {label}
        {medal ? <Award medal={medal} size={13} /> : null}
      </span>
      <When season={season} week={week} inline />
    </span>
  );
}

/**
 * When a round is decided.
 *
 * Only the open round has a deadline the organisers are held to; later rounds
 * are projected a week apart from it, and closed rounds have no retained date
 * (see Judging on the Rules page). Saying "decided" beats inventing a
 * timestamp.
 */
function When({
  season,
  week,
  inline = false,
}: {
  season: SeasonRow | null;
  week: number;
  inline?: boolean;
}) {
  // No season, no dates. The bracket still draws — the shape is the point —
  // but a week with no season has no deadline to promise and should not
  // invent one.
  if (!season) return null;

  const live = Number(season.week);
  const phase = api.phaseOf(season);
  const className = inline ? "when inline" : "when";

  if (phase === "finished" || week < live) {
    return <span className={`${className} done`}>decided</span>;
  }
  const due = api.deadlineFor(season, week);
  if (!due) return null;

  const isLive = week === live;
  return (
    <span className={isLive ? `${className} due` : className} title={due.toLocaleString()}>
      {isLive ? "voting ends " : "~"}
      {api.formatDay(due)}
      {isLive ? <em>{api.relativeDay(due)}</em> : null}
    </span>
  );
}

function Box({
  slot,
  size,
  selected,
  register,
  onHover,
  onSelect,
}: {
  slot: Slot;
  size: "sm" | "md" | "lg" | "xl";
  selected: boolean;
  register: (element: HTMLElement | null) => void;
  onHover: (state: { view: SeasonView; x: number; y: number } | null) => void;
  onSelect: () => void;
}) {
  const view = slot.view;
  const medal = view ? api.medalFor(view.entry) : null;
  const icon = view ? (view.entry.icon[0] ?? null) : null;

  const classes = ["map-box", size];
  if (!view) classes.push("empty");
  if (medal) classes.push(`medal-${medal}`);
  if (selected) classes.push("on");
  if (view?.voted) classes.push("voted");

  const track = (event: React.MouseEvent) => {
    if (!view) return;
    onHover({ view, x: event.clientX, y: event.clientY });
  };

  return (
    <button
      ref={register}
      className={classes.join(" ")}
      disabled={!view}
      onClick={onSelect}
      onMouseEnter={track}
      onMouseMove={track}
      onMouseLeave={() => onHover(null)}
      onFocus={(event) => {
        if (!view) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onHover({ view, x: rect.right, y: rect.top });
      }}
      onBlur={() => onHover(null)}
      title={view ? view.entry.title : "Undecided"}
      aria-label={view ? `${view.entry.title} by ${view.displayName}` : "Undecided place"}
    >
      {icon ? (
        <img src={icon} alt="" loading="lazy" />
      ) : view ? (
        <span className="map-initial">{view.entry.title.trim().charAt(0).toUpperCase()}</span>
      ) : null}
      {view ? <span className="map-votes">{Number(view.entry.votes)}</span> : null}
      {medal ? (
        <span className={`map-award ${medal}`}>
          <Award medal={medal} size={size === "sm" ? 13 : size === "xl" ? 20 : 15} />
        </span>
      ) : null}
    </button>
  );
}

/**
 * Follows the cursor. Enough to decide whether the full panel is worth it.
 *
 * Exported because the judge's voting queue shows the same thing — one card,
 * so hovering a box in the bracket and hovering the same app in the queue are
 * not two different summaries of it.
 */
export function Popout({ view, x, y }: { view: SeasonView; x: number; y: number }) {
  const icon = view.entry.icon[0] ?? null;
  const medal = api.medalFor(view.entry);
  const votes = Number(view.entry.votes);

  // Flip before the card would run off the right or bottom edge.
  const width = 280;
  const left = Math.min(x + 16, window.innerWidth - width - 12);
  const top = Math.min(y + 16, window.innerHeight - 190);

  return (
    <div className="map-popout" style={{ left, top, width }} role="tooltip">
      <div className="map-popout-head">
        {icon ? <img className="map-popout-icon" src={icon} alt="" /> : null}
        <div>
          <strong>{view.entry.title}</strong>
          <small className="muted">
            {view.displayName} <em>@{view.handle}</em>
          </small>
        </div>
      </div>
      {view.title[0] ? <small className="muted">{view.title[0]}</small> : null}
      <p>{view.entry.summary || "No summary."}</p>
      <div className="map-popout-foot">
        <span>
          {votes} {votes === 1 ? "vote" : "votes"}
        </span>
        {medal ? (
          <span className={`medal-tag ${medal}`}>
            <Award medal={medal} size={13} />
            {medal}
          </span>
        ) : null}
        {view.mine ? <span className="muted">yours</span> : null}
      </div>
    </div>
  );
}
