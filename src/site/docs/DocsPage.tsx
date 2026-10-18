// A /docs page in the landing's look: the site bar on the drafting grid, the
// guides grouped in the sidebar, the article, previous and next, and the
// headings of the page. The Markdown is the committed file GitHub shows.
import { docs, repository, type Doc } from './manifest'
import { renderDoc } from './render'
import { Lockup, SOURCE } from '../landing/parts'
import { Footer } from '../landing/sections/Closing'
import '../styles/docs.css'

const groups = [...new Set(docs.map(doc => doc.group))]

function Guides({ current }: { current: Doc }) {
  return <>{groups.map(group => <div key={group} className="docs-group"><p className="docs-label">{group}</p><ul>{docs.filter(doc => doc.group === group).map(doc => <li key={doc.path}><a href={doc.path} aria-current={doc === current ? 'page' : undefined}>{doc.path === '/docs' ? 'Overview' : doc.title}</a></li>)}</ul></div>)}</>
}

export function DocsPage({ doc }: { doc: Doc }) {
  const { html, headings } = renderDoc(doc)
  const index = docs.indexOf(doc), previous = docs[index - 1], next = docs[index + 1]
  return <>
    <a className="skip" href="#content">Skip to content</a>
    <header className="docs-top">
      <nav className="site-bar" aria-label="Site"><Lockup /><span className="site-links"><a href="/docs" aria-current="page">Docs</a><a href={SOURCE}>Source</a><a className="docs-run" href="/run">Run Plinth</a></span></nav>
    </header>
    <div className="docs-layout">
      <aside className="docs-side"><nav aria-label="Guides"><Guides current={doc} /></nav></aside>
      <main id="content" className="docs-main" tabIndex={-1}>
        <details className="docs-mobile"><summary>All guides</summary><nav aria-label="Guides on this phone"><Guides current={doc} /></nav></details>
        <p className="eyebrow">{doc.group}</p>
        <article className="docs-article" dangerouslySetInnerHTML={{ __html: html }} />
        <nav className="docs-pager" aria-label="Previous and next guide">
          {previous ? <a href={previous.path}><span>Previous</span><b>{previous.path === '/docs' ? 'Overview' : previous.title}</b></a> : <span />}
          {next && <a className="next" href={next.path}><span>Next</span><b>{next.title} →</b></a>}
        </nav>
        <p className="docs-source"><a href={`${repository}/blob/main/${doc.source}`}>Edit this page on GitHub</a></p>
      </main>
      {headings.length > 0 && <aside className="docs-toc"><nav aria-label="On this page"><p className="docs-label">On this page</p><ul>{headings.map(heading => <li key={heading.id}><a href={`#${heading.id}`}>{heading.title}</a></li>)}</ul></nav></aside>}
    </div>
    <Footer />
  </>
}

/** Code cards get their Copy button only when script runs; without it the command is still there to select. */
export const COPY_SCRIPT = "document.querySelectorAll('.docs-copy').forEach(b=>{b.hidden=false;b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.parentElement.querySelector('code').textContent);b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1600)}catch{}})})"
export { docs }
