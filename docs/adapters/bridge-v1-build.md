# Bridge runtime identity and implementation

Issue #6 implements the built-in adapter in `src/bridge/`. Bridge context is
accepted by the existing local case API and preserved by v2 bundle import/export.
Dedicated CLI options and dashboard controls are the next issue, #7. A live
Creditcoin bridge demonstration still requires phase-3 deployments and funding.

## Resolving deployment identity

The application bundles runtime templates compiled from revision
`6668487ad07fdf8119f54aab9db99b6c50155b5c`. It reads actual contract code at the
source receipt block and destination observation block, then compares executable
bytes to those templates. No local artifact upload, caller-supplied code hash,
new environment variable, or new runtime package is needed.

Only the known Solidity 0.8.30 IPFS CBOR trailer is excluded from executable-byte
comparison. This permits the source-path metadata digest to differ across clean
build locations. It does not exclude any instruction or accept another compiler
version. Both full runtime hashes and executable hashes are recorded in evidence.
The three minter immutable slots are filled with the fixed native verifier
address; arbitrary values cannot match. Proxy code or different compiler output
is unsupported and remains unverified.

Compilation corrected an assumption in the initial specification: this package's
decoder methods are internal, so the compiler **inlines the decoder into the
minter**. The compiled `linkReferences` are empty. There is no external decoder
address to validate for this pinned runtime; the executable minter comparison
covers that decoder code. Tutorial library-deployment instructions do not imply
that the compiled profile performs a delegatecall to a separately linked decoder.

## Rebuilding the references

This is a maintainer operation, not part of installation or application startup.
It requires Git, Foundry with Solidity 0.8.30, and a separate checkout of the
pinned upstream revision with its locked packages and forge-std installed.
See the upstream manifest for exact package identities and forge-std revision.

```sh
node scripts/build-bridge-reference.mjs /path/to/pinned-upstream-checkout
```

The command checks upstream revision and source hashes, package source hashes,
compiler metadata/source hashes, optimizer/via-IR/EVM settings, empty library
links, and immutable offsets before writing:

- `src/bridge/runtimes.ts`: runtime reference data used for code comparison only.
- `test/fixtures/bridge-deployments.json`: creation bytecode and ABI for disposable
  local EVM tests. This file is never loaded by the product.

Review regenerated data and run `npm run typecheck`, `npm test`, and `npm run build`
before committing it. Foundry outputs are disposable in the supplied checkout.
The generator does not deploy contracts or use a signer.
Package files retain their original byte hashes; compiler source hashes account
for Foundry's CRLF-to-LF normalization before invoking solc. Redistribution
notices are retained in [UPSTREAM-LICENSES.md](UPSTREAM-LICENSES.md).

## Data compatibility and operational behavior

- `CaseInput.bridge` is optional and strictly validated. Unknown profiles/fields,
  invalid addresses, unsafe log indices, and static call conflicts are rejected.
- Existing SQLite tables are unchanged; the stored input JSON gains optional
  bridge context. Each attempt retains new block-stamped adapter observations.
- Generic bundles remain `proofops.case.v1`; bridge bundles use
  `proofops.case.v2`. Downgrades, unsupported versions, and discarded bridge
  context are rejected. Importing recorded observations never makes them trusted
  new network results.
- The engine retains snapshot findings when simulation fails. Source reorgs
  invalidate source-proof expectations even when detected late in bridge work.
- Native index/source binding and exact execute arguments are checked before
  automatic bridge simulation. Historical destination receipts require fresh
  source proof, actual calldata, historical runtime identity, and matching minter
  and wrapped-token mint logs before final completion.
- Current replay rejection and a confirmed historical mint remain separate
  observations. `destination-call-succeeds` checks the current simulation; it
  does not promise the same event can mint again. Richer regression expectations
  remain in #12.

## Validation scope

Unit tests cover source selection, malformed/multiple events, query packing,
runtime identity, role/mapping/replay diagnosis, exact calldata, mint correlation,
reorganizations, provider failures, and v1/v2 compatibility. The local RPC fixture
test verifies that configuration calls use the same recorded destination block.

The Anvil test deploys the actual pinned creation bytecode, mines a real source
burn, decodes its SDK-backed source evidence, checks deployed runtime identities,
and observes the registration change. It installs **no mock native verifier** and
asserts that ordinary Anvil cannot satisfy the native index read. Isolated unit
fixtures exercise successful mint-correlation logic, not live Creditcoin minting.

The supported profile is intentionally narrow: different executable compiler
output, proxies, modified mint rules, and other networks require another verified
profile. Runtime matching is observed through the configured RPC; it does not
make an untrusted provider a cryptographic destination-state attestation.
