import { resolve } from 'node:path';
import { InputError } from './validation.js';
import type { NetworkConfig } from './types.js';

function endpoint(value: string | undefined, name: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.hash) throw new Error();
    return url.href;
  } catch { throw new InputError(`${name} must be an HTTP or HTTPS URL without a fragment.`); }
}

function integer(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new InputError(`${name} must be a positive safe integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new InputError(`${name} must be a positive safe integer.`);
  return number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NetworkConfig {
  return {
    sourceRpc: endpoint(env.SOURCE_CHAIN_RPC_URL, 'SOURCE_CHAIN_RPC_URL'),
    creditcoinRpc: endpoint(env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network', 'CREDITCOIN_RPC_URL') ?? 'https://rpc.cc3-testnet.creditcoin.network',
    proofBuilder: endpoint(env.PROOF_BUILDER_URL ?? 'https://prover.cc3-testnet.creditcoin.network', 'PROOF_BUILDER_URL') ?? 'https://prover.cc3-testnet.creditcoin.network',
    sourceChainKey: integer(env.SOURCE_CHAIN_KEY, 1, 'SOURCE_CHAIN_KEY'),
    sourceChainId: integer(env.SOURCE_CHAIN_ID, 11155111, 'SOURCE_CHAIN_ID'),
    creditcoinChainId: integer(env.CREDITCOIN_CHAIN_ID, 102031, 'CREDITCOIN_CHAIN_ID'),
    timeoutMs: 10_000,
    dataDir: resolve(env.PROOFOPS_DATA_DIR ?? '.proofops')
  };
}

export function publicConfig(config: NetworkConfig) {
  return {
    sourceConfigured: Boolean(config.sourceRpc),
    sourceChainId: config.sourceChainId,
    creditcoinChainId: config.creditcoinChainId,
    sourceChainKey: config.sourceChainKey,
    mode: 'read-only',
    networkLabel: config.sourceChainId === 11155111 && config.creditcoinChainId === 102031 ? 'Sepolia → Creditcoin testnet' : 'Custom network configuration'
  };
}
