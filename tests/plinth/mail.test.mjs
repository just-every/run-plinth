import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createActiveJob, createFixture } from './helpers.mjs'

const DOMAIN = 'replies.synthetic-plinth.test'
const mime = ({ from = 'Alex Chen <client@example.com>', to, subject = 'Re: Your decision is needed', id = '<synthetic-reply-1@example.com>', text, file }) => [
 `From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: ${id}`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="synthetic-boundary"', '',
 '--synthetic-boundary', 'Content-Type: text/plain; charset=utf-8', '', text, '',
 ...(file ? ['--synthetic-boundary', `Content-Type: ${file.type}; name="${file.name}"`, `Content-Disposition: attachment; filename="${file.name}"`, 'Content-Transfer-Encoding: base64', '', Buffer.from(file.bytes).toString('base64'), ''] : []),
 '--synthetic-boundary--', ''].join('\r\n')

async function setup(options = {}) {
 const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
 const f = await createFixture({ mailProvider: 'sendgrid', mailEventKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), mailReplyDomain: DOMAIN, ...options })
 const client = await f.invite('client@example.com', 'Alex Chen')
 let job = await createActiveJob(f, 'Maple Street kitchen', 'client@example.com', 2_400_000)
 const api = (path, o = {}) => f.json('/api/plinth' + path, { cookie: f.owner, ...o })
 const terms = { room: 'Kitchen', category: 'Flooring', allowance_cents: 200_000, cost_code: '09-650', decision_on: '2026-11-04', lead_days: 21, options: [{ name: 'Natural oak', supplier: 'Maple Supply', specifications: 'Engineered white oak, matte', price_cents: 225_000 }, { name: 'Porcelain tile', supplier: 'Maple Supply', specifications: 'Large format, honed', price_cents: 175_000 }] }
 let r = await api(`/jobs/${job.id}/selections`, { method: 'POST', body: { expected_version: job.version, ...terms } }); assert.equal(r.status, 200)
 const selection = r.value.record.id; job = (await api(`/jobs/${job.id}`)).value.job
 r = await api(`/jobs/${job.id}/selections/${selection}/present`, { method: 'POST', body: { expected_version: job.version, revision_id: job.selections[0].revisions[0].id } }); assert.equal(r.status, 200)
 const send = (body, o = {}) => api(`/jobs/${job.id}/correspondence`, { method: 'POST', body, ...o })
 const thread = (o = {}) => api(`/jobs/${job.id}/correspondence`, o).then(x => x.value.messages)
 // The provider's signed event webhook, signed with a test-only key the fixture trusts.
 const deliver = (events, { tamper = false } = {}) => { const body = JSON.stringify(events), timestamp = String(Math.floor(Date.now() / 1000)); return f.request('/api/plinth/mail/events', { method: 'POST', headers: { 'x-twilio-email-event-webhook-timestamp': timestamp, 'x-twilio-email-event-webhook-signature': sign('sha256', Buffer.from(timestamp + body), privateKey).toString('base64') }, body: tamper ? [...events, { ...events[0], sg_event_id: 'synthetic-ev-forged' }] : events }) }
 const event = (message, type, n, to = 'client@example.com') => ({ email: to, timestamp: Math.floor(Date.now() / 1000), event: type, sg_event_id: `synthetic-ev-${n}`, sg_message_id: `synthetic-sg-${message.id}`, rer_delivery_id: message.id })
 const reply = (replyTo, headers = {}, parts = {}) => fetch(f.origin + '/__test/email', { method: 'POST', body: mime({ to: replyTo, text: 'Natural oak please. My signed drawing is attached.', file: { name: 'drawing.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 synthetic-plinth-1') }, ...parts }), headers: { 'x-envelope-from': parts.envelopeFrom ?? 'client@example.com', 'x-envelope-to': replyTo, 'x-mail-headers': JSON.stringify({ 'authentication-results': 'mx.example; spf=pass; dkim=pass', ...headers }) } }).then(x => x.json())
 return { f, client, job: () => job, api, selection, send, thread, deliver, event, reply, privateKey }
}

