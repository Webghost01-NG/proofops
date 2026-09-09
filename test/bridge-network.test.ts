import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { ContractFactory, JsonRpcProvider, ZeroAddress } from 'ethers';
import { BridgeNetwork } from '../src/bridge/network.js';
import { minterInterface, tokenInterface, VERIFIER, verifierInterface } from '../src/bridge/abi.js';
import { buildBridgeCall, diagnoseBridge, selectBurn } from '../src/bridge/adapter.js';
import { identityVerified, referenceRuntime } from '../src/bridge/identity.js';
import { loadConfig } from '../src/config.js';
import { LiveNetwork, NetworkFailure } from '../src/network.js';
import { block, input, proof, source } from './bridge-fixtures.js';

test('bridge RPC snapshot pins configuration and simulation to one block and rejects index disagreement', async () => {
  const requests: { method: string; params: any[]; path: string }[] = [];
  let returnedIndex = 2n;
  let unavailable = false;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ ...request, path: req.url! });
    if (unavailable) { res.writeHead(503); res.end(); return; }
    const { method, params } = request;
    let result: unknown;
    if (method === 'eth_chainId') result = req.url === '/source' ? '0xaa36a7' : '0x18e8f';
    else if (method === 'eth_getBlockByNumber') result = { number: '0x64', hash: block.hash };
    else if (method === 'eth_getCode') result = referenceRuntime(params[0] === input.sourceEmitter ? 'source' : params[0] === input.minter ? 'minter' : 'wrapped');
    else if (method === 'eth_call') {
      const iface = params[0].to === VERIFIER ? verifierInterface : params[0].to === input.minter ? minterInterface : tokenInterface;
      const call = iface.parseTransaction({ data: params[0].data })!;
      const values: Record<string, unknown> = { VERIFIER, wrappedTokens: input.expectedWrappedToken, owner: input.caller, hasRole: true, calculateTxIndex: returnedIndex, processedQueries: false, execute: true };
      result = iface.encodeFunctionResult(call.name, [values[call.name]]);
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const network = new BridgeNetwork(loadConfig({ SOURCE_CHAIN_RPC_URL: url + '/source', CREDITCOIN_RPC_URL: url + '/destination' }));
    const observed = await network.snapshot(input, source, proof);
    assert.equal(identityVerified(observed), true);
    assert.equal(observed.transactionIndex, 2);
    assert.equal(observed.processed, false);
    assert.equal(observed.targetOwner, input.caller);
    const simulation = await network.simulate(buildBridgeCall(proof, input), observed.block);
    assert.equal(simulation.result, minterInterface.encodeFunctionResult('execute', [true]));
    assert.deepEqual(simulation.block, observed.block);
    for (const request of requests.filter(r => r.method === 'eth_call' || r.method === 'eth_getCode')) assert.equal(request.params[1], request.path === '/source' ? '0x19' : '0x64');
    assert.equal(requests.filter(r => r.method === 'eth_getBlockByNumber').length, 1);
    const processedSelector = minterInterface.getFunction('processedQueries')!.selector;
    requests.length = 0;
    returnedIndex = 3n;
    const mismatch = await network.snapshot(input, source, proof);
    assert.equal(mismatch.transactionIndex, 3);
    assert.equal(mismatch.queryId, undefined);
    assert.ok(!requests.some(r => r.method === 'eth_call' && r.params[0].data.startsWith(processedSelector)));
    unavailable = true;
    await assert.rejects(network.snapshot(input, source, proof), (e: unknown) => e instanceof NetworkFailure && e.kind === 'transport');
    assert.ok(requests.every(r => !r.method.startsWith('eth_send')));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

const hasAnvil = spawnSync('anvil', ['--version'], { stdio: 'ignore' }).status === 0;
test('real local source burn and deployed bridge runtime/configuration match the pinned adapter profile', { skip: !hasAnvil, timeout: 30000 }, async () => {
  const reserve = createServer();
  await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const child = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--silent'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(url, 31337, { staticNetwork: true });
  try {
    let available = false;
    for (let i = 0; i < 50; i++) {
      try { available = (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(200) })).ok; } catch { /* Isolated local node startup. */ }
      if (available) break;
      await setTimeout(100);
    }
    assert.ok(available);
    const signer = await provider.getSigner(0);
    const fixtures = JSON.parse(readFileSync('test/fixtures/bridge-deployments.json', 'utf8')).contracts;
    const deploy = async (role: string, args: unknown[] = []) => {
      const contract = await new ContractFactory(fixtures[role].abi, fixtures[role].bytecode, signer).deploy(...args);
      await contract.waitForDeployment();
      return contract;
    };
    const minter = await deploy('minter');
    const wrapped = await deploy('wrapped', [await minter.getAddress()]);
    const burner = await deploy('source');
    const context = { ...input, minter: await minter.getAddress(), expectedWrappedToken: await wrapped.getAddress(), sourceEmitter: await burner.getAddress(), caller: await signer.getAddress() };
    const sent = await burner.getFunction('burn')(100n);
    await sent.wait();
    await provider.send('anvil_mine', ['0x80']);
    const live = new LiveNetwork(loadConfig({ SOURCE_CHAIN_RPC_URL: url, SOURCE_CHAIN_ID: '31337', CREDITCOIN_RPC_URL: url, CREDITCOIN_CHAIN_ID: '31337' }));
    const actualSource = await live.source(sent.hash);
    assert.ok(actualSource);
    const selected = selectBurn(actualSource, context);
    assert.equal(selected.selection?.recipient, await signer.getAddress());
    assert.equal(selected.selection?.amount, '100');
    assert.equal(selected.selection?.receiptOffset, 1);
    const empty = await live.bridge.snapshot(context, actualSource);
    assert.equal(identityVerified(empty), true);
    assert.equal(empty.wrappedToken, ZeroAddress);
    assert.equal(empty.targetOwner, await signer.getAddress());
    assert.equal(empty.minterRole, true);
    assert.ok(diagnoseBridge(context, empty).some(f => f.code === 'BRIDGE_REGISTRATION_EMPTY'));
    await (await minter.getFunction('wrapOriginToken')(context.sourceEmitter, context.expectedWrappedToken)).wait();
    await provider.send('anvil_mine', ['0x80']);
    const registered = await live.bridge.snapshot(context, actualSource);
    assert.equal(registered.wrappedToken, context.expectedWrappedToken);
    // Ordinary Anvil cannot verify Creditcoin proofs. No mock native verifier is installed in this test.
    await assert.rejects(live.bridge.snapshot(context, actualSource, { ...proof, headerNumber: actualSource.block.number, txBytes: actualSource.encoded }), (e: unknown) => e instanceof NetworkFailure);
    const observedSourceAsDestination = await live.bridge.destination(sent.hash, context, actualSource);
    assert.equal(observedSourceAsDestination?.status, 1);
    assert.equal(observedSourceAsDestination?.finalized, true);
    assert.equal(observedSourceAsDestination?.snapshot, undefined, 'a source burn is not a minter execute transaction');
  } finally {
    provider.destroy();
    const stopped = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    if (child.exitCode === null) await stopped;
  }
});
