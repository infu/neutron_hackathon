# Bounded capacity projection

`npm run test:capacity` drives one representative season through the real
PocketIC interface and writes `.build/capacity-report.json`. The test records
its actual wall time, reports whether it met the ten-minute target, fails after
twelve minutes, and has a fifteen-minute Node safety timeout.

The physical sample has 32 hackers, 128 qualifier apps, five moderators, eight
sponsors, seven ledgers and 2,064 live files. Every hacker reaches the real
64-key account ceiling. The run fills the eight-row retained revision history
with maximum Unicode rejection reasons, changes votes, checks the final-hour
lock, crosses every deadline through production recovery, reconciles repeated
and unsolicited sponsor deposits, freezes the independent payout plan, and
completes all 140 real transfers into the submitted wallets. Every stable slab
class is exercised. One maximum-size app is uploaded per qualifier and its
1.9 MB package is read back; exact live/reserved counters cover every body.

The report keeps physical measurements and target projections separate:

- The sample's files, stable counters, heap floors, peak claimed heap, cycles,
  virtual pacing and wall time are measured.
- Target stable memory is exact slot arithmetic, not a physical 1,000-hacker
  run. Four maximum apps plus tiny spare keys use 17,602,073,600 live and
  24,169,676,800 reserved bytes. Keeping those apps while maximizing the other
  32 keys raises the simultaneous envelope to 29,698,624,000 live and
  32,033,996,800 reserved bytes. Without requiring those four app shapes, the
  absolute participant live-payload maximum is 31,627,264,000 bytes.
- Non-shrinking participant slab pools have a 69,258,444,800-byte historical
  high-water envelope. Adding the trusted 1 GiB frontend release allowance
  gives the 70,332,186,624-byte planning policy, 15,567,159,296 bytes (about
  14.50 GiB) below the compiler's 80 GiB stable-memory setting. Controller
  frontend publication is trusted before sealing and is not separately
  constrained by participant admission.
- Heap-resident asset metadata uses a captured capacity-roster calibration:
  256 MiB before asset growth and 320/384/448 MiB at 8k/16k/24k maximum-length
  keys. Published row and text caps then model entries, revisions, 120,180
  changelog items, maximum-Unicode profiles, votes, sponsor state, payouts,
  newest-32 moderation trails, notices, takedown approvals and runtime work.
  Central and upper values are planning estimates, not measurements or proofs.
  GC-dependent sample floors remain diagnostics and are never scaled.

Two GiB is only the preferred planning line; it is not a production clamp and
does not fail the run. The upper model must remain below a three-GiB guard,
leaving at least one GiB beneath the actual four-GiB wasm32 ceiling.

Every bounded ingress batch advances one virtual second and executes one extra
PocketIC tick. The only fixture-only ledger action is `credit`, standing in for
ordinary third-party ICRC-1 transfers. Production ledgers are independent
canisters; the hackathon actor uses only production methods and is sealed before
the season starts.
