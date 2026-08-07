import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/**
 * A numbered footnote — `(3)` — that opens what it says.
 *
 * The rules have a long tail of exceptions: what happens on a tie, what a week
 * with two entrants pays, what an empty half of the bracket does. All of it is
 * true and almost none of it matters on a first read, so it hides behind a
 * marker rather than doubling the length of every paragraph.
 *
 * Hovering opens it, which is what a footnote marker looks like it should do.
 * Clicking pins it, so it survives the mouse moving away; tapping does the same
 * thing, which is what makes it work on a phone where there is no hover at all.
 * The hover handlers ignore anything that is not a mouse, so a tap does not
 * open and immediately toggle shut.
 *
 * ## Why the panel is a popover
 *
 * It used to be `position: absolute` inside the marker's wrapper, which meant
 * any ancestor with `overflow: hidden` cut it off — and these markers live
 * inside cards, which have exactly that. The text was there and unreadable.
 *
 * Escaping it by hunting down every clipping ancestor is a losing game: the
 * next card that gets `overflow: hidden` for a rounded corner breaks it again,
 * somewhere nobody is looking. `popover` puts the panel in the browser's top
 * layer instead, where `overflow`, `z-index` and transforms on ancestors
 * cannot reach it — which is the one guarantee that holds however the page
 * around it is restyled.
 *
 * The cost is that the top layer has no layout relationship to the marker, so
 * the position has to be computed. `place` does that, and flips above or
 * clamps sideways when there is not room, which absolute positioning never did
 * either — a marker near the bottom of the viewport used to open a panel half
 * off the screen.
 */

/** The text behind each marker. Order here is the numbering on the page. */
export type NoteSpec = { id: string; body: string };

export function Note({ id, notes }: { id: string; notes: NoteSpec[] }) {
  const index = notes.findIndex((note) => note.id === id);
  const spec = notes[index];
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const marker = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLSpanElement | null>(null);
  const panelId = useId();
  const open = hovered || pinned;

  /**
   * Put the panel under its marker, in viewport coordinates.
   *
   * Fixed rather than absolute because the top layer has no containing block to
   * be absolute *to*. Below the marker by preference, above it when the bottom
   * of the viewport is closer than the panel is tall, and clamped to an 8px
   * margin either side so a marker at the edge of the line does not open
   * something half off the screen.
   */
  const place = useCallback(() => {
    const box = panel.current;
    const from = marker.current;
    if (!box || !from) return;

    const anchor = from.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const GAP = 8;

    const below = anchor.bottom + GAP;
    const flip = below + size.height > window.innerHeight && anchor.top > size.height + GAP;
    box.style.top = `${flip ? anchor.top - size.height - GAP : below}px`;

    const centred = anchor.left + anchor.width / 2 - size.width / 2;
    const highest = window.innerWidth - size.width - GAP;
    box.style.left = `${Math.max(GAP, Math.min(centred, highest))}px`;
    box.dataset.flip = flip ? "up" : "down";
  }, []);

  useLayoutEffect(() => {
    const box = panel.current;
    if (!open || !box) return;
    // `showPopover` throws if it is already open, which React's strict-mode
    // double-invoke makes reachable.
    if (!box.matches(":popover-open")) box.showPopover();
    place();

    // The top layer does not move with the page, so anything that shifts the
    // marker has to be followed. Capture, because the scroll may be on any
    // ancestor rather than the window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!pinned) return;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setPinned(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [pinned]);

  // A marker whose text went missing should be silent rather than render "(0)".
  if (!spec) return null;

  const mouseOnly = (then: () => void) => (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") then();
  };

  return (
    <span
      className="note-wrap"
      ref={wrap}
      onPointerEnter={mouseOnly(() => setHovered(true))}
      onPointerLeave={mouseOnly(() => setHovered(false))}
    >
      <button
        type="button"
        ref={marker}
        className={open ? "note on" : "note"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setPinned((was) => !was)}
        // Keyboard users get the same thing tabbing through as hovering.
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        {index + 1}
      </button>
      {open ? (
        <span
          className="note-body"
          id={panelId}
          role="note"
          ref={panel}
          // "manual" rather than "auto": dismissal is already handled above —
          // hover, a click away, Escape — and "auto" would additionally close
          // it whenever another popover opened, which is not the behaviour a
          // footnote wants.
          popover="manual"
        >
          {spec.body}
        </span>
      ) : null}
    </span>
  );
}
