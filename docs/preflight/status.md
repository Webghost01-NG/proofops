# Phase-3 preflight status — 2026-09-09

**Issue #8 remains open and externally blocked.** Its prerequisite #7 is complete,
and a public project wallet is now supplied. The wallet is funded and the user
selected MetaMask browser signing. Compatible deployments and a successful wallet
connection remain unverified. Issue #9 must remain blocked by #8.

## Verified now

- `cast` and `forge` 1.6.0-nightly are installed. Local keystore entries exist;
  no entry has been selected, unlocked, or used for ProofOps. Existence is not
  signer-control confirmation. No secrets or unrelated keystore data were read.
- The project `.env` supplies only `SOURCE_CHAIN_RPC_URL`; it contains no project
  deployment context or signer selection. No application environment was changed.
- Source RPC responded on Sepolia chain 11155111; destination RPC responded on
  Creditcoin testnet 102031. Doctor observed source attestation height 11666240
  at Creditcoin block 5456377; the proof service reported the same source height.
  [Service status record](service-checks.json).
- The existing real generic proof check returned `pass`. Native verification was
  accepted at finalized Creditcoin block 5456391, hash
  `0xd6a1845e5c7375d6dd2b4c9917915ac565c14d04f071ffca9b28253cbb8d432f`.
  [Fresh full evidence](../evidence/phase3-native-proof-check.json).
  This is not a source bridge burn or destination mint.

## Public tutorial deployment screening

Addresses came from `bridge/.env.example` at the pinned official revision
`6668487ad07fdf8119f54aab9db99b6c50155b5c`. They were checked as public candidates,
not adopted as project deployments or wallets. All three have executable code
that differs from the current pinned runtime templates:

| Role | Public tutorial address | Observed block | Pinned runtime match |
|---|---|---|---|
| Source token | `0x0F24FD9e0524BA53d3f0A4A40350Adf5370b4A53` | Sepolia 11666221 | No |
| Minter | `0x2Be9B8640ED32815d3B9e8C92AbcD3F15F07396f` | Creditcoin 5456391 | No |
| Wrapped token | `0x914Cf96BF28b7b4921db27b264ecEd71aC91134E` | Creditcoin 5456391 | No |

[Full hashes and block evidence](tutorial-deployments.json) preserve those reads.
Mismatch does not establish unsafe or broken contracts; it means their executable
behavior has not been verified as this supported profile. No mapping/owner/mint
conclusion was inferred from them. The profile was not weakened to accept samples.
Fresh custom deployments are the straightforward route for the intended empty
mapping → rejection → registration → mint demonstration.

## Project GitHub deployment search

At the user's request, inspected 44 other nonempty public repositories and read
113 selected README, deployment, broadcast and network configuration files from
their current default branches. No Creditcoin/Attestcoin/102031/ASCMinter keyword
matches appeared in those files. This is not an exhaustive search of every file,
branch or historical deployment.

