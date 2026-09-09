import type { CaseRecord, NetworkConfig } from '../types.js';
import type { NetworkPort, Proof, SourceEvidence } from '../network.js';
import { NetworkFailure } from '../rpc.js';
import { InputError } from '../validation.js';
import { buildBridgeCall, correlateBridgeMint, diagnoseBridge, finding, selectBurn } from './adapter.js';
import { identityVerified } from './identity.js';
import { VERIFIER } from './abi.js';
import type { Finding } from './types.js';

export async function inspectBridge(record: CaseRecord, config: NetworkConfig, network: NetworkPort, source: SourceEvidence | undefined, proof: Proof | undefined, observe: (finding: Finding) => void): Promise<void> {
  const input = record.input.bridge!;
  if (config.sourceChainId !== 11155111 || config.creditcoinChainId !== 102031 || config.sourceChainKey !== 1) {
    observe(finding('BRIDGE_NETWORK_UNSUPPORTED', 'unknown', 'Bridge network profile is unsupported', 'This adapter profile supports Sepolia (11155111, key 1) and Creditcoin testnet (102031).', undefined, 'configuration'));
    return;
  }
  if (!source) {
    observe(finding('BRIDGE_SOURCE_NEEDED', 'unknown', 'Bridge source evidence is not available', 'Collect a successful, canonical source receipt before interpreting its bridge event.', undefined, 'source'));
    return;
  }
  const selected = selectBurn(source, input);
  selected.findings.forEach(observe);
  if (!selected.selection) return;
  const selection = selected.selection;
  const bridge = network.bridge;
  if (!bridge) {
    observe(finding('BRIDGE_NETWORK_UNAVAILABLE', 'unavailable', 'Bridge network reads are unavailable', 'This network adapter does not provide bridge observations.'));
    return;
  }
  const unavailable = (error: unknown, stage: Finding['stage']) => observe(finding(error instanceof NetworkFailure && error.kind === 'wrong-network' ? 'WRONG_NETWORK' : 'BRIDGE_CHECK_UNAVAILABLE', 'unavailable', 'Bridge check could not complete', error instanceof InputError ? error.message : 'A bounded provider read failed or returned unsupported data. No bridge execution outcome is inferred.', undefined, stage));
  let callConflict = false;
  try {
    // Dynamic calldata conflicts can be checked only after the matching proof exists.
    const call = proof ? buildBridgeCall(proof, input, record.input.call) : undefined;
    const snapshot = await bridge.snapshot(input, source, proof);
    const configurationFindings = diagnoseBridge(input, snapshot);
    configurationFindings.forEach(observe);
    if (proof && identityVerified(snapshot) && snapshot.verifier?.toLowerCase() === VERIFIER.toLowerCase() && (snapshot.transactionIndex !== selection.transactionIndex || snapshot.transactionIndex !== proof.txIndex || !snapshot.queryId)) {
      observe(finding('BRIDGE_QUERY_INDEX_MISMATCH', 'fail', 'Native query index differs from source evidence', 'No automatic execution call was attempted. Native index, source receipt index, and proof metadata must agree.', { sourceIndex: selection.transactionIndex, proofIndex: proof.txIndex, snapshot }));
    } else {
      const supported = identityVerified(snapshot) && snapshot.verifier?.toLowerCase() === VERIFIER.toLowerCase();
      if (call && supported) {
        observe(finding('BRIDGE_CALL_BUILT', 'pass', 'Exact bridge call constructed', 'Arguments were decoded and checked against the bound proof. This is an input, not a submitted transaction.', { call, queryId: snapshot.queryId, block: snapshot.block }, 'simulation', 'inferred'));
        const simulated = await bridge.simulate(call, snapshot.block);
        const sourceCanonical = await network.canonical(source.block);
        if (!sourceCanonical) observe(finding('SOURCE_REORG', 'fail', 'Source block changed during bridge inspection', 'The earlier proof observation no longer establishes a current canonical source result.', undefined, 'source'));
        if (!sourceCanonical || !(await bridge.canonical(snapshot.block))) {
          observe(finding('BRIDGE_STATE_CHANGED', 'fail', 'Bridge observation block changed', 'Source or destination canonicality changed during the snapshot and simulation. Rerun with fresh evidence.'));
        } else diagnoseBridge(input, snapshot, simulated).slice(configurationFindings.length).forEach(observe);
      } else {
        if (!proof) observe(finding('BRIDGE_VERIFIED_PROOF_NEEDED', 'unknown', 'Verified source proof is required for bridge simulation', 'Configuration observations remain available. No automatic call is generated from an unverified proof.'));
      }
    }
  } catch (error) {
    callConflict = error instanceof InputError;
    if (callConflict) observe(finding('BRIDGE_CALL_CONFLICT', 'fail', 'Supplied call conflicts with the bridge proof', 'Remove the conflicting generic call or supply the exact bound bridge calldata. No automatic call was attempted.'));
    else unavailable(error, 'simulation');
  }
  if (!record.input.destinationTx || callConflict) return;
  // A historical mint remains observable even when current-state simulation rejects replay.
  try {
    const destination = await bridge.destination(record.input.destinationTx, input, source);
    if (!destination) observe(finding('BRIDGE_DESTINATION_PENDING', 'wait', 'Destination transaction receipt is not available', 'Confirm the transaction hash and wait for a mined receipt.', undefined, 'destination'));
    else {
      const sourceCanonical = await network.canonical(source.block);
      if (!sourceCanonical) observe(finding('SOURCE_REORG', 'fail', 'Source block changed during receipt correlation', 'The earlier source proof is no longer a current canonical observation.', undefined, 'source'));
      if (!sourceCanonical || !(await bridge.canonical(destination.block))) observe(finding('BRIDGE_STATE_CHANGED', 'fail', 'Bridge receipt linkage changed', 'Source or destination canonicality changed. The attempt does not establish a current mint outcome.', undefined, 'destination'));
      else if (!proof) observe(finding('BRIDGE_MINT_UNCONFIRMED', 'unknown', 'Destination receipt observed without verified source proof', 'Fresh source proof verification is required before the adapter confirms a mint.', { destination }, 'destination'));
      else observe(correlateBridgeMint(input, selection, source, destination));
    }
  } catch (error) { unavailable(error, 'destination'); }
}
