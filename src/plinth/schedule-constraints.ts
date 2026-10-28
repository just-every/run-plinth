import { rfiWorkHolds } from './rfis'
import { requireJobManager } from './auth'
import { digest, fromBase64 } from './attachments'
import { active, find, need, object, recordApproval, stamp, text, type Actor, type Attachment, type Input, type Job, type Schedule } from './model'
import type { ConstraintEvent, ScheduleBlocker, ScheduleConstraint } from './schedule-constraint-model'
import { bidProcurementBlockers } from './bid-follow-up'

/** Holds apply to their tasks and every successor, across every publication door. */
export function scheduleBlockers(job: Job, tasks: Schedule[]): ScheduleBlocker[] {
 const result: ScheduleBlocker[] = bidProcurementBlockers(job,tasks)
 for (const constraint of job.schedule_constraints ?? []) {
  const status = constraint.events.at(-1)!.action
  if (status === 'cleared') continue
  const affected = new Set(constraint.task_ids)
  let changed = true
  while (changed) {
   changed = false
   for (const task of tasks) if (!affected.has(task.id) && task.predecessors?.some(p => affected.has(p.id))) { affected.add(task.id); changed = true }
  }
  for (const task of tasks.filter(t => t.status !== 'cancelled' && (!constraint.task_ids.length || affected.has(t.id)))) result.push({ constraint_id: constraint.id, title: constraint.title, task_id: task.id, task: task.description, status, accountable: constraint.accountable })
 }
 for(const hold of rfiWorkHolds(job)){const affected=new Set(hold.task_ids);let changed=true;while(changed){changed=false;for(const task of tasks)if(!affected.has(task.id)&&task.predecessors?.some(p=>affected.has(p.id))){affected.add(task.id);changed=true}}for(const task of tasks.filter(t=>t.status!=='cancelled'&&affected.has(t.id)))result.push({constraint_id:hold.rfi.id,title:`RFI ${hold.rfi.number}: client change decision pending`,task_id:task.id,task:task.description,status:'client_change_pending',accountable:'Assigned client'})}
 return result
}
export function requireScheduleClearance(job: Job, tasks: Schedule[]) {
 const blockers = scheduleBlockers(job, tasks)
 need(!blockers.length, 'Clear inspection, permit, site or procurement holds before publishing affected work', 409, 'schedule_hold', { blockers })
}
async function documents(db: D1Database, job: Job, input: Input) {
 const rows = input.documents ?? []; need(Array.isArray(rows) && rows.length <= 3, 'Attach up to three original documents')
 const metadata: Attachment[] = [], writes: D1PreparedStatement[] = []
 for (const value of rows) {
  const raw = object(value), bytes = fromBase64(raw.base64), name = text(raw.name, 'Document name', 240)
  need(!/[\x00-\x1f/\\]/.test(name), 'Invalid document name')
  const prefix = new TextDecoder().decode(bytes.slice(0, 5))
  const mime = prefix === '%PDF-' ? 'application/pdf' : bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10' ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : ''
  need(mime, 'Documents must be PDF, PNG or JPEG originals')
  if (raw.mime) need(raw.mime === mime, 'Document type does not match its bytes')
  const file = { id: crypto.randomUUID(), name, mime, size: bytes.length, checksum: await digest(bytes) }
  metadata.push(file); writes.push(db.prepare('INSERT INTO pl_schedule_constraint_files(id,job_id,bytes) VALUES(?,?,?)').bind(file.id, job.id, bytes.buffer))
 }
 return { metadata, writes }
}
export async function constraintAction(db: D1Database, job: Job, actor: Actor, input: Input, id?: string) {
 requireJobManager(actor); active(job)
 const constraints = job.schedule_constraints ??= []
 need(constraints.length < 200 || id, 'This job has reached its constraint limit')
 let row: ScheduleConstraint
 if (id) row = find(constraints, id)
 else {
  need(['permit', 'inspection', 'weather', 'site'].includes(String(input.kind)), 'Choose permit, inspection, weather or site')
  const ids = input.task_ids ?? []
  need(Array.isArray(ids) && ids.length <= 200 && ids.every(id => typeof id === 'string' && job.schedules.some(t => t.id === id)), 'Choose existing job tasks, or all work')
  row = { id: crypto.randomUUID(), kind: input.kind as ScheduleConstraint['kind'], title: text(input.title, 'Constraint title', 300), jurisdiction: text(input.jurisdiction, 'Jurisdiction', 300), accountable: text(input.accountable, 'Accountable person', 200), task_ids: [...new Set(ids as string[])], events: [] }
 }
 const action = input.action ?? (row.kind === 'inspection' || row.kind === 'permit' ? 'requested' : 'held')
 need(['requested', 'failed', 'held', 'cleared'].includes(String(action)), 'Choose request, failure, hold or clearance')
 const files = await documents(db, job, input)
 need(action !== 'cleared' || files.metadata.length, 'Attach original inspection, permit or site clearance evidence before clearance')
 need(id || action !== 'cleared', 'Record the requirement before clearing it')
 const event: ConstraintEvent = { id: crypto.randomUUID(), action: action as ConstraintEvent['action'], reason: text(input.reason, 'Request, result or clearance reason', 4000), recorded_by: stamp(actor), documents: files.metadata }
 row.events.push(event); if (!id) constraints.push(row)
 recordApproval(job, actor, 'schedule.constraint', { id: row.id, prepared_by: event.recorded_by, revision: row.events.length }, { kind: row.kind, title: row.title, jurisdiction: row.jurisdiction, accountable: row.accountable, task_ids: row.task_ids, event })
 return { record: row, writes: files.writes }
}
export async function constraintFile(db: D1Database, job: Job, actor: Actor, id: string) {
 requireJobManager(actor, true)
 const metadata = job.schedule_constraints?.flatMap(c => c.events.flatMap(e => e.documents)).find(f => f.id === id)
 need(metadata, 'Document not found', 404, 'not_found')
 const stored = await db.prepare('SELECT bytes FROM pl_schedule_constraint_files WHERE id=? AND job_id=?').bind(id, job.id).first<{ bytes: ArrayBuffer }>()
 need(stored, 'Original document is unavailable', 503, 'document_missing')
 const bytes = new Uint8Array(stored.bytes)
 need(bytes.length === metadata.size && await digest(bytes) === metadata.checksum, 'Document integrity check failed', 503, 'document_integrity')
 return new Response(bytes, { headers: { 'content-type': metadata.mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`, 'content-security-policy': "sandbox; default-src 'none'", 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } })
}
