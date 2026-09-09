import { createRequire } from 'node:module';
import ethers = require('ethers');
const { Interface, JsonRpcProvider, Network, Transaction, toQuantity } = ethers;
import { blockProver, chainInfo, encoding, proofProvider } from '@gluwa/usc-sdk';
import { NetworkFailure, rpc } from './rpc.js';
export { NetworkFailure, rpc } from './rpc.js';
import { BridgeNetwork } from './bridge/network.js';
import type { BridgeNetworkPort } from './bridge/types.js';
import type { CallInput, NetworkConfig, ReadinessCheck } from './types.js';

function hex(value: unknown): value is string { return typeof value === 'string' && /^0x(?:[\da-fA-F]{2})*$/.test(value); }

const require = createRequire(import.meta.url);
const infoAbi = new Interface(require('@gluwa/usc-sdk/dist/chain-info/chain_info.json') as ethers.InterfaceAbi);
const proverAbi = new Interface(require('@gluwa/usc-sdk/dist/block-prover/block_prover.json') as ethers.InterfaceAbi);
const verifySignature = 'verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))';

export interface BlockRef { number: number; hash: string }
export interface SourceEvidence {
  hash: string;
  block: BlockRef;
  status: number;
  encoded: string;
  transaction: Record<string, unknown>;
  receipt: Record<string, unknown>;
}
export interface AttestationEvidence {
  height: number;
  digest: string;
  exists: boolean;
  block: BlockRef;
  registeredChainId: number;
  chainEncoding: number;
}
export type Proof = proofProvider.ContinuityResponse;
export interface NetworkPort {
  bridge?: BridgeNetworkPort;
  source(hash: string): Promise<SourceEvidence | null>;
  attestation(): Promise<AttestationEvidence>;
  proof(hash: string): Promise<Proof | null>;
  verify(proof: Proof): Promise<{ valid: boolean; block: BlockRef }>;
  canonical(block: BlockRef): Promise<boolean>;
  simulate(call: CallInput): Promise<{ block: BlockRef; result?: string; revert?: string; noCode?: boolean }>;
  destination(hash: string): Promise<Record<string, unknown> | null>;
}

export class LiveNetwork implements NetworkPort {
  readonly bridge: BridgeNetworkPort;
  constructor(private config: NetworkConfig) { this.bridge = new BridgeNetwork(config); }

  private call(url: string, method: string, params: unknown[] = []) {
    return rpc(url, method, params, this.config.timeoutMs);
  }

  private async ensureChain(url: string, expected: number) {
    const id = await this.call(url, 'eth_chainId');
    if (typeof id !== 'string' || !/^0x[\da-f]+$/i.test(id)) throw new NetworkFailure('malformed');
    if (BigInt(id) !== BigInt(expected)) throw new NetworkFailure('wrong-network');
  }

  private async block(url: string, tag: string): Promise<BlockRef> {
    const block = await this.call(url, 'eth_getBlockByNumber', [tag, false]);
    const number = Number(block?.number);
    if (!Number.isSafeInteger(number) || number < 0 || !/^0x[\da-f]{64}$/i.test(block?.hash)) throw new NetworkFailure('malformed');
    return { number, hash: block.hash };
  }

  async source(txHash: string): Promise<SourceEvidence | null> {
    const url = this.config.sourceRpc!;
    await this.ensureChain(url, this.config.sourceChainId);
    const [rawTx, rawReceipt] = await Promise.all([
      this.call(url, 'eth_getTransactionByHash', [txHash]),
      this.call(url, 'eth_getTransactionReceipt', [txHash])
    ]);
    if (!rawTx || !rawReceipt) return null;
    if (rawTx.hash?.toLowerCase() !== txHash || rawReceipt.transactionHash?.toLowerCase() !== txHash || rawTx.blockHash !== rawReceipt.blockHash) throw new NetworkFailure('malformed');
    const provider = new JsonRpcProvider(undefined, this.config.sourceChainId, { staticNetwork: true });
    try {
      const network = Network.from(this.config.sourceChainId);
      const tx = provider._wrapTransactionResponse(rawTx, network);
      const receipt = provider._wrapTransactionReceipt(rawReceipt, network);
      // Reconstruct the signed envelope: an RPC's hash/from labels alone do not bind its fields.
      const signed = Transaction.from(tx);
      if (signed.chainId !== BigInt(this.config.sourceChainId) || signed.hash?.toLowerCase() !== txHash ||
        tx.blockNumber !== receipt.blockNumber || tx.index !== receipt.index) throw new NetworkFailure('malformed');
      const encoded = encoding.abiEncode(new encoding.TransactionWithRaw(tx,
        new encoding.RawTransactionResponse(rawTx.authorizationList?.map((a: { yParity: string }) => ({ yParity: Number(a.yParity) })) ?? null)
      ), receipt).abi;
      if (![0, 1].includes(receipt.status ?? -1)) throw new NetworkFailure('malformed');
      return {
        hash: txHash, block: { number: receipt.blockNumber, hash: receipt.blockHash },
        status: receipt.status!, encoded, transaction: tx.toJSON(), receipt: receipt.toJSON()
      };
    } catch (error) { throw error instanceof NetworkFailure ? error : new NetworkFailure('malformed'); }
    finally { provider.destroy(); }
  }

