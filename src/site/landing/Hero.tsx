// 01 · The approved elevation (hero-1536) as a clean plate, with the header,
// copy, six cards, their leader lines and the dimension labels set over it in
// HTML at the desk's positions. Under 1180 px the copy, the drawing and the
// cards stack (the 390 plan: the slip card second).
import type { CSSProperties, ReactNode } from 'react'
import { Arrow, DEMO, Icon, Lockup, Picture, Segs, SOURCE, Tick } from './parts'

const seg = (...parts: ReactNode[]) => <Segs>{parts}</Segs>

interface HeroCard { id: string; icon: string; x: number; y: number; w: number; side: 'l' | 'r'; ox?: boolean; title: ReactNode; body: ReactNode; from: [number, number]; to: [number, number] }
// Desk positions on the 1536 × 1024 plate, in the 390 plan's order.
const cards: HeroCard[] = [
  { id: 'job', icon: 'doc', x: 76, y: 421, w: 282, side: 'l', title: <><span className="seg">Job 2214 ·</span> Alvarez <span className="seg">second story ·</span> <span className="seg">$418,600</span></>, body: 'e-signed Fri Aug 14', from: [358, 466], to: [499, 511] },
  { id: 'slip', icon: 'clock', x: 76, y: 676, w: 309, side: 'l', ox: true, title: 'Windows ship 9 days\u00a0late\u00a0→', body: <><span className="seg">siding moved to Mon Nov 2,</span> {seg('roof dried in first', <>handover still Fri Dec 18 <Tick /></>)}</>, from: [385, 722], to: [482, 673] },
  { id: 'co', icon: 'wrench', x: 1155, y: 428, w: 266, side: 'r', title: 'Change order 7', body: seg('skylight $3,240', '+2 days within float', 'e-signed by Ana Alvarez'), from: [1155, 467], to: [1025, 511] },
  { id: 'inspection', icon: 'clipboard', x: 76, y: 565, w: 301, side: 'l', title: 'Framing inspection', body: 'passed Wed Oct 21, 10:40 am', from: [377, 604], to: [528, 591] },
  { id: 'payapp', icon: 'coins', x: 1155, y: 579, w: 280, side: 'r', title: 'Pay app 4', body: <>{seg('$62,790.00 − 5% retainage')} {seg(<>$3,139.50 = $59,650.50</>, <>ACH paid Fri Oct 23 <Tick /></>)}</>, from: [1155, 622], to: [970, 599] },
  { id: 'margin', icon: 'chart', x: 1155, y: 722, w: 252, side: 'r', title: 'Forecast margin', body: seg('22.1%', 'bid 22.0%'), from: [1155, 767], to: [1027, 803] },
]

export function Hero() {
  return <header className="hero" id="top">
    <div className="hero-stage">
      <Picture className="hero-art" name="hero" widths={[768, 1152, 1536]} sizes="(min-width: 1180px) min(100vw, 1680px), 100vw" width={1536} height={1024} eager
        phone={{ name: 'hero-phone', widths: [780, 940], media: '(max-width: 1179px)', width: 940, height: 630 }}
        alt="Front elevation of the Alvarez bungalow in Linden Hills taking a second story: the new framing in pale olive, two carpenters at work, a tree at left and dimension lines at right." />
      <nav className="site-bar" aria-label="Site">
        <Lockup />
        <span className="site-links"><a href="/docs">Docs</a><a href={SOURCE}>Source</a></span>
      </nav>
      <div className="hero-copy">
        <h1>Handover day, right on time.</h1>
        <p className="hero-sub">Plinth carries each job from e-signed estimate through schedule, selections, subs, job costing and progress billing, and plans the recovery when a job slips.</p>
        <p className="hero-alt">100% free, open source alternative to <b>Buildertrend</b>, <b>Procore</b> and <b>Houzz Pro</b>.</p>
        <p className="hero-actions"><a className="btn-run" href="/run">Run Plinth <Arrow /></a><a className="text-link" href={DEMO}>Try the demo</a><a className="text-link" href="/docs">Read the docs</a></p>
      </div>
      <svg className="hero-leaders" viewBox="0 0 1536 1024" aria-hidden="true">
        {cards.map(card => <g key={card.id} className={card.ox ? 'ox' : ''}><line x1={card.from[0]} y1={card.from[1]} x2={card.to[0]} y2={card.to[1]} /><circle cx={card.to[0]} cy={card.to[1]} r="4.6" /></g>)}
      </svg>
      <span className="dim dim-plate" aria-hidden="true">T.O. PLATE</span>
      <span className="dim dim-floor" aria-hidden="true">FIN. FLR</span>
      <ul className="hero-cards" aria-label="Job 2214 at a glance">
        {cards.map(card => <li key={card.id} className={`hcard hcard-${card.side}${card.ox ? ' hcard-ox' : ''}`} style={{ '--x': card.x, '--y': card.y, '--w': card.w } as CSSProperties}>
          <Icon name={card.icon} /><div><p className="hcard-title">{card.title}</p><p className="hcard-body">{card.body}</p></div>
        </li>)}
      </ul>
    </div>
  </header>
}
