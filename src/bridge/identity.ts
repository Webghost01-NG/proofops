import { keccak256, zeroPadValue } from 'ethers';
import { VERIFIER } from './abi.js';
import { runtimes } from './runtimes.js';
import type { BlockRef } from '../network.js';
import type { IdentityCheck } from './types.js';

// Only the exact solc 0.8.30 IPFS CBOR trailer is metadata. Executable bytes are never masked.
function executable(code: string): string | null {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(code)) return null;
  const match = /a2646970667358221220[0-9a-f]{64}64736f6c634300081e0033$/i.exec(code);
  return match ? code.slice(0, match.index).toLowerCase() : null;
}

export function referenceRuntime(role: IdentityCheck['role']): string {
  const reference = runtimes[role];
  let code = reference.bytecode.toLowerCase();
  const verifier = zeroPadValue(VERIFIER, 32).slice(2).toLowerCase();
  for (const start of reference.verifierOffsets) {
    const offset = 2 + start * 2;
    code = code.slice(0, offset) + verifier + code.slice(offset + 64);
  }
  return code;
}

export function checkIdentity(role: IdentityCheck['role'], address: string, block: BlockRef, code: string): IdentityCheck {
  const expected = referenceRuntime(role);
  const observedExecutable = executable(code);
  const expectedExecutable = executable(expected)!;
  return {
    role, address, block, verified: observedExecutable !== null && observedExecutable === expectedExecutable,
    observedCodeHash: keccak256(code), expectedCodeHash: keccak256(expected),
    observedExecutableHash: observedExecutable === null ? null : keccak256(observedExecutable),
    expectedExecutableHash: keccak256(expectedExecutable), artifactSha256: runtimes[role].artifactSha256
  };
}

export function identityVerified(snapshot: { identities: IdentityCheck[] }): boolean {
  return ['source', 'minter', 'wrapped'].every(role => snapshot.identities.filter(i => i.role === role && i.verified).length === 1);
}
