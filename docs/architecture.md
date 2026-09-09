# Architecture

The user approved a TypeScript/Node core, SQLite persistence, React/Vite local UI,
and official Attestcoin integration. This project is separate from the personal
finance tracker in the parent directory. Work uses focused feature branches.

## Boundaries

- `src/config.ts`: validate network configuration without returning secrets to the UI.
- `src/network.ts`: bounded RPC requests and official SDK access.
- `src/rpc.ts`: shared bounded transport with a fixed read-only RPC allowlist.
- `src/bridge/`: pinned runtime identity, burn selection, configuration snapshots,
  exact execute simulation, and destination mint correlation. See the
  [bridge implementation notes](adapters/bridge-v1-build.md).
- `src/engine.ts`: evidence collection and deterministic diagnostic rules.
- `src/store.ts`: append attempts and preserve evidence in SQLite.
- `src/server.ts`: loopback-only API and built dashboard assets.
- `src/cli.ts`: same engine and store, usable without the dashboard.
- `web/`: accessible case list, inspector, evidence view and readiness checks.

The application reads chain state, calls the proof service, and uses `eth_call`.
It never signs or broadcasts. The destination application still validates proofs
and business rules. RPC observations and imported JSON are not cryptographic
attestations by themselves. A successful verifier simulation must be labeled with
its observation block and distinguished from a mined destination transaction.

## Case lifecycle

A case has a source hash and optional destination call/transaction references or
versioned bridge context. Bridge context is available through the local API and
v2 bundles; dedicated CLI/dashboard controls are tracked in issue #7.
Every run creates an append-only attempt with ordered observations. Attempts end
as `ready`, `waiting`, `blocked`, `failed`, or `incomplete`. A running attempt found
after a restart is displayed as interrupted; an explicit rerun creates a new attempt.
Successful verification alone never implies completed application execution.

Evidence captures chain identity, transaction hash, block number and hash, receipt,
attested height, proof bytes, native verification outcome, simulation inputs, raw
revert bytes, decoded ABI error where available, and actual destination receipt.
Different observations can occur at different blocks; all applicable references
must be explicit. Revalidate source canonicality before labeling a proof verified.

## Regression checks

Generic v1 and bridge v2 bundles support an explicit `proof-valid` or `destination-call-succeeds`
expectation and reruns against current state with locally configured endpoints.
It cannot reconstruct a transaction's exact historical intra-block prestate.
Unknown prerequisites and unavailable providers return inconclusive. No runtime
precompile is replaced with an EVM mock in a claimed integration test.

## Local service

Bind only to 127.0.0.1. Validate Host and Origin, reject cross-origin mutation,
limit JSON bodies, require JSON for POST, and return sanitized errors. The browser
does not supply arbitrary RPC URLs or server filesystem paths. Local configuration
defines providers. Only locally configured ABIs and explicit request calldata are
interpreted, never executed as code. Database files are private to the user.

## First live scenario

Use the official bridge example: a source burn succeeds, proof verifies, and an
unregistered source emitter causes destination application rejection. Show the
error with evidence, correct configuration through the developer's separate signer,
and demonstrate a successful call and actual mint receipt. This is pending funded
testnet access, not seeded into the product. A loan adapter is the next portability
check, after the bridge path is demonstrated.
