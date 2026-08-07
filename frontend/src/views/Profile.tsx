import { useCallback, useEffect, useState, type FormEvent } from "react";

import * as api from "../api";
import type { Revision, Season, SeasonEntry, SeasonSummary, SeasonView, User } from "../api";
import { AppSubmissionForm } from "./AppSubmissionForm";
import { Avatar } from "./Avatar";
import { Award } from "./Award";
import { useConfirm } from "./Confirm";
import { CopyButton } from "./CopyButton";
import { EntryModal } from "./EntryModal";
import { LinkIcon } from "./LinkIcon";
import { FinishedNotice, ProfileForm, SettleNotice } from "./ProfileForm";
import { RolePanel } from "./RolePanel";

/**
 * Your own profile, as a small site rather than one long form.
 *
 * It used to open on the edit form, which put the least-used thing first and
 * buried what you actually came for — what you have entered, what you have
 * won, and who you are on the site. Editing is now one section among several,
 * reached deliberately.
 */
export type ProfileTab = "overview" | "entries" | "rewards" | "roles" | "edit";

export const PROFILE_TABS: ProfileTab[] = [
  "overview",
  "entries",
  "rewards",
  "roles",
  "edit",
];

const TAB_LABELS: Record<ProfileTab, string> = {
  overview: "Overview",
  entries: "Your apps",
  rewards: "Rewards",
  roles: "Taking part",
  edit: "Edit profile",
};

function appTargetLabel(entry: Pick<SeasonEntry, "title" | "slug">): string {
  const title = entry.title.trim();
  return title ? `${title} (${entry.slug})` : entry.slug;
}

/**
 * What the canister will refuse right now, and why.
 *
 * Two windows shut things off, and both last for days. A season in progress:
 * a closed week is a record (see the bracket rules on the Rules page), so an
 * entry cannot be taken out of one that has already been voted in. And the
 * settle window that follows the final — from the last week closing until the
 * direct-wallet distribution has settled, participant writes are refused
 * because a payout row freezes its destination and arguments so retries cannot
 * become a second payment.
 *
 * Worked out here rather than discovered from a failed call: a button that
 * only ever errors, for a week, teaches people the page is broken.
 */
export type SeasonLock = "open" | "running" | "settling" | "finished";

/** Mirrors `Season.settling`, off the same three fields. */
function seasonLock(season: Season | null): SeasonLock {
  if (season === null) return "open";
  const phase = api.phaseOf(season);
  if (phase === "running") return "running";
  if (phase !== "finished") return "open";

  const payout = api.payoutPhase(season);
  // `none` is the start of the window rather than the end: the distribution
  // has not been drafted *yet*.
  if (payout !== "paid" && payout !== "failed") return "settling";
  // A canister runs one season. Settlement lifts the temporary payout lock,
  // but participant settings never become writable for a second event here.
  return "finished";
}

