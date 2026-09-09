import { Interface, keccak256 } from 'ethers';
import type { Attempt, CaseRecord, NetworkConfig, Observation, Stage, Status } from './types.js';
import { Store } from './store.js';
import { LiveNetwork, NetworkFailure, type NetworkPort, type Proof, type SourceEvidence } from './network.js';
import { InputError } from './validation.js';
import { caseInput } from './validation.js';
import { inspectBridge } from './bridge/inspect.js';

export function proofMatches(proof: Proof, source: SourceEvidence, chainKey: number): boolean {
  return proof.chainKey === chainKey && proof.headerNumber === source.block.number &&
    proof.txHash.toLowerCase() === source.hash && proof.txBytes.toLowerCase() === source.encoded.toLowerCase();
}

export function decodeRevert(data: string, abi: readonly (string | Record<string, unknown>)[] = []): { name: string; args: string[] } | null {
  try {
    const result = new Interface(abi).parseError(data);
    return result ? { name: result.name, args: result.args.map(x => String(x)) } : null;
  } catch { return null; }
}

export function attemptStatus(observations: Observation[]): Status {
  if (observations.some(o => o.outcome === 'fail')) return 'failed';
  if (observations.some(o => o.outcome === 'unavailable')) return 'blocked';
  if (observations.some(o => o.outcome === 'wait')) return 'waiting';
  if (observations.some(o => o.code === 'PROOF_VERIFIED')) return 'ready';
  return 'incomplete';
}

export function assertCaseNetwork(record: CaseRecord, config: NetworkConfig): void {
  if (record.sourceChainId !== config.sourceChainId || record.creditcoinChainId !== config.creditcoinChainId || record.sourceChainKey !== config.sourceChainKey) {
    throw new InputError('This case belongs to different networks. Restore its original network configuration before rerunning.');
  }
}

