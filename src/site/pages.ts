// The run site (run-plinth.com) `rer build --site` writes: the homepage with its
// Run action, /run, the docs from docs/*.md, /contract from CONTRACT.md and the
// not-found page. Every Run page string and command is in run.json; nothing
// here reads installation data.
import { createElement } from 'react'
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { documentHtml } from './shell/Document'
import { Landing } from './landing/Landing'
import { COPY_SCRIPT, DocsPage, docs } from './docs/DocsPage'
import run from './run.json'

// Base's shared pages wear the run site's tokens and floor art; the installed
// app keeps its own theme (identity.theme) until its round.
const site = { ...identity, theme: '/site/theme.css', band: '/site/band-1536.webp' }
// Base's Run page prints British "licence"; Plinth is a US product.
const usSpelling = (html: string) => html.replaceAll(`${run.licence} licence<`, `${run.licence} license<`)

export function sitePages({ styles = [], contract }: Partial<SiteContext> = {}): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: documentHtml({ title: 'Plinth — Handover day, right on time.', description: 'Plinth carries each job from e-signed estimate through schedule, selections, subs, job costing and progress billing, and plans the recovery when a job slips. 100% free, open source alternative to Buildertrend, Procore and Houzz Pro.', styles, body: createElement(Landing) }) },
      { path: '/run', html: usSpelling(runPageHtml(site, data, contract)) },
      ...(contract ? [{ path: '/contract', html: usSpelling(contractPageHtml(site, data, contract)) }] : []),
      ...docs.map(doc => ({ path: doc.path, html: documentHtml({ title: doc.path === '/docs' ? 'Plinth guides' : `${doc.title} · Plinth`, description: doc.description, styles, body: createElement(DocsPage, { doc }), script: COPY_SCRIPT }) })),
      { path: '/404', html: siteNotFoundHtml(site, data, contract) },
    ],
    assets: ['site', 'fonts', 'brand', 'favicon.ico', 'apple-touch-icon.png'],
  }
}
