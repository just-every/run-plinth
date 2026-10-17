import type { SiteBuild } from '../../base/run-site'
import { docs, repository, type Doc } from './manifest'
import { escapeHtml as e, renderDoc } from './render'
import { docCss } from './styles'

export { docCss } from './styles'

function guideLinks(current: Doc): string {
  return docs.map(doc => `<li><a href="${doc.path}"${doc === current ? ' aria-current="page"' : ''}>${e(doc.title)}</a></li>`).join('')
}

function document(doc: Doc, index: number): string {
  const { html, headings } = renderDoc(doc)
  const links = guideLinks(doc)
  const previous = docs[index - 1], next = docs[index + 1]
  const pageLink = (page: Doc, direction: string) => `<a href="${page.path}"><span>${direction}</span><strong>${e(page.title)} ${direction === 'Next' ? '→' : ''}</strong></a>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(doc.title)} · Plinth</title><meta name="description" content="${e(doc.description)}">
<link rel="icon" href="/brand/mark.svg"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/brand/tokens.css"><style>${docCss}</style></head>
<body class="docs-site"><a class="docs-skip" href="#content">Skip to content</a>
<header class="docs-header"><a class="docs-brand" href="/" aria-label="Plinth home"><img src="/brand/mark.svg" alt="" width="28" height="24"><span>Plinth</span></a><nav aria-label="Site"><a href="/docs" aria-current="page">Docs</a><a href="/contract">Contract</a><a href="${repository}">Source</a><a class="docs-run" href="/run">Run Plinth <span aria-hidden="true">→</span></a></nav></header>
<div class="docs-layout"><aside class="docs-sidebar"><nav aria-label="Documentation"><p class="docs-label">Plinth guides</p><ul>${links}</ul></nav></aside>
<main id="content" class="docs-main" tabindex="-1"><details class="docs-mobile-nav"><summary>All guides</summary><nav aria-label="Documentation"><ul>${links}</ul></nav></details>
<p class="docs-eyebrow">Documentation</p><article class="docs-article">${html}</article>
<nav class="docs-pager" aria-label="Guide pages">${previous ? pageLink(previous, 'Previous') : '<span></span>'}${next ? pageLink(next, 'Next') : ''}</nav>
<p class="docs-source"><a href="${repository}/blob/main/${doc.source}">Read this page on GitHub <span aria-hidden="true">↗</span></a></p></main>
${headings.length ? `<aside class="docs-toc"><nav aria-label="On this page"><p class="docs-label">On this page</p><ul>${headings.map(heading => `<li><a href="#${e(heading.id)}">${e(heading.title)}</a></li>`).join('')}</ul></nav></aside>` : ''}</div>
<footer class="docs-footer"><a href="/" class="docs-footer-brand">Plinth</a><p>Free and open source. MIT licensed.</p><a href="${repository}">Source</a></footer></body></html>`
}

export function docPages(): SiteBuild['pages'] {
  return docs.map((doc, index) => ({ path: doc.path, html: document(doc, index) }))
}
