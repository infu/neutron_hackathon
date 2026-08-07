import { useEffect, useState, type FormEvent } from "react";

import * as api from "../api";
import type { Input, Link, SponsorApplication, SponsorLedger, User } from "../api";
import { Avatar } from "./Avatar";
import { LedgerPicker } from "./LedgerPicker";
import { LinksField } from "./LinksField";

/**
 * Signing up, as three steps.
 *
 * The old single form asked for a profile and then, once you were registered,
 * showed a panel of role switches — which read as settings you might already
 * have rather than choices you were being asked to make. Splitting it means
 * every question is asked once, in order, and taking part is a decision you
 * make rather than a toggle you have to notice.
 *
 * Everything is committed at the end, not as you go: `register` has to run
 * before any role call, and an abandoned wizard should leave nothing behind.
 */

type StepKey = "profile" | "roles" | "confirm";

type PartialFailure = {
  label: string;
  message: string;
};

const STEPS: StepKey[] = ["profile", "roles", "confirm"];

const STEP_META: Record<StepKey, { title: string; hint: string }> = {
  profile: { title: "Your profile", hint: "Who you are on the site" },
  roles: { title: "Taking part", hint: "What you want to do" },
  confirm: { title: "Confirm", hint: "Check and create" },
};

/** What the wizard collects before anything is sent. */
type Draft = {
  handle: string;
  displayName: string;
  title: string;
  bio: string;
  links: Link[];
  /** Held until after `register` — the upload key is derived from the user id. */
  photo: File | null;
  hacker: boolean;
  judge: boolean;
  sponsor: boolean;
  org: string;
  website: string;
  blurb: string;
  ledgers: SponsorLedger[];
  /** The one acceptance, required. `register` is refused without it. */
  terms: boolean;
};

const EMPTY: Draft = {
  handle: "",
  displayName: "",
  title: "",
  bio: "",
  links: [],
  photo: null,
  hacker: false,
  judge: false,
  sponsor: false,
  org: "",
  website: "",
  blurb: "",
  ledgers: [],
  terms: false,
};

const HANDLE_RE = /^[a-z0-9_]{3,32}$/;

