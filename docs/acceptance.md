# Acceptance criteria

- A fresh install opens a useful dashboard with no fabricated cases or activity.
- Missing source configuration is reported as blocked, with an actionable step.
- Invalid hashes, addresses, ABI, and calldata are rejected before any network call.
- Source transaction pending, source revert, attestation pending, unavailable provider,
  verifier rejection, and destination revert remain distinguishable.
- A generic provider exception is never interpreted as cryptographic proof rejection.
- The proof's chain, block, and encoded source transaction identity are checked.
- Each native verification and destination simulation records an observation block.
- Receipt status and expected business outcome are never conflated.
- Cases and evidence survive restart; interrupted work stays visible.
- JSON export contains no configured provider URL, API key, or raw provider error text.
- Current-state checks report unavailable prerequisites as inconclusive.
- Both CLI and UI use the same core. Desktop and mobile navigation and keyboard
  interaction work, with no browser console errors.
- No live integration claim until a real source receipt and proof verify through
  the native Creditcoin runtime. Record any unavailable infrastructure honestly.
