import { getAddress, keccak256, solidityPacked, ZeroAddress } from 'ethers';
import { BURN_TOPIC, minterAbi, minterInterface, PROFILE_REVISION, tokenInterface, VERIFIER } from './abi.js';
import { identityVerified } from './identity.js';
import type { BridgeSnapshot, BridgeSimulation, BurnSelection, DestinationEvidence, Finding, ProofPayload } from './types.js';
import type { SourceEvidence } from '../network.js';
import type { BridgeInputV1, CallInput, Outcome } from '../types.js';
import { InputError } from '../validation.js';

const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function finding(code: string, outcome: Outcome, title: string, detail: string, evidence?: Record<string, unknown>, stage: Finding['stage'] = 'simulation', kind: Finding['kind'] = 'observed'): Finding {
  return { code, outcome, title, detail, stage, kind, ...(evidence ? { evidence } : {}) };
}

export function selectBurn(source: SourceEvidence, input: BridgeInputV1): { selection?: BurnSelection; findings: Finding[] } {
  const reject = (code: string, outcome: Outcome, detail: string, evidence?: Record<string, unknown>) => ({ findings: [finding(code, outcome, 'Bridge source event needs attention', detail, evidence, 'source')] });
  const logs = source.receipt.logs;
  const index = source.receipt.index;
  if (!Array.isArray(logs) || !Number.isSafeInteger(index) || Number(index) < 0 || index !== source.transaction.index) return reject('BRIDGE_SOURCE_UNAVAILABLE', 'unavailable', 'A complete receipt and matching transaction index are required.');
  if (source.status !== 1) return reject('BRIDGE_SOURCE_REVERTED', 'fail', 'A reverted source execution cannot establish a bridge burn.');
  if (!Number.isInteger(source.transaction.type) || Number(source.transaction.type) < 0 || Number(source.transaction.type) > 4) return reject('BRIDGE_ENCODING_UNSUPPORTED', 'unknown', 'This profile supports the pinned EVM V1 encoding for transaction types 0 through 4.');
  const candidates = logs.map((log: Record<string, unknown>, offset: number) => ({ log, offset })).filter(({ log }) => Array.isArray(log?.topics) && typeof log.topics[0] === 'string' && equal(log.topics[0], BURN_TOPIC));
  if (!candidates.length) return reject('BRIDGE_BURN_NOT_FOUND', 'fail', 'The receipt has no TokensBurnedForBridging event. Native proof validity is a separate question.');
  const candidateEvidence = { candidates: candidates.map(({ log, offset }) => ({ address: log.address, logIndex: log.index, receiptOffset: offset, topics: log.topics, data: log.data })) };
  const { log, offset } = candidates[0];
  const topics = log.topics as unknown[];
  if (topics.length !== 2 || !topics.every(t => typeof t === 'string' && /^0x[\da-f]{64}$/i.test(t)) || typeof log.data !== 'string' || !/^0x[\da-f]{64}$/i.test(log.data) || !Number.isSafeInteger(log.index) || Number(log.index) < 0) return reject('BRIDGE_BURN_MALFORMED', 'fail', 'The first matching log has an invalid topic, amount, or index layout. Later logs are not substituted.', candidateEvidence);
  let emitter: string;
  try { emitter = getAddress(String(log.address)); } catch { return reject('BRIDGE_BURN_MALFORMED', 'fail', 'The first burn emitter is not an address.', candidateEvidence); }
  if (!equal(emitter, input.sourceEmitter)) return reject('BRIDGE_EMITTER_MISMATCH', 'fail', 'The minter selects an earlier matching event from a different emitter. Filtering that event out would describe a call the contract does not make.', candidateEvidence);
  if (input.sourceLogIndex !== undefined && input.sourceLogIndex !== log.index) return reject('BRIDGE_LOG_NOT_EXECUTABLE', 'fail', 'This minter processes only the first matching event. The requested log cannot be selected through execute.', candidateEvidence);
  if (candidates.length > 1 && input.sourceLogIndex === undefined) return reject('BRIDGE_LOG_SELECTION_REQUIRED', 'unknown', 'Confirm the first matching global log index before generating calldata. Additional matching events will not be minted.', candidateEvidence);
  const selection: BurnSelection = {
    sourceHash: source.hash, block: source.block, transactionIndex: Number(index),
    logIndex: Number(log.index), receiptOffset: offset, emitter,
    recipient: getAddress('0x' + (topics[1] as string).slice(-40)), amount: BigInt(log.data).toString(),
    topics: topics as string[], data: log.data, encodingHash: keccak256(source.encoded)
  };
  return { selection, findings: [finding('BRIDGE_BURN_SELECTED', 'pass', 'Bridge burn event selected', 'Recipient and amount come from the first matching event. The destination caller may be a different relayer.', { selection, ...candidateEvidence, profileRevision: PROFILE_REVISION }, 'source')] };
}

