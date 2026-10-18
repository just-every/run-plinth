// 03 · CO 7 priced by cost code, dated within float and e-signed on Ana's phone.
import type { ReactNode } from 'react'
import { Avatar, Copy, Done, Icon, Picture, Section, Segs } from '../parts'
import { SIGNATURE } from '../signature'

const terms: [string, ReactNode][] = [
  ['Scope', 'Fixed skylight 2 × 4 ft over the primary bedroom, framed, flashed and trimmed'],
  ['Cost code', '08-610 Skylights'],
  ['Client price', '$3,240.00'],
  ['Schedule', <Segs>{['+2 days', 'within float (5 → 3 days)']}</Segs>],
  ['Completion', <Segs>{['Fri Dec 18', 'unchanged']}</Segs>],
  ['Contract', <span className="seg">$430,220.00 → $433,460.00</span>],
]

export function Phone({ time, children, className = '' }: { time: string; children: ReactNode; className?: string }) {
  return <div className={`phone ${className}`}><div className="phone-screen"><p className="phone-status"><span>{time}</span><i aria-hidden="true" /></p>{children}</div></div>
}

export function ChangeOrder() {
  return <Section id="change-order" tone="sea" className="change">
    <div className="change-copy">
      <Copy eyebrow="Change order 7 · Mon Oct 12" title="Priced, dated, then signed.">Ana asks for a skylight over the new bedroom. Plinth prices it by cost code, shows the two days it adds and sends it for e-signature.</Copy>
      <Picture className="prop prop-skylight" name="skylight" widths={[600]} sizes="(min-width: 1000px) 520px, 90vw" width={600} height={425} alt="Chalk-line drawing of the skylight framed into the rafters." />
    </div>
    <div className="change-stage">
      <div className="card co-card">
        <h3><Segs>{['Change order 7', 'Job 2214 Alvarez second story']}</Segs></h3>
        <dl className="terms">{terms.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
        <ul className="signers">
          <li><Avatar>AA</Avatar><div><b>Ana Alvarez</b><span>e-signed Mon Oct 12, 7:48 pm</span></div><Done /></li>
          <li><Avatar kind="green">RD</Avatar><div><b>Rosa Delgado</b><span>signed Mon Oct 12, 8:05 pm</span></div><Done /></li>
        </ul>
      </div>
      <p className="internal"><Icon name="lock" /><Segs>{['Internal only', 'cost $2,480.00', 'margin 23.5%']}</Segs></p>
      <Phone time="7:48" className="co-phone">
        <p className="ph-title">Alvarez second story</p>
        <p className="ph-sub"><Segs>{['Change order 7', 'Skylight']}</Segs></p>
        <p className="ph-amount"><Segs>{['$3,240.00', '+2 days']}</Segs></p>
        <p className="ph-sub">Handover stays Fri Dec 18</p>
        <svg className="signature" viewBox={SIGNATURE.viewBox} role="img" aria-label="Signature: Ana Alvarez"><path d={SIGNATURE.d} /></svg>
        <p className="ph-signed">Signed 7:48 pm <Done /></p>
      </Phone>
    </div>
  </Section>
}
