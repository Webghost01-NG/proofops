# Validation record

Observed on 2026-09-08. This records an actual read-only testnet inspection, not a
fabricated fixture or a transaction created by ProofOps.

## Live source-to-proof verification

- Source: Sepolia, EVM chain ID 11155111, Attestcoin key 1.
- Transaction: `0xd075f995989aa96b712d93baa230ba2f35baec8c492b204337b505996131fd42`.
- Source block: 11663782, hash `0x7adf83c28d2178bc81b5489e6c7f1d3f4833bd675ed6e3eefc3b3b15b9a9ff90`.
- Signed transaction reconstruction and successful receipt: passed.
- Attestation coverage and SDK transaction/receipt encoding match: passed.
- Creditcoin testnet native verifier accepted the proof through `eth_call` at
  finalized block 5454336, hash `0xcac0ae5443b0ae9e8a521d24266343230ed350e0d92d7a5a5450a6356cd7f47e`.
- Exported at 22:11:30 UTC. [Full evidence bundle](evidence/live-proof.json).
- The CLI subsequently imported the bundle and returned `pass` for `proof-valid`
  at Creditcoin block 5454339. It collected fresh evidence; it did not replay a
  historical destination transaction.

The source RPC was `https://ethereum-sepolia-rpc.publicnode.com`, provided by
[PublicNode](https://ethereum.publicnode.com/). Creditcoin and proof-service URLs
were the official example defaults. No API key, wallet signature, or broadcast
was required. These are endpoint observations, not a promise of future availability.
The exported JSON contains public transaction, receipt, proof, and block evidence;
it excludes local provider configuration.

This existing public transaction was selected to exercise the infrastructure.
No bridge burn/mint or loan outcome was claimed. Destination simulation and an
observed application transaction still require the developer's exact call inputs
and transaction reference.

## Automated and browser checks

- TypeScript checks and production build pass.
- 21 core/API/local EVM tests pass in this workspace. The optional Anvil test
  reconstructs real local legacy and EIP-1559 transactions through the official
  SDK, rejects altered signed fields, and observes an actual EVM call revert.
  It does not emulate Creditcoin's native proof verifier.
- Two Playwright flows pass at desktop 1440×1080 and mobile 390×844: keyboard
  navigation, missing-configuration reporting, saved cases, reruns, attempt
  selection, export, search, reload persistence, and no console/page errors.
- Desktop overview and mobile inspector screenshots were visually inspected;
  neither has page-level horizontal overflow.

## Remaining work and limits

- Run the funded bridge demonstration with the completed CLI/dashboard adapter: emitter rejection, corrected
  configuration, successful simulation, and actual mint.
- The bridge profile provides application-specific assertions. Arbitrary
  destination receipts still do not prove an expected business outcome.
- Current-state checks depend on available RPCs, proof service, and native runtime.
  Historical replay is not implemented.
- SQLite uses Node's experimental built-in API. The local interface lists the
  200 most recently updated cases; larger workspaces need pagination.
- This is a local developer preview, not an audited hosted multi-user service.

## Bridge backend validation (#6)

On 2026-09-09, the complete suite passed 38 tests with no skips. It includes the
original foundation checks, bridge rule vectors, a pinned-block RPC fixture, and
actual deployments/burn/registration on disposable Anvil. The Anvil bridge test
does not install a mock native verifier and explicitly rejects an unavailable
native index read. Positive mint-correlation unit fixtures are synthetic and
isolated; this is not a live bridge mint result.

Type checks, the production build, and both desktop/mobile Playwright flows also
passed. Browser checks cover the existing interface; bridge-specific controls
and their acceptance checks remain in #7. The pinned Solidity reference rebuild
completed successfully and its deployed executable code matched the local EVM.

The existing real Sepolia evidence bundle was rerun with the updated core:
`check` returned `pass` for `proof-valid`. The native verifier accepted it at
2026-09-09 06:13:57 UTC, finalized Creditcoin block 5456259, hash
`0xa498271be8140ff06d21b53ed9df0f1ce1a53d2f92bd046f71810fb33a3d4286`.
[Fresh exported evidence](evidence/bridge-adapter-core-recheck.json) preserves
that read-only observation. It verifies the generic proof path after the RPC
refactor; it does not establish a source bridge burn or destination mint.

## Bridge interfaces and phase-2 exit (#7)

On 2026-09-09, 41 automated tests passed with no skips, including separate-process
CLI validation, context persistence, rerun/export/check, historical attempt
selection, and inconclusive exit for unresolved burn selection. Type checks and
the production build passed. Six desktop/mobile browser flows passed: existing
workspace behavior plus bridge form validation, accessible event confirmation,
v2 export, reload/history, and separate proof/simulation/mint presentation.

Screenshots were visually reviewed at both widths. Presentation fixtures remain
under `test/`; no synthetic mint is included as product activity. The
[row-by-row phase-2 review](adapters/bridge-v1-acceptance.md#phase-2-interface-gate-7)
records all original criteria and links the still-unfulfilled phase-3/live and
phase-4/regression gates. Actual bridge deployment and funding preflight (#8)
is next. The live native-proof evidence recorded under #6 remains separate.
