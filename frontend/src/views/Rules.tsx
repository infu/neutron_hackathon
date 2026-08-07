import { useEffect, useState, type MouseEvent } from "react";

import * as api from "../api";
import type { Season } from "../api";
import { TokenRow } from "./LedgerPicker";
import { Prose } from "./Prose";
import { RULES_EFFECTIVE_AT, RULES_MARKDOWN, RULES_VERSION } from "./rules-text";

const FALLBACK_TERMS = {
  version: RULES_VERSION,
  effectiveAt: new Date(RULES_EFFECTIVE_AT),
};

type Loaded<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "error" };

/**
 * The one participant-facing rules source.
 *
 * The guide answers the practical questions first. The detailed participation
 * agreement follows it on the same route, so signup never sends somebody
 * elsewhere to discover what they accepted.
 * Schedule and ledger facts come from the canister; neither is copied into a
 * second document that could drift from live state.
 */
export function Rules() {
  const [terms, setTerms] = useState(FALLBACK_TERMS);
  const [season, setSeason] = useState<Loaded<Season | null>>({ state: "loading" });
  const [ledgers, setLedgers] = useState<Loaded<string[]>>({ state: "loading" });
  const [instructionCap, setInstructionCap] = useState<Loaded<bigint>>({
    state: "loading",
  });

  useEffect(() => {
    let cancelled = false;

    void api
      .getSeason()
      .then((value) => {
        if (!cancelled) setSeason({ state: "ready", value });
      })
      .catch(() => {
        if (!cancelled) setSeason({ state: "error" });
      });

    // Independent on purpose: an unreachable ledger list must not erase the
    // schedule, and a failed season query must not turn approved ledgers into
    // an empty set.
    void api
      .treasuryLedgers()
      .then((value) => {
        if (!cancelled) {
          setLedgers({ state: "ready", value: [...new Set(value)].sort() });
        }
      })
      .catch(() => {
        if (!cancelled) setLedgers({ state: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .termsInfo()
      .then((value) => {
        if (!cancelled) setTerms(value);
      })
      .catch(() => {
        // This immutable build carries the exact version/date as a fallback so
        // a failed informational query never hides the agreement.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .getConfig()
      .then((value) => {
        if (!cancelled) setInstructionCap({ state: "ready", value: value.instructionCap });
      })
      .catch(() => {
        if (!cancelled) setInstructionCap({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const termsEffective = termsDate(terms.effectiveAt);

  return (
    <section className="page rules-page">
      <header className="page-head rules-head">
        <div>
          <span className="eyebrow">
            Version {terms.version} · effective {termsEffective}
          </span>
          <h1>Rules</h1>
          <p className="lede">
            The practical competition guide comes first. The detailed agreement you accept
            when you register follows on this same page.
          </p>
        </div>
      </header>

      <nav className="rules-jumps" aria-label="On this page">
        <RulesJump target="rules-season">Season</RulesJump>
        <RulesJump target="rules-roles">Roles</RulesJump>
        <RulesJump target="rules-limits">Limits</RulesJump>
        <RulesJump target="rules-build">Build</RulesJump>
        <RulesJump target="rules-judge">Judging</RulesJump>
        <RulesJump target="rules-funding">Funding</RulesJump>
        <RulesJump target="rules-rewards">Rewards</RulesJump>
        <RulesJump target="rules-trust">Trust</RulesJump>
        <RulesJump target="rules-agreement">Agreement</RulesJump>
      </nav>

      <article className="rules-guide" aria-labelledby="rules-guide-title">
        <header className="rules-guide-intro">
          <span className="eyebrow">Participant guide</span>
          <h2 id="rules-guide-title">How this hackathon works</h2>
          <p>
            Build a <code>.neutron</code> app, enter it during a qualifier, and follow the
            public bracket. AI-assisted building is the theme; the submitted app is the
            entry shown in each round. Entry is free.
          </p>
          <p className="muted small">
            This guide contains the competition rules in plain language and forms part of
            the detailed agreement below. Live dates and approved ledgers are read from this
            canister. The installed code determines what the canister can execute; the
            agreement governs how participants act.
          </p>
        </header>

        <GuideSection id="rules-season" title="Season and live schedule">
          <p>
            One canister runs one season: four one-week qualifiers, a one-day semi-final,
            and a one-day final. A moderator starts it only after the canister has been
            sealed with itself as its sole controller. From then on, deadlines close each
            round automatically; nobody can close one early. If a timer disappears after a
            cycles interruption, a moderator can ask the installed code to check its stored
            state and re-arm or run only the action already due.
          </p>
          <p>
            Before sealing, registration must be closed and the launch check must find
            between three and eight current moderators, at least three approved judges, and
            at least one approved sponsor naming an approved ledger. Every pending judge
            and sponsor application must be decided. The same atomic check seals the
            prepared season, so nobody can slip a registration or role change between the
            check and the freeze.
          </p>
          <Schedule state={season} />
        </GuideSection>

        <GuideSection id="rules-roles" title="Who can take part">
          <p>
            You must be able to accept this agreement and participate lawfully where you
            live. Do not participate or transfer tokens if sanctions or other law prohibit
            it. One Internet Identity principal creates one profile. Registration admits
            up to 1,200 profiles, up to 1,000 of which may hold the hacker role, and roles
            may stack.
          </p>
          <dl className="rules-definitions">
            <div>
              <dt>Hacker</dt>
              <dd>
                Turns the role on directly, sets a reward wallet, and submits apps for
                moderator review.
              </dd>
            </div>
            <div>
              <dt>Judge</dt>
              <dd>
                Applies before the season. Two moderators approve the application, and the
                judge set freezes when the season starts.
              </dd>
            </div>
            <div>
              <dt>Sponsor</dt>
              <dd>
                Applies with an organisation and proposed ledgers. Two moderators approve
                the application before any funding route opens.
              </dd>
            </div>
            <div>
              <dt>Moderator</dt>
              <dd>
                Is appointed before sealing and reviews applications, entries, updates,
                reports, and takedowns. A moderator cannot review their own work or
                application. A moderator can also check stalled lifecycle automation, but
                cannot supply a deadline, outcome, ledger, amount, wallet, or payout plan.
                Emergency controller recovery is separate and requires three distinct
                current moderators.
              </dd>
            </div>
          </dl>
          <p className="muted small">
            Holding several roles never removes a conflict rule: a judge cannot vote for
            their own entry, and a moderator cannot approve or reject their own material.
          </p>
        </GuideSection>

        <GuideSection id="rules-limits" title="Canister-enforced limits">
          <p>
            These are production limits enforced by the installed canister, not test
            targets. Places and storage are first-come within the caps, and an action is
            refused when its account or shared event limit has been reached.
          </p>
          <dl className="rules-definitions">
            <div>
              <dt>People and entries</dt>
              <dd>
                1,200 profiles total; at most 1,000 hackers, 64 approved sponsors, and
                eight moderators. Each qualifier accepts at most 1,000 entries.
              </dd>
            </div>
            <div>
              <dt>Hacker storage</dt>
              <dd>
                64 live asset keys and 32,000,000 bytes of fixed-slot storage per hacker
                account. The smaller per-file limits in the Build section still apply.
              </dd>
            </div>
            <div>
              <dt>Other account storage</dt>
              <dd>
                Two live asset keys and 262,144 bytes of fixed-slot storage per account
                without the hacker role. App files must be deleted down to this allowance
                before leaving the hacker role.
              </dd>
            </div>
            <div>
              <dt>Shared asset store</dt>
              <dd>
                80,000 live slots and 70,332,186,624 bytes of reserved stable asset
                capacity across the whole store, including the shipped site. Reaching
                either cap can refuse an upload even when its account has room.
              </dd>
            </div>
          </dl>
          <p className="muted small">
            Storage is charged by the fixed allocator slot selected for a file, not only by
            its payload bytes. Deleting a file releases its live slot for reuse, but does not
            shrink stable-memory regions already reserved by the allocator.
          </p>
          <InstructionLimit state={instructionCap} />
          <p>
            The canister retains the newest eight revision-review records per account and
            the newest 32 judge, sponsor, and moderator status actions per profile. A
            revision-refusal reason is limited to 2,000 characters. A content report is
            limited to 500 characters; each caller may file three in a rolling hour, all
            callers together may file 100 in a rolling hour, and at most 10,000 reports may
            be stored at once.
          </p>
        </GuideSection>

        <GuideSection id="rules-build" title="Build, submit, and update">
          <p>
            A submission is a Neutron app: a required <code>.neutron</code> package plus its
            title, summary, icon, screenshots, and links. A hacker may submit once in each
            qualifier week, and each qualifier accepts at most 1,000 entries. A reward
            wallet must be set first because prizes go directly there.
          </p>
          <p>
            Every new entry and update is a revision awaiting moderation. Until it is
            approved, only its author and moderators can see it; an existing app keeps
            showing its last approved version. To change approved work, upload fresh files
            and submit another revision. Referenced files cannot be silently replaced. Your
            newest eight revision-review records are retained; a refusal explanation is
            limited to 2,000 characters, and a longer machine report can be linked. Only one
            entry-or-update revision per account may be waiting in a qualifier week.
          </p>
          <p>
            If more than one of your apps is active in a round, choose the exact app you are
            updating. The version and its moderator decision apply only to that app. One
            uploaded package or image URL cannot be shared by separate apps. To use the same
            bytes in another app, upload them again under a different URL; carried copies of
            the same app may continue sharing their files.
          </p>
          <p>
            In the semi-final and final, the carried title, icon, screenshots, links, and app
            id stay fixed. A finalist may still upload a fresh <code>.neutron</code> package
            and submit it as a version for moderator review while the round&apos;s update
            window remains open.
          </p>
          <p>
            The final-hour voting lock also freezes app content. Once one hour remains in
            the open round, nobody may propose or approve another revision for its entries;
            the version already visible is the version judged through the deadline. Finish
            both submission and moderation before that boundary.
          </p>
          <ul>
            <li>Up to six screenshots and six links per entry.</li>
            <li>100 KB per icon, 400 KB per screenshot, and 1.9 MB per package.</li>
            <li>
              Image uploads may be PNG, JPEG, WebP, GIF, or AVIF. Build uploads are
              named <code>&lt;digits&gt;.neutron</code>; other hosted file types and
              nested upload paths are refused.
            </li>
            <li>
              Up to 30 changelog entries, 64 live asset keys, and exactly 32,000,000
              bytes of fixed-slot storage per hacker account.
            </li>
            <li>Closed rounds and the versions judged in them are permanent records.</li>
          </ul>
        </GuideSection>

        <GuideSection id="rules-judge" title="Judging, voting, and the bracket">
          <p>
            Judges independently choose up to two of the strongest eligible apps in each
            round. There are no scores, weights, category quotas, or hidden judging rubric.
            Only votes recorded by the canister determine the ranking.
          </p>
          <p>
            The two votes must land on different entries. A judge may withdraw and re-cast a
            vote only while more than one hour remains. At exactly one hour before the
            deadline, every vote already recorded is locked; unused votes may still be cast
            until the countdown reaches zero. A judge may not vote for their own entry and
            does not have to spend both. There is no quorum. Equal vote totals are ordered by
            earlier submission.
          </p>
          <p>
            The countdown below the bracket uses the round deadline stored by the canister
            and runs locally in the browser, so it does not repeatedly contact the canister.
            Use the refresh button beside it to load the latest bracket and vote totals, and
            after zero to load the next round.
          </p>
          <p>
            In each qualifier, the top five earn bronze and the top entry advances. The same
            hacker may win more than one qualifier: each winning origin is a separate bracket
            seat, so one person may hold several semi-final or final entries. A judge may use
            their two votes on two distinct entries by the same author.
          </p>
          <p>
            Week 1 meets week 2 and week 3 meets week 4 in two semi-final duels. Each duel
            winner reaches the final. Nothing is backfilled: an empty qualifier leaves an
            empty seat, and a one-entry duel is a walkover even on zero votes.
          </p>
        </GuideSection>

        <GuideSection id="rules-funding" title="Sponsors, approved ledgers, and funding">
          <p>
            Before the season, up to 64 sponsors may each propose at most seven ledgers
            from the fixed event allowlist of no more than seven reviewed ICRC-1 ledgers in
            total. The canister checks each ledger and moderators review the application.
            The approved sponsor and ledger set freezes permanently when the season starts.
          </p>
          <ApprovedLedgers state={ledgers} season={season} />
          <p>
            An approved sponsor sees a deposit address only while the season is running.
            They transfer on an approved ledger, then ask the canister to collect it. Only
            an amount the canister successfully sweeps counts as a contribution or prize
            pool balance. A sponsor may request collection at most once every 60 seconds.
          </p>
          <p className="notice warn">
            Deposits are irreversible and non-refundable. Funding closes at the final
            deadline. The canister first lets any sweep admitted before that deadline receive
            its definite ledger reply, then reconciles. The launch relies on each approved
            ledger eventually giving that reply. Elapsed time never clears an unknown
            transfer: if the assumption fails, reconciliation stays visibly blocked instead
            of collecting twice or counting uncertain funds.
          </p>
          <p>
            A final snapshot requires a complete pass that began after the five-minute
            grace. Failed reads retry normally once a minute. Persistent failures are
            recorded only after at least 15 completed full passes and a full pass begun after
            the grace. If pass 15 began too early, one additional pass is required. An unread
            ledger at that cutoff is reported as failed and its unknown balance is not counted
            in the prize pool. Transfers made outside the displayed funding window are
            unsupported.
          </p>
        </GuideSection>

        <GuideSection id="rules-rewards" title="Awards and direct payment">
          <ul className="rules-awards">
            <li>
              <strong>Bronze · 2.5%</strong>
              <span>Each paid qualifier place in a full field.</span>
            </li>
            <li>
              <strong>Silver · 20%</strong>
              <span>The paid semi-final finish in a full field.</span>
            </li>
            <li>
              <strong>Gold · 35%</strong>
              <span>The final winner in a full field.</span>
            </li>
          </ul>
          <p>
            Each app slug lineage is paid once, for its best finish. The same app may earn
            several origin seats without being paid twice; distinct apps by the same hacker
            may both be paid. In a non-empty thin field, award weights are renormalised among
            the payable winners; an empty season pays nobody.
          </p>
          <p>
            Integer rounding and any base shares too small to cover their own ledger fee are
            carried by that ledger's largest payable row; a tie goes to the lower user ID,
            then the lower entry ID. The uneconomic base rows remain visible as skipped.
          </p>
          <p>
            Closing the final starts automatic distribution. Each prize is sent directly to
            the wallet its winner selected; the hackathon does not hold it for later
            withdrawal. Ledger fees come from the transfer, a share too small to cover its
            fee may be skipped, and an unavailable or ambiguous ledger may leave a failed
            payment.
          </p>
          <p>
            Approved payout ledgers must deduplicate identical ICRC-1 transfers for at least
            24 hours. After an outcome-unknown send, every retry keeps the exact same wallet,
            amount, fee, memo, and timestamp. A definite <code>BadFee</code> rejection may
            update the fee and net amount, and a definite <code>TooOld</code> rejection of a
            never-ambiguous row may refresh its timestamp, because either reply proves the
            rejected request did not transfer tokens. Settlement is bounded to 24 rounds;
            anything that still cannot be confirmed or safely retried is recorded as failed,
            never shown as paid, and is not retried forever. Its tokens may remain in the
            sealed canister. A moderator&apos;s Resume action can continue only unsettled work
            inside that bounded process and cannot change or revive a payment.
          </p>
        </GuideSection>

        <GuideSection id="rules-trust" title="Trust, safety, and permanence">
          <p>
            Before start, every external controller is removed and the canister keeps only
            itself as controller. That is what these rules call sealed: no person,
            developer identity, moderator, or DAO can then upgrade its code or frontend,
            change settings, or appoint another moderator. Anyone can verify the certified
            controller list on the{" "}
            <a href={api.canisterDashboardUrl()} target="_blank" rel="noopener noreferrer">
              Internet Computer Dashboard
            </a>
            . If the canister merely falls below its cycles threshold while its state is
            retained, anyone may restore cycles and one moderator may check and re-arm the
            already-installed automation.
          </p>
          <p>
            There is one separate emergency path. Three distinct current moderators may
            approve adding Neutrinite DAO (
            <code>{api.NEUTRINITE_DAO_CONTROLLER}</code>) as a controller beside the
            canister. They cannot choose another principal or supply repair instructions.
            The third approval visibly ends the sealed state and gives the DAO normal
            controller powers, including repair or upgrade, settings changes, and controller
            management. Recovery is not guaranteed to succeed, and lifecycle re-arming
            alone cannot recover lost state or a permanent code failure.
          </p>
          <p>
            Moderation is not a security audit. Submissions may still contain defects or
            harmful code, so downloaders must use appropriate isolation. Anyone may report
            content within the report limits above. A takedown requires two current
            moderators to approve the same displayed reason of at most 500 characters;
            either may withdraw before it completes. A completed takedown permanently
            deletes that app's canister-hosted package, icon, and screenshots from every
            carried bracket copy, and expires waiting revisions targeting that app or those
            files. A deleted file URL stays reserved and cannot be uploaded again. The app
            cannot be restored or resubmitted. Public identities, wallets, votes, decisions,
            results, and retained audit records may remain permanently. Account deletion
            anonymises the profile but cannot rewrite settled competition records.
          </p>
          <p>
            After finish there are no new registrations, uploads, profile or role changes,
            sponsor changes, or entry mutations. After settlement, non-sponsors may use
            privacy-only anonymisation and owners may delete unreferenced files. Moderator
            takedown and report resolution remain, but settled bracket and financial records
            do not change.
          </p>
        </GuideSection>
      </article>

      <section
        className="rules-agreement"
        id="rules-agreement"
        aria-labelledby="agreement-title"
        tabIndex={-1}
      >
        <header>
          <span className="eyebrow">
            Version {terms.version} · effective {termsEffective}
          </span>
          <h2 id="agreement-title">Detailed participation agreement</h2>
          <p className="muted">
            This is the complete role, conduct, rights, risk, and finality agreement accepted
            at registration.
          </p>
        </header>
        <article className="rules-body">
          <Prose markdown={RULES_MARKDOWN} skipTitle headingOffset={1} />
        </article>
      </section>
    </section>
  );
}

function GuideSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="rules-guide-section" tabIndex={-1}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function InstructionLimit({ state }: { state: Loaded<bigint> }) {
  const live =
    state.state === "ready"
      ? state.value === 0n
        ? "No instruction cap is currently configured."
        : `The current configured cap is ${state.value.toLocaleString("en-US")} instructions per account.`
      : state.state === "loading"
        ? "Reading the current configured cap…"
        : "The current configured cap could not be loaded here.";

  return (
    <p>
      Each account also has a cumulative write-instruction allowance configured before
      sealing and shown on its own profile. {live} A cap of zero disables this limit. A call
      that reaches the cap completes, then later writes are refused while reads still work.
      Moderator accounts are measured but exempt, and a moderator may unfreeze and reset an
      account whose client ran away.
    </p>
  );
}

function RulesJump({ target, children }: { target: string; children: React.ReactNode }) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const destination = document.getElementById(target);
    if (!destination) return;
    destination.focus({ preventScroll: true });
    destination.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // App navigation also uses the URL hash. Preventing the default keeps these
  // in-page controls from being mistaken for application routes.
  return (
    <a href={`#${target}`} onClick={follow}>
      {children}
    </a>
  );
}

function Schedule({ state }: { state: Loaded<Season | null> }) {
  const season = state.state === "ready" ? state.value : null;
  const phase = season ? api.phaseOf(season) : null;
  const live = season ? Number(season.week) : 0;

  let intro: React.ReactNode;
  if (state.state === "loading") {
    intro = <p className="muted small">Reading the live schedule…</p>;
  } else if (state.state === "error") {
    intro = (
      <p className="notice error" role="status">
        Live dates could not be loaded. The round lengths below still apply; check the Season
        page or reload to try again.
      </p>
    );
  } else if (!season) {
    intro = (
      <p className="notice" role="status">
        <strong>No season has been created.</strong> Dates appear after a moderator starts the
        sealed canister.
      </p>
    );
  } else if (phase === "draft") {
    intro = (
      <p className="notice" role="status">
        <strong>Season {Number(season.number)} is in setup.</strong> No calendar starts until
        the sealed canister opens week 1.
      </p>
    );
  } else if (phase === "finished") {
    intro = (
      <p className="notice ok" role="status">
        <strong>Season {Number(season.number)} is finished.</strong>{" "}
        {season.startedAt > 0n ? <>Started {dateTime(api.toDate(season.startedAt))}; </> : null}
        {season.endedAt > 0n ? <>finished {dateTime(api.toDate(season.endedAt))}.</> : null}
      </p>
    );
  } else {
    intro = (
      <p className="notice ok" role="status">
        <strong>Season {Number(season.number)} is running.</strong> {api.weekName(live)} is
        open; later dates are projections from its deadline.
      </p>
    );
  }

  return (
    <div className="rules-live">
      {intro}
      <ol className="rules-schedule">
        {api.WEEKS.map((week) => {
          const due = season ? api.deadlineFor(season, week) : null;
          const duration = week <= api.QUALIFIERS ? "7 days" : "1 day";
          const status =
            phase === "finished" || (phase === "running" && week < live)
              ? "Decided"
              : phase === "running" && due
                ? `${week === live ? "Closes" : "Projected"} ${fullDate(due)}`
                : phase === "draft"
                  ? null
                  : "Not scheduled";
          return (
            <li key={week} className={phase === "running" && week === live ? "live" : undefined}>
              <span>
                <strong>{week <= api.QUALIFIERS ? `Qualifier ${week}` : api.weekName(week)}</strong>
                <small>{duration}</small>
              </span>
              {due && phase === "running" && week >= live ? (
                <time dateTime={due.toISOString()}>{status}</time>
              ) : status ? (
                <span className="muted">{status}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="muted small">
        Times use your local timezone. Only the open round has an authoritative stored
        deadline; future dates are projected and may move if a close completes late.
      </p>
    </div>
  );
}

function ApprovedLedgers({
  state,
  season,
}: {
  state: Loaded<string[]>;
  season: Loaded<Season | null>;
}) {
  const liveSeason = season.state === "ready" ? season.value : null;
  const phase = liveSeason ? api.phaseOf(liveSeason) : null;
  const final = phase === "running" || phase === "finished";

  if (state.state === "loading") {
    return <p className="muted small">Reading approved sponsor ledgers…</p>;
  }
  if (state.state === "error") {
    return (
      <p className="notice error" role="status">
        Approved ledgers could not be loaded. Do not treat this as an empty list; check the
        Season page or reload to try again.
      </p>
    );
  }
  if (state.value.length === 0) {
    return (
      <p className="notice" role="status">
        <strong>{final ? "No token ledgers were approved for this season." : "No sponsor ledgers are approved yet."}</strong>{" "}
        {final ? "There is no token prize pool." : "Do not send tokens."}
      </p>
    );
  }

  return (
    <div className="rules-ledgers">
      <h3>{final ? "Approved ledgers for this season" : "Approved sponsor ledgers so far"}</h3>
      <p className="muted small">
        {final
          ? "This set froze when the season started. Balances and contributions are shown on the Season page."
          : "This list may change during setup and freezes when the season starts. These are allowed tokens, not funded balances."}
      </p>
      <ul className="ledger-chosen">
        {state.value.map((ledger) => (
          <li key={ledger}>
            <TokenRow id={ledger} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function fullDate(date: Date): string {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function dateTime(date: Date) {
  return <time dateTime={date.toISOString()}>{fullDate(date)}</time>;
}

function termsDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