  async attestation(): Promise<AttestationEvidence> {
    const url = this.config.creditcoinRpc;
    await this.ensureChain(url, this.config.creditcoinChainId);
    const block = await this.block(url, 'finalized');
    const invoke = async (name: string) => {
      const data = infoAbi.encodeFunctionData(name, [this.config.sourceChainKey]);
      const result = await this.call(url, 'eth_call', [{ to: chainInfo.CHAIN_INFO_PRECOMPILE_ADDRESS, data }, toQuantity(block.number)]);
      try { return infoAbi.decodeFunctionResult(name, result)[0]; } catch { throw new NetworkFailure('malformed'); }
    };
    const [chain, height] = await Promise.all([invoke('get_chain_by_key'), invoke('get_latest_attestation_height_and_hash')]);
    if (!chain.exists || Number(chain.info.chainId) !== this.config.sourceChainId) throw new NetworkFailure('wrong-network');
    if (Number(chain.info.chainEncoding) !== 1) throw new NetworkFailure('malformed');
    const attestedHeight = Number(height.height);
    if (!Number.isSafeInteger(attestedHeight) || attestedHeight < 0) throw new NetworkFailure('malformed');
    return { height: attestedHeight, digest: height.hash, exists: height.exists, block, registeredChainId: Number(chain.info.chainId), chainEncoding: Number(chain.info.chainEncoding) };
  }

  async proof(hash: string): Promise<Proof | null> {
    const builder = new proofProvider.service.ProofBuilder(this.config.sourceChainKey, this.config.proofBuilder, this.config.timeoutMs);
    const result = await builder.getProof(hash);
    if (!result.success || !result.data) return null;
    const p = result.data;
    const hash32 = (x: unknown) => typeof x === 'string' && /^0x[\da-f]{64}$/i.test(x);
    if (!Number.isSafeInteger(p.chainKey) || p.chainKey < 1 || !Number.isSafeInteger(p.headerNumber) || p.headerNumber < 0 || !Number.isSafeInteger(p.txIndex) || p.txIndex < 0 || !hash32(p.txHash) ||
      !hex(p.txBytes) || p.txBytes.length > 1048576 || !hash32(p.merkleProof?.root) || !Array.isArray(p.merkleProof.siblings) || p.merkleProof.siblings.length > 64 ||
      p.merkleProof.siblings.some(s => !hash32(s.hash) || typeof s.isLeft !== 'boolean') || !hash32(p.continuityProof?.lowerEndpointDigest) ||
      !Array.isArray(p.continuityProof.roots) || p.continuityProof.roots.length > 20000 || !p.continuityProof.roots.every(hash32)) throw new NetworkFailure('malformed');
    // Project only documented fields; untrusted service metadata is not persisted.
    return {
      chainKey: p.chainKey, headerNumber: p.headerNumber, txIndex: p.txIndex, txHash: p.txHash,
      txBytes: p.txBytes,
      merkleProof: { root: p.merkleProof.root, siblings: p.merkleProof.siblings.map(s => ({ hash: s.hash, isLeft: s.isLeft })) },
      continuityProof: { lowerEndpointDigest: p.continuityProof.lowerEndpointDigest, roots: p.continuityProof.roots },
      cached: p.cached === true, generatedAt: new Date(p.generatedAt)
    };
  }

