import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { NetworkFailure, rpc } from '../src/network.js';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: Server) { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

test('loopback API persists a blocked case and protects request boundaries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'proofops-api-'));
  const config = loadConfig({ PROOFOPS_DATA_DIR: directory, SOURCE_CHAIN_RPC_URL: '' });
  const store = new Store(directory);
  const { server, drain } = makeServer(config, store);
  const url = await listen(server);
  try {
    const initial = await fetch(`${url}/api/cases`);
    assert.deepEqual(await initial.json(), []);
    const payload = JSON.stringify({ sourceTx: `0x${'99'.repeat(32)}` });
    const send = (headers: Record<string, string>, body = payload) => fetch(`${url}/api/cases`, { method: 'POST', headers, body });
    assert.equal((await send({ 'content-type': 'text/plain' })).status, 400);
    assert.equal((await send({ 'content-type': 'application/json', origin: 'https://untrusted.example' })).status, 403);
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(`${url}/api/config`, { headers: { host: 'rebound.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await send({ 'content-type': 'application/json' }, '{')).status, 400);
    assert.equal((await send({ 'content-type': 'application/json' }, JSON.stringify({ sourceTx: 'invalid' }))).status, 400);
    assert.equal((await send({ 'content-type': 'application/json' }, JSON.stringify({ a: 'x'.repeat(530000) }))).status, 400);
    const created = await send({ 'content-type': 'application/json', origin: url });
    assert.equal(created.status, 202);
    const record = await created.json() as { id: string };
    await drain();
    const saved = store.get(record.id);
    assert.equal(saved.attempts[0].status, 'blocked');
    const rerun = await fetch(`${url}/api/cases/${record.id}/rerun`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(rerun.status, 202);
    await drain();
    assert.equal(store.get(record.id).attempts.length, 2);
    const exported = await fetch(`${url}/api/cases/${record.id}/export`);
    assert.ok(exported.headers.get('content-disposition')?.includes(record.id));
    assert.equal((await exported.json() as { mode: string }).mode, 'current-state-check');
    assert.equal((await fetch(`${url}/api/unknown`)).status, 404);
    assert.equal((await fetch(`${url}/.env`)).status, 404);
  } finally { await close(server); await drain(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('RPC client refuses signing methods and separates execution reverts from transport errors', async () => {
  let mode = 'ok';
  const server = createServer(async (_req, res) => {
    if (mode === 'http') { res.writeHead(503); res.end('unavailable'); return; }
    if (mode === 'invalid') { res.end('not JSON'); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(mode === 'revert' ? { jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted https://secret-provider/KEY', data: '0x12345678' } } : mode === 'wrong-id' ? { jsonrpc: '2.0', id: 9, result: '0x1' } : { jsonrpc: '2.0', id: 1, result: '0x1' }));
  });
  const url = await listen(server);
  try {
    assert.equal(await rpc(url, 'eth_chainId', [], 2000), '0x1');
    await assert.rejects(rpc(url, 'eth_sendRawTransaction', [], 2000), NetworkFailure);
    mode = 'revert';
    await assert.rejects(rpc(url, 'eth_call', [], 2000), (e: unknown) => e instanceof NetworkFailure && e.kind === 'revert' && e.data === '0x12345678' && !e.message.includes('KEY'));
    mode = 'http';
    await assert.rejects(rpc(url, 'eth_call', [], 2000), (e: unknown) => e instanceof NetworkFailure && e.kind === 'transport');
    mode = 'invalid';
    await assert.rejects(rpc(url, 'eth_chainId', [], 2000), (e: unknown) => e instanceof NetworkFailure && e.kind === 'malformed');
    mode = 'wrong-id';
    await assert.rejects(rpc(url, 'eth_chainId', [], 2000), (e: unknown) => e instanceof NetworkFailure && e.kind === 'malformed');
  } finally { await close(server); }
});
