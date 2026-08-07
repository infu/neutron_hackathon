import { useState, type FormEvent } from "react";

import * as api from "../api";
import type { Input, Link, User } from "../api";
import { Avatar } from "./Avatar";
import { useConfirm } from "./Confirm";
import { CopyButton } from "./CopyButton";
import { LinksField } from "./LinksField";
import type { SeasonLock } from "./Profile";
import { RolePanel } from "./RolePanel";

const MAX_TITLE = 80;

/**
 * The wait between the final closing and the money landing.
 *
 * Lives here rather than in `Profile.tsx` so that importing it does not point
 * a module back at the one that renders it. Said in full wherever a control is
 * switched off by it: "nothing can be saved" with no reason reads as a bug,
 * and this state lasts about a day.
 */
export function SettleNotice() {
  return (
    <p className="notice">
      The season is settling up. Nothing on your account can change until the
      direct-wallet distribution finishes or records its terminal failures. A
      payout row freezes where and how it is sending so that a retry cannot pay
      twice; changing an account halfway through would break that guarantee.
    </p>
  );
}

export function FinishedNotice() {
  return (
    <p className="notice">
      This one-season canister is finished. Profile details, roles, reward
      settings, and automation are permanently read-only here. Account
      anonymisation remains a separate privacy action where it is permitted.
    </p>
  );
}

/**
 * Editing a profile you already have. Registering is the wizard in
 * `Signup.tsx` — this only ever sees an existing user.
 */
export function ProfileForm({
  existing,
  lock,
  ledgerAllowlist,
  judgesFrozen,
  sponsorsFrozen,
  onSaved,
}: {
  existing: User;
  lock: SeasonLock;
  ledgerAllowlist: string[];
  judgesFrozen: boolean;
  sponsorsFrozen: boolean;
  onSaved: (user: User) => void;
}) {
  const [handle, setHandle] = useState(existing.handle);
  const [displayName, setDisplayName] = useState(existing.displayName);
  const [title, setTitle] = useState(api.title(existing) ?? "");
  const [bio, setBio] = useState(existing.bio);
  const [links, setLinks] = useState<Link[]>(
    existing.links.map((l) => ({ kind: l.kind, url: l.url })),
  );
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
      const trimmedTitle = title.trim();
      const input: Input = {
        handle: handle.trim().toLowerCase(),
        displayName: displayName.trim(),
        title: trimmedTitle === "" ? [] : [trimmedTitle],
        bio: bio.trim(),
        links: links.filter((l) => l.url.trim() !== ""),
        // Accepted at signup and not re-asked here. `Profiles.validate` runs
        // on updates too and refuses a false, so an edit form that sent one
        // would lock somebody out of their own profile.
        terms: true,
      };
      const user = await api.updateProfile(input);
      onSaved(user);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Your profile</h1>
        </div>
        <a className="btn ghost small" href={`#/u/${existing.handle}`}>
          View public profile
        </a>
      </header>

      {settling ? <SettleNotice /> : finished ? <FinishedNotice /> : null}

      <AvatarPanel user={existing} disabled={readOnly} onChange={onSaved} />
      <RolePanel
        user={existing}
        ledgerAllowlist={ledgerAllowlist}
        judgesFrozen={judgesFrozen}
        sponsorsFrozen={sponsorsFrozen}
        disabled={readOnly}
        disabledReason={finished ? "finished" : "settling"}
        showDisabledNotice={false}
        onChange={onSaved}
      />

      <h2 className="section-title">Details</h2>

      <form className="form" onSubmit={submit}>
        <div className="field-row">
          <label>
            <span>Handle</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="ada_lovelace"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9_]{3,32}"
              title="3-32 characters: lowercase letters, digits, underscore"
              disabled={readOnly}
            />
            <small>Lowercase letters, digits and underscore. Your public URL.</small>
          </label>

          <label>
            <span>Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
              placeholder="Ada Lovelace"
              disabled={readOnly}
            />
          </label>
        </div>

        <label>
          <span>
            Title <em className="muted">optional</em>
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE}
            placeholder="CEO of Something"
            disabled={readOnly}
          />
          <small>Shown under your name on the directory pages.</small>
        </label>

        <label>
          <span>Bio</span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={1000}
            rows={6}
            placeholder="What are you planning to build on Neutron?"
            disabled={readOnly}
          />
          <small>
            {bio.length}/1000 — the first six lines show on your card.
          </small>
        </label>

        <LinksField links={links} disabled={readOnly} onChange={setLinks} />

        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? <p className="notice ok">Saved.</p> : null}

        <div className="actions">
          <button className="btn" type="submit" disabled={busy || readOnly}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <Automation user={existing} disabled={readOnly} onChange={onSaved} />

      <DangerZone user={existing} lock={lock} onDeleted={onSaved} />
    </section>
  );
}

