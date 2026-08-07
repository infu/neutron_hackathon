import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import * as api from "./api";
import type { Store, User } from "./api";
import { isAuthenticated, login, logout } from "./ic";

import { Build } from "./views/Build";
import { Directory } from "./views/Directory";
import { Landing } from "./views/Landing";
import { Moderate } from "./views/Moderate";
import { Profile, PROFILE_TABS, type ProfileTab } from "./views/Profile";
import { PublicProfile } from "./views/PublicProfile";
import { Rules } from "./views/Rules";
import { Signup } from "./views/Signup";
import { Season } from "./views/Season";

/**
 * Hash routing, deliberately.
 *
 * The canister serves exact asset keys only and every served path has to be
 * individually certified, so there is no `/foo -> /index.html` fallback to
 * hang a history-API router on. Everything after `#` never reaches the
 * canister, which sidesteps the problem entirely.
 */
export type ModerateTab =
  | "judges"
  | "sponsors"
  // Two queues rather than one: an entry waiting to be published is work a
  // moderator chooses to do, a takedown notice is work somebody else has
  // handed them. Counting them together hides whichever is smaller.
  | "review"
  | "notices"
  | "season"
  | "payout"
  | "cost"
  | "find"
  | "log";

const MODERATE_TABS: ModerateTab[] = [
  "judges",
  "sponsors",
  "review",
  "notices",
  "season",
  "payout",
  "cost",
  "find",
  "log",
];

export type Route =
  | { name: "home" }
  | { name: "register" }
  | { name: "profile"; tab: ProfileTab; entryId: bigint | null }
  | { name: "season"; number: number | null }
  | { name: "people"; filter: "judges" | "all" | "moderators" }
  | { name: "moderate"; tab: ModerateTab }
  | { name: "rules" }
  | { name: "build" }
  | { name: "user"; handle: string };

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [head, tail, target] = path.split("/");
  switch (head) {
    case "register":
      return { name: "register" };
    case "rules":
      return { name: "rules" };
    case "build":
      return { name: "build" };
    case "profile":
      {
        // `-1n` is an impossible Nat64 and preserves the fact that an explicit
        // malformed target was supplied. The editor then refuses it instead of
        // silently choosing the caller's first app.
        let entryId: bigint | null =
          tail === "entries" && target !== undefined ? -1n : null;
        if (
          tail === "entries" &&
          target !== undefined &&
          /^[0-9]+$/.test(target)
        ) {
          try {
            const parsed = BigInt(target);
            if (parsed <= 18_446_744_073_709_551_615n) entryId = parsed;
          } catch {
            entryId = null;
          }
        }
      return {
        name: "profile",
        tab: PROFILE_TABS.includes(tail as ProfileTab) ? (tail as ProfileTab) : "overview",
        entryId,
      };
      }
    case "season": {
      // #/season shows whatever is current; #/season/2 pins a past one.
      const number = tail ? Number(tail) : NaN;
      return { name: "season", number: Number.isFinite(number) ? number : null };
    }
    case "moderate":
      return {
        name: "moderate",
        tab: MODERATE_TABS.includes(tail as ModerateTab) ? (tail as ModerateTab) : "judges",
      };
    // One directory with tabs. The old routes still resolve so links and
    // bookmarks keep working; they just pick a starting tab.
    case "people":
      return {
        name: "people",
        filter: tail === "all" || tail === "moderators" ? tail : "judges",
      };
    case "participants":
      return { name: "people", filter: "all" };
    case "judges":
      // Judging is opted into from your own profile, not a separate signup.
      // Applying is one of the profile's own sections now.
      return tail === "apply"
        ? { name: "profile", tab: "roles", entryId: null }
        : { name: "people", filter: "judges" };
    case "u":
      return tail ? { name: "user", handle: tail } : { name: "people", filter: "all" };
    default:
      return { name: "home" };
  }
}

export function navigate(route: string): void {
  window.location.hash = route;
}

function isDirectory(route: Route): boolean {
  return route.name === "people";
}

