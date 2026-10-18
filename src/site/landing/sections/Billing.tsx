// 05 · Pay app 4 against the schedule of values, from issue to QuickBooks sync.
// Lines: 48% × $72,000 = $34,560; 100% × $9,850; 100% × $3,240; 32% × $27,875 = $8,920;
// 25% × $24,880 = $6,220; together $62,790.00, less 5% retainage $3,139.50 = $59,650.50.
import { Copy, Done, Icon, Section, Segs } from '../parts'

const lines = [
  ['06-100 Framing', '$72,000.00', '48%', '$34,560.00'],
  ['05-120 Steel beam and posts', '$9,850.00', '100%', '$9,850.00'],
  ['CO 7 Skylight', '$3,240.00', '100%', '$3,240.00'],
  ['16-100 Electrical rough-in', '$27,875.00', '32%', '$8,920.00'],
  ['15-100 Plumbing rough-in', '$24,880.00', '25%', '$6,220.00'],
]

export function Billing() {
  return <Section id="billing" className="billing">
    <div className="card payapp">
      <h3><Segs>{['Pay app 4', 'Job 2214', 'period Oct 1 – Oct 16']}</Segs></h3>
      <div className="table-scroll">
        <table className="tbl sov">
          <thead><tr><th>Line</th><th>Scheduled value</th><th>% this period</th><th>This period</th></tr></thead>
          <tbody>{lines.map(([line, value, share, amount]) => <tr key={line}><td>{line}</td><td data-label="Scheduled">{value}</td><td data-label="This period">{share}</td><td>{amount}</td></tr>)}</tbody>
        </table>
      </div>
      <dl className="due">
        <div><dt>Work this period</dt><dd>$62,790.00</dd></div>
        <div><dt>Retainage 5%</dt><dd>− $3,139.50</dd></div>
        <div className="due-total"><dt>Amount due</dt><dd>$59,650.50</dd></div>
      </dl>
      <p className="card-foot"><Segs>{['Billed to date $159,200.00 of $433,460.00', 'retainage held $7,960.00']}</Segs></p>
    </div>
    <ol className="steps-rail">
      <li className="card"><Icon name="doc" /><span>Issued Mon Oct 19, <span className="seg">8:30 am ·</span> in Ana's portal</span></li>
      <li className="card"><Icon name="bank" /><span><Segs>{['ACH started by Ana', 'Tue Oct 20']}</Segs></span></li>
      <li className="card"><Done /><span><Segs>{['ACH paid Fri Oct 23', '$59,650.50']}</Segs></span></li>
      <li className="card"><Done /><span><span className="seg">QuickBooks Online ·</span> invoice and payment synced</span></li>
    </ol>
    <Copy eyebrow="Progress billing · Mon Oct 19 – Fri Oct 23" title={<>Billed Monday. <br />Paid Friday.</>}>Pay app 4 bills the period's work against the schedule of values, holds 5% retainage and goes to Ana's portal for card or ACH.</Copy>
  </Section>
}
