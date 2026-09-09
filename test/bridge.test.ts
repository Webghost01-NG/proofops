import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AbiCoder, keccak256, solidityPacked, toBeHex, ZeroAddress } from 'ethers';
import { bridgeInput, caseInput, InputError } from '../src/validation.js';
import { buildBridgeCall, correlateBridgeMint, decodeBridgeCall, diagnoseBridge, queryId, selectBurn } from '../src/bridge/adapter.js';
import { checkIdentity, identityVerified, referenceRuntime } from '../src/bridge/identity.js';
import { minterInterface } from '../src/bridge/abi.js';
import { Store } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import { inspectCase, checkExpectation } from '../src/engine.js';
import { exportBundle, readBundle } from '../src/bundle.js';
import type { NetworkPort } from '../src/network.js';
import { address, block, burn, destination, hash, input, proof, recipient, snapshot, source } from './bridge-fixtures.js';

const codes = (findings: { code: string }[]) => findings.map(f => f.code);
const selected = () => selectBurn(structuredClone(source), input).selection!;
const error = (reason: string) => minterInterface.encodeErrorResult('Error', [reason]);

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'proofops-bridge-'));
  const config = loadConfig({ SOURCE_CHAIN_RPC_URL: 'http://127.0.0.1:1/secret', PROOFOPS_DATA_DIR: directory });
  const store = new Store(directory);
  const network: NetworkPort = {
    source: async () => structuredClone(source), canonical: async () => true,
    attestation: async () => ({ height: 30, digest: block.hash, exists: true, block, registeredChainId: 11155111, chainEncoding: 1 }),
    proof: async () => structuredClone(proof), verify: async () => ({ valid: true, block }),
    simulate: async () => { throw new Error('generic simulation must not handle bridge inputs'); },
    destination: async () => { throw new Error('generic receipt must not confirm a bridge mint'); },
    bridge: { snapshot: async () => snapshot(), simulate: async () => ({ block, result: minterInterface.encodeFunctionResult('execute', [true]) }), destination: async () => destination(), canonical: async () => true }
  };
  const inspect = (extra = {}) => inspectCase(store, store.create({ sourceTx: hash, bridge: input, ...extra }, config).id, config, network);
  return { directory, config, store, network, inspect, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('bridge input validates profile, addresses, event assertion, and forbidden extra fields', () => {
  assert.deepEqual(bridgeInput(input), input);
  for (const mutation of [{ id: 'unknown' }, { minter: ZeroAddress }, { sourceEmitter: '0x1' }, { sourceLogIndex: -1 }, { sourceLogIndex: 1.2 }, { sourceLogIndex: Number.MAX_SAFE_INTEGER + 1 }, { provider: 'https://untrusted.example' }]) assert.throws(() => bridgeInput({ ...input, ...mutation }), InputError);
  assert.throws(() => caseInput({ sourceTx: hash, bridge: input, call: { to: input.minter, from: recipient, data: '0x', value: '0' } }), InputError);
  assert.throws(() => caseInput({ sourceTx: hash, bridge: input, call: { to: input.minter, from: input.caller, data: '0x', value: '1' } }), InputError);
});

test('burn selection preserves source identity, global/local index, event recipient, and integer amount', () => {
  const selection = selected();
  assert.equal(selection.recipient, recipient);
  assert.notEqual(selection.recipient, input.caller);
  assert.equal(selection.transactionIndex, 2);
  assert.equal(selection.logIndex, 12);
  assert.equal(selection.receiptOffset, 0);
  for (const amount of [0n, (2n ** 256n) - 1n]) {
    const candidate = structuredClone(source);
    candidate.receipt.logs = [{ ...burn, topics: [burn.topics[0], '0x' + 'ff'.repeat(12) + recipient.slice(2)], data: toBeHex(amount, 32) }];
    assert.equal(selectBurn(candidate, input).selection?.amount, amount.toString());
    assert.equal(selectBurn(candidate, input).selection?.recipient, recipient);
  }
});

test('multiple burns cannot be silently filtered, summed, or overridden by a later selection', () => {
  const candidate = structuredClone(source);
  candidate.receipt.logs = [burn, { ...burn, index: 13 }];
  assert.deepEqual(codes(selectBurn(candidate, input).findings), ['BRIDGE_LOG_SELECTION_REQUIRED']);
  assert.equal(selectBurn(candidate, { ...input, sourceLogIndex: 12 }).selection?.amount, '100');
  assert.deepEqual(codes(selectBurn(candidate, { ...input, sourceLogIndex: 13 }).findings), ['BRIDGE_LOG_NOT_EXECUTABLE']);
  candidate.receipt.logs = [{ ...burn, address: recipient }, burn];
  assert.deepEqual(codes(selectBurn(candidate, input).findings), ['BRIDGE_EMITTER_MISMATCH']);
  candidate.receipt.logs = [{ ...burn, data: '0x' }, burn];
  assert.deepEqual(codes(selectBurn(candidate, input).findings), ['BRIDGE_BURN_MALFORMED']);
});

test('missing events, malformed topics, failed receipts, and unsupported types remain distinct', () => {
  for (const topics of [[burn.topics[0]], [...burn.topics, block.hash], [burn.topics[0], '0x12']]) {
    assert.equal(selectBurn({ ...source, receipt: { ...source.receipt, logs: [{ ...burn, topics }] } }, input).findings[0].code, 'BRIDGE_BURN_MALFORMED');
  }
  assert.equal(selectBurn({ ...source, receipt: { ...source.receipt, logs: [] } }, input).findings[0].code, 'BRIDGE_BURN_NOT_FOUND');
  assert.equal(selectBurn({ ...source, status: 0 }, input).findings[0].code, 'BRIDGE_SOURCE_REVERTED');
  assert.equal(selectBurn({ ...source, transaction: { ...source.transaction, type: 5 } }, input).findings[0].code, 'BRIDGE_ENCODING_UNSUPPORTED');
});

test('query hashing follows independent 32/8/32-byte layouts for nonzero and boundary values', () => {
  for (const values of [[1n, 25n, 2n], [1n, 100n, 27n], [(2n ** 64n) - 1n, (2n ** 64n) - 1n, (2n ** 64n) - 1n]]) {
    const [chain, height, index] = values;
    const independent = '0x' + chain.toString(16).padStart(64, '0') + height.toString(16).padStart(16, '0') + index.toString(16).padStart(64, '0');
    assert.equal(queryId(chain, height, index), keccak256(independent));
    assert.notEqual(queryId(chain, height, index), keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64', 'uint256'], values)));
    assert.notEqual(queryId(chain, height, index), keccak256(solidityPacked(['uint64', 'uint64', 'uint64'], values)));
  }
  assert.throws(() => queryId(-1, 1, 1), InputError);
});

test('exact execute call binds all proof fields and rejects conflicting input or non-Mint action', () => {
  const call = buildBridgeCall(proof, input);
  assert.equal(call.data.slice(0, 10), '0xc6339bf7');
  assert.equal(call.value, '0');
  const decoded = decodeBridgeCall(call.data)!;
  assert.equal(decoded.txBytes, proof.txBytes);
  assert.deepEqual(decoded.merkleProof, proof.merkleProof);
  assert.deepEqual(decoded.continuityProof, proof.continuityProof);
  assert.equal(buildBridgeCall(proof, input, call).data, call.data);
  assert.throws(() => buildBridgeCall(proof, input, { ...call, data: '0x' }), InputError);
  const args = Array.from(minterInterface.decodeFunctionData('execute', call.data));
  args[0] = 1;
  assert.equal(decodeBridgeCall(minterInterface.encodeFunctionData('execute', args)), null);
  assert.equal(decodeBridgeCall(call.data + '00'), null);
});

test('identity matches full executable code, tolerates only pinned compiler metadata, and fixes verifier immutables', () => {
  assert.equal(identityVerified(snapshot()), true);
  for (const role of ['source', 'minter', 'wrapped'] as const) {
    const reference = referenceRuntime(role);
    assert.equal(checkIdentity(role, input.minter, block, '0x').verified, false);
    assert.equal(checkIdentity(role, input.minter, block, '0xff' + reference.slice(4)).verified, false);
    const metadataStart = reference.lastIndexOf('a2646970667358221220');
    const digestStart = metadataStart + 'a2646970667358221220'.length;
    const changedDigest = reference.slice(0, digestStart) + 'ab'.repeat(32) + reference.slice(digestStart + 64);
    assert.equal(checkIdentity(role, input.minter, block, changedDigest).verified, true);
    assert.equal(checkIdentity(role, input.minter, block, reference.replace(/00081e0033$/, '00081f0033')).verified, false);
  }
  const wrongVerifier = referenceRuntime('minter').replace('0'.repeat(60) + '0fd2', '0'.repeat(63) + '1');
  assert.notEqual(wrongVerifier, referenceRuntime('minter'));
  assert.equal(checkIdentity('minter', input.minter, block, wrongVerifier).verified, false);
});

test('registration, wrong mapping, missing role, replay and raw errors keep distinct evidence', () => {
  const empty = { ...snapshot(), wrappedToken: ZeroAddress };
  assert.ok(codes(diagnoseBridge(input, empty)).includes('BRIDGE_REGISTRATION_EMPTY'));
  assert.ok(!codes(diagnoseBridge(input, empty)).includes('BRIDGE_EMITTER_UNREGISTERED'));
  assert.ok(codes(diagnoseBridge(input, empty, { block, revert: error('No wrapped token for emitter') })).includes('BRIDGE_EMITTER_UNREGISTERED'));
  assert.ok(codes(diagnoseBridge(input, { ...snapshot(), wrappedToken: recipient })).includes('BRIDGE_WRAPPED_TOKEN_MISMATCH'));
  assert.ok(codes(diagnoseBridge(input, { ...snapshot(), minterRole: false })).includes('BRIDGE_MINTER_ROLE_MISSING'));
  const separateOwner = diagnoseBridge(input, { ...snapshot(), targetOwner: recipient });
  assert.ok(!separateOwner.some(f => f.outcome === 'fail'), 'permissionless execution does not require the target owner to equal its caller');
  assert.equal((separateOwner[0].evidence?.snapshot as { targetOwner: string }).targetOwner, recipient);
  const replay = diagnoseBridge(input, { ...empty, processed: true }, { block, revert: error('Query already processed') });
  assert.ok(codes(replay).includes('BRIDGE_QUERY_PROCESSED'));
  assert.ok(!codes(replay).includes('BRIDGE_EMITTER_UNREGISTERED'));
  const unknown = diagnoseBridge(input, snapshot(), { block, revert: '0x12345678' }).at(-1)!;
  assert.equal(unknown.code, 'BRIDGE_CALL_REVERTED');
  assert.equal(unknown.evidence?.decodedError, null);
  assert.equal(diagnoseBridge(input, snapshot(), { block, result: '0x' }).at(-1)?.code, 'BRIDGE_RETURN_UNEXPECTED');
  assert.equal(diagnoseBridge(input, snapshot(), { block: { ...block, number: 101 }, result: '0x' }).at(-1)?.code, 'BRIDGE_SNAPSHOT_MISMATCH');
});

test('mint correlation accepts a different relayer only with exact source and both genuine-emitter events', () => {
  assert.equal(correlateBridgeMint(input, selected(), source, destination()).code, 'BRIDGE_MINT_CONFIRMED');
  assert.equal(correlateBridgeMint(input, selected(), source, { ...destination(), finalized: false }).code, 'BRIDGE_DESTINATION_NOT_FINAL');
  assert.equal(correlateBridgeMint(input, selected(), source, { ...destination(), status: 0 }).code, 'BRIDGE_DESTINATION_REVERTED');
  for (const mutate of [
    (d: ReturnType<typeof destination>) => { d.to = recipient; },
    (d: ReturnType<typeof destination>) => { d.submittedProof!.txBytes = '0xffff'; },
    (d: ReturnType<typeof destination>) => { d.submittedProof!.chainKey = 2; },
    (d: ReturnType<typeof destination>) => { d.snapshot!.transactionIndex = 3; },
    (d: ReturnType<typeof destination>) => { d.snapshot!.identities[0].verified = false; },
    (d: ReturnType<typeof destination>) => { d.logs[1].address = recipient; },
    (d: ReturnType<typeof destination>) => { d.logs[1].topics[3] = hash; },
    (d: ReturnType<typeof destination>) => { d.logs[1].topics[2] = '0x' + '00'.repeat(12) + input.caller.slice(2); },
    (d: ReturnType<typeof destination>) => { d.data = '0x'; },
    (d: ReturnType<typeof destination>) => { d.snapshot!.wrappedToken = recipient; },
    (d: ReturnType<typeof destination>) => { d.snapshot!.verifier = recipient; },
    (d: ReturnType<typeof destination>) => { d.logs[1].data = toBeHex(101, 32); },
    (d: ReturnType<typeof destination>) => { d.logs[1].topics[1] = '0x' + '00'.repeat(12) + recipient.slice(2); },
    (d: ReturnType<typeof destination>) => { d.logs[0].address = recipient; },
    (d: ReturnType<typeof destination>) => { d.logs.push(d.logs[1]); },
    (d: ReturnType<typeof destination>) => { d.logs.shift(); }
  ]) {
    const evidence = destination(); mutate(evidence);
    assert.equal(correlateBridgeMint(input, selected(), source, evidence).code, 'BRIDGE_MINT_UNCONFIRMED');
  }
});

test('bridge bundles preserve context, reject downgraded/unknown schemas, and leave generic v1 supported', async () => {
  const s = setup();
  try {
    const record = await s.inspect();
    const bundle = exportBundle(record);
    assert.equal(bundle.format, 'proofops.case.v2');
    assert.deepEqual(readBundle(bundle).input.bridge, input);
    assert.equal(checkExpectation(record.attempts[0], 'destination-call-succeeds'), 'pass');
    assert.throws(() => readBundle({ ...bundle, format: 'proofops.case.v1' }), InputError);
    assert.throws(() => readBundle({ ...bundle, record: { ...record, input: { ...record.input, bridge: { ...input, id: 'future' } } } }), InputError);
    const generic = exportBundle(s.store.create({ sourceTx: hash }, s.config));
    assert.equal(generic.format, 'proofops.case.v1');
    assert.throws(() => readBundle({ ...generic, format: 'proofops.case.v2' }), InputError);
    const reopened = new Store(s.directory);
    try { assert.deepEqual(reopened.get(record.id).input.bridge, input); } finally { reopened.close(); }
  } finally { s.close(); }
});

test('engine rejects native index disagreement, unverified code, and conflicting calldata before simulation', async () => {
  for (const mode of ['index', 'identity', 'conflict']) {
    const s = setup();
    try {
      s.network.bridge!.simulate = async () => { assert.fail('bridge must not simulate'); };
      s.network.bridge!.snapshot = async () => {
        if (mode === 'conflict') assert.fail('conflicting call must be rejected before snapshot');
        const state = snapshot();
        if (mode === 'index') { state.transactionIndex = 3; state.queryId = undefined; }
        if (mode === 'identity') state.identities[0].verified = false;
        return state;
      };
      const record = await s.inspect(mode === 'conflict' ? { call: { to: input.minter, from: input.caller, data: '0x' } } : {});
      assert.ok(codes(record.attempts[0].observations).includes(mode === 'index' ? 'BRIDGE_QUERY_INDEX_MISMATCH' : mode === 'identity' ? 'BRIDGE_IDENTITY_UNVERIFIED' : 'BRIDGE_CALL_CONFLICT'));
      assert.notEqual(checkExpectation(record.attempts[0], 'destination-call-succeeds'), 'pass');
    } finally { s.close(); }
  }
});

test('provider failures and missing proof never become passing destination checks or leak errors', async () => {
  for (const mode of ['transport', 'proof', 'return']) {
    const s = setup();
    try {
      if (mode === 'transport') s.network.bridge!.simulate = async () => { throw new Error('https://provider/private-secret'); };
      if (mode === 'proof') { s.network.proof = async () => null; s.network.bridge!.simulate = async () => { assert.fail('no unverified simulation'); }; }
      if (mode === 'return') s.network.bridge!.simulate = async () => ({ block, result: '0x' });
      const result = await s.inspect();
      assert.equal(checkExpectation(result.attempts[0], 'destination-call-succeeds'), 'inconclusive');
      assert.equal(JSON.stringify(result).includes('private-secret'), false);
      assert.ok(codes(result.attempts[0].observations).includes('BRIDGE_IDENTITY_VERIFIED'), 'configuration evidence survives simulation/provider failure');
    } finally { s.close(); }
  }
});

test('unsupported bridge networks cannot use the built-in contract profile', async () => {
  const s = setup();
  try {
    s.config.sourceChainKey = 2;
    s.network.proof = async () => ({ ...proof, chainKey: 2 });
    s.network.bridge!.snapshot = async () => { assert.fail('unsupported bridge network'); };
    const result = await s.inspect();
    assert.ok(codes(result.attempts[0].observations).includes('BRIDGE_NETWORK_UNSUPPORTED'));
    assert.equal(checkExpectation(result.attempts[0], 'destination-call-succeeds'), 'inconclusive');
  } finally { s.close(); }
});

test('a changed source or destination block invalidates bridge simulation and mint linkage', async () => {
  for (const side of ['source', 'destination']) {
    const s = setup();
    try {
      let canonicalReads = 0;
      if (side === 'source') s.network.canonical = async () => ++canonicalReads < 3;
      else s.network.bridge!.canonical = async () => false;
      const result = await s.inspect({ destinationTx: hash });
      const observations = result.attempts[0].observations;
      assert.ok(codes(observations).includes('BRIDGE_STATE_CHANGED'));
      assert.ok(!codes(observations).includes('BRIDGE_MINT_CONFIRMED'));
      assert.notEqual(checkExpectation(result.attempts[0], 'destination-call-succeeds'), 'pass');
      if (side === 'source') assert.equal(checkExpectation(result.attempts[0], 'proof-valid'), 'fail');
    } finally { s.close(); }
  }
});

test('a saved historical mint and current replay rejection coexist without overwriting earlier attempts', async () => {
  const s = setup();
  try {
    const record = await s.inspect({ destinationTx: hash });
    s.network.bridge!.snapshot = async () => ({ ...snapshot(), processed: true });
    s.network.bridge!.simulate = async () => ({ block, revert: error('Query already processed') });
    const rerun = await inspectCase(s.store, record.id, s.config, s.network);
    assert.equal(rerun.attempts.length, 2);
    assert.equal(checkExpectation(rerun.attempts[0], 'destination-call-succeeds'), 'pass');
    assert.equal(checkExpectation(rerun.attempts[1], 'destination-call-succeeds'), 'fail');
    assert.ok(codes(rerun.attempts[1].observations).includes('BRIDGE_QUERY_PROCESSED'));
    assert.ok(codes(rerun.attempts[1].observations).includes('BRIDGE_MINT_CONFIRMED'));
  } finally { s.close(); }
});
