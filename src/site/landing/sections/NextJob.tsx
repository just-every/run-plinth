// 11 · The Lindqvist kitchen: Hannah's takeoff on sheet A-2 rev B (drawn to
// scale: 15'-6" × 12'-0" = 186 sq ft; base runs 13'-0" + 6'-0" + 5'-0" = 24 lin
// ft), three countertop bids levelled, and the e-signed proposal.
import { Arrow, Chip, Copy, Done, Icon, Section, Segs, Tick } from '../parts'

const FT = 20 // px per foot in the drawing
function Takeoff() {
  const W = 15.5 * FT, H = 12 * FT, D = 2 * FT, ox = 58, oy = 46
  const dim = (x1: number, y1: number, x2: number, y2: number, label: string, lx: number, ly: number, vertical = false) => <g className="dim-line">
    <path d={`M${x1} ${y1}L${x2} ${y2}`} /><path d={vertical ? `M${x1 - 5} ${y1}h10M${x2 - 5} ${y2}h10` : `M${x1} ${y1 - 5}v10M${x2} ${y2 - 5}v10`} />
    <text x={lx} y={ly} transform={vertical ? `rotate(-90 ${lx} ${ly})` : undefined}>{label}</text></g>
  return <svg className="takeoff" viewBox="0 0 420 330" role="img" aria-label={`Plan of the Lindqvist kitchen, 15 ft 6 in by 12 ft: base cabinets 13 ft along the top wall with the sink and range, 6 ft down the left wall and 5 ft down the right wall, the door at lower right.`}>
    <defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v5" stroke="#0a5482" strokeWidth="1" /></pattern></defs>
    <g transform={`translate(${ox} ${oy})`}>
      <path className="wall" d={`M-8 -8H${W + 8}V${H + 8}H${W - 1.5 * FT}V${H}H${W}V0H0V${H - 3.4 * FT}H-8z`} fill="url(#hatch)" />
      <path className="wall" d={`M-8 ${H - 0.6 * FT}H0V${H}H${2.4 * FT}V${H + 8}H-8z`} fill="url(#hatch)" />
      <g className="cab"><rect x="0" y="0" width={13 * FT} height={D} /><rect x="0" y={D} width={D} height={6 * FT - D} /><rect x={W - D} y="0" width={D} height={5 * FT} /></g>
      <path className="front" d={`M${D} ${D}H${13 * FT}M${D} ${D}V${6 * FT}M${W - D} ${D}V${5 * FT}`} />
      <g className="sink"><rect x={4.6 * FT} y={5} width={2.6 * FT} height={D - 10} rx="3" /><path d={`M${5.9 * FT} 5v${D - 10}`} /><circle cx={5.25 * FT} cy={D / 2 + 1} r="2.5" /><circle cx={6.55 * FT} cy={D / 2 + 1} r="2.5" /></g>
      <g className="range"><rect x={9.6 * FT} y={4} width={2.4 * FT} height={D - 8} rx="2" />{[[10.2, .6], [11.4, .6], [10.2, 1.4], [11.4, 1.4]].map(([x, y], i) => <circle key={i} cx={x * FT} cy={y * FT} r="5.5" />)}</g>
      <path className="door" d={`M${W} ${H - 0.1 * FT}h${-3 * FT}M${W} ${H - 0.1 * FT}m${-3 * FT} 0a${3 * FT} ${3 * FT} 0 0 1 ${3 * FT} ${-3 * FT}`} />
      {dim(0, -26, W, -26, `15'-6"`, W / 2, -32)}
      {dim(D, D + 16, 13 * FT, D + 16, `13'-0"`, (D + 13 * FT) / 2, D + 34)}
      {dim(-30, 0, -30, H, `12'-0"`, -36, H / 2, true)}
      {dim(D + 14, D, D + 14, 6 * FT, `6'-0"`, D + 28, (D + 6 * FT) / 2, true)}
      {dim(W + 22, 0, W + 22, 5 * FT, `5'-0"`, W + 36, 2.5 * FT, true)}
    </g>
  </svg>
}
const bids = [
  { name: 'Northstar Stone', price: '$9,880.00', awarded: true },
  { name: 'Granite City Surfaces', price: '$10,450.00' },
  { name: 'Lake Street Quartz', price: '$9,640.00', note: 'Excludes sink cutout and template' },
]

export function NextJob() {
  return <Section id="next-job" className="nextjob">
    <Copy eyebrow="The next job · Thu Nov 12" title="Measured on the plans. Signed online.">Hannah measures the Lindqvist kitchen on the drawings, levels three countertop bids and sends one proposal. Signed, it becomes the budget, schedule and billing plan.</Copy>
    <div className="nextjob-row">
      <div className="card takeoff-card">
        <Takeoff />
        <dl className="stats"><div><dt>Floor</dt><dd>186 sq ft</dd></div><div><dt>Base cabinets</dt><dd>24 lin ft</dd></div><div><dt>Backsplash</dt><dd>42 sq ft</dd></div></dl>
        <p className="card-foot"><Segs>{['Sheet A-2 rev B', '1/4 in = 1 ft-0 in']}</Segs></p>
      </div>
      <Arrow className="flow" />
      <div className="card bids-card">
        <h3><Segs>{['Countertops', '3 bids']}</Segs></h3>
        <ul className="bids">{bids.map(bid => <li key={bid.name} className={bid.awarded ? 'awarded' : ''}><div><span>{bid.name}</span><b>{bid.price}</b>{bid.note && <span className="ox-text bid-note"><i className="dot dot-ox" aria-hidden="true" />{bid.note}</span>}</div>{bid.awarded && <Chip kind="pale">Awarded <Tick /></Chip>}</li>)}</ul>
      </div>
      <Arrow className="flow" />
      <div className="card proposal-card">
        <h3><Segs>{['Proposal', <span className="soft-title">Job 2231 Lindqvist kitchen</span>]}</Segs></h3>
        <p className="price"><Segs>{['$96,480.00', <span className="soft-title">fixed price</span>]}</Segs></p>
        <p className="muted big-muted">Margin 23.0%</p>
        <p className="ok"><Done /><Segs>{['E-signed by Karin Lindqvist', <>Thu Nov 12, 6:20 pm <Tick /></>]}</Segs></p>
        <ul className="becomes">
          <li><Icon name="doc" /><Segs>{['Budget', '14 cost codes']}</Segs></li>
          <li><Icon name="calendar" /><Segs>{['Schedule', 'starts Mon Jan 11']}</Segs></li>
          <li><Icon name="card" /><Segs>{['Deposit invoice', '$9,648.00']}</Segs></li>
        </ul>
      </div>
    </div>
  </Section>
}