export function queryId(chainKey: number | bigint, height: number | bigint, index: number | bigint): string {
  const values = [chainKey, height, index].map(v => BigInt(v));
  if (values.some(v => v < 0n || v >= 2n ** 64n)) throw new InputError('Query fields must be unsigned uint64 values.');
  return keccak256(solidityPacked(['uint256', 'uint64', 'uint256'], values));
}

function proofArguments(proof: ProofPayload) {
  return [0, proof.chainKey, proof.headerNumber, proof.txBytes, proof.merkleProof.root, proof.merkleProof.siblings, proof.continuityProof.lowerEndpointDigest, proof.continuityProof.roots];
}

export function decodeBridgeCall(data: string): ProofPayload | null {
  try {
    const decoded = minterInterface.decodeFunctionData('execute', data);
    if (decoded[0] !== 0n || minterInterface.encodeFunctionData('execute', decoded).toLowerCase() !== data.toLowerCase()) return null;
    const chainKey = Number(decoded[1]), headerNumber = Number(decoded[2]);
    if (!Number.isSafeInteger(chainKey) || chainKey < 1 || !Number.isSafeInteger(headerNumber) || headerNumber < 0 || decoded[3].length > 1048576 || decoded[5].length > 64 || decoded[7].length > 20000) return null;
    return { chainKey, headerNumber, txBytes: decoded[3], merkleProof: { root: decoded[4], siblings: decoded[5].map((s: { hash: string; isLeft: boolean }) => ({ hash: s.hash, isLeft: s.isLeft })) }, continuityProof: { lowerEndpointDigest: decoded[6], roots: Array.from(decoded[7]) } };
  } catch { return null; }
}

export function buildBridgeCall(proof: ProofPayload, input: BridgeInputV1, supplied?: CallInput): CallInput {
  const data = minterInterface.encodeFunctionData('execute', proofArguments(proof));
  const decoded = decodeBridgeCall(data);
  if (!decoded || minterInterface.encodeFunctionData('execute', proofArguments(decoded)) !== data) throw new InputError('Bridge proof arguments cannot be encoded safely.');
  const call: CallInput = { to: input.minter, from: input.caller, value: '0', data, abi: [...minterAbi, 'error AccessControlUnauthorizedAccount(address account,bytes32 neededRole)'] };
  if (supplied && (!equal(call.to, supplied.to) || !equal(call.from, supplied.from) || BigInt(supplied.value ?? '0') !== 0n || !equal(call.data, supplied.data))) throw new InputError('The supplied call differs from the exact bridge proof call.');
  return call;
}

function decodedError(data: string) {
  try {
    const decoded = minterInterface.parseError(data) ?? tokenInterface.parseError(data);
    return decoded ? { name: decoded.name, args: Array.from(decoded.args, v => String(v)) } : null;
  } catch { return null; }
}

