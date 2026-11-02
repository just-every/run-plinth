import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { searchDocument } from '../fixtures/search-document.mjs'
import { originalEmail } from '../journeys/meeting-mail.mjs'
export const pageTerms = Array.from({ length: 251 }, (_, i) => `synthetic-plinth-page-${String(i + 1).padStart(3, '0')}-9580`)
export async function captureExtraction(f, job, terms = pageTerms, originalBytes) {
 const bytes = originalBytes ?? searchDocument(terms)
 const original = originalEmail({ from: ['synthetic-plinth-9581', 'example.com'].join('@'), to: ['builder', 'example.com'].join('@'), subject: 'Retained native original', text: 'Private original for this job', file: { name: 'synthetic-plinth-9582.pdf', bytes }, id: crypto.randomUUID() })
 const root = '/api/plinth/jobs/' + job.id
 const result = await f.json(root + '/correspondence', { method: 'POST', cookie: f.owner, body: { kind: 'capture', confirm: true, original_base64: original.toString('base64') } })
 assert.equal(result.status, 201, JSON.stringify(result.value))
 const message = result.value.messages.find(m => m.id === result.value.id), file = message.files[0]
 return { root, message, file, original, bytes, terms, checksum: createHash('sha256').update(bytes).digest('hex'), path: root + '/correspondence/files/' + file.id + '/extraction' }
}
export const extractionApi = (f, c, cookie = f.owner) => ({
 read: () => f.json(c.path, { cookie }),
 action: (work, action, extra = {}) => f.json(c.path, { method: 'POST', cookie, body: { action, expected_version: work.version, ...extra } }),
 search: term => f.json(c.root + '/decision-search?' + new URLSearchParams({ q: term }), { cookie }),
})
export async function finishExtraction(f, c, cookie = f.owner) {
 const api = extractionApi(f, c, cookie)
 let work = (await api.read()).value.extraction
 for (let n = 0; work.status === 'queued' && n < 20; n++) {
  const previous = work.progress, reply = await api.action(work, 'continue')
  assert.equal(reply.status, 200, JSON.stringify(reply.value)); work = reply.value.extraction
  assert.ok(work.progress > previous && work.progress - previous <= 25)
 }
 assert.equal(work.status, 'complete'); assert.equal(work.progress, c.terms.length); assert.equal(work.total, c.terms.length)
 for (const term of c.terms) {
  const found = await api.search(term)
  assert.equal(found.status, 200); assert.equal(found.value.count, 1, term)
  const hit = found.value.results[0]
  assert.equal(hit.source, 'files:' + c.file.id); assert.equal(hit.file_checksum, c.checksum)
  assert.equal(hit.text.split(term).length - 1, 1, 'A source page term occurs exactly once in its matching excerpt')
  assert.equal(hit.extraction.method, 'PDF embedded text'); assert.equal(hit.extraction.status, 'complete')
 }
 const download = await f.request(c.root + '/correspondence/files/' + c.file.id, { cookie })
 assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), c.bytes)
 return work
}
