// 10 · Cost to complete for Job 2214 on Mon Nov 9. Columns add up: budget
// $338,288, actual $192,770, forecast $337,960; margin (433,920 − 337,960) /
// 433,920 = 22.1% against the bid's (433,920 − 338,288) / 433,920 = 22.0%.
import { Copy, Done, Section, Segs } from '../parts'

const codes = [
  ['01-000', 'General conditions', '$38,400', '$24,610', '$38,400'],
  ['06-100 / 05-120', 'Framing, steel and lumber', '$61,380', '$58,870', '$60,180'],
  ['07-300', 'Roofing', '$18,900', '$18,900', '$18,900'],
  ['08-500 / 08-610', 'Windows and skylight', '$29,640', '$29,640', '$29,640'],
  ['07-460', 'Siding', '$24,800', '$12,400', '$24,800'],
  ['15-100 / 16-100', 'Plumbing and electrical', '$41,300', '$27,050', '$41,300'],
  ['09-000', 'Interior finishes', '$123,868', '$21,300', '$124,740'],
]

export function JobCost() {
  return <Section id="job-cost" tone="sea" className="jobcost">
    <div className="jobcost-copy">
      <Copy eyebrow="Job cost · Mon Nov 9" title={<>Bid 22.0%. <br />Forecast 22.1%.</>}>Bills, crew time and QuickBooks actuals post to cost codes. The forecast shows where every number came from.</Copy>
      <div className="card agent-card">
        <p className="note-title"><i className="dot dot-blue" aria-hidden="true" />Forecast agent</p>
        <p><Segs>{['Peak Electric bill 3317', '$7,140.00 came in twice, by email and portal.']}</Segs> Second copy held, not posted.</p>
        <p className="agent-foot"><Segs>{['Framing closed at 418 of 440 hrs', '−$1,200.00']}</Segs></p>
      </div>
    </div>
    <div className="card ctc-card">
      <h3><Segs>{['Job 2214', 'cost to complete']}</Segs></h3>
      <p className="muted"><Segs>{['Contract $433,920.00', 'synced with QuickBooks Online 6:12 am']}</Segs></p>
      <div className="table-scroll">
        <table className="tbl ctc">
          <thead><tr><th>Cost code</th><th>Budget</th><th>Actual to date</th><th>Forecast</th></tr></thead>
          <tbody>{codes.map(([code, name, budget, actual, forecast]) => <tr key={code}><td><span className="code">{code}</span> <span className="code-name">{name}</span></td><td data-label="Budget">{budget}</td><td data-label="Actual">{actual}</td><td data-label="Forecast">{forecast}</td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td data-label="Budget">$338,288</td><td data-label="Actual">$192,770</td><td data-label="Forecast">$337,960</td></tr></tfoot>
        </table>
      </div>
      <p className="ok banner"><Done className="big" /><Segs>{['Forecast margin 22.1%', 'bid 22.0%']}</Segs></p>
    </div>
  </Section>
}
