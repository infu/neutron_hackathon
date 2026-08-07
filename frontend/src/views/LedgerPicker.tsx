import { useEffect, useMemo, useState } from "react";

import * as api from "../api";
import type { SponsorLedger } from "../api";
import {
  cachedToken,
  fetchToken,
  formatAmount,
  knownToken,
  trustedTokenLogo,
  type TokenMeta,
} from "../tokens";

/**
 * Choosing which tokens you will pay in.
 *
 * The catalogue lists what exists; the ledger itself says what is true. Every
 * pick is confirmed by reading `icrc1_metadata` from the canister, so a
 * mistyped or retired id fails here rather than after somebody has sent
 * tokens to it — and that same read is where decimals and most logos come from.
 *
 * The canister configuration freezes the event's ICRC-1 allowlist. The picker
 * shows only those principals and still reads their metadata before adding
 * one, so an unavailable or non-ledger canister fails before approval.
 */
export function LedgerPicker({
  value,
  onChange,
  allowlist,
  disabled = false,
}: {
  value: SponsorLedger[];
  onChange: (ledgers: SponsorLedger[]) => void;
  /** Fixed event-level ledger ids, supplied by the backend configuration. */
  allowlist: string[];
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(() => new Set(value.map((l) => l.id.toText())), [value]);
  const allowed = useMemo(() => [...new Set(allowlist)], [allowlist]);
  const allowedSet = useMemo(() => new Set(allowed), [allowed]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = allowed.filter((id) => !chosen.has(id));
    if (needle === "") return pool.slice(0, 8);
    return pool
      .filter((id) => {
        const token = cachedToken(id) ?? knownToken(id);
        return (
          id.toLowerCase().includes(needle) ||
          token?.symbol.toLowerCase().includes(needle) ||
          token?.name.toLowerCase().includes(needle)
        );
      })
      .slice(0, 8);
  }, [allowed, query, chosen]);

  const add = async (id: string) => {
    if (disabled) return;
    if (!allowedSet.has(id)) {
      setError("That ledger is not enabled for this event.");
      return;
    }
    setBusy(id);
    setError(null);
    try {
      // The check that it works, not just that it parses.
      const meta = await fetchToken(id);
      onChange([...value, { id: api.toPrincipal(id), sns: meta.sns }]);
      setQuery("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const full = value.length >= api.MAX_LEDGERS;

  return (
    <div className="ledger-picker">
      <span className="owner-legend">
        Tokens{" "}
        <em className="muted">
          {value.length}/{api.MAX_LEDGERS}
        </em>
      </span>

      {value.length > 0 ? (
        <ul className="ledger-chosen">
          {value.map((ledger) => (
            <li key={ledger.id.toText()}>
              <TokenRow id={ledger.id.toText()} sns={ledger.sns} />
              <button
                type="button"
                className="btn ghost small"
                disabled={disabled || busy !== null}
                onClick={() => onChange(value.filter((l) => l.id.toText() !== ledger.id.toText()))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          None yet. Pick the tokens you intend to fund the prize pool with.
        </p>
      )}

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      {full ? (
        <p className="muted small">That is as many as one sponsor may pledge.</p>
      ) : allowed.length === 0 ? (
        <p className="notice warn">
          No payout ledgers have been enabled for this event yet.
        </p>
      ) : (
        <>
          <input
            className="ledger-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ICP, ckBTC, an SNS token…"
            aria-label="Search tokens"
            spellCheck={false}
            disabled={disabled}
          />

          <ul className="ledger-options">
            {matches.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="ledger-option"
                  disabled={disabled || busy !== null}
                  onClick={() => add(id)}
                >
                  <TokenRow id={id} />
                  <span className="ledger-add">{busy === id ? "Checking…" : "Add"}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="muted small">No enabled ledger matches that search.</li>
            ) : null}
          </ul>
          <small className="muted">
            These are the event's fixed payout ledgers. We verify the selected
            ledger's metadata before adding it.
          </small>
        </>
      )}
    </div>
  );
}

/**
 * One token, as the ledger describes itself.
 *
 * Falls back to the catalogue while the fetch is in flight so the row does not
 * appear empty, then replaces it with what the canister actually said.
 */
export function TokenRow({
  id,
  sns,
  amount,
}: {
  id: string;
  sns?: boolean;
  /** Shown in the token's own units when given. */
  amount?: bigint;
}) {
  const meta = useToken(id);
  const known = knownToken(id);
  const symbol = meta?.symbol ?? known?.symbol ?? "…";
  const name = meta?.name ?? known?.name ?? id;
  const isSns = meta?.sns ?? sns ?? known?.sns ?? false;

  return (
    <span className="token">
      <TokenLogo id={id} meta={meta} symbol={symbol} />
      <span className="token-copy">
        <strong>
          {symbol}
          {isSns ? <span className="ledger-tag">SNS</span> : null}
        </strong>
        <small>{name}</small>
        <code>{id}</code>
      </span>
      {amount !== undefined ? (
        <span className="token-amount">
          {meta ? formatAmount(amount, meta.decimals) : "…"}
          <small>{meta ? `${meta.decimals} decimals` : "reading ledger"}</small>
        </span>
      ) : meta ? (
        <span className="token-decimals">{meta.decimals} decimals</span>
      ) : null}
    </span>
  );
}

export function TokenLogo({
  id,
  meta,
  symbol,
}: {
  id: string;
  meta: TokenMeta | null;
  symbol: string;
}) {
  const logo = meta?.logo ?? trustedTokenLogo(id);
  if (logo) return <img className="token-logo" src={logo} alt="" />;
  return (
    <span className="token-logo placeholder" aria-hidden="true">
      {symbol.replace(/^ck/, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Metadata for one ledger, fetched once and shared for the session. */
export function useToken(id: string): TokenMeta | null {
  const [meta, setMeta] = useState<TokenMeta | null>(() => cachedToken(id));

  useEffect(() => {
    const hit = cachedToken(id);
    if (hit) {
      setMeta(hit);
      return;
    }
    let cancelled = false;
    void fetchToken(id)
      .then((found) => {
        if (!cancelled) setMeta(found);
      })
      .catch(() => {
        // A ledger that has since stopped answering should not blank the row
        // it is described in; the catalogue name still stands.
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return meta;
}

/**
 * One token as a compact pill: a mark, a number, a ticker, and whether it is
 * an SNS ledger.
 *
 * Used wherever an amount is the point and the ledger's identity is not — the
 * prize pool and a sponsor's contributions — as against `TokenRow`, which is
 * for choosing or approving a ledger and shows its name and canister id.
 */
export function TokenPill({ ledger, amount }: { ledger: string; amount: bigint }) {
  const meta = useToken(ledger);
  const known = knownToken(ledger);
  const symbol = meta?.symbol ?? known?.symbol ?? "…";
  const isSns = meta?.sns ?? known?.sns ?? false;
  return (
    <li className="token-pill">
      <TokenLogo id={ledger} meta={meta} symbol={symbol} />
      <strong>{meta ? formatAmount(amount, meta.decimals) : "…"}</strong>
      <small>{symbol === "…" ? "" : symbol}</small>
      {isSns ? <span className="ledger-tag">SNS</span> : null}
    </li>
  );
}
