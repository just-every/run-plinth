import { requireJobManager } from './auth'
import { decisionFiles } from './decision-files'
import { digest } from './attachments'
import { active, find, need, object, recordApproval, stamp, text, type Actor, type Input } from './model'
import { handoverKinds, handoverState, type HandoverDocument, type HandoverJob, type HandoverPackage } from './handover-model'

async function fingerprint(value: unknown) { return digest(new TextEncoder().encode(JSON.stringify(value))) }
export async function handoverAction(db: D1Database, job: HandoverJob, actor: Actor, input: Input, section?: string, id?: string, action?: string) {
 active(job); need(actor.role !== 'agent', 'Handover decisions require a signed-in person', 403, 'human_required')
 const state = job.handover ??= handoverState(job), by = stamp(actor), writes: D1PreparedStatement[] = []
 if (section === 'documents') {
  requireJobManager(actor)
  let document: HandoverDocument
  if (id) document = find(state.documents, id)
  else {
   need(state.documents.length < 200, 'A job supports up to 200 handover documents')
   need(handoverKinds.includes(input.kind as never), 'Choose a handover document category')
   const tags = input.tags ?? []; need(Array.isArray(tags) && tags.length <= 20, 'Use up to twenty document tags')
   document = { id: crypto.randomUUID(), title: text(input.title, 'Document title', 250), kind: input.kind as HandoverDocument['kind'], tags: [...new Set(tags.map(t => text(t, 'Tag', 80)))], revisions: [] }
   state.documents.push(document)
  }
  need(document.revisions.length < 100, 'A document supports up to one hundred immutable revisions')
  const revisionId = crypto.randomUUID(), files = await decisionFiles(db, job, revisionId, [object(input.file)])
  const revision = { id: revisionId, revision: document.revisions.length + 1, reference: text(input.reference, 'Exact document revision reference', 2000), file: files.attachments[0]!, by }
  document.revisions.push(revision); writes.push(...files.writes)
  recordApproval(job, actor, 'handover.document', { id: revision.id, prepared_by: by, revision: revision.revision }, { document_id: document.id, ...revision })
  return { record: document, writes }
 }
 if (section === 'packages' && !id) {
  requireJobManager(actor); need(state.packages.length < 100, 'A job supports up to one hundred handover packages')
  need(Array.isArray(input.documents) && input.documents.length > 0 && input.documents.length <= 200, 'Choose the exact document revisions for this package')
  const documents = input.documents.map(value => {
   const raw = object(value), document = find(state.documents, text(raw.document_id, 'Document id', 100)), source = find(document.revisions, text(raw.revision_id, 'Revision id', 100))
   return { id: document.id, title: document.title, kind: document.kind, tags: structuredClone(document.tags), source: structuredClone(source) }
  })
  need(new Set(documents.map(d => d.id)).size === documents.length, 'Include one exact revision per document')
  const issues = job.punch?.issues ?? [], unresolved = issues.filter(i => i.status !== 'accepted')
  need(unresolved.every(i => i.assignment && i.released_by), 'Assign and explicitly release every unresolved punch exception before preparing handover', 409, 'handover_punch')
  const exceptions = unresolved.map(i => ({ id: i.id, number: i.number, title: i.title, status: i.status, location: i.location, due_on: i.due_on, responsible: i.assignment!.company }))
  // Only the signed, client-priced specification is carried; supplier cost and internal product captures never enter a package.
  const selection_references = (job.selections ?? []).flatMap(s => s.revisions.filter(r => r.signature).map(r => ({ id: s.id, room: r.room, category: r.category, revision: r.revision, specification: { name: r.signature!.option.name, specifications: r.signature!.option.specifications, price_cents: r.signature!.option.price_cents } })))
  const warranty_references = (job.warranties?.components ?? []).map(c => ({ id: c.id, snapshot: { name: c.name, starts_on: c.starts_on, ends_on: c.ends_on, terms: c.terms, signed_terms_reference: c.signed_terms_reference } }))
  const content = { documents, exceptions, punch_results: issues.filter(i => i.released_by).map(i => ({ id: i.id, number: i.number, title: i.title, status: i.status, attempts: i.attempts.length })), selection_references, warranty_references }
  const row: HandoverPackage = { id: crypto.randomUUID(), revision: state.packages.length + 1, title: text(input.title, 'Package title', 250), digest: await fingerprint(content), by, ...content }
  state.packages.push(row); recordApproval(job, actor, 'handover.prepare', { id: row.id, prepared_by: by, revision: row.revision }, row)
  return { record: row, writes }
 }
 need(section === 'packages' && id && ['complete', 'accept'].includes(action!), 'Unknown handover action', 404, 'not_found')
 const row = find(state.packages, id)
 need(input.digest === row.digest && input.confirm === true, 'Review and confirm this exact immutable handover package', 409, 'handover_revision')
 if (action === 'complete') {
  requireJobManager(actor); need(!row.completion, 'Builder completion is already recorded', 409, 'immutable')
  need(input.client_safe === true, 'Explicitly review every document and snapshot as safe for this job’s clients')
  const current = (job.punch?.issues ?? []).filter(i => i.status !== 'accepted')
  need(current.length === row.exceptions.length && current.every(i => row.exceptions.some(e => e.id === i.id && e.status === i.status && e.responsible === i.assignment?.company) && i.released_by), 'Punch exceptions changed. Prepare a fresh package.', 409, 'handover_punch')
  row.completion = { statement: text(input.statement, 'Builder completion statement', 4000), by }
  recordApproval(job, actor, 'handover.complete', { id: row.id, prepared_by: row.by, revision: row.revision }, row)
 } else {
  need(actor.role === 'member', 'Only this job’s signed-in client records client acceptance', 403, 'client_required')
  need(row.completion, 'Package not found', 404, 'not_found'); need(!row.acceptance, 'Client acceptance is already recorded', 409, 'immutable')
  need(Array.isArray(input.exception_ids) && input.exception_ids.length === row.exceptions.length && new Set(input.exception_ids).size === row.exceptions.length && row.exceptions.every(e => (input.exception_ids as unknown[]).includes(e.id)), 'Explicitly acknowledge every unresolved exception', 409, 'handover_exceptions')
  row.acceptance = { statement: text(input.statement, 'Client acceptance statement', 4000), exception_ids: [...input.exception_ids] as string[], by }
  recordApproval(job, actor, 'handover.accept', { id: row.id, prepared_by: row.by, revision: row.revision }, { package_id: row.id, digest: row.digest, acceptance: row.acceptance })
 }
 // These decisions record handover only. BILL-003’s approved earned-value and waiver rules still govern retainage.
 return { record: row, writes }
}
