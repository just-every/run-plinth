// 07 · Larkin's lapsed liability certificate: hold, renewal, verification and
// release before their Mon Nov 2 start; lien waivers for pay app 4's subs.
import type { ReactNode } from 'react'
import { Avatar, Copy, Done, Icon, Picture, Section, Segs, Tick } from '../parts'

const events: [string, ReactNode, ReactNode][] = [
  ['ox', <b className="ox-text">General liability expires Sat&nbsp;Oct&nbsp;31</b>, 'start is Mon Nov 2'],
  ['blue', 'Hold placed', 'Mon Oct 26, 8:00 am'],
  ['blue', 'Renewal requested by email and text', 'Mon Oct 26, 8:01 am'],
  ['blue', 'New certificate uploaded', <Segs>{['Wed Oct 28, 2:14 pm', 'to Oct 31, 2027']}</Segs>],
  ['green', 'Verified by Denise Park', <>Wed Oct 28, 3:05 pm <Tick /></>],
]

export function Subs() {
  return <Section id="subcontractors" className="subs">
    <div className="subs-copy">
      <Copy eyebrow="Subcontractors · Mon Oct 26 – Wed Oct 28" title="Insured before they start.">Larkin's liability certificate ran out before their new start. Plinth held the job, asked for the renewal and released it once Denise verified the new one.</Copy>
      <Picture className="prop prop-siding" name="siding" widths={[740]} sizes="(min-width: 1000px) 600px, 90vw" width={740} height={285} alt="Chalk-line drawing of a stack of lap siding boards." />
    </div>
    <div className="subs-stage">
      <div className="card coi-card">
        <h3 className="with-avatar"><Avatar>LE</Avatar><Segs>{['Larkin Exteriors', 'siding', 'Job 2214']}</Segs></h3>
        <ol className="events">{events.map(([dot, what, when], i) => <li key={i} className={`ev-${dot}`}><Segs>{[what, <span className="ev-when">{when}</span>]}</Segs></li>)}</ol>
        <p className="ok wide"><Done /><Segs>{['Hold released', 'start Mon Nov 2 confirmed']}</Segs></p>
        <p className="muted small-note">Workers' comp current to Mar 1, 2027 <Tick /></p>
      </div>
      <div className="card waiver-card">
        <h3 className="with-avatar"><span className="icon-disc"><Icon name="doc" /></span><Segs>{['Lien waivers', 'pay app 4']}</Segs></h3>
        <ul className="waivers">
          <li><Done className="big" /><div><p><Segs>{[<b>Peak Electric</b>, 'bill 3317', '$7,140.00']}</Segs></p><p className="muted"><Segs>{[<>Conditional <Tick /></>, <>Unconditional <Tick /> Wed Oct 28</>]}</Segs></p></div></li>
          <li><span className="ring" aria-hidden="true" /><div><p><Segs>{[<b>Riverbend Plumbing</b>, 'bill 1182', '$4,980.00']}</Segs></p><p className="muted"><Segs>{[<>Conditional <Tick /></>, 'Unconditional requested']}</Segs></p></div></li>
        </ul>
      </div>
    </div>
  </Section>
}
