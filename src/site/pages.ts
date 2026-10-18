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
// Base's Run, Contract and not-found pages wear the run site's icon set (the
// mark alone blurs at 16 px), mark each word of a command so a phone wraps it
// only between words (public/site/theme.css), and print US "license": Plinth
// is a US product.
const ICONS = '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">'
function basePage(html: string): string {
  const icon = `<link rel="icon" href="${identity.mark}">`
  if (!html.includes(icon)) throw new Error('Base page head no longer links the mark as its icon; update basePage.')
  return html.replace(icon, ICONS)
    .replace(/<code>([^<]*)<\/code>/g, (_, text: string) => `<code>${(text.match(/\| \S+|\S+/g) ?? []).map(word => `<span class="word">${word}</span>`).join(' ')}</code>`)
    .replaceAll(`${run.licence} licence<`, `${run.licence} license<`)
}

export function sitePages({ styles = [], contract }: Partial<SiteContext> = {}): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: documentHtml({ title: 'Plinth — Handover day, right on time.', description: 'Plinth carries each job from e-signed estimate through schedule, selections, subs, job costing and progress billing, and plans the recovery when a job slips. 100% free, open source alternative to Buildertrend, Procore and Houzz Pro.', styles, body: createElement(Landing) }) },
      { path: '/run', html: basePage(runPageHtml(site, data, contract)) },
      ...(contract ? [{ path: '/contract', html: basePage(contractPageHtml(site, data, contract)) }] : []),
      ...docs.map(doc => ({ path: doc.path, html: documentHtml({ title: doc.path === '/docs' ? 'Plinth guides' : `${doc.title} · Plinth`, description: doc.description, styles, body: createElement(DocsPage, { doc }), script: COPY_SCRIPT }) })),
      { path: '/404', html: basePage(siteNotFoundHtml(site, data, contract)) },
    ],
    assets: ['site', 'fonts', 'brand', 'favicon.ico', 'apple-touch-icon.png'],
  }
}
