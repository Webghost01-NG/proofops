import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicConfig } from './config.js';
import { Store } from './store.js';
import { LiveNetwork } from './network.js';
import { assertCaseNetwork, inspectCase } from './engine.js';
import { exportBundle } from './bundle.js';
import { caseInput, InputError, json, publicError } from './validation.js';
import type { NetworkConfig } from './types.js';

async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new InputError('Use application/json.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 512 * 1024) throw new InputError('Request exceeds 512 KiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new InputError('Invalid JSON request.'); }
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json(value));
}

export function makeServer(config: NetworkConfig, store: Store, options: { uiDir?: string } = {}) {
  const uiDir = options.uiDir ?? fileURLToPath(new URL('./ui', import.meta.url));
  const jobs = new Set<Promise<unknown>>();
  let doctorJob: Promise<unknown> | undefined;
  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const port = (server.address() as { port: number } | null)?.port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host ?? '') || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      send(res, 403, { error: 'This service accepts same-origin local requests only.' });
      return;
    }
    try {
      const path = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;
      if (req.method === 'GET' && path === '/api/config') return send(res, 200, publicConfig(config));
      if (req.method === 'GET' && path === '/api/cases') return send(res, 200, store.list().map(c => ({ ...c, attempts: c.attempts.map(a => ({ ...a, observations: a.observations.map(({ evidence, ...o }) => o) })) })));
      if (req.method === 'POST' && path === '/api/doctor') {
        await body(req);
        doctorJob ??= new LiveNetwork(config).doctor().finally(() => { doctorJob = undefined; });
        return send(res, 200, await doctorJob);
      }
      const match = /^\/api\/cases\/([a-f0-9-]{36})(?:\/(rerun|export))?$/.exec(path);
      if (req.method === 'GET' && match) {
        const record = store.get(match[1]);
        if (match[2] === 'export') {
          res.setHeader('content-disposition', `attachment; filename="proofops-${record.id}.json"`);
          return send(res, 200, exportBundle(record));
        }
        if (!match[2]) return send(res, 200, record);
      }
      if (req.method === 'POST' && (path === '/api/cases' || match?.[2] === 'rerun')) {
        const input = await body(req);
        if (jobs.size >= 2) return send(res, 429, { error: 'Two inspections are already running. Wait for one to finish.' });
        const record = match ? store.get(match[1]) : store.create(caseInput(input), config);
        assertCaseNetwork(record, config);
        if (record.attempts.some(a => a.status === 'running')) return send(res, 409, { error: 'This case is already running.' });
        const job = inspectCase(store, record.id, config).catch(() => {
          const current = store.get(record.id).attempts.at(-1);
          if (current?.status === 'running') store.finish(current, 'interrupted');
        }).finally(() => jobs.delete(job));
        jobs.add(job);
        return send(res, 202, store.get(record.id));
      }
      if (path.startsWith('/api/')) return send(res, 404, { error: 'Endpoint not found.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
      const filename = path === '/' ? 'index.html' : decodeURIComponent(path).slice(1);
      const full = resolve(uiDir, filename);
      if (!full.startsWith(resolve(uiDir) + '/') || filename.includes('\0')) return send(res, 404, { error: 'Asset not found.' });
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      if (!mime[extname(full)]) return send(res, 404, { error: 'Asset not found.' });
      try {
        const content = await readFile(full);
        res.writeHead(200, { 'content-type': `${mime[extname(full)]}; charset=utf-8`, 'cache-control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch { send(res, 404, { error: 'Dashboard assets not found. Run npm run build.' }); }
    } catch (error) { send(res, error instanceof InputError ? 400 : 500, { error: publicError(error) }); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return { server, drain: () => Promise.allSettled([...jobs, ...(doctorJob ? [doctorJob] : [])]) };
}
