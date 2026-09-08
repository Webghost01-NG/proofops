export type Status = 'running' | 'ready' | 'waiting' | 'blocked' | 'failed' | 'incomplete' | 'interrupted';
export type Stage = 'configuration' | 'source' | 'attestation' | 'proof' | 'verification' | 'simulation' | 'destination';
export type Outcome = 'pass' | 'wait' | 'fail' | 'unavailable' | 'unknown';
export type EvidenceKind = 'observed' | 'simulated' | 'inferred';

export interface CallInput {
  to: string;
  from: string;
  data: string;
  value?: string;
  abi?: readonly (string | Record<string, unknown>)[];
}

export interface CaseInput {
  sourceTx: string;
  destinationTx?: string;
  call?: CallInput;
}

export interface Observation {
  stage: Stage;
  outcome: Outcome;
  kind: EvidenceKind;
  code: string;
  title: string;
  detail: string;
  at: string;
  evidence?: Record<string, unknown>;
}

export interface Attempt {
  id: string;
  caseId: string;
  startedAt: string;
  finishedAt: string | null;
  status: Status;
  observations: Observation[];
}

export interface CaseRecord {
  id: string;
  input: CaseInput;
  createdAt: string;
  updatedAt: string;
  sourceChainId: number;
  creditcoinChainId: number;
  sourceChainKey: number;
  attempts: Attempt[];
}

export interface NetworkConfig {
  sourceRpc?: string;
  creditcoinRpc: string;
  proofBuilder: string;
  sourceChainKey: number;
  sourceChainId: number;
  creditcoinChainId: number;
  timeoutMs: number;
  dataDir: string;
}

export interface ReadinessCheck {
  name: string;
  status: 'ready' | 'missing' | 'unavailable';
  detail: string;
}

export interface CaseBundle {
  format: 'proofops.case.v1';
  exportedAt: string;
  mode: 'current-state-check';
  expectation: 'proof-valid' | 'destination-call-succeeds';
  prerequisites: string[];
  record: CaseRecord;
}
