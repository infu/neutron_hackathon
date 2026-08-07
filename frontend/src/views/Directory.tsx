import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../api";
import type { Cursor, FilterName, LetterCount, PublicUser } from "../api";
import { PersonCard } from "./PersonCard";

const PAGE_SIZE = 24;

/** Renders the strip at full height before counts arrive, so it never pops in. */
const PLACEHOLDER: LetterCount[] = ["#", ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ")].map(
  (letter) => ({ letter, count: 0n }),
);

/**
 * The single people directory.
 *
 * One page with tabs rather than separate routes: judges, hackers and
 * moderators are all just users, and the only thing that changes between them
 * is a filter the backend already indexes.
 */
const TABS: { id: FilterName; label: string; blurb: string }[] = [
  { id: "judges", label: "Judges", blurb: "judging" },
  { id: "hackers", label: "Hackers", blurb: "building something" },
  { id: "sponsors", label: "Sponsors", blurb: "backing the event" },
  { id: "observers", label: "Observers", blurb: "here to watch" },
  { id: "moderators", label: "Moderators", blurb: "moderating the event" },
  { id: "all", label: "Everyone", blurb: "registered" },
];

export function Directory({ initial = "judges" }: { initial?: FilterName }) {
  const [filter, setFilter] = useState<FilterName>(initial);
  const [letter, setLetter] = useState<string | null>(null);

  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [total, setTotal] = useState(0);
  const [buckets, setBuckets] = useState<LetterCount[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  // Guards against a slow response for an abandoned request overwriting a
  // newer one.
  const requestId = useRef(0);

  useEffect(() => setFilter(initial), [initial]);

  const loadFirstPage = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await api.listPage(filter, letter, null, PAGE_SIZE);
      if (id !== requestId.current) return;
      setUsers(page.rows);
      setCursor(page.next[0] ?? null);
      setTotal(Number(page.total));
    } catch (cause) {
      if (id !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setUsers([]);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [filter, letter]);

  useEffect(() => {
    if (!searching) void loadFirstPage();
    // `searching` is intentionally excluded: the search effect below owns that
    // transition and would otherwise double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFirstPage]);

  // The A-Z strip is driven by index counts, so it knows what exists without
  // any rows being fetched.
  useEffect(() => {
    let live = true;
    void api
      .letterCounts(filter)
      .then((counts) => live && setBuckets(counts))
      .catch(() => live && setBuckets([]));
    return () => {
      live = false;
    };
  }, [filter]);

  // Debounced search. Clearing the box falls back to the paged listing.
  useEffect(() => {
    const term = query.trim();
    if (term === "") {
      void loadFirstPage();
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setLoading(true);
      try {
        const hits = await api.searchUsers(term, filter, 60);
        if (id !== requestId.current) return;
        setUsers(hits);
        setCursor(null);
        setError(null);
      } catch (cause) {
        if (id !== requestId.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (id === requestId.current) {
          setBusy(false);
          setLoading(false);
        }
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query, filter, loadFirstPage]);

  const loadMore = async () => {
    if (!cursor || busy) return;
    setBusy(true);
    const id = requestId.current;
    try {
      const page = await api.listPage(filter, letter, cursor, PAGE_SIZE);
      if (id !== requestId.current) return;
      setUsers((current) => [...(current ?? []), ...page.rows]);
      setCursor(page.next[0] ?? null);
      setTotal(Number(page.total));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const pick = (next: FilterName) => {
    setQuery("");
    setLetter(null);
    setFilter(next);
  };

  const tab = TABS.find((t) => t.id === filter) ?? TABS[0];
  const shown = users?.length ?? 0;

  return (
    <section className="directory">
      <header className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted count-line">
            {users === null
              ? "Loading…"
              : searching
                ? `${shown} match${shown === 1 ? "" : "es"}`
                : `${shown} of ${total} ${tab.blurb}${letter ? ` · ${letter}` : ""}`}
          </p>
        </div>
        <div className="head-tools">
          <input
            className="search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search handle…"
            aria-label="Search by handle"
            spellCheck={false}
          />
        </div>
      </header>

      <nav className="tabs" aria-label="Filter people">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === filter ? "active" : undefined}
            onClick={() => pick(t.id)}
          >
            {t.label}
          </button>
        ))}
        {filter === "judges" ? (
          <a className="btn ghost small tabs-cta" href="#/profile">
            Want to judge?
          </a>
        ) : null}
      </nav>

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="alphabet-slot" hidden={searching}>
        <AlphabetIndex buckets={buckets} active={letter} onPick={setLetter} />
      </div>

      <div className={loading ? "results loading" : "results"}>
        {shown > 0 ? (
          <div className={filter === "sponsors" ? "person-grid sponsors" : "person-grid"}>
            {users?.map((user) => (
              <PersonCard
                key={String(user.id)}
                user={user}
                // Redundant on a page that is entirely judges.
                  showJudgeBadge={filter !== "judges"}
                asSponsor={filter === "sponsors"}
              />
            ))}
          </div>
        ) : null}

        {!loading && users !== null && shown === 0 ? (
          <p className="empty-state">
            {searching
              ? `No handle starts with "${query.trim()}"`
              : letter
                ? `Nobody under ${letter}`
                : `No ${tab.label.toLowerCase()} yet`}
          </p>
        ) : null}
      </div>

      {cursor && !searching ? (
        <div className="more">
          <button className="btn ghost" onClick={loadMore} disabled={busy}>
            {busy ? "Loading…" : `Load more (${total - shown} left)`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A–Z strip backed by server-side bucket counts, so picking a letter seeks
 * straight to it. Nothing before the chosen letter is ever fetched, which is
 * the whole point at a thousand users.
 */
function AlphabetIndex({
  buckets,
  active,
  onPick,
}: {
  buckets: LetterCount[];
  active: string | null;
  onPick: (letter: string | null) => void;
}) {
  const ready = buckets.length > 0;

  return (
    <nav className="alphabet" aria-label="Jump to letter">
      <button
        type="button"
        className={active === null ? "active" : undefined}
        onClick={() => onPick(null)}
      >
        All
      </button>
      {(ready ? buckets : PLACEHOLDER).map(({ letter, count }) => (
        <button
          key={letter}
          type="button"
          disabled={count === 0n}
          title={count > 0n ? `${count}` : undefined}
          className={active === letter ? "active" : undefined}
          onClick={() => onPick(letter)}
        >
          {letter}
        </button>
      ))}
    </nav>
  );
}
