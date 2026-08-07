import * as api from "../api";
import type { PublicUser } from "../api";
import { Avatar } from "./Avatar";
import { LinkIcon } from "./LinkIcon";
import { useToken } from "./LedgerPicker";
import { formatAmount } from "../tokens";
import { knownToken } from "../tokens";

/**
 * Fixed-height card. The bio is clamped to exactly six lines so a row of four
 * always aligns — see `--bio-lines` in styles.css.
 *
 * Sponsors get a different box entirely: the logo is the point, so it leads,
 * and the organisation replaces the person as the headline.
 */
export function PersonCard({
  user,
  anchor,
  showJudgeBadge = true,
  asSponsor = false,
}: {
  user: PublicUser;
  anchor?: string;
  showJudgeBadge?: boolean;
  asSponsor?: boolean;
}) {
  const id = anchor ? `letter-${anchor}` : undefined;
  if (asSponsor && api.isSponsor(user)) {
    return <SponsorCard user={user} id={id} />;
  }

  const title = api.title(user);

  return (
    <a className="person" href={`#/u/${user.handle}`} id={id}>
      <header className="person-head">
        <Avatar user={user} size={44} />
        <div className="person-id">
          <span className="person-name">{user.displayName || user.handle}</span>
          <span className="person-handle">@{user.handle}</span>
        </div>
      </header>

      {title ? <p className="person-title">{title}</p> : null}

      {user.bio ? (
        <p className="person-bio">{user.bio}</p>
      ) : (
        <p className="person-bio empty">No bio yet.</p>
      )}

      {/* Only approved states are public; a pending application is not. */}
      {showJudgeBadge && api.isJudge(user) ? <span className="badge">judge</span> : null}
    </a>
  );
}

/** Hostname only — a full URL would wrap and swamp the card. */
/**
 * What this sponsor has actually put in, per token.
 *
 * Only swept amounts count — a pledged ledger with nothing behind it says
 * "pledged", because promising a token and funding one are different things
 * and the board should not blur them.
 */
function Given({ user }: { user: PublicUser }) {
  const gifts = api.sponsorGifts(user);
  const pledged = api.sponsorLedgers(user);
  if (gifts.length === 0 && pledged.length === 0) return null;

  const givenIds = new Set(gifts.map((gift) => gift.ledger.toText()));
  const onlyPledged = pledged.filter((l) => !givenIds.has(l.id.toText()));

  return (
    <ul className="sponsor-given">
      {gifts.map((gift) => (
        <li key={gift.ledger.toText()} className="given">
          <TokenAmount id={gift.ledger.toText()} amount={gift.amount} />
        </li>
      ))}
      {onlyPledged.map((ledger) => (
        <li key={ledger.id.toText()} className="pledged">
          <TokenAmount id={ledger.id.toText()} />
        </li>
      ))}
    </ul>
  );
}

/** A symbol with its amount, in the token's own units. */
function TokenAmount({ id, amount }: { id: string; amount?: bigint }) {
  const meta = useToken(id);
  const known = knownToken(id);
  const symbol = meta?.symbol ?? known?.symbol ?? "…";

  if (amount === undefined) return <span title={id}>{symbol}</span>;
  return (
    <span title={id}>
      <b>{meta ? formatAmount(amount, meta.decimals) : "…"}</b> {symbol}
    </span>
  );
}

function prettyHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SponsorCard({ user, id }: { user: PublicUser; id?: string }) {
  const info = api.sponsorInfo(user);
  const logo = api.sponsorLogo(user);

  return (
    <a className="sponsor-card" href={`#/u/${user.handle}`} id={id}>
      <div className="sponsor-logo">
        {logo ? (
          <img src={logo} alt={info?.org ?? user.handle} loading="lazy" />
        ) : (
          <span className="sponsor-mark">{(info?.org ?? user.handle).charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="sponsor-body">
        <strong className="sponsor-org">{info?.org || user.displayName || user.handle}</strong>
        {info?.blurb ? <p className="sponsor-blurb">{info.blurb}</p> : null}

        <Given user={user} />

        <span className="sponsor-meta">
          <span className="person-handle">@{user.handle}</span>
          {info?.website ? (
            <span className="sponsor-site">
              <LinkIcon kind="site" url={info.website} />
              {prettyHost(info.website)}
            </span>
          ) : null}
        </span>
      </div>
    </a>
  );
}
