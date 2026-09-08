import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Interface } from 'ethers';
import { loadConfig, publicConfig } from '../src/config.js';
import { caseInput, callInput, InputError } from '../src/validation.js';
import { Store } from '../src/store.js';
import { inspectCase, checkExpectation, decodeRevert } from '../src/engine.js';
import { exportBundle, readBundle } from '../src/bundle.js';
import { NetworkFailure, type NetworkPort, type Proof, type SourceEvidence } from '../src/network.js';

// Explicit synthetic unit fixtures. Never loaded by the application or used as live evidence.
const sourceHash = `0x${'11'.repeat(32)}`;
const blockHash = `0x${'22'.repeat(32)}`;
const source: SourceEvidence = { hash: sourceHash, block: { number: 25, hash: blockHash }, status: 1, encoded: '0x1234', transaction: { hash: sourceHash }, receipt: { status: 1 } };
const proof: Proof = { chainKey: 1, headerNumber: 25, txIndex: 0, txHash: sourceHash, txBytes: '0x1234', continuityProof: { lowerEndpointDigest: blockHash, roots: [blockHash] }, merkleProof: { root: blockHash, siblings: [] }, cached: false, generatedAt: new Date(0) };
const call = { to: `0x${'33'.repeat(20)}`, from: `0x${'44'.repeat(20)}`, data: '0x12345678' };

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'proofops-unit-'));
  const config = loadConfig({ SOURCE_CHAIN_RPC_URL: 'http://127.0.0.1:1/private-api-key', PROOFOPS_DATA_DIR: directory });
  const store = new Store(directory);
  const network: NetworkPort = {
    source: async () => structuredClone(source),
    attestation: async () => ({ height: 30, digest: blockHash, exists: true, block: { number: 100, hash: blockHash }, registeredChainId: 11155111, chainEncoding: 1 }),
    proof: async () => structuredClone(proof),
    verify: async () => ({ valid: true, block: { number: 101, hash: blockHash } }),
    canonical: async () => true,
    simulate: async () => ({ result: '0x', block: { number: 102, hash: blockHash } }),
    destination: async () => ({ status: 1, transactionHash: sourceHash })
  };
  return { directory, config, store, network, cleanup: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('configuration and input validation reject ambiguous networks and malformed call data', () => {
  assert.throws(() => loadConfig({ SOURCE_CHAIN_KEY: '1e2' }), InputError);
  assert.throws(() => loadConfig({ SOURCE_CHAIN_ID: '9007199254740993' }), InputError);
  assert.throws(() => loadConfig({ SOURCE_CHAIN_RPC_URL: 'file:///etc/passwd' }), InputError);
  assert.throws(() => caseInput({ sourceTx: '0x123' }), InputError);
  assert.throws(() => caseInput({ sourceTx: sourceHash, destinationTx: false }), InputError);
  assert.throws(() => caseInput({ sourceTx: sourceHash, call: null }), InputError);
  assert.throws(() => callInput({ ...call, data: '0x123' }), InputError);
  assert.throws(() => callInput({ ...call, value: '-1' }), InputError);
  assert.throws(() => callInput({ ...call, value: (2n ** 256n).toString() }), InputError);
  assert.throws(() => callInput({ ...call, abi: ['definitely not an ABI fragment'] }), InputError);
  assert.equal(caseInput({ sourceTx: sourceHash.toUpperCase().replace('0X', '0x') }).sourceTx, sourceHash);
  assert.equal(callInput(call).value, '0');
});

test('public configuration excludes provider URLs and filesystem paths', () => {
  const config = loadConfig({ SOURCE_CHAIN_RPC_URL: 'https://example.com/secret?key=private', PROOFOPS_DATA_DIR: '/private/path' });
  const output = JSON.stringify(publicConfig(config));
  assert.equal(output.includes('secret'), false);
  assert.equal(output.includes('/private/path'), false);
});

test('missing source configuration persists a blocked attempt without calling any integration', async () => {
  const s = setup();
  try {
    s.config.sourceRpc = undefined;
    s.network.source = async () => { throw new Error('must not be called'); };
    const result = await inspectCase(s.store, s.store.create({ sourceTx: sourceHash }, s.config).id, s.config, s.network);
    assert.equal(result.attempts[0].status, 'blocked');
    assert.equal(result.attempts[0].observations[0].code, 'SOURCE_RPC_MISSING');
    assert.equal(checkExpectation(result.attempts[0], 'proof-valid'), 'inconclusive');
  } finally { s.cleanup(); }
});

test('source revert stops proof collection and cannot become a passing check', async () => {
  const s = setup();
  try {
    s.network.source = async () => ({ ...source, status: 0 });
    s.network.proof = async () => { assert.fail('proof must not be requested'); };
    const result = await inspectCase(s.store, s.store.create({ sourceTx: sourceHash }, s.config).id, s.config, s.network);
    assert.equal(result.attempts[0].status, 'failed');
    assert.equal(checkExpectation(result.attempts[0], 'proof-valid'), 'fail');
  } finally { s.cleanup(); }
});

test('attestation pending stays waiting and never requests a premature proof', async () => {
  const s = setup();
  try {
    const attestation = await s.network.attestation();
    s.network.attestation = async () => ({ ...attestation, height: 24 });
    s.network.proof = async () => { assert.fail('proof must not be requested'); };
    const result = await inspectCase(s.store, s.store.create({ sourceTx: sourceHash }, s.config).id, s.config, s.network);
    assert.equal(result.attempts[0].status, 'waiting');
    assert.equal(checkExpectation(result.attempts[0], 'proof-valid'), 'inconclusive');
  } finally { s.cleanup(); }
});

for (const [field, wrong] of [['chainKey', 2], ['headerNumber', 26], ['txHash', blockHash], ['txBytes', '0x4321']] as const) {
  test(`a mismatched proof ${field} is rejected before native verification`, async () => {
    const s = setup();
    try {
      s.network.proof = async () => ({ ...proof, [field]: wrong });
      s.network.verify = async () => { assert.fail('mismatched evidence must not be verified'); };
      const result = await inspectCase(s.store, s.store.create({ sourceTx: sourceHash }, s.config).id, s.config, s.network);
      assert.ok(result.attempts[0].observations.some(o => o.code === 'PROOF_SOURCE_MISMATCH'));
      assert.equal(checkExpectation(result.attempts[0], 'proof-valid'), 'fail');
    } finally { s.cleanup(); }
  });
}

test('provider exceptions are unavailable, never proof rejection, and secrets do not enter evidence', async () => {
  const s = setup();
  try {
    s.network.verify = async () => { throw new Error('request failed https://provider/PRIVATE_KEY?api_key=SECRET'); };
    const result = await inspectCase(s.store, s.store.create({ sourceTx: sourceHash }, s.config).id, s.config, s.network);
    assert.equal(result.attempts[0].status, 'blocked');
    assert.equal(checkExpectation(result.attempts[0], 'proof-valid'), 'inconclusive');
    const text = JSON.stringify(exportBundle(result));
    for (const secret of ['PRIVATE_KEY', 'SECRET', 'private-api-key', s.directory]) assert.equal(text.includes(secret), false);
    assert.equal(result.attempts[0].observations.some(o => o.code === 'PROOF_REJECTED'), false);
  } finally { s.cleanup(); }
});

test('a source reorganization after verification invalidates the outcome', async () => {
  const s = setup();
  try {
    let count = 0;
    s.network.canonical = async () => ++count === 1;
    const result = await inspectCase(s.store, s.store.create({ sourceTx: sourceHash }, s.config).id, s.config, s.network);
    assert.equal(checkExpectation(result.attempts[0], 'proof-valid'), 'fail');
    assert.equal(result.attempts[0].observations.some(o => o.code === 'PROOF_VERIFIED'), false);
  } finally { s.cleanup(); }
});

test('valid proof and destination revert remain distinct with block-stamped decoded evidence', async () => {
  const s = setup();
  try {
    const abi = ['error UnregisteredEmitter(address emitter)'];
    const revert = new Interface(abi).encodeErrorResult('UnregisteredEmitter', [call.to]);
    s.network.simulate = async () => ({ block: { number: 102, hash: blockHash }, revert });
    const result = await inspectCase(s.store, s.store.create({ sourceTx: sourceHash, call: { ...call, abi } }, s.config).id, s.config, s.network);
    const a = result.attempts[0];
    assert.equal(a.status, 'failed');
    assert.equal(checkExpectation(a, 'proof-valid'), 'pass');
    assert.equal(checkExpectation(a, 'destination-call-succeeds'), 'fail');
    const simulation = a.observations.find(o => o.stage === 'simulation');
    assert.equal((simulation?.evidence?.decodedError as { name: string }).name, 'UnregisteredEmitter');
    assert.equal(simulation?.kind, 'simulated');
    assert.equal(simulation?.evidence?.stateMode, 'current-finalized-state');
  } finally { s.cleanup(); }
});

test('unknown revert bytes remain undecoded; standard Solidity errors can be decoded', () => {
  assert.equal(decodeRevert('0x12345678'), null);
  const encoded = new Interface([]).encodeErrorResult('Error', ['No wrapped token for emitter']);
  assert.deepEqual(decodeRevert(encoded), { name: 'Error', args: ['No wrapped token for emitter'] });
});

test('destination simulation still runs when source configuration is absent without implying proof validity', async () => {
  const s = setup();
  try {
    s.config.sourceRpc = undefined;
    const result = await inspectCase(s.store, s.store.create({ sourceTx: sourceHash, call }, s.config).id, s.config, s.network);
    assert.ok(result.attempts[0].observations.some(o => o.code === 'DESTINATION_CALL_SUCCEEDED'));
    assert.equal(checkExpectation(result.attempts[0], 'destination-call-succeeds'), 'inconclusive');
  } finally { s.cleanup(); }
});

test('attempt history is durable and a corrected rerun preserves the original failure', async () => {
  const s = setup();
  try {
    const record = s.store.create({ sourceTx: sourceHash }, s.config);
    s.network.verify = async () => ({ valid: false, block: { number: 101, hash: blockHash } });
    await inspectCase(s.store, record.id, s.config, s.network);
    s.network.verify = async () => ({ valid: true, block: { number: 102, hash: blockHash } });
    await inspectCase(s.store, record.id, s.config, s.network);
    const reopened = new Store(s.directory);
    try {
      const saved = reopened.get(record.id);
      assert.deepEqual(saved.attempts.map(a => a.status), ['failed', 'ready']);
      assert.equal(checkExpectation(saved.attempts[1], 'proof-valid'), 'pass');
      assert.equal(checkExpectation(saved.attempts[1], 'destination-call-succeeds'), 'inconclusive');
    } finally { reopened.close(); }
  } finally { s.cleanup(); }
});

test('concurrent attempts on the same case are refused and network changes cannot rerun an old case', async () => {
  const s = setup();
  try {
    const record = s.store.create({ sourceTx: sourceHash }, s.config);
    const a = s.store.start(record.id);
    assert.throws(() => s.store.start(record.id), InputError);
    const other = new Store(s.directory);
    assert.equal(other.get(record.id).attempts[0].status, 'running');
    other.close();
    s.store.finish(a, 'interrupted');
    await assert.rejects(inspectCase(s.store, record.id, { ...s.config, sourceChainKey: 3 }, s.network), InputError);
    assert.equal(s.store.get(record.id).attempts.length, 1);
  } finally { s.cleanup(); }
});

test('bundle import validates format, network identity, and required destination call', () => {
  const s = setup();
  try {
    const record = s.store.create({ sourceTx: sourceHash }, s.config);
    const bundle = exportBundle(record);
    assert.equal(readBundle(bundle).input.sourceTx, sourceHash);
    assert.throws(() => readBundle({ ...bundle, mode: 'historical-replay' }), InputError);
    assert.throws(() => readBundle({ ...bundle, expectation: 'destination-call-succeeds' }), InputError);
    assert.throws(() => readBundle({ ...bundle, record: { ...record, sourceChainId: -1 } }), InputError);
  } finally { s.cleanup(); }
});

test('wrong-network failure has a specific actionable code', async () => {
  const s = setup();
  try {
    s.network.source = async () => { throw new NetworkFailure('wrong-network'); };
    const result = await inspectCase(s.store, s.store.create({ sourceTx: sourceHash }, s.config).id, s.config, s.network);
    assert.equal(result.attempts[0].observations[0].code, 'WRONG_NETWORK');
    assert.equal(result.attempts[0].status, 'blocked');
  } finally { s.cleanup(); }
});
