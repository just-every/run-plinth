import { digest, fromBase64, media } from './attachments'
import { requireJobManager, requireOwner } from './auth'
import { decisionDownload } from './decision-files'
import { active, find, need, object, recordApproval, stamp, text, type Actor, type Attachment, type Input, type Job } from './model'
import { day } from './purchase-order-model'
import { dailyWeather } from './daily-weather'
import { reviewedDailyProduction } from './schedule-baseline-model'
import { type DailyLog, type DailyLogView, type DailyRevision } from './daily-logs-model'

/** Private field records never inherit client photo publication. Custom roles must hold current log switches and job scope. */
export function dailyLogAccess(actor: Actor, job: Job, operation: 'view' | 'create' | 'edit' | 'approve' = 'view') {
 need(['owner','admin','project_manager','superintendent','crew'].includes(actor.role) && !actor.agent_door, 'Private daily log access required', 403, 'forbidden')
 need(!actor.team || actor.team.job_ids.includes(job.id), 'Job not found', 404, 'not_found')
 need(!actor.permissions || actor.permissions.matrix.logs.view && actor.permissions.matrix.logs[operation], 'Current daily log permission required', 403, 'forbidden')
}
const codes = (job: Job) => [...new Set(job.budgets?.at(-1)?.codes.map(c => c.cost_code) ?? job.quotes.flatMap(q => q.lines.map(l => l.cost_code ?? 'Unassigned')))]
export function dailyLogView(job: Job, actor: Actor): DailyLogView {
 dailyLogAccess(actor, job)
 return { job_id: job.id, version: job.version, create: !actor.permissions || actor.permissions.matrix.logs.create, write: !actor.permissions || actor.permissions.matrix.logs.edit, review: ['owner','admin','project_manager'].includes(actor.role) && (!actor.permissions || actor.permissions.matrix.logs.approve), configure: actor.role === 'owner', logs: job.daily_logs ?? [], settings: job.daily_log_settings ?? null, production: reviewedDailyProduction(job), tasks: job.schedules.filter(t => t.status !== 'cancelled').map(t => ({ id: t.id, description: t.description })), cost_codes: codes(job) }
}
function revision(job: Job, actor: Actor, input: Input, previous?: DailyRevision): DailyRevision {
 const headcounts = input.headcounts ?? [], quantities = input.quantities ?? []
 need(Array.isArray(headcounts) && headcounts.length <= 30, 'Record up to 30 crew headcounts')
 need(Array.isArray(quantities) && quantities.length <= 50, 'Record up to 50 production quantities')
 return { id: crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1, work: text(input.work, 'Work performed', 8000),
  headcounts: headcounts.map(value => { const h = object(value); need(Number.isSafeInteger(h.count) && Number(h.count) >= 0 && Number(h.count) <= 10000, 'Headcount must be a nonnegative whole number'); return { trade: text(h.trade, 'Crew or trade', 100), count: Number(h.count) } }),
  quantities: quantities.map(value => {
   const q = object(value), task = find(job.schedules, String(q.task_id)), code = text(q.cost_code, 'Cost code', 80), raw = String(q.quantity)
   need(task.status !== 'cancelled', 'Choose a current task', 409, 'daily_task')
   need(codes(job).includes(code), 'Choose an existing job cost code', 409, 'cost_code')
   need(/^\d{1,9}(\.\d{1,6})?$/.test(raw), 'Quantity must be an exact nonnegative decimal with up to six places')
   const quantity = raw.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
   return { id: crypto.randomUUID(), task_id: task.id, task_revision: task.revision ?? 0, task: task.description, cost_code: code, quantity, unit: text(q.unit, 'Quantity unit', 40) }
  }),
  delays: text(input.delays, 'Delays', 4000, true), equipment: text(input.equipment, 'Equipment', 4000, true), deliveries: text(input.deliveries, 'Deliveries', 4000, true), weather_correction: text(input.weather_correction, 'Observed weather correction', 2000, true), reason: previous ? text(input.reason, 'Correction reason', 2000) : '', by: stamp(actor) }
}
async function originals(db: D1Database, job: Job, id: string, value: unknown) {
 const files = value ?? [], attachments: Attachment[] = [], writes: D1PreparedStatement[] = []
 need(Array.isArray(files) && files.length <= 5, 'Attach at most five original photos or MP4 videos')
 let total = 0
 for (const value of files) {
  const file = object(value), bytes = fromBase64(file.base64), name = text(file.name, 'Original name', 240)
  total += bytes.length; need(total <= 8_388_608, 'Daily media must total at most 8 MB')
  need(!/[\x00-\x1f/\\]/.test(name), 'Invalid original name')
  const prefix = new TextDecoder().decode(bytes.slice(4,12)), video = prefix.startsWith('ftyp') && /^(isom|iso2|mp41|mp42|avc1)$/.test(prefix.slice(4))
  need(!video || bytes.length <= 1_048_576, 'Each MP4 video must be at most 1 MB')
  const mime = video ? 'video/mp4' : media(bytes)
  need(video || bytes.length <= 2_097_152, 'Each photo must be at most 2 MB')
  need(file.mime === undefined || file.mime === mime, 'Media type does not match the original bytes')
  const attachment = { id: crypto.randomUUID(), name, mime, size: bytes.length, checksum: await digest(bytes) }
  attachments.push(attachment)
  writes.push(db.prepare('INSERT INTO pl_attachments(id,job_id,entry_id,name,mime,checksum,size,bytes) VALUES(?,?,?,?,?,?,?,?)').bind(attachment.id, job.id, id, name, mime, attachment.checksum, attachment.size, bytes.buffer))
 }
 return { attachments, writes }
}
export async function dailyLogAction(db: D1Database, job: Job, actor: Actor, input: Input, id?: string, action?: string) {
 dailyLogAccess(actor, job, !id ? 'create' : action === 'review' ? 'approve' : 'edit'); active(job)
 let row: DailyLog | undefined, writes: D1PreparedStatement[] = []
 if (id === 'settings') {
  requireOwner(actor)
  need(typeof input.latitude === 'number' && Number.isFinite(input.latitude) && input.latitude >= -90 && input.latitude <= 90 && typeof input.longitude === 'number' && Number.isFinite(input.longitude) && input.longitude >= -180 && input.longitude <= 180, 'Use valid numeric site coordinates')
  job.daily_log_settings = { latitude: input.latitude, longitude: input.longitude, label: text(input.site, 'Named weather site', 500), by: stamp(actor) }
  return { record: job.daily_log_settings, writes }
 }
 if (!id) {
  const date = day(input.date, 'Log date'), entryId = crypto.randomUUID(), files = await originals(db, job, entryId, input.attachments)
  row = { id: entryId, date, site: job.address, weather: await dailyWeather(job, date), attachments: files.attachments, revisions: [revision(job, actor, input)], comments: [], annotations: [] }
  writes = files.writes; (job.daily_logs ??= []).push(row)
 } else {
  row = find(job.daily_logs ?? [], id)
  const current = row.revisions.at(-1)!
  need(input.revision_id === current.id, 'Daily record changed. Reload the current revision.', 409, 'daily_revision')
  if (action === 'correct') row.revisions.push(revision(job, actor, input, current))
  else if (action === 'comment') row.comments.push({ id: crypto.randomUUID(), text: text(input.text, 'Internal comment', 4000), by: stamp(actor) })
  else if (action === 'annotate') {
   const file = find(row.attachments, String(input.file_id))
   need(file.mime.startsWith('image/'), 'Annotate an original photo')
   need(typeof input.x === 'number' && input.x >= 0 && input.x <= 100 && typeof input.y === 'number' && input.y >= 0 && input.y <= 100, 'Use photo coordinates from 0 to 100 percent')
   row.annotations.push({ id: crypto.randomUUID(), revision_id: current.id, file_id: file.id, checksum: file.checksum, x: input.x, y: input.y, text: text(input.text, 'Photo annotation', 2000), by: stamp(actor) })
  } else if (action === 'review') {
   requireJobManager(actor)
   need(!actor.permissions || actor.permissions.matrix.logs.approve, 'Current log review authority required', 403, 'forbidden')
   need(input.confirm === true, 'Explicitly review the exact daily record revision')
   need(!current.review, 'This revision is already reviewed', 409, 'immutable')
   need(current.quantities.every(q => job.schedules.some(t => t.id === q.task_id && t.status !== 'cancelled' && (t.revision ?? 0) === q.task_revision) && codes(job).includes(q.cost_code)), 'Linked tasks or cost codes changed; correct the record before review', 409, 'daily_source')
   current.review = { by: stamp(actor), reason: text(input.reason, 'Review reason', 2000) }
   recordApproval(job, actor, 'daily-log.review', { id: row.id, prepared_by: current.by, revision: current.revision }, { revision: current, date: row.date, weather: row.weather })
  } else need(false, 'Unknown daily log action', 404, 'not_found')
 }
 return { record: row, writes }
}
export async function dailyLogFile(db: D1Database, job: Job, actor: Actor, id: string, fileId: string) {
 dailyLogAccess(actor, job)
 return decisionDownload(db, job, find(job.daily_logs ?? [], id).attachments, fileId)
}
