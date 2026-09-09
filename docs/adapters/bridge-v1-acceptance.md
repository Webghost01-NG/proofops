# Bridge v1 acceptance matrix

Implementation gate for [the specification](bridge-v1.md). These are required
test cases and live checks, **not claims that the adapter already passes**.
An unavailable prerequisite is inconclusive; it cannot satisfy a passing row.

| ID | Scenario | Required result | Owner/gate |
|---|---|---|---|
| B01 | Wrong EVM chain, source-chain key, or proof-source bytes | Stop automatic call generation; specific mismatch evidence. | #6 |
| B02 | Invalid/zero address, unsafe log index, unknown adapter version, conflicting generic call | Reject before adapter network work; generic cases still work. | #6 |
| B03 | Missing receipt, source revert, pending attestation, provider timeout | Preserve existing waiting/failure/unavailable meanings; never fabricated proof rejection. | #6 |
| B04 | One matching burn in a successful bound receipt | Decode exact emitter, indexed recipient, raw amount, global index, and local offset. | #6 |
| B05 | Source transaction sender or destination caller differs from burn recipient | Use the event recipient; do not apply the worker's wallet filter as a contract rule. | #6 |
| B06 | No burn topic, malformed first matching log, or unsupported transaction encoding | Report event/type problem; no skipping to a later valid event. | #6 |
| B07 | Multiple matching logs, including an earlier event from another emitter | Display candidates in receipt order; require first-event confirmation; later requested event is not executable by this profile. | #6, #7 |
| B08 | Zero amount, large uint256, topic address with nonzero high padding | Preserve integer precision and Solidity's low-20-byte decoding; do not silently scale, sum, or misclassify proof validity. | #6 |
| B09 | Native calculated transaction index differs from proof or receipt metadata | Reject source/query binding before using replay state. | #6 |
| B10 | Query identity for several chain/height/index values, including nonzero index | Match ASCBase's 72-byte layout exactly; distinguish from 96-byte ABI and 8-byte chain-key alternatives. | #6 |
| B11 | Empty emitter mapping, valid source/proof, matching actual revert | Explain unregistered emitter with configuration and revert evidence. Config-only evidence stays labeled config-only. | #6; live #10 |
| B12 | Nonzero mapping to an unexpected token | Mark intended-outcome mismatch; no advice to overwrite the immutable mapping; receipt success is not enough. | #6 |
| B13 | Expected target has different owner or lacks mint role | Separate registration signer eligibility from minter-role requirements; report observed role/configuration rather than guessing an admin fix. | #6 |
| B14 | Native proof passes but full execute reverts, returns malformed data, or runtime is unavailable | Preserve proof observation and separate application result; only ABI true counts as application simulation success. | #6 |
| B15 | Full execute succeeds in eth_call | Record call and finalized block; do not mark a transaction mined or change on-chain processed state. | #6 |
| B16 | Query already processed; failed application call before successful mint | Replay takes precedence after success; reverted application execution does not consume a query. | #6; live #10/#11 |
| B17 | Contract code is nonempty but does not match pinned linked artifacts; wrong verifier address | Unknown/unsupported identity; no authoritative bridge-completion claim. | #6; actual identity #8 |
| B18 | Configuration changes between observations | Use one recorded block for snapshot/simulation; earlier receipt interpretation never borrows later state as exact historical prestate. | #6 |
| B19 | Successful direct destination receipt with correct minter event and token mint event | Require actual input/source/query binding, emitter addresses, recipient, amount, canonicality, and finality before confirming mint. | #6; live #11 |
| B20 | Receipt succeeds but event comes from another contract, has wrong query/token/recipient/amount, or is missing/ambiguous | No completion label; preserve mismatch/unknown evidence. | #6 |
| B21 | Correct source completed through another permissionless relayer | Record actual caller; validate actual input/outcome without assuming caller equals recipient. | #6 |
| B22 | Batched/internal destination call, proxy, modified mint multiplier, other network | Explicit unsupported profile; generic observations available without bridge-specific completion. | #6 |
| B23 | Source or destination reorg, or nonfinal destination receipt | Invalidate stale linkage or wait for finality; retain previous attempt as historical observation. | #6 |
| B24 | Bridge export/import/rerun and generic v1 compatibility | Context survives v2 round-trip; old readers reject v2; unknown profiles never degrade silently to generic. | #6, #7 |
| B25 | Desktop/mobile and keyboard selection, error display, attempt history, evidence export | User can distinguish proof, simulation, and observed mint; no console/page errors. | #7 |
| B26 | Fresh custom contracts, verified balances, separate signer, working native endpoints | Actual addresses/build identity and funding evidence recorded; absent resources keep the live scenario blocked. | #8 |
| B27 | Real source burn → verified proof → unregistered rejection → registration → actual mint | Sanitized before/after records and transaction references; no mocked native verification or fabricated deployment data. | #9–#11 |
| B28 | Rerun a case after its recorded successful mint | Retain confirmed historical mint and report current replay rejection distinctly; do not call the past mint failed. | #6, #7; regression #12 |
| B29 | Reusable current-state check after a query was consumed | Explicit expectation/event strategy; no assumption that the same bridge query can mint twice, no historical replay claim. | #12 |

## Evidence tiers

- **Pure/unit checks:** isolated, labeled fixtures for decoding, selection,
  argument binding, and diagnostic rules. Never loaded as product activity.
- **Local EVM checks:** actual calls to compiled contracts can validate Solidity
  application behavior. Any test double for the native precompile must be named
  and cannot satisfy B27 or any claimed native integration result.
- **Live checks:** actual source and destination network observations with code,
  block, transaction, and proof provenance. Signers remain outside ProofOps.

## Specification review result (#5)

- Pinned source, worker, package base class/decoder, checked-in ABIs, and upstream
  test cases inspected. Exact sources and hashes are in the upstream manifest.
- Seven upstream bridge unit tests passed (five security/replay, two burn-log).
- Compiled minter and wrapped-token ABI parity checked, including function/event/
  error signatures, return types, mutability, and indexed event fields.
- Package tarball integrity matches the official example's pinned lockfile.
- Required JSON/bundle/interface changes and deployment-identity design constraints
  are listed explicitly in the specification before implementation begins.
- No bridge adapter code, runtime schema, environment, dependency, or contract
  changes are included in this documentation milestone. No live bridge mint claimed.
