import { getAddress, JsonRpcProvider, Network, Transaction, toQuantity } from 'ethers';
import { NetworkFailure, rpc } from '../rpc.js';
import type { BlockRef, SourceEvidence } from '../network.js';
import type { BridgeInputV1, CallInput, NetworkConfig } from '../types.js';
import { ASC_MINTER, minterInterface, tokenInterface, VERIFIER, verifierInterface } from './abi.js';
import { decodeBridgeCall, queryId } from './adapter.js';
import { checkIdentity, identityVerified } from './identity.js';
import type { BridgeNetworkPort, BridgeSnapshot, DestinationEvidence, ProofPayload } from './types.js';

function safeQuantity(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[\da-f]+$/i.test(value)) throw new NetworkFailure('malformed');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new NetworkFailure('malformed');
  return number;
}
function checkedHex(value: unknown): string {
  if (typeof value !== 'string' || !/^0x(?:[\da-f]{2})*$/i.test(value)) throw new NetworkFailure('malformed');
  return value;
}

export class BridgeNetwork implements BridgeNetworkPort {
  constructor(private config: NetworkConfig) {}

  private call(url: string, method: string, params: unknown[]) {
    return rpc(url, method, params, this.config.timeoutMs);
  }

  private async ensureChain(url: string, id: number) {
    if (safeQuantity(await this.call(url, 'eth_chainId', [])) !== id) throw new NetworkFailure('wrong-network');
  }

  private async block(tag: string): Promise<BlockRef> {
    const raw = await this.call(this.config.creditcoinRpc, 'eth_getBlockByNumber', [tag, false]);
    if (!raw || typeof raw.hash !== 'string' || !/^0x[\da-f]{64}$/i.test(raw.hash)) throw new NetworkFailure('malformed');
    return { number: safeQuantity(raw.number), hash: raw.hash };
  }

  private async read(to: string, iface: typeof minterInterface, name: string, args: unknown[], block: BlockRef) {
    const result = await this.call(this.config.creditcoinRpc, 'eth_call', [{ to, data: iface.encodeFunctionData(name, args) }, toQuantity(block.number)]);
    try { return iface.decodeFunctionResult(name, result)[0]; } catch { throw new NetworkFailure('malformed'); }
  }

  async snapshot(input: BridgeInputV1, source: SourceEvidence, proof?: ProofPayload, at?: BlockRef): Promise<BridgeSnapshot> {
    if (!this.config.sourceRpc) throw new NetworkFailure('transport');
    await Promise.all([this.ensureChain(this.config.sourceRpc, this.config.sourceChainId), this.ensureChain(this.config.creditcoinRpc, this.config.creditcoinChainId)]);
    const block = at ?? await this.block('finalized');
    const codes = await Promise.all([
      this.call(this.config.sourceRpc, 'eth_getCode', [input.sourceEmitter, toQuantity(source.block.number)]),
      this.call(this.config.creditcoinRpc, 'eth_getCode', [input.minter, toQuantity(block.number)]),
      this.call(this.config.creditcoinRpc, 'eth_getCode', [input.expectedWrappedToken, toQuantity(block.number)])
    ]);
    const result: BridgeSnapshot = { block, identities: [
      checkIdentity('source', input.sourceEmitter, source.block, checkedHex(codes[0])),
      checkIdentity('minter', input.minter, block, checkedHex(codes[1])),
      checkIdentity('wrapped', input.expectedWrappedToken, block, checkedHex(codes[2]))
    ] };
    if (!identityVerified(result)) return result;
    const [verifier, wrappedToken, targetOwner, minterRole] = await Promise.all([
      this.read(input.minter, minterInterface, 'VERIFIER', [], block),
      this.read(input.minter, minterInterface, 'wrappedTokens', [input.sourceEmitter], block),
      this.read(input.expectedWrappedToken, tokenInterface, 'owner', [], block),
      this.read(input.expectedWrappedToken, tokenInterface, 'hasRole', [ASC_MINTER, input.minter], block)
    ]);
    Object.assign(result, { verifier, wrappedToken, targetOwner, minterRole });
    if (proof) {
      const txIndex = await this.read(VERIFIER, verifierInterface, 'calculateTxIndex', [proof.merkleProof], block);
      if (txIndex > BigInt(Number.MAX_SAFE_INTEGER)) throw new NetworkFailure('malformed');
      result.transactionIndex = Number(txIndex);
      if (result.transactionIndex === source.receipt.index && (proof.txIndex === undefined || result.transactionIndex === proof.txIndex)) {
        result.queryId = queryId(proof.chainKey, proof.headerNumber, result.transactionIndex);
        result.processed = await this.read(input.minter, minterInterface, 'processedQueries', [result.queryId], block);
      }
    }
    return result;
  }

