import type { BlockRef, Proof, SourceEvidence } from '../network.js';
import type { BridgeInputV1, CallInput, Observation } from '../types.js';

export type Finding = Omit<Observation, 'at'>;
export type ProofPayload = Pick<Proof, 'chainKey' | 'headerNumber' | 'txBytes' | 'merkleProof' | 'continuityProof'> & { txIndex?: number };
export interface BurnSelection {
  sourceHash: string;
  block: BlockRef;
  transactionIndex: number;
  logIndex: number;
  receiptOffset: number;
  emitter: string;
  recipient: string;
  amount: string;
  topics: string[];
  data: string;
  encodingHash: string;
}
export interface IdentityCheck {
  role: 'source' | 'minter' | 'wrapped';
  address: string;
  block: BlockRef;
  verified: boolean;
  observedCodeHash: string;
  expectedCodeHash: string;
  observedExecutableHash: string | null;
  expectedExecutableHash: string;
  artifactSha256: string;
}
export interface BridgeSnapshot {
  block: BlockRef;
  identities: IdentityCheck[];
  verifier?: string;
  wrappedToken?: string;
  targetOwner?: string;
  minterRole?: boolean;
  transactionIndex?: number;
  queryId?: string;
  processed?: boolean;
}
export interface BridgeSimulation {
  block: BlockRef;
  result?: string;
  revert?: string;
}
export interface DestinationEvidence {
  hash: string;
  block: BlockRef;
  finalized: boolean;
  status: number;
  to: string | null;
  from: string;
  data: string;
  value: string;
  logs: { address: string; topics: string[]; data: string; index: number }[];
  snapshot?: BridgeSnapshot;
  submittedProof?: ProofPayload;
}
export interface BridgeNetworkPort {
  snapshot(input: BridgeInputV1, source: SourceEvidence, proof?: ProofPayload, block?: BlockRef): Promise<BridgeSnapshot>;
  simulate(call: CallInput, block: BlockRef): Promise<BridgeSimulation>;
  destination(hash: string, input: BridgeInputV1, source: SourceEvidence): Promise<DestinationEvidence | null>;
  canonical(block: BlockRef): Promise<boolean>;
}
