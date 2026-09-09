# Live bridge setup and preflight (#8)

This runbook prepares the separate developer signer and actual deployments needed
for the failure-to-recovery demo. It does not run automatically in ProofOps.
The current [preflight record](status.md) remains incomplete. Do not start #9
until #8's wallet, contracts, balances, and initial state are verified.

## 1. Select the public project wallet

Use a developer-controlled test wallet outside ProofOps. Only its public address
belongs in the issue or deployment context. Foundry can use an existing encrypted
keystore through `--account`; wallet passwords are entered locally at its prompt.
A keystore filename alone does not establish that it can be unlocked or that the
account is authorized for this project. Do not put a wallet key in ProofOps `.env`.

In your own signer terminal, select the account and obtain its public address:

```sh
export PROOFOPS_DEMO_ACCOUNT='<your selected Foundry account alias>'
cast wallet address --account "$PROOFOPS_DEMO_ACCOUNT"
export PROOFOPS_DEMO_ADDRESS='<public address returned by your signer>'
export PROOFOPS_SOURCE_RPC='<your Sepolia RPC URL>'
export PROOFOPS_CREDITCOIN_RPC='https://rpc.cc3-testnet.creditcoin.network'
```

The selected signer must be able to deploy the wrapped token and later register
its emitter as that token's owner. For the simplest scenario, use the same account
on both chains; the execution caller can technically be any relayer.

Funding sources linked by the pinned official example:

