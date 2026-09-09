#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { LiveNetwork } from './network.js';
import { checkExpectation, inspectCase } from './engine.js';
import { exportBundle, readBundle } from './bundle.js';
import { caseInput, InputError, json, publicError } from './validation.js';
import { makeServer } from './server.js';
import { bridgeSummary, burnCandidates, observationBlocks, stageLabels } from './evidence-view.js';
import type { CaseRecord } from './types.js';

const help = `ProofOps — Attestcoin diagnostics, backed by evidence

Usage: proofops <command> [options]

  doctor                         Check configured networks and proof service
  inspect --source-tx <hash>      Inspect and persist a source transaction
          [--bridge <file.json>]  Decode a pinned bridge burn and derive its call
          [--source-log-index <n>] Confirm the first burn (requires --bridge)
          [--call <file.json>]    Add exact destination call inputs
          [--destination-tx <h>]  Attach an observed destination receipt
  list                           List saved cases
  show <case-id> [--attempt <n>]  Explain latest or a numbered attempt (1-based)
  rerun <case-id>                 Append a fresh inspection attempt
  export <case-id> --out <file>   Export evidence and a current-state expectation
  check <bundle.json>             Evaluate a bundle against current state
  dashboard [--port 4318]         Open the local dashboard server

Add --json for machine-readable output. Configuration loads from local .env.
No wallet key is required. No commands sign or broadcast transactions.
Bridge JSON: id, sourceEmitter, minter, expectedWrappedToken, caller; optional sourceLogIndex.
Use a new inspect for changed inputs; rerun preserves inputs and appends evidence.
Exit codes: 0 ready/pass, 1 failed, 2 blocked/waiting/inconclusive, 64 invalid input.
`;

async function readJson(path: string): Promise<unknown> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { throw new InputError('Input file could not be read.'); }
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new InputError('Input file exceeds 16 MiB.');
  try { return JSON.parse(text); } catch { throw new InputError('Input file is not valid JSON.'); }
}

function explain(record: CaseRecord, index?: number) {
  const attempt = index === undefined ? record.attempts.at(-1) : record.attempts[index];
  console.log(`\nCase ${record.id}\nSource ${record.input.sourceTx}\nStatus: ${attempt?.status ?? 'not run'}\n`);
  if (record.input.bridge) {
    console.log(`Bridge context: ${json(record.input.bridge)}\n`);
    for (const item of bridgeSummary(attempt)) console.log(`${item.label}: ${item.value}`);
    const selection = attempt?.observations.find(o => o.code === 'BRIDGE_BURN_SELECTED')?.evidence?.selection as { recipient: string; amount: string; logIndex: number } | undefined;
    if (selection) console.log(`Selected burn: global log ${selection.logIndex}, recipient ${selection.recipient}, raw amount ${selection.amount}`);
    const snapshot = attempt?.observations.find(o => o.evidence?.snapshot)?.evidence?.snapshot as { targetOwner?: string; wrappedToken?: string; minterRole?: boolean } | undefined;
    if (snapshot?.wrappedToken) console.log(`Observed mapping: ${snapshot.wrappedToken}; target owner: ${snapshot.targetOwner}; minter role: ${snapshot.minterRole}`);
    console.log('Use --json or export for complete proof, generated calldata, and runtime identity evidence.');
    for (const [i, candidate] of burnCandidates(attempt).entries()) console.log(`Burn candidate: global log ${candidate.logIndex}, receipt offset ${candidate.receiptOffset}, emitter ${candidate.address}${i === 0 ? ' (first match)' : ' (not executable)'} `);
    if (attempt?.observations.some(o => o.code === 'BRIDGE_LOG_SELECTION_REQUIRED')) console.log('Confirm the first global log index with inspect --source-tx <same hash> --bridge <same file> --source-log-index <index>. This saves a new case.');
  }
  for (const o of attempt?.observations ?? []) {
    console.log(`[${stageLabels[o.stage]} / ${o.kind} / ${o.outcome.toUpperCase()}] ${o.title}\n  ${o.detail}`);
    for (const b of observationBlocks(o)) console.log(`  ${b.label}: ${b.number} (${b.hash})`);
    const decoded = o.evidence?.decodedError as { name: string; args: string[] } | undefined;
    if (decoded) console.log(`  Decoded: ${decoded.name}(${decoded.args.join(', ')})`);
  }
  console.log('\nNo transaction was signed or broadcast.');
}