Three actual candidates from [Veylott's deployment table](https://github.com/Webghost01-NG/veylott/blob/main/README.md)
were checked on both chains:

| Contract | Address | Sepolia code bytes | Creditcoin code bytes |
|---|---|---|---|
| USDCMock | `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF` | 2321 | 0 |
| ConfidentialPool | `0x90F72615Be5f05A2ce9DCA540D756a4415CE0AD1` | 15002 | 0 |
| cUSDCMock | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` | 170 | 0 |

All three differ from the supported source/minter/wrapped runtimes. Reads used
finalized Sepolia block 11666285 and Creditcoin block 5456451; both block hashes
were rechecked. These are existing contracts, but they do not provide the required
bridge behavior. [RelayPay's deployment table](https://github.com/Webghost01-NG/relaypay/blob/main/README.md)
also lists its invoice registry and receipt NFT on Coston2, a different chain.

[Repository scope, file URLs and actual on-chain evidence](repository-deployments.json)
record this search. No candidate was adopted or transaction submitted. The next
step is deploying the three pinned contracts using the selected MetaMask browser
signer; their resulting addresses must
pass the runtime and configuration checks before #8 can close.

## Concrete outstanding resources

1. **Externally confirmed signer control.** The selected public wallet is
   `0x6CeD8D6Bad8Dfd2e60BCEA116fE74548f959f1F2`. The key/password stays in the
   separate signer. The user selected MetaMask; browser connection and actual
   transaction approval remain outstanding.
2. **Actual compatible deployments.** Supply your source/minter/wrapped addresses,
   or use the prepared setup commands with the selected funded signer. Deployment
   receipts and runtime checks must agree before these count as verified.
3. **Funding and test-token balances.** The selected wallet has
   0.100587121015810964 Sepolia ETH at block 11666612 and 10,000 testnet CTC at
   Creditcoin block 5456652 (latest-block observations). The earlier zero balance
   in the historical balance evidence has been superseded. Source test-token
   balances await actual deployments. The proposed burn is 1 TEST (10^18 raw
   units); it has not been sent. [Current balances and estimates](browser-deployment-estimates.json).
4. **Initial bridge state.** Verify an empty emitter mapping, target ownership,
   and minter role. Registration must stay unset until the rejection demonstration.
5. **Transaction cost evidence.** Estimate deployment/burn/registration gas and
   compare fee ceilings/headroom against actual balances. Re-estimate the actual
   execute call once its proof exists in phase 3. No funding sufficiency claimed.

## Prepared and checked

[Setup runbook](setup.md) provides reproducible pinned builds, separate-keystore
commands, gas/balance checks, and the required deployment order. It explicitly
omits immediate registration and the auto-submitting worker. Contract names,
constructor ABI, and Foundry create/estimate/account flags were checked against
the local pinned sources and installed CLI help. The existing minter artifact
was resolved successfully with `forge inspect --root bridge`.

`scripts/check-bridge-deployment.mjs` is a standalone read-only report command.
It passed Node syntax validation and completed actual public RPC screening with
exit 2, correctly reporting unsupported runtime identity and missing resources.
Its wallet/configuration branches remain to be exercised on the selected project
deployment. It never reports complete signer/funding readiness automatically.
The built core's existing native-proof check also passed; application code, UI,
dependencies, database schema, and runtime configuration are unchanged in #8.

The preparation above preceded deployment. See the deployment progress below
for the first approved transaction. No burn, registration or mint has been sent.

## MetaMask deployment preparation

The user selected browser signing on 2026-09-09. Installed `forge create --help`
confirms `--browser`, `--browser-disable-open` and `--browser-port`. The official
[Foundry browser-signing guide](https://www.getfoundry.sh/guides/browser-wallet)
describes a loopback-only connection page and individual wallet approvals.

Actual RPC estimates from the funded wallet: source creation 591856 gas; minter
creation 1449076 gas. Proposed limits add 20% gas headroom and cap gas price at
twice the observed price. Corresponding fee ceilings are 0.001558097001739696
Sepolia ETH and 0.001738892 CTC. Balances cover these two estimates. Wrapped-token
creation and later burn/registration/execute estimates are still outstanding.
No deployment success or full phase-3 funding sufficiency is claimed.

## Deployment progress

The user approved the source-token deployment through MetaMask on Sepolia.
Transaction `0x03c2c0ce68ff07027c2526863a55baacca761cb3bbd31a63d43233b6c2f6f6be`
succeeded in block 11666696, creating
`0x809d323140d05024fC06E8C38F8bfAD3Bd423203`. Gas used: 586038. Runtime identity
checked at the receipt block matches the pinned source profile.
[Receipt and runtime evidence](source-deployment.json). A finalized-block check
is still outstanding. Creditcoin minter and wrapped-token deployments remain
outstanding; #8 is still open and #9 is blocked.

The Creditcoin minter deployment also succeeded in block 5456737. Transaction:
`0x127c5e19656c35b738963605b5f5b8b2356322da23df5f938d346a2accccc3b7`.
Contract: `0x8cd2DA9E45D18c47A803f065a3625AE68bF37B17`. Direct RPC reads verified
the successful receipt, exact creation input and matching minter runtime.
[Receipt and identity evidence](minter-deployment.json). Forge's Alloy block
watcher could not parse Creditcoin blocks missing `mixHash`; direct RPC reads
confirmed the actual result without inventing a block field. The wrapped-token
deployment and final configuration/finality checks remain outstanding.
