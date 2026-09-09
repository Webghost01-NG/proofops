import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeSummary, burnCandidates, observationBlocks } from '../src/evidence-view.js';
import { interfaceRecord } from './bridge-interface-fixtures.js';
import { hash, input } from './bridge-fixtures.js';
import { Store } from '../src/store.js';
import { loadConfig } from '../src/config.js';

// Each command runs in its own process and isolated directory, with no source RPC.
test('CLI bridge context validates, persists across processes, reruns, exports v2, and checks inconclusively', () => {
  const directory = mkdtempSync(join(tmpdir(), 'proofops-cli-bridge-'));
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8', timeout: 10000, env: { ...process.env, SOURCE_CHAIN_RPC_URL: '', PROOFOPS_DATA_DIR: directory } });
  try {
    writeFileSync(join(directory, 'bridge.json'), JSON.stringify(input));
    const invalid = run('inspect', '--source-tx', hash, '--source-log-index', '12');
    assert.equal(invalid.status, 64);
    for (const index of ['-1', '1.5', '9007199254740992']) assert.equal(run('inspect', '--source-tx', hash, '--bridge', 'bridge.json', '--source-log-index', index).status, 64);
    const first = run('inspect', '--source-tx', hash, '--bridge', 'bridge.json', '--source-log-index', '12', '--json');
    assert.equal(first.status, 2, first.stderr);
    const record = JSON.parse(first.stdout);
    assert.equal(record.input.bridge.sourceLogIndex, 12);
    assert.equal(record.attempts[0].observations[0].code, 'SOURCE_RPC_MISSING');
    const rerun = run('rerun', record.id, '--json');
    assert.equal(JSON.parse(rerun.stdout).attempts.length, 2);
    assert.equal(run('rerun', record.id, '--bridge', 'bridge.json').status, 64);
    assert.equal(run('rerun', record.id, '--destination-tx', hash).status, 64);
    assert.equal(JSON.parse(run('show', record.id, '--attempt', '1', '--json').stdout).selectedAttempt.id, record.attempts[0].id);
    const shown = run('show', record.id, '--attempt', '1');
    assert.match(shown.stdout, /Source proof: Not verified/);
    assert.match(shown.stdout, /Observed mint: Not confirmed/);
    assert.equal(run('show', record.id, '--attempt', '3').status, 64);
    assert.equal(run('export', record.id, '--out', 'case.json').status, 0);
    const bundle = JSON.parse(readFileSync(join(directory, 'case.json'), 'utf8'));
    assert.equal(bundle.format, 'proofops.case.v2');
    assert.equal(bundle.record.input.bridge.sourceLogIndex, 12);
    const checked = run('check', 'case.json', '--json');
    assert.equal(checked.status, 2);
    assert.equal(JSON.parse(checked.stdout).result, 'inconclusive');
    writeFileSync(join(directory, 'bridge.json'), JSON.stringify({ ...input, id: 'unsupported' }));
    assert.equal(run('inspect', '--source-tx', hash, '--bridge', 'bridge.json').status, 64);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('presentation distinguishes replay, prior mint, source reorg, and first-event ambiguity', () => {
  const record = interfaceRecord('mint');
  assert.match(bridgeSummary(record.attempts[0])[1].value, /Simulation passed/);
  assert.match(bridgeSummary(record.attempts[1])[1].value, /Replay guard/);
  assert.match(bridgeSummary(record.attempts[1])[2].value, /Confirmed/);
  const reorg = structuredClone(record.attempts[1]);
  reorg.observations.push({ stage: 'source', kind: 'observed', code: 'SOURCE_REORG', outcome: 'fail', title: '', detail: '', at: '' });
  assert.equal(bridgeSummary(reorg)[0].outcome, 'fail');
  assert.deepEqual(burnCandidates(interfaceRecord().attempts[0]).map(c => c.logIndex), [12, 13]);
  assert.equal(observationBlocks(record.attempts[0].observations[0])[0].number, 100);
});

test('CLI ambiguous bridge is inconclusive even when its proof status is ready', () => {
  const directory = mkdtempSync(join(tmpdir(), 'proofops-cli-selection-'));
  const store = new Store(directory);
  try {
    const fixture = interfaceRecord();
    const record = store.create(fixture.input, loadConfig({ PROOFOPS_DATA_DIR: directory }));
    const attempt = store.start(record.id);
    fixture.attempts[0].observations.forEach(o => store.observe(attempt, o));
    store.finish(attempt, 'ready');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'show', record.id], { cwd: directory, encoding: 'utf8', env: { ...process.env, SOURCE_CHAIN_RPC_URL: '', PROOFOPS_DATA_DIR: directory } });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /global log 12/);
    assert.match(result.stdout, /receipt offset 0/);
    assert.match(result.stdout, /--source-log-index/);
    assert.match(result.stdout, /Observation block: 100/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
