// 08 · The primary bath wall tile against its $3,800.00 allowance, chosen before
// the latest safe decision and carried to PO 2214-31 and the next pay app.
import type { ReactNode } from 'react'
import { Copy, Done, Icon, Section, Segs, Tick } from '../parts'

function Subway() {
  return <svg viewBox="0 0 220 168" aria-hidden="true"><rect width="220" height="168" fill="#f3f4f4" />
    <g fill="none" stroke="#c9ced3" strokeWidth="1.2">{[0, 1, 2, 3, 4, 5].map(r => <g key={r}><path d={`M0 ${r * 33.6}h220`} />{[0, 1, 2, 3, 4].map(c => <path key={c} d={`M${(r % 2 ? 37 : 0) + c * 74} ${r * 33.6}v33.6`} />)}</g>)}</g></svg>
}
function Zellige() {
  const tones = ['#9fd5c4', '#8ccab9', '#aee0cf', '#93cfbf', '#b5e3d3', '#86c4b2', '#a6dacb', '#99d2c1']
  return <svg viewBox="0 0 220 168" aria-hidden="true"><rect width="220" height="168" fill="#e9f3ef" />
    {[0, 1, 2, 3].map(r => [0, 1, 2, 3, 4].map(c => <rect key={`${r}${c}`} x={c * 44 + 1.5} y={r * 42 + 1.5} width="41" height="39" rx="1.5" fill={tones[(r * 5 + c * 3) % tones.length]} opacity={0.82 + ((r + c) % 3) * 0.06} />))}</svg>
}
function Hex() {
  const cells = []
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    const x = c * 40 + (r % 2 ? 20 : 0), y = r * 34
    cells.push(<path key={`${r}${c}`} d={`M${x} ${y - 23}l20 11.5v23L${x} ${y + 23}l-20-11.5v-23z`} />)
  }
  return <svg viewBox="0 0 220 168" aria-hidden="true"><rect width="220" height="168" fill="#c3c7cc" /><g fill="#b4b9bf" stroke="#eef0f2" strokeWidth="2">{cells}</g></svg>
}
const options = [
  { name: 'White subway 3 × 6 in', price: '$3,520.00', swatch: <Subway /> },
  { name: 'Sea-glass zellige 4 × 4 in', price: '$4,260.00', swatch: <Zellige />, chosen: true },
  { name: 'Gray hex 2 in', price: '$3,780.00', swatch: <Hex /> },
]
const steps: [string, ReactNode][] = [
  ['bell', <Segs>{['Tue Oct 27, 9:00 am', 'reminder to Ana and Marco']}</Segs>],
  ['done', <Segs>{['Wed Oct 28, 9:14 pm', 'Ana chose sea-glass zellige']}</Segs>],
  ['doc', <Segs>{['Thu Oct 29, 8:10 am', 'PO 2214-31 sent to Lakeland Tile Supply']}</Segs>],
  ['done', <Segs>{['Thu Oct 29, 11:32 am', 'acknowledged', 'delivers Mon Nov 23']}</Segs>],
  ['dollar', <Segs>{['Next pay app', 'overage $460.00 added']}</Segs>],
]

export function Selections() {
  return <Section id="selections" tone="sea" className="selections">
    <Copy eyebrow="Selections · Tue Oct 27 – Thu Oct 29" title="Ana chose the tile in time.">The agent knows the tile's lead time, asks before the order deadline and carries the choice to the PO and the next pay app.</Copy>
    <div className="selections-row">
      <div className="card tile-card">
        <h3><Segs>{['Primary bath wall tile', 'allowance $3,800.00']}</Segs></h3>
        <ul className="tiles">{options.map(option => <li key={option.name} className={option.chosen ? 'chosen' : ''}><span className="swatch">{option.swatch}{option.chosen && <Done className="swatch-tick" />}</span><span className="tile-name">{option.name}</span><b>{option.price}</b></li>)}</ul>
        <p className="card-foot"><Segs>{['Overage $460.00', 'e-signed by Ana Alvarez', <>Wed Oct 28, 9:14 pm <Tick /></>]}</Segs></p>
      </div>
      <div className="card deadline-card">
        <h3><Segs>{['Latest safe decision', 'Fri Oct 30']}</Segs></h3>
        <p className="muted"><Segs>{['3-week lead time', 'tile starts Mon Nov 30']}</Segs></p>
        <ol className="rail">{steps.map(([icon, text], i) => <li key={i}>{icon === 'done' ? <Done /> : <span className="rail-icon"><Icon name={icon} /></span>}<span>{text}</span></li>)}</ol>
      </div>
    </div>
  </Section>
}
