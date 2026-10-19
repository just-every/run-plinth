import { requireJobManager } from './auth'
import { active, find, need, recordApproval, stamp, text, usdOnly, type Actor, type Input, type Job } from './model'
import { clientSelections, selected, selectionRevision, selectionTracker } from './selection-model'

/** CLIENT-002: only current assigned clients decide; office preparation never fabricates a client decision. */
export function selectionAction(job: Job, actor: Actor, input: Input, id?: string, action?: string) {
 active(job); usdOnly(job)
 if (!id) {
  requireJobManager(actor, true)
  const row = { id: crypto.randomUUID(), revisions: [selectionRevision(input, actor, 1)], comments: [] }
  ;(job.selections ??= []).push(row); return row
 }
 const row = find(job.selections ?? [], id), current = row.revisions.at(-1)!
 if (action === 'revise') { requireJobManager(actor, true); row.revisions.push(selectionRevision(input, actor, current.revision + 1)); return row }
 const revision = find(row.revisions, text(input.revision_id, 'revision_id', 100))
 if (action === 'comment') {
  need(actor.role !== 'agent', 'A person must post a comment', 403, 'human_required')
  if (actor.role === 'member') need(revision.status !== 'draft', 'Selection not found', 404, 'not_found')
  row.comments.push({ id: crypto.randomUUID(), revision_id: revision.id, text: text(input.text, 'comment', 4000), by: stamp(actor) }); return row
 }
 need(revision === current, 'Review the latest selection revision', 409, 'revision')
 if (action === 'present') {
  requireJobManager(actor); need(revision.status === 'draft', 'This revision was already presented', 409, 'immutable')
  revision.status = 'presented'; revision.presented_by = stamp(actor); recordApproval(job, actor, 'selection.present', revision, revision); return row
 }
 need(action === 'sign', 'Unknown selection action', 404, 'not_found')
 need(actor.role === 'member' && (actor.email.toLowerCase() === job.client_email || actor.client_job_id === job.id), 'The assigned client must sign this choice', 403, 'client_required')
 need(revision.status === 'presented', 'This revision is not awaiting a new client decision', 409, 'immutable')
 const option = find(revision.options, text(input.option_id, 'option_id', 100))
 const statement = text(input.statement, 'signature statement', 2000)
 need(input.confirm === true, 'Confirm that you approve this exact option')
 revision.signature = { option: structuredClone(option), by: stamp(actor), statement }; revision.status = 'signed'
 const { cost_code, ...snapshot } = revision
 recordApproval(job, actor, 'selection.sign', revision, snapshot); return row
}
export function selectionOrderInput(job: Job, selectionId: string, revisionId: string, input: Input): Input {
 const { revision, option } = selected(job, selectionId, revisionId)
 return { supplier: option.supplier, description: `${revision.room}: ${revision.category} — ${option.name}. ${option.specifications}`, source: { kind: 'selection', selection_id: selectionId, revision_id: revisionId }, lines: [{ description: option.name, cost_code: revision.cost_code, quantity: '1', unit: 'selection', unit_cents: option.price_cents }], ...(input.vendor_email ? { vendor_email: input.vendor_email } : {}), ...(input.promised_on ? { promised_on: input.promised_on } : {}) }
}
export function selectionProjection(job: Job, client: boolean) {
 return (client ? clientSelections(job) : job.selections ?? []).map(s => ({ ...s, revisions: s.revisions.map(r => ({ ...r, procurement: selectionTracker(job, s.id, r.id) })) }))
}
