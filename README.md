# ProofOps

Local, read-only diagnostics for Attestcoin workflows. Inspect a Sepolia transaction,
check attestation readiness, request and verify its proof, and simulate a destination
call with evidence attached to each finding. Cases survive a process restart.

This is the first implementation milestone, not a deployed or audited product.
No sample transactions are presented as live activity. Inspection never signs or
broadcasts transactions, changes contract configuration, or uses a private key.

## Run

Requires Node.js 22.16 or newer (uses the built-in experimental SQLite API).

```sh
npm ci
npm run build
npm start
```

Open the loopback URL printed by the CLI. The dashboard starts without credentials.
To connect a source RPC, copy `.env.example` to `.env` and configure
`SOURCE_CHAIN_RPC_URL`. Values are loaded from the current project directory.

```sh
node dist/cli.js doctor
node dist/cli.js inspect --source-tx <transaction-hash>
node dist/cli.js list
node dist/cli.js show <case-id>
node dist/cli.js export <case-id> --out ./case.json
node dist/cli.js check <case-bundle.json>
```

`inspect` also accepts `--call ./call.json`. The optional file contains `to`, `from`,
`data`, optional decimal-string `value`, and optional JSON-array `abi`. These are
the exact intended destination call inputs, including proof arguments if needed.
ProofOps does not guess calldata or automatically correlate arbitrary destination
calls with source transactions. Provide `--destination-tx <hash>` to attach an
observed destination receipt separately from current-state simulation.

`doctor` reports actual endpoint checks. A responding proof-service HTTP root alone
does not demonstrate successful proof generation. Source attestation pending is a
waiting state, not a failed proof. Each inspection is a bounded attempt; rerunning
a case appends an attempt without overwriting earlier evidence.

## Data and exports

Cases live in `.proofops/cases.sqlite` by default. Set `PROOFOPS_DATA_DIR` to change
the location. RPC URLs and provider error messages are sanitized before storage.
Exports contain public chain data and explicitly supplied call data; review them
before sharing because calldata can still contain business information.

An exported bundle includes a suggested verification command. `check` runs a new
read-only inspection and evaluates its recorded expectation against current state.
It is **not** an exact historical replay. Unavailable prerequisites are inconclusive,
not passing. Custom runtime precompiles are not emulated by an ordinary Anvil fork.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

Tests use explicitly synthetic fixtures isolated under `test/`. The running product
uses real RPCs and the official SDK, with no mock integration or seeded demo results.
Browser tests need the Playwright Chromium browser installed.
The browser configuration also supports the system Chrome installation on this
workspace. The local EVM integration test runs when `anvil` is available and is
explicitly skipped otherwise; it never substitutes for native Creditcoin testing.

A real Sepolia transaction has passed source binding and native verification on
Creditcoin testnet. See [the validation record](docs/validation.md) and its exported
evidence. Destination application execution remains a separate milestone.

## Scope

Included: CLI, local dashboard, SQLite persistence, network checks, source evidence,
attestation queries, proof requests and native verification, optional destination
simulation/receipt, bounded diagnostic rules, JSON evidence bundles and current-state checks.

Remaining milestones: funded live bridge/loan demonstrations, semantic application
adapters, automatic application-specific regression generation, worker instrumentation,
and historical replay only where the runtime and provider capabilities permit it.

See [architecture](docs/architecture.md) and [acceptance criteria](docs/acceptance.md).
The next implementation milestone follows the pinned
[bridge adapter specification](docs/adapters/bridge-v1.md) and its
[acceptance matrix](docs/adapters/bridge-v1-acceptance.md).

## Upstream references

- https://github.com/gluwa/attestcoin-protocol-examples
- https://github.com/gluwa/cc-next-query-builder
- https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure

No upstream affiliation or exclusive novelty is claimed.