async function main() {
  const args = parseArgs({ allowPositionals: true, options: {
    'source-tx': { type: 'string' }, 'destination-tx': { type: 'string' }, call: { type: 'string' }, bridge: { type: 'string' },
    'source-log-index': { type: 'string' }, attempt: { type: 'string' },
    out: { type: 'string' }, port: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
  } });
  const [command, identifier] = args.positionals;
  if (!command || args.values.help || command === 'help') { console.log(help); return; }
  if (['source-tx', 'destination-tx', 'call', 'bridge', 'source-log-index'].some(key => args.values[key as keyof typeof args.values] !== undefined) && command !== 'inspect') throw new InputError('Inspection input options are only accepted by inspect; rerun keeps saved inputs.');
  if (args.values['source-log-index'] !== undefined && !args.values.bridge) throw new InputError('--source-log-index requires --bridge.');
  if (args.values.attempt !== undefined && (command !== 'show' || !/^[1-9]\d*$/.test(args.values.attempt) || !Number.isSafeInteger(Number(args.values.attempt)))) throw new InputError('--attempt requires show and a positive integer.');
  try { process.loadEnvFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new InputError('Local .env could not be read.'); }
  const config = loadConfig();
  if (command === 'doctor') {
    const checks = await new LiveNetwork(config).doctor();
    console.log(args.values.json ? json(checks) : checks.map(c => `[${c.status.toUpperCase()}] ${c.name}: ${c.detail}`).join('\n'));
    process.exitCode = checks.every(c => c.status === 'ready') ? 0 : 2;
    return;
  }
  const store = new Store(config.dataDir);
  let serving = false;
  try {
    let record: CaseRecord | undefined;
    switch (command) {
      case 'dashboard': {
        const port = Number(args.values.port ?? 4318);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new InputError('Port must be an integer between 0 and 65535.');
        const { server, drain } = makeServer(config, store);
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
        serving = true;
        console.log(`ProofOps is running at http://127.0.0.1:${(server.address() as { port: number }).port}\nLocal, read-only diagnostics. Press Ctrl+C to stop.`);
        let closing = false;
        const close = async () => {
          if (closing) return;
          closing = true;
          server.close();
          await drain();
          store.interruptOwn();
          store.close();
        };
        process.once('SIGINT', close);
        process.once('SIGTERM', close);
        break;
      }
      case 'inspect': {
        let bridge = args.values.bridge ? await readJson(args.values.bridge) : undefined;
        if (args.values['source-log-index'] !== undefined) {
          const index = args.values['source-log-index'];
          if (!/^\d+$/.test(index) || !Number.isSafeInteger(Number(index))) throw new InputError('Source log index must be a non-negative safe integer.');
          if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge)) throw new InputError('Bridge input must be a JSON object.');
          bridge = { ...bridge, sourceLogIndex: Number(index) };
        }
        const input = caseInput({ ...(bridge !== undefined ? { bridge } : {}), sourceTx: args.values['source-tx'], destinationTx: args.values['destination-tx'], ...(args.values.call ? { call: await readJson(args.values.call) } : {}) });
        record = await inspectCase(store, store.create(input, config).id, config);
        break;
      }
      case 'list': {
        const cases = store.list();
        console.log(args.values.json ? json(cases) : cases.length ? cases.map(c => `${c.id}  ${c.attempts.at(-1)?.status ?? 'new'}  ${c.input.sourceTx}`).join('\n') : 'No saved cases. Start with: proofops inspect --source-tx <hash>');
        break;
      }
      case 'show':
        if (!identifier) throw new InputError('Provide a case ID.');
        record = store.get(identifier);
        if (args.values.attempt && Number(args.values.attempt) > record.attempts.length) throw new InputError('Attempt does not exist in this case.');
        break;
      case 'rerun':
        if (!identifier) throw new InputError('Provide a case ID.');
        record = await inspectCase(store, identifier, config);
        break;
      case 'export':
        if (!identifier || !args.values.out) throw new InputError('Provide a case ID and --out <file>.');
        try { await writeFile(args.values.out, json(exportBundle(store.get(identifier))) + '\n', { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (error instanceof InputError) throw error; throw new InputError('Export could not be written. Choose a new path; existing files are not overwritten.'); }
        console.log(args.values.json ? json({ exported: true }) : 'Evidence bundle exported. Its check runs against current state.');
        break;
      case 'check': {
        if (!identifier) throw new InputError('Provide a bundle JSON path.');
        const bundle = readBundle(await readJson(identifier));
        if (bundle.sourceChainId !== config.sourceChainId || bundle.creditcoinChainId !== config.creditcoinChainId || bundle.sourceChainKey !== config.sourceChainKey) throw new InputError('Bundle network identifiers do not match local configuration.');
        record = await inspectCase(store, store.create(bundle.input, config).id, config);
        const result = checkExpectation(record.attempts.at(-1)!, bundle.expectation);
        console.log(args.values.json ? json({ result, expectation: bundle.expectation, mode: 'current-state-check', record }) : `Check: ${result}\nExpectation: ${bundle.expectation}\nState: current finalized state\nCase: ${record.id}`);
        process.exitCode = result === 'pass' ? 0 : result === 'fail' ? 1 : 2;
        record = undefined;
        break;
      }
      default: throw new InputError(`Unknown command. Run proofops --help.`);
    }
    if (record) {
      const index = args.values.attempt ? Number(args.values.attempt) - 1 : undefined;
      const attempt = index === undefined ? record.attempts.at(-1) : record.attempts[index];
      if (args.values.json) console.log(json(index === undefined ? record : { record, selectedAttempt: attempt })); else explain(record, index);
      const bridgeResult = record.input.bridge && attempt ? checkExpectation(attempt, 'destination-call-succeeds') : undefined;
      process.exitCode = bridgeResult ? bridgeResult === 'pass' ? 0 : bridgeResult === 'fail' ? 1 : 2 : attempt?.status === 'ready' ? 0 : attempt?.status === 'failed' ? 1 : 2;
    }
  } finally { if (!serving) { store.interruptOwn(); store.close(); } }
}

main().catch(error => {
  console.error(publicError(error));
  process.exitCode = error instanceof InputError || (error as { code?: string })?.code?.startsWith('ERR_PARSE_ARGS') ? 64 : 1;
});
