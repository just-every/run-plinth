// 14 · Closing: the finished upstairs primary bedroom, the handover tag on the
// window seat, then the footer set in type.
import { Arrow, Done, Lockup, Picture, SOURCE } from '../parts'

export function Closing() {
  return <section id="handover" className="closing">
    <div className="closing-copy">
      <h2>Your next handover, on time.</h2>
      <p className="lead">100% free and open source. MIT licensed.</p>
      <p className="hero-actions"><a className="btn-run" href="/run">Run Plinth <Arrow /></a><a className="text-link" href="/docs">Read the docs</a></p>
    </div>
    <div className="closing-stage">
      <Picture className="closing-art" name="closing" widths={[768, 1152, 1536]} sizes="100vw" width={1536} height={724}
        phone={{ name: 'closing-phone', widths: [780, 1260], media: '(max-width: 760px)', width: 1260, height: 724 }}
        alt="The finished upstairs primary bedroom: the skylight, three double-hung windows over a window seat, the keys and a blue binder on the seat." />
      <p className="handover-tag"><Done />Handover · Fri Dec 18, 10:00 am</p>
    </div>
  </section>
}

export function Footer() {
  return <footer className="site-foot">
    <div className="foot-brand"><Lockup /><p>Free, open source construction management</p></div>
    <nav aria-label="Footer"><a href="/docs">Docs</a><a href={SOURCE}>Source</a><a href={`${SOURCE}/blob/main/LICENSE`}>MIT licensed</a></nav>
  </footer>
}
