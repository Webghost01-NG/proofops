# Bridge adapter specification v1

Delivery specification for [issue #5](https://github.com/Webghost01-NG/proofops/issues/5).
The adapter itself is implemented in #6 and exposed in the interfaces in #7.
This document defines proposed application interfaces and data changes; it does
not change the running application, its database, contracts, or configuration.

## Pinned reference and supported boundary

Use `gluwa/attestcoin-protocol-examples` revision
`6668487ad07fdf8119f54aab9db99b6c50155b5c`, with `@gluwa/asc-contracts@0.2.1`
and the existing `@gluwa/usc-sdk@0.18.0`. File hashes, dependency integrity,
ABI selectors/topics, and build settings are recorded in
[the upstream manifest](bridge-v1-upstream.json).

Primary sources at this revision:

- [ASCMinter](https://github.com/gluwa/attestcoin-protocol-examples/blob/6668487ad07fdf8119f54aab9db99b6c50155b5c/bridge/contracts/sol/ASCMinter.sol): action, registration, log selection, and mint rules.
- [Source TestERC20](https://github.com/gluwa/attestcoin-protocol-examples/blob/6668487ad07fdf8119f54aab9db99b6c50155b5c/shared/contracts/sol/TestERC20.sol): source event and sink-transfer behavior.
- [MintableToken](https://github.com/gluwa/attestcoin-protocol-examples/blob/6668487ad07fdf8119f54aab9db99b6c50155b5c/bridge/contracts/sol/MintableToken.sol): token ownership and mint role.
- [Worker](https://github.com/gluwa/attestcoin-protocol-examples/blob/6668487ad07fdf8119f54aab9db99b6c50155b5c/bridge/bridge-offchain-worker/worker.ts) and [shared utilities](https://github.com/gluwa/attestcoin-protocol-examples/blob/6668487ad07fdf8119f54aab9db99b6c50155b5c/shared/utils/index.ts): exact submission call and worker filtering.
- [Security tests](https://github.com/gluwa/attestcoin-protocol-examples/blob/6668487ad07fdf8119f54aab9db99b6c50155b5c/bridge/test/ASCMinterSecurity.t.sol) and [burn-log tests](https://github.com/gluwa/attestcoin-protocol-examples/blob/6668487ad07fdf8119f54aab9db99b6c50155b5c/bridge/test/ASCMinterBurnLog.t.sol).
- [ASC contracts package](https://www.npmjs.com/package/@gluwa/asc-contracts/v/0.2.1): `contracts/readability/ASCBase.sol`, `contracts/common/EvmV1Decoder.sol`, and `contracts/write-ability/common/INativeQueryVerifier.sol`. Its inspected tarball integrity matches the pinned example's lockfile.

The supported first deployment is the unmodified custom-contracts example on
Sepolia (EVM ID 11155111, Attestcoin key 1) and Creditcoin testnet (EVM ID 102031).
The native verifier is `0x0000000000000000000000000000000000000FD2`.
Other networks, custom mint logic, proxies, and batched/internal destination calls
need a separate supported profile. The existing generic inspector remains useful
for them but must not issue this adapter's bridge-completion conclusion.

No tutorial address or sample receipt is automatically a verified deployment.
Phase 3 supplies actual source token, minter, wrapped token, and linked decoder
identities before the funded scenario. The source test token exposes unrestricted
test minting and transfers its "burn" to `address(1)` without reducing total
supply; the demo must not describe this as production asset conservation.

## Facts the implementation must preserve

1. The minter selects the **first log with the burn topic across the entire
   receipt**, preserving receipt order. It does not first filter by emitter.
   There is no log-index argument in `execute`.
2. The recipient is the indexed `from` field of that event. It is not necessarily
   the source transaction sender or destination caller. Raw amounts are copied
   without decimal conversion, fees, or scaling.
3. Registration is `wrappedTokens[emitter]`, keyed only by address. The minter
   does not implement a source-chain allowlist through that mapping. ProofOps
   must independently bind the configured EVM chain, Attestcoin key, and emitter.
4. Registering requires an empty mapping, nonzero addresses, a target token owned
   by the registration caller, and `ASC_MINTER` granted to the minter contract.
   It does not require the minter to own the target token. An existing mapping
   cannot be replaced through this contract's public registration function.
5. `execute` is permissionless and nonpayable. The example worker separately
   filters burns to its wallet and configured emitter, starts polling from its
   startup height, and keeps an in-memory processed-transaction cache. Those are
   worker behaviors, not contract restrictions or proof that a worker ran.
6. Replay protection is transaction-scoped through `processedQueries[queryId]`.
   A later source log cannot be processed with the same transaction query.
   An application revert rolls back the processed flag. A successful `eth_call`
   also leaves no persistent state. Only successful execution consumes it.

## Input contract and deployment identity

The existing source hash, optional destination transaction, and network identity
remain case-level inputs. Add an optional, versioned bridge context:

```ts
interface BridgeInputV1 {
  id: 'attestcoin-bridge-v1';
  sourceEmitter: string;
  minter: string;
  expectedWrappedToken: string;
  caller: string;
  sourceLogIndex?: number;
}
```

Addresses must be valid, nonzero EVM addresses. `sourceLogIndex`, when present,
is the RPC's **block-global log index**, a nonnegative safe integer. Keep the
receipt-local offset separately in evidence. It is an assertion of which event
the developer intends to diagnose, not an override of the minter's selection.
Recipient and raw amount are derived from the selected event, not editable inputs.
No provider URL, file path, private key, arbitrary adapter module, or uploaded
JavaScript is accepted through this context.

Deployment identity is separate from user assertions. Before claiming supported
bridge behavior, match the observed source token, minter, wrapped token, and linked
decoder runtime to artifacts compiled from this pinned source. Use the manifest's
Solidity settings and dependencies; resolve library links and immutable values
from the actual deployment. Record artifact provenance, expected and observed
runtime hashes, linked library addresses/hashes, and observation blocks. Check
source code at the source receipt's block and destination code at each relevant
destination observation block. A caller-provided hash or a nonempty `eth_getCode`
response alone does not establish that the source matches this example.

Until that match exists, report `BRIDGE_IDENTITY_UNVERIFIED` (unknown), show raw
decoded observations, and withhold authoritative correction/completion claims.
Unsupported code must not pass based only on a matching ABI selector. The first
implementation may consume verified build artifacts as local developer data;
the artifact path must not be accepted from the browser. Any new local identity
configuration surface must be reviewed before being implemented in #6/#7.

## Source selection and binding

Use the existing signed-transaction reconstruction, receipt match, canonical block
check, SDK encoding, proof-source match, and native verification. Additional rules:

1. Read the complete receipt; do not discard unrelated emitters before selecting.
2. Filter only by topic zero
   `0x17dc4d6f69d484e59be774c29b47d2fa4c14af2e01df42fc5643ac968f4d427e`
   (`TokensBurnedForBridging(address,uint256)`), retaining receipt order.
3. The first match is the contract-selected event. Require exactly two topics
   and 32 bytes of data. Decode the recipient from the low 20 bytes of topic one,
   matching Solidity's truncation; retain the original topic word. Amount is an
   unsigned decimal string in base units, including zero if the source permits it.
4. Require the first event's emitter to equal `sourceEmitter`. If the first match
   is another emitter or malformed, do not skip it to find a convenient later log.
5. If multiple matching logs exist, display all candidates. Require an explicit
   `sourceLogIndex` equal to the first match before building the bridge call.
   If a later event is requested, return `BRIDGE_LOG_NOT_EXECUTABLE`. Do not sum
   amounts, mint every log, or silently choose another transaction.
6. Persist source chain ID/key, transaction hash, block number/hash, transaction
   index, global log index, receipt-local offset, emitter, raw topics/data,
   decoded recipient, raw amount, and SDK-encoding hash as the event identity.

No matching event is a failed bridge-input expectation, not a failed native proof.
Pending source receipt, provider failure, unsupported encoding, and source reorg
retain their existing separate outcomes.

## Query identity and exact destination call

The inherited `ASCBase` first calls native `calculateTxIndex` on the Merkle proof.
Use that read-only precompile method at a recorded destination block; require its
result to equal both the returned proof's `txIndex` and the source receipt's
transaction index. Do not trust proof-service index metadata independently.

The query ID matches the base contract's 72-byte assembly layout:

```ts
keccak256(solidityPacked(
  ['uint256', 'uint64', 'uint256'],
  [sourceChainKey, sourceBlockNumber, nativeTransactionIndex]
));
```

This uses 32 bytes for chain key, 8 for height, and 32 for index. It is not a
96-byte `abi.encode` hash, and it is not a hash of the source transaction hash,
Merkle root, action, or log index. Scope stored replay observations additionally
by destination chain and minter address; separate minters have separate mappings.

Build the pinned ABI call with selector `0xc6339bf7`:

```text
execute(uint8,uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[])

action               = 0
chainKey             = verified proof.chainKey
blockHeight          = verified proof.headerNumber
encodedTransaction   = verified proof.txBytes
merkleRoot           = verified proof.merkleProof.root
siblings             = verified proof.merkleProof.siblings
lowerEndpointDigest  = verified proof.continuityProof.lowerEndpointDigest
continuityRoots      = verified proof.continuityProof.roots

to    = bridge.minter
from  = bridge.caller
value = 0
```

The raw transaction RLP is not `encodedTransaction`; use the official SDK's
transaction-and-receipt encoding. Decode the encoded call again before simulation
and verify every argument. No proof arguments are editable after binding.
If the case also supplies a generic `call`, require it to match the generated
`to/from/value/data` exactly or reject the conflict. Generic cases remain supported.

Collect a destination snapshot at **one finalized block**: network identity, code
identity, `VERIFIER()`, `wrappedTokens(emitter)`, `processedQueries(queryId)`, and
target `hasRole(ASC_MINTER, minter)`. Require `VERIFIER()` to equal the documented
native address. Check owner/role of the expected target when explaining possible
registration. `ASC_MINTER` is the Keccak hash of that exact string, recorded in
the manifest. Use the same block for the complete `execute` simulation and record
the call, return bytes or revert bytes, decoded error, and all configuration reads.
An unsupported block query remains unavailable; never silently use `latest`.

Successful application simulation requires ABI-decoded `true`, not merely empty
or non-reverting return bytes. Native `verify` success is a separate observation:
the application calls `verifyAndEmit`, checks replay, then runs its own mint logic.

## Diagnostic rules and precedence

Preserve each independent observation. Use the order below when explaining the
contract's first expected rejection; a failed RPC never establishes a rejection.

| Evidence at the recorded block | Result and developer guidance |
|---|---|
| Wrong network or source/proof/index mismatch | Stop automatic call generation; preserve the mismatch evidence. |
| Unsupported/unverified deployment identity | Unknown adapter compatibility; do not claim a bridge outcome. |
| Multiple events without selection, or requested later event | Require first-event confirmation or explain that this minter cannot process the requested event. |
| `processedQueries(queryId) == true` | `BRIDGE_QUERY_PROCESSED`: replay guard runs before proof/application checks. This alone does not prove a mint for the intended event. |
| Native verification or full call cannot complete | Unavailable/unknown as appropriate; never turn a transport failure into proof rejection. |
| Full call rejects proof inclusion | Preserve the proof rejection separately from emitter registration. |
| No valid first burn event | Explain receipt/event/type failure; do not silently select another event. |
| First emitter maps to zero and full call reverts with the expected reason | `BRIDGE_EMITTER_UNREGISTERED`: the configuration read and revert together support the diagnosis. |
| First emitter maps to an unexpected nonzero token | `BRIDGE_WRAPPED_TOKEN_MISMATCH`: the configured intended outcome is wrong even if the call would mint elsewhere. Do not suggest overwriting this mapping. |
| Correct target lacks minter role | `BRIDGE_MINTER_ROLE_MISSING`: show `hasRole` result and exact call revert if available; do not assume an administrator is available. |
| Full call returns true | `BRIDGE_CALL_SUCCEEDED`: simulated at this block; no mint transaction was sent or mined by ProofOps. |
| Canonical mined receipt satisfies the correlation rules below | `BRIDGE_MINT_CONFIRMED`: the recorded source event has the expected observed destination outcome. |

The pinned unregistered-emitter failure is Solidity `Error(string)` with reason
`No wrapped token for emitter`, not a dedicated custom error selector. Other
reasons include `Query already processed`, `Proof of inclusion verification failed`,
`No burn events found`, and malformed-log reasons. Preserve unknown custom errors,
standard errors, panic codes, and raw bytes without guessing their cause. A
matching message from an unverified contract is not enough to prescribe a fix.

A known missing registration can be reported from a configuration read while the
proof service is unavailable, but label it as a configuration observation, not a
proven cause of a call that was never executed. Several findings may coexist.
The existing `ready` status continues to mean proof readiness, never bridge
completion. Completion appears only as an explicit correlated mint observation.

## Correlating an observed destination mint

Only support a direct transaction to the verified minter's `execute` in v1.
Fetch the destination transaction as well as its receipt. Decode the actual input,
check action/chain/height/encoded source bytes, and derive its query identity from
its submitted proof. A regenerated proof may have different continuity material;
do not demand byte-for-byte equality to a newer proof when source identity and
the validated query identity are the same.

Require all of the following before `BRIDGE_MINT_CONFIRMED`:

- Destination receipt status is one, transaction and receipt hashes/blocks match,
  and the block remains canonical. Report whether it is finalized; withhold the
  final completion label while destination finality is pending.
- The actual transaction targets the verified minter and binds to the selected
  source transaction and first event. Report the actual caller; a different
  permissionless relayer is not a recipient mismatch.
- Exactly one relevant `TokensMinted(address,address,uint256,bytes32)` log is
  emitted **by that minter**, with the expected query ID, wrapped token, recipient,
  and amount. All three address/query indexed fields must be decoded correctly.
- The same receipt contains the expected wrapped token's
  `Transfer(address,address,uint256)` from the zero address to that recipient for
  the same amount. Validate log emitter addresses, not only event signatures.
- Contract identities, source binding, and receipt observations remain consistent
  with the pinned profile. Recheck source canonicality before reporting completion.

Missing or ambiguous correlation is unknown/unsupported, even with a successful
receipt. Current balances, a true processed flag, and matching event signatures
alone are insufficient. Read historical identity/configuration at the destination
receipt's block when interpreting that receipt; current finalized configuration
cannot reconstruct an earlier transaction's exact intra-block prestate.

A later rerun may show both `BRIDGE_MINT_CONFIRMED` for a past mined receipt and
`BRIDGE_QUERY_PROCESSED` for a new simulation. Preserve both, explain the different
times, and do not describe replay rejection as the past mint failing.

## Minimal application boundary and required changes

Keep one built-in adapter, not a plugin loader. The existing engine owns network
access and persistence; the adapter receives validated evidence and produces
deterministic selections, calls, and findings. Proposed pure boundaries:

```text
selectBurn(sourceReceipt, bridgeInput) -> selection or diagnostic findings
buildBridgeCall(boundProof, bridgeInput) -> exact CallInput
diagnoseBridge(selection, snapshot, simulation) -> Observation[]
correlateBridgeMint(selection, boundProof, destinationEvidence) -> Observation[]
```

All findings use existing `stage`, `outcome`, `kind`, `code`, and block-stamped
evidence fields. Network reads use named, bounded methods through `NetworkPort`,
with fixed ABI calls against configured source/destination RPCs. The adapter does
not receive arbitrary URL fetch, signer, shell, or filesystem capabilities.

| Surface | Change required for #6/#7 | Compatibility and scope |
|---|---|---|
| `CaseInput` and validation | Optional `bridge: BridgeInputV1`; strict validation of profile and event assertion. | Existing generic cases unchanged. No silent stripping of adapter input. |
| Source/network evidence | Typed receipt logs/index; native index read; contract identity, configuration, and full destination transaction reads; pinned snapshot support. | Existing read-only RPC methods suffice; no transaction-send method. |
| Engine | Invoke adapter after evidence binding; keep independent configuration observations; evaluate exact generated call and mint correlation. | Preserve failure/wait/unavailable distinctions and generic call behavior. |
| Stored case/attempt JSON | Preserve bridge context, profile revision, generated call, identity provenance, event identity, and observations on every attempt. | No SQLite table migration is expected; this is still a logical JSON-schema change requiring explicit validation/compatibility review. |
| Evidence bundles | Introduce `proofops.case.v2` for bridge cases; continue importing/exporting generic v1. | Old readers must reject v2 rather than silently run a generic check. Current v1 readers otherwise drop unknown input fields. |
| Bundle expectations | Phase 2 keeps `proof-valid`/`destination-call-succeeds` with preserved context. | Bridge-specific replay/rejection/completion expectations belong to #12. Version alone must not imply they exist. |
| CLI/UI | Add explicit bridge context, selection confirmation, contextual evidence and accurate status labels. | Do not add a signer or registration button; conflicting generic calldata is rejected. |
| Dependencies/contracts | Use existing ethers/SDK; pin minimal ABI fragments with provenance when implementing. | No new runtime dependency, deployed-contract edit, or CI change is required by this design. |
| Deployment identity setup | Produce/validate build provenance and linked runtime fingerprints for the supported profile. | Resolve the local artifact input design before coding it; no arbitrary browser filesystem access. |

These are the concrete changes to review before dependent implementation. The
existing architecture document remains the description of the shipped foundation.
This specification does not install a schema migration, dependency, contract,
environment variable, workflow, or deployment configuration.

## Concrete failure-to-fix scenario

This is a planned scenario, not a claim that the bridge demonstration has run.
`E`, `M`, `W`, and `R` below name actual emitter, minter, wrapped token, and recipient
to be supplied by phase-3 preflight; they are not placeholder production addresses.

1. Pin and verify fresh custom example contracts. `W` grants `ASC_MINTER` to `M`;
   its owner retains separate signer control. Leave `M.wrappedTokens(E)` unset.
2. `R` calls the source test token's `burn` for a chosen integer amount `B`.
   Save the actual transaction, successful receipt, and first burn event.
3. ProofOps binds the source evidence, observes attestation, and verifies the
   proof. Its destination snapshot shows an empty mapping. The exact `execute`
   simulation rejects with `No wrapped token for emitter`. Save that attempt.
4. The owner of `W`, through the separate official tooling/signer, calls
   `M.wrapOriginToken(E, W)`. Record the real registration transaction and wait
   for the finalized state used by ProofOps to include it. If another mapping is
   already present, stop: this example cannot overwrite it.
5. Rerun the same case and preserve the earlier failure. With an unconsumed query
   and correct code/role/configuration, the full call should return true.
6. Submit that call outside ProofOps. Attach the actual mined destination hash.
   ProofOps matches the query, source event, `TokensMinted`, and zero-address
   `Transfer` for exactly recipient `R` and raw amount `B` before confirming mint.
7. A subsequent current-state simulation reports replay rejection. The earlier
   mint evidence stays visible; a different source transaction is needed to mint
   again. No automatic re-burn or automatic registration occurs.

## Acceptance and validation

[The acceptance matrix](bridge-v1-acceptance.md) maps these requirements to #6,
#7, #8–#11, and #12. No implementation acceptance row is marked passed merely
because it is specified here.

For #5, the pinned upstream bridge compiled with Solidity 0.8.30, and its seven
contract unit tests passed. Compiled minter/wrapped-token ABI parity and package
integrity are recorded in the manifest. The upstream tests use a mock native
verifier and harness entry points; they establish example logic coverage only.
The prior real generic proof result in `docs/validation.md` is separate evidence
and does not establish a completed bridge deployment or mint.
