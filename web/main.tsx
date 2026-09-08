import React, { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { CaseRecord, Observation, ReadinessCheck, Stage } from '../src/types';
import './style.css';

type Config = { sourceConfigured: boolean; sourceChainId: number; creditcoinChainId: number; sourceChainKey: number; networkLabel: string };
type Page = 'overview' | 'cases' | 'network';

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    trace: <><path d="M5 5v10a4 4 0 0 0 4 4h10M5 5h14v14" /><circle cx="5" cy="5" r="2" /><circle cx="19" cy="19" r="2" /><path d="m9 13 3-3 3 3" /></>,
    network: <><circle cx="12" cy="5" r="3" /><circle cx="5" cy="18" r="3" /><circle cx="19" cy="18" r="3" /><path d="m10.5 8-4 7m7-7 4 7M8 18h8" /></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4m0 3v1" /></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
    book: <><path d="M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3Zm0 14h16M8 7h8m-8 4h6" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M15 8V4H4v11h4" /></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.trace}</svg>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  let result;
  try { result = await response.json(); } catch { throw new Error('The local service returned an unreadable response.'); }
  if (!response.ok) throw new Error(result.error ?? 'The local service could not complete this request.');
  return result;
}
const post = (body: unknown = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const time = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const labels: Record<string, string> = { ready: 'Proof verified', running: 'Inspecting', waiting: 'Waiting', blocked: 'Needs setup', failed: 'Attention', incomplete: 'Incomplete', interrupted: 'Interrupted' };
const stages: { key: Stage; label: string }[] = [
  { key: 'source', label: 'Source transaction' }, { key: 'attestation', label: 'Attestation' },
  { key: 'proof', label: 'Proof generation' }, { key: 'verification', label: 'Native verification' },
  { key: 'simulation', label: 'Destination simulation' }, { key: 'destination', label: 'Destination receipt' }
];

function Badge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}><span className="badge-dot" />{labels[status] ?? status}</span>;
}

function ObservationCard({ observation }: { observation: Observation }) {
  const o = observation;
  return <article className={`observation observation-${o.outcome}`}>
    <div className="observation-icon"><Icon name={o.outcome === 'pass' ? 'check' : o.outcome === 'wait' ? 'clock' : o.outcome === 'fail' || o.outcome === 'unavailable' ? 'alert' : 'search'} size={16} /></div>
    <div className="observation-content"><div className="observation-title"><h3>{o.title}</h3><span className="evidence-kind">{o.kind}</span></div><p>{o.detail}</p>
      {o.evidence && <details><summary>View evidence <span>{o.code}</span></summary><pre>{JSON.stringify(o.evidence, null, 2)}</pre></details>}
    </div>
  </article>;
}

