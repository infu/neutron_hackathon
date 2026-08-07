import * as api from "../api";

/**
 * Gradient and shine definitions for the awards, mounted once per page.
 *
 * Defined here rather than inside each `<Award>` because gradients are
 * referenced by id — repeating them per instance would put dozens of
 * duplicate ids in the document and let the first one win by accident.
 */
export function AwardDefs() {
  const metals: [api.Medal, string, string, string][] = [
    ["bronze", "#7d3d17", "#c8783c", "#e8a877"],
    ["silver", "#5c6675", "#a9b3c0", "#e4e9ef"],
    ["gold", "#8a6100", "#e8b323", "#fff1a8"],
  ];
  return (
    <svg className="award-defs" aria-hidden="true" focusable="false">
      <defs>
        {metals.map(([medal, dark, mid, light]) => (
          <linearGradient key={medal} id={`award-${medal}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={light} />
            <stop offset="42%" stopColor={mid} />
            <stop offset="100%" stopColor={dark} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}

/**
 * What a tier looks like: bronze is a medal on a ribbon, silver and gold are
 * cups. The shape carries the tier alongside the colour, which is what makes
 * them tell apart at thirteen pixels where hue alone could not.
 *
 * Between the two cups it is size and shine that separate them — gold is
 * drawn larger, carries a second highlight, and gets a glow in the stylesheet.
 */
export function Award({ medal, size = 16 }: { medal: api.Medal; size?: number }) {
  const cup = medal !== "bronze";
  // A cup is narrower than a disc, so it needs a little more room to read at
  // the same weight; gold takes more still, being the one that has to stand out.
  const scaled = Math.round(size * (medal === "gold" ? 1.3 : cup ? 1.12 : 1));
  const fill = `url(#award-${medal})`;
  const common = {
    className: `award ${medal}`,
    viewBox: "0 0 24 24",
    width: scaled,
    height: scaled,
    "aria-hidden": true as const,
    focusable: "false" as const,
  };

  if (cup) {
    return (
      <svg {...common}>
        <path d="M7.5 3h9v5.5a4.5 4.5 0 0 1-9 0V3z" fill={fill} />
        <path
          d="M7.5 4.5H4.2v1.6a3.2 3.2 0 0 0 3.3 3.2M16.5 4.5h3.3v1.6a3.2 3.2 0 0 1-3.3 3.2"
          fill="none"
          stroke={fill}
          strokeWidth="1.8"
        />
        <path d="M11 12.6h2V17h-2z" fill={fill} />
        <path d="M7.8 21.2l1-3.2h6.4l1 3.2z" fill={fill} />
        {/* Specular highlights — what makes it read as metal, not a shape. */}
        <path d="M9.3 4.1h1.7v4a.85.85 0 0 1-1.7 0z" fill="#fff" opacity="0.55" />
        {medal === "gold" ? (
          <path d="M13.9 4.1h.9v3a.45.45 0 0 1-.9 0z" fill="#fff" opacity="0.35" />
        ) : null}
      </svg>
    );
  }

  return (
    <svg {...common}>
      {/* Bronze: a medal. Ribbon in the darker ink so the disc reads as metal. */}
      <path d="M7.6 1.8h3.1l2.1 8.1h-3.1z" fill="currentColor" />
      <path d="M16.4 1.8h-3.1l-2.1 8.1h3.1z" fill="currentColor" opacity="0.72" />
      <circle cx="12" cy="15.6" r="6.6" fill={fill} />
      <circle
        cx="12"
        cy="15.6"
        r="3.9"
        fill="none"
        stroke="#fff"
        strokeWidth="1.1"
        opacity="0.4"
      />
      <path
        d="M8.1 12.6a5.4 5.4 0 0 1 3.3-2.3"
        fill="none"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}
