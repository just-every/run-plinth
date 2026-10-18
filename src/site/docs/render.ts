import { posix } from 'node:path'
import { Marked, Renderer } from 'marked'
import { docs, repository, type Doc } from './manifest'

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

function linkHref(href: string, source: string): string {
  if (/^(https?:|mailto:)/i.test(href) || href.startsWith('#')) return href
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/')) throw new Error(`Unsupported docs link: ${source}: ${href}`)
  const [file, hash] = href.split('#', 2)
  const resolved = posix.normalize(posix.join(posix.dirname(source), file))
  if (resolved.startsWith('../')) throw new Error(`Docs link leaves repository: ${source}: ${href}`)
  const published = docs.find(doc => doc.source === resolved)
  return `${published?.path ?? `${repository}/blob/main/${resolved}`}${hash ? `#${hash}` : ''}`
}

/** Strip tags until none remain, so nested sequences like `<<b>b>` cannot reassemble a tag. */
function stripTags(text: string): string {
  let previous: string
  do {
    previous = text
    text = text.replace(/<[^>]*>/g, '')
  } while (text !== previous)
  return text
}

export interface Heading { id: string; title: string }

/** Render the same committed Markdown GitHub displays; no runtime data or client JavaScript. */
export function renderDoc(doc: Doc): { html: string; headings: Heading[] } {
  const headings: Heading[] = []
  const counts = new Map<string, number>()
  const renderer = new Renderer()
  renderer.html = ({ text }) => escapeHtml(text)
  renderer.heading = function ({ tokens, depth, text }) {
    const stem = stripTags(text.toLowerCase()).replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')
    const count = counts.get(stem) ?? 0
    counts.set(stem, count + 1)
    const id = count ? `${stem}-${count}` : stem
    if (depth === 2) headings.push({ id, title: text })
    return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`
  }
  renderer.link = function ({ href, title, tokens }) {
    return `<a href="${escapeHtml(linkHref(href, doc.source))}"${title ? ` title="${escapeHtml(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`
  }
  // Code cards: the command, and a Copy button the page's script reveals.
  renderer.code = ({ text, lang }) => `<div class="docs-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><pre><code>${escapeHtml(text)}</code></pre><button class="docs-copy" type="button" hidden>Copy</button></div>\n`
  renderer.table = function (token) {
    return `<div class="docs-table" role="region" tabindex="0" aria-label="Reference table">${Renderer.prototype.table.call(this, token)}</div>`
  }
  const markdown = new Marked({ renderer, gfm: true, async: false })
  return { html: markdown.parse(doc.markdown, { async: false }), headings }
}
