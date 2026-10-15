import { Actions } from './Chrome'
import { Card, DrawingAction, AmountRows } from './Card'
import { Slab } from './Slab'

export function Hero() {
  return <section id="top" className="site-hero">
    <div className="hero-copy"><h1>Every job on solid ground.</h1><p className="hero-subhead">Quotes, trades, site diaries, client-approved variations and progress claims that reconcile, all in one place.</p><p className="hero-alternative">100% free, open source alternative to <strong>JobTread</strong>, <strong>Buildertrend</strong> and <strong>Procore</strong></p><Actions /></div>
    <div role="img" aria-label="Plinth's flow: the client's quote is accepted, the client approves a variation, and the progress claim reconciles.">
      <Slab className="hero-flow">
        <Card><h3 className="step-title"><span className="step-disc">1</span>Quote accepted</h3><div className="product-inset"><p>Ashgrove kitchen renovation</p><strong className="product-amount">$48,000.00</strong></div></Card>
        <span className="flow-arrow" aria-hidden="true">→</span>
        <Card><h3 className="step-title"><span className="step-disc">2</span>Client approved</h3><div className="product-inset"><p>Pendant lights added</p><strong className="product-amount">+$3,200.00</strong><p className="approval"><span aria-hidden="true">✓</span>Approved by Alex Chen</p></div></Card>
        <span className="flow-arrow" aria-hidden="true">→</span>
        <Card><h3 className="step-title"><span className="step-disc">3</span>Claim reconciled</h3><AmountRows rows={[["Current contract", "$51,200.00"], ["This claim", "$13,400.00"]]} /><DrawingAction>Download claim CSV</DrawingAction></Card>
      </Slab>
    </div>
  </section>
}
