import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { searchDocument } from '../fixtures/search-document.mjs'

export function originalEmail({ from, to, subject, text, file, id = crypto.randomUUID() }) {
 return Buffer.from([`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: <synthetic-plinth-${id}@example.com>`, 'Authentication-Results: mx.synthetic.local; spf=pass; dkim=pass', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="synthetic-plinth-journey"', '', '--synthetic-plinth-journey', 'Content-Type: text/plain; charset=utf-8', '', text, '', '--synthetic-plinth-journey', `Content-Type: ${file.mime ?? 'application/pdf'}; name="${file.name}"`, `Content-Disposition: attachment; filename="${file.name}"`, 'Content-Transfer-Encoding: base64', '', file.bytes.toString('base64'), '', '--synthetic-plinth-journey--', ''].join('\r\n'))
}
/** Real local Email Routing transport invokes the installed Worker's email event. */
export async function meetingCorrespondence({ base, page, owner, job, email, post, capture }) {
 const publicMessage = await post(`/jobs/${job.id}/correspondence`, { kind: 'message', subject: 'Cabinet drawing requested after site review', body: 'Please reply with the reviewed service clearances.' })
 const thread = (await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/correspondence`)).json()).messages
 const outgoing = thread.find(m => m.id === publicMessage.id)
 assert.ok(outgoing.reply_to, 'Configure the local reply domain for this installed email journey')
 const drawing = searchDocument(), raw = originalEmail({ from: email, to: outgoing.reply_to, subject: 'Reviewed cabinet service drawing', text: 'The reviewed cabinet service drawing is attached for the meeting action.', file: { name: 'client-service-drawing.pdf', bytes: drawing } })
 const emailBase=process.env.PLINTH_EMAIL_URL
 assert.ok(emailBase && ['localhost','127.0.0.1'].includes(new URL(emailBase).hostname), 'Use this installation’s local Worker transport listener')
 const transport = new URL('/cdn-cgi/local/email', emailBase)
 transport.search = new URLSearchParams({ from: email, to: outgoing.reply_to, format: 'json' })
 let response
 try { response = await owner.request.post(transport.href, { headers: { 'content-type': 'message/rfc822' }, data: raw }) }
 catch { throw new Error('Local Worker email transport did not complete') }
 const result = await response.json()
 assert.equal(response.status(), 200); assert.equal(result.outcome, 'ok'); assert.equal(result.rejectReason, undefined); assert.ok(result.events.some(e => e.type === 'received'))
 const messages = (await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/correspondence`)).json()).messages
 const inbound = messages.find(m => m.direction === 'in' && m.reply_to_id === outgoing.id)
 assert.ok(inbound && inbound.files.length === 1, 'The installed email event stores its exact message and original file')
 assert.deepEqual(Buffer.from(await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/correspondence/files/${inbound.files[0].id}`)).body()), drawing)
 const bidBytes = searchDocument(['Private subcontractor pricing', 'Confidential millwork bid synthetic-plinth-private-bid-878'])
 const original = originalEmail({ from: 'synthetic-plinth-sub@example.com', to: 'builder@example.com', subject: 'Private millwork subcontractor bid', text: 'Commercial bid for the office only', file: { name: 'private-millwork-bid.pdf', bytes: bidBytes } })
 await page.goto(base + `/app?job=${job.id}&tab=Messages`)
 await page.locator('select[name=kind]').selectOption('capture')
 await page.getByLabel('Original email file').setInputFiles({ name: 'millwork-bid.eml', mimeType: 'message/rfc822', buffer: original })
 await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Capture private email', exact: true }).click()
 await expect(page.getByText('Private millwork subcontractor bid', { exact: true })).toBeVisible()
 await capture(page, 'private-original-email')
 const captured = (await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/correspondence`)).json()).messages.find(m => m.kind === 'captured')
 assert.ok(captured?.files[0])
 assert.deepEqual(Buffer.from(await (await owner.request.get(base + `/api/plinth/jobs/${job.id}/correspondence/${captured.id}/original`)).body()), original)
 return { inbound, captured }
}
