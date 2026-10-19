import { runtimeBindings, type Bindings } from '../auth.server'
import { digest } from './attachments'
import { authorize, requireManager, requireOwner } from './auth'
import { DomainError, need, object, type Actor, type Input } from './model'
import { readClock, transaction } from './store'
import { addRate, qualify, summary, taxIdentity, vendorFields, type Vendor } from './vendor-model'

const root = '/api/plinth/vendors'
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
export async function getVendor(db: D1Database, id: string): Promise<Vendor> {
 const row = await db.prepare('SELECT data FROM pl_vendors WHERE id=?').bind(id).first<{ data: string }>()
 need(row, 'Company not found', 404, 'not_found'); return JSON.parse(row.data) as Vendor
}
async function body(request: Request): Promise<Input> {
 need((request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase() === 'application/json', 'Send application/json', 415, 'content_type')
 const text = await request.text(); need(text.length <= 3_000_000, 'Request is too large', 413, 'body_size')
 try { return object(JSON.parse(text)) } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('invalid_json', 'Invalid JSON body') }
}
function save(db: D1Database, vendor: Vendor, previous?: Vendor) {
 vendor.version = (previous?.version ?? 0) + 1
 const data = JSON.stringify(vendor); need(data.length <= 4_000_000, 'Company history is too large', 413, 'body_size')
 return previous ? [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_vendors WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(previous.id, previous.version), db.prepare('UPDATE pl_vendors SET version=?,data=? WHERE id=? AND version=?').bind(vendor.version, data, vendor.id, previous.version)]
  : [db.prepare('INSERT INTO pl_vendors(id,version,data) VALUES(?,?,?)').bind(vendor.id, vendor.version, data)]
}
const audit = (db: D1Database, actor: Actor, action: string, value: string) => db.prepare('INSERT INTO oa_auth_audit(id,actor_id,action,value,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), actor.id, action, value, Date.now())

/** SUB-001 directory. Owners and administrators manage it; bearer agents read names, trades, areas and
 * qualification decisions only; clients and any future subcontractor login are refused. W-9 originals
 * are served only to owners and administrators, and every download is audited. */
async function handle(request: Request, original: Bindings): Promise<Response> {
 const env = runtimeBindings(original), db = env.DB, actor = await authorize(request, env), method = request.method
 requireManager(actor, method === 'GET')
 const parts = new URL(request.url).pathname.slice(root.length).split('/').filter(Boolean)
 need(parts.length <= 3, 'Unknown directory route', 404, 'not_found')
 if (parts.length === 0 && method === 'GET') {
  const rows = (await db.prepare('SELECT data FROM pl_vendors ORDER BY rowid DESC').all<{ data: string }>()).results.map(r => JSON.parse(r.data) as Vendor)
  return json({ vendors: actor.role === 'agent' ? rows.map(summary) : rows })
 }
 const clock = method === 'GET' ? 0 : await readClock(db)
 if (parts.length === 0) {
  need(method === 'POST', 'Method not allowed', 405, 'method_not_allowed')
  const vendor = vendorFields(undefined, await body(request), actor)
  await transaction(db, actor, null, save(db, vendor), clock); return json({ vendor }, 201)
 }
 const previous = await getVendor(db, parts[0]!)
 if (method === 'GET') {
  if (parts.length === 1) return json({ vendor: actor.role === 'agent' ? summary(previous) : previous })
  need(parts.length === 2 && parts[1] === 'w9', 'Unknown directory route', 404, 'not_found'); requireManager(actor)
  const tax = previous.tax; need(tax, 'No W-9 on file', 404, 'not_found')
  const stored = await db.prepare('SELECT bytes FROM pl_vendor_documents WHERE id=? AND vendor_id=?').bind(tax.document.id, previous.id).first<{ bytes: ArrayBuffer }>()
  need(stored, 'W-9 bytes are missing', 503, 'document_missing')
  const bytes = new Uint8Array(stored.bytes); need(bytes.byteLength === tax.document.size && await digest(bytes) === tax.document.checksum, 'W-9 failed its integrity check', 503, 'document_integrity')
  await transaction(db, actor, null, [audit(db, actor, 'vendor.w9.download', `${previous.id}:${tax.document.id}`)])
  return new Response(bytes, { headers: { ...headers, 'content-type': tax.document.mime, 'content-disposition': `attachment; filename="w9-${tax.document.checksum.slice(0, 12)}"`, 'x-plinth-verification': tax.verification } })
 }
 if (method === 'DELETE') {
  requireOwner(actor); need(parts.length === 1, 'Unknown directory route', 404, 'not_found')
  const input = await body(request); need(input.expected_version === previous.version, 'Company changed. Reload before erasing.', 409, 'stale_version')
  await transaction(db, actor, null, [db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_vendors WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(previous.id, previous.version), db.prepare('DELETE FROM pl_vendor_documents WHERE vendor_id=?').bind(previous.id), db.prepare('DELETE FROM pl_vendors WHERE id=?').bind(previous.id), audit(db, actor, 'vendor.erase', previous.id)], clock)
  return json({ erased: true, vendor_id: previous.id })
 }
 need(method === 'POST', 'Method not allowed', 405, 'method_not_allowed')
 const input = await body(request)
 need(input.expected_version === previous.version, 'Company changed. Reload before applying this action.', 409, 'stale_version')
 const vendor = structuredClone(previous), writes: D1PreparedStatement[] = []
 let record: unknown
 if (parts.length === 1) record = Object.assign(vendor, vendorFields(previous, input, actor))
 else if (parts[1] === 'rates' && parts.length === 2) record = addRate(vendor, input, actor)
 else if (parts[1] === 'qualifications' && parts.length === 2) record = qualify(vendor, input, actor)
 else if (parts[1] === 'w9' && parts.length === 2) {
  const tax = taxIdentity(input, actor), id = crypto.randomUUID()
  const received: NonNullable<Vendor['tax']> = { legal_name: tax.legal_name, tin_type: tax.tin_type, tin_last4: tax.tin_last4, document: { id, name: tax.name, mime: tax.mime, checksum: await digest(tax.bytes), size: tax.bytes.length }, received_by: tax.received_by, verification: 'W-9 received, TIN not checked with the IRS' }
  vendor.tax = received
  vendor.history.push({ action: 'w9.received', at: tax.received_by.at, by: tax.received_by })
  if (previous.tax) writes.push(db.prepare('DELETE FROM pl_vendor_documents WHERE id=? AND vendor_id=?').bind(previous.tax.document.id, previous.id))
  record = vendor.tax
  await transaction(db, actor, null, [...save(db, vendor, previous), db.prepare('INSERT INTO pl_vendor_documents(id,vendor_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?)').bind(id, vendor.id, tax.name, tax.mime, received.document.checksum, tax.bytes.length, tax.bytes), ...writes], clock)
  return json({ vendor, record })
 } else throw new DomainError('not_found', 'Unknown directory route', 404)
 await transaction(db, actor, null, save(db, vendor, previous), clock)
 return json({ vendor, record })
}
export async function vendorsResponse(request: Request, env: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (path !== root && !path.startsWith(root + '/')) return null
 try { return await handle(request, env) } catch (error) {
  if (error instanceof DomainError) return json({ error: error.code, message: error.message }, error.status)
  const failure = error as { status?: number; code?: string; message?: string }
  if (failure.status && failure.status < 500) return json({ error: failure.code ?? 'forbidden', message: failure.message ?? 'Request refused' }, failure.status)
  return json({ error: 'server_error', message: 'The request could not be completed' }, 500)
 }
}