export function Signup({
  registrationOpen,
  ledgerAllowlist,
  onDone,
}: {
  registrationOpen: boolean;
  ledgerAllowlist: string[];
  onDone: (user: User) => void;
}) {
  const [step, setStep] = useState<StepKey>("profile");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Roles that failed after the account was already created. */
  const [partial, setPartial] = useState<PartialFailure[]>([]);
  /** The registered user is held here until a partial-success notice is read. */
  const [completed, setCompleted] = useState<User | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const handleState = useHandleCheck(draft.handle);

  if (!registrationOpen) {
    return (
      <section className="page">
        <h1>Registration is closed</h1>
        <p className="muted">Check back later.</p>
      </section>
    );
  }

  const at = Math.max(0, STEPS.indexOf(step));

  const go = (next: StepKey) => {
    setError(null);
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const forward = () => go(STEPS[Math.min(at + 1, STEPS.length - 1)]);
  const back = () => go(STEPS[Math.max(at - 1, 0)]);

  /**
   * Create everything, in the only order the canister allows.
   *
   * If `register` fails there is nothing to clean up and we go back to step
   * one. If a later call fails the account already exists, so the rest still
   * run and the failures are named — they can be retried from the profile
   * page rather than losing the registration.
   */
  const finish = async () => {
    setError(null);
    setPartial([]);
    setCompleted(null);
    setBusy("register");

    let user: User;
    try {
      const title = draft.title.trim();
      const input: Input = {
        handle: draft.handle.trim().toLowerCase(),
        displayName: draft.displayName.trim(),
        title: title === "" ? [] : [title],
        bio: draft.bio.trim(),
        links: draft.links.filter((link) => link.url.trim() !== ""),
        // Recorded with the account rather than asked for afterwards. An
        // account that exists having agreed to nothing is a state every reader
        // would then have to decide what to do about.
        //
        // Only the terms. The jurisdiction declaration belongs to the roles
        // that move money, and is collected with them below — asking an
        // observer to attest to where they live collects a legal statement for
        // no purpose.
        terms: draft.terms,
      };
      user = await api.register(input);
    } catch (cause) {
      setBusy(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStep("profile");
      return;
    }

    const failed: PartialFailure[] = [];
    const attempt = async (label: string, action: () => Promise<User>) => {
      setBusy(label);
      try {
        user = await action();
      } catch (cause) {
        failed.push({
          label,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    };

    if (draft.photo) {
      const photo = draft.photo;
      await attempt("photo", () => api.uploadAvatar(user, photo));
    }
    if (draft.hacker) await attempt("hacker", () => api.setHacker(true));
    if (draft.judge) await attempt("judge", api.applyAsJudge);
    if (draft.sponsor) {
      const application: SponsorApplication = {
        org: draft.org.trim(),
        website: draft.website.trim(),
        logo: [],
        blurb: draft.blurb.trim(),
        ledgers: draft.ledgers,
      };
      await attempt("sponsor", () => api.applyAsSponsor(application));
    }

    setBusy(null);
    if (failed.length > 0) {
      setCompleted(user);
      setPartial(failed);
      return;
    }
    onDone(user);
    window.location.hash = "#/profile";
  };

  if (partial.length > 0 && completed !== null) {
    return (
      <section className="page">
        <h1>You are registered</h1>
        <p className="notice warn">
          Your profile was created, but some optional setup did not finish.
          Successful changes were kept, and you can retry the rest from your
          profile.
        </p>
        <ul className="error-list" aria-label="Setup that did not finish">
          {partial.map((failure) => (
            <li key={failure.label}>
              <strong>{failure.label}:</strong> {failure.message}
            </li>
          ))}
        </ul>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              onDone(completed);
              window.location.hash = "#/profile";
            }}
          >
            Continue to your profile
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page signup">
      <header className="page-head">
        <div>
          <h1>Join the Hackathon</h1>
          <p className="muted small">
            Three steps. Nothing is created until the last one.
          </p>
        </div>
      </header>

      <Progress at={at} />

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      {step === "profile" ? (
        <ProfileStep draft={draft} set={set} handleState={handleState} onNext={forward} />
      ) : null}

      {step === "roles" ? (
        <RolesStep
          draft={draft}
          ledgerAllowlist={ledgerAllowlist}
          set={set}
          onBack={back}
          onNext={forward}
        />
      ) : null}

      {step === "confirm" ? (
        <ConfirmStep
          draft={draft}
          busy={busy}
          onBack={back}
          onFinish={finish}
          onDeclare={set}
        />
      ) : null}
    </section>
  );
}

function Progress({ at }: { at: number }) {
  return (
    <ol className="wizard-steps">
      {STEPS.map((key, index) => {
        const entry = STEP_META[key];
        const state = index === at ? "on" : index < at ? "done" : "todo";
        return (
          <li className={`wizard-step ${state}`} key={key}>
            <span className="wizard-num">{state === "done" ? "✓" : index + 1}</span>
            <span className="wizard-copy">
              <strong>{entry.title}</strong>
              <small>{entry.hint}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Step 1: profile ─────────────────────────────────────────────────────────

function ProfileStep({
  draft,
  set,
  handleState,
  onNext,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  handleState: HandleState;
  onNext: () => void;
}) {
  const preview = usePreview(draft.photo);

  return (
    <form
      className="form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onNext();
      }}
    >
      <div className="photo-picker">
        <Avatar
          user={{
            avatar: preview ? [preview] : [],
            displayName: draft.displayName,
            handle: draft.handle,
          }}
          size={72}
        />
        <div>
          <label className="btn ghost small file">
            {draft.photo ? "Change photo" : "Add a photo"}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => set("photo", event.target.files?.[0] ?? null)}
            />
          </label>
          {draft.photo ? (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => set("photo", null)}
            >
              Remove
            </button>
          ) : null}
          <small className="muted">
            Optional. Up to {Math.floor(api.AVATAR_MAX_BYTES / 1000)} KB — uploaded
            when you finish.
          </small>
        </div>
      </div>

      <div className="field-row">
        <label>
          <span>Handle</span>
          <input
            value={draft.handle}
            onChange={(event) => set("handle", event.target.value.toLowerCase())}
            placeholder="ada_lovelace"
            required
            minLength={3}
            maxLength={32}
            pattern="[a-z0-9_]{3,32}"
            title="3-32 characters: lowercase letters, digits, underscore"
            autoComplete="off"
            spellCheck={false}
          />
          <HandleNote state={handleState} handle={draft.handle} />
        </label>

        <label>
          <span>Display name</span>
          <input
            value={draft.displayName}
            onChange={(event) => set("displayName", event.target.value)}
            maxLength={64}
            required
            placeholder="Ada Lovelace"
          />
          <small>Shown on your card and next to your entries.</small>
        </label>
      </div>

      <label>
        <span>
          Title <em className="muted">optional</em>
        </span>
        <input
          value={draft.title}
          onChange={(event) => set("title", event.target.value)}
          maxLength={80}
          placeholder="CEO of Something"
        />
      </label>

      <label>
        <span>
          Bio <em className="muted">optional</em>
        </span>
        <textarea
          value={draft.bio}
          onChange={(event) => set("bio", event.target.value)}
          maxLength={1000}
          rows={5}
          placeholder="What are you planning to build on Neutron?"
        />
        <small>{draft.bio.length}/1000 — the first six lines show on your card.</small>
      </label>

      <LinksField links={draft.links} onChange={(links) => set("links", links)} />

      <div className="actions wizard-actions">
        <button className="btn" type="submit" disabled={handleState === "taken"}>
          Continue
        </button>
      </div>
    </form>
  );
}

// ── Step 2: roles ───────────────────────────────────────────────────────────

/**
 * Roles stack, so this is a set of choices rather than a picker — and each is
 * a card you select, not a switch that might already be on. Choosing nothing
 * is a real answer: it makes you an observer.
 */
const ROLES: {
  key: "hacker" | "judge" | "sponsor";
  name: string;
  blurb: string;
  effect: string;
  instant: boolean;
}[] = [
  {
    key: "hacker",
    name: "Hacker",
    blurb: "Build something and enter it in a qualifier week.",
    effect: "Starts straight away",
    instant: true,
  },
  {
    key: "judge",
    name: "Judge",
    blurb: "Choose entries with two votes a week, never your own.",
    effect: "A moderator reviews it",
    instant: false,
  },
  {
    key: "sponsor",
    name: "Sponsor",
    blurb: "Fund the prize pool on behalf of an organisation.",
    effect: "A moderator verifies the organisation",
    instant: false,
  },
];

function RolesStep({
  draft,
  ledgerAllowlist,
  set,
  onBack,
  onNext,
}: {
  draft: Draft;
  ledgerAllowlist: string[];
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const none = !draft.hacker && !draft.judge && !draft.sponsor;

  return (
    <form
      className="form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onNext();
      }}
    >
      <p className="muted">
        Pick everything that applies — they stack, and you can change your mind
        later from your profile.
      </p>

      <div className="role-picker">
        {ROLES.map((role) => {
          const on = draft[role.key];
          return (
            <div className="role-choice" key={role.key}>
              <button
                type="button"
                className={`role-card ${on ? "on" : ""}`}
                aria-pressed={on}
                aria-expanded={role.key === "sponsor" ? on : undefined}
                onClick={() => set(role.key, !on)}
              >
                <span className="role-box" aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
                <span className="role-body">
                  <strong>{role.name}</strong>
                  <small>{role.blurb}</small>
                </span>
                <span className={role.instant ? "role-effect instant" : "role-effect"}>
                  {role.effect}
                </span>
              </button>

              {/* Sponsoring needs more than a tick, so it asks for it right
                  here — attached to the card you just chose, rather than
                  further along where the connection is lost. */}
              {role.key === "sponsor" && on ? (
                <SponsorFields
                  draft={draft}
                  ledgerAllowlist={ledgerAllowlist}
                  set={set}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <p className={none ? "notice" : "muted small"}>
        {none
          ? "Nothing selected — you will join as an observer, free to watch the season and browse everyone taking part."
          : "You can still watch everything either way; these only add what you can do."}
      </p>

      <div className="actions wizard-actions">
        <button className="btn ghost" type="button" onClick={onBack}>
          Back
        </button>
        <button className="btn" type="submit">
          Continue
        </button>
      </div>
    </form>
  );
}

// ── Sponsor details ─────────────────────────────────────────────────────────

/**
 * Shown inline the moment sponsoring is picked.
 *
 * Being inside the step's form is what makes the required fields validate on
 * Continue, rather than at the button that creates everything.
 */
function SponsorFields({
  draft,
  ledgerAllowlist,
  set,
}: {
  draft: Draft;
  ledgerAllowlist: string[];
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  // No visible legend: it would sit on the seam with the card above, and that
  // card already names the role. The fieldset keeps an accessible name.
  return (
    <fieldset className="sponsor-fields" aria-label="Your organisation">
      <p className="muted small">
        A moderator checks this before your card goes on the sponsors board.
      </p>

      <div className="field-row">
        <label>
          <span>Organisation</span>
          <input
            value={draft.org}
            onChange={(event) => set("org", event.target.value)}
            maxLength={80}
            required
            placeholder="Helix Labs"
          />
        </label>
        <label>
          <span>
            Website <em className="muted">optional</em>
          </span>
          <input
            value={draft.website}
            onChange={(event) => set("website", event.target.value)}
            maxLength={256}
            type="url"
            placeholder="https://helix.example"
          />
        </label>
      </div>

      <label>
        <span>What you do</span>
        <textarea
          value={draft.blurb}
          onChange={(event) => set("blurb", event.target.value)}
          maxLength={500}
          rows={3}
          required
          placeholder="One or two lines about the organisation."
        />
        <small>{draft.blurb.length}/500 — this is the text on your card.</small>
      </label>

      <LedgerPicker
        value={draft.ledgers}
        allowlist={ledgerAllowlist}
        onChange={(ledgers) => set("ledgers", ledgers)}
      />

      <p className="muted small">
        A logo can be uploaded from your profile after you finish.
      </p>
    </fieldset>
  );
}

// ── Confirm ─────────────────────────────────────────────────────────────────

function ConfirmStep({
  draft,
  busy,
  onBack,
  onFinish,
  onDeclare,
}: {
  draft: Draft;
  busy: string | null;
  onBack: () => void;
  onFinish: () => void;
  onDeclare: (key: "terms", on: boolean) => void;
}) {
  const preview = usePreview(draft.photo);
  const chosen = ROLES.filter((role) => draft[role.key]);

  return (
    <form
      className="form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onFinish();
      }}
    >
      <div className="review">
        <div className="review-who">
          <Avatar
            user={{
              avatar: preview ? [preview] : [],
              displayName: draft.displayName,
              handle: draft.handle,
            }}
            size={56}
          />
          <div>
            <strong>{draft.displayName || draft.handle}</strong>
            <small className="muted">@{draft.handle}</small>
            {draft.title.trim() ? <small>{draft.title}</small> : null}
          </div>
        </div>

        <ul className="review-roles">
          {chosen.length === 0 ? (
            <li>
              <strong>Observer</strong>
              <small className="muted">Watching the season. Nothing to approve.</small>
            </li>
          ) : (
            chosen.map((role) => (
              <li key={role.key}>
                <strong>{role.name}</strong>
                <small className="muted">
                  {role.key === "sponsor" && draft.org.trim()
                    ? `${draft.org.trim()} — pending review.`
                    : role.instant
                      ? "Active as soon as you finish."
                      : "Pending review."}
                </small>
              </li>
            ))
          )}
        </ul>
      </div>

      {/*
        On the last step, not the first. These are the only two things on this
        page somebody is agreeing to rather than describing, and they belong
        next to the button that commits them — a checkbox three screens back is
        one nobody remembers ticking.
      */}
      {/*
        One acceptance, covering every role. It used to be three checkboxes —
        terms, sanctions, and an install permission — collected at different
        moments by different routes, which meant a route could forget one and
        an observer was asked things that did not apply to them. The agreement
        itself resolves that: it says you agree to the common rules and to the
        rules for every role you assume, so there is exactly one thing to
        accept and exactly one place to accept it.
      */}
      <fieldset className="declarations">
        <legend>Before you finish</legend>

        <label className="check">
          <input
            type="checkbox"
            checked={draft.terms}
            onChange={(event) => onDeclare("terms", event.target.checked)}
          />
          <span>
            I have read and agree to the{" "}
            {/* A new tab, not a navigation: a half-filled wizard that gets
                navigated away from is a wizard that gets abandoned. */}
            <a href="#/rules" target="_blank" rel="noreferrer">
              Season Rules &amp; Peer Participation Agreement
            </a>
            . I understand that the rules for every role I assume apply to me,
            that public and blockchain records may be permanent, that protocol
            actions and token transfers may be irreversible, and that I am
            responsible for my eligibility and taxes.
          </span>
        </label>
      </fieldset>

      <div className="actions wizard-actions">
        <button className="btn ghost" type="button" onClick={onBack} disabled={busy !== null}>
          Back
        </button>
        <button
          className="btn"
          type="submit"
          disabled={busy !== null || !draft.terms}
        >
          {busy === null ? "Create my profile" : `Setting up ${busy}…`}
        </button>
      </div>
    </form>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type HandleState = "idle" | "checking" | "free" | "taken";

/**
 * Is this handle still going? Handles are unique, and finding that out on the
 * last step — after everything else has been filled in — is the worst possible
 * moment for it.
 */
function useHandleCheck(handle: string): HandleState {
  const [state, setState] = useState<HandleState>("idle");

  useEffect(() => {
    const value = handle.trim().toLowerCase();
    if (!HANDLE_RE.test(value)) {
      setState("idle");
      return;
    }
    setState("checking");
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .getProfile(value)
        .then((found) => {
          // Without this a slow early reply could land after a later one and
          // report on a handle the field no longer holds.
          if (!cancelled) setState(found ? "taken" : "free");
        })
        .catch(() => {
          if (!cancelled) setState("idle");
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle]);

  return state;
}

function HandleNote({ state, handle }: { state: HandleState; handle: string }) {
  if (state === "taken") {
    return <small className="bad">@{handle.trim().toLowerCase()} is taken.</small>;
  }
  if (state === "free") {
    return <small className="ok">@{handle.trim().toLowerCase()} is free.</small>;
  }
  return <small>Lowercase letters, digits and underscore. Your public URL.</small>;
}

/** An object URL for the chosen file, revoked when it changes or unmounts. */
function usePreview(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  return url;
}