function Automation({
  user,
  disabled,
  onChange,
}: {
  user: User;
  disabled: boolean;
  onChange: (user: User) => void;
}) {
  const stored = user.agent[0]?.toText() ?? null;
  const [agent, setAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async (next: string | null) => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      onChange(await api.setAgent(next));
      setAgent("");
      setSaved(next === null ? "Stood down." : "That principal can now act as you.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="section-title">
        Automation <em className="muted">optional</em>
      </h2>

      {stored ? (
        <div className="identity">
          <small className="owner-legend">Driving this account</small>
          <div className="deposit-row">
            <code className="deposit-account">{stored}</code>
            <CopyButton value={stored} />
          </div>
        </div>
      ) : null}

      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(agent.trim());
        }}
      >
        <label>
          <span>
            {stored ? "Replace with" : "Automation principal"}
            {stored ? null : <em className="muted">none</em>}
          </span>
          <input
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            placeholder="Principal of the identity your script signs with"
            spellCheck={false}
            disabled={disabled}
          />
          <small>
            It may upload app assets, submit or revise apps, cast ordinary
            votes, and make the reads those workflows need. If you are a
            moderator, it may also read the app-review queue and approve or
            reject app submissions and revisions; it still cannot review your
            own work. It cannot edit your profile, roles, wallet, sponsor record,
            or automation principal; move money; delete the account; use any
            other moderation power; or administer the season.
          </small>
        </label>

        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? <p className="notice ok">{saved}</p> : null}

        <div className="actions">
          <button
            className="btn"
            type="submit"
            disabled={busy || disabled || agent.trim() === "" || agent.trim() === stored}
          >
            {busy ? "Saving…" : stored ? "Replace" : "Set automation principal"}
          </button>
          {stored ? (
            <button
              className="btn ghost"
              type="button"
              disabled={busy || disabled}
              onClick={() => void save(null)}
            >
              Stand it down
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}

/**
 * Leaving.
 *
 * Not a row delete: entries point at users, votes point at entries and payouts
 * point at both, so removing the row would leave a finished season full of
 * dangling references. Everything personal goes and the row stays, which is
 * what "deleted" has to mean for something already judged in public — and it
 * is worth saying plainly before the button, because it is not what the word
 * usually promises.
 */
function DangerZone({
  user,
  lock,
  onDeleted,
}: {
  user: User;
  lock: SeasonLock;
  onDeleted: (user: User) => void;
}) {
  const { ask, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sponsorSealed = api.sponsorState(user) === "approved";

  const remove = async () => {
    const confirmed = await ask({
      title: "Delete your account?",
      body:
        `Your handle becomes deleted-${user.id}, the display name goes, and so ` +
        "do the bio, title, links, avatar and every role you hold. Each of your " +
        "apps becomes a blank placeholder with no images and no build. The " +
        "identity you signed in with stays bound to the row, so it cannot " +
        "register again. None of this can be undone.",
      confirm: "Delete my account",
      tone: "danger",
    });
    if (confirmed === null) return;
    setBusy(true);
    setError(null);
    try {
      onDeleted(await api.deleteAccount());
      // Nothing on a profile page belongs to them any more.
      window.location.hash = "#/";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="section-title">Delete your account</h2>
      <div className="control">
        <div>
          <strong>Anonymise everything on this account</strong>
          <small className="muted">
            The name is scrambled to the account number and the bio, avatar,
            links and roles go. Your apps stay in the bracket as blank
            placeholders, because the weeks they were judged in have to keep
            adding up. Irreversible.
          </small>
          {error ? (
            <small className="bad" role="alert">
              {error}
            </small>
          ) : null}
        </div>

        {(lock === "open" || lock === "finished") && !sponsorSealed ? (
          <button className="btn small danger" disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete my account"}
          </button>
        ) : null}
      </div>

      {/* Refused for the whole of a season and the settle window after it —
          days either way, so say which one and when it lifts. */}
      {lock === "running" ? (
        <p className="notice">
          An account cannot be deleted while a season is running: judges have
          voted on entries that are still in play, and a competitor vanishing
          mid-bracket changes results that are already public. Deleting reopens
          after the final distribution settles.
        </p>
      ) : null}
      {lock === "settling" ? <SettleNotice /> : null}
      {sponsorSealed ? (
        <p className="notice">
          An approved sponsor is part of the sealed funding record and cannot
          anonymise this account.
        </p>
      ) : null}

      {dialog}
    </>
  );
}

function AvatarPanel({
  user,
  disabled,
  onChange,
}: {
  user: User;
  disabled: boolean;
  onChange: (u: User) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file || disabled) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.uploadAvatar(user, file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.clearAvatar());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-panel">
      <Avatar user={user} size={64} />
      <div className="avatar-actions">
        <div className="actions">
          <label
            className={`btn ghost small file${disabled || busy ? " disabled" : ""}`}
            aria-disabled={disabled || busy}
          >
            {busy ? "Uploading…" : "Upload photo"}
            <input
              type="file"
              accept="image/*"
              disabled={disabled || busy}
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
          {api.avatarUrl(user) ? (
            <button
              className="btn ghost small"
              onClick={clear}
              disabled={disabled || busy}
              type="button"
            >
              Remove
            </button>
          ) : null}
        </div>
        <small className="muted">
          Up to {Math.floor(api.AVATAR_MAX_BYTES / 1000)} KB, stored in the
          canister and served over certified HTTP.
        </small>
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