  async simulate(call: CallInput, block: BlockRef) {
    await this.ensureChain(this.config.creditcoinRpc, this.config.creditcoinChainId);
    try {
      const result = checkedHex(await this.call(this.config.creditcoinRpc, 'eth_call', [{ to: call.to, from: call.from, data: call.data, value: toQuantity(BigInt(call.value ?? '0')) }, toQuantity(block.number)]));
      return { block, result };
    } catch (error) {
      if (error instanceof NetworkFailure && error.kind === 'revert') return { block, revert: error.data ?? '0x' };
      throw error;
    }
  }

  async canonical(block: BlockRef): Promise<boolean> {
    const current = await this.block(toQuantity(block.number));
    return current.hash.toLowerCase() === block.hash.toLowerCase();
  }

  async destination(hash: string, input: BridgeInputV1, source: SourceEvidence): Promise<DestinationEvidence | null> {
    await this.ensureChain(this.config.creditcoinRpc, this.config.creditcoinChainId);
    const [rawTx, rawReceipt] = await Promise.all([
      this.call(this.config.creditcoinRpc, 'eth_getTransactionByHash', [hash]),
      this.call(this.config.creditcoinRpc, 'eth_getTransactionReceipt', [hash])
    ]);
    if (!rawTx || !rawReceipt) return null;
    if (rawTx.hash?.toLowerCase() !== hash || rawReceipt.transactionHash?.toLowerCase() !== hash || rawTx.blockHash !== rawReceipt.blockHash) throw new NetworkFailure('malformed');
    const provider = new JsonRpcProvider(undefined, this.config.creditcoinChainId, { staticNetwork: true });
    let result: DestinationEvidence;
    try {
      const network = Network.from(this.config.creditcoinChainId);
      const tx = provider._wrapTransactionResponse(rawTx, network);
      const receipt = provider._wrapTransactionReceipt(rawReceipt, network);
      const signed = Transaction.from(tx);
      if (signed.chainId !== BigInt(this.config.creditcoinChainId) || signed.hash?.toLowerCase() !== hash || tx.blockNumber !== receipt.blockNumber || tx.index !== receipt.index || tx.from !== receipt.from || tx.to !== receipt.to || ![0, 1].includes(receipt.status ?? -1)) throw new NetworkFailure('malformed');
      result = { hash, block: { number: receipt.blockNumber, hash: receipt.blockHash }, finalized: false, status: receipt.status!, to: tx.to, from: tx.from, data: tx.data, value: tx.value.toString(), logs: receipt.logs.map(log => ({ address: getAddress(log.address), topics: [...log.topics], data: log.data, index: log.index })) };
    } catch (error) { throw error instanceof NetworkFailure ? error : new NetworkFailure('malformed'); }
    finally { provider.destroy(); }
    if (!(await this.canonical(result.block))) throw new NetworkFailure('malformed');
    const finalBlock = await this.block('finalized');
    result.finalized = result.block.number <= finalBlock.number;
    if (result.status === 1 && result.to?.toLowerCase() === input.minter.toLowerCase() && result.value === '0') {
      const submitted = decodeBridgeCall(result.data);
      if (submitted && submitted.chainKey === this.config.sourceChainKey && submitted.headerNumber === source.block.number && submitted.txBytes.toLowerCase() === source.encoded.toLowerCase()) {
        result.submittedProof = submitted;
        result.snapshot = await this.snapshot(input, source, submitted, result.block);
      }
    }
    return result;
  }
}