function App() {
  const [page, setPage] = useState<Page>('overview');
  const [config, setConfig] = useState<Config | null>(null);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selected, setSelected] = useState<CaseRecord | null>(null);
  const [attemptIndex, setAttemptIndex] = useState(-1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hash, setHash] = useState('');
  const [destinationHash, setDestinationHash] = useState('');
  const [callJson, setCallJson] = useState('');
  const [query, setQuery] = useState('');
  const [checks, setChecks] = useState<ReadinessCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const selectedId = useRef<string | null>(null);
  const hashInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const [configuration, records] = await Promise.all([api<Config>('/config', { signal: controller.signal }), api<CaseRecord[]>('/cases', { signal: controller.signal })]);
        if (controller.signal.aborted) return;
        setConfig(configuration); setCases(records); setLoading(false);
        const id = selectedId.current;
        if (id) {
          const detail = await api<CaseRecord>(`/cases/${id}`, { signal: controller.signal });
          if (!controller.signal.aborted && selectedId.current === id) setSelected(detail);
        }
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setLoading(false); } }
      finally { busy = false; }
    };
    void refresh();
    const interval = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 3000);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  async function selectCase(id: string) {
    selectedId.current = id; setAttemptIndex(-1); setError(''); setPage('cases');
    try { const record = await api<CaseRecord>(`/cases/${id}`); if (selectedId.current === id) setSelected(record); }
    catch (e) { setError((e as Error).message); }
  }

  async function inspect(event: FormEvent) {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      let call;
      if (callJson.trim()) { try { call = JSON.parse(callJson); } catch { throw new Error('Destination call must be valid JSON.'); } }
      const record = await api<CaseRecord>('/cases', post({ sourceTx: hash.trim(), ...(destinationHash.trim() ? { destinationTx: destinationHash.trim() } : {}), ...(callJson.trim() ? { call } : {}) }));
      selectedId.current = record.id; setSelected(record); setAttemptIndex(-1); setPage('cases');
      setCases(await api<CaseRecord[]>('/cases'));
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }

  async function rerun() {
    if (!selected) return;
    setError(''); setSubmitting(true);
    try { setSelected(await api<CaseRecord>(`/cases/${selected.id}/rerun`, post())); setAttemptIndex(-1); }
    catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }

  async function checkNetworks() {
    setChecking(true); setError('');
    try { setChecks(await api<ReadinessCheck[]>('/doctor', post())); }
    catch (e) { setError((e as Error).message); }
    finally { setChecking(false); }
  }

  function newCase() {
    setPage('overview'); selectedId.current = null; setSelected(null); setNotice('');
    setTimeout(() => hashInput.current?.focus(), 0);
  }

  async function copyCommand() {
    try { await navigator.clipboard.writeText('node dist/cli.js inspect --source-tx <hash>'); setNotice('CLI command copied.'); }
    catch { setNotice('Run: node dist/cli.js inspect --source-tx <hash>'); }
  }

  const latest = selected?.attempts.at(-1);
  const attempt = attemptIndex < 0 ? latest : selected?.attempts[attemptIndex];
  const filtered = cases.filter(c => `${c.input.sourceTx} ${c.id} ${c.attempts.at(-1)?.status}`.toLowerCase().includes(query.toLowerCase()));
  const verified = cases.filter(c => c.attempts.at(-1)?.observations.some(o => o.code === 'PROOF_VERIFIED')).length;
  const attention = cases.filter(c => ['blocked', 'failed', 'interrupted'].includes(c.attempts.at(-1)?.status ?? '')).length;

  function caseTable(records: CaseRecord[]) {
    return records.length ? <div className="table-scroll"><table><thead><tr><th>Source transaction</th><th>Status</th><th>Last inspected</th><th><span className="sr-only">Open case</span></th></tr></thead><tbody>{records.map(c => <tr key={c.id}><td><button className="case-link" onClick={() => void selectCase(c.id)}><span className="transaction-icon"><Icon name="trace" size={15} /></span><span>{short(c.input.sourceTx)}<small>{c.sourceChainId === 11155111 ? 'Sepolia' : `Chain ${c.sourceChainId}`} <span aria-hidden="true">→</span> Creditcoin</small></span></button></td><td><Badge status={c.attempts.at(-1)?.status ?? 'incomplete'} /></td><td className="table-time">{time(c.updatedAt)}</td><td><button className="icon-button" aria-label={`Open case ${c.id}`} onClick={() => void selectCase(c.id)}><Icon name="chevron" size={16} /></button></td></tr>)}</tbody></table></div>
      : <div className="empty-state"><div className="empty-icon"><Icon name="trace" size={25} /></div><h3>{query ? 'No matching cases' : 'Your first trace starts here'}</h3><p>{query ? 'Try another transaction hash or case ID.' : 'Inspect a real source transaction to build a timeline of its evidence.'}</p>{!query && <button className="text-button" onClick={newCase}>Inspect a transaction <Icon name="arrow" size={15} /></button>}</div>;
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage('overview')} aria-label="ProofOps overview"><span className="brand-mark">p<span>›</span></span><span>proof<span className="brand-ops">ops</span><small>ATTESTCOIN WORKSPACE</small></span></button>
      <div className="workspace-label">WORKSPACE <span>LOCAL</span></div>
      <nav aria-label="Main navigation">
        <button className={page === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('overview')}><Icon name="grid" />Overview</button>
        <button className={page === 'cases' ? 'nav-item active' : 'nav-item'} onClick={() => { setPage('cases'); selectedId.current = null; setSelected(null); }}><Icon name="trace" />Cases <span className="nav-count">{cases.length}</span></button>
        <button className={page === 'network' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('network')}><Icon name="network" />Network setup</button>
      </nav>
      <div className="sidebar-note"><div className="sidebar-note-icon"><Icon name="shield" size={20} /></div><strong>Evidence, before action.</strong><p>Inspect and simulate with your keys staying in your wallet.</p><span>READ-ONLY BY DESIGN</span></div>
      <div className="sidebar-bottom"><a href="https://docs.attestcoin.org/" target="_blank" rel="noreferrer"><Icon name="book" size={17} />Attestcoin docs<Icon name="external" size={13} /></a><div className="local-user"><span className="avatar">D</span><div>Developer workspace<small>Local installation · v0.1</small></div><span className="live-dot" /></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>{page === 'overview' ? 'Overview' : page === 'network' ? 'Network setup' : selected ? 'Case inspector' : 'Cases'}</strong></div><div className="topbar-right"><span className="network-pill"><span className="network-symbol">◇</span>{config?.networkLabel ?? 'Loading configuration'}</span><span className="local-pill"><span className="live-dot" />Local</span></div></header>
      <main id="main">
        {error && <div className="alert-message" role="alert"><Icon name="alert" /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {notice && <div className="notice-message" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></div>}
        {page === 'overview' && <>
          <div className="page-heading"><div><span className="eyebrow">YOUR CROSS-CHAIN WORKBENCH</span><h1>Follow the proof.</h1><p>Find where a workflow stops. Understand what the evidence says.</p></div><span className="heading-mark" aria-hidden="true"><Icon name="trace" size={46} /></span></div>
          <div className="stats-grid"><div className="stat-card"><span>Saved cases <Icon name="trace" /></span><strong>{loading ? '—' : cases.length}<small>in this workspace</small></strong></div><div className="stat-card"><span>Verified proofs <Icon name="shield" /></span><strong>{loading ? '—' : verified}<small>latest attempts</small></strong></div><div className="stat-card"><span>Needs attention <Icon name="alert" /></span><strong>{loading ? '—' : attention}<small>setup, failures, or interruptions</small></strong></div></div>
          {config && !config.sourceConfigured && <div className="setup-banner"><span className="setup-symbol"><Icon name="network" /></span><div><strong>Connect your source network when you’re ready</strong><p>Your workspace is ready. Add a Sepolia RPC URL to run live inspections.</p></div><button className="text-button" onClick={() => setPage('network')}>View setup <Icon name="arrow" size={16} /></button></div>}
          <div className="inspection-grid">
            <section className="panel inspector-form"><div className="panel-heading"><div><span className="section-number">01 / INSPECT</span><h2>Start with a transaction</h2></div><Icon name="search" size={21} /></div>
              <form onSubmit={inspect}>
                <label htmlFor="source-hash">Source transaction hash</label><div className="hash-input-wrap"><span>0x</span><input ref={hashInput} id="source-hash" value={hash} onChange={e => setHash(e.target.value)} placeholder="Paste the full transaction hash" autoComplete="off" spellCheck={false} required pattern="0x[0-9a-fA-F]{64}" aria-describedby="hash-help" /></div><p className="field-hint" id="hash-help">A mined transaction on your configured source network.</p>
                <details className="advanced"><summary>Destination evidence <span>Optional</span></summary><label htmlFor="destination-hash">Destination transaction hash</label><input id="destination-hash" value={destinationHash} onChange={e => setDestinationHash(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} pattern="0x[0-9a-fA-F]{64}" /><label htmlFor="call-json">Intended destination call · JSON</label><textarea id="call-json" value={callJson} onChange={e => setCallJson(e.target.value)} placeholder={'{ "to": "…", "from": "…", "data": "0x…" }'} rows={4} spellCheck={false} /><p className="field-hint">Include exact call inputs and optionally an ABI to decode contract errors. No private key.</p></details>
                <button className="primary-button inspect-button" disabled={submitting || loading} type="submit">{submitting ? 'Starting inspection…' : 'Inspect transaction'}<Icon name={submitting ? 'clock' : 'arrow'} size={18} /></button><div className="form-footnote"><Icon name="shield" size={13} />Read-only checks. No wallet connection needed.</div>
              </form>
            </section>
            <section className="workflow-card"><div className="workflow-heading"><span className="section-number">02 / UNDERSTAND</span><span className="tiny-tag">THE EVIDENCE PATH</span></div><h2>One transaction.<br />Every checkpoint.</h2><p>Separate source success, proof validity,<br className="desktop-break" /> and application execution.</p><div className="workflow-diagram" aria-label="Source transaction leads to attestation, proof verification, and destination application"><div><span className="diagram-node"><Icon name="network" size={21} /></span><strong>Source</strong><small>Transaction</small></div><span className="diagram-line" /><div><span className="diagram-node accent-node"><Icon name="shield" size={23} /></span><strong>Attestcoin</strong><small>Attest + verify</small></div><span className="diagram-line" /><div><span className="diagram-node"><Icon name="terminal" size={21} /></span><strong>Creditcoin</strong><small>Application</small></div></div><div className="workflow-footer"><span className="workflow-diamond">◇</span><span>Every finding links back to its evidence.</span></div></section>
          </div>
          <section className="panel recent-cases"><div className="panel-heading"><div><h2>Recent cases</h2><p>Your investigation history, saved locally.</p></div><button className="text-button" onClick={() => { setPage('cases'); setSelected(null); selectedId.current = null; }}>View all <Icon name="arrow" size={16} /></button></div>{loading ? <div className="empty-state">Loading local cases…</div> : caseTable(cases.slice(0, 5))}</section>
          <div className="cli-strip"><div><Icon name="terminal" /><span>At home in your terminal, too.</span></div><button onClick={() => void copyCommand()} title="Copy CLI command"><code>proofops inspect --source-tx &lt;hash&gt;</code><Icon name="copy" size={15} /></button></div>
        </>}
        {page === 'network' && <>
          <div className="page-heading"><div><span className="eyebrow">CONNECTIONS & CAPABILITIES</span><h1>Know your environment.</h1><p>Check real responses before drawing conclusions.</p></div><button className="primary-button" disabled={checking} onClick={() => void checkNetworks()}><Icon name={checking ? 'clock' : 'refresh'} />{checking ? 'Checking networks…' : 'Run network checks'}</button></div>
          <section className="panel network-panel"><div className="panel-heading"><div><h2>Connection readiness</h2><p>Provider credentials stay in your local configuration.</p></div><span className="tiny-tag light-tag">READ ONLY</span></div><div className="network-checks">{['Source RPC', 'Creditcoin RPC', 'Chain attestation', 'Proof service'].map(name => {
            const check = checks?.find(c => c.name === name);
            return <div className="network-check" key={name}><span className={`check-icon ${check?.status ?? ''}`}><Icon name={check?.status === 'ready' ? 'check' : check ? 'alert' : 'network'} /></span><div><h3>{name}</h3><p>{checking ? 'Waiting for a bounded network response…' : check?.detail ?? 'Not checked in this session.'}</p></div><span className={`check-label ${check?.status ?? ''}`}>{checking ? 'Checking' : check?.status ?? 'Not checked'}</span></div>;
          })}</div></section>
          <div className="setup-grid"><section className="panel setup-instructions"><span className="section-number">LOCAL CONFIGURATION</span><h2>One endpoint to get started.</h2><p>Copy <code>.env.example</code> to <code>.env</code> in the ProofOps folder. Set your source RPC, then restart the local service.</p><pre>SOURCE_CHAIN_RPC_URL=&lt;your Sepolia URL&gt;</pre><p>Creditcoin RPC and Proof Builder defaults are provided. Network checks verify their actual availability.</p><div className="config-facts"><span>Source EVM chain <strong>{config?.sourceChainId ?? '—'}</strong></span><span>Creditcoin EVM chain <strong>{config?.creditcoinChainId ?? '—'}</strong></span><span>Attestcoin source key <strong>{config?.sourceChainKey ?? '—'}</strong></span></div></section><section className="panel setup-instructions muted-panel"><Icon name="shield" size={28} /><h2>Inspect without a signer.</h2><p>ProofOps reads receipts and performs simulations. Deployments and test transactions use your separate wallet or worker.</p><p>Historical replay depends on provider and runtime support. This version labels simulations as current finalized state.</p><a className="text-button" href="https://github.com/gluwa/attestcoin-protocol-examples" target="_blank" rel="noreferrer">Official setup examples <Icon name="external" size={14} /></a></section></div>
        </>}
        {page === 'cases' && !selected && <><div className="page-heading"><div><span className="eyebrow">INVESTIGATION HISTORY</span><h1>Your cases.</h1><p>Every attempt saved. Every finding open for inspection.</p></div><button className="primary-button" onClick={newCase}><Icon name="plus" />New inspection</button></div><section className="panel"><div className="panel-heading"><h2>All cases <span className="count-label">{cases.length}</span></h2><div className="search-wrap"><Icon name="search" size={16} /><input aria-label="Search cases" placeholder="Search hash, case ID, status…" value={query} onChange={e => setQuery(e.target.value)} /></div></div>{caseTable(filtered)}</section></>}
        {page === 'cases' && selected && <>
          <button className="text-button back-button" onClick={() => { setSelected(null); selectedId.current = null; }}>← All cases</button>
          <div className="page-heading case-heading"><div><span className="eyebrow">CASE / {selected.id.slice(0, 8)}</span><h1>Transaction inspector.</h1><p className="full-hash">{selected.input.sourceTx}</p></div><div className="case-actions"><a className="secondary-button" href={`/api/cases/${selected.id}/export`} download><Icon name="download" />Export evidence</a><button className="primary-button" disabled={submitting || latest?.status === 'running'} onClick={() => void rerun()}><Icon name="refresh" />{latest?.status === 'running' ? 'Inspecting…' : 'Rerun checks'}</button></div></div>
          <div className="case-status-bar"><Badge status={attempt?.status ?? 'incomplete'} /><span>{attempt ? time(attempt.startedAt) : 'Awaiting first attempt'}</span><label htmlFor="attempt-select">Attempt</label><select id="attempt-select" value={attemptIndex} onChange={e => setAttemptIndex(Number(e.target.value))}><option value={-1}>Latest ({selected.attempts.length})</option>{selected.attempts.slice(0, -1).map((a, i) => <option value={i} key={a.id}>{i + 1} · {time(a.startedAt)}</option>)}</select></div>
          <div className="case-layout"><section className="panel evidence-panel"><div className="panel-heading"><div><h2>Evidence timeline</h2><p>Observations and simulations are labeled separately.</p></div><Icon name="trace" /></div>{attempt?.observations.length ? <div className="observations">{attempt.observations.map((o, i) => <ObservationCard key={`${attempt.id}-${i}`} observation={o} />)}</div> : <div className="empty-state"><Icon name="clock" size={28} /><h3>Collecting evidence</h3><p>Checks appear here as they complete.</p></div>}{attempt?.status === 'running' && <div className="progress-note" role="status"><span className="pulse-dot" />Inspection in progress. This view refreshes automatically.</div>}{attempt?.status === 'interrupted' && <div className="progress-note">This attempt was interrupted. Rerun to collect fresh evidence.</div>}</section><aside className="panel checkpoint-panel"><span className="section-number">CHECKPOINTS</span>{stages.map(s => { const o = attempt?.observations.filter(o => o.stage === s.key).at(-1); return <div className={`checkpoint checkpoint-${o?.outcome ?? 'unknown'}`} key={s.key}><span className="checkpoint-dot"><Icon name={o?.outcome === 'pass' ? 'check' : o?.outcome === 'fail' || o?.outcome === 'unavailable' ? 'alert' : 'clock'} size={13} /></span><div>{s.label}<small>{o ? o.outcome === 'pass' ? 'Evidence collected' : o.outcome === 'wait' ? 'Waiting' : o.outcome === 'unknown' ? 'Not supplied' : 'Needs attention' : 'Not evaluated'}</small></div></div>; })}<div className="checkpoint-note"><Icon name="shield" size={17} /><p>A verified proof does not imply completed application execution.</p></div></aside></div>
        </>}
        <footer className="footer"><span><span className="footer-dot" />ProofOps · Developer preview</span><span>Local evidence. Explicit conclusions.</span></footer>
      </main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
