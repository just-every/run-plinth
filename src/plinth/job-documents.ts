import { requireOwner } from './auth'
import { digest, fromBase64 } from './attachments'
import { decisionDownload } from './decision-files'
import { jobRequest } from './job-request'
import { find, need, object, stamp, text, type Attachment, type Input, type Job, type Stamp } from './model'
import { jobOf, readClock, saveJob, transaction } from './store'
import type { Actor } from './model'

export const documentAreas = ['Documents', 'Photos', 'Videos'] as const
type Area = typeof documentAreas[number]
export interface DocumentFolder { id: string; name: string; area: Area; parent_id?: string; by: Stamp }
export interface DocumentVersion { id: string; revision: number; file: Attachment; by: Stamp }
export interface PrivateDocument { id: string; folder_id: string; name: string; tags: string[]; versions: DocumentVersion[] }
export interface DocumentLink { id: string; document_id: string; version_id: string; kind: string; record_id: string; by: Stamp }
export interface DocumentLibrary { folders: DocumentFolder[]; files: PrivateDocument[]; links: DocumentLink[] }
type DocumentJob = Job & { private_documents?: DocumentLibrary }
const empty = (): DocumentLibrary => ({ folders: [], files: [], links: [] })
const json = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
const recordCollections = ['quotes', 'schedules', 'diary', 'variations', 'orders', 'claims', 'invoices', 'selections', 'rfis', 'submittals', 'todos', 'meetings', 'subcontracts', 'punch', 'warranties', 'handover'] as const

