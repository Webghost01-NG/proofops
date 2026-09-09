# Inspect a bridge workflow

Choose **Attestcoin bridge** in the dashboard's inspection form. Enter the source
transaction hash, source token emitter, destination minter, expected wrapped token,
and simulation caller. These must be your actual deployments of the pinned
[official example profile](adapters/bridge-v1.md) on Sepolia and Creditcoin testnet.
ProofOps derives the recipient, raw amount, and exact execution call from verified
source evidence. It never asks for a signing key.

Leave the global log index empty on the first inspection. If multiple burn events
match, the inspector lists them in receipt order. **Use first burn in new
inspection** fills the first event's block-global index; review and submit the
form to create a new case. Later matching events are not executable through this
minter. An earlier burn from the wrong emitter is a mismatch, not permission to
skip to another event.

The inspector separates **Source proof**, **Current application call**, and
**Observed mint**. A successful simulation sends no transaction. A confirmed mint
requires a finalized destination receipt with source/query/token/recipient/amount
linkage. A later replay rejection can appear alongside that historical mint.
Every timeline finding keeps its stage, evidence kind, raw evidence, and recorded
block references. Target owner and mint-role observations do not imply that the
simulation caller is authorized to administer the token.

**Rerun checks** appends an attempt using exactly the saved inputs. Use the attempt
selector to read earlier evidence. **Use inputs in new inspection** copies context
so you can correct an address or add the actual submitted destination transaction
hash under **Destination evidence**. Changed inputs create a new case; the original
case and all its attempts remain available in Cases. Export includes all attempts.

## CLI

Create `bridge.json` with the following shape, replacing the descriptive markers
with actual nonzero deployment/caller addresses (this is a template, not live data):

```json
{
  "id": "attestcoin-bridge-v1",
  "sourceEmitter": "<source token address>",
  "minter": "<destination minter address>",
  "expectedWrappedToken": "<wrapped token address>",
  "caller": "<simulation caller address>"
}
```

```sh
node dist/cli.js inspect --source-tx <hash> --bridge ./bridge.json
node dist/cli.js inspect --source-tx <same-hash> --bridge ./bridge.json --source-log-index <first-global-index>
node dist/cli.js inspect --source-tx <hash> --bridge ./bridge.json --destination-tx <actual-mint-transaction>
node dist/cli.js rerun <case-id>
node dist/cli.js show <case-id> --attempt 1
node dist/cli.js export <case-id> --out ./bridge-case.json
node dist/cli.js check ./bridge-case.json
```

The optional `sourceLogIndex` can also be stored in the bridge JSON file. The
explicit CLI flag overrides it after validation. Bridge input options belong to
`inspect`; `rerun` rejects input changes rather than ignoring them. A simultaneously
supplied `--call` must match the adapter's exact proof-bound destination call.

Text output includes bridge context, candidate indices, selected recipient/amount,
configuration facts, and observation blocks. `--json` returns the complete record;
`show --attempt N --json` returns `{ record, selectedAttempt }`. Attempt numbering
starts at 1. Export/check preserve bridge context as `proofops.case.v2`; generic
cases retain v1.

Bridge inspect/rerun/show exits follow the current `destination-call-succeeds`
expectation: 0 passed, 1 failed, 2 inconclusive; invalid input returns 64. A verified
proof with unresolved event ambiguity does not exit 0. A historical mint followed
by current replay rejection exits 1 for the current call and still reports the
historical mint. Richer regression expectations remain issue #12.

## Evidence and limits

Phase-2 checks cover the interfaces and adapter behavior. Positive mint/replay
presentation screenshots use explicitly synthetic, isolated test fixtures. They
are not evidence of a live bridge mint. Actual deployment/funding, rejection, and
mint verification remain the phase-3 gates (#8–#11).

The source test token in the pinned example exposes public test minting and sends
its burn to an address without reducing total supply. This is a developer test
profile, not a production custody or asset-conservation guarantee. Different
contracts, proxies, compiler output, and networks need a verified adapter profile.
