# Phase-3 bridge preflight — 2026-09-09

**The deployment preflight passes.** All three successful receipts are canonical
and included in finalized blocks. Their runtime identities, wallet/token balances,
verifier, ownership, mint role, and initial empty emitter mapping are verified.
[Finalized read-only report](finalized-deployment-check.json) and
[separate signer/funding review](readiness-review.json) complete #8's checks.

The standalone checker deliberately retains exit 2 because it cannot certify
external signing or fee review. The separate review resolves those two remaining
items using the user-approved deployment receipts and actual gas estimates.
The source finalized block is 11666718; Creditcoin finalized block is 5456789.
No burn, registration or bridge execution has been performed.

## Actual deployments

The separate MetaMask account is `0x6CeD8D6Bad8Dfd2e60BCEA116fE74548f959f1F2`.
The user approved the three creation transactions in MetaMask. No wallet key,
seed phrase, password, or keystore unlock was provided to ProofOps.

| Role | Chain | Deployed address | Evidence |
|---|---|---|---|
| Source TestERC20 | Sepolia 11155111 | `0x809d323140d05024fC06E8C38F8bfAD3Bd423203` | [Receipt and runtime](source-deployment.json) |
| ASCMinter | Creditcoin 102031 | `0x8cd2DA9E45D18c47A803f065a3625AE68bF37B17` | [Receipt and runtime](minter-deployment.json) |
| BridgeTestToken | Creditcoin 102031 | `0x0908E0409d593409D251306302FDca0C45198B9C` | [Receipt and runtime](wrapped-deployment.json) |

[Public bridge context](project-bridge.json) can be supplied to the CLI or copied
into the dashboard. It contains actual contract addresses and the intended
simulation caller. These are test contracts from official revision
`6668487ad07fdf8119f54aab9db99b6c50155b5c`, compiled with solc 0.8.30, optimizer
200 runs, via-IR and Shanghai. The decoder is inlined; no extra library was deployed.

## Verified configuration and resources

At finalized Creditcoin block 5456767, the native verifier is
`0x0000000000000000000000000000000000000FD2`, the source emitter mapping is zero,
the wrapped-token owner is the selected wallet, and the deployed minter holds
`ASC_MINTER`. [Configuration reads](bridge-configuration.json). Registration is
intentionally unset for the phase-3 rejection demonstration.

The wallet was funded with 10,000 testnet CTC before its Creditcoin deployments.
The finalized balance after both deployments was 9999.9988952485 CTC. The source
wallet has 0.099994571157877694 Sepolia ETH after deployment and 1,000,000 TEST
at finalized block 11666718. Both balances cover the planned 1 TEST burn and its
reviewed gas ceiling.

Actual creation estimates were 591856 gas for the source, 1449076 for the minter,
and 857034 for the wrapped token. Reviewed limits added 20% gas headroom and used
twice the observed gas price as a fee ceiling. [Initial deployment estimates](browser-deployment-estimates.json),
[minter estimate](minter-deployment-estimate.json), [wrapped estimate](wrapped-deployment-estimate.json).

Read-only estimates for the planned 1 TEST burn and later emitter registration
were 52993 and 150682 gas. With the same headroom policy, their fee ceilings were
0.000138665768473904 ETH and 0.000180819 CTC. [Scenario estimates](scenario-gas-estimates.json).
The actual execute transaction must be estimated once its source proof exists;
these observations are not a promise of future fees or proof availability.

[Post-deployment doctor](post-deployment-services.json) reports ready source and
destination RPCs, attested source height 11666710, and proof-service height
11666710. The existing generic native proof also passed earlier at finalized
Creditcoin block 5456391: [native-proof evidence](../evidence/phase3-native-proof-check.json).
This is not evidence of a bridge burn or mint; those remain #9–#11.

## Tooling and reproducibility

[Setup runbook](setup.md) documents pinned builds, deployment order, MetaMask
signing, gas checks, and direct receipt verification. MetaMask's network selection
is per site; a local network-switch helper resolved an OP Mainnet connection
before deployment. No transaction was submitted on the wrong network.

Forge submitted the minter successfully, but its Alloy block watcher could not
parse Creditcoin blocks that omit `mixHash`. Direct RPC reads verified the
successful receipt, creation input and runtime without fabricating a block field.
The wrapped token used `cast send --async --browser --create` with the exact
compiled bytecode and ABI-encoded minter address; its receipt was then verified
directly. Its deployment is finalized.

`scripts/check-bridge-deployment.mjs` is read-only and deliberately exits 2 even
when all contract checks pass: the external signing and fee review must be
recorded separately. Application code, database schema, dependencies and runtime
configuration remain unchanged. Node syntax and evidence/diff checks pass; the
unchanged application test suite was not repeated.

No source burn, emitter registration, bridge execute or bridge mint has been sent.
Only the three user-approved contract creations were submitted.

## Earlier candidate research

The public tutorial defaults did not match the pinned runtime profile:
[tutorial candidate evidence](tutorial-deployments.json). A search of 44 other
public repositories and 113 selected default-branch files found no documented
Creditcoin deployment in that scope. Three Veylott contracts had Sepolia code but
incompatible runtimes and no code at those addresses on Creditcoin:
[repository search scope and evidence](repository-deployments.json). These candidates
were not adopted. Fresh deployments above resolved that resource gap.
