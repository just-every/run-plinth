import { digest } from './attachments'
import { requireOwner } from './auth'
import { today } from './compliance'
import { acceptWaiver, attachRelease, lienPacket, lienSetup, recordException, recordPayment, requestDraw, requestWaiver, templateList, type WaiverTemplates } from './lien-waiver-model'
import { find, need, object, recordApproval, text, type Actor, type Attachment, type Input, type Job } from './model'
import { readClock, transaction } from './store'
import { documentBytes } from './vendor-model'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const empty: WaiverTemplates = { version: 0, templates: [] }
/** Lien waivers are office records: owners and administrators only; agents and clients never reach them. */
const office = (actor: Actor) => need(actor.role === 'owner' || actor.role === 'admin', 'Only an owner or administrator manages lien waivers', 403, 'forbidden')
export async function waiverTemplates(db: D1Database): Promise<WaiverTemplates> {
 const row = await db.prepare('SELECT data FROM pl_lien_waiver_templates WHERE id=1').first<{ data: string }>()
 return row ? JSON.parse(row.data) as WaiverTemplates : empty
}
export async function templatesResponse(request: Request, db: D1Database, actor: Actor, parts: string[], readBody: (request: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'lien-waiver-templates') return null
 need(parts.length === 1, 'Unknown lien waiver route', 404, 'not_found'); office(actor)
 if (request.method === 'GET') return Response.json({ templates: await waiverTemplates(db) }, { headers })
 need(request.method === 'PUT', 'Method not allowed', 405, 'method_not_allowed'); requireOwner(actor)
 const input = object(await readBody(request)), clock = await readClock(db), previous = await waiverTemplates(db)
 need(input.expected_version === previous.version, 'Waiver templates changed; reload before saving', 409, 'stale_version')
 const next = templateList(input, actor, previous), data = JSON.stringify(next)
 await transaction(db, actor, null, [previous.version ? db.prepare('UPDATE pl_lien_waiver_templates SET version=?,data=? WHERE id=1 AND version=?').bind(next.version, data, previous.version) : db.prepare('INSERT INTO pl_lien_waiver_templates(id,version,data) VALUES(1,?,?)').bind(next.version, data)], clock)
 return Response.json({ templates: next }, { headers })
}
/** POST /jobs/:job/subcontracts/:sub/lien | draws | draws/:draw/(waivers|exception|payment) | draws/:draw/waivers/:waiver/(release|accept). */
export async function lienAction(db: D1Database, job: Job, actor: Actor, path: string[], input: Input): Promise<{ record: unknown; writes: D1PreparedStatement[] }> {
 office(actor)
 const sub = find(job.subcontracts ?? [], path[0]!), [, area, drawId, action, waiverId, step] = path
 const audit = (kind: string, snapshot: unknown, id = sub.id) => recordApproval(job, actor, `lien_waiver.${kind}`, { id, prepared_by: sub.awarded_by }, snapshot)
 if (path.length === 2 && area === 'lien') { sub.lien = lienSetup(sub, input, actor); audit('setup', sub.lien); return { record: sub.lien, writes: [] } }
 if (path.length === 2 && area === 'draws') { const draw = requestDraw(sub, input, actor); audit('draw', draw, draw.id); return { record: draw, writes: [] } }
 need(area === 'draws' && drawId, 'Unknown lien waiver action', 404, 'not_found')
 const draw = find(sub.draws ?? [], drawId)
 if (path.length === 4 && action === 'waivers') { const row = requestWaiver(sub, draw, input, actor, await waiverTemplates(db), job.id); audit('request', row, row.id); return { record: row, writes: [] } }
 if (path.length === 4 && action === 'exception') { const row = recordException(draw, input, actor); audit('exception', { draw_id: draw.id, ...row }, draw.id); return { record: row, writes: [] } }
 if (path.length === 4 && action === 'payment') { const row = recordPayment(sub, draw, input, actor); audit('payment', { draw_id: draw.id, ...row }, draw.id); return { record: row, writes: [] } }
 need(path.length === 6 && action === 'waivers' && waiverId, 'Unknown lien waiver action', 404, 'not_found')
 const waiver = find(draw.waivers, waiverId)
 if (step === 'accept') { acceptWaiver(waiver, input, actor); audit('accept', waiver, waiver.id); return { record: waiver, writes: [] } }
 need(step === 'release', 'Unknown lien waiver action', 404, 'not_found')
 const file = object(input.document), name = text(file.name, 'document name', 240); need(!/[\x00-\x1f/\\]/.test(name), 'Invalid document name')
 const { bytes, mime } = documentBytes(file.base64, 'The signed release')
 const document: Attachment = { id: crypto.randomUUID(), name, mime, checksum: await digest(bytes), size: bytes.length }
 attachRelease(waiver, input, actor, document); audit('release', waiver, waiver.id)
 return { record: waiver, writes: [db.prepare('INSERT INTO pl_lien_waiver_files(id,job_id,bytes) VALUES(?,?,?)').bind(document.id, job.id, bytes)] }
}
/** The office draw packet: a pay app with every unresolved downstream waiver and notice deadline of the job. */
export async function packetResponse(db: D1Database, job: Job, actor: Actor, claimId: string) {
 office(actor); const claim = find(job.claims, claimId)
 return Response.json({ claim, lien_waivers: lienPacket(job.subcontracts ?? [], await today(db)) }, { headers })
}
export async function releaseFile(db: D1Database, job: Job, actor: Actor, id: string) {
 office(actor)
 const waiver = (job.subcontracts ?? []).flatMap(s => (s.draws ?? []).flatMap(d => d.waivers)).find(w => w.release?.document.id === id)
 need(waiver, 'Document not found', 404, 'not_found'); const metadata = waiver.release!.document
 const stored = await db.prepare('SELECT bytes FROM pl_lien_waiver_files WHERE id=? AND job_id=?').bind(id, job.id).first<{ bytes: ArrayBuffer }>()
 need(stored, 'Original release is unavailable', 503, 'document_missing')
 const bytes = new Uint8Array(stored.bytes)
 need(bytes.length === metadata.size && await digest(bytes) === metadata.checksum, 'Release integrity check failed', 503, 'document_integrity')
 return new Response(bytes, { headers: { ...headers, 'content-type': metadata.mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`, 'content-security-policy': "sandbox; default-src 'none'", 'x-plinth-verification': waiver.release!.signature } })
}
