// 13 · The move from Buildertrend on Fri Oct 9: the migration report (the record
// counts sum to 16,175), Job 2214's opening balances, and the one-line start.
import { Copy, Done, Icon, Section, START, Segs, Tick } from '../parts'

const records = [
  ['Jobs', '8', '8 live'],
  ['Proposals', '23', 'all versions'],
  ['Change orders', '31', 'e-signatures kept'],
  ['Schedule tasks', '412', 'baselines kept'],
  ['Selections', '96', 'choices kept'],
  ['Bills and POs', '1,284', 'QuickBooks links kept'],
  ['Daily logs', '1,906', 'photos kept'],
  ['Files', '12,415', <span className="amber-text"><Segs>{['3 unreadable', 'flagged']}</Segs></span>],
  ['Messages', '—', '2,140 attached as PDF'],
] as const

export function MovingIn() {
  return <Section id="moving-in" tone="sea" className="moving">
    <div className="moving-cards">
      <div className="card report-card">
        <h3><Segs>{['Migration report', 'Buildertrend', 'Fri Oct 9, 4:30 pm']}</Segs></h3>
        <div className="tiles3">
          <div className="stat"><b>16,175</b><span>imported</span><Done /></div>
          <div className="stat"><b>2,140</b><span>attached</span><Icon name="clip" className="clip" /></div>
          <div className="stat"><b>3</b><span>flagged</span><i className="dot dot-amber big-dot" aria-hidden="true" /></div>
        </div>
        <div className="table-scroll">
          <table className="tbl records">
            <thead><tr><th>Record</th><th>Imported</th><th>Note</th></tr></thead>
            <tbody>{records.map(([record, count, note]) => <tr key={record}><td>{record}</td><td>{count}</td><td>{note}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <div className="card balances-card">
        <h3><Segs>{['Opening balances', 'Job 2214 Alvarez']}</Segs></h3>
        <dl className="kv">
          <div><dt>Contract</dt><dd><Segs>{['$430,220.00', 'incl. COs 1–6 $11,620.00']}</Segs></dd></div>
          <div><dt>Pay apps 1–3 billed</dt><dd>$96,410.00</dd></div>
          <div><dt>Retainage held</dt><dd>$4,820.50</dd></div>
          <div><dt>QuickBooks Online</dt><dd className="green-text">matched <Tick /></dd></div>
        </dl>
      </div>
    </div>
    <div className="moving-copy">
      <Copy eyebrow="Moving in · Fri Oct 9" title={<>Eight live jobs, <br />out of Buildertrend.</>}>Plinth reads the Buildertrend exports, attaches what has no home and flags what it could not read. Every balance opens where it left off.</Copy>
      <div className="terminal" role="group" aria-label="Start Plinth on your computer">
        <p className="term-dots" aria-hidden="true"><i /><i /><i /></p>
        <pre><code><span className="prompt" aria-hidden="true">$ </span>{START}{'\n'}<span className="comment"># clones, installs and starts Plinth on your computer</span></code></pre>
      </div>
    </div>
  </Section>
}
