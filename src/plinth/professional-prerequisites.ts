import { requireOwner } from './auth'
import { today } from './compliance'
import { decisionDownload, decisionFiles } from './decision-files'
import { active, find, need, object, recordApproval, stamp, text, type Actor, type Attachment, type Input, type Job, type Schedule, type Stamp } from './model'
import { day } from './purchase-order-model'
import { submittalAccess, submittalReviewers } from './submittals'
import type { SubmittalReviewer } from './submittal-model'
import { getVendor } from './vendors'

export interface ProfessionalSource { kind: 'inspection' | 'coverage' | 'waiver'; source_id: string; subcontract_id?: string }
export interface ProfessionalEvidence {
 id: string; revision: number; reviewer: SubmittalReviewer; professional: string; qualification: string
 effective_on: string; expires_on: string; signed: boolean; attachments: Attachment[]
 source: { identity: string; document: Attachment; href: string }; received_by: Stamp
 decision?: { disposition: 'approved' | 'rejected'; reason: string; by: Stamp }
}
export interface ProfessionalPrerequisite {
 id: string; title: string; source: ProfessionalSource; task_ids: string[]; due_on: string
 created_by: Stamp; evidence: ProfessionalEvidence[]
}
/** Private office records. The product records a human decision, never a professional certification. */
export function professionalAccess(actor: Actor, job: Job) { need(!actor.credential_id && !actor.agent_door, 'A signed-in office person is required', 403, 'human_required'); submittalAccess(actor, job) }
export async function professionalReviewers(db: D1Database, job: Job) {
 const people = await submittalReviewers(db, job)
 // A custom reviewer must also retain independent permission to approve affected work.
 return people
}
async function currentReviewer(db: D1Database, job: Job, evidence: ProfessionalEvidence) {
 const current = (await professionalReviewers(db, job)).find(p => p.id === evidence.reviewer.id)
 need(current && current.operator_version === evidence.reviewer.operator_version && current.team_version === evidence.reviewer.team_version && current.role_version === evidence.reviewer.role_version, 'The designated reviewer authority changed; submit evidence for a current reviewer', 409, 'professional_authority')
}
async function sourceState(db: D1Database, job: Job, source: ProfessionalSource) {
 if (source.kind === 'inspection') {
  const row = find(job.schedule_constraints ?? [], source.source_id)
  need(row.kind === 'inspection' || row.kind === 'permit', 'Choose an inspection or permit requirement')
  const event = row.events.at(-1)!
  return { ready: event.action === 'cleared', document: event.documents[0], href: `/api/plinth/jobs/${job.id}/schedule-documents/${event.documents[0]?.id}`, identity: JSON.stringify({ id: row.id, event }) }
 }
 const sub = find(job.subcontracts ?? [], source.subcontract_id ?? '')
 if (source.kind === 'coverage') {
  const vendor = await getVendor(db, sub.vendor_id), record = find(vendor.compliance ?? [], source.source_id), on = await today(db)
  return { ready: record.review?.decision === 'verified' && record.effective_on <= on && on <= record.expires_on, document: record.document, href: `/api/plinth/vendors/${vendor.id}/compliance/${record.id}`, identity: JSON.stringify({ subcontract_id: sub.id, vendor_id: vendor.id, record }) }
 }
 const waiver = (sub.draws ?? []).flatMap(d => d.waivers).find(w => w.id === source.source_id)
 need(waiver, 'Choose a waiver from this subcontract', 404, 'not_found')
 return { ready: waiver.status === 'accepted' && !!waiver.release, document: waiver.release?.document, href: `/api/plinth/jobs/${job.id}/lien-waiver-files/${waiver.release?.document.id}`, identity: JSON.stringify({ subcontract_id: sub.id, waiver }) }
}
async function accepted(db: D1Database, job: Job, row: ProfessionalPrerequisite) {
 const evidence = row.evidence.at(-1), on = await today(db)
 need(evidence?.decision?.disposition === 'approved' && evidence.signed && evidence.effective_on <= on && on <= evidence.expires_on, 'Professional prerequisite is held: current signed evidence and a reasoned reviewer decision are required', 409, 'professional_hold', { prerequisite_id: row.id })
 await currentReviewer(db, job, evidence)
 const source = await sourceState(db, job, row.source)
 need(source.ready && source.document && source.identity === evidence.source.identity && source.document.id === evidence.source.document.id && source.document.checksum === evidence.source.document.checksum, 'Professional prerequisite source is unverified, expired or changed; obtain a new exact-source review', 409, 'professional_source')
}
export function professionalAffected(row: ProfessionalPrerequisite, tasks: Schedule[]) {
 const affected = new Set(row.task_ids)
 let changed = true
 while (changed) { changed = false; for (const task of tasks) if (!affected.has(task.id) && task.predecessors?.some(p => affected.has(p.id))) { affected.add(task.id); changed = true } }
 return affected
}
/** Recheck at the effect door; an earlier decision never replaces native inspection, compliance or waiver checks. */
export async function requireProfessionalGate(db: D1Database, job: Job, scope: { tasks?: Schedule[]; subcontract_id?: string }) {
 for (const row of job.professional_prerequisites ?? []) {
  const affected = professionalAffected(row, job.schedules)
  if (scope.subcontract_id && row.source.subcontract_id === scope.subcontract_id || scope.tasks?.some(t => affected.has(t.id))) await accepted(db, job, row)
 }
}
export async function professionalAction(db: D1Database, job: Job, actor: Actor, input: Input, id?: string, action?: string) {
 professionalAccess(actor, job); active(job)
 let row: ProfessionalPrerequisite
 if (!id) {
  requireOwner(actor)
  need((job.professional_prerequisites?.length ?? 0) < 200, 'This job has reached its prerequisite limit')
  const raw = object(input.source)
  need(['inspection', 'coverage', 'waiver'].includes(String(raw.kind)), 'Choose inspection, coverage or waiver')
  const source: ProfessionalSource = { kind: raw.kind as ProfessionalSource['kind'], source_id: text(raw.source_id, 'Existing source', 100), ...(raw.subcontract_id ? { subcontract_id: text(raw.subcontract_id, 'Subcontract', 100) } : {}) }
  const ids = input.task_ids ?? []
  need(Array.isArray(ids) && ids.length <= 200 && ids.every(id => typeof id === 'string' && job.schedules.some(t => t.id === id)), 'Choose existing affected job tasks')
  need(ids.length || source.subcontract_id, 'Link an affected task or subcontract release')
  if (source.subcontract_id) find(job.subcontracts ?? [], source.subcontract_id)
  await sourceState(db, job, source)
  row = { id: crypto.randomUUID(), title: text(input.title, 'Prerequisite title', 300), source, task_ids: [...new Set(ids as string[])], due_on: day(input.due_on, 'Decision deadline'), created_by: stamp(actor), evidence: [] }
  ;(job.professional_prerequisites ??= []).push(row)
  recordApproval(job, actor, 'professional.register', { id: row.id, prepared_by: row.created_by }, row)
  return { record: row, writes: [] }
 }
 row = find(job.professional_prerequisites ?? [], id)
 if (action === 'evidence') {
  requireOwner(actor)
  need(input.certified === undefined && input.verified === undefined, 'An upload never certifies or verifies a prerequisite')
  const reviewer = (await professionalReviewers(db, job)).find(p => p.id === input.reviewer_id)
  need(reviewer, 'Choose a current office reviewer for this job', 403, 'professional_reviewer')
  const source = await sourceState(db, job, row.source)
  need(source.document && input.source_document_id === source.document.id && input.source_checksum === source.document.checksum, 'Select the exact current source document and checksum', 409, 'professional_source')
  const effective_on = day(input.effective_on, 'Evidence effective date'), expires_on = day(input.expires_on, 'Evidence expiry date')
  need(expires_on >= effective_on, 'Evidence expiry cannot precede its effective date')
  need(typeof input.signed === 'boolean', 'Record explicitly whether a signed original was received')
  const evidenceId = crypto.randomUUID(), files = await decisionFiles(db, job, evidenceId, input.attachments)
  need(files.attachments.length >= 2, 'Attach the decision original and professional qualification evidence')
  const evidence: ProfessionalEvidence = { id: evidenceId, revision: row.evidence.length + 1, reviewer, professional: text(input.professional, 'Accountable professional', 200), qualification: text(input.qualification, 'Recorded qualification evidence', 2000), effective_on, expires_on, signed: input.signed, attachments: files.attachments, source: { identity: source.identity, document: source.document, href: source.href }, received_by: stamp(actor) }
  row.evidence.push(evidence)
  recordApproval(job, actor, 'professional.evidence', { id: row.id, prepared_by: row.created_by, revision: evidence.revision }, evidence)
  return { record: row, writes: files.writes }
 }
 need(action === 'review', 'Unknown prerequisite action', 404, 'not_found')
 const evidence = row.evidence.at(-1)
 need(evidence && input.evidence_id === evidence.id, 'Review the current evidence version', 409, 'professional_version')
 need(!evidence.decision, 'This decision is immutable; submit a new evidence version', 409, 'immutable')
 need(actor.id === evidence.reviewer.id, 'Only the designated office reviewer records this decision', 403, 'professional_reviewer')
 await currentReviewer(db, job, evidence)
 need(input.confirm === true, 'Explicitly confirm this exact sourced decision')
 need(input.disposition === 'approved' || input.disposition === 'rejected', 'Choose approved or rejected')
 need(input.source_document_id === evidence.source.document.id && input.source_checksum === evidence.source.document.checksum, 'The decision must name its exact source document', 409, 'professional_source')
 evidence.decision = { disposition: input.disposition, reason: text(input.reason, 'Reasoned decision', 4000), by: stamp(actor) }
 if (input.disposition === 'approved') await accepted(db, job, row)
 recordApproval(job, actor, 'professional.review', { id: row.id, prepared_by: evidence.received_by, revision: evidence.revision }, evidence)
 return { record: row, writes: [] }
}
export async function professionalView(db: D1Database, job: Job, actor: Actor) {
 professionalAccess(actor, job)
 const register = []
 const sources: { source: ProfessionalSource; title: string }[] = (job.schedule_constraints ?? []).filter(c => c.kind === 'inspection' || c.kind === 'permit').map(c => ({ source: { kind: 'inspection', source_id: c.id }, title: c.title }))
 for (const sub of job.subcontracts ?? []) {
  const vendor = await getVendor(db, sub.vendor_id)
  for (const record of vendor.compliance ?? []) sources.push({ source: { kind: 'coverage', source_id: record.id, subcontract_id: sub.id }, title: `${sub.vendor_name}: ${record.kind} · ${record.reference}` })
  for (const waiver of (sub.draws ?? []).flatMap(d => d.waivers)) sources.push({ source: { kind: 'waiver', source_id: waiver.id, subcontract_id: sub.id }, title: `${sub.vendor_name}: ${waiver.kind} waiver · ${waiver.through_date}` })
 }
 for (const row of job.professional_prerequisites ?? []) {
  const source = await sourceState(db, job, row.source)
  let hold = ''
  try { await accepted(db, job, row) } catch (error) { hold = error instanceof Error ? error.message : 'Review required' }
  register.push({ ...row, current_source: source, hold })
 }
 return { version: job.version, person_id: actor.id, manage: actor.role === 'owner', sources, reviewers: await professionalReviewers(db, job), register }
}
export async function professionalFile(db: D1Database, job: Job, actor: Actor, id: string) {
 professionalAccess(actor, job)
 return decisionDownload(db, job, (job.professional_prerequisites ?? []).flatMap(r => r.evidence.flatMap(e => e.attachments)), id)
}
