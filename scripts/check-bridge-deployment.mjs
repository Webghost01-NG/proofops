// Read-only phase-3 preflight. No keystore, signer, private key, or broadcast access.
// Build ProofOps first. Supply public deployment context, with an optional public wallet.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Interface, ZeroAddress, getAddress, toQuantity } from 'ethers';
import { loadConfig } from '../dist/config.js';
import { address, object } from '../dist/validation.js';
import { rpc } from '../dist/rpc.js';
import { checkIdentity } from '../dist/bridge/identity.js';
import { minterInterface, tokenInterface, ASC_MINTER, VERIFIER, PROFILE_REVISION } from '../dist/bridge/abi.js';

const args = parseArgs({ options: { bridge: { type: 'string' }, wallet: { type: 'string' }, amount: { type: 'string', default: '1000000000000000000' } } }).values;
if (!args.bridge) throw new Error('Usage: node scripts/check-bridge-deployment.mjs --bridge <public-context.json> [--wallet <public-address>] [--amount <raw-positive-integer>]');
const rawText = await readFile(args.bridge, 'utf8');
if (Buffer.byteLength(rawText) > 16384) throw new Error('Public deployment context exceeds 16 KiB.');
const raw = object(JSON.parse(rawText));
if (raw.id !== undefined && raw.id !== 'attestcoin-bridge-v1') throw new Error('Unsupported bridge profile.');
const context = Object.fromEntries(['sourceEmitter', 'minter', 'expectedWrappedToken'].map(key => {
  const value = address(raw[key], key);
  if (value === ZeroAddress) throw new Error('Deployment addresses must be nonzero.');
  return [key, value];
}));
const wallet = args.wallet ? getAddress(args.wallet) : undefined;
if (wallet === ZeroAddress || !/^[1-9]\d*$/.test(args.amount) || BigInt(args.amount) >= 2n ** 256n) throw new Error('Use a nonzero wallet and positive uint256 raw amount.');
try { process.loadEnvFile(); } catch (e) { if (e.code !== 'ENOENT') throw new Error('Local environment could not be read.'); }
const config = loadConfig();
const report = { observedAt: new Date().toISOString(), profileRevision: PROFILE_REVISION, context, wallet: wallet ?? null, plannedRawBurn: args.amount, observations: [], blockers: [] };
const observe = (name, data) => report.observations.push({ name, ...data });
const fail = reason => report.blockers.push(reason);
async function read(url, method, params) { return rpc(url, method, params, config.timeoutMs); }
function quantity(value) {
  if (typeof value !== 'string' || !/^0x[\da-f]+$/i.test(value)) throw new Error('Invalid quantity');
  return BigInt(value);
}
// The product RPC allowlist remains unchanged. Extra methods here are reads only.
async function fundingRead(url, method, params) {
  if (!['eth_getBalance', 'eth_gasPrice'].includes(method)) throw new Error('Read method required');
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(config.timeoutMs), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Funding read unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) { await reader.cancel(); throw new Error('Funding read unavailable'); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString();
  const data = JSON.parse(text);
  if (data.jsonrpc !== '2.0' || data.id !== 1 || data.error) throw new Error('Funding read unavailable');
  return quantity(data.result);
}
try {
  if (!config.sourceRpc || config.sourceChainId !== 11155111 || config.creditcoinChainId !== 102031 || config.sourceChainKey !== 1) throw new Error('Unsupported or missing source configuration');
  const urls = { source: config.sourceRpc, destination: config.creditcoinRpc };
  const blocks = {};
  for (const [side, url] of Object.entries(urls)) {
    const expected = side === 'source' ? 11155111n : 102031n;
    if (quantity(await read(url, 'eth_chainId', [])) !== expected) throw new Error('Wrong network');
    const raw = await read(url, 'eth_getBlockByNumber', ['finalized', false]);
    const number = Number(quantity(raw.number));
    if (!Number.isSafeInteger(number) || !/^0x[\da-f]{64}$/i.test(raw.hash)) throw new Error('Invalid block');
    blocks[side] = { number, hash: raw.hash };
    observe(side, { chainId: Number(expected), block: blocks[side] });
    if (wallet) {
      const balance = await fundingRead(url, 'eth_getBalance', [wallet, toQuantity(number)]);
      const gasPrice = await fundingRead(url, 'eth_gasPrice', []);
      observe(`${side} funding`, { block: blocks[side], balanceWei: balance.toString(), gasPriceWei: gasPrice.toString(), sufficiency: 'not-established-without-transaction-estimates' });
      if (balance === 0n) fail(`${side}: wallet has zero native gas balance at the observed block.`);
    }
  }
  let supported = true;
  for (const [role, address, side] of [['source', context.sourceEmitter, 'source'], ['minter', context.minter, 'destination'], ['wrapped', context.expectedWrappedToken, 'destination']]) {
    const code = await read(urls[side], 'eth_getCode', [address, toQuantity(blocks[side].number)]);
    const identity = checkIdentity(role, address, blocks[side], code);
    observe(`${role} identity`, identity);
    if (!identity.verified) { supported = false; fail(`${role}: executable code does not match the pinned profile.`); }
  }
  if (supported) {
    const call = async (side, to, iface, name, values) => iface.decodeFunctionResult(name, await read(urls[side], 'eth_call', [{ to, data: iface.encodeFunctionData(name, values) }, toQuantity(blocks[side].number)]))[0];
    const verifier = await call('destination', context.minter, minterInterface, 'VERIFIER', []);
    const mapping = await call('destination', context.minter, minterInterface, 'wrappedTokens', [context.sourceEmitter]);
    const owner = await call('destination', context.expectedWrappedToken, tokenInterface, 'owner', []);
    const minterRole = await call('destination', context.expectedWrappedToken, tokenInterface, 'hasRole', [ASC_MINTER, context.minter]);
    observe('bridge configuration', { block: blocks.destination, verifier, mapping, owner, minterRole });
    if (verifier.toLowerCase() !== VERIFIER.toLowerCase()) fail('Native verifier address differs from the pinned profile.');
    if (mapping !== ZeroAddress) fail('Emitter mapping must be empty for the planned unregistered-rejection scenario; this contract cannot overwrite it.');
    if (!minterRole) fail('Wrapped token does not grant the deployed minter its mint role.');
    if (wallet && owner.toLowerCase() !== wallet.toLowerCase()) fail('Selected wallet is not the wrapped-token owner required for later registration.');
    if (wallet) {
      const token = new Interface(['function balanceOf(address) view returns (uint256)']);
      const balance = await call('source', context.sourceEmitter, token, 'balanceOf', [wallet]);
      observe('source test tokens', { block: blocks.source, rawBalance: balance.toString(), plannedRawBurn: args.amount });
      if (balance < BigInt(args.amount)) fail('Source test-token balance is below the planned burn amount.');
    }
  }
  for (const [side, url] of Object.entries(urls)) {
    const current = await read(url, 'eth_getBlockByNumber', [toQuantity(blocks[side].number), false]);
    if (current?.hash?.toLowerCase() !== blocks[side].hash.toLowerCase()) fail(`${side}: observation block changed; rerun preflight.`);
  }
} catch { fail('A required read failed, returned unsupported data, or used the wrong network. No provider error text is exported.'); }
if (!wallet) fail('No public project wallet was supplied; native/token balances and registration-owner eligibility remain unverified.');
fail('Signer control must be confirmed externally; public addresses and keystore filenames do not prove signing access.');
fail('Live transaction gas estimates and funding headroom must be reviewed before writes.');
report.status = 'incomplete';
console.log(JSON.stringify(report, null, 2));
process.exitCode = 2;