export function diagnoseBridge(input: BridgeInputV1, snapshot: BridgeSnapshot, simulation?: BridgeSimulation): Finding[] {
  const evidence = { snapshot, profileRevision: PROFILE_REVISION };
  if (!identityVerified(snapshot)) return [finding('BRIDGE_IDENTITY_UNVERIFIED', 'unknown', 'Bridge deployment identity is unverified', 'One or more runtime bodies do not match the pinned compiler profile. Raw reads do not establish compatible bridge behavior.', evidence)];
  if (!snapshot.verifier || !equal(snapshot.verifier, VERIFIER)) return [finding('BRIDGE_VERIFIER_MISMATCH', 'unknown', 'Bridge verifier is unsupported', 'The minter does not report the pinned native verifier address.', evidence)];
  const findings: Finding[] = [finding('BRIDGE_IDENTITY_VERIFIED', 'pass', 'Bridge runtime profile matched', 'Source and destination executable code match the pinned artifacts; the decoder is inlined in the minter.', evidence, 'configuration')];
  if (snapshot.processed) findings.push(finding('BRIDGE_QUERY_PROCESSED', 'fail', 'Bridge query was already processed', 'The current replay guard rejects this source transaction. This does not by itself prove a mint for the intended event.', evidence));
  if (snapshot.wrappedToken && equal(snapshot.wrappedToken, ZeroAddress)) findings.push(finding('BRIDGE_REGISTRATION_EMPTY', 'unknown', 'Source emitter has no wrapped token mapping', 'This is a configuration observation. A matching full-call revert is needed to establish the rejection cause; registration uses the target owner’s separate signer.', evidence));
  else if (snapshot.wrappedToken && !equal(snapshot.wrappedToken, input.expectedWrappedToken)) findings.push(finding('BRIDGE_WRAPPED_TOKEN_MISMATCH', 'fail', 'Emitter maps to an unexpected token', 'The intended token differs from the observed mapping. This example does not allow overwriting a nonzero mapping.', evidence));
  if (snapshot.minterRole === false) findings.push(finding('BRIDGE_MINTER_ROLE_MISSING', 'fail', 'Expected wrapped token does not grant the minter role', 'Role membership was read at the recorded block. Do not assume that the token owner can grant an administration role.', evidence));
  if (!simulation) return findings;
  if (simulation.block.number !== snapshot.block.number || !equal(simulation.block.hash, snapshot.block.hash)) return [...findings, finding('BRIDGE_SNAPSHOT_MISMATCH', 'unavailable', 'Bridge observations use different blocks', 'Collect a fresh configuration snapshot and simulation at the same finalized block.')];
  const decoded = simulation.revert !== undefined ? decodedError(simulation.revert) : null;
  const simulatedEvidence = { ...evidence, simulation, decodedError: decoded, stateMode: 'current-finalized-state' };
  if (simulation.revert !== undefined) {
    const unregistered = !snapshot.processed && snapshot.wrappedToken && equal(snapshot.wrappedToken, ZeroAddress) && decoded?.name === 'Error' && decoded.args[0] === 'No wrapped token for emitter';
    findings.push(finding(unregistered ? 'BRIDGE_EMITTER_UNREGISTERED' : 'BRIDGE_CALL_REVERTED', 'fail', unregistered ? 'Bridge rejected an unregistered emitter' : 'Bridge application call reverted', unregistered ? 'The empty emitter mapping and exact call revert agree. The expected target owner can register it separately once its minter-role prerequisite is met.' : 'Preserve this application failure separately from native proof validity and from any historical mint receipt.', simulatedEvidence, 'simulation', 'simulated'));
  } else {
    let success = false;
    try { success = simulation.result?.toLowerCase() === minterInterface.encodeFunctionResult('execute', [true]).toLowerCase(); } catch { /* Unsupported return value. */ }
    findings.push(finding(success ? 'BRIDGE_CALL_SUCCEEDED' : 'BRIDGE_RETURN_UNEXPECTED', success ? 'pass' : 'unavailable', success ? 'Bridge simulation succeeded' : 'Bridge returned an unsupported result', success ? 'The exact execute call returned true at this block. No transaction was broadcast and no replay flag was persisted.' : 'Only the pinned ABI true result establishes a successful bridge simulation.', simulatedEvidence, 'simulation', 'simulated'));
  }
  return findings;
}

