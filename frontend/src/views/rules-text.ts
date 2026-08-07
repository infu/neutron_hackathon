/**
 * The Season Rules & Peer Participation Agreement, as markdown.
 *
 * This module and Rules.tsx are the sole participant-facing rules source. The
 * agreement lives here so the exact words accepted at registration ship in the
 * same immutable frontend bundle as the practical guide.
 *
 * Kept as text rather than JSX so it reads as a document when edited, and so
 * somebody reviewing it works with the words rather than with markup.
 */
export const RULES_VERSION = 5;
export const RULES_EFFECTIVE_AT = "2026-08-07T00:00:00.000Z";

function effectiveDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export const RULES_MARKDOWN = `# Season Rules & Peer Participation Agreement

**Version ${RULES_VERSION} — effective ${effectiveDate(RULES_EFFECTIVE_AT)}**

This is a mutual agreement among the peers who participate in this hackathon season (the **Season**). The canister is software, not a party to this agreement. The plain-language Participant Guide on the Rules page forms part of these rules; this detailed agreement adds the role, conduct, rights, risk, and finality terms. Live dates and approved ledgers shown there are read from this canister under the rules below. The installed code determines what the canister can execute, while this agreement governs how participants act.

Merely viewing public Season information does not make someone a participant. By accepting this agreement, you agree to the common rules and to the rules for every role you assume. If you hold more than one role, all applicable role and conflict rules apply.

## 1. How the Season works

The Season is a skill-based game conducted by published software. Its Rules page explains the schedule, roles, submissions, voting and bracket, funding, awards, canister-enforced capacity and record limits, and irreversible actions. Those limits form part of these rules; the canister may refuse an action when its account or shared event cap is reached. Each account also has the live cumulative write-instruction allowance displayed by the canister. External controllers configure it before sealing; it cannot change while the canister remains sealed. Reaching it completes the current call but freezes later writes by a non-moderator until a moderator unfreezes and optionally resets the account; reads remain available. Judges independently choose up to two of the strongest eligible entries in each round. There are no scores, weights, category quotas, or hidden judging rubric; only votes recorded by the canister determine ranking.

The live schedule is calculated from the running Season record. The current deadline is authoritative and later dates are projections until their rounds open. The approved sponsor and ledger set is drawn from reviewed applications and freezes when the Season starts. Participants accept that those live facts are set and applied by the installed code as described in the Participant Guide, rather than by a separately editable document.

Before the Season begins, registration is closed and one atomic readiness check requires three to eight current moderators, at least three approved judges, and at least one approved sponsor naming an approved ledger before sealing the prepared Season. Every pending judge and sponsor application must first be decided. Sealed means that the canister itself is the sole controller: no person, developer identity, moderator, sponsor, judge, or DAO is then a controller, and no external caller can upgrade the code or frontend or change controller-only settings. A moderator may trigger \`start\` only after the canister verifies that exact self-controlled state. Anyone can verify the certified controller list on the Internet Computer Dashboard.

The installed code contains one fixed emergency controller-recovery path. Three distinct current, non-anonymised moderator account owners must independently approve it; agents and repeated presses do not add votes. The third approval adds Neutrinite DAO, principal \`extk7-gaaaa-aaaaq-aacda-cai\`, beside the canister as a controller. A caller cannot choose another principal, code, setting, deadline, vote, ledger, amount, wallet, destination, or payout plan. Adding the DAO visibly ends the sealed state and gives the DAO ordinary controller authority, including the power to repair or upgrade code and frontend, change settings, and manage controllers.

This controller recovery is separate from lifecycle recovery. If a timer vanishes after a cycles interruption, one moderator may invoke the installed no-input lifecycle action. That action reads the stored phase and timing, cannot close a round early or accept a replacement deadline, and cannot accept or change any ledger, amount, wallet, destination, or payout plan.

Protocol developers publish the software and may prepare the Season before it is sealed. Publishing code does not give them authority over a sealed Season. Unless they separately assume a participant role, they do not judge entries, moderate applications, contribute prizes, select winners, or receive authority to act for the participating peers.

No purchase or payment is required to enter as a hacker. Prize contributions do not improve anyone's vote total or chance of winning.

## 2. Rules for everyone

You represent that you have legal capacity to accept this agreement, may lawfully participate where you live, and may lawfully perform your actions and token transfers. You must not use the Season to evade sanctions or other applicable law.

Act honestly and do not manipulate identities, votes, applications, ledgers, payouts, or other protocol operations. Do not upload unlawful or infringing material, sexual exploitation material, private information about another person, malware, credential-stealing code, hidden miners, or code intended to damage or compromise reviewers, users, or the protocol.

Principal identifiers, wallet addresses, roles, entries, decisions, votes, results, transfers, and retained audit records may be public and may remain available permanently. The Participant Guide states the bounded histories that the canister retains; older records outside those bounds may be pruned. Do not submit secrets or personal information that you do not want made public. Deleting or changing a profile may not erase settled Season records, transaction records, or copies already obtained by others.

Blockchain and canister actions may be irreversible. You are responsible for checking your identity, role, submission, approved token ledger, and reward-wallet information before confirming an action. You are responsible for determining, reporting, and paying taxes arising from your participation, contributions, or rewards. Nothing in this agreement removes a reporting, withholding, or other obligation that applicable law independently imposes on a person.

## 3. Role rules

### Observer

An observer may view public Season information. An observer who creates a profile or reports content must follow the common content and conduct rules but has no judging, moderation, funding, or reward authority.

### Hacker

A hacker submits work for evaluation under the voting rules in the Participant Guide. You represent that you created the submission or have all rights and permissions needed to submit it. You retain ownership of your work, but grant the participating peers and software interfaces a worldwide, non-exclusive, royalty-free licence to store, reproduce, display, review, test, download, install, and run the submitted version for the Season and its permanent record. This permission cannot be withdrawn from copies already distributed or from the settled Season record.

You must disclose material third-party components and comply with their licences. You accept the published review, voting, tie, bracket, and payout rules. During an open round, no new revision may be proposed or approved once the final one-hour vote-withdrawal lock begins. The version already visible then remains the version judged through that round's close. A hacker may hold several separately carried bracket seats when different qualifier origins advance. An update names one exact current app and applies only to that app. One uploaded package or image key cannot be shared by separate apps; the same bytes must be uploaded again under a different key, while carried copies of the same app may share their files. The same app slug is paid once for its best finish across those origins, while distinct app slugs may each be paid. You are solely responsible for the reward wallet you provide and for safely receiving and using any reward.

### Judge

A judge independently chooses up to two of the strongest eligible entries in each open round. The choices must be different entries, but may be entries by the same author. You must not vote on your own entry. You must act honestly, disclose material conflicts, recuse yourself where required, and neither offer nor accept a bribe, side payment, favour, or coordinated vote. Votes and deterministic tie-breaking recorded by the canister are final under the published rules.

A judge is an independent peer adjudicator, not an employee, agent, custodian, or representative of the developers or other participants. Judging gives no authority to change the code, control prize assets, or bind another peer. Downloading or running a submission is at the judge's own risk.

### Moderator

A moderator reviews applications, eligibility, revisions, reports, and content under the published standards. You must act in good faith, use only the powers assigned by the code, disclose conflicts, avoid reviewing your own application or content, and provide the recorded reason required for a rejection or restriction. Moderators may restrict content where the rules and code permit, but may not change votes, prize amounts, payout destinations, deadlines, or sealed code. One moderator may check and re-arm lifecycle automation after an interruption, but supplies none of those values: the installed code enforces the stored deadline, funding grace, retry cadence, leases, frozen rows, and terminal state.

Emergency controller recovery is a separate and much broader act. Each moderator may contribute at most one approval, three distinct current moderators are required, and the fixed DAO principal receives controller authority only when the third approval completes. Every moderator approving it acknowledges that it ends the self-only seal and enables the DAO's ordinary repair, upgrade, settings, and controller powers.

Triggering \`start\` after the canister confirms that it is sealed is a limited protocol action and gives the moderator no control over the canister or prize assets. A moderator is an independent peer reviewer, not an employee, agent, custodian, or general representative of the developers or other participants.

### Prize Contributor

A prize contributor, sometimes described as a sponsor peer, voluntarily contributes assets the contributor owns and is permitted to transfer. You must use only a ledger approved and displayed on the Rules page and only the deposit route displayed during the running Season. Production supports no more than seven reviewed ICRC-1 ledgers. Once a contribution is confirmed under the published rules, it is irrevocable and non-refundable, and the installed code alone determines its allocation among eligible reward wallets.

A contribution does not purchase ownership, repayment, advertising, influence, governance, a favourable vote, or control over any participant. Token value may change. Ledger calls or transfers may fail, fees reduce transfers, uneconomic rows may be skipped, and ambiguous or permanently failed transfers may leave assets in the sealed canister.

The launch relies on every approved ledger eventually returning a definite reply to an admitted sponsor collection transfer. Elapsed time alone never clears a transfer whose result is unknown. If a ledger violates that assumption, reconciliation remains visibly blocked rather than collecting the deposit twice or counting uncertain funds as funded or paid.

At final close no new public sweep is admitted. A sweep already admitted must receive its definite ledger reply before the final snapshot can begin, because a transfer already sent cannot be cancelled or safely duplicated. Reconciliation uses a five-minute grace and full passes normally one minute apart. A successful final pass must begin after the grace. Persistent read failures are recorded only after at least 15 full passes and a full pass begun after the grace; if pass 15 began too early, one additional pass is required. At that cutoff an unread ledger is recorded as a funding failure and its unknown balance is not included in the prize pool. The pass threshold is not a wall-clock guarantee while an already-sent transfer is unresolved. Timer and moderator recovery use the same persisted ownership and retry state, so repeated recovery calls cannot accelerate those limits or create a second cutoff owner. At the cutoff the canister freezes the reachable payout rows and explicit ledger failures together; the first send starts one second later. A deposit counts only if it was admitted before the displayed deadline and becomes visible to reconciliation; later transfers are unsupported. Healthy frozen rows continue, but any funding failure makes the Season's aggregate payout result failed. There is no manual payout plan or re-plan.

Integer rounding and any base shares too small to cover their own ledger fee are carried by that ledger's largest payable row; a tie goes to the lower user ID and then the lower entry ID. The uneconomic base rows remain visible as skipped.

Every approved payout ledger is required to deduplicate an identical ICRC-1 transfer for at least 24 hours. After an outcome-unknown send, every retry keeps the exact frozen destination, amount, fee, memo, and timestamp. A definite \`BadFee\` rejection may update the fee and net amount, and a definite \`TooOld\` rejection of a never-ambiguous row may refresh its timestamp, because either reply proves the rejected request did not transfer tokens. Only a ledger success or duplicate response confirms payment. Payout settlement is bounded to 24 rounds; a row that cannot be confirmed or safely retried within that budget is recorded as failed, is not claimed as paid, and is not retried forever. Its tokens may remain in the sealed canister. A moderator Resume action may only send or check unsettled frozen rows during that bounded process; it cannot add a ledger, change a row, take a new pool snapshot, or revive a terminal failure.

## 4. Moderation and safety

Moderation protects participants and public interfaces; it does not permit alteration of a settled economic result. Content may be rejected, hidden, or removed where technically possible for violating these rules or applicable law, while identifiers, decisions, votes, payout records, and other necessary audit information may remain. A takedown requires two current, non-anonymised moderators to approve the same displayed reason; either moderator may withdraw their own approval before completion. A completed takedown is permanent for that app identity: every bracket copy is stripped, its canister-hosted package, icon, and screenshots are deleted, revisions targeting that app or those files expire, each deleted file URL stays reserved and cannot be uploaded again, and the app cannot be restored or resubmitted.

Neither moderation nor acceptance is a security audit. Submissions may contain defects or harmful code. Anyone who downloads, installs, tests, or runs a submission must use appropriate isolation and does so at their own risk.

## 5. Finality, risk, and changes

The software, Season, submissions, and third-party token ledgers are provided without a promise that they will be uninterrupted, error-free, secure, valuable, or fit for a particular purpose. While sealed, no external controller can repair or upgrade the canister. Restoring cycles and invoking lifecycle recovery may resume already-authorised work but cannot repair a permanent code or state failure. Three moderators may instead enable the fixed DAO controller recovery described above; that may permit repair, but it is not a promise that the DAO will act or that repair will succeed, and it ends the sealed state. To the fullest extent permitted by law, each peer accepts the ordinary technical and economic risks of participating. Nothing excludes responsibility for fraud, deliberate misconduct, or liability that cannot lawfully be excluded.

No role creates employment, partnership, fiduciary authority, or a general agency relationship, and no peer may make commitments for another. Protocol results are final for purposes of the Season except where applicable law requires otherwise.

After the Season finishes, the canister accepts no new registration, upload, profile, role, sponsor, or entry mutation. After financial settlement, a non-sponsor may use privacy-only anonymisation and an owner may delete files that no entry references. Settled bracket and financial records, completed takedowns, and retained moderation and audit records remain. Moderators may continue takedown and report resolution where the installed code permits, but cannot rewrite a settled result or payment.

Version ${RULES_VERSION} of the static Participant Guide and this agreement are frozen before public registration opens. The canister records the accepting principal, acceptance time, and backend-owned terms version; the browser does not choose that version. Live schedule and approved-ledger facts are determined and frozen as the Participant Guide explains. Later terms apply only to a future Season on a new canister and require a new version and a new acceptance.
`;
