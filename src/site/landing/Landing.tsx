import { renderToStaticMarkup } from 'react-dom/server'
import { Header, Footer, Actions } from './Chrome'
import { Hero } from './Hero'
import { Free, Variations, Claims, Trades, Diary, MoveIn } from './Features'
import { Included } from './Included'
import { Card } from './Card'
import { Slab } from './Slab'
import './landing.css'

export function Closing() {
  return <section className="site-closing"><Slab><Card><h2>Put your next job on solid ground.</h2><Actions /></Card></Slab></section>
}
export function Landing() {
  return <><a className="site-skip" href="#top">Skip to content</a><Header /><main><Hero /><div className="landing-region" id="free-variations"><Free /><Variations /></div><div className="landing-region" id="claims-trades"><Claims /><Trades /></div><div className="landing-region" id="diary-movein"><Diary /><MoveIn /></div><Included /><Closing /></main><Footer /></>
}
export function landingHtml(styles: string[]) {
  return '<!doctype html>' + renderToStaticMarkup(<html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Plinth — Every job on solid ground</title><meta name="description" content="Free, open source job management for residential builders: quotes, trades, site diaries, client-approved variations and reconciled progress claims." /><link rel="icon" href="/brand/mark.svg" /><link rel="stylesheet" href="/rer-theme.css" />{styles.map(href => <link key={href} rel="stylesheet" href={href} />)}</head><body className="plinth-site"><Landing /></body></html>)
}
