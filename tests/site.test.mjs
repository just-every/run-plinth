import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, extname, join } from 'node:path'

// Exercise the generated run site through HTTP, as an assets host serves it.
test('the run-site journey reaches instructions and repository Markdown guides', async () => {
  execFileSync('pnpm', ['exec', 'rer', 'build', '--site'], { stdio: 'pipe' })
  const root = resolve('dist/site')
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const file = join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, '') + (extname(pathname) ? '' : '.html'))
    if (!file.startsWith(root + '/')) { response.writeHead(404).end(); return }
    try { const body = await readFile(file); response.writeHead(200); response.end(body) }
    catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const homepage = await (await fetch(origin)).text()
    const run = homepage.match(/href="(\/run)"/)
    assert.ok(run, 'the primary action is available without JavaScript')
    const instructions = await fetch(new URL(run[1], origin))
    assert.equal(instructions.status, 200)
    assert.match(await instructions.text(), /rer dev/)
    const docs = await fetch(origin + '/docs')
    assert.equal(docs.status, 200)
    const visited = new Set()
    async function walk(folder) {
      for (const name of await readdir(folder)) {
        const path = join(folder, name)
        if ((await stat(path)).isDirectory()) { await walk(path); continue }
        const relative = path.slice(root.length)
        const route = relative === '/index.html' ? '/' : relative.replace(/\.html$/, '')
        const result = await fetch(origin + route)
        assert.equal(result.status, 200, `${route} serves the built file`)
        if (!name.endsWith('.html')) continue
        const html = await result.text()
        for (const match of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
          const link = new URL(match[1].replaceAll('&amp;', '&'), origin + route)
          if (link.origin !== origin || visited.has(link.pathname)) continue
          visited.add(link.pathname)
          assert.equal((await fetch(link)).status, 200, `${route} → ${link.pathname}`)
        }
      }
    }
    await walk(root)
    for (const [source, route] of [['GETTING-STARTED', 'getting-started'], ['MAIN-FLOWS', 'main-flows'], ['MOVE-IN', 'move-in'], ['BACKUP-RESTORE', 'backup-restore']]) {
      const markdown = await readFile(`docs/${source}.md`, 'utf8')
      const title = markdown.match(/^# (.+)$/m)[1]
      const html = await (await fetch(`${origin}/docs/${route}`)).text()
      assert.ok(html.includes(`>${title}</h1>`), `${route} renders its Markdown title`)
      assert.ok(html.includes(`/docs/${source}.md`), `${route} links its editable repository source`)
    }
  } finally { await new Promise(resolve => server.close(resolve)) }
})
