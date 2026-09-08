import type { CaseBundle, CaseRecord } from './types.js';
import { caseInput, InputError, object } from './validation.js';

export function exportBundle(record: CaseRecord): CaseBundle {
  return {
    format: 'proofops.case.v1', exportedAt: new Date().toISOString(), mode: 'current-state-check',
    expectation: record.input.call ? 'destination-call-succeeds' : 'proof-valid',
    prerequisites: [
      'Run: node dist/cli.js check <path-to-this-bundle.json> from the ProofOps project.',
      'Configure your own source RPC and compatible Creditcoin / proof endpoints locally.',
      'This check fetches fresh evidence and simulates at current finalized state; it is not historical replay.',
      'A full destination integration check requires intended calldata and application-specific outcome assertions.'
    ], record
  };
}

export function readBundle(value: unknown) {
  const raw = object(value);
  if (raw.format !== 'proofops.case.v1' || raw.mode !== 'current-state-check' || !['proof-valid', 'destination-call-succeeds'].includes(String(raw.expectation))) {
    throw new InputError('Unsupported case bundle. Expected proofops.case.v1 in current-state-check mode.');
  }
  const record = object(raw.record);
  for (const field of ['sourceChainId', 'creditcoinChainId', 'sourceChainKey']) {
    if (!Number.isSafeInteger(record[field]) || Number(record[field]) < 1) throw new InputError('Bundle has invalid network identifiers.');
  }
  const input = caseInput(record.input);
  if (raw.expectation === 'destination-call-succeeds' && !input.call) throw new InputError('Destination expectation requires explicit call inputs.');
  return {
    input, sourceChainId: Number(record.sourceChainId), creditcoinChainId: Number(record.creditcoinChainId), sourceChainKey: Number(record.sourceChainKey),
    expectation: raw.expectation as CaseBundle['expectation']
  };
}
