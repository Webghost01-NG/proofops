import { Fragment, getAddress, Interface } from 'ethers';
import type { CallInput, CaseInput } from './types.js';

export class InputError extends Error {}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

export function hash(value: unknown, label = 'Transaction hash'): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new InputError(`${label} must be 0x followed by 64 hexadecimal characters.`);
  }
  return value.toLowerCase();
}

export function address(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new InputError(`${label} must be an Ethereum address.`);
  try { return getAddress(value); } catch { throw new InputError(`${label} is not a valid address.`); }
}

export function callInput(value: unknown): CallInput {
  const raw = object(value);
  const to = address(raw.to, 'Destination');
  const from = address(raw.from, 'Caller');
  if (typeof raw.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw.data) || raw.data.length > 262146) {
    throw new InputError('Call data must be even-length hexadecimal, up to 128 KiB.');
  }
  if (raw.value !== undefined && (typeof raw.value !== 'string' || !/^\d{1,78}$/.test(raw.value) || BigInt(raw.value) >= 2n ** 256n)) {
    throw new InputError('Call value must be a non-negative decimal uint256 string.');
  }
  let abi: CallInput['abi'];
  if (raw.abi !== undefined) {
    if (!Array.isArray(raw.abi) || raw.abi.length > 300 || raw.abi.some(x => typeof x !== 'string' && (!x || typeof x !== 'object' || Array.isArray(x)))) {
      throw new InputError('ABI must be a JSON array of at most 300 fragments.');
    }
    // Interface logs warnings for invalid individual fragments, so validate each one strictly.
    try {
      for (const fragment of raw.abi) Fragment.from(fragment);
      new Interface(raw.abi);
    } catch { throw new InputError('ABI contains an invalid fragment.'); }
    abi = raw.abi;
  }
  return { to, from, data: raw.data.toLowerCase(), value: (raw.value as string | undefined) ?? '0', ...(abi ? { abi } : {}) };
}

export function caseInput(value: unknown): CaseInput {
  const raw = object(value);
  return {
    sourceTx: hash(raw.sourceTx),
    ...(raw.destinationTx !== undefined ? { destinationTx: hash(raw.destinationTx, 'Destination transaction hash') } : {}),
    ...(raw.call !== undefined ? { call: callInput(raw.call) } : {})
  };
}

export function publicError(error: unknown): string {
  return error instanceof InputError ? error.message : 'The operation could not complete. Check local configuration and try again.';
}

export function json(value: unknown): string {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
}
