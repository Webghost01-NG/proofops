export class NetworkFailure extends Error {
  constructor(public kind: 'transport' | 'rpc' | 'revert' | 'malformed' | 'wrong-network', public data?: string) {
    super(kind);
  }
}

function hex(value: unknown): value is string {
  return typeof value === 'string' && /^0x(?:[\da-fA-F]{2})*$/.test(value);
}

export async function rpc(url: string, method: string, params: unknown[], timeoutMs: number): Promise<any> {
  // Only explicit read-only methods are exposed even when called from another module.
  if (!['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getCode', 'eth_call'].includes(method)) {
    throw new NetworkFailure('rpc');
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs), redirect: 'error'
    });
  } catch { throw new NetworkFailure('transport'); }
  if (!response.ok) throw new NetworkFailure('transport');
  let result: any;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
    result = JSON.parse(Buffer.concat(chunks).toString());
  } catch { throw new NetworkFailure('malformed'); }
  if (result?.jsonrpc !== '2.0' || result.id !== 1) throw new NetworkFailure('malformed');
  if (result.error) {
    const error = result.error;
    const data = hex(error.data) ? error.data : hex(error.data?.data) ? error.data.data : undefined;
    const reverted = method === 'eth_call' && (error.code === 3 || ([-32000, -32015, -32603].includes(error.code) && /revert/i.test(String(error.message))));
    throw new NetworkFailure(reverted ? 'revert' : 'rpc', reverted ? data : undefined);
  }
  if (!('result' in result)) throw new NetworkFailure('malformed');
  return result.result;
}