  async verify(proof: Proof) {
    const url = this.config.creditcoinRpc;
    await this.ensureChain(url, this.config.creditcoinChainId);
    const block = await this.block(url, 'finalized');
    const data = proverAbi.encodeFunctionData(verifySignature, [proof.chainKey, proof.headerNumber, proof.txBytes, proof.merkleProof, proof.continuityProof]);
    try {
      const result = await this.call(url, 'eth_call', [{ to: blockProver.BLOCK_PROVER_PRECOMPILE_ADDRESS, data }, toQuantity(block.number)]);
      return { valid: proverAbi.decodeFunctionResult(verifySignature, result)[0] === true, block };
    } catch (error) {
      if (error instanceof NetworkFailure && error.kind === 'revert') return { valid: false, block };
      throw error instanceof NetworkFailure ? error : new NetworkFailure('malformed');
    }
  }

  async canonical(block: BlockRef): Promise<boolean> {
    const current = await this.block(this.config.sourceRpc!, toQuantity(block.number));
    return current.hash.toLowerCase() === block.hash.toLowerCase();
  }

  async simulate(call: CallInput) {
    const url = this.config.creditcoinRpc;
    await this.ensureChain(url, this.config.creditcoinChainId);
    const block = await this.block(url, 'finalized');
    const tag = toQuantity(block.number);
    const code = await this.call(url, 'eth_getCode', [call.to, tag]);
    if (code === '0x') return { block, noCode: true };
    try {
      const result = await this.call(url, 'eth_call', [{ to: call.to, from: call.from, data: call.data, value: toQuantity(BigInt(call.value ?? '0')) }, tag]);
      if (!hex(result)) throw new NetworkFailure('malformed');
      return { block, result };
    } catch (error) {
      if (error instanceof NetworkFailure && error.kind === 'revert') return { block, revert: error.data ?? '0x' };
      throw error;
    }
  }

  async destination(hash: string) {
    await this.ensureChain(this.config.creditcoinRpc, this.config.creditcoinChainId);
    const receipt = await this.call(this.config.creditcoinRpc, 'eth_getTransactionReceipt', [hash]);
    if (!receipt) return null;
    if (receipt.transactionHash?.toLowerCase() !== hash || !['0x0', '0x1'].includes(receipt.status)) throw new NetworkFailure('malformed');
    const canonical = await this.block(this.config.creditcoinRpc, receipt.blockNumber);
    if (canonical.hash.toLowerCase() !== receipt.blockHash?.toLowerCase()) throw new NetworkFailure('malformed');
    return { transactionHash: hash, status: Number(receipt.status), blockNumber: Number(receipt.blockNumber), blockHash: receipt.blockHash, from: receipt.from, to: receipt.to, gasUsed: receipt.gasUsed, logs: receipt.logs };
  }

  async doctor(): Promise<ReadinessCheck[]> {
    const check = async (name: string, task: () => Promise<string>): Promise<ReadinessCheck> => {
      try { return { name, status: 'ready', detail: await task() }; }
      catch (error) { return { name, status: 'unavailable', detail: error instanceof NetworkFailure && error.kind === 'wrong-network' ? 'The returned network identity does not match configuration.' : 'A valid response was not available. Check the endpoint or try again.' }; }
    };
    return Promise.all([
      this.config.sourceRpc ? check('Source RPC', async () => { await this.ensureChain(this.config.sourceRpc!, this.config.sourceChainId); return `Connected to chain ${this.config.sourceChainId}.`; }) : Promise.resolve({ name: 'Source RPC', status: 'missing' as const, detail: 'Set SOURCE_CHAIN_RPC_URL in your local .env, then restart ProofOps.' }),
      check('Creditcoin RPC', async () => { await this.ensureChain(this.config.creditcoinRpc, this.config.creditcoinChainId); return `Connected to chain ${this.config.creditcoinChainId}.`; }),
      check('Chain attestation', async () => { const a = await this.attestation(); if (!a.exists) throw new NetworkFailure('rpc'); return `Source height ${a.height} attested; observed at Creditcoin block ${a.block.number}.`; }),
      check('Proof service', async () => {
        const response = await fetch(new URL(`/api/v1/attested-height/${this.config.sourceChainKey}`, this.config.proofBuilder), { signal: AbortSignal.timeout(this.config.timeoutMs), redirect: 'error' });
        if (!response.ok) throw new NetworkFailure('transport');
        const body = await response.json() as { attestedHeight?: unknown };
        if (!Number.isSafeInteger(body.attestedHeight)) throw new NetworkFailure('malformed');
        return `Service reports height ${body.attestedHeight}. Proof generation is checked separately for each transaction.`;
      })
    ]);
  }
}