test('INT-007 — a selection request leaves through the provider, signed events and an emailed reply with a file land on the job thread, and an unsubscribe stops only optional notices', async () => {
 const s = await setup(), { f } = s
 try {
  let r = await s.send({ kind: 'selection_request', selection_id: s.selection }); assert.equal(r.status, 201)
  let [request] = await s.thread(); const sent = f.messages.at(-1)
  assert.deepEqual([request.kind, request.required, request.status, request.visibility], ['selection_request', true, 'accepted', 'client'])
  assert.deepEqual(sent.to, ['client@example.com']); assert.match(sent.text, /Natural oak \(\$2,250\.00\)/); assert.equal(sent.custom_args.rer_delivery_id, request.id)
  assert.match(sent.replyTo, new RegExp(`^r\\.${request.id.replaceAll('-', '')}\\.[0-9a-f]{20}@${DOMAIN.replaceAll('.', '\\.')}$`)); assert.doesNotMatch(sent.text, /unsubscribe/i, 'Required transactional mail carries no unsubscribe')
  // Signed delivery events: forged and unsigned batches are refused whole; a stored event moves the message once.
  assert.equal((await s.deliver([s.event(request, 'delivered', 1)], { tamper: true })).status, 400)
  assert.equal((await f.request('/api/plinth/mail/events', { method: 'POST', body: [s.event(request, 'delivered', 1)] })).status, 400)
  assert.equal((await s.deliver([{ ...s.event(request, 'delivered', 2), rer_delivery_id: crypto.randomUUID() }])).status, 400, 'An event for a message this installation never sent is refused')
  assert.equal((await s.deliver([s.event(request, 'delivered', 3, 'someone@example.net')])).status, 400, 'An event for another mailbox is refused')
  assert.equal((await s.thread())[0].status, 'accepted')
  r = await s.deliver([s.event(request, 'delivered', 4)]); assert.equal(r.status, 200); assert.equal((await r.json()).stored, 1)
  assert.equal((await s.thread())[0].status, 'delivered'); assert.equal((await (await s.deliver([s.event(request, 'delivered', 4)])).json()).stored, 0, 'A replayed event is a duplicate')
  // The client replies by email with a file: it lands on this message's thread, with exact bytes, and nowhere else.
  assert.deepEqual(await s.reply(sent.replyTo), { rejected: null })
  let messages = await s.thread(); const inbound = messages.find(m => m.direction === 'in')
  assert.equal(messages.length, 2); assert.deepEqual([inbound.visibility, inbound.counterparty, inbound.reply_to_id, inbound.status], ['client', 'client@example.com', request.id, 'received']); assert.match(inbound.body, /Natural oak please/)
  assert.match(inbound.sender_check, /spf=pass/); assert.equal(inbound.files.length, 1); assert.deepEqual([inbound.files[0].name, inbound.files[0].size], ['drawing.pdf', 27])
  const file = await f.request(`/api/plinth/jobs/${s.job().id}/correspondence/files/${inbound.files[0].id}`, { cookie: f.owner })
  assert.equal(await file.text(), '%PDF-1.4 synthetic-plinth-1'); assert.match(file.headers.get('content-disposition'), /^attachment/); assert.equal(file.headers.get('content-type'), 'application/octet-stream')
  assert.deepEqual(await s.reply(sent.replyTo), { rejected: null }, 'The same Message-ID is stored once'); assert.equal((await s.thread()).length, 2)
  // Private office notes stay out of the client's view; the client reads only their own client messages.
  assert.equal((await s.send({ kind: 'note', body: 'Client leaning to the oak; check lead time with the supplier.' })).status, 201)
  const own = await s.thread({ cookie: s.client }); assert.deepEqual(own.map(m => m.visibility), ['client', 'client']); assert.equal((await s.thread()).filter(m => m.visibility === 'private').length, 1)
  assert.equal((await f.request(`/api/plinth/jobs/${s.job().id}/correspondence/files/${inbound.files[0].id}`, { cookie: s.client })).status, 200)
  assert.equal((await s.send({ kind: 'message', subject: 'Hi', body: 'x' }, { cookie: s.client })).status, 403)
  // Unsubscribe: optional notices stop, required transactional mail continues; a bounce is recorded as its own state.
  r = await s.send({ kind: 'selection_reminder', selection_id: s.selection }); assert.equal(r.status, 201)
  const reminder = f.messages.at(-1), link = /https?:\/\/\S+\/api\/plinth\/mail\/unsubscribe\/\S+/.exec(reminder.text)?.[0]; assert.ok(link, 'Optional notices carry a signed unsubscribe link')
  const path = new URL(link).pathname
  const opened = f.messages.length; assert.equal((await fetch(f.origin + path)).status, 200); r = await s.send({ kind: 'update', subject: 'Plan update', body: 'Tile arrives Friday.' }); assert.equal(f.messages.length, opened + 1, 'Opening the link alone changes nothing')
  assert.equal((await fetch(f.origin + path + 'x', { method: 'POST' })).status, 404)
  assert.equal((await fetch(f.origin + path, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 200)
  const before = f.messages.length; r = await s.send({ kind: 'update', subject: 'Second update', body: 'Tile arrives Monday.' }); assert.equal(r.status, 201)
  assert.equal(f.messages.length, before, 'No provider call for an optional notice after unsubscribe'); assert.equal((await s.thread()).at(-1).status, 'suppressed')
  r = await s.send({ kind: 'selection_request', selection_id: s.selection }); assert.equal(r.status, 201); assert.equal(f.messages.length, before + 1, 'Required mail still goes')
  const second = (await s.thread()).at(-1); assert.equal(second.status, 'accepted')
  assert.equal((await s.deliver([s.event(second, 'bounce', 5)])).status, 200); assert.equal((await s.thread()).at(-1).status, 'bounced')
  assert.equal((await s.deliver([s.event(second, 'delivered', 6)])).status, 200); assert.equal((await s.thread()).at(-1).status, 'bounced', 'A later delivered event never undoes a bounce')
  const audit = (await s.api('/audit?kind=send')).value; assert.ok(JSON.stringify(audit).includes('mail.send'), 'Sends are audited'); assert.ok(!JSON.stringify(audit).includes('Natural oak please'), 'Audit history carries no message content')
 } finally { await f.mf.dispose() }
})

test('INT-007 — replies are refused unless they reach a message address from its own authenticated recipient, and a hold keeps the thread until a released erasure removes it', async () => {
 const s = await setup(), { f } = s
 try {
  await s.send({ kind: 'selection_request', selection_id: s.selection }); const request = (await s.thread())[0], address = f.messages.at(-1).replyTo
  const refused = async (result, why) => { assert.ok(result.rejected, why); assert.equal((await s.thread()).length, 1, why) }
  await refused(await s.reply(address, {}, { from: 'Eve <eve@example.net>', envelopeFrom: 'eve@example.net' }), 'another sender is refused')
  await refused(await s.reply(address.replace(/\.[0-9a-f]{20}@/, '.00000000000000000000@')), 'a wrong address token is refused')
  await refused(await s.reply(`r.${crypto.randomUUID().replaceAll('-', '')}.${'0'.repeat(20)}@${DOMAIN}`), 'an unknown message is refused')
  await refused(await s.reply(address, { 'authentication-results': 'mx.example; dkim=fail; spf=pass' }), 'a failed sender authentication is refused')
  const huge = await s.reply(address, {}, { file: { name: 'big.bin', type: 'application/octet-stream', bytes: Buffer.alloc(2 * 1024 * 1024 + 1) } }); await refused(huge, 'an oversize file is refused')
  assert.deepEqual(await s.reply(address), { rejected: null }); assert.equal((await s.thread()).length, 2)
  assert.equal((await s.deliver([s.event(request, 'delivered', 1)])).status, 200)
  const job = s.job(), place = await s.api('/holds', { method: 'POST', body: { subject_kind: 'job', subject_id: job.id, kind: 'legal_hold', reason: 'Dispute notice received', confirm: true } }); assert.equal(place.status, 201)
  const current = (await s.api(`/jobs/${job.id}`)).value.job
  assert.equal((await s.api(`/jobs/${job.id}`, { method: 'DELETE', body: { expected_version: current.version } })).value.error, 'retention_hold'); assert.equal((await s.thread()).length, 2)
  assert.equal((await s.api(`/holds/${place.value.hold.id}/release`, { method: 'POST', body: { reason: 'Dispute settled' } })).status, 200)
  assert.equal((await s.api(`/jobs/${job.id}`, { method: 'DELETE', body: { expected_version: current.version } })).status, 200)
  for (const table of ['pl_mail_messages', 'pl_mail_files', 'rer_mail_event_receipts']) assert.equal((await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0, `${table} is erased with the job`)
 } finally { await f.mf.dispose() }
})