export async function inspectCase(store: Store, id: string, config: NetworkConfig, network: NetworkPort = new LiveNetwork(config)): Promise<CaseRecord> {
  const record = store.get(id);
  assertCaseNetwork(record, config);
  caseInput(record.input);
  const attempt = store.start(id);
  const observe = (o: Omit<Observation, 'at'>) => store.observe(attempt, { ...o, at: new Date().toISOString() });
  const unavailable = (stage: Stage, error?: unknown) => observe({
    stage, outcome: 'unavailable', kind: 'observed', code: error instanceof NetworkFailure && error.kind === 'wrong-network' ? 'WRONG_NETWORK' : 'CHECK_UNAVAILABLE',
    title: error instanceof NetworkFailure && error.kind === 'wrong-network' ? 'Network identity mismatch' : 'Check could not complete',
    detail: error instanceof NetworkFailure && error.kind === 'wrong-network' ? 'Check the configured EVM chain IDs and Attestcoin source-chain key.' : 'A valid response was unavailable or the data format is unsupported. This is not evidence of a failed proof. Retry after checking the provider.'
  });
  let stage: Stage = 'configuration';
  let bridgeSource: SourceEvidence | undefined;
  let bridgeProof: Proof | undefined;
  try {
    if (!config.sourceRpc) {
      observe({ stage, outcome: 'unavailable', kind: 'observed', code: 'SOURCE_RPC_MISSING', title: 'Source RPC is not configured', detail: 'Set SOURCE_CHAIN_RPC_URL in your local .env, restart ProofOps, and rerun this case. Your case has been saved.' });
    } else {
      stage = 'source';
      const source = await network.source(record.input.sourceTx);
      if (!source) {
        observe({ stage, outcome: 'wait', kind: 'observed', code: 'SOURCE_NOT_MINED', title: 'Mined source transaction not found', detail: 'The transaction may be pending, unknown to this provider, or on another chain. Confirm the hash and network before retrying.' });
      } else {
        const canonical = await network.canonical(source.block);
        observe({ stage, outcome: !canonical || source.status === 0 ? 'fail' : 'pass', kind: 'observed', code: !canonical ? 'SOURCE_REORG' : source.status === 0 ? 'SOURCE_REVERTED' : 'SOURCE_CONFIRMED', title: !canonical ? 'Source block changed' : source.status === 0 ? 'Source execution reverted' : 'Source transaction succeeded', detail: 'Receipt and transaction observed through the configured source RPC. Proof verification is a separate check.', evidence: { block: source.block, transaction: source.transaction, receipt: source.receipt, encodedTransactionHash: keccak256(source.encoded) } });
        if (canonical && source.status === 1) {
          bridgeSource = source;
          stage = 'attestation';
          const attested = await network.attestation();
          const ready = attested.exists && attested.height >= source.block.number;
          observe({ stage, outcome: ready ? 'pass' : 'wait', kind: 'observed', code: ready ? 'ATTESTATION_READY' : 'ATTESTATION_PENDING', title: ready ? 'Source height is attested' : 'Waiting for source attestation', detail: ready ? 'Creditcoin reports an attested height covering the source block. The proof service may still be catching up.' : 'This is a normal waiting state. Rerun after the attested height reaches the source block.', evidence: { ...attested, requiredHeight: source.block.number } });
          if (ready) {
            stage = 'proof';
            const proof = await network.proof(record.input.sourceTx);
            if (!proof) unavailable(stage);
            else if (!proofMatches(proof, source, config.sourceChainKey)) {
              observe({ stage, outcome: 'fail', kind: 'observed', code: 'PROOF_SOURCE_MISMATCH', title: 'Proof does not match this source transaction', detail: 'The proof chain, block, transaction hash or encoded transaction/receipt differs from the requested source evidence. Verification was not attempted.', evidence: { requestedHash: source.hash, returnedHash: proof.txHash, sourceBlock: source.block.number, proofBlock: proof.headerNumber, sourceEncodingHash: keccak256(source.encoded), proofEncodingHash: keccak256(proof.txBytes) } });
            } else {
              observe({ stage, outcome: 'pass', kind: 'observed', code: 'PROOF_COLLECTED', title: 'Proof received and source binding checked', detail: 'Encoded transaction and receipt match the source RPC evidence byte-for-byte. Native verification is still required.', evidence: { proof } });
              stage = 'verification';
              const verified = await network.verify(proof);
              if (!(await network.canonical(source.block))) {
                bridgeSource = undefined;
                observe({ stage, outcome: 'fail', kind: 'observed', code: 'SOURCE_REORG', title: 'Source block changed during inspection', detail: 'Rerun with fresh source evidence; this attempt does not establish a current canonical result.' });
              } else {
                if (verified.valid) bridgeProof = proof;
                observe({ stage, outcome: verified.valid ? 'pass' : 'fail', kind: 'simulated', code: verified.valid ? 'PROOF_VERIFIED' : 'PROOF_REJECTED', title: verified.valid ? 'Native verifier accepted the proof' : 'Native verifier rejected the call', detail: verified.valid ? 'Read-only eth_call against the Creditcoin native verifier. This does not mean the destination application executed.' : 'The native verifier returned false or reverted. A malformed call or verifier failure requires further inspection; this alone does not establish fraud.', evidence: { block: verified.block, method: 'eth_call', valid: verified.valid } });
              }
            }
          }
        }
      }
    }
  } catch (error) { unavailable(stage, error); }

  // Destination checks are independent observations and can still help when a proof service is unavailable.
  if (record.input.bridge) {
    await inspectBridge(record, config, network, bridgeSource, bridgeProof, observe);
  } else if (record.input.call) {
    try {
      const result = await network.simulate(record.input.call);
      const decoded = result.revert !== undefined ? decodeRevert(result.revert, record.input.call.abi) : null;
      observe({ stage: 'simulation', outcome: result.noCode || result.revert !== undefined ? 'fail' : 'pass', kind: 'simulated', code: result.noCode ? 'DESTINATION_NO_CODE' : result.revert !== undefined ? 'DESTINATION_REVERTED' : 'DESTINATION_CALL_SUCCEEDED', title: result.noCode ? 'No destination application code found' : result.revert !== undefined ? 'Destination call reverted' : 'Destination simulation succeeded', detail: result.noCode ? 'Check the destination address and network. Runtime precompile addresses are not supported as application destinations.' : result.revert !== undefined ? 'The supplied call reverted at the recorded finalized block. Decoded errors describe what the contract returned; they do not independently prove the underlying cause.' : 'The supplied call succeeded in current finalized state. No transaction was broadcast, and source-to-destination semantic correlation is not inferred.', evidence: { block: result.block, call: record.input.call, result: result.result, revertData: result.revert, decodedError: decoded, stateMode: 'current-finalized-state' } });
    } catch (error) { unavailable('simulation', error); }
  } else {
    observe({ stage: 'simulation', outcome: 'unknown', kind: 'observed', code: 'DESTINATION_INPUT_NEEDED', title: 'Destination call not supplied', detail: 'Add the intended destination address, caller and calldata to simulate application execution. A source hash alone cannot reconstruct the worker call.' });
  }
  if (record.input.destinationTx && !record.input.bridge) {
    try {
      const receipt = await network.destination(record.input.destinationTx);
      observe({ stage: 'destination', outcome: !receipt ? 'wait' : receipt.status === 1 ? 'pass' : 'fail', kind: 'observed', code: !receipt ? 'DESTINATION_PENDING' : receipt.status === 1 ? 'DESTINATION_MINED' : 'DESTINATION_TX_REVERTED', title: !receipt ? 'Destination receipt not available' : receipt.status === 1 ? 'Destination transaction succeeded' : 'Destination transaction reverted', detail: 'This is the receipt of the explicitly supplied destination hash. Application-specific outcome and linkage to the source require an adapter or manual review.', ...(receipt ? { evidence: { receipt } } : {}) });
    } catch (error) { unavailable('destination', error); }
  }
  store.finish(attempt, attemptStatus(attempt.observations));
  return store.get(id);
}

export function checkExpectation(attempt: Attempt, expectation: 'proof-valid' | 'destination-call-succeeds'): 'pass' | 'fail' | 'inconclusive' {
  const proofValid = attempt.observations.some(o => o.code === 'PROOF_VERIFIED' && o.outcome === 'pass');
  if (attempt.observations.some(o => ['SOURCE_REORG', 'PROOF_SOURCE_MISMATCH', 'PROOF_REJECTED', 'SOURCE_REVERTED'].includes(o.code))) return 'fail';
  if (!proofValid) return 'inconclusive';
  if (expectation === 'proof-valid') return 'pass';
  if (attempt.observations.some(o => o.code.startsWith('BRIDGE_'))) {
    const relevant = attempt.observations.filter(o => ['source', 'configuration', 'simulation'].includes(o.stage));
    if (relevant.some(o => o.outcome === 'fail')) return 'fail';
    return relevant.some(o => o.code === 'BRIDGE_CALL_SUCCEEDED') && !relevant.some(o => o.outcome === 'unavailable') ? 'pass' : 'inconclusive';
  }
  const simulation = attempt.observations.find(o => o.stage === 'simulation');
  if (simulation?.outcome === 'fail') return 'fail';
  return simulation?.code === 'DESTINATION_CALL_SUCCEEDED' ? 'pass' : 'inconclusive';
}
