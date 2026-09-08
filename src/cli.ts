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
import type { CaseRecord } from './types.js';

const help = `ProofOps — Attestcoin diagnostics, backed by evidence

Usage: proofops <command> [options]

  doctor                         Check configured networks and proof service
  inspect --source-tx <hash>      Inspect and persist a source transaction
          [--call <file.json>]    Add exact destination call inputs
          [--destination-tx <h>]  Attach an observed destination receipt
  list                           List saved cases
  show <case-id>                  Explain the latest attempt
  rerun <case-id>                 Append a fresh inspection attempt
  export <case-id> --out <file>   Export evidence and a current-state expectation
  check <bundle.json>             Evaluate a bundle against current state
  dashboard [--port 4318]         Open the local dashboard server

Add --json for machine-readable output. Configuration loads from local .env.
No wallet key is required. No commands sign or broadcast transactions.
Exit codes: 0 ready/pass, 1 failed, 2 blocked/waiting/inconclusive, 64 invalid input.
`;

async function readJson(path: string): Promise<unknown> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { throw new InputError('Input file could not be read.'); }
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new InputError('Input file exceeds 16 MiB.');
  try { return JSON.parse(text); } catch { throw new InputError('Input file is not valid JSON.'); }
}

function explain(record: CaseRecord) {
  const attempt = record.attempts.at(-1);
  console.log(`\nCase ${record.id}\nSource ${record.input.sourceTx}\nStatus: ${attempt?.status ?? 'not run'}\n`);
  for (const o of attempt?.observations ?? []) {
    console.log(`[${o.outcome.toUpperCase()}] ${o.title}\n  ${o.detail}`);
    const decoded = o.evidence?.decodedError as { name: string; args: string[] } | undefined;
    if (decoded) console.log(`  Decoded: ${decoded.name}(${decoded.args.join(', ')})`);
  }
  console.log('\nNo transaction was signed or broadcast.');
}

async function main() {
  const args = parseArgs({ allowPositionals: true, options: {
    'source-tx': { type: 'string' }, 'destination-tx': { type: 'string' }, call: { type: 'string' },
    out: { type: 'string' }, port: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
  } });
  const [command, identifier] = args.positionals;
  if (!command || args.values.help || command === 'help') { console.log(help); return; }
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
        const input = caseInput({ sourceTx: args.values['source-tx'], destinationTx: args.values['destination-tx'], ...(args.values.call ? { call: await readJson(args.values.call) } : {}) });
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
      if (args.values.json) console.log(json(record)); else explain(record);
      const status = record.attempts.at(-1)?.status;
      process.exitCode = status === 'ready' ? 0 : status === 'failed' ? 1 : 2;
    }
  } finally { if (!serving) { store.interruptOwn(); store.close(); } }
}

main().catch(error => {
  console.error(publicError(error));
  process.exitCode = error instanceof InputError || (error as { code?: string })?.code?.startsWith('ERR_PARSE_ARGS') ? 64 : 1;
});
