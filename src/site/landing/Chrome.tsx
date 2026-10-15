export const source = 'https://github.com/just-every/run-plinth'
export function Brand() {
  return <a className="site-brand" href="/" aria-label="Plinth home"><img src="/brand/mark.svg" alt="" width="30" height="24" /><span>Plinth</span></a>
}
export function Actions() {
  return <><div className="site-actions"><a className="site-pill" href="/run">Run Plinth <span aria-hidden="true">→</span></a><a className="site-link" href="/docs">Read the docs</a></div><p className="site-small">Free and open source, MIT licensed.</p></>
}
export function Header() {
  return <header className="site-header"><Brand /><nav aria-label="Site"><a href="/docs">Docs</a><a href={source}>Source</a></nav></header>
}
export function Footer() {
  return <footer className="site-footer"><div><Brand /><p className="site-small">Free and open source, MIT licensed.</p></div><nav aria-label="Footer"><a href="/docs">Docs</a><a href={source}>Source</a></nav></footer>
}
