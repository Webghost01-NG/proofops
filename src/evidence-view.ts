import type { Attempt, Observation, Stage } from './types.js';

export const stageLabels: Record<Stage, string> = {
  configuration: 'Configuration', source: 'Source transaction', attestation: 'Attestation',
  proof: 'Proof generation', verification: 'Native verification', simulation: 'Application simulation', destination: 'Observed destination'
};
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function observationBlocks(o: Observation): { label: string; number: number; hash: string }[] {
  const e = o.evidence ?? {};
  const candidates = [
    ['Observation block', e.block], ['Source block', object(e.selection).block],
    ['Configuration block', object(e.snapshot).block], ['Destination block', object(e.destination).block]
  ] as const;
  const seen = new Set<string>();
  return candidates.flatMap(([label, value]) => {
    const b = object(value);
    if (!Number.isSafeInteger(b.number) || typeof b.hash !== 'string' || !/^0x[\da-f]{64}$/i.test(b.hash) || seen.has(`${b.number}:${b.hash}`)) return [];
    seen.add(`${b.number}:${b.hash}`);
    return [{ label, number: Number(b.number), hash: b.hash }];
  });
}
export function burnCandidates(attempt?: Attempt): { address: string; logIndex: number; receiptOffset: number }[] {
  const raw = attempt?.observations.find(o => Array.isArray(o.evidence?.candidates))?.evidence?.candidates;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(value => {
    const c = object(value);
    return typeof c.address === 'string' && Number.isSafeInteger(c.logIndex) && Number.isSafeInteger(c.receiptOffset)
      ? [{ address: c.address, logIndex: Number(c.logIndex), receiptOffset: Number(c.receiptOffset) }] : [];
  });
}
export function bridgeSummary(attempt?: Attempt): { label: string; value: string; outcome: string }[] {
  const observations = attempt?.observations ?? [];
  const has = (code: string) => observations.some(o => o.code === code);
  const proofInvalid = ['SOURCE_REORG', 'SOURCE_REVERTED', 'PROOF_SOURCE_MISMATCH', 'PROOF_REJECTED'].some(has);
  const call = [...observations].reverse().find(o => ['BRIDGE_CALL_SUCCEEDED', 'BRIDGE_CALL_REVERTED', 'BRIDGE_EMITTER_UNREGISTERED', 'BRIDGE_RETURN_UNEXPECTED'].includes(o.code));
  const stateChanged = observations.some(o => o.code === 'BRIDGE_STATE_CHANGED' && o.stage !== 'destination');
  const mint = [...observations].reverse().find(o => o.stage === 'destination');
  return [
    { label: 'Source proof', value: proofInvalid ? 'Invalidated or rejected' : has('PROOF_VERIFIED') ? 'Native verification passed' : 'Not verified', outcome: proofInvalid ? 'fail' : has('PROOF_VERIFIED') ? 'pass' : 'unknown' },
    { label: 'Current application call', value: stateChanged ? 'State changed; rerun required' : has('BRIDGE_QUERY_PROCESSED') ? 'Replay guard rejects this query' : has('BRIDGE_WRAPPED_TOKEN_MISMATCH') ? 'Configured token differs from expected token' : call?.code === 'BRIDGE_CALL_SUCCEEDED' ? 'Simulation passed; no transaction sent' : call?.outcome === 'fail' ? 'Simulation reverted' : 'Not established', outcome: stateChanged || has('BRIDGE_QUERY_PROCESSED') || has('BRIDGE_WRAPPED_TOKEN_MISMATCH') ? 'fail' : call?.outcome ?? 'unknown' },
    { label: 'Observed mint', value: mint?.code === 'BRIDGE_MINT_CONFIRMED' ? 'Confirmed in finalized receipt' : mint?.code === 'BRIDGE_DESTINATION_NOT_FINAL' ? 'Matching receipt awaits finality' : 'Not confirmed', outcome: mint?.outcome ?? 'unknown' }
  ];
}
