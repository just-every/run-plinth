import { requireJobManager, visible } from './auth'
import { cents, find, need, stamp, sum, text, usdOnly, type Actor, type Input, type Job } from './model'
import { wallClock } from './time-zone'
import type { WarrantyCase, WarrantyComponent, WarrantyPromise, WarrantyRecipient, WarrantyReview } from './warranty-model'
import { warrantyDay } from './warranty-schedule'
import { officeAuthority, promiseGuards, recipientGuards, warrantyGeneration, warrantyState } from './warranty-store'

function email(value: unknown, name: string): string {
 const result = text(value, name, 254).toLowerCase()
 need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result), `${name} must be an email address`)
 return result
}
async function recipient(db: D1Database, job: Job, input: Input): Promise<WarrantyRecipient> {
 need(input.recipient_kind === 'client' || input.recipient_kind === 'office', 'Choose a client or office recipient')
 const address = email(input.recipient_email, 'recipient_email')
 const office = input.recipient_kind === 'office' ? await officeAuthority(db, job, address) : null
 need(input.recipient_kind !== 'office' || office, 'Choose an active office person with current access to this job', 409, 'recipient_access')
 const result: WarrantyRecipient = { kind: input.recipient_kind, email: address, ...(office ? { operator_id: office.id } : {}) }
 need(await recipientGuards(db, job, result), 'Choose an existing assigned client contact or active office person', 409, 'recipient_access')
 return result
}
function component(job: Job, actor: Actor, input: Input): WarrantyComponent {
 const state = warrantyState(job)
 need(state.components.length < 200, 'The component limit has been reached')
 const starts_on = warrantyDay(input.starts_on, 'starts_on'), ends_on = warrantyDay(input.ends_on, 'ends_on')
 need(starts_on <= ends_on, 'Warranty end must be on or after its start')
 const row: WarrantyComponent = {
  id: crypto.randomUUID(), name: text(input.name, 'component name', 200), starts_on, ends_on,
  signed_terms_reference: text(input.signed_terms_reference, 'signed_terms_reference', 1000),
  terms: text(input.terms, 'signed warranty terms', 8000), recorded_by: stamp(actor),
 }
 state.components.push(row)
 return row
}
async function promise(db: D1Database, job: Job, actor: Actor, input: Input): Promise<WarrantyPromise> {
 const state = warrantyState(job)
 need(state.promises.length < 200, 'The maintenance promise limit has been reached')
 const linked = find(state.components, text(input.component_id, 'component_id', 100))
 const anchor_on = warrantyDay(input.anchor_on, 'anchor_on'), ends_on = input.ends_on ? warrantyDay(input.ends_on, 'ends_on') : undefined
 need(!ends_on || ends_on >= anchor_on, 'The last maintenance date must be on or after its anchor')
 need(input.interval_unit === 'month' || input.interval_unit === 'year', 'interval_unit must be month or year')
 need(typeof input.interval_count === 'number' && Number.isSafeInteger(input.interval_count) && input.interval_count >= 1 && input.interval_count <= 120, 'interval_count must be an integer from 1 to 120')
 const authority = await officeAuthority(db, job, actor.id, true)
 need(authority, 'Only a currently assigned native office person can configure reminders', 403, 'forbidden')
 const agreement_reference = text(input.agreement_reference, 'explicit reminder agreement reference', 1000), by = stamp(actor)
 const case_id = input.case_id ? text(input.case_id, 'case_id', 100) : undefined
 if (case_id) { const item = find(state.cases, case_id); need(item.component_id === linked.id && item.status === 'open', 'Choose an open case for this component') }
 const row: WarrantyPromise = {
  id: crypto.randomUUID(), revision: 1, component_id: linked.id, title: text(input.title, 'maintenance promise', 500), anchor_on,
  interval_unit: input.interval_unit, interval_count: input.interval_count, ...(ends_on ? { ends_on } : {}), ...(case_id ? { case_id } : {}),
  recipient: await recipient(db, job, input), agreement_reference, status: 'active', created_by: by,
  authority, auth_generation: await warrantyGeneration(db), activated_on: anchor_on,
  history: [{ action: 'created', reason: 'Explicit reminder agreement recorded', agreement_reference, by }],
 }
 state.promises.push(row)
 return row
}
async function defect(db: D1Database, job: Job, actor: Actor, input: Input): Promise<WarrantyCase> {
 const state = warrantyState(job)
 need(state.cases.length < 500, 'The warranty case limit has been reached')
 const linked = find(state.components, text(input.component_id, 'component_id', 100))
 const reviewer_email = email(input.reviewer_email, 'reviewer_email'), reviewer = await officeAuthority(db, job, reviewer_email)
 need(reviewer, 'Name an active office reviewer with current access to this job', 409, 'reviewer_access')
 const defect_key = text(input.defect_key, 'defect_key', 100).toLowerCase(), by = stamp(actor)
 const earlier_case_ids = state.cases.filter(c => c.component_id === linked.id && c.defect_key === defect_key).map(c => c.id)
 const row: WarrantyCase = {
  id: crypto.randomUUID(), component_id: linked.id, defect_key, description: text(input.description, 'defect description', 4000),
  reported_on: warrantyDay(input.reported_on, 'reported_on'), reviewer_email, reviewer_id: reviewer.id,
  repeated: earlier_case_ids.length > 0, earlier_case_ids,
  ...(earlier_case_ids.length ? { escalation: { reviewer_email, reason: 'Repeat defect on the same component requires the named office reviewer', recorded_by: by } } : {}),
  status: 'open', recorded_by: by, costs: [], reviews: [],
 }
 state.cases.push(row)
 return row
}
async function changePromise(db: D1Database, job: Job, actor: Actor, row: WarrantyPromise, input: Input, action?: string) {
 need(action === 'pause' || action === 'resume' || action === 'revoke', 'The reminder agreement supports pause, resume or revoke', 404, 'not_found')
 need(row.status !== 'revoked', 'A revoked agreement is immutable; record a new explicit agreement', 409, 'immutable')
 const reason = text(input.reason, 'reason', 2000), by = stamp(actor)
 if (action === 'resume') {
  need(row.status === 'paused' || (await promiseGuards(db, job, row)).reason, 'Pause this agreement before reconfirming it', 409, 'promise_state')
  need(await recipientGuards(db, job, row.recipient), 'The recipient no longer has access to this job', 409, 'recipient_access')
  if (row.case_id) need(find(warrantyState(job).cases, row.case_id).status === 'open', 'The linked case is closed', 409, 'case_closed')
  const authority = await officeAuthority(db, job, actor.id, true)
  need(authority, 'Only an active, currently assigned office person can resume reminders', 403, 'forbidden')
  row.agreement_reference = text(input.agreement_reference, 'reconfirmed reminder agreement reference', 1000)
  row.authority = authority; row.auth_generation = await warrantyGeneration(db)
  row.activated_on = wallClock(Date.now(), job.time_zone ?? 'UTC').date
  row.status = 'active'
  row.history.push({ action: 'resumed', reason, agreement_reference: row.agreement_reference, by })
 } else {
  need(action !== 'pause' || row.status === 'active', 'The agreement is already paused', 409, 'promise_state')
  row.status = action === 'pause' ? 'paused' : 'revoked'
  row.history.push({ action: action === 'pause' ? 'paused' : 'revoked', reason, by })
 }
 row.revision++
 return row
}
async function changeCase(db: D1Database, job: Job, actor: Actor, row: WarrantyCase, input: Input, action?: string) {
 need(row.status === 'open', 'The closed case is immutable', 409, 'immutable')
 if (action === 'cost') {
  usdOnly(job)
  need(row.costs.length < 500, 'The callback cost history limit has been reached')
  const amount_cents = cents(input.amount_cents, 'amount_cents', true)
  need(amount_cents !== 0, 'A callback cost must have a nonzero amount')
  need(sum([...row.costs.map(c => c.amount_cents), amount_cents]) >= 0, 'A cost correction cannot make the case balance negative')
  const cost = { id: crypto.randomUUID(), currency: 'USD' as const, amount_cents, cost_code: text(input.cost_code, 'cost_code', 100), reference: text(input.reference, 'cost source or correction reference', 1000), description: text(input.description, 'cost description', 2000), recorded_by: stamp(actor) }
  row.costs.push(cost)
  return cost
 }
 if (action === 'review') {
  const reviewer = await officeAuthority(db, job, row.reviewer_id, true)
  need(reviewer && reviewer.id === actor.id && reviewer.email === row.reviewer_email, 'Only the designated active office reviewer can record coverage', 403, 'designated_reviewer')
  need(input.decision === 'covered' || input.decision === 'not_covered' || input.decision === 'needs_evidence', 'Choose covered, not_covered or needs_evidence')
  need(row.reviews.length < 100, 'The coverage review history limit has been reached')
  const review: WarrantyReview = { id: crypto.randomUUID(), decision: input.decision, reason: text(input.reason, 'coverage reason', 4000), source_reference: text(input.source_reference, 'coverage source reference', 1000), reviewed_by: stamp(actor) }
  row.reviews.push(review)
  return review
 }
 if (action === 'close') {
  need(!row.service,'Service requests close only after builder acceptance and explicit client acknowledgment',409,'client_acknowledgment')
  closeReviewedWarrantyCase(job,actor,row,input)
  return row
 }
 need(false, 'Unknown warranty case action', 404, 'not_found')
}
/** Caller clones the job, observes pl_clock before reads, then saveJob commits this mutation with that clock. */
export async function warrantyAction(db: D1Database, job: Job, actor: Actor, input: Input, id?: string, action?: string) {
 requireJobManager(actor); visible(actor, job)
 const state = warrantyState(job)
 if (!id) {
  need(!action, 'Unknown warranty action', 404, 'not_found')
  if (input.kind === 'component') return component(job, actor, input)
  if (input.kind === 'promise') return promise(db, job, actor, input)
  if (input.kind === 'case') return defect(db, job, actor, input)
  need(false, 'kind must be component, promise or case')
 }
 need(!state.components.some(c => c.id === id), 'Signed component warranty terms are immutable', 409, 'immutable')
 const agreement = state.promises.find(p => p.id === id)
 if (agreement) { need(input.kind === undefined || input.kind === 'promise', 'Record kind does not match'); return changePromise(db, job, actor, agreement, input, action) }
 const item = find(state.cases, id)
 need(input.kind === undefined || input.kind === 'case', 'Record kind does not match')
 return changeCase(db, job, actor, item, input, action)
}

/** The service door calls this only after exact builder/client closure gates. */
export function closeReviewedWarrantyCase(job:Job,actor:Actor,row:WarrantyCase,input:Input){
  const review = row.reviews.at(-1)
  need(review && review.decision !== 'needs_evidence', 'A reasoned coverage decision is required before closing the case', 409, 'coverage_required')
  finalizeWarrantyCase(job,actor,row,{ reason: text(input.reason, 'closure reason', 4000), evidence_reference: text(input.evidence_reference, 'closure evidence reference', 1000), review_id: review.id })
}
/** Shared finalization after the caller has recorded the required human evidence. */
export function finalizeWarrantyCase(job:Job,actor:Actor,row:WarrantyCase,closure:Omit<NonNullable<WarrantyCase['closure']>,'closed_by'>){
  need(row.status === 'open', 'The closed case is immutable', 409, 'immutable')
  const by = stamp(actor)
  row.closure = {...closure,closed_by:by}
  row.status = 'closed'
  for (const agreement of warrantyState(job).promises.filter(p => p.case_id === row.id && p.status === 'active')) {
   agreement.status = 'paused'
   agreement.revision++
   agreement.history.push({ action: 'case_closed', reason: 'The linked case was closed with evidence', by })
  }
}
