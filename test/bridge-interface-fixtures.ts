// Explicit synthetic presentation fixtures. Never loaded by the running product.
import type { Attempt, CaseRecord, Observation } from '../src/types.js';
import { correlateBridgeMint, diagnoseBridge, selectBurn } from '../src/bridge/adapter.js';
import { minterInterface } from '../src/bridge/abi.js';
import { block, burn, destination, hash, input, snapshot, source } from './bridge-fixtures.js';
const at = '2026-09-09T00:00:00.000Z';
const observed = (o: Omit<Observation, 'at'>): Observation => ({ ...o, at });
const proof: Observation = { stage: 'verification', kind: 'simulated', outcome: 'pass', code: 'PROOF_VERIFIED', title: 'Native verifier accepted the proof', detail: 'Synthetic presentation fixture only.', at, evidence: { block } };
export function interfaceRecord(mode: 'selection' | 'mint' = 'selection'): CaseRecord {
  const selected = selectBurn(source, input).selection!;
  const candidates = selectBurn({ ...source, receipt: { ...source.receipt, logs: [burn, { ...burn, index: 13 }] } }, input).findings;
  const mint = observed(correlateBridgeMint(input, selected, source, destination()));
  const successful = [proof, ...selectBurn(source, input).findings.map(observed), ...diagnoseBridge(input, snapshot(), { block, result: minterInterface.encodeFunctionResult('execute', [true]) }).map(observed), mint];
  const replay = [proof, ...selectBurn(source, input).findings.map(observed), ...diagnoseBridge(input, { ...snapshot(), processed: true }, { block, revert: minterInterface.encodeErrorResult('Error', ['Query already processed']) }).map(observed), mint];
  const id = '11111111-2222-4333-8444-555555555555';
  const attempt = (observations: Observation[], index: number): Attempt => ({ id: String(index), caseId: id, startedAt: at, finishedAt: at, status: observations.some(o => o.outcome === 'fail') ? 'failed' : 'ready', observations });
  return { id, sourceChainId: 11155111, creditcoinChainId: 102031, sourceChainKey: 1, input: { sourceTx: hash, bridge: input }, createdAt: at, updatedAt: at, attempts: mode === 'selection' ? [attempt([proof, ...candidates.map(observed)], 1)] : [attempt(successful, 1), attempt(replay, 2)] };
}
