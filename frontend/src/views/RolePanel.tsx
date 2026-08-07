import { useEffect, useState, type FormEvent } from "react";

import * as api from "../api";
import type { Deposit, SponsorApplication, SponsorLedger, User } from "../api";
import { CopyButton } from "./CopyButton";
import { LedgerPicker, TokenPill, TokenRow } from "./LedgerPicker";

/**
 * Changing what you do, after signing up.
 *
 * Roles stack — hacker, judge, sponsor and moderator are independent, and
 * holding none of them is what makes somebody an observer.
 *
 * Each row states where you stand and offers one plainly worded action. The
 * earlier version paired a bare "I'm hacking" button with a highlighted row,
 * which read as a setting that might already be on rather than a button that
 * would do something.
 */
export function RolePanel({
  user,
  onChange,
  ledgerAllowlist,
  judgesFrozen = false,
  sponsorsFrozen = false,
  disabled = false,
  disabledReason = "settling",
  showDisabledNotice = true,
}: {
  user: User;
  onChange: (user: User) => void;
  ledgerAllowlist: string[];
  /** The judge roster becomes immutable when the season starts. */
  judgesFrozen?: boolean;
  /** Sponsor applications become immutable when the season starts. */
  sponsorsFrozen?: boolean;
  disabled?: boolean;
  disabledReason?: "settling" | "finished";
  /** ProfileForm already renders the full settlement notice above this panel. */
  showDisabledNotice?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (what: string, action: () => Promise<User>) => {
    if (disabled || busy !== null) return;
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

  const judge = api.judgeState(user);

  return (
    <section className="roles">
      <h2 className="section-title">How you're taking part</h2>
      <p className="muted small">
        They stack, and none of them is required — with none you are an
        observer, free to watch.
      </p>

      {disabled && showDisabledNotice ? (
        <p className="notice">
          {disabledReason === "finished"
            ? "This one-season canister is finished. Participant roles are permanently read-only here."
            : "The season is settling up. Roles cannot change until direct-wallet distribution finishes or records its terminal failures."}
        </p>
      ) : null}

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="role-rows">
        <li className={user.hacker ? "role-row on" : "role-row"}>
          <div className="role-body">
            <strong>Hacker</strong>
            <small>
              {user.hacker
                ? "You can submit an entry in the open qualifier week."
                : "Build something and enter it in a qualifier week."}
            </small>
          </div>
          <RoleState on={user.hacker} label="hacking" />
          <div className="role-actions">
            <button
              type="button"
              className={user.hacker ? "btn ghost small" : "btn small"}
              disabled={disabled || busy !== null}
              onClick={() => run("hacker", () => api.setHacker(!user.hacker))}
            >
              {busy === "hacker" ? "…" : user.hacker ? "Stop hacking" : "Start hacking"}
            </button>
          </div>
        </li>

        <li className={judge === "approved" ? "role-row on" : "role-row"}>
          <div className="role-body">
            <strong>Judge</strong>
            <small>
              {judge === "approved"
                ? "You vote for entries — two votes a week, never your own."
                : judge === "pending"
                  ? judgesFrozen
                    ? "The season started before this application was approved; the roster is sealed."
                    : "A moderator is reviewing your application."
                  : judgesFrozen
                    ? "Judge applications closed when the season started."
                    : "Choose entries with your votes. Judges compete too."}
            </small>
          </div>
          <RoleState
            on={judge === "approved"}
            pending={judge === "pending"}
            label={judge === "pending" ? "pending" : "judging"}
          />
          <div className="role-actions">
            {judge === "no" && !judgesFrozen ? (
              <button
                type="button"
                className="btn small"
                disabled={disabled || busy !== null}
                onClick={() => run("judge", api.applyAsJudge)}
              >
                {busy === "judge" ? "…" : "Apply to judge"}
              </button>
            ) : judge === "pending" && !judgesFrozen ? (
              <span className="role-wait">Waiting on review</span>
            ) : judge !== "approved" && judgesFrozen ? (
              <span className="role-wait">Roster sealed</span>
            ) : null}
          </div>
        </li>

        <SponsorRow
          user={user}
          busy={busy}
          disabled={disabled}
          ledgerAllowlist={ledgerAllowlist}
          sponsorsFrozen={sponsorsFrozen}
          run={run}
          onChange={onChange}
        />

        {user.moderator ? (
          <li className="role-row on">
            <div className="role-body">
              <strong>Moderator</strong>
              <small>Appointed by a canister controller. Not self-service.</small>
            </div>
            <RoleState on label="moderating" />
            <div className="role-actions" />
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** Where you stand, as a word rather than a colour. */
function RoleState({
  on,
  pending = false,
  label,
}: {
  on: boolean;
  pending?: boolean;
  label: string;
}) {
  if (!on && !pending) return <span className="role-state" />;
  return (
    <span className="role-state">
      <span className={pending ? "badge judge_pending" : "badge"}>{label}</span>
    </span>
  );
}

function SponsorRow({
  user,
  busy,
  disabled,
  ledgerAllowlist,
  sponsorsFrozen,
  run,
  onChange,
}: {
  user: User;
  busy: string | null;
  disabled: boolean;
  ledgerAllowlist: string[];
  sponsorsFrozen: boolean;
  run: (what: string, action: () => Promise<User>) => Promise<void>;
  onChange: (user: User) => void;
}) {
  const state = api.sponsorState(user);
  const existing = api.sponsorInfo(user);
  const [open, setOpen] = useState(false);
  const [org, setOrg] = useState(existing?.org ?? "");
  const [website, setWebsite] = useState(existing?.website ?? "");
  const [blurb, setBlurb] = useState(existing?.blurb ?? "");
  const [ledgers, setLedgers] = useState<SponsorLedger[]>(api.sponsorLedgers(user));

  useEffect(() => {
    if (disabled || sponsorsFrozen || state === "approved") setOpen(false);
  }, [disabled, sponsorsFrozen, state]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || sponsorsFrozen || state === "approved") return;
    const application: SponsorApplication = {
      org: org.trim(),
      website: website.trim(),
      // The logo is uploaded separately; keep whatever is already set.
      logo: existing?.logo ?? [],
      blurb: blurb.trim(),
      ledgers,
    };
    await run("sponsor", () => api.applyAsSponsor(application));
    setOpen(false);
  };

  if (open) {
    return (
      <li className="role-row editing">
        <form className="sponsor-form" onSubmit={submit}>
          <div className="field-row">
            <label>
              <span>Organisation</span>
              <input
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                maxLength={80}
                required
                placeholder="Helix Labs"
                disabled={disabled}
              />
            </label>
            <label>
              <span>
                Website <em className="muted">optional</em>
              </span>
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                maxLength={256}
                type="url"
                placeholder="https://helix.example"
                disabled={disabled}
              />
            </label>
          </div>
          <label>
            <span>What you do</span>
            <textarea
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              maxLength={500}
              rows={3}
              required
              placeholder="One or two lines about the organisation."
              disabled={disabled}
            />
          </label>
          <LedgerPicker
            value={ledgers}
            allowlist={ledgerAllowlist}
            onChange={setLedgers}
            disabled={disabled || sponsorsFrozen}
          />

          <div className="actions">
            <button
              className="btn small"
              type="submit"
              disabled={disabled || sponsorsFrozen || busy !== null}
            >
              {busy === "sponsor" ? "…" : state === "no" ? "Apply" : "Save"}
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={state === "approved" ? "role-row on" : "role-row"}>
      <div className="role-body">
        <strong>Sponsor</strong>
        <small>
          {state === "approved"
            ? `${existing?.org ?? "Your organisation"} shows on the sponsors board.`
            : state === "pending"
              ? "A moderator is verifying the organisation."
              : "Fund the prize pool on behalf of an organisation."}
        </small>
        {sponsorsFrozen ? (
          <small className="muted">
            Sponsor applications and withdrawals closed when this season started.
          </small>
        ) : state === "approved" ? (
          <small className="muted">
            Approved details are frozen. Withdraw first if you need to reapply with changes.
          </small>
        ) : null}
        {state !== "no" ? (
          <DepositAddress user={user} disabled={disabled} onChange={onChange} />
        ) : null}
      </div>

      <RoleState
        on={state === "approved"}
        pending={state === "pending"}
        label={state === "pending" ? "pending" : "sponsoring"}
      />

      <div className="role-actions">
        {state !== "approved" ? (
          <button
            type="button"
            className="btn small"
            disabled={disabled || sponsorsFrozen || busy !== null}
            onClick={() => setOpen(true)}
          >
            {state === "no" ? "Apply to sponsor" : "Edit application"}
          </button>
        ) : null}
        {state !== "no" && !sponsorsFrozen ? (
          <button
            type="button"
            className="btn ghost small"
            disabled={disabled || busy !== null}
            onClick={() => run("sponsor", api.withdrawSponsor)}
          >
            Withdraw
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Where an approved sponsor sends tokens, and in which.
 *
 * Shown only while a season is actually running, because that is the only time
 * the treasury will collect a deposit — `Treasury.sweep` refuses otherwise.
 * Showing an address that cannot be swept invites a transfer that then sits in
 * a subaccount with no refund path, so before a season starts and after one
 * ends there is no address on screen at all.
 */
function DepositAddress({
  user,
  disabled,
  onChange,
}: {
  user: User;
  disabled: boolean;
  onChange: (user: User) => void;
}) {
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [phase, setPhase] = useState<api.PhaseName | "none" | null>(null);

  useEffect(() => {
    void api
      .myDeposit()
      .then(setDeposit)
      .catch(() => setDeposit(null));
    void api
      .getSeason()
      .then((season) => setPhase(season ? api.phaseOf(season) : "none"))
      .catch(() => setPhase("none"));
  }, []);

  if (phase === null) return null;

  // The phase decides, not the address. The canister withholds the address
  // outside a running season — so checking `deposit` first would show a
  // sponsor nothing at all, exactly when they need to be told why.
  if (phase !== "running" || !deposit) {
    return (
      <div className="deposit closed">
        <small className="muted">
          {phase === "draft"
            ? "The season has not started yet. Your deposit address appears here the moment it does."
            : phase === "finished"
              ? "This one-season canister has finished. Deposits are permanently closed here."
              : "Waiting for this canister's season to start. Your deposit address appears then — nothing sent before it opens can be collected."}
        </small>
      </div>
    );
  }

  return (
    <div className="deposit">
      <small>Send ICRC-1 tokens to</small>
      <div className="deposit-row">
        <code className="deposit-account">{api.icrcAccount(deposit)}</code>
        <CopyButton value={api.icrcAccount(deposit)} />
      </div>
      {deposit.ledgers.length > 0 ? (
        <>
          <small>in any of</small>
          <ul className="deposit-tokens">
            {deposit.ledgers.map((ledger) => (
              <li key={ledger.id.toText()}>
                <TokenRow id={ledger.id.toText()} sns={ledger.sns} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <small className="muted">
          No tokens pledged yet — add one above and this address accepts it.
        </small>
      )}
      <small>
        One way — there is no refund path. Funds are swept into the treasury
        once a season is running.
      </small>

      <Collect user={user} disabled={disabled} onCollected={onChange} />
    </div>
  );
}

/**
 * "I have sent it" — and what has arrived so far.
 *
 * The sponsor transfers, then says so, and the canister reads the balance and
 * moves it. Nothing here names an amount: the figures below are what the
 * canister found on the ledgers and swept, which is the only way a
 * contribution is ever recorded.
 */
function Collect({
  user,
  disabled,
  onCollected,
}: {
  user: User;
  disabled: boolean;
  onCollected: (user: User) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const given = api.sponsorGifts(user).filter((gift) => gift.amount > 0n);
  const total = given.length;

  const collect = async () => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const moved = await api.notifyDeposits();
      setNote(
        moved.length === 0
          ? "Nothing new arrived. If you have just sent something, give the ledger a moment."
          : `Collected on ${moved.length} ${moved.length === 1 ? "ledger" : "ledgers"}.`,
      );
      const me = await api.getMe();
      if (me) onCollected(me);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="collect">
      <div className="collect-head">
        <div>
          <strong>Sent something?</strong>
          <small className="muted">
            Tell the canister and it will check every ledger you pledged and
            move what it finds into the treasury.
          </small>
        </div>
        <button
          type="button"
          className="btn small"
          disabled={disabled || busy}
          onClick={collect}
        >
          {busy ? "Checking…" : "Notify deposits"}
        </button>
      </div>

      {note ? <small className="ok">{note}</small> : null}
      {error ? <small className="bad">{error}</small> : null}

      {total > 0 ? (
        <>
          <small>you have contributed</small>
          <ul className="treasury-list">
            {given.map((gift) => (
              <TokenPill key={gift.ledger.toText()} ledger={gift.ledger.toText()} amount={gift.amount} />
            ))}
          </ul>
        </>
      ) : (
        <small className="muted">Nothing collected from you yet.</small>
      )}
    </div>
  );
}
