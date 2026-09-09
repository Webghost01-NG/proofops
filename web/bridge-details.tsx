import type { Attempt, CaseRecord } from '../src/types';
import { bridgeSummary, burnCandidates } from '../src/evidence-view';

export function BridgeDetails({ record, attempt, onReuse }: { record: CaseRecord; attempt?: Attempt; onReuse: (index?: number) => void }) {
  const bridge = record.input.bridge!;
  const candidates = burnCandidates(attempt);
  const needsSelection = attempt?.observations.some(o => o.code === 'BRIDGE_LOG_SELECTION_REQUIRED');
  const selection = attempt?.observations.find(o => o.code === 'BRIDGE_BURN_SELECTED')?.evidence?.selection as { recipient: string; amount: string; logIndex: number } | undefined;
  const snapshot = attempt?.observations.find(o => o.evidence?.snapshot)?.evidence?.snapshot as { targetOwner?: string; wrappedToken?: string; minterRole?: boolean } | undefined;
  return <section className="panel bridge-details" aria-label="Bridge inspection">
    <div className="panel-heading"><div><h2>Bridge inspection</h2><p>Sepolia → Creditcoin testnet · pinned Attestcoin bridge</p></div></div>
    <div className="bridge-results">{bridgeSummary(attempt).map(item => <div key={item.label} className={`bridge-result result-${item.outcome}`}><h3>{item.label}</h3><p>{item.value}</p></div>)}</div>
    <dl className="bridge-facts">
      <div><dt>Source emitter</dt><dd>{bridge.sourceEmitter}</dd></div>
      <div><dt>Destination minter</dt><dd>{bridge.minter}</dd></div>
      <div><dt>Expected wrapped token</dt><dd>{bridge.expectedWrappedToken}</dd></div>
      <div><dt>Simulation caller</dt><dd>{bridge.caller}</dd></div>
      {record.input.destinationTx && <div><dt>Destination transaction</dt><dd>{record.input.destinationTx}</dd></div>}
      {selection && <><div><dt>Burn recipient</dt><dd>{selection.recipient}</dd></div><div><dt>Raw amount (base units)</dt><dd>{selection.amount}</dd></div></>}
      {snapshot?.targetOwner && <div><dt>Target owner (registration signer)</dt><dd>{snapshot.targetOwner}</dd></div>}
      {snapshot?.wrappedToken && <div><dt>Observed emitter mapping</dt><dd>{snapshot.wrappedToken}</dd></div>}
      {snapshot?.minterRole !== undefined && <div><dt>Minter role on expected token</dt><dd>{snapshot.minterRole ? 'Granted' : 'Missing'}</dd></div>}
    </dl>
    {candidates.length > 0 && <div className="burn-selection"><h3>Burn candidates in receipt order</h3><p>The contract uses the first matching burn. Later events cannot be selected.</p>
      <ol>{candidates.map((c, i) => <li key={`${c.receiptOffset}-${c.logIndex}`}><strong>Global log {c.logIndex}</strong> · receipt offset {c.receiptOffset} · {i === 0 ? 'First match' : 'Not executable'}<code>{c.address}</code></li>)}</ol>
      {needsSelection && <button className="primary-button" onClick={() => onReuse(candidates[0].logIndex)}>Use first burn in new inspection</button>}
    </div>}
    <div className="bridge-reuse"><button className="secondary-button" onClick={() => onReuse()}>Use inputs in new inspection</button><p>Change context or attach a destination transaction in a new case. Rerun checks keeps these inputs and adds an attempt.</p></div>
  </section>;
}