export function Profile({
  user,
  tab,
  entryId,
  ledgerAllowlist,
  onChange,
}: {
  user: User;
  tab: ProfileTab;
  entryId: bigint | null;
  ledgerAllowlist: string[];
  onChange: (user: User) => void;
}) {
  const [entries, setEntries] = useState<SeasonSummary[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [season, setSeason] = useState<Season | null>(null);
  const [current, setCurrent] = useState<SeasonEntry[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [open, setOpen] = useState<SeasonView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [mine, all, live, currentEntries, asked] = await Promise.all([
        api.userEntries(user.handle),
        api.listSeasons(),
        // The canister's own idea of the current season, not the newest of
        // the list: the lock below is read off it and has to agree exactly.
        api.getSeason(),
        api.myEntries(),
        // Loaded here rather than by the panel that draws it, because this is
        // also what the submission form calls when it has finished. A revision
        // that appears only after a manual reload is one the author will take
        // to mean their submission went nowhere.
        api.myRevisions(),
      ]);
      setEntries(mine);
      setSeasons(all);
      setSeason(live);
      setCurrent(currentEntries);
      setRevisions(asked);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [user.handle]);

  useEffect(() => {
    void load();
  }, [load]);

  const awarded = entries.filter((entry) => api.medalFor(entry) !== null);

  /**
   * The bracket's own view of an entry, rebuilt from what a profile already
   * knows — so opening one here gets the same panel, including the owner
   * details, rather than a second editor.
   */
  const asView = (entry: SeasonSummary): SeasonView => ({
    entry,
    handle: user.handle,
    displayName: user.displayName,
    avatar: user.avatar,
    title: user.title,
    judge: api.judgeState(user) === "approved",
    mine: true,
    voted: false,
  });

  const counts: Partial<Record<ProfileTab, number>> = {
    entries: entries.length,
    rewards: awarded.length,
  };

  const lock = seasonLock(season);
  const sponsorsFrozen = season !== null && api.phaseOf(season) !== "draft";
  const accountReadOnly = lock === "settling" || lock === "finished";

  return (
    <section className="profile">
      <nav className="profile-nav" aria-label="Your profile">
        <div className="profile-who">
          <Avatar user={user} size={44} />
          <div>
            <strong>{user.displayName || user.handle}</strong>
            <small className="muted">@{user.handle}</small>
          </div>
        </div>

        <ul>
          {PROFILE_TABS.map((name) => (
            <li key={name}>
              <a
                href={`#/profile/${name}`}
                className={name === tab ? "on" : undefined}
                aria-current={name === tab ? "page" : undefined}
              >
                {TAB_LABELS[name]}
                {counts[name] ? <span className="count">{counts[name]}</span> : null}
              </a>
            </li>
          ))}
        </ul>

        <a className="btn ghost small" href={`#/u/${user.handle}`}>
          View public profile
        </a>
      </nav>

      <div className="profile-body">
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}

        {tab === "overview" ? (
          <Overview
            user={user}
            entries={entries}
            awarded={awarded}
            loading={loading}
            lock={lock}
            onChange={onChange}
          />
        ) : null}

        {tab === "entries" ? (
          <Entries
            entries={entries}
            seasons={seasons}
            current={current}
            entryId={entryId}
            revisions={revisions}
            user={user}
            loading={loading}
            lock={lock}
            onSaved={load}
            onOpen={(entry) => setOpen(asView(entry))}
          />
        ) : null}

        {tab === "rewards" ? (
          <Rewards
            user={user}
            awarded={awarded}
            seasons={seasons}
            loading={loading}
            lock={lock}
            onChange={onChange}
            onOpen={(entry) => setOpen(asView(entry))}
          />
        ) : null}

        {tab === "roles" ? (
          <RolePanel
            user={user}
            ledgerAllowlist={ledgerAllowlist}
            judgesFrozen={sponsorsFrozen}
            sponsorsFrozen={sponsorsFrozen}
            disabled={accountReadOnly}
            disabledReason={lock === "finished" ? "finished" : "settling"}
            onChange={onChange}
          />
        ) : null}

        {tab === "edit" ? (
          <ProfileForm
            existing={user}
            lock={lock}
            ledgerAllowlist={ledgerAllowlist}
            judgesFrozen={sponsorsFrozen}
            sponsorsFrozen={sponsorsFrozen}
            onSaved={onChange}
          />
        ) : null}
      </div>

      {open ? (
        <EntryModal
          view={open}
          canVote={false}
          votesLeft={0}
          withdrawalsLocked={false}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      ) : null}
    </section>
  );
}

/**
 * What this account has spent of its instruction allowance for the season.
 *
 * The meter freezes an account the moment it crosses the cap, in the same
 * write that takes it over — so this is worth watching while it fills rather
 * than reading afterwards, when the only way back is a moderator.
 */