function configuredLedgerIds(config: Store | null): string[] {
  return config?.ledgerAllowlist.map((ledger) => ledger.toText()) ?? [];
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [signedIn, setSignedIn] = useState(false);
  const [me, setMe] = useState<User | null>(null);
  const [config, setConfig] = useState<Store | null>(null);
  const [moderator, setModerator] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const focusedHash = useRef(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // Preserve the browser's normal initial-page focus. Subsequent hash routes
    // are client-side navigation, so they have to supply the scroll and focus
    // movement a full page load would have supplied.
    if (focusedHash.current === window.location.hash) return;
    focusedHash.current = window.location.hash;

    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0 });
      const heading = mainRef.current?.querySelector<HTMLElement>("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      } else {
        mainRef.current?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [route]);

  const refresh = useCallback(async () => {
    try {
      const authed = await isAuthenticated();
      setSignedIn(authed);
      const [cfg, profile, isMod] = await Promise.all([
        api.getConfig(),
        authed ? api.getMe() : Promise.resolve(null),
        authed ? api.amModerator() : Promise.resolve(false),
      ]);
      setConfig(cfg);
      setMe(profile);
      setModerator(isMod);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSignIn = async () => {
    try {
      await login();
      await refresh();
      // A signed-in stranger has nothing to look at but the form.
      if (!(await api.getMe())) navigate("#/register");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const onSignOut = async () => {
    await logout();
    setMe(null);
    setSignedIn(false);
    setModerator(false);
    navigate("#/");
  };

  return (
    <div className="app">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          // Do not let the hash router interpret the fragment as a route.
          event.preventDefault();
          mainRef.current?.focus();
          mainRef.current?.scrollIntoView();
        }}
      >
        Skip to main content
      </a>
      <header className="topbar">
        <a className="brand" href="#/">
          {config?.siteTitle ?? "Neutron Hackathon"}
        </a>

        <nav className="nav">
          <NavLink href="#/season" route={route} match="season">
            Season
          </NavLink>
          <NavLink href="#/people" route={route} match="people">
            People
          </NavLink>
          {/* In the navigation, not buried in signup. It is the one document
              everybody agrees to, and somebody deciding whether to take part
              should be able to read it before they start. */}
          <NavLink href="#/rules" route={route} match="rules">
            Rules
          </NavLink>
          {me ? (
            <NavLink href="#/profile" route={route} match="profile">
              Profile
            </NavLink>
          ) : null}
          {moderator ? (
            <NavLink href="#/moderate" route={route} match="moderate">
              Moderate
            </NavLink>
          ) : null}
          <NavLink href="#/build" route={route} match="build">
            Build
          </NavLink>
        </nav>

        <div className="session">
          {signedIn ? (
            <>
              {me ? (
                <span className="who">@{me.handle}</span>
              ) : route.name !== "register" && config?.registrationOpen ? (
                // Signed in but no profile yet. This is the only prompt on
                // most pages, so it lives in the bar rather than the homepage.
                //
                // Shown only once the config says registration is *known* open
                // — while it is still loading there is nothing to finish, and
                // offering to would mean prompting somebody through a door
                // that turns out to be shut a moment later.
                <a className="btn small finish" href="#/register" title="Finish signing up">
                  <UserPlusIcon />
                  <span className="finish-label">Finish signing up</span>
                </a>
              ) : null}
              <button className="btn ghost small" onClick={onSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <button className="btn small" onClick={onSignIn}>
              Sign in
            </button>
          )}
        </div>
      </header>

      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}

      {/* Directory pages break out to a wider column so four cards still get
          room; reading-oriented pages stay narrow. */}
      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        className={isDirectory(route) ? "main wide" : "main"}
      >
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : (
          <Router
            route={route}
            me={me}
            signedIn={signedIn}
            config={config}
            onSignIn={onSignIn}
            onProfileChange={setMe}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}

/**
 * What this is, and how to check that it is.
 *
 * Two things live down here because they belong to nobody's page: the claim
 * the whole thing rests on — nobody takes custody of the money, nobody can
 * change the code once entries are in — and the report button, which is aimed
 * squarely at people who are not participants and never will be.
 */
function Footer() {
  const [reporting, setReporting] = useState(false);

  return (
    <>
      <footer className="footer">
        <div className="footer-about">
          <p>
            A non-custodial hackathon protocol. Sponsors' prize money is held in
            accounts this canister controls and paid straight to the wallet each
            winner set — it is never anybody's to hold, spend, or send
            somewhere else.
          </p>
          {/*
            Stated flatly, because there is only one way it works. This used to
            branch on a deployment setting that let a season run unsealed — two
            kinds of season that looked identical from outside and meant
            different things, which is precisely the thing a paragraph like
            this must not do. A season that cannot seal now does not start.

            The public Rules page explains the self-controlled seal, fixed DAO
            recovery, and how to verify both against the management canister.
          */}

        </div>

        <div className="footer-tail">
          <span>Running on Internet Computer Protocol</span>
          <button className="btn ghost small" onClick={() => setReporting(true)}>
            Report content
          </button>
        </div>
      </footer>

      {/* Outside the <footer>, deliberately: `.footer` sets a small monospace
          face for machine text, and a form that inherited it would be a form
          nobody can read. */}
      {reporting ? <NoticeDialog onClose={() => setReporting(false)} /> : null}
    </>
  );
}

/** Mirrors Notices.MAX_BODY. */
const NOTICE_MAX = 500;

/**
 * Report content that should not be here.
 *
 * Open to anybody, signed in or not — and that is the point rather than an
 * oversight. The people who need this channel are by construction not
 * participants: a rights holder who finds their artwork in an entry has no
 * account here and no reason to make one.
 *
 * Native <dialog> for the reasons Confirm.tsx gives — modality, focus
 * containment and Escape come from the platform instead of being rebuilt.
 */
function NoticeDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // showModal, not `open`: that is what puts it in the top layer and traps
    // focus.
    ref.current?.showModal();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const notice = await api.fileNotice(body.trim());
      setFiled(notice.id);
    } catch (cause) {
      // Three an hour per caller, and everyone reporting anonymously shares
      // one principal and therefore one bucket. The refusal carries how long
      // is left, so it is shown as it comes — the number is the useful part.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const left = NOTICE_MAX - body.length;

  /**
   * Close the element and let its own `close` event unmount us, rather than
   * unmounting on the spot. Doing it in that order is what hands focus back to
   * the button that opened this; pulling an open dialog out of the DOM drops
   * focus onto the body, which is nowhere.
   */
  const dismiss = () => ref.current?.close();

  return (
    <dialog
      className="dialog"
      ref={ref}
      // Fires for Escape as well as an explicit close, so leaving is handled in
      // one place.
      onClose={onClose}
      onClick={(event) => {
        // Only the backdrop is the dialog itself; anything inside is caught by
        // a child.
        if (event.target === ref.current) dismiss();
      }}
      aria-labelledby="notice-title"
    >
      <form className="dialog-form" onSubmit={submit}>
        <h2 id="notice-title">Report content</h2>

        {filed === null ? (
          <>
            <p className="muted">
              Tell us what is wrong, which entry it is on, and how to reach you.
              A moderator reads every notice — nothing is taken down
              automatically, and nothing here reaches the entrant.
            </p>

            <label>
              <span>What is wrong</span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={NOTICE_MAX}
                rows={6}
                placeholder="Which entry, what the problem is, and how to reach you."
                autoFocus
              />
              <small>{left} characters left</small>
            </label>

            {error ? (
              <p className="notice error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="dialog-actions">
              <button type="button" className="btn ghost small" onClick={dismiss}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn small"
                disabled={busy || body.trim().length === 0}
              >
                {busy ? "Sending…" : "File notice"}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* The id is the receipt: it is what a moderator will refer to, and
                a reporter with no account here has nothing else to keep. */}
            <p className="notice ok" role="status">
              Filed as notice #{filed.toString()}.
            </p>
            <p className="muted">
              A moderator will read it. Nothing has been hidden or removed by
              filing this — that is a decision a person makes.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn small" onClick={dismiss}>
                Close
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}

function UserPlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}

function NavLink({
  href,
  route,
  match,
  children,
}: {
  href: string;
  route: Route;
  match: Route["name"];
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={route.name === match ? "active" : undefined}
      aria-current={route.name === match ? "page" : undefined}
    >
      {children}
    </a>
  );
}

function Router({
  route,
  me,
  signedIn,
  config,
  onSignIn,
  onProfileChange,
}: {
  route: Route;
  me: User | null;
  signedIn: boolean;
  config: Store | null;
  onSignIn: () => void;
  onProfileChange: (user: User) => void;
}) {
  const ledgerAllowlist = configuredLedgerIds(config);

  switch (route.name) {
    case "season":
      return <Season me={me} number={route.number} />;
    case "rules":
      return <Rules />;
    case "build":
      return <Build />;
    case "register":
    case "profile":
      if (!signedIn) {
        return (
          <section className="page">
            <h1>Sign in to continue</h1>
            <p className="muted">
              Registration is keyed to your Internet Identity principal — one
              profile per identity.
            </p>
            <div className="actions">
              <button className="btn" onClick={onSignIn}>
                Sign in with Internet Identity
              </button>
            </div>
          </section>
        );
      }
      // No profile yet means signing up, whichever route was asked for —
      // there is nothing to edit until the wizard has run.
      return me ? (
        <Profile
          user={me}
          tab={route.name === "profile" ? route.tab : "overview"}
          entryId={route.name === "profile" ? route.entryId : null}
          ledgerAllowlist={ledgerAllowlist}
          onChange={onProfileChange}
        />
      ) : (
        <Signup
          registrationOpen={config?.registrationOpen ?? true}
          ledgerAllowlist={ledgerAllowlist}
          onDone={onProfileChange}
        />
      );

    case "people":
      return <Directory initial={route.filter} />;

    case "moderate":
      // The page re-checks server-side; hiding the link is only tidiness.
      return <Moderate tab={route.tab} />;

    case "user":
      return <PublicProfile handle={route.handle} />;

    default:
      return <Landing me={me} signedIn={signedIn} config={config} onSignIn={onSignIn} />;
  }
}
