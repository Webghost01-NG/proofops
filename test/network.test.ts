import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { JsonRpcProvider } from 'ethers';
import { loadConfig } from '../src/config.js';
import { LiveNetwork, NetworkFailure } from '../src/network.js';

const hasAnvil = spawnSync('anvil', ['--version'], { stdio: 'ignore' }).status === 0;

test('real local EVM receipts encode through the SDK; altered signed fields are rejected', { skip: !hasAnvil, timeout: 20000 }, async () => {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  // Only the disposable local EVM signs or mines in this test. Native Creditcoin verification is not emulated.
  const child = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--silent'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(url, 31337, { staticNetwork: true });
  let altered = false;
  const proxy = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = Buffer.concat(chunks).toString();
      const reply = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
      const json = await reply.json() as { result: Record<string, unknown> };
      if (altered && JSON.parse(payload).method === 'eth_getTransactionByHash') json.result.value = '0x777';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(json));
    } catch { res.writeHead(502); res.end(); }
  });
  try {
    let available = false;
    for (let i = 0; i < 50; i++) {
      try {
        const response = await fetch(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(200) });
        available = response.ok;
      } catch { /* Wait for the isolated local node to start. */ }
      if (available) break;
      await setTimeout(100);
    }
    assert.equal(available, true, 'local Anvil node started');
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    const network = new LiveNetwork(loadConfig({ SOURCE_CHAIN_RPC_URL: proxyUrl, SOURCE_CHAIN_ID: '31337', CREDITCOIN_RPC_URL: url, CREDITCOIN_CHAIN_ID: '31337' }));
    const signer = await provider.getSigner(0);
    const from = await signer.getAddress();
    for (const type of [0, 2]) {
      const transaction = await signer.sendTransaction({ to: from, value: 1n, type });
      const receipt = await transaction.wait();
      const evidence = await network.source(transaction.hash);
      assert.equal(evidence?.status, 1);
      assert.equal(evidence?.block.hash, receipt?.blockHash);
      assert.equal(evidence?.transaction.hash, transaction.hash);
      assert.ok(evidence!.encoded.length > 100);
      assert.equal(await network.canonical(evidence!.block), true);
      altered = true;
      await assert.rejects(network.source(transaction.hash), (error: unknown) => error instanceof NetworkFailure && error.kind === 'malformed');
      altered = false;
    }
    // Deploy a tiny contract that always reverts, to exercise eth_call against real EVM execution.
    const deployment = await signer.sendTransaction({ data: '0x6005600c60003960056000f360006000fd' });
    const receipt = await deployment.wait();
    await provider.send('anvil_mine', ['0x80']);
    const simulation = await network.simulate({ to: receipt!.contractAddress!, from, data: '0x' });
    assert.equal(simulation.revert, '0x');
    assert.ok(simulation.block.hash);
    const observed = await network.destination(deployment.hash);
    assert.equal(observed?.status, 1);
  } finally {
    provider.destroy();
    if (proxy.listening) await new Promise<void>(resolve => proxy.close(() => resolve()));
    const stopped = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    if (child.exitCode === null) await stopped;
  }
});