- [Google's Sepolia faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
  requires sign-in in its current web interface. Request test ETH for the public address.
- [Creditcoin's Discord faucet channel](https://discord.com/channels/762302877518528522/1463257679827828962)
  accepts a public address according to the pinned tutorial. Access and current
  rate limits must be checked in Discord. No request has been sent by ProofOps.

Verify chain IDs and actual balances before deployment:

```sh
cast chain-id --rpc-url "$PROOFOPS_SOURCE_RPC"       # must be 11155111
cast chain-id --rpc-url "$PROOFOPS_CREDITCOIN_RPC"   # must be 102031
cast balance "$PROOFOPS_DEMO_ADDRESS" --rpc-url "$PROOFOPS_SOURCE_RPC"
cast balance "$PROOFOPS_DEMO_ADDRESS" --rpc-url "$PROOFOPS_CREDITCOIN_RPC"
```

The [official endpoint reference](https://docs.creditcoin.org/smart-contract-guides/creditcoin-endpoints)
confirms the Creditcoin testnet endpoint and ID. A positive balance alone is not
proof that it will cover the planned transactions.

## 2. Build the exact supported contracts

Use a separate checkout of the official examples, not a contract modification in
ProofOps. Install only the upstream checkout's locked dependencies there:

```sh
git clone https://github.com/gluwa/attestcoin-protocol-examples.git proofops-demo-contracts
cd proofops-demo-contracts
git checkout 6668487ad07fdf8119f54aab9db99b6c50155b5c
corepack yarn install --frozen-lockfile
git clone https://github.com/foundry-rs/forge-std.git lib/forge-std
git -C lib/forge-std checkout 16cb9c998736cab8f14aebd5199cdf6a02fde055
forge build --root bridge
forge build shared/contracts/sol/TestERC20.sol
```

The expected profile is solc 0.8.30, optimizer 200 runs, via-IR, Shanghai,
`@gluwa/asc-contracts@0.2.1`, OpenZeppelin 5.4.0. The decoder is inlined; do not
add a library link or deploy an extra decoder for this compiled profile.
[Runtime build verification](../adapters/bridge-v1-build.md) documents the exact
hash/provenance checks. Existing local compiled artifacts were inspected, but the
fresh-checkout installation commands above have not been rerun as part of #8.

## 3. Estimate, then deploy through the separate signer

These are real transaction commands for the selected wallet to run after funding
and review. They have **not been executed on testnet** during this preflight.
Run from the upstream checkout, recording every real deployment hash/address.
First estimate source-token and minter deployment gas without broadcasting:

```sh
cast estimate --rpc-url "$PROOFOPS_SOURCE_RPC" --from "$PROOFOPS_DEMO_ADDRESS" --create "$(forge inspect shared/contracts/sol/TestERC20.sol:TestERC20 bytecode)"
cast estimate --rpc-url "$PROOFOPS_CREDITCOIN_RPC" --from "$PROOFOPS_DEMO_ADDRESS" --create "$(forge inspect --root bridge contracts/sol/ASCMinter.sol:ASCMinter bytecode)"
cast gas-price --rpc-url "$PROOFOPS_SOURCE_RPC"
cast gas-price --rpc-url "$PROOFOPS_CREDITCOIN_RPC"
```

Estimate both networks separately. Review gas limits and fee caps, allow headroom
above estimates, and compare `gas limit × max fee per gas` against each native
balance. Future mint gas cannot be established until the real proof/call exists;
reserve funds now and repeat that estimate before #11's transaction.

```sh
forge create --broadcast --rpc-url "$PROOFOPS_SOURCE_RPC" --account "$PROOFOPS_DEMO_ACCOUNT" shared/contracts/sol/TestERC20.sol:TestERC20
forge create --root bridge --broadcast --rpc-url "$PROOFOPS_CREDITCOIN_RPC" --account "$PROOFOPS_DEMO_ACCOUNT" contracts/sol/ASCMinter.sol:ASCMinter
export PROOFOPS_SOURCE_TOKEN='<actual source deployment address>'
export PROOFOPS_MINTER='<actual minter deployment address>'

cast estimate --rpc-url "$PROOFOPS_CREDITCOIN_RPC" --from "$PROOFOPS_DEMO_ADDRESS" --create "$(forge inspect --root bridge contracts/sol/BridgeTestToken.sol:BridgeTestToken bytecode)" 'constructor(address)' "$PROOFOPS_MINTER"
forge create --root bridge --broadcast --rpc-url "$PROOFOPS_CREDITCOIN_RPC" --account "$PROOFOPS_DEMO_ACCOUNT" contracts/sol/BridgeTestToken.sol:BridgeTestToken --constructor-args "$PROOFOPS_MINTER"
export PROOFOPS_WRAPPED_TOKEN='<actual wrapped-token deployment address>'
```

**Leave `wrappedTokens(sourceEmitter)` empty.** The upstream tutorial registers
immediately, but our planned rejection demonstration needs an unregistered emitter.
Do not run `wrapOriginToken` or start the auto-submitting worker during #8.
The constructor grants the minter role to the minter; the wrapped token's owner
is the deployer, not the minter. The source constructor funds its deployer with
1,000,000 test tokens. Verify these facts through actual reads, not tutorial output.

## 4. Record and check public deployment context

Create a public `bridge.json` as described in [the interface workflow](../bridge-workflow.md),
using the actual three addresses and intended simulation caller. The preflight
script also accepts just `sourceEmitter`, `minter`, and `expectedWrappedToken`;
it does not need or simulate a caller. Run from the built ProofOps checkout:

```sh
node scripts/check-bridge-deployment.mjs --bridge ./bridge.json --wallet '<public signer address>' --amount 1000000000000000000 > ./preflight.json
node dist/cli.js doctor --json
```

The planned burn is **1 TEST = 1000000000000000000 base units** on the pinned
18-decimal source test token. This is an input plan, not a reported burn.
The script reads finalized contract code and configuration, public native/token
balances, current gas price, and canonical block hashes. It exports no RPC URL or
provider error text. If any runtime differs, it withholds compatible configuration
claims. It has no signer, keystore loading, registration, deployment, or send method.
Its exit code is 2 and status remains `incomplete`: signing access and total gas
sufficiency require separate external checks even when its contract reads pass.

After finality includes all deployments, expected starting state is:

- Source, minter, and wrapped executable identities match the pinned profile.
- `VERIFIER()` equals `0x0000000000000000000000000000000000000FD2`.
- `wrappedTokens(sourceEmitter)` equals the zero address.
- Wrapped `owner()` equals the separately controlled registration signer.
- Wrapped `hasRole(keccak256("ASC_MINTER"), minter)` is true.
- Source `balanceOf(burn signer)` covers the planned raw burn.

Estimate later burn and registration gas as read-only calls before closing #8:

```sh
cast estimate --rpc-url "$PROOFOPS_SOURCE_RPC" --from "$PROOFOPS_DEMO_ADDRESS" "$PROOFOPS_SOURCE_TOKEN" 'burn(uint256)' 1000000000000000000
cast estimate --rpc-url "$PROOFOPS_CREDITCOIN_RPC" --from "$PROOFOPS_DEMO_ADDRESS" "$PROOFOPS_MINTER" 'wrapOriginToken(address,address)' "$PROOFOPS_SOURCE_TOKEN" "$PROOFOPS_WRAPPED_TOKEN"
```

Keep finalized balance/estimate observations, deployment receipts, signer-control
confirmation, and initial mapping/role identity together in #8. Only then can #9
produce the first real burn. Proof service status does not promise that a future
burn's proof will be available immediately; wait for its own attestation/proof.
