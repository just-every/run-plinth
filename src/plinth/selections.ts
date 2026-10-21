import { productSource, productStatus } from './product-source'
import { object } from './model'
import { requireJobManager } from './auth'
import { active, find, need, recordApproval, stamp, text, usdOnly, type Actor, type Input, type Job } from './model'
import { clientSelections, decisionHeld, selected, selectionRevision, selectionTracker } from './selection-model'

export function revisionWithProducts(job:Job,input:Input,actor:Actor,revision:number){const result=selectionRevision(input,actor,revision);for(const [i,option] of result.options.entries()){const raw=object((input.options as unknown[])[i]);if(raw.product_id!==undefined)option.product_source=productSource(job,raw.product_id,raw.product_revision_id);else if(raw.product_source!==undefined){const source=object(raw.product_source);option.product_source=productSource(job,source.product_id,source.id)}}return result}

/** CLIENT-002: only current assigned clients decide; office preparation never fabricates a client decision. */
export function selectionAction(job: Job, actor: Actor, input: Input, id?: string, action?: string) {
 active(job); usdOnly(job)
 if (!id) {
  requireJobManager(actor, true)
  const row = { id: crypto.randomUUID(), revisions: [revisionWithProducts(job, input, actor, 1)], comments: [] }
  ;(job.selections ??= []).push(row); return row
 }
 const row = find(job.selections ?? [], id), current = row.revisions.at(-1)!
 if (action === 'revise') { requireJobManager(actor, true); row.revisions.push(revisionWithProducts(job, input, actor, current.revision + 1)); return row }
 const revision = find(row.revisions, text(input.revision_id, 'revision_id', 100))
 if (action === 'comment') {
  need(actor.role !== 'agent', 'A person must post a comment', 403, 'human_required')
  if (actor.role === 'member') need(revision.status !== 'draft', 'Selection not found', 404, 'not_found')
  row.comments.push({ id: crypto.randomUUID(), revision_id: revision.id, text: text(input.text, 'comment', 4000), by: stamp(actor) }); return row
 }
 need(revision === current, 'Review the latest selection revision', 409, 'revision')
 if (action === 'present') {
  requireJobManager(actor); need(revision.status === 'draft', 'This revision was already presented', 409, 'immutable')
  if(revision.substitution){need(input.confirm_substitution===true, 'The builder must approve this exact substitution comparison',409,'substitution_review');revision.substitution.builder_approved_by=stamp(actor)}
  ;(row.decisions??=[]).push({id:crypto.randomUUID(),revision_id:revision.id,kind:'request',reason:revision.substitution?'Review the exact proposed substitution':'Review the presented selection',by:stamp(actor),attachments:[]})
  revision.status = 'presented'; revision.presented_by = stamp(actor); recordApproval(job, actor, 'selection.present', revision, revision); return row
 }
 need(action === 'sign', 'Unknown selection action', 404, 'not_found')
 need(actor.role === 'member' && (actor.email.toLowerCase() === job.client_email || actor.client_job_id === job.id), 'The assigned client must sign this choice', 403, 'client_required')
 need(revision.status === 'presented', 'This revision is not awaiting a new client decision', 409, 'immutable')
 need(!decisionHeld(row,revision.id),'A disputed or withdrawn decision needs a replacement revision',409,'selection_held')
 need(!revision.substitution||revision.substitution.builder_approved_by,'The builder must approve this substitution first',409,'substitution_review')
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
 return (client ? clientSelections(job) : job.selections ?? []).map(s => ({ ...s, revisions: s.revisions.map(r => ({ ...r, ...(!client?{options:r.options.map(o=>({...o,...(o.product_source?{product_notices:productStatus(job,o.product_source)}:{})}))}:{}), procurement: selectionTracker(job, s.id, r.id) })) }))
}
