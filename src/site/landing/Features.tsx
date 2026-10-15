import type { ReactNode } from 'react'
import { Card, DrawingAction, AmountRows, Status } from './Card'
import { Slab } from './Slab'

function Feature({ id, eyebrow, title, body, reverse = false, children }: { id: string; eyebrow: string; title: string; body: string; reverse?: boolean; children: ReactNode }) {
  return <section id={id} className={`site-feature${reverse ? ' reverse' : ''}`}><div className="feature-copy"><p className="site-eyebrow">{eyebrow}</p><h2>{title}</h2><p>{body}</p></div><Slab className={`feature-art ${id}-art`}>{children}</Slab></section>
}
export function Free() {
  return <Feature id="free" eyebrow="Free" title="100% free. Yours to keep." body="MIT licensed. Your jobs, photos and approvals live in your own installation."><Card><h3>MIT License</h3><p>Plinth</p><div className="license-line" aria-hidden="true" /><div className="license-line short" aria-hidden="true" /></Card></Feature>
}
export function Variations() {
  return <Feature id="variations" eyebrow="Variations" title="Clients approve their own changes." body="Your client signs in and approves the exact amount and scope. The contract changes only then." reverse><Card><Status draft>draft</Status><h3>Pendant lights added</h3><strong className="product-amount">$3,200.00</strong><DrawingAction>Approve this variation for $3,200.00</DrawingAction></Card></Feature>
}
export function Claims() {
  return <Feature id="claims" eyebrow="Progress claims" title="Claims that reconcile." body="Enter work to date. Plinth deducts earlier claims and shows supplier commitments before you approve."><Card><div className="product-heading"><h3>Stage 2 · lock-up</h3><Status>exported</Status></div><AmountRows rows={[["Accepted quote", "$48,000.00"], ["Approved variations", "$3,200.00"], ["Current contract", "$51,200.00"], ["Previously exported", "$14,400.00"], ["This claim", "$13,400.00"]]} /><DrawingAction kind="outline">Download claim CSV</DrawingAction></Card></Feature>
}
export function Trades() {
  return <Feature id="trades" eyebrow="Trades" title="One booking per trade, across every job." body="Book a subcontractor once. Plinth refuses an overlapping booking for the same trade on any job." reverse><Card><div className="product-heading"><h3>River City Electrical</h3><Status>booked</Status></div><p>Tue 21 Oct, 7:00 am – 3:00 pm</p></Card></Feature>
}
export function Diary() {
  return <Feature id="diary" eyebrow="Site diary" title="Every site day, with photos." body="Publish the work, conditions and decisions, with photos your client can open."><Card><div className="product-heading"><h3>21 Oct 2026</h3><Status>published</Status></div><p className="diary-note">Rough-in complete for kitchen circuits.</p><div className="photo-slots" aria-label="Two empty photo slots"><span aria-label="Empty photo slot"><PhotoIcon /></span><span aria-label="Empty photo slot"><PhotoIcon /></span></div></Card></Feature>
}
function PhotoIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 18 5-5 4 3 3-4 5 6" /></svg> }
export function MoveIn() {
  return <Feature id="move-in" eyebrow="Move in" title="Bring your accepted jobs with you." body="Dry-run an Accepted jobs CSV, approve the exact file, undo it if you change your mind." reverse><Card><h3>Dry-run result</h3><AmountRows rows={[["Ashgrove kitchen renovation", "$48,000.00"], ["Bulimba bathroom refit", "$21,500.00"]]} /><DrawingAction kind="ink">Approve and import drafts</DrawingAction></Card></Feature>
}