export function correlateBridgeMint(input: BridgeInputV1, selection: BurnSelection, source: SourceEvidence, destination: DestinationEvidence): Finding {
  const evidence = { destination, selection, profileRevision: PROFILE_REVISION };
  const unknown = (detail: string) => finding('BRIDGE_MINT_UNCONFIRMED', 'unknown', 'Destination mint linkage is unconfirmed', detail, evidence, 'destination');
  if (destination.status !== 1) return finding('BRIDGE_DESTINATION_REVERTED', 'fail', 'Observed destination transaction reverted', 'The supplied transaction did not complete successfully.', evidence, 'destination');
  if (!destination.to || !equal(destination.to, input.minter) || BigInt(destination.value) !== 0n) return unknown('Only a direct zero-value execute call to the selected minter is supported.');
  const submitted = destination.submittedProof;
  const actual = decodeBridgeCall(destination.data);
  const snapshot = destination.snapshot;
  if (!submitted || !actual || minterInterface.encodeFunctionData('execute', proofArguments(submitted)) !== minterInterface.encodeFunctionData('execute', proofArguments(actual)) || actual.chainKey !== 1 || actual.headerNumber !== source.block.number || !equal(actual.txBytes, source.encoded)) return unknown('The actual destination calldata does not bind to the selected source evidence.');
  if (!snapshot || !identityVerified(snapshot) || !snapshot.verifier || !equal(snapshot.verifier, VERIFIER) || snapshot.transactionIndex !== selection.transactionIndex || snapshot.queryId !== queryId(1, source.block.number, selection.transactionIndex)) return unknown('Historical runtime identity and native query identity must be established at the destination receipt block.');
  if (snapshot.block.number !== destination.block.number || !equal(snapshot.block.hash, destination.block.hash) || !snapshot.wrappedToken || !equal(snapshot.wrappedToken, input.expectedWrappedToken)) return unknown('Historical mapping or observation block does not match the intended outcome.');
  const mintTopic = minterInterface.getEvent('TokensMinted')!.topicHash;
  const mintLogs = destination.logs.filter(log => equal(log.address, input.minter) && log.topics[0] && equal(log.topics[0], mintTopic));
  try {
    if (mintLogs.length !== 1) return unknown('Exactly one minter-emitted TokensMinted event is required.');
    const mint = minterInterface.parseLog(mintLogs[0])!;
    if (!equal(mint.args[0], input.expectedWrappedToken) || !equal(mint.args[1], selection.recipient) || mint.args[2].toString() !== selection.amount || !equal(mint.args[3], snapshot.queryId)) return unknown('The mint event has a different token, recipient, amount, or query ID.');
    const transferTopic = tokenInterface.getEvent('Transfer')!.topicHash;
    const transfers = destination.logs.filter(log => equal(log.address, input.expectedWrappedToken) && log.topics[0] && equal(log.topics[0], transferTopic)).map(log => tokenInterface.parseLog(log));
    const matches = transfers.filter(log => log && equal(log.args[0], ZeroAddress) && equal(log.args[1], selection.recipient) && log.args[2].toString() === selection.amount);
    if (matches.length !== 1) return unknown('Exactly one corresponding zero-address token mint event is required.');
  } catch { return unknown('Destination event bytes do not match the pinned ABI.'); }
  if (!destination.finalized) return finding('BRIDGE_DESTINATION_NOT_FINAL', 'wait', 'Matching destination mint awaits finality', 'The event linkage matches, but finality has not reached the receipt block.', evidence, 'destination');
  return finding('BRIDGE_MINT_CONFIRMED', 'pass', 'Destination mint matches the source burn', 'The finalized direct call and both contract-emitted events bind to the selected source recipient and amount. A later replay rejection does not undo this mined outcome.', evidence, 'destination');
}
