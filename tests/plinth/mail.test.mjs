import { searchDocument } from '../fixtures/search-document.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
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

test('DOC-005 — site meeting decisions retain assigned action history and the related inbound email while client search refuses private bid sources', async () => {
 const s = await setup({now:Date.parse('2026-10-26T12:00:00Z')}), { f } = s
 try {
  let job = (await s.api(`/jobs/${s.job().id}`)).value.job
  const path = `/jobs/${job.id}`, read = async () => (await s.api(path)).value.job
  const meetingMailCount=f.messages.length
  let r = await s.api(path + '/meetings', { method: 'POST', body: { expected_version: job.version, title: 'Kitchen site meeting', held_on: '2026-10-26', agenda: 'Choose cabinet finish', minutes: 'Alex and Builder reviewed samples at the site.', attendees: ['Alex Chen', 'Builder'], decisions: 'Natural oak confirmed pending email drawing', tags: ['cabinetry'], sheet: 'A-201', cost_code: '06-400', actions: [{ title: 'Record the resolved cabinet selection', owner_email: 'builder@example.com', due_on: '2026-11-03' }] } })
  assert.equal(r.status, 200, JSON.stringify(r.value)); const meeting = r.value.record; job = await read();assert.equal(f.messages.length,meetingMailCount,'Recording minutes and assigning an action sends nothing')
  assert.deepEqual({agenda:job.meetings[0].agenda,minutes:job.meetings[0].minutes,attendees:job.meetings[0].attendees,decisions:job.meetings[0].decisions,action:job.meetings[0].actions.map(a=>({title:a.title,owner_email:a.owner_email,due_on:a.due_on}))},{agenda:'Choose cabinet finish',minutes:'Alex and Builder reviewed samples at the site.',attendees:['Alex Chen','Builder'],decisions:'Natural oak confirmed pending email drawing',action:[{title:'Record the resolved cabinet selection',owner_email:'builder@example.com',due_on:'2026-11-03'}]})
  assert.equal((await s.api(path + '/meetings', { cookie: s.client })).status, 403)
  assert.equal((await s.api(path, { cookie: s.client })).value.job.meetings, undefined, 'Job projection never carries private minutes')
  const find = (query, cookie = f.owner) => s.api(path + '/decision-search?' + new URLSearchParams(query), { cookie })
  r = await find({ q: 'oak', tag: 'cabinetry', sender: 'Builder', sheet: 'A-201', cost_code: '06-400' }); assert.equal(r.value.count, 1); assert.equal(r.value.results[0].source, 'meetings:' + meeting.id)
  assert.equal((await find({ q: 'oak', tag: 'wrong' })).value.count, 0, 'Filters combine rather than silently widen')
  await s.send({ kind: 'selection_request', selection_id: s.selection }); const sent = f.messages.at(-1)
  const drawing = searchDocument(); assert.equal(drawing.includes(Buffer.from('service-clearance-2418')),false)
  assert.deepEqual(await s.reply(sent.replyTo, {}, {file:{name:'drawing.pdf',type:'application/pdf',bytes:drawing}}), { rejected: null }); const inbound = (await s.thread()).find(m => m.direction === 'in')
  r = await find({ q: 'Natural oak', sender: 'client@example.com' }); assert.equal(r.value.count, 1); assert.equal(r.value.results[0].source, 'correspondence:' + inbound.id)
  const direct = await s.api(r.value.results[0].href.replace('/api/plinth', '')); assert.equal(direct.value.results[0].source, 'correspondence:' + inbound.id)
  assert.equal((await find({ q: 'drawing.pdf' }, s.client)).value.count, 1, 'Authorized attached filename is searchable')
  r = await find({q:'service-clearance-2418'},s.client);assert.equal(r.status,200);assert.equal(r.value.count,1,JSON.stringify(r.value));assert.equal(r.value.results[0].source,'files:'+inbound.files[0].id);assert.equal(r.value.results[0].extraction.status,'complete');assert.ok(r.value.results[0].text.includes('service-clearance-2418'))
  const metadata={tags:['cabinetry'],sheet:'A-201',cost_code:'06-400'}
  const annotate=async(source,cookie=f.owner)=>s.api(path+'/decision-search/metadata',{method:'POST',cookie,body:{source,...metadata}})
  for(const source of ['correspondence:'+inbound.id,'files:'+inbound.files[0].id])assert.equal((await annotate(source)).status,200)
  assert.equal((await annotate('files:'+inbound.files[0].id,s.client)).status,403)
  assert.equal((await find({q:'service-clearance-2418',tag:'cabinetry',sender:'client@example.com',sheet:'A-201',cost_code:'06-400'},s.client)).value.count,1)
  assert.equal((await find({q:'Natural oak please',tag:'cabinetry',sender:'client@example.com',sheet:'A-201',cost_code:'06-400'})).value.count,1)
  const textFile=Buffer.from('Service specification: synthetic-plinth-unicode-2420 — façade clearance')
  assert.deepEqual(await s.reply(sent.replyTo,{}, {id:'<synthetic-plinth-text-2420@example.com>',text:'Supplemental specification attached',file:{name:'service-specification.txt',type:'text/plain',bytes:textFile}}),{rejected:null})
  r=await find({q:'façade clearance',sender:'client@example.com'},s.client);assert.equal(r.value.count,1);assert.equal(r.value.results[0].extraction.status,'complete')
  const bidBytes=searchDocument(['Confidential subcontractor pricing', 'Private bid content synthetic-plinth-bid-value-2418'])
  const originalBid=Buffer.from(mime({from:'Trade Estimator <synthetic-plinth-sub@example.com>',to:'builder@example.com',subject:'Private millwork bid',id:'<synthetic-plinth-bid-2418@example.com>',text:'Private commercial bid for this job only',file:{name:'millwork-bid.pdf',type:'application/pdf',bytes:bidBytes}}))
  const sentBeforeCapture=f.messages.length
  r=await s.send({kind:'capture',original_base64:originalBid.toString('base64'),confirm:true});assert.equal(r.status,201,JSON.stringify(r.value));assert.equal(f.messages.length,sentBeforeCapture,'Original capture never sends a message')
  const captured=r.value.messages.find(m=>m.id===r.value.id),bidSource='correspondence:'+captured.id,bidFile='files:'+captured.files[0].id
  assert.equal(captured.visibility,'private');assert.equal(captured.counterparty,'synthetic-plinth-sub@example.com');assert.equal(captured.sender_check,'office capture')
  assert.equal((await s.send({kind:'capture',original_base64:originalBid.toString('base64'),confirm:true})).status,409,'An original is captured once per job')
  for(const source of [bidSource,bidFile])assert.equal((await annotate(source)).status,200)
  r=await find({q:'synthetic-plinth-bid-value-2418',tag:'cabinetry',sender:'synthetic-plinth-sub@example.com',sheet:'A-201',cost_code:'06-400'});assert.equal(r.value.count,1,JSON.stringify(r.value));assert.equal(r.value.results[0].source,bidFile)
  for(const query of [{q:'synthetic-plinth-bid-value-2418'},{source:bidSource},{source:bidFile},{sender:'synthetic-plinth-sub@example.com'},{q:'millwork-bid.pdf'}])assert.deepEqual((await find(query,s.client)).value,{results:[],count:0})
  const originalPath=path+'/correspondence/'+captured.id+'/original',filePath=path+'/correspondence/files/'+captured.files[0].id
  assert.deepEqual(Buffer.from(await(await f.request('/api/plinth'+originalPath,{cookie:f.owner})).arrayBuffer()),originalBid)
  assert.deepEqual(Buffer.from(await(await f.request('/api/plinth'+filePath,{cookie:f.owner})).arrayBuffer()),bidBytes)
  for(const route of [originalPath,filePath])assert.equal((await f.request('/api/plinth'+route,{cookie:s.client})).status,404)
  await s.send({ kind: 'note', body: 'Private subcontractor bid: synthetic-plinth-secret-bid-1' })
  assert.equal((await find({ q: 'synthetic-plinth-secret-bid-1' })).value.count, 1)
  r = await find({ q: 'synthetic-plinth-secret-bid-1' }, s.client); assert.deepEqual(r.value, { results: [], count: 0 }); assert.ok(!JSON.stringify(r.value).includes('Private subcontractor'), 'No hidden snippet or export data')
  const completionMailCount=f.messages.length
  job = await read(); const complete = { expected_version: job.version, action_id: meeting.actions[0].id, answer: 'Natural oak resolved from the exact client reply.', message_id: inbound.id, links: [{ kind: 'selection', id: s.selection }] }
  r = await s.api(path + `/meetings/${meeting.id}/complete`, { method: 'POST', cookie: s.client, body: complete }); assert.equal(r.status, 403)
  r = await s.api(path + `/meetings/${meeting.id}/complete`, { method: 'POST', body: { ...complete, links: [{ kind: 'selection', id: crypto.randomUUID() }] } }); assert.equal(r.status, 404); assert.equal((await read()).version, job.version, 'Invalid cross-record link commits nothing')
  r = await s.api(path + `/meetings/${meeting.id}/complete`, { method: 'POST', body: complete }); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.equal(r.value.record.completion.message_id, inbound.id); assert.equal(r.value.record.completion.links[0].id, s.selection); assert.ok(r.value.record.completion.links[0].source_ref); const sourceLink = r.value.record.completion.links[0]; const exactSource = await s.api(sourceLink.href.replace('/api/plinth', '')); const storedSelection = structuredClone(job.selections[0]); for (const revision of storedSelection.revisions) delete revision.procurement; assert.deepEqual(exactSource.value.snapshot, storedSelection); assert.equal(exactSource.value.source_ref, (await import('node:crypto')).createHash('sha256').update(JSON.stringify(exactSource.value.snapshot)).digest('hex')); assert.equal((await s.api(sourceLink.href.replace('/api/plinth', ''), { cookie: s.client })).status, 403)
  assert.equal(f.messages.length,completionMailCount,'Completing a meeting action sends nothing')
  job = await read(); assert.equal(job.meetings[0].history.at(-1).kind, 'completed'); assert.equal(job.meetings[0].actions[0].completion.by.name, 'Builder')
  assert.equal((await s.api(path + `/meetings/${meeting.id}/complete`, { method: 'POST', body: { ...complete, expected_version: job.version } })).status, 409, 'Completed answers are immutable')
  assert.equal((await find({ q: 'resolved from the exact' })).value.count, 1)
  r = await s.api(path + `/selections/${s.selection}/comment`, { method: 'POST', body: { expected_version: job.version, revision_id: job.selections[0].revisions[0].id, text: 'Later site review adds a new source comment.' } }); assert.equal(r.status, 200); job = await read(); assert.deepEqual((await s.api(sourceLink.href.replace('/api/plinth', ''))).value, exactSource.value, 'Later source edits never rewrite the completed answer snapshot')
  const comment=job.selections[0].comments.at(-1);assert.equal((await annotate('comments:'+comment.id)).status,200)
  r=await find({q:'Later site review',sender:'Builder',tag:'cabinetry',sheet:'A-201',cost_code:'06-400'});assert.equal(r.value.count,1);assert.equal(r.value.results[0].source,'comments:'+comment.id)
  const custom=await f.invite('synthetic-plinth-custom@example.com','Custom office copy','admin')
  const customPerson=(await s.api('/team')).value.team.find(p=>p.email==='synthetic-plinth-custom@example.com')
  const copied=await s.api('/roles',{method:'POST',body:{copy_of:'administrator',name:'Synthetic office copy'}});assert.equal(copied.status,201)
  assert.equal((await s.api('/team/'+customPerson.id,{method:'PUT',body:{expected_version:0,role:'custom',role_id:copied.value.role.id,job_ids:[job.id],po_limit_cents:0}})).status,200)
  assert.equal((await s.api(path+'/meetings',{cookie:custom})).status,403);assert.equal((await find({q:'oak'},custom)).status,403,'A copied administrator has no implicit meeting or search permission')
  assert.equal((await s.api(path,{cookie:custom})).value.job.meetings,undefined)
  const foreign = await f.invite('synthetic-plinth-foreign@example.com'); assert.equal((await find({ q: 'oak' }, foreign)).status, 404)
  const audit = await s.api('/audit'); assert.ok(!JSON.stringify(audit.value).includes('Natural oak resolved'), 'Audit stores references rather than private content')
  // Current job assignments govern both reads and completion, including a formerly assigned action owner.
  const pm = await f.invite('synthetic-plinth-pm@example.com', 'Site manager', 'admin')
  const person = (await s.api('/team')).value.team.find(p => p.email === 'synthetic-plinth-pm@example.com')
  assert.equal((await s.api('/team/' + person.id, { method: 'PUT', body: { expected_version: 0, role: 'project_manager', job_ids: [job.id], po_limit_cents: 0 } })).status, 200)
  assert.equal((await find({ q: 'oak' }, pm)).status, 200)
  r = await s.api(path + `/meetings/${meeting.id}/complete`, { method: 'POST', cookie: pm, body: { ...complete, expected_version: job.version } }); assert.equal(r.status, 403, 'A different manager cannot complete the assigned action')
  r = await s.api(path + `/meetings/${meeting.id}/add-action`, { method: 'POST', body: { expected_version: job.version, title: 'Confirm the drawing on site', owner_email: person.email, due_on: '2026-11-04' } }); assert.equal(r.status, 200); const pmAction = r.value.record; job = await read()
  const dueMailCount=f.messages.length;await f.scheduled(Date.parse('2026-11-05T12:00:00Z'));assert.equal(f.messages.length,dueMailCount,'Passing an action due date sends no automatic reminder')
  assert.equal((await s.api('/team/' + person.id, { method: 'PUT', body: { expected_version: 1, role: 'project_manager', job_ids: [], po_limit_cents: 0 } })).status, 200)
  assert.equal((await find({ q: 'oak' }, pm)).status, 404)
  assert.equal((await s.api(path + `/meetings/${meeting.id}/complete`, { method: 'POST', cookie: pm, body: { ...complete, action_id: pmAction.id, expected_version: job.version } })).status, 404)
  assert.equal((await read()).meetings[0].actions.find(a=>a.id===pmAction.id).completion,undefined,'Revocation leaves the orphaned action outstanding')
  const reassignmentMailCount=f.messages.length
  r=await s.api(path+`/meetings/${meeting.id}/reassign`,{method:'POST',body:{expected_version:job.version,action_id:pmAction.id,owner_email:'builder@example.com',reason:'Site manager left this job; builder resumes the reviewed action'}});assert.equal(r.status,200,JSON.stringify(r.value));job=await read()
  const reassigned=job.meetings[0].actions.find(a=>a.id===pmAction.id)
  assert.equal(reassigned.owner_email,'builder@example.com');assert.equal(reassigned.assignment_history[0].previous_owner_email,person.email);assert.equal(reassigned.assignment_history[0].owner_email,'builder@example.com');assert.equal(reassigned.assignment_history[0].reason,'Site manager left this job; builder resumes the reviewed action');assert.equal(reassigned.assignment_history[0].by.name,'Builder');assert.ok(reassigned.assignment_history[0].by.at)
  assert.equal((await s.api('/team/'+person.id,{method:'PUT',body:{expected_version:2,role:'project_manager',job_ids:[job.id],po_limit_cents:0}})).status,200)
  assert.equal((await s.api(path+`/meetings/${meeting.id}/complete`,{method:'POST',cookie:pm,body:{...complete,expected_version:job.version,action_id:pmAction.id}})).status,403,'The former assignee cannot complete after access returns')
  assert.equal((await s.api(path+`/meetings/${meeting.id}/complete`,{method:'POST',body:{...complete,expected_version:job.version-1,action_id:pmAction.id}})).status,409,'The stale pre-reassignment decision is refused')
  r=await s.api(path+`/meetings/${meeting.id}/complete`,{method:'POST',body:{...complete,expected_version:job.version,action_id:pmAction.id}});assert.equal(r.status,200);job=await read();assert.equal(f.messages.length,reassignmentMailCount,'Reassignment and completion send nothing')
  const clientPerson = (await f.json('/auth/operators', { cookie: f.owner })).value.find(p => p.email === 'client@example.com')
  assert.equal((await f.request('/auth/operator/status', { method: 'POST', cookie: f.owner, body: { operatorId: clientPerson.id, status: 'inactive' } })).status, 200)
  assert.equal((await find({ q: 'Natural oak' }, s.client)).status, 401)
  assert.equal((await f.request(`/api/plinth${path}/correspondence/files/${inbound.files[0].id}`, { cookie: s.client })).status, 401)
  const hold = await s.api('/holds', { method: 'POST', body: { subject_kind: 'job', subject_id: job.id, kind: 'legal_hold', reason: 'Meeting decision disputed', confirm: true } }); assert.equal(hold.status, 201)
  assert.equal((await s.api(path, { method: 'DELETE', body: { expected_version: job.version } })).value.error, 'retention_hold')
  assert.equal((await find({ q: 'resolved from the exact' })).value.count, 1)
  assert.equal((await s.api(`/holds/${hold.value.hold.id}/release`, { method: 'POST', body: { reason: 'Decision dispute settled' } })).status, 200)
  assert.equal((await s.api(path, { method: 'DELETE', body: { expected_version: job.version } })).status, 200)
  assert.equal((await find({ q: 'oak' })).status, 404, 'Search cannot resurrect erased meetings or correspondence')
  assert.equal((await f.request(`/api/plinth${path}/correspondence/files/${inbound.files[0].id}`, { cookie: f.owner })).status, 404)
  for(const table of ['pl_decision_metadata','pl_mail_originals'])assert.equal((await f.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE job_id=?`).bind(job.id).first()).n,0)

 } finally { await f.close() }
})

test('Reviewed meeting extracts isolate named audiences, delegated feedback, explicit custom capabilities and next-request revocation', async () => {
 const {createReleasedScope}=await import('./helpers.mjs')
 const persistTo=await mkdtemp(join(tmpdir(),'synthetic-plinth-'))
 let uncertain=false,deliveryGate,restarted,s,sourceClosed=false
 try {
  execFileSync(process.execPath,[fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'d1','migrations','apply','DB','--local','--persist-to',join(persistTo,'.wrangler/state'),'--config',fileURLToPath(new URL('../../wrangler.jsonc',import.meta.url))],{env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'pipe'})
  s=await setup({persistTo,now:Date.parse('2026-10-26T12:00:00Z'),mailResponse:async message=>{
   if(message.subject.startsWith('Meeting decision:')){if(deliveryGate){deliveryGate.entered.resolve();await deliveryGate.release.promise}if(uncertain)throw Error('Synthetic lost provider response')}
   return new Response(null,{status:202,headers:{'x-message-id':'synthetic-plinth-meeting-delivery'}})
  }})
 } catch(error){await s?.f.close();await rm(persistTo,{recursive:true,force:true});throw error}
 const {f}=s
 try {
  let job=(await s.api(`/jobs/${s.job().id}`)).value.job
  const path=`/jobs/${job.id}`,read=async()=>job=(await s.api(path)).value.job
  const act=async(route,body={},cookie=f.owner)=>{await read();const r=await s.api(path+route,{method:'POST',cookie,body:{expected_version:job.version,...body}});if(r.value.job)job=r.value.job;return r}
  const field=await f.invite('synthetic-plinth-shared-field@example.com','Field lead','admin'),custom=await f.invite('synthetic-plinth-shared-custom@example.com','Custom office','admin'),sub=await f.invite('synthetic-plinth-shared-sub@example.com','Subcontractor'),other=await f.invite('synthetic-plinth-shared-other@example.com')
  const people=(await s.api('/team')).value.team,fieldPerson=people.find(p=>p.email==='synthetic-plinth-shared-field@example.com'),customPerson=people.find(p=>p.email==='synthetic-plinth-shared-custom@example.com')
  const team=async(person,body)=>s.api('/team/'+person.id,{method:'PUT',body:{expected_version:0,job_ids:[job.id],po_limit_cents:0,...body}})
  assert.equal((await team(fieldPerson,{role:'superintendent'})).status,200)
  const copied=await s.api('/roles',{method:'POST',body:{copy_of:'project_manager',name:'Explicit extract reader'}});assert.equal(copied.status,201)
  assert.equal((await team(customPerson,{role:'custom',role_id:copied.value.role.id})).status,200)
  const released=await createReleasedScope(f,job,'synthetic-plinth-shared-sub@example.com','Millwork');job=released.job
  let r=await act('/meetings',{title:'Private coordination meeting',held_on:'2026-10-26',agenda:'Office coordination',minutes:'Private subcontractor price synthetic-plinth-private-2419',attendees:['Field lead','Client'],decisions:'Private office decision',tags:[],sheet:'',cost_code:'',actions:[]});assert.equal(r.status,200);const meeting=r.value.record
  const recipients=[{email:'client@example.com',kind:'client',can_comment:true},{email:fieldPerson.email,kind:'office',can_comment:true},{email:customPerson.email,kind:'office',can_comment:true},{email:'synthetic-plinth-shared-sub@example.com',kind:'sub',subcontract_id:released.scope.id,can_comment:false}]
  const input={title:'Reviewed cabinetry coordination',body:'Cabinet shop drawing review is needed before the field measurement.',recipients,operation_id:'synthetic-plinth-share-2419',confirm:true}
  const before=f.messages.length
  assert.equal((await act(`/meetings/${meeting.id}/share`,{...input,confirm:false})).status,400)
  assert.equal((await act(`/meetings/${meeting.id}/share`,input,field)).status,403)
  const agent=await f.agent();await read();assert.equal((await s.api(path+`/meetings/${meeting.id}/share`,{method:'POST',token:agent,cookie:undefined,body:{expected_version:job.version,...input}})).status,403)
  assert.equal((await s.api('/meeting-inbox',{cookie:custom})).value.jobs.length,0,'Copied permissions grant no extract without an explicit record grant')
  const beforePublication=f.messages.length
  r=await act(`/meetings/${meeting.id}/share`,input);assert.equal(r.status,200,JSON.stringify(r.value));const share=r.value.record;assert.equal(f.messages.length,beforePublication,'Publishing an extract sends nothing')
  assert.equal((await act(`/meetings/${meeting.id}/share`,input)).status,409)
  const inbox=async(cookie)=>s.api('/meeting-inbox',{cookie})
  for(const cookie of [s.client,field,custom,sub]){
   const value=(await inbox(cookie)).value;assert.equal(value.jobs.length,1,JSON.stringify(value));assert.equal(value.jobs[0].shares.length,1)
   const serialized=JSON.stringify(value);for(const privateText of ['synthetic-plinth-private-2419','meeting_id','recipients','operator_version','operation_id'])assert.equal(serialized.includes(privateText),false)
   assert.equal((await s.api(path+'/meetings',{cookie})).status,cookie===sub?404:403,'An extract never grants private meeting access')
   const artifact=await f.request(`/api/plinth/meeting-inbox/${job.id}/${share.id}/export.json`,{cookie});assert.equal(artifact.status,200);assert.equal((await artifact.json()).body,input.body)
   assert.equal((await s.api(`/meeting-inbox/${job.id}/decision-search?q=field`,{cookie})).value.count,1)
  }
  assert.equal((await inbox(other)).value.jobs.length,0)
  const feedback=async(cookie,body)=>{const current=(await inbox(cookie)).value.jobs[0];return s.api(`/meeting-inbox/${job.id}/${share.id}/feedback`,{method:'POST',cookie,body:{expected_version:current.version,operation_id:crypto.randomUUID(),body}})}
  assert.equal((await feedback(s.client,'Client question for the office only')).status,200)
  assert.equal((await feedback(field,'Field observation for the office only')).status,200)
  assert.equal((await feedback(sub,'A view-only subcontractor cannot comment')).status,403)
  assert.equal((await inbox(custom)).value.jobs[0].shares[0].feedback.length,0)
  assert.equal((await inbox(s.client)).value.jobs[0].shares[0].feedback[0].body,'Client question for the office only')
  const financial=(await act('/claims',{description:'Reviewed financial record is not a meeting grant',cumulative_cents:1000})).value.record
  assert.equal((await act(`/claims/${financial.id}/approve`)).status,200);assert.equal((await act(`/claims/${financial.id}/export`)).status,200)
  const repeatedExport=await act(`/claims/${financial.id}/export`,{},custom);assert.equal(repeatedExport.status,200)
  assert.equal(repeatedExport.value.job.meetings,undefined,'An unrelated repeated financial export cannot expose private meetings to a custom role')
  assert.equal(repeatedExport.value.job.meeting_shares,undefined,'An unrelated repeated financial export cannot expose sharing grants or private feedback')
  const copyPath=`/meeting-inbox/${job.id}/${share.id}/email-copy`,sendPath=`/meeting-shares/${share.id}/send-email`
  const requestCopy=async(cookie,extra={})=>{const current=(await inbox(cookie)).value.jobs[0];return s.api(copyPath,{method:'POST',cookie,body:{expected_version:current.version,kind:'minutes',confirm:true,operation_id:crypto.randomUUID(),...extra}})}
  const previewCopy=id=>s.api(path+`/meeting-shares/${share.id}/email-preview?request_id=${id}`)
  const sendCopy=(request,preview,cookie=f.owner)=>act(sendPath,{request_id:request.id,confirm:true,digest:preview.digest},cookie)
  const copyState=async id=>(await s.api(path+`/meetings/${meeting.id}/shares`)).value.shares.find(s=>s.id===share.id).email_requests.find(r=>r.id===id)
  const mailBefore=f.messages.length,versionBeforeConsent=(await read()).version
  for(const confirm of [false,undefined])assert.equal((await requestCopy(s.client,{confirm})).status,400,'An email request requires explicit recipient consent')
  assert.equal((await read()).version,versionBeforeConsent);assert.equal(f.messages.length,mailBefore)
  r=await requestCopy(s.client);assert.equal(r.status,200,JSON.stringify(r.value));const emailRequest=r.value.record
  assert.equal(f.messages.length,mailBefore,'A recipient request sends nothing')
  const initialPreview=await previewCopy(emailRequest.id);assert.equal(initialPreview.status,200)
  const admin=await f.invite('synthetic-plinth-2421@example.com','Office administrator','admin'),beforeAuthority=f.messages.length
  for(const cookie of [s.client,admin,field,custom])assert.equal((await sendCopy(emailRequest,initialPreview.value,cookie)).status,403,'Another signed-in role cannot finalize meeting delivery')
  await read();assert.equal((await s.api(path+sendPath,{method:'POST',cookie:undefined,token:agent,body:{expected_version:job.version,request_id:emailRequest.id,confirm:true,digest:initialPreview.value.digest}})).status,403,'An owner-issued bearer is still draft-only')
  assert.equal((await copyState(emailRequest.id)).status,'requested');assert.equal(f.messages.length,beforeAuthority)
  const preferences={assignment:'off',comment:'off',reminder:'off'}
  let preferenceRevision=0
  const quiet=async value=>{const r=await s.api('/todos/preferences',{method:'POST',cookie:s.client,body:{expected_revision:preferenceRevision,...preferences,...(value?{quiet:value}:{})}});assert.equal(r.status,200,JSON.stringify(r.value));preferenceRevision++}
  await quiet({start:'00:00',end:'00:00',time_zone:'America/New_York'})
  assert.equal((await previewCopy(emailRequest.id)).value.error,'mail_quiet')
  assert.equal((await sendCopy(emailRequest,initialPreview.value)).value.error,'mail_quiet','Final send rechecks quiet hours after review')
  await quiet()
  const preview=await previewCopy(emailRequest.id);assert.equal(preview.status,200,JSON.stringify(preview.value));assert.equal(preview.value.email,'client@example.com');assert.equal(preview.value.body.includes('synthetic-plinth-private-2419'),false)
  assert.equal(preview.value.digest,initialPreview.value.digest,'Unchanged complete outgoing content has a stable review digest')
  const unsubscribe=new URL(preview.value.body.match(/https?:\/\/\S+\/api\/plinth\/mail\/unsubscribe\/\S+/)[0])
  const reviewed={request_id:emailRequest.id,email:preview.value.email,subject:preview.value.subject,body:preview.value.body}
  assert.equal(preview.value.digest,createHash('sha256').update(JSON.stringify(reviewed)).digest('hex'),'The review binds the complete outgoing body, including its unsubscribe footer')
  assert.equal((await act(sendPath,{request_id:emailRequest.id,confirm:true,digest:'stale review'})).status,409)
  assert.equal((await act(sendPath,{request_id:emailRequest.id,confirm:false,digest:preview.value.digest})).status,409)
  const gate={entered:Promise.withResolvers(),release:Promise.withResolvers()};deliveryGate=gate
  await read();const concurrentBody={expected_version:job.version,request_id:emailRequest.id,confirm:true,digest:preview.value.digest},beforeConcurrent=f.messages.length
  const attempts=Promise.all([s.api(path+sendPath,{method:'POST',body:concurrentBody}),s.api(path+sendPath,{method:'POST',body:concurrentBody})])
  let gateError
  try {
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Meeting send never reached the provider edge')),20000);gate.entered.promise.then(()=>{clearTimeout(timer);resolve()})})
   assert.equal((await copyState(emailRequest.id)).status,'unknown','The reservation is durable before the provider responds')
   assert.equal((await requestCopy(s.client,{cancel:true,request_id:emailRequest.id})).value.error,'mail_reserved','Cancellation cannot undo a reserved send')
  } catch(error){gateError=error} finally {gate.release.resolve();deliveryGate=undefined}
  const results=await attempts;if(gateError)throw gateError;assert.deepEqual(results.map(r=>r.status).sort(),[200,409],'Concurrent final sends reserve only once')
  assert.equal(f.messages.length,beforeConcurrent+1)
  const wire=f.messages.at(-1);assert.deepEqual(wire.to,[preview.value.email]);assert.equal(wire.subject,preview.value.subject);assert.equal(wire.text,preview.value.body)
  assert.equal(wire.wire.content.find(c=>c.type==='text/html').value,'<pre>'+preview.value.body.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</pre>')
  const stored=await copyState(emailRequest.id);assert.equal(stored.body,wire.text);assert.equal(stored.subject,wire.subject)
  const sends=(await s.api('/audit?'+new URLSearchParams({kind:'send',action:'meeting-shares.send-email',job_id:job.id,subject_id:share.id}))).value.events
  assert.equal(sends.length,2,'Reservation and outcome are both classified as meeting sends')
  for(const event of sends){assert.equal(event.actor_id,stored.approved_by.id);assert.equal(event.actor_role,'owner');assert.equal(event.source,'session');assert.equal(event.subject_kind,'meeting-shares');assert.equal(event.version_after,event.version_before+1);assert.match(event.before_ref,/^[0-9a-f]{64}$/);assert.match(event.after_ref,/^[0-9a-f]{64}$/);assert.notEqual(event.before_ref,event.after_ref)}
  assert.equal(sends[0].before_ref,sends[1].after_ref,'The outcome references the exact reserved state');assert.equal(JSON.stringify(sends).includes(input.body),false)
  assert.equal((await sendCopy(emailRequest,preview.value)).status,409);assert.equal(f.messages.length,beforeConcurrent+1,'A delivered request never sends twice')
  r=await requestCopy(s.client);assert.equal(r.status,200);const cancelled=r.value.record,cancelledPreview=(await previewCopy(cancelled.id)).value
  assert.equal((await requestCopy(s.client,{cancel:true,request_id:cancelled.id})).status,200)
  const beforeCancelled=f.messages.length
  assert.equal((await previewCopy(cancelled.id)).status,409);assert.equal((await sendCopy(cancelled,cancelledPreview)).status,409);assert.equal(f.messages.length,beforeCancelled,'A cancelled request cannot pass the final send door')
  // Both contenders carry the same native optimistic version; exactly one wins.
  r=await requestCopy(s.client);assert.equal(r.status,200);const racing=r.value.record,racingPreview=(await previewCopy(racing.id)).value;await read()
  const raceVersion=job.version,beforeRace=f.messages.length
  const race=await Promise.all([s.api(path+sendPath,{method:'POST',body:{expected_version:raceVersion,request_id:racing.id,confirm:true,digest:racingPreview.digest}}),s.api(copyPath,{method:'POST',cookie:s.client,body:{expected_version:raceVersion,confirm:true,cancel:true,request_id:racing.id}})])
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);const raceState=await copyState(racing.id)
  assert.equal(raceState.status,race[0].status===200?'accepted':'cancelled');assert.equal(f.messages.length,beforeRace+(race[0].status===200?1:0))
  // Wall-clock boundaries include daytime, overnight and the repeated DST hour.
  for(const window of [
   {start:'08:00',end:'09:00',before:'2026-10-26T11:59:00Z',held:['2026-10-26T12:00:00Z','2026-10-26T12:59:00Z'],after:'2026-10-26T13:00:00Z'},
   {start:'22:00',end:'07:00',before:'2026-10-27T01:59:00Z',held:['2026-10-27T02:00:00Z','2026-10-27T10:59:00Z'],after:'2026-10-27T11:00:00Z'},
   {start:'01:00',end:'02:00',before:'2026-11-01T04:59:00Z',held:['2026-11-01T05:00:00Z','2026-11-01T05:30:00Z','2026-11-01T06:30:00Z','2026-11-01T06:59:00Z'],after:'2026-11-01T07:00:00Z'},
  ]){
   f.setNow(Date.parse(window.before));await quiet({start:window.start,end:window.end,time_zone:'America/New_York'})
   r=await requestCopy(s.client);assert.equal(r.status,200);const request=r.value.record,review=(await previewCopy(request.id)).value,beforeBoundary=f.messages.length
   assert.ok(review.digest)
   for(const time of window.held){f.setNow(Date.parse(time));assert.equal((await previewCopy(request.id)).value.error,'mail_quiet');assert.equal((await sendCopy(request,review)).value.error,'mail_quiet');assert.equal((await copyState(request.id)).status,'requested');assert.equal(f.messages.length,beforeBoundary)}
   f.setNow(Date.parse(window.after));assert.equal((await previewCopy(request.id)).value.digest,review.digest);assert.equal((await sendCopy(request,review)).status,200);assert.equal(f.messages.length,beforeBoundary+1);assert.equal(f.messages.at(-1).text,review.body)
  }
  f.setNow(Date.parse('2026-10-26T12:00:00Z'));await quiet()
  uncertain=true;r=await requestCopy(s.client);assert.equal(r.status,200);const uncertainRequest=r.value.record
  const uncertainPreview=await previewCopy(uncertainRequest.id);assert.equal(uncertainPreview.status,200)
  const beforeUncertain=f.messages.length
  r=await sendCopy(uncertainRequest,uncertainPreview.value);assert.equal(r.status,200);assert.equal(f.messages.length,beforeUncertain+1)
  assert.equal((await inbox(s.client)).value.jobs[0].shares[0].email_copy.status,'unknown')
  assert.equal((await sendCopy(uncertainRequest,uncertainPreview.value)).status,409);assert.equal(f.messages.length,beforeUncertain+1,'An uncertain send cannot automatically resend');uncertain=false
  // Suppression is exercised at this sender, using the footer it actually reviewed.
  r=await requestCopy(s.client);assert.equal(r.status,200);const suppressed=r.value.record,suppressedPreview=(await previewCopy(suppressed.id)).value
  assert.equal((await fetch(f.origin+unsubscribe.pathname,{method:'POST',body:'List-Unsubscribe=One-Click',headers:{'content-type':'application/x-www-form-urlencoded'}})).status,200)
  const beforeSuppressed=f.messages.length
  assert.equal((await sendCopy(suppressed,suppressedPreview)).status,200);assert.equal((await copyState(suppressed.id)).status,'cancelled');assert.equal(f.messages.length,beforeSuppressed,'A signed unsubscribe blocks the meeting-email provider call')
  const roleChange=await s.api('/roles/'+copied.value.role.id,{method:'PUT',body:{expected_version:copied.value.role.version,permissions:{documents:{view:false}}}});assert.equal(roleChange.status,200,JSON.stringify(roleChange.value))
  assert.equal((await inbox(custom)).status,403,'Changing the custom role removes its explicit extract capability on the next request')
  assert.equal((await f.request(`/api/plinth/meeting-inbox/${job.id}/${share.id}/export.json`,{cookie:custom})).status,403)
  assert.equal((await s.api('/team/'+fieldPerson.id,{method:'PUT',body:{expected_version:1,role:'superintendent',job_ids:[],po_limit_cents:0}})).status,200)
  assert.equal((await inbox(field)).value.jobs.length,0)
  r=await act(`/subcontracts/${released.scope.id}/access`,{contact_ids:[],reason:'The named subcontractor contact left this released scope'});assert.equal(r.status,200)
  assert.equal((await inbox(sub)).value.jobs.length,0,'Released company contact revocation applies to meeting extracts on the next request')
  assert.equal((await f.request(`/api/plinth/meeting-inbox/${job.id}/${share.id}/export.json`,{cookie:sub})).status,404)
  r=await act(`/meeting-shares/${share.id}/revoke`,{reason:'Withdraw the reviewed extract after the coordination change',operation_id:'synthetic-plinth-revoke-2419',confirm:true});assert.equal(r.status,200)
  assert.equal((await inbox(s.client)).value.jobs.length,0);assert.equal((await inbox(sub)).value.jobs.length,0)
  assert.equal((await s.api(`/meeting-inbox/${job.id}/decision-search?q=field`,{cookie:s.client})).status,404)
  assert.equal((await s.api(path,{cookie:s.client})).value.job.meeting_shares,undefined,'Job projections never expose full sharing grants or private feedback')
  r=await act(`/meetings/${meeting.id}/add-action`,{title:'Confirm the revised shop drawing',owner_email:'builder@example.com',due_on:'2026-11-03'});assert.equal(r.status,200);const action=r.value.record
  r=await act(`/meetings/${meeting.id}/share`,{...input,operation_id:'synthetic-plinth-reminder-extract',recipients:[{email:'builder@example.com',kind:'office',can_comment:false}]});assert.equal(r.status,200);const reminderShare=r.value.record
  await read();r=await s.api(`/meeting-inbox/${job.id}/${reminderShare.id}/email-copy`,{method:'POST',body:{expected_version:job.version,kind:'action_reminder',action_id:action.id,confirm:true,operation_id:'synthetic-plinth-reminder-request'}});assert.equal(r.status,200);const reminder=r.value.record
  const reminderPreview=await s.api(path+`/meeting-shares/${reminderShare.id}/email-preview?request_id=${reminder.id}`);assert.equal(reminderPreview.status,200);assert.ok(reminderPreview.value.body.includes(action.title));assert.ok(reminderPreview.value.body.includes(action.due_on))
  const beforeReminder=f.messages.length
  r=await act(`/meeting-shares/${reminderShare.id}/send-email`,{request_id:reminder.id,digest:reminderPreview.value.digest,confirm:true});assert.equal(r.status,200);assert.equal(f.messages.length,beforeReminder+1);assert.deepEqual(f.messages.at(-1).to,['builder@example.com'])
  await read();r=await s.api(`/meeting-inbox/${job.id}/${reminderShare.id}/email-copy`,{method:'POST',body:{expected_version:job.version,kind:'action_reminder',action_id:action.id,confirm:true,operation_id:'synthetic-plinth-completed-reminder-request'}});assert.equal(r.status,200);const superseded=r.value.record
  assert.equal((await act(`/meetings/${meeting.id}/complete`,{action_id:action.id,answer:'The field clearance was reviewed against the retained selection.',links:[{kind:'selection',id:s.selection}]})).status,200)
  assert.equal((await s.api(path+`/meeting-shares/${reminderShare.id}/email-preview?request_id=${superseded.id}`)).status,409,'A completed action cannot receive a later reminder instruction');assert.equal(f.messages.length,beforeReminder+1)


  // Reopen the same D1 installation and replay both accepted and uncertain reservations.
  const cookie=f.owner;await f.close();sourceClosed=true
  restarted=await createFixture({persistTo,ownerCookie:cookie,now:Date.parse('2026-10-26T12:00:00Z')})
  const recovered=await restarted.json('/api/plinth'+path+`/meetings/${meeting.id}/shares`,{cookie});assert.equal(recovered.status,200)
  const saved=recovered.value.shares.find(s=>s.id===share.id).email_requests
  for(const [request,review,status] of [[emailRequest,preview.value,'accepted'],[uncertainRequest,uncertainPreview.value,'unknown']]){
   assert.equal(saved.find(r=>r.id===request.id).status,status)
   const current=(await restarted.json('/api/plinth'+path,{cookie})).value.job
   const replay=await restarted.json('/api/plinth'+path+sendPath,{method:'POST',cookie,body:{expected_version:current.version,request_id:request.id,digest:review.digest,confirm:true}})
   assert.equal(replay.status,409);assert.equal(replay.value.error,'mail_reserved')
  }
  assert.equal(restarted.messages.length,0,'Restart cannot replay an accepted or uncertain delivery')
 } finally {deliveryGate?.release.resolve();await restarted?.close();if(!sourceClosed)await f.close();await rm(persistTo,{recursive:true,force:true})}
})
