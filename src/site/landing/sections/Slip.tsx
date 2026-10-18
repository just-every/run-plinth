// 04 · The slip on the deep oxblood field: the Alvarez Gantt as a revision diff.
// Dashed outlines are the schedule before Wed Oct 14, 9:12 am; the windows slide
// to Oct 28–30, roofing comes forward to Oct 19–22, siding moves to Nov 2–13 and
// the handover stays on Fri Dec 18.
import { Gantt, day, type Row } from '../gantt'
import { Avatar, Copy, Section, Segs, Tick } from '../parts'
import { WEEKS } from './Schedule'

const span = (m1: number, d1: number, m2: number, d2: number) => ({ from: day(m1, d1), to: day(m2, d2) + 1 })
const HANDOVER = day(12, 18) + .5
const rows: Row[] = [
  { name: 'Windows', who: 'Northfield Window Supply', items: [{ t: 'ghost', dashed: true, ...span(10, 19, 10, 21) }, { t: 'move', from: 10.4, to: 15.6 }, { t: 'bar', kind: 'ox', ...span(10, 28, 10, 30) }, { t: 'chip', kind: 'ox', at: 19.7, children: '9 days late' }] },
  { name: 'Roofing', who: 'Halvorsen Roofing', items: [{ t: 'bar', ...span(10, 19, 10, 22) }, { t: 'move', from: 20.6, to: 11.4 }, { t: 'ghost', dashed: true, ...span(11, 2, 11, 5) }, { t: 'chip', kind: 'pale', at: 26.2, children: <>Confirmed 11:40 am <Tick /></> }] },
  { name: 'Siding', who: 'Larkin Exteriors', items: [{ t: 'ghost', dashed: true, lane: 'up', ...span(10, 26, 11, 6) }, { t: 'bar', lane: 'down', ...span(11, 2, 11, 13) }, { t: 'chip', kind: 'pale', at: 33.7, children: <>Confirmed 1:15 pm <Tick /></> }] },
  { name: 'Insulation', items: [{ t: 'bar', ...span(10, 22, 10, 23) }] },
  { name: 'Drywall', items: [{ t: 'bar', ...span(10, 26, 11, 13) }] },
  { name: 'Finish carpentry', items: [{ t: 'bar', ...span(11, 16, 11, 25) }] },
  { name: 'Paint and punch', items: [{ t: 'bar', ...span(12, 7, 12, 14) }, { t: 'bar', kind: 'float', from: day(12, 15), to: day(12, 18) }, { t: 'diamond', kind: 'ox', at: HANDOVER },
    { t: 'note', at: HANDOVER + .4, place: 'above', align: 'right', kind: 'ink', children: 'Float 3 days' }, { t: 'note', at: HANDOVER + 1.6, place: 'below', align: 'right', kind: 'ox', children: <><b>Handover · Fri Dec 18</b> · unmoved</> }] },
]

export function Slip() {
  return <Section id="slip" tone="ox" className="slip">
    <div className="slip-head">
      <Copy eyebrow="The slip · Wed Oct 14, 9:12 am" title="Late windows, so the roof goes first.">Northfield ships 12 windows nine days late. The forecast agent swaps the roofer and the sider inside the float, Rosa approves, and the handover stays put.</Copy>
      <div className="slip-notes">
        <div className="card note-card"><p className="note-title"><i className="dot dot-blue" aria-hidden="true" /><span className="seg">Forecast agent · 9:20 am</span></p><p><Segs>{['Recovery A', 'roof first']}</Segs></p><p><Segs>{['Added cost $0.00', 'margin 22.0% → 22.0%']}</Segs></p></div>
        <div className="card note-card approve-card"><Avatar>RD</Avatar><div><p className="note-title">Rosa Delgado approved A</p><p>Wed Oct 14 · 10:05 am</p></div></div>
      </div>
    </div>
    <div className="card gantt-card diff-card">
      <p className="legend"><span><i className="sw sw-dash" />Before · Wed Oct 14, 9:12 am</span><span><i className="sw sw-blue" />Recovery A</span><span><i className="sw sw-ox" />Late</span></p>
      <Gantt weeks={WEEKS} rows={rows} className="g-diff" label="Schedule diff after the window slip: windows move from Oct 19–21 to Oct 28–30, nine days late; roofing moves forward from Nov 2–5 to Oct 19–22, confirmed 11:40 am; siding moves from Oct 26 – Nov 6 to Nov 2–13, confirmed 1:15 pm; insulation, drywall, finish carpentry and paint are unchanged and the handover stays on Fri Dec 18 with three days of float.">
        <p className="g-swipe" aria-hidden="true">Swipe for Nov 16 – Dec 18 ›</p>
      </Gantt>
      <p className="card-foot">Not chosen · Recovery B, wait for windows: handover Mon Dec 28, +$1,620.00, margin 21.7%</p>
    </div>
  </Section>
}