/** Resolve only real records in this job. A link grants no access and copies no bytes into the target. */
export function documentTargets(job: Job) {
 return recordCollections.flatMap(kind => {
  const value = kind === 'handover' ? job.handover?.packages.filter(p => !p.completion) : kind === 'punch' ? job.punch?.issues : kind === 'warranties' ? job.warranties?.components : job[kind]
  return (value ?? []).map((record: any) => ({ kind, id: String(record.id), label: String(record.title ?? record.description ?? record.name ?? record.number ?? record.id) }))
 })
}
function tags(value: unknown) { need(Array.isArray(value) && value.length <= 20, 'Use up to twenty tags'); return [...new Set(value.map(v => text(v, 'Tag', 80)))] }
async function original(input: Input, area: Area): Promise<{ file: Attachment; bytes: Uint8Array }> {
 const bytes = fromBase64(input.base64), name = text(input.name, 'File name', 240)
 need(!/[\x00-\x1f/\\]/.test(name), 'Invalid file name')
 const prefix = new TextDecoder().decode(bytes.slice(0, 12))
 const mime = prefix.startsWith('%PDF-') ? 'application/pdf' : bytes.slice(0,8).join(',') === '137,80,78,71,13,10,26,10' ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : prefix.slice(4,8) === 'ftyp' ? 'video/mp4' : bytes.slice(0,4).join(',') === '26,69,223,163' ? 'video/webm' : 'application/octet-stream'
 need(area !== 'Photos' || mime.startsWith('image/'), 'Photos need a PNG or JPEG original')
 need(area !== 'Videos' || mime.startsWith('video/'), 'Videos need an MP4 or WebM original')
 return { file: { id: crypto.randomUUID(), name, mime, size: bytes.length, checksum: await digest(bytes) }, bytes }
}
async function change(db: D1Database, state: DocumentLibrary, actor: Actor, input: Input, parts: string[], job?: Job) {
 const by = stamp(actor), writes: D1PreparedStatement[] = []
 let record: unknown
 if (parts[0] === 'folders' && parts.length === 1) {
  need(state.folders.length < 200, 'This library supports up to two hundred folders')
  need(documentAreas.includes(input.area as Area), 'Choose Documents, Photos or Videos')
  const parent = input.parent_id ? find(state.folders, String(input.parent_id)) : undefined
  need(!parent || parent.area === input.area, 'A nested folder stays in its parent area')
  const name = text(input.name, 'Folder name', 160)
  need(!state.folders.some(f => f.area === input.area && f.parent_id === parent?.id && f.name.toLowerCase() === name.toLowerCase()), 'That folder already exists', 409, 'duplicate_folder')
  record = { id: crypto.randomUUID(), name, area: input.area as Area, ...(parent ? { parent_id: parent.id } : {}), by }
  state.folders.push(record as DocumentFolder)
 } else if (parts[0] === 'files' && (parts.length === 1 || parts.length === 3 && parts[2] === 'versions')) {
  let document = parts[1] ? find(state.files, parts[1]) : undefined
  const folder = find(state.folders, document?.folder_id ?? text(input.folder_id, 'Folder', 100))
  need(!document || input.folder_id === undefined || input.folder_id === document.folder_id, 'A new version stays with its original file')
  if (!document) {
   need(state.files.length < 500, 'This library supports up to five hundred files')
   document = { id: crypto.randomUUID(), folder_id: folder.id, name: text(input.name, 'Document name', 240), tags: tags(input.tags ?? []), versions: [] }
   state.files.push(document)
  }
  need(document.versions.length < 100, 'A file supports up to one hundred immutable versions')
  const stored = await original(object(input.file), folder.area)
  const revision: DocumentVersion = { id: crypto.randomUUID(), revision: document.versions.length + 1, file: stored.file, by }
  document.versions.push(revision); record = document
  writes.push(job ? db.prepare('INSERT INTO pl_attachments(id,job_id,entry_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(stored.file.id,job.id,revision.id,stored.file.name,stored.file.mime,stored.file.checksum,stored.file.size,stored.bytes.buffer) : db.prepare('INSERT INTO pl_company_document_files(id,bytes) VALUES(?,?)').bind(stored.file.id,stored.bytes.buffer))
 } else if (parts[0] === 'links' && parts.length === 1 && job) {
  const document = find(state.files, text(input.document_id, 'Document', 100)), revision = find(document.versions, text(input.version_id, 'Exact version', 100))
  const target = documentTargets(job).find(t => t.kind === input.kind && t.id === input.record_id)
  need(target, 'Choose an existing record or draft handover package in this job', 404, 'not_found')
  const existing = state.links.find(l => l.document_id === document.id && l.version_id === revision.id && l.kind === target.kind && l.record_id === target.id)
  record = existing ?? { id: crypto.randomUUID(), document_id: document.id, version_id: revision.id, kind: target.kind, record_id: target.id, by }
  if (!existing) { need(state.links.length < 2000, 'This library supports up to two thousand links'); state.links.push(record as DocumentLink) }
 } else need(false, 'Unknown document action', 404, 'not_found')
 return { record, writes }
}

/** Owner-only interim floor. Every door reauthenticates upstream; no external or custom-role grant is inferred. */
export async function documentsResponse(request: Request, db: D1Database, actor: Actor, parts: string[]) {
 const jobId = parts[0] === 'jobs' && parts[2] === 'documents' ? parts[1] : undefined
 if (!jobId && parts[0] !== 'documents') return null
 requireOwner(actor)
 const tail = parts.slice(jobId ? 3 : 1), clock = await readClock(db)
 const job: DocumentJob | undefined = jobId ? await jobOf(db, actor, jobId) : undefined
 const company = job ? null : await db.prepare('SELECT version,data FROM pl_company_documents WHERE id=1').first<{version:number;data:string}>()
 const state: DocumentLibrary = structuredClone(job ? job.private_documents ?? empty() : company ? JSON.parse(company.data) : empty()), version = job?.version ?? company?.version ?? 0
 if (request.method === 'GET') {
  if (tail[0] === 'files' && tail.length === 3) {
   const document = find(state.files, tail[1]), revision = find(document.versions, tail[2]), file = revision.file
   if (job) return decisionDownload(db, job, [file], file.id)
   const stored = await db.prepare('SELECT bytes FROM pl_company_document_files WHERE id=?').bind(file.id).first<{bytes:ArrayBuffer}>()
   need(stored, 'Original file missing', 503, 'document_missing')
   const bytes = new Uint8Array(stored.bytes)
   need(bytes.length === file.size && await digest(bytes) === file.checksum, 'Original integrity check failed', 503, 'document_integrity')
   return new Response(bytes, {headers:{'content-type':file.mime,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff','cache-control':'private, no-store'}})
  }
  need(tail.length === 0, 'Unknown document route', 404, 'not_found')
  const params = new URL(request.url).searchParams, q = (params.get('q') ?? '').trim().toLowerCase(), tag = (params.get('tag') ?? '').trim().toLowerCase()
  return json({ version, library: { ...state, files: state.files.filter(f => (!q || f.name.toLowerCase().includes(q) || f.versions.some(v => v.file.name.toLowerCase().includes(q))) && (!tag || f.tags.some(t => t.toLowerCase() === tag))) }, targets: job ? documentTargets(job) : [] })
 }
 need(request.method === 'POST', 'Method not allowed', 405, 'method_not_allowed')
 const input = await jobRequest(request)
 need(input.expected_version === version, 'Document library changed. Reload before saving.', 409, 'stale_version')
 const result = await change(db, state, actor, input, tail, job)
 if (job) {
  const next = structuredClone(job); next.private_documents = state
  await saveJob(db, actor, job, next, result.writes, clock)
 } else {
  const data = JSON.stringify(state); need(data.length <= 4_000_000, 'Company document history is too large')
  await transaction(db, actor, null, [...result.writes, db.prepare('INSERT INTO pl_company_documents(id,version,data) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data').bind(version + 1, data)], clock, {action:'documents.' + tail[0],subject_kind:'company_documents',subject_id:'1'})
 }
 return json({ record: result.record, version: version + 1 })
}
