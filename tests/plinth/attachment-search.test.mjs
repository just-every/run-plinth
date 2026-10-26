import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createActiveJob, createFixture, setPortalFeatures } from './helpers.mjs'
import { searchDocument } from '../fixtures/search-document.mjs'

import { imageDocument, protectedDocument, unsupportedDocument, png } from '../fixtures/unextractable-documents.mjs'

const captureMail = (index, type, bytes) => Buffer.from([
 'From: synthetic-plinth-9002@example.com', 'To: builder@example.com', `Subject: synthetic-plinth-${index}`, `Message-ID: <synthetic-plinth-${index}@example.com>`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="synthetic-plinth-9003"', '',
 '--synthetic-plinth-9003', 'Content-Type: text/plain', '', 'synthetic-plinth-9004', '--synthetic-plinth-9003', `Content-Type: ${type}; name="synthetic-plinth-${index}.bin"`, `Content-Disposition: attachment; filename="synthetic-plinth-${index}.bin"`, 'Content-Transfer-Encoding: base64', '', bytes.toString('base64'), '--synthetic-plinth-9003--', '',
].join('\r\n'))

test('Supplied attachment text requires exact human review and current source authority, keeps original extraction and custody, and follows source search and erasure boundaries', async () => {
 const f = await createFixture()
 try {
  const client = await f.invite('client@example.com', 'synthetic-plinth-9005'), admin = await f.invite('synthetic-plinth-9006@example.com', 'synthetic-plinth-9006', 'admin')
  let job = await createActiveJob(f, 'synthetic-plinth-9007')
  const base = `/jobs/${job.id}`, api = (path, options = {}) => f.json('/api/plinth' + path, { cookie: f.owner, ...options })
  const read = async () => { job = (await api(base)).value.job; return job }
  const post = (path, body, cookie = f.owner) => api(base + path, { method: 'POST', body, cookie })
  const search = (query, cookie = f.owner) => api(base + '/decision-search?' + new URLSearchParams(query), { cookie })
  const inspect = (source, cookie = f.owner) => api(base + '/decision-search/transcriptions?' + new URLSearchParams({ source }), { cookie })
  const preview = (hit, text, cookie = f.owner, extra = {}) => post('/decision-search/transcription-preview', { source: hit.source, checksum: hit.file_checksum, expected_version: job.version, text, ...extra }, cookie)
  const save = (review, cookie = f.owner, extra = {}) => post('/decision-search/transcriptions', { ...review, confirm: true, ...extra }, cookie)
  const variants = [
   { bytes: imageDocument(), mime: 'application/pdf', status: 'no_text', term: 'synthetic-plinth-scan-9100' },
   { bytes: protectedDocument, mime: 'application/pdf', status: 'failed', term: 'synthetic-plinth-protected-9101' },
   { bytes: unsupportedDocument, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'unsupported', term: 'synthetic-plinth-docx-9102' },
   { bytes: Buffer.concat([Buffer.from([255]), Buffer.from('synthetic-plinth-invalid-9103\n' + 'Reviewed façade clearance. '.repeat(90) + '\nsynthetic-plinth-end-3')]), mime: 'text/plain', status: 'failed', term: 'synthetic-plinth-invalid-9103' },
   { bytes: searchDocument([...Array.from({ length: 200 }, () => 'synthetic-plinth-9008'), 'synthetic-plinth-limited-9104']), mime: 'application/pdf', status: 'limited', term: 'synthetic-plinth-limited-9104' },
  ]
  const before = f.messages.length
  for (const [index, variant] of variants.entries()) {
   const original = captureMail(9100 + index, variant.mime, variant.bytes)
   const captured = await post('/correspondence', { kind: 'capture', confirm: true, original_base64: original.toString('base64') }); assert.equal(captured.status, 201, JSON.stringify(captured.value))
   const message = captured.value.messages.find(message => message.id === captured.value.id), source = 'files:' + message.files[0].id
   assert.equal([message.subject, message.body, ...message.files.map(file => file.name)].some(value => value.includes(variant.term)), false, 'The original-content term is absent from the filename and message')
   const hit = (await search({ source })).value.results[0]
   assert.equal(hit.extraction.status, variant.status); assert.equal(hit.file_checksum, createHash('sha256').update(variant.bytes).digest('hex'))
   const text = index === 3 ? variant.bytes.subarray(1).toString('utf8') : variant.term
   assert.equal((await search({ q: variant.term })).value.count, 0)
   const review = await preview(hit, text, index === 1 ? admin : f.owner); assert.equal(review.status, 200, JSON.stringify(review.value)); assert.equal(review.value.text, text)
   assert.equal((await inspect(source)).value.revisions.length, 0, 'Preview writes no transcription')
   assert.equal((await save(review.value, index === 1 ? admin : f.owner, { confirm: false })).status, 409)
   assert.equal((await save(review.value, index === 1 ? admin : f.owner, { text: text + ' changed' })).status, 409)
   assert.equal((await preview(hit, text, f.owner, { checksum: '0'.repeat(64) })).status, 409)
   if (index === 3) { const concurrent = await Promise.all([save(review.value), save(review.value)]); assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409], 'Concurrent confirmations append exactly once') }
   else { const saved = await save(review.value, index === 1 ? admin : f.owner); assert.equal(saved.status, 200, JSON.stringify(saved.value)) }
   await read()
   assert.equal((await save(review.value)).status, 409, 'A stale review cannot append twice')
   const result = await search({ q: variant.term }); assert.equal(result.value.count, 1); assert.equal(result.value.results[0].source, source); assert.equal(result.value.results[0].extraction.status, variant.status); assert.equal(result.value.results[0].transcription.revision, 1)
   assert.deepEqual((await inspect(source)).value.revisions.map(row => row.text), [text], 'Full saved text remains available beyond search excerpts')
   assert.equal((await search({ q: variant.term }, client)).value.count, 0)
   assert.equal((await inspect(source, client)).status, 404)
   assert.equal((await preview(hit, text, client)).status, 403)
   const file = await f.request('/api/plinth' + base + '/correspondence/files/' + message.files[0].id, { cookie: f.owner }); assert.deepEqual(Buffer.from(await file.arrayBuffer()), variant.bytes)
   const mail = await f.request('/api/plinth' + base + '/correspondence/' + message.id + '/original', { cookie: f.owner }); assert.deepEqual(Buffer.from(await mail.arrayBuffer()), original)
   if (index === 0) {
    const metadata = { tags: ['synthetic-plinth-9010'], sheet: 'synthetic-plinth-9011', cost_code: 'synthetic-plinth-9012' }
    assert.equal((await post('/decision-search/metadata', { source, ...metadata })).status, 200)
    const filters = { q: 'synthetic-plinth-scan-9100', tag: metadata.tags[0], sheet: metadata.sheet, cost_code: metadata.cost_code, sender: 'synthetic-plinth-9002@example.com' }
    const filtered = await search(filters); assert.equal(filtered.value.count, 1); assert.equal(filtered.value.results[0].files[0].href, hit.files[0].href)
    for (const key of ['tag', 'sheet', 'cost_code', 'sender']) assert.equal((await search({ ...filters, [key]: 'synthetic-plinth-no-match' })).value.count, 0)
    assert.equal((await api(filtered.value.results[0].href.replace('/api/plinth', ''))).value.results[0].source, source)
    const next = await preview(hit, 'synthetic-plinth-revised-9013'); assert.equal((await save(next.value)).status, 200); await read()
    assert.equal((await inspect(source)).value.revisions.length, 2); assert.equal((await search({ q: 'synthetic-plinth-scan-9100' })).value.count, 0, 'Only the latest revision is indexed')
   }
  }
  assert.equal(f.messages.length, before, 'Capture, review and transcription save send nothing')
  // Published photo access supplies the complete read boundary, including feature revocation.
  let response = await post('/diary', { expected_version: job.version, note: 'synthetic-plinth-9014', attachments: [{ name: 'synthetic-plinth-9015.png', base64: png.toString('base64') }] }); assert.equal(response.status, 200); await read()
  const photo = job.diary.at(-1).attachments[0], source = 'files:' + photo.id, hit = (await search({ source })).value.results[0]
  const reviewed = await preview(hit, 'synthetic-plinth-public-transcription-9016'); assert.equal((await save(reviewed.value)).status, 200); await read()
  assert.equal((await search({ q: 'synthetic-plinth-public-transcription-9016' }, client)).value.count, 1); assert.equal((await inspect(source, client)).value.revisions[0].text, reviewed.value.text)
  const token = await f.agent()
  assert.equal((await api(base + '/decision-search/transcription-preview', { method: 'POST', cookie: undefined, token, body: { ...reviewed.value, expected_version: job.version } })).status, 403)
  const pending = await preview(hit, 'synthetic-plinth-stale-9017')
  await setPortalFeatures(f, job.id, ['photos']); await read()
  assert.equal((await save(pending.value)).status, 409)
  assert.equal((await search({ source }, client)).value.count, 0); assert.equal((await inspect(source, client)).status, 404)
  assert.equal((await f.request('/api/plinth' + hit.files[0].href.replace('/api/plinth', ''), { cookie: client })).status, 404)
  // A distributed RFI original inherits the same supplementary text through the safe inbox projection.
  response = await post('/rfi-access', { expected_version: job.version, email: 'client@example.com', role: 'designer', sheet_ids: [] }); assert.equal(response.status, 200); await read()
  response = await post('/rfis', { expected_version: job.version, title: 'synthetic-plinth-9021', question: 'synthetic-plinth-9022', assignee_email: 'client@example.com', recipient_emails: [], task_ids: [], due_on: '2026-11-04', attachments: [{ name: 'synthetic-plinth-9023.pdf', base64: imageDocument().toString('base64') }] }); assert.equal(response.status, 200, JSON.stringify(response.value)); await read()
  const rfiSource = 'files:' + response.value.record.attachments[0].id, rfiHit = (await search({ source: rfiSource })).value.results[0]
  const rfiReview = await preview(rfiHit, 'synthetic-plinth-scan-9100'); assert.equal((await save(rfiReview.value)).status, 200); await read()
  const inboxPath = '/rfi-inbox/' + job.id + '/decision-search?'
  const inbox = await api(inboxPath + new URLSearchParams({ q: 'synthetic-plinth-scan-9100' }), { cookie: client }); assert.equal(inbox.value.count, 1); assert.equal(inbox.value.results[0].source, rfiSource); assert.equal(inbox.value.results[0].extraction.status, 'no_text')
  assert.equal((await api(inboxPath + new URLSearchParams({ q: 'synthetic-plinth-revised-9013' }), { cookie: client })).value.count, 0)
  const original = await f.request(inbox.value.results[0].files[0].href, { cookie: client }); assert.equal(original.status, 200); assert.deepEqual(Buffer.from(await original.arrayBuffer()), imageDocument())
  response = await post('/rfi-access', { expected_version: job.version, email: 'client@example.com', revoke: true }); assert.equal(response.status, 200); await read()
  assert.equal((await api(inboxPath + new URLSearchParams({ source: rfiSource }), { cookie: client })).status, 404)
  assert.equal((await f.request(inbox.value.results[0].files[0].href, { cookie: client })).status, 404)
  // Moving a reviewer out of office authority invalidates a previously complete review.
  const adminReview = await preview(hit, 'synthetic-plinth-authority-9018', admin)
  const person = (await api('/team')).value.team.find(person => person.email === 'synthetic-plinth-9006@example.com')
  response = await api('/team/' + person.id, { method: 'PUT', body: { expected_version: person.version ?? 0, role: 'project_manager', job_ids: [job.id], po_limit_cents: 1000000 } }); assert.equal(response.status, 200, JSON.stringify(response.value))
  assert.equal((await save(adminReview.value, admin)).status, 403)
  const hold = await api('/holds', { method: 'POST', body: { subject_kind: 'job', subject_id: job.id, kind: 'legal_hold', reason: 'synthetic-plinth-9019', confirm: true } }); assert.equal(hold.status, 201)
  assert.equal((await api(base, { method: 'DELETE', body: { expected_version: job.version } })).value.error, 'retention_hold'); assert.equal((await inspect(source)).value.revisions.length, 1)
  assert.equal((await api('/holds/' + hold.value.hold.id + '/release', { method: 'POST', body: { reason: 'synthetic-plinth-9020' } })).status, 200)
  assert.equal((await api(base, { method: 'DELETE', body: { expected_version: job.version } })).status, 200)
  assert.equal((await inspect(source)).status, 404); assert.equal((await search({ q: 'synthetic-plinth-revised-9013' })).status, 404)
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM pl_file_transcriptions WHERE job_id=?').bind(job.id).first()).n, 0)
 } finally { await f.close() }
})
