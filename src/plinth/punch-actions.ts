import { active, find, need, object, recordApproval, stamp, text, type Actor, type Input } from './model'
import { day } from './purchase-order-model'
import { decisionFiles } from './decision-files'
import { requirePunchCapture, requirePunchManager, requirePunchOffice, punchScope } from './punch-access'
import { punchAnswers, punchFields, punchState, type PunchForm, type PunchIssue, type PunchJob } from './punch-model'

/** Each repair submission and inspection is append-only. The server chooses identities, numbering and status. */
export async function punchAction(db: D1Database, job: PunchJob, actor: Actor, input: Input, section: string, id?: string, action?: string) {
 active(job); const state = job.punch ??= { forms: [], issues: [] }
 if (section === 'forms') {
  requirePunchManager(actor); need(!action, 'Unknown form action', 404, 'not_found')
  const previous = id ? find(state.forms, id) : undefined
  const row: PunchForm = { id: crypto.randomUUID(), template_id: previous?.template_id ?? crypto.randomUUID(), revision: previous ? Math.max(...state.forms.filter(f => f.template_id === previous.template_id).map(f => f.revision)) + 1 : 1, name: text(input.name, 'Form name', 200), fields: punchFields(input.fields), by: stamp(actor) }
  state.forms.push(row); return { record: row, writes: [] as D1PreparedStatement[] }
 }
 need(section === 'issues', 'Unknown punch action', 404, 'not_found')
 if (!id) {
  requirePunchCapture(actor)
  need(!action, 'Unknown punch action', 404, 'not_found')
  const kind = input.kind ?? 'punch', severity = input.severity ?? 'normal'
  need(kind === 'punch' || kind === 'quality' || kind === 'safety', 'Observation kind must be punch, quality or safety')
  need(severity === 'low' || severity === 'normal' || severity === 'high' || severity === 'critical', 'Choose a supported severity')
  const raw = object(input.annotation); need(typeof raw.x === 'number' && Number.isFinite(raw.x) && raw.x >= 0 && raw.x <= 1 && typeof raw.y === 'number' && Number.isFinite(raw.y) && raw.y >= 0 && raw.y <= 1, 'Annotation coordinates must be within the original photo')
  const rowId = crypto.randomUUID(), files = await decisionFiles(db, job, rowId, [input.photo]); need(files.attachments[0].mime.startsWith('image/'), 'Create an observation from a PNG or JPEG photo')
  const form = input.form_id ? structuredClone(find(state.forms, text(input.form_id, 'Form revision', 100))) : undefined
  let sheet: PunchIssue['sheet']
  if (input.sheet) { const s = object(input.sheet), source = find(job.takeoff ?? [], text(s.sheet_id, 'Sheet', 100)), revision = find(source.revisions, text(s.revision_id, 'Sheet revision', 100)); sheet = { sheet_id: source.id, revision_id: revision.id, name: source.name, revision: revision.revision, page: revision.page } }
  const row: PunchIssue = { id: rowId, number: state.issues.length + 1, title: text(input.title, 'Observation title', 200), description: text(input.description, 'Observation details', 8000), kind, severity, due_on: day(input.due_on, 'Due date'), location: text(input.location, 'Location', 500), ...(sheet ? { sheet } : {}), photo: files.attachments[0], annotation: { x: raw.x, y: raw.y, note: text(raw.note, 'Photo annotation', 1000) }, ...(form ? { form } : {}), answers: punchAnswers(form, input.answers), assignments: [], attempts: [], status: 'open', by: stamp(actor) }
  state.issues.push(row); return { record: row, writes: files.writes }
 }
 const row = find(punchState(job).issues, id)
 if (action === 'submit') {
  need(actor.role === 'member' && row.assignment?.email === actor.email.toLowerCase() && await punchScope(db, job, actor.email, row.assignment.subcontract_id), 'Only the currently assigned qualified trade contact submits a repair', 403, 'forbidden')
  need(row.status === 'open' || row.status === 'rejected', 'This observation is not awaiting a repair', 409, 'immutable')
  const attemptId = crypto.randomUUID(), files = await decisionFiles(db, job, attemptId, input.attachments); need(files.attachments.length > 0, 'Attach original repair evidence')
  row.attempts.push({ id: attemptId, number: row.attempts.length + 1, note: text(input.note, 'Repair details', 4000), attachments: files.attachments, by: stamp(actor) }); row.status = 'submitted'
  return { record: row, writes: files.writes }
 }
 requirePunchManager(actor)
 if (action === 'assign') {
  requirePunchOffice(actor)
  need(row.status !== 'accepted' && row.status !== 'submitted', 'Inspect the current submission before changing assignment', 409, 'immutable')
  const email = text(input.email, 'Assigned contact email', 254).toLowerCase(), scope = await punchScope(db, job, email, text(input.subcontract_id, 'Released subcontract scope', 100))
  need(scope, 'Choose a contact in a currently released, qualified and compliant company scope', 409, 'scope_required')
  const assignment = { subcontract_id: scope.id, email, company: scope.vendor_name, trade: scope.trade, by: stamp(actor) }; row.assignment = assignment; row.assignments.push(structuredClone(assignment))
 } else if (action === 'review') {
  need(row.status === 'submitted', 'Only a submitted repair can be inspected', 409, 'immutable')
  const attempt = row.attempts.at(-1)!; need(input.attempt_id === attempt.id, 'Inspect the exact current repair attempt', 409, 'stale_attempt'); need(!attempt.review, 'This attempt already has an immutable decision', 409, 'immutable')
  need(input.decision === 'accepted' || input.decision === 'rejected', 'Choose accepted or rejected'); need(input.qualified_review === true, 'Confirm that a person qualified for this observation inspected the evidence')
  const files = await decisionFiles(db, job, attempt.id, input.attachments)
  attempt.review = { decision: input.decision, note: text(input.note, 'Inspection finding', 4000), evidence: text(input.evidence, 'Inspection evidence reference', 2000), attachments: files.attachments, by: stamp(actor) }; row.status = input.decision
  recordApproval(job, actor, 'punch.inspect', { id: attempt.id, prepared_by: attempt.by, revision: attempt.number }, { issue_id: row.id, attempt: structuredClone(attempt), qualified_review: true })
  return { record: row, writes: files.writes }
 } else if (action === 'release') {
  requirePunchOffice(actor)
  need(!row.released_by, 'This observation is already released for client closeout', 409, 'immutable'); need(input.confirm === true, 'Explicitly confirm this closeout release, including future repair and inspection history')
  row.released_by = stamp(actor); recordApproval(job, actor, 'punch.release', { id: row.id, prepared_by: row.by }, structuredClone(row))
 } else need(false, 'Unknown punch action', 404, 'not_found')
 return { record: row, writes: [] as D1PreparedStatement[] }
}
