// 09 · Recovery case 2214-R1: each promise against the record that proves it.
// The tile delivery belongs to the selection, so it stays on the case as an
// assigned residual risk (AGENT-003), not as an open item of the recovery.
import { Chip, Copy, Picture, Section, Segs, Tick } from '../parts'

const promises = [
  ['Halvorsen Roofing on site', 'Mon Oct 19', <Segs>{['7:05 am', 'daily log']}</Segs>],
  ['Roof dried in', 'Thu Oct 22', 'Thu Oct 22, 3:40 pm'],
  ['Windows delivered', 'Wed Oct 28', <Segs>{['Ticket 88412', '12 of 12']}</Segs>],
  ['Windows installed', 'Fri Oct 30', <Segs>{['Fri Oct 30', '8 photos']}</Segs>],
  ['Larkin Exteriors on site', 'Mon Nov 2', <Segs>{['7:10 am', 'daily log']}</Segs>],
  ['Handover', 'Fri Dec 18', <Segs>{['Forecast Fri Dec 18', 'float 3 days']}</Segs>],
  ['Margin', '22.0% bid', '22.1% forecast'],
] as const

export function Verified() {
  return <Section id="verified" className="verified">
    <div className="card case-card">
      <div className="case-head"><div><h3><Segs>{['Recovery 2214-R1', 'roof first']}</Segs></h3><p className="muted"><Segs>{['Opened Wed Oct 14', 'closed Mon Nov 2']}</Segs></p></div><Chip kind="pale">Closed <Tick /></Chip></div>
      <div className="table-scroll">
        <table className="tbl promises">
          <thead><tr><th>Promise</th><th>Promised</th><th>Observed</th></tr></thead>
          <tbody>{promises.map(([promise, promised, observed]) => <tr key={promise}><td>{promise}</td><td data-label="Promised">{promised}</td><td data-label="Observed"><span className="observed">{observed} <Tick className="green" /></span></td></tr>)}</tbody>
        </table>
      </div>
      <p className="residual"><i className="dot dot-amber" aria-hidden="true" /><Segs>{['Residual risk', 'tile delivery Mon Nov 23', 'owner Rosa Delgado']}</Segs></p>
    </div>
    <div className="verified-copy">
      <Copy eyebrow="Verified · Mon Nov 2, 4:30 pm" title={<>Checked <br />until it held.</>}>After Rosa approved the recovery, the agent followed each promise to the record that proves it, then closed the case.</Copy>
      <Picture className="prop prop-window" name="window" widths={[320]} sizes="300px" width={320} height={407} alt="Chalk-line drawing of a double-hung window unit with its delivery tag." />
    </div>
  </Section>
}
