/**
 * Icons for profile links.
 *
 * The `kind` is free text a user typed, so it cannot be trusted to be one of a
 * fixed set. The host is the stronger signal — "github.com" means the same
 * thing whether somebody labelled it "code", "repo" or "my stuff" — so that is
 * checked first, with the label as a fallback and a globe as the backstop.
 *
 * All stroke-based on `currentColor` to match the rest of the theme; no brand
 * marks, which would need per-logo fills and licence checks for no real gain.
 */

type IconName =
  | "code"
  | "book"
  | "briefcase"
  | "pulse"
  | "shield"
  | "image"
  | "at"
  | "video"
  | "chat"
  | "globe";

const BY_HOST: [RegExp, IconName][] = [
  [/(^|\.)(github|gitlab|codeberg|sr\.ht|bitbucket)\./, "code"],
  [/(^|\.)(mastodon|mas\.to|fosstodon|bsky|threads)\./, "at"],
  [/(^|\.)(twitter|x)\.com$/, "at"],
  [/(^|\.)(dribbble|behance|figma|are\.na)\./, "image"],
  [/(^|\.)(youtube|youtu\.be|vimeo|twitch)\./, "video"],
  [/(^|\.)(discord|slack|matrix|t\.me|telegram)\./, "chat"],
  [/(^|\.)(medium|substack|dev\.to|hashnode)\./, "book"],
  [/^status\./, "pulse"],
  [/^docs?\./, "book"],
];

const BY_LABEL: [RegExp, IconName][] = [
  [/git|repo|code|source/, "code"],
  [/doc|paper|blog|writ|read|note|book|zine/, "book"],
  [/job|career|hiring|work/, "briefcase"],
  [/status|uptime|health|metric/, "pulse"],
  [/security|advisor|cve|disclos/, "shield"],
  [/design|portfolio|dribbble|art|photo|gallery/, "image"],
  [/mastodon|twitter|social|bluesky|fediverse/, "at"],
  [/video|stream|talk|youtube/, "video"],
  [/chat|discord|slack|telegram|matrix|forum/, "chat"],
];

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function iconFor(kind: string, url: string): IconName {
  const host = hostOf(url);
  for (const [pattern, name] of BY_HOST) {
    if (pattern.test(host)) return name;
  }
  const label = kind.toLowerCase();
  for (const [pattern, name] of BY_LABEL) {
    if (pattern.test(label)) return name;
  }
  return "globe";
}

const PATHS: Record<IconName, React.ReactNode> = {
  code: (
    <>
      <polyline points="15 17 20 12 15 7" />
      <polyline points="9 7 4 12 9 17" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2.5" y="7" width="19" height="13" rx="2" />
      <path d="M8.5 7V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2" />
      <path d="M2.5 12h19" />
    </>
  ),
  pulse: <polyline points="22 12 17.5 12 14.5 20 9.5 4 6.5 12 2 12" />,
  shield: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.4-7.5 9.5-4.4-1.1-7.5-4.9-7.5-9.5V6z" />
      <polyline points="9 12 11 14 15 10" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="M21 16l-5-5-9 8.5" />
    </>
  ),
  at: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="5.5" width="14" height="13" rx="2" />
      <polygon points="16.5 10.5 22 7.5 22 16.5 16.5 13.5" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.9A8 8 0 1 1 21 12z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </>
  ),
};

export function LinkIcon({ kind, url }: { kind: string; url: string }) {
  return (
    <svg
      className="link-icon"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[iconFor(kind, url)]}
    </svg>
  );
}
