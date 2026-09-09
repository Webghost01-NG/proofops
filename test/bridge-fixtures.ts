// Explicit synthetic unit fixtures. These are never loaded by the application.
import { getAddress, toBeHex, zeroPadValue, ZeroAddress } from 'ethers';
import { BURN_TOPIC, minterInterface, tokenInterface, VERIFIER } from '../src/bridge/abi.js';
import { buildBridgeCall, queryId } from '../src/bridge/adapter.js';
import { checkIdentity, referenceRuntime } from '../src/bridge/identity.js';
import type { BridgeInputV1 } from '../src/types.js';
import type { Proof, SourceEvidence } from '../src/network.js';
import type { BridgeSnapshot, DestinationEvidence } from '../src/bridge/types.js';

export const hash = `0x${'11'.repeat(32)}`;
export const block = { number: 100, hash: `0x${'22'.repeat(32)}` };
export const address = (byte: string) => getAddress(`0x${byte.repeat(20)}`);
export const input: BridgeInputV1 = { id: 'attestcoin-bridge-v1', sourceEmitter: address('33'), minter: address('44'), expectedWrappedToken: address('55'), caller: address('66') };
export const recipient = address('77');
export const burn = { address: input.sourceEmitter, index: 12, topics: [BURN_TOPIC, zeroPadValue(recipient, 32)], data: toBeHex(100n, 32) };
export const source: SourceEvidence = { hash, block: { ...block, number: 25 }, status: 1, encoded: '0x1234', transaction: { hash, index: 2, type: 2, from: input.caller }, receipt: { status: 1, index: 2, logs: [burn] } };
export const proof: Proof = { chainKey: 1, headerNumber: 25, txIndex: 2, txHash: hash, txBytes: source.encoded, merkleProof: { root: block.hash, siblings: [{ hash, isLeft: true }] }, continuityProof: { lowerEndpointDigest: block.hash, roots: [hash] }, cached: false, generatedAt: new Date(0) };
export function snapshot(): BridgeSnapshot {
  return { block, identities: [
    checkIdentity('source', input.sourceEmitter, source.block, referenceRuntime('source')),
    checkIdentity('minter', input.minter, block, referenceRuntime('minter')),
    checkIdentity('wrapped', input.expectedWrappedToken, block, referenceRuntime('wrapped'))
  ], verifier: VERIFIER, wrappedToken: input.expectedWrappedToken, targetOwner: input.caller, minterRole: true, transactionIndex: 2, queryId: queryId(1, 25, 2), processed: false };
}
export function destination(): DestinationEvidence {
  const mint = minterInterface.encodeEventLog(minterInterface.getEvent('TokensMinted')!, [input.expectedWrappedToken, recipient, 100n, queryId(1, 25, 2)]);
  const transfer = tokenInterface.encodeEventLog(tokenInterface.getEvent('Transfer')!, [ZeroAddress, recipient, 100n]);
  return { hash, block, finalized: true, status: 1, to: input.minter, from: address('88'), data: buildBridgeCall(proof, input).data, value: '0', logs: [
    { address: input.expectedWrappedToken, ...transfer, index: 0 },
    { address: input.minter, ...mint, index: 1 }
  ], submittedProof: structuredClone(proof), snapshot: snapshot() };
}
