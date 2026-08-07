import { useEffect, useState } from "react";

import * as api from "../api";
import type { Store, User } from "../api";
import { Award } from "./Award";

/**
 * The short invitation. Competition mechanics and participant obligations live
 * on the canonical Rules page; this page gets a newcomer to the right next
 * action without maintaining a second rulebook in footnotes.
 */
export function Landing({
  me,
  signedIn,
  config,
  onSignIn,
}: {
  me: User | null;
  signedIn: boolean;
  config: Store | null;
  onSignIn: () => void;
}) {
  const [stats, setStats] = useState<{ users: number } | null>(null);

  useEffect(() => {
    void api
      .counts()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  // Null while config loads. Treat it as open so the hero does not flash a
  // closed notice before the query returns.
  const closed = config ? !config.registrationOpen : false;
  const nextSeasonUrl = config?.nextSeasonUrl.trim() ?? "";

  return (
    <>
      <section className="hero">
        <span className="eyebrow">AI-assisted apps for Neutron</span>
        <h1>{config?.siteTitle ?? "Neutron Hackathon"}</h1>
        <p className="lede">
          Build a Neutron app with the workflow you choose. Four qualifier weeks lead to a
          one-day semi-final and a one-day final. Closing the final starts automatic prize
          distribution, sent directly to the winners' chosen wallets.
        </p>

        {closed ? (
          <p className="notice warn">
            <strong>New participant registration is closed for this season.</strong> You can
            still observe the apps, votes, prize pool, and results.
            {nextSeasonUrl ? (
              <>
                {" "}
                <a href={nextSeasonUrl} target="_blank" rel="noreferrer">
                  Go to the next season.
                </a>
              </>
            ) : null}
          </p>
        ) : null}

        <div className="actions">
          {me ? (
            <a className="btn" href="#/season">
              Go to the season
            </a>
          ) : closed ? null : signedIn ? (
            <a className="btn" href="#/register">
              Complete registration
            </a>
          ) : (
            <button className="btn" onClick={onSignIn}>
              Register with Internet Identity
            </button>
          )}
          <a className={closed && !me ? "btn" : "btn ghost"} href="#/season">
            See the bracket
          </a>
          <a className="btn ghost" href="#/rules">
            Read the rules
          </a>
        </div>
      </section>

      <section className="page">
        <h2 className="section-title">Four ways to take part</h2>
        <p className="muted">
          Roles stack, but conflicts do not disappear when they do: nobody votes for or
          reviews their own work.
        </p>
        <ul className="role-cards">
          <li>
            <strong>Hacker</strong>
            <p>
              Set a reward wallet, build an app, and propose one entry per qualifier week.
              The role is self-service; every entry and update is reviewed before it appears.
            </p>
          </li>
          <li>
            <strong>Judge</strong>
            <p>
              Apply before the season. Two moderators approve you, then you may choose up to
              two different eligible entries in each open round.
            </p>
          </li>
          <li>
            <strong>Sponsor</strong>
            <p>
              Apply with an organisation and approved ICRC-1 ledgers. Two moderators approve
              the application before a running season shows a funding address.
            </p>
          </li>
          <li>
            <strong>Moderator</strong>
            <p>
              Review applications, submissions, updates, reports, and takedowns. The
              canister—not a moderator—runs deadlines and payout.
            </p>
          </li>
        </ul>
      </section>

      <section className="page">
        <h2 className="section-title">One season, one public bracket</h2>
        <ol className="how">
          <li>
            <span className="how-when">Weeks 1–4</span>
            <span className="how-what">
              <strong>Qualifiers.</strong> Approved apps compete for two votes from each
              judge. The top five earn bronze and the top entry advances. Equal votes favor
              the earlier submission.
            </span>
          </li>
          <li>
            <span className="how-when">1 day</span>
            <span className="how-what">
              <strong>Semi-final.</strong> Week 1 meets 2 and week 3 meets 4. Winning entries
              are carried automatically, including several separate entries owned by the
              same hacker.
            </span>
          </li>
          <li>
            <span className="how-when">1 day</span>
            <span className="how-what">
              <strong>Final.</strong> The two duel winners compete. The top entry earns gold.
            </span>
          </li>
          <li>
            <span className="how-when">After close</span>
            <span className="how-what">
              <strong>Distribution.</strong> The canister reconciles the approved funding
              ledgers, drafts the fixed plan, and sends prizes directly to winner wallets.
              Failed ledger calls may need bounded retries.
            </span>
          </li>
        </ol>
        <div className="actions">
          <a className="btn ghost small" href="#/rules">
            Schedule, edge cases, funding, and agreement
          </a>
        </div>
      </section>

      <section className="page">
        <h2 className="section-title">Full-field award shares</h2>
        <ul className="prize-cards">
          {api.MEDALS.map((tier) => (
            <li key={tier.medal} className={tier.medal}>
              <Award medal={tier.medal} size={32} />
              <strong>{tier.name}</strong>
              <span className="prize-share">{api.formatPercent(api.shareEach(tier.medal))}</span>
              <small className="muted">{tier.won}</small>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Each app is paid once for its best finish. A non-empty thin field renormalises the
          award weights among payable winners; ledger fees, skipped dust, and permanent
          failures can reduce what transfers. The full rule is on the Rules page.
        </p>
      </section>

      <section className="stats">
        <Stat label="Registered" value={stats ? String(stats.users) : "—"} />
        <Stat label="One season" value="4 wks + 2 days" />
      </section>

      <section className="page build-cta">
        <span className="eyebrow">Build with an agent</span>
        <h2>Turn your idea into a Neutron app</h2>
        <p>
          Start from the real source, give your coding agent one app folder and a clear
          brief, then iterate locally until the human interface and agent tools are ready.
        </p>
        <a className="btn build-cta-button" href="#/build">
          Open the build guide
          <span aria-hidden="true">→</span>
        </a>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
