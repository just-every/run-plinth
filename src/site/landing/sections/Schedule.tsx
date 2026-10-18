// 02 · Rosa's Gantt for Job 2214 on Mon Oct 12, built from the records table:
// the signed baseline (Fri Aug 14) ghosted under the current bars, CO 7's two
// days, the inspection chain and the oxblood handover on Fri Dec 18.
import { Gantt, day, type Link, type Row } from '../gantt'
import { Copy, Section, Tick } from '../parts'

export const WEEKS = ['Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9', 'Nov 16', 'Nov 23', 'Nov 30', 'Dec 7', 'Dec 14']
const confirmed = (at: number) => ({ t: 'chip' as const, at, children: <>Confirmed <Tick /></> })
const span = (m1: number, d1: number, m2: number, d2: number) => [day(m1, d1), day(m2, d2) + 1] as const
const bar = (m1: number, d1: number, m2: number, d2: number, kind?: 'olive') => { const [from, to] = span(m1, d1, m2, d2); return { t: 'bar' as const, from, to, kind } }
const ghost = (m1: number, d1: number, m2: number, d2: number) => { const [from, to] = span(m1, d1, m2, d2); return { t: 'ghost' as const, from, to } }
const HANDOVER = day(12, 18) + .5

const rows: Row[] = [
  { name: 'Rough-ins', who: 'Peak Electric, Riverbend Plumbing', items: [ghost(10, 12, 10, 16), bar(10, 12, 10, 16), confirmed(6.3)] },
  { name: 'Skylight framing', who: 'CO 7', items: [bar(10, 15, 10, 16, 'olive'), { t: 'note', at: 6.3, kind: 'olive', children: '+2 days' }] },
  { name: 'Framing inspection', items: [{ t: 'diamond', at: day(10, 21) + .2 }] },
  { name: 'Windows', who: 'Northfield Window Supply', items: [ghost(10, 19, 10, 21), bar(10, 19, 10, 21), confirmed(14.1)] },
  { name: 'Insulation', items: [ghost(10, 20, 10, 21), bar(10, 22, 10, 23)] },
  { name: 'Siding', who: 'Larkin Exteriors', items: [ghost(10, 26, 11, 6), bar(10, 26, 11, 6), confirmed(26.9)] },
  { name: 'Roofing', who: 'Halvorsen Roofing', items: [ghost(11, 2, 11, 5), bar(11, 2, 11, 5), confirmed(25.9)] },
  { name: 'Drywall', items: [ghost(10, 22, 11, 11), bar(10, 26, 11, 13)] },
  { name: 'Finish carpentry', items: [ghost(11, 12, 11, 23), bar(11, 16, 11, 25)] },
  { name: 'Tile', who: 'Mendoza Tile', items: [ghost(11, 24, 12, 2), bar(11, 30, 12, 4), confirmed(55.3)] },
  { name: 'Paint and punch', items: [ghost(12, 3, 12, 10), bar(12, 7, 12, 14), { t: 'bar', from: day(12, 15), to: day(12, 18), kind: 'float' }, { t: 'diamond', at: HANDOVER, kind: 'ox' },
    { t: 'note', at: HANDOVER + .4, place: 'above', align: 'right', kind: 'ink', children: 'Float 3 days' }, { t: 'note', at: HANDOVER + 1.6, place: 'below', align: 'right', kind: 'ox', children: 'Handover · Fri Dec 18' }] },
]
const INSPECTION = day(10, 21) + .2
const links: Link[] = [
  { from: [0, 5], to: [2, INSPECTION - .55], via: 5.5 },
  { from: [1, 5], to: [2, INSPECTION - .55], via: 5.5 },
  { from: [2, INSPECTION], to: [4, day(10, 22)], via: INSPECTION },
  { from: [3, day(10, 22)], to: [5, day(10, 26)], via: 13.4 },
  { from: [4, day(10, 24)], to: [7, day(10, 26)], via: 12.4 },
  { from: [7, day(11, 14)], to: [8, day(11, 16)], via: 33.6 },
  { from: [8, day(11, 26)], to: [9, day(11, 30)], via: 45.6 },
  { from: [9, day(12, 5)], to: [10, day(12, 7)], via: 54.6 },
]

export function Schedule() {
  return <Section id="schedule" className="schedule">
    <Copy eyebrow="Job 2214 · Schedule · Mon Oct 12" title="Every trade on one schedule.">Rosa's plan for the Alvarez job: dependencies, the signed baseline, trade confirmations and three days of float.</Copy>
    <p className="views" aria-hidden="true"><span className="on">Gantt</span><span>List</span><span>Calendar</span></p>
    <div className="card gantt-card">
      <p className="legend"><span><i className="sw sw-ghost" />Baseline · signed Fri Aug 14</span><span><i className="sw sw-blue" />Current</span><span><i className="sw sw-float" />Float</span></p>
      <Gantt weeks={WEEKS} rows={rows} links={links} className="g-plan" label="Job 2214 Gantt, Oct 12 to Dec 18: rough-ins, skylight framing and the framing inspection on Wed Oct 21, windows, insulation, siding, roofing, drywall, finish carpentry, tile, then paint and punch, three days of float and the handover on Fri Dec 18.">
        <p className="g-swipe" aria-hidden="true">Swipe for Nov 2 – Dec 18 ›</p>
      </Gantt>
      <p className="card-foot">11 tasks · 6 trades confirmed · 0 conflicts across 8 jobs</p>
    </div>
  </Section>
}