function Allowance({ user }: { user: User }) {
  const [allowance, setAllowance] = useState<{ used: bigint; cap: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .myAllowance()
      .then(setAllowance)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  if (error) {
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  }
  if (allowance === null) return null;

  // A cap of nought is no cap at all. Dividing by it would either throw or
  // read as a full bar to everybody the rule does not apply to.
  const capped = allowance.cap > 0n;
  const used = Number(allowance.used);
  const cap = Number(allowance.cap);
  const share = capped ? Math.min(1, used / cap) : 0;

  return (
    <>
      <h2 className="section-title">Instruction allowance</h2>
      <div className="identity">
        <small className="owner-legend">Instructions spent this season</small>

        {capped ? (
          <>
            {/*
              A div, not `<progress>`. The native element was drawing a bar
              about a third full while the label beside it read 0% — it had no
              styling at all, so what was on screen was the user agent's idea of
              a progress bar and nothing to do with the value. A number and a
              picture that disagree is worse than either alone: the picture is
              what people read, and here it was wrong by thirty points.

              This one has an explicit width, so the fill is the figure.
            */}
            <div
              className="meter"
              role="progressbar"
              aria-valuenow={Math.round(share * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Instruction allowance used"
            >
              <span className="meter-fill" style={{ width: `${share * 100}%` }} />
            </div>
            <small className="muted">
              {compact(allowance.used)} of {compact(allowance.cap)} —{" "}
              {percent(share)}.{" "}
              {user.moderator
                ? // The meter exempts moderators, so promising them a freeze
                  // would be describing something that cannot happen.
                  "Moderator accounts are counted but never frozen by the meter."
                : "Crossing it freezes the account for the rest of the season."}
            </small>
          </>
        ) : (
          <small className="muted">
            {compact(allowance.used)}. No cap is set this season, so nothing you
            do here can freeze the account.
          </small>
        )}

        {user.frozen ? (
          <p className="notice error" role="alert">
            This account is frozen: it went past the allowance, so every write
            is refused. Reading is unaffected. A moderator can unfreeze it and
            clear what it has spent — ask one, since nothing on this page can.
          </p>
        ) : capped && !user.moderator && share >= 0.8 ? (
          <p className="notice warn">
            Close to the cap. There is no self-service way back from a freeze,
            so this is the point to slow down a script.
          </p>
        ) : null}
      </div>
    </>
  );
}

/** Billions, not digits — the same shortening the moderator's cost list uses. */

/**
 * A share as a percentage, without rounding a real amount down to nothing.
 *
 * The allowance is half a trillion instructions, so ordinary use lands in the
 * thousandths of a percent — and `Math.round` turns every one of those into
 * "0%", which reads as "nothing has been counted" rather than "barely any of
 * it is gone". Somebody checking whether the meter works deserves the
 * difference.
 */
function percent(share: number): string {
  if (share === 0) return "0%";
  if (share < 0.01) return "less than 1%";
  return `${Math.round(share * 100)}%`;
}

/** Instruction counts run to billions; nobody reads those digit by digit. */
function compact(n: bigint): string {
  const value = Number(n);
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}

// ── Overview ────────────────────────────────────────────────────────────────

function Overview({
  user,
  entries,
  awarded,
  loading,
  lock,
  onChange,
}: {
  user: User;
  entries: SeasonSummary[];
  awarded: SeasonSummary[];
  loading: boolean;
  lock: SeasonLock;
  onChange: (user: User) => void;
}) {
  const title = api.title(user);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{user.displayName || user.handle}</h1>
          {title ? <p className="muted">{title}</p> : null}
        </div>
        <a className="btn ghost small" href="#/profile/edit">
          Edit profile
        </a>
      </header>

      <WalletGap user={user} lock={lock} />
      {lock === "settling" ? (
        <SettleNotice />
      ) : lock === "finished" ? (
        <FinishedNotice />
      ) : null}

      {/*
        On the overview rather than behind Edit. It is a status readout, not a
        setting — nobody goes looking for it, and the moment it matters is the
        moment writes start being refused, which is when somebody is least
        likely to go hunting through tabs for an explanation.
      */}
      <Allowance user={user} />

      <div className="summary-grid">
        <Stat label="Apps entered" value={loading ? "…" : String(entries.length)} />
        <Stat label="Awards" value={loading ? "…" : String(awarded.length)} />
        <Stat label="Roles" value={api.rolesOf(user).join(", ") || "observer"} />
      </div>

      {user.bio ? <p className="profile-bio">{user.bio}</p> : null}

      {user.links.length > 0 ? (
        <ul className="entry-links">
          {user.links.map((link, i) => (
            <li key={i}>
              <a href={link.url} target="_blank" rel="noreferrer">
                <LinkIcon kind={link.kind} url={link.url} />
                <span>{link.kind || link.url}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <Identity />

      {lock === "settling" || lock === "finished" ? null : (
        <Offers user={user} onChange={onChange} />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

/**
 * Your principal.
 *
 * Worth surfacing rather than hiding: before the permanent seal it is what a
 * controller needs to make you a moderator, and it remains the identifier for
 * an owner asking for account support.
 */
function Identity() {
  const [principal, setPrincipal] = useState<string | null>(null);

  useEffect(() => {
    void api.whoami().then(setPrincipal).catch(() => setPrincipal(null));
  }, []);

  if (!principal) return null;
  return (
    <div className="identity">
      <small className="owner-legend">Your principal</small>
      <div className="deposit-row">
        <code className="deposit-account">{principal}</code>
        <CopyButton value={principal} />
      </div>
      <small className="muted">
        Your Internet Identity on this canister. One profile per principal.
      </small>
    </div>
  );
}

/**
 * What you are not yet, offered as something to do.
 *
 * Only roles you do not hold appear — a list of things you already are would
 * be a status readout, and that is what the Overview stats are for.
 */
function Offers({ user, onChange }: { user: User; onChange: (user: User) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (what: string, action: () => Promise<User>) => {
    setBusy(what);
    setError(null);
    try {
      onChange(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };


  const offers: {
    key: string;
    title: string;
    blurb: string;
    action: string;
    instant: boolean;
    go: () => void;
  }[] = [];

  if (!user.hacker) {
    offers.push({
      key: "hacker",
      title: "Become a hacker",
      blurb: "Build something and enter it in a qualifier week.",
      action: "Start hacking",
      instant: true,
      // Straight through. The agreement accepted at registration covers
      // every role, so there is nothing further to collect here.
      go: () => void run("hacker", () => api.setHacker(true)),
    });
  }
  if (api.judgeState(user) === "no") {
    offers.push({
      key: "judge",
      title: "Become a judge",
      blurb: "Choose entries with two votes a week. Judges compete too.",
      action: "Apply to judge",
      instant: false,
      go: () => void run("judge", api.applyAsJudge),
    });
  }
  if (api.sponsorState(user) === "no") {
    offers.push({
      key: "sponsor",
      title: "Become a sponsor",
      blurb: "Fund the prize pool on behalf of an organisation.",
      action: "Apply to sponsor",
      instant: false,
      // Sponsoring needs an organisation and its tokens, so this goes to the
      // form rather than firing an application with nothing in it.
      go: () => {
        window.location.hash = "#/profile/roles";
      },
    });
  }

  if (offers.length === 0) return null;

  return (
    <section className="offers">
      <h2 className="section-title">Do more</h2>
      <p className="muted small">
        Roles stack — taking one of these does not give up anything you already
        do.
      </p>

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="offer-grid">
        {offers.map((offer) => (
          <div className={`offer ${offer.key}`} key={offer.key}>
            <strong>{offer.title}</strong>
            <small>{offer.blurb}</small>
            <span className={offer.instant ? "role-effect instant" : "role-effect"}>
              {offer.instant ? "Starts straight away" : "A moderator reviews it"}
            </span>
            <button className="btn small" disabled={busy !== null} onClick={offer.go}>
              {busy === offer.key ? "…" : offer.action}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── The reward wallet ───────────────────────────────────────────────────────

/**
 * A hacker with nowhere to be paid, told before they find out the hard way.
 *
 * `submit_entry` refuses an entry from an account with no wallet, and the
 * moment to learn that is not the moment you press Submit with a build you
 * finished ten minutes before the week closes.
 */
function WalletGap({ user, lock = "open" }: { user: User; lock?: SeasonLock }) {
  if (!user.hacker || user.wallet.length > 0) return null;
  if (lock === "settling" || lock === "finished") {
    return (
      <p className="notice warn">
        No reward wallet was set before the season finished. The payout record
        is frozen now, so a wallet cannot be added on this canister.
      </p>
    );
  }
  return (
    <p className="notice warn">
      You have no reward wallet, and an app cannot be submitted without one —
      there has to be somewhere to pay you.{" "}
      <a href="#/profile/rewards">Set your reward wallet</a>
    </p>
  );
}

/**
 * Where prizes are sent.
 *
 * Not the principal you signed in with, and the canister refuses that one:
 * an Internet Identity principal is a per-origin pseudonym rather than a
 * ledger account, so tokens sent to it are unspendable and the mistake is
 * invisible until the money has already moved. Say so before the attempt, and
 * point at the wallet that does work.
 *
 * Replaceable, never clearable — `setWallet` takes a principal and has no
 * "none". Somebody about to be paid must have somewhere for it to go, and "I
 * removed it last week" is a support ticket nobody can answer afterwards.
 */
function RewardWallet({
  user,
  lock,
  onChange,
}: {
  user: User;
  lock: SeasonLock;
  onChange: (user: User) => void;
}) {
  const stored = user.wallet[0]?.toText() ?? null;
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const settling = lock === "settling";
  const finished = lock === "finished";
  const readOnly = settling || finished;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onChange(await api.setWallet(wallet.trim()));
      // Emptied, not left holding the value: what is stored now shows above.
      setWallet("");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="section-title">Reward wallet</h2>

      {settling ? <SettleNotice /> : finished ? <FinishedNotice /> : null}
      <WalletGap user={user} lock={lock} />

      {stored ? (
        <div className="identity">
          <small className="owner-legend">Prizes are sent to</small>
          <div className="deposit-row">
            <code className="deposit-account">{stored}</code>
            <CopyButton value={stored} />
          </div>
        </div>
      ) : null}

      <form className="form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>
            {stored ? "Replace with" : "Wallet principal"}
            {stored ? null : <em className="muted">not set</em>}
          </span>
          <input
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
            placeholder="ryjl3-tyaaa-aaaaa-aaaba-cai"
            spellCheck={false}
            required
            disabled={readOnly}
          />
          <small>
            Not the principal you signed in with — an Internet Identity is a
            per-origin pseudonym, not a ledger account. Make a wallet at{" "}
            <a href="https://nns.ic0.app/" target="_blank" rel="noreferrer">
              nns.ic0.app
            </a>{" "}
            and paste its principal here. It can be replaced later, but never
            removed. Setting a wallet you have no access to will result in your
            reward being permanently lost.
          </small>
        </label>

        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? <p className="notice ok">Rewards will be sent there.</p> : null}

        <div className="actions">
          <button
            className="btn"
            type="submit"
            disabled={busy || readOnly || wallet.trim() === "" || wallet.trim() === stored}
          >
            {busy ? "Saving…" : stored ? "Replace wallet" : "Set wallet"}
          </button>
        </div>
      </form>

      {/* Only people who can win. Kept on screen for somebody already opted
          out, whatever their roles say now, so the switch is never one-way. */}
      {user.hacker || user.rewardOptOut ? (
        <OptOut user={user} disabled={readOnly} onChange={onChange} />
      ) : null}
    </>
  );
}

/**
 * Standing out of the prize money.
 *
 * The share is not withheld — `Payout.shares` normalises over the weight
 * actually claimed, so what you would have had is divided among the other
 * winners instead of sitting in the treasury. Worth saying on the checkbox:
 * "opt out" reads like the money stays put, and it does not.
 */
function OptOut({
  user,
  disabled,
  onChange,
}: {
  user: User;
  disabled: boolean;
  onChange: (user: User) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (out: boolean) => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.setRewardOptOut(out));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="control">
      <div>
        <strong>I don't want to receive rewards</strong>
        <small className="muted">
          What you would have been paid is divided among the other winners
          rather than staying in the treasury. You still compete, still place,
          and still collect the medals.
        </small>
        {error ? (
          <small className="bad" role="alert">
            {error}
          </small>
        ) : null}
      </div>
      {/*
        A switch, and it is silent until it is thrown. "Paid as normal" beside
        an untouched control reads as a setting somebody chose, which nobody
        did — it is simply the default, and labelling a default as a decision
        invites second-guessing a thing that needed no thought. Off says
        nothing; on says exactly what it costs.
      */}
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={user.rewardOptOut}
          disabled={busy || disabled}
          onChange={(event) => void toggle(event.target.checked)}
          aria-label="Opt out of rewards"
        />
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
        <span className="switch-label">{user.rewardOptOut ? "Won't receive reward" : ""}</span>
      </label>
    </div>
  );
}

// ── Apps and rewards ────────────────────────────────────────────────────────

/** Entries grouped by the season they belong to, newest season first. */
function bySeason(entries: SeasonSummary[], seasons: Season[]) {
  const numbers = new Map(seasons.map((s) => [s.id.toString(), Number(s.number)]));
  const groups = new Map<string, { season: number; rows: SeasonSummary[] }>();

  for (const entry of entries) {
    const key = entry.season_id.toString();
    const group = groups.get(key) ?? {
      season: numbers.get(key) ?? 0,
      rows: [],
    };
    group.rows.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.season - a.season);
}

function Entries({
  entries,
  seasons,
  current,
  entryId,
  revisions,
  user,
  loading,
  lock,
  onSaved,
  onOpen,
}: {
  entries: SeasonSummary[];
  seasons: Season[];
  current: SeasonEntry[];
  entryId: bigint | null;
  revisions: Revision[];
  user: User;
  loading: boolean;
  lock: SeasonLock;
  onSaved: () => Promise<void>;
  onOpen: (entry: SeasonSummary) => void;
}) {
  const { ask, dialog } = useConfirm();
  const [busy, setBusy] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Blank one app. Not a row delete: votes point at entries and payouts point
   * at both, so the row stays and everything on it goes.
   */
  const remove = async (entry: SeasonSummary) => {
    const confirmed = await ask({
      title: `Delete “${entry.title}”?`,
      body:
        "The title, icon, screenshots and the build are erased and the entry " +
        "becomes a blank placeholder. The row itself stays, so the week it " +
        "was judged in still adds up. This cannot be undone.",
      confirm: "Delete this app",
      tone: "danger",
    });
    if (confirmed === null) return;
    setBusy(entry.id);
    setError(null);
    try {
      await api.deleteApp(entry.id);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="muted">Loading…</p>;

  const live = seasons.find((season) => api.phaseOf(season) === "running") ?? null;
  const week = live ? Number(live.week) : 0;
  const qualifierOpen = live !== null && api.isQualifier(week);
  const detailsEditable = qualifierOpen && user.hacker;
  const editable = current.filter((entry) => !api.takenDown(entry));
  const selected =
    entryId !== null
      ? (editable.find((entry) => entry.id === entryId) ?? null)
      : editable.length === 1
        ? editable[0]
        : null;
  // An explicit bad/stale target and an unchosen multi-seat round both stop
  // here. Neither case may silently turn into a new app or seat-zero update.
  const invalidTarget = entryId !== null && selected === null;
  const needsChoice = entryId === null && editable.length > 1;
  const showPanel =
    live !== null && (detailsEditable || editable.length > 0 || entryId !== null);
  const showForm =
    showPanel && !invalidTarget && !needsChoice && (detailsEditable || selected !== null);
  const pendingCurrent = live
    ? revisions.filter(
        (revision) =>
          api.revisionState(revision) === "pending" &&
          revision.season_id === live.id &&
          Number(revision.week) === week,
      )
    : [];
  const pendingReview =
    pendingCurrent.length === 0
      ? null
      : pendingCurrent.length > 1
        ? `${pendingCurrent.length} submissions for this week are already waiting for review.`
        : "version" in pendingCurrent[0].kind
          ? "A version for this week is already waiting for review."
          : "App details for this week are already waiting for review.";

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Your apps</h1>
          <p className="muted small">
            Submit and edit the open week's app here. Every field stays together;
            older submissions remain below.
          </p>
        </div>
      </header>

      <WalletGap user={user} lock={lock} />

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      {showPanel && live ? (
        <section className="app-submission">
          <header className="app-submission-head">
            <div>
              <h2>
                {detailsEditable
                  ? selected
                    ? `Edit ${api.weekName(week)} app`
                    : `Submit for ${api.weekName(week)}`
                  : selected
                    ? `Publish a ${api.weekName(week)} update`
                    : "Choose an app to update"}
              </h2>
              <p className="muted small">
                Season {Number(live.number)} · {detailsEditable
                  ? "one app for this week · editable until the week closes"
                  : "app details are locked · versions remain open until the week closes"}
              </p>
            </div>
            <span className="badge phase-running">open</span>
          </header>

          {editable.length > 1 ? (
            <label className="field app-target">
              <span>App to update</span>
              <select
                value={selected?.id.toString() ?? ""}
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  window.location.hash = id ? `/profile/entries/${id}` : "/profile/entries";
                }}
              >
                <option value="">Choose an app…</option>
                {editable.map((entry) => (
                  <option key={String(entry.id)} value={entry.id.toString()}>
                    {appTargetLabel(entry)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {invalidTarget ? (
            <p className="notice error" role="alert">
              That app is not one of your editable apps in the current round.
              Open the app from the bracket or choose a current app.
            </p>
          ) : needsChoice ? (
            <p className="notice">
              You have more than one app in this round. Choose the exact app
              this version belongs to.
            </p>
          ) : null}

          {showForm ? (
            <AppSubmissionForm
              user={user}
              entry={selected}
              detailsEditable={detailsEditable}
              pendingReview={pendingReview}
              onSaved={onSaved}
            />
          ) : null}
        </section>
      ) : qualifierOpen ? (
        <div className="notice">
          Turn on the hacker role before submitting this week. {" "}
          <a href="#/profile/roles">Manage your roles</a>
        </div>
      ) : (
        <p className="notice">
          {live
            ? "Qualifier submissions are closed. Advancing apps are carried into the semi-final and final automatically."
            : "No qualifier is open right now. Your submission history remains available below."}
        </p>
      )}

      <UnderReview revisions={revisions} />

      <h2 className="section-title">Submission history</h2>

      {entries.length === 0 ? (
        <p className="muted">Nothing entered yet. Your first submitted app will appear here.</p>
      ) : null}

      {/*
        Deleting is offered only when it would work. Both windows last for days
        and the canister refuses throughout, so the alternative is a button
        that answers "not now" for a week.
      */}
      {entries.length > 0 && lock !== "open" ? (
        <p className="notice">
          Apps cannot be owner-deleted after the season starts. Votes and
          results are a permanent public record; report content that requires
          moderator removal.
        </p>
      ) : null}

      {bySeason(entries, seasons).map((group) => (
        <section className="season-group" key={group.season}>
          <h2 className="section-title">Season {group.season}</h2>
          <ul className="entry-list">
            {group.rows.map((entry) => (
              <EntryRow
                key={String(entry.id)}
                entry={entry}
                busy={busy === entry.id}
                onOpen={onOpen}
                onDelete={lock === "open" ? remove : null}
              />
            ))}
          </ul>
        </section>
      ))}

      {dialog}
    </>
  );
}

function EntryRow({
  entry,
  busy = false,
  onOpen,
  /** Absent on the rewards list, which is a record rather than a workbench. */
  onDelete = null,
}: {
  entry: SeasonSummary;
  busy?: boolean;
  onOpen: (entry: SeasonSummary) => void;
  onDelete?: ((entry: SeasonSummary) => Promise<void>) | null;
}) {
  const medal = api.medalFor(entry);
  const votes = Number(entry.votes);
  const carried = entry.origin_id[0] !== undefined;

  return (
    <li>
      <button className="entry-line" onClick={() => onOpen(entry)}>
        {entry.icon[0] ? (
          <img className="entry-line-icon" src={entry.icon[0]} alt="" />
        ) : (
          <span className="entry-line-icon placeholder" aria-hidden="true">
            {entry.title.trim().charAt(0).toUpperCase()}
          </span>
        )}

        <span className="entry-line-copy">
          <strong>{entry.title}</strong>
          <small>
            {api.weekName(Number(entry.week))}
            {carried ? " · carried forward" : ""}
            {entry.hasPackage ? " · has a package" : ""}
            {Number(entry.updates) > 0 ? ` · ${entry.updates} updates` : ""}
          </small>
        </span>

        {medal ? (
          <span className={`medal-tag ${medal}`}>
            <Award medal={medal} size={13} />
            {medal}
          </span>
        ) : null}

        <span className="entry-line-votes">
          <strong>{votes}</strong>
          <small>{votes === 1 ? "vote" : "votes"}</small>
        </span>

        <span className="entry-line-go">Open</span>
      </button>

      {/* Outside the row's own button — a control inside a control is neither
          clickable nor announced as its own thing. */}
      {onDelete ? (
        <div className="actions">
          <button
            className="btn small danger"
            disabled={busy}
            onClick={() => void onDelete(entry)}
          >
            {busy ? "Deleting…" : "Delete this app"}
          </button>
          <small className="muted">
            Erases everything on it and leaves a blank placeholder.
          </small>
        </div>
      ) : null}
    </li>
  );
}

/**
 * What you have asked for that is not on your entry.
 *
 * The Rules page requires a pending revision to be visible to its author as well as
 * to moderators, and only the moderators had it: a hacker who submitted watched
 * the form clear and learned nothing more, and a hacker who was refused was
 * never shown the refusal — the part they need in order to fix the app.
 *
 * Approved revisions are left out deliberately. An approved one *is* the
 * entry, and the entry is already on this page under Submission history;
 * repeating it here would turn a short list of things to act on into a log.
 */
function UnderReview({ revisions }: { revisions: Revision[] }) {
  const open = revisions.filter((rev) => api.revisionState(rev) !== "approved");
  if (open.length === 0) return null;

  return (
    <section className="review-status">
      <h2 className="section-title">Sent for review</h2>
      <p className="muted small">
        None of this is on your entry yet — a moderator decides each one, and
        until then the entry shows what was approved before it. The canister keeps
        your newest eight private review records.
      </p>
      <ul className="revision-list">
        {open.map((rev) => (
          <RevisionRow key={String(rev.id)} rev={rev} />
        ))}
      </ul>
    </section>
  );
}

function RevisionRow({ rev }: { rev: Revision }) {
  const state = api.revisionState(rev);
  const isVersion = "version" in rev.kind;
  const fallback =
    rev.slug ||
    (rev.targetEntryId[0] !== undefined
      ? `entry #${String(rev.targetEntryId[0])}`
      : `revision #${String(rev.id)}`);
  const title = rev.title.trim();
  const target = isVersion && title ? `${title} (${fallback})` : title || fallback;

  return (
    <li className="revision-row">
      <div className="revision-head">
        <span className={`badge ${state}`}>{state}</span>
        <strong>{isVersion ? `v${rev.version} for ${target}` : target}</strong>
        <small>
          {isVersion ? "version" : "app details"} · {api.weekName(Number(rev.week))} · sent{" "}
          <time title={api.exactTime(rev.createdAt)}>{api.ago(rev.createdAt)}</time>
        </small>
      </div>

      {state === "pending" ? (
        <small className="muted">Waiting in the queue. Nobody has looked at it yet.</small>
      ) : state === "expired" ? (
        <small className="muted">
          {api.weekName(Number(rev.week))} closed before anyone reviewed it, so nothing
          was published and nobody refused it. Submit again in the open week.
        </small>
      ) : (
        <>
          <small className="muted">
            Refused{" "}
            <time title={api.exactTime(rev.decidedAt)}>{api.ago(rev.decidedAt)}</time>. You
            can fix it and submit again while the week is open.
          </small>
          {/* Somebody else's words, so they are rendered as text and never as
              markup — the same rule the moderators' queue follows. */}
          {rev.reason.trim() ? <Reason text={rev.reason} /> : null}
        </>
      )}
    </li>
  );
}

const REASON_PREVIEW = 700;

/**
 * A rejection, in full or in part.
 *
 * A detailed explanation can still bury the page, so it opens at a paragraph
 * and the rest is one press away. The stored text is never silently cut off.
 */
function Reason({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const long = text.length > REASON_PREVIEW;

  return (
    <>
      <p className="revision-reason">
        {full || !long ? text : `${text.slice(0, REASON_PREVIEW).trimEnd()}…`}
      </p>
      {long ? (
        <button
          className="btn ghost small"
          onClick={() => setFull(!full)}
          aria-expanded={full}
        >
          {full ? "Show less" : `Read all ${text.length.toLocaleString()} characters`}
        </button>
      ) : null}
    </>
  );
}

function Rewards({
  user,
  awarded,
  seasons,
  loading,
  lock,
  onChange,
  onOpen,
}: {
  user: User;
  awarded: SeasonSummary[];
  seasons: Season[];
  loading: boolean;
  lock: SeasonLock;
  onChange: (user: User) => void;
  onOpen: (entry: SeasonSummary) => void;
}) {
  if (loading) return <p className="muted">Loading…</p>;

  const totals = api.MEDALS.map((tier) => ({
    ...tier,
    count: awarded.filter((entry) => api.medalFor(entry) === tier.medal).length,
  })).filter((tier) => tier.count > 0);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Rewards</h1>
          <p className="muted small">
            {awarded.length === 0
              ? `Nothing won yet. Placing in the top ${api.REWARDED_PER_WEEK} of a qualifier week earns a bronze medal, and it climbs from there.`
              : "Each app is paid once, for its best finish — these are every award earned along the way."}
          </p>
        </div>
      </header>

      {/* Before the tally: the wallet is what decides whether any of it can
          actually reach you, medals or no medals. */}
      <RewardWallet user={user} lock={lock} onChange={onChange} />

      {totals.length > 0 ? (
        <div className="reward-tally">
          {totals.map((tier) => (
            <div className={`tally ${tier.medal}`} key={tier.medal}>
              <Award medal={tier.medal} size={26} />
              <strong>{tier.count}</strong>
              <small>{tier.name}</small>
            </div>
          ))}
        </div>
      ) : null}

      {bySeason(awarded, seasons).map((group) => (
        <section className="season-group" key={group.season}>
          <h2 className="section-title">Season {group.season}</h2>
          <ul className="entry-list">
            {group.rows.map((entry) => (
              <EntryRow key={String(entry.id)} entry={entry} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
