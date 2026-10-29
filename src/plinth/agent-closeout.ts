import type { Bindings } from '../auth.server'
import { digest } from './attachments'
import { requireOwner } from './auth'
import { active, find, need, object, stamp, text, type Actor, type Attachment, type Input, type Job, type Stamp } from './model'
import { jobOf, readClock, saveJob } from './store'
import { warrantyGeneration } from './warranty-store'
import { closeoutCacheSql, closeoutSources as sourceState } from './agent-closeout-cache'

type Kind = 'specification' | 'manual' | 'inspection' | 'photo' | 'punch' | 'warranty' | 'promise' | 'package' | 'service'
interface Source { key: string; kind: Kind; record_id: string; revision_id: string; reference: string; file?: Attachment; original_path?: string; evidence: unknown }
interface Requirement { id: string; title: string; kind: Kind; source_keys: string[]; proposed_owner: string; reason: string }
interface Draft { id: string; job_id: string; request_id: string; kind: 'request' | 'visit'; requirement_ids: string[]; proposed_owner: string; message: string; proposed_window: string; status: 'unsent'; by: Stamp }
export interface CloseoutPacket {
 id: string; job_id: string; revision: number; title: string; by: Stamp; requirements: Requirement[]; sources: Source[]
 comparisons: { requirement_id: string; state: 'missing_evidence' | 'recorded_evidence'; source_keys: string[]; proposed_owner: string }[]
 unresolved: { kind: 'punch' | 'service'; id: string; title: string; state: string; evidence: unknown }[]
 source_digest: string; digest: string; boundary: string
 review?: { by: Stamp; person_version: number; generation: number; statement: string }
 revocation?: { by: Stamp; reason: string }
 drafts: Draft[]
}
const fingerprint = (value: unknown) => digest(new TextEncoder().encode(JSON.stringify(value)))
const kinds: Kind[] = ['specification', 'manual', 'inspection', 'photo', 'punch', 'warranty', 'promise', 'package', 'service']
const json = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
/** Packet state is never a professional decision or a service completion signal. */
const boundary = 'Private evidence comparison only. Documents and trade statements do not certify inspection, interpret coverage, release work, book visits, send messages or close cases. Builder acceptance and client acknowledgment remain separate human decisions.'

function inventory(job: Job): Source[] {
 const root = '/api/plinth/jobs/' + encodeURIComponent(job.id), sources: Source[] = []
 for (const document of job.handover?.documents ?? []) for (const revision of document.revisions) {
  const kind: Kind = document.kind === 'selection' || document.kind === 'as-built' ? 'specification' : document.kind === 'manual' || document.kind === 'inspection' || document.kind === 'punch' || document.kind === 'warranty' ? document.kind : 'package'
  sources.push({ key: 'document:' + revision.id, kind, record_id: document.id, revision_id: revision.id, reference: revision.reference, file: revision.file, original_path: root + '/handover/files/' + revision.file.id, evidence: { title: document.title, kind: document.kind, revision: revision.revision, by: revision.by } })
 }
 for (const selection of job.selections ?? []) for (const revision of selection.revisions) if (revision.signature) sources.push({ key: 'selection:' + revision.id, kind: 'specification', record_id: selection.id, revision_id: revision.id, reference: 'Signed selection revision ' + revision.revision, evidence: revision })
 for (const entry of job.diary) for (const file of entry.attachments) sources.push({ key: 'photo:' + file.id, kind: 'photo', record_id: entry.id, revision_id: file.checksum, reference: entry.date + ': ' + entry.note, file, original_path: root + '/diary/' + entry.id + '/attachments/' + file.id, evidence: { status: entry.status, by: entry.prepared_by } })
 for (const issue of job.punch?.issues ?? []) sources.push({ key: 'punch:' + issue.id, kind: 'punch', record_id: issue.id, revision_id: String(issue.attempts.length) + ':' + issue.status, reference: issue.title, file: issue.photo, original_path: root + '/punch/files/' + issue.photo.id, evidence: issue })
 for (const component of job.warranties?.components ?? []) sources.push({ key: 'warranty:' + component.id, kind: 'warranty', record_id: component.id, revision_id: component.id, reference: component.signed_terms_reference, evidence: component })
 for (const promise of job.warranties?.promises ?? []) sources.push({ key: 'promise:' + promise.id, kind: 'promise', record_id: promise.id, revision_id: String(promise.revision), reference: promise.agreement_reference, evidence: promise })
 for (const item of job.warranties?.cases ?? []) sources.push({ key: 'service:' + item.id, kind: 'service', record_id: item.id, revision_id: String(item.reviews.length) + ':' + item.status, reference: item.description, evidence: item })
 for (const packet of job.handover?.packages ?? []) sources.push({ key: 'package:' + packet.id, kind: 'package', record_id: packet.id, revision_id: packet.digest, reference: packet.title, evidence: packet })
 return sources
}
async function ownerSponsor(db: D1Database, actor: Actor) {
 if (actor.role !== 'agent') { requireOwner(actor); need(!actor.agent_door, 'Use the draft agent door', 403, 'forbidden'); return }
 const current = await db.prepare("SELECT id FROM oa_operators WHERE id=? AND version=? AND role='owner' AND status='active'").bind(actor.id, actor.version).first()
 need(current && (!actor.agent_native_role || actor.agent_native_role === 'owner'), 'Only an owner may sponsor closeout evidence drafts', 403, 'forbidden')
}
async function reviewed(db: D1Database, job: Job, packet: CloseoutPacket) {
 need(packet.review, 'An owner must review this exact packet first', 409, 'closeout_review')
 need(!packet.revocation, 'The owner revoked this packet consent', 409, 'closeout_revoked')
 need(packet.source_digest === await fingerprint(sourceState(job)), 'Closeout sources changed; prepare and review a new packet', 409, 'closeout_sources')
 const current = await db.prepare("SELECT id FROM oa_operators WHERE id=? AND version=? AND role='owner' AND status='active'").bind(packet.review.by.id, packet.review.person_version).first()
 need(current && packet.review.generation === await warrantyGeneration(db), 'Review authority changed; an owner must review a new packet', 409, 'closeout_authority')
}
async function prepare(job: Job, actor: Actor, input: Input) {
 const available = inventory(job)
 need(Array.isArray(input.source_keys) && input.source_keys.length <= 200, 'Choose at most two hundred exact source references')
 const keys = input.source_keys.map(key => text(key, 'Source key', 200))
 need(new Set(keys).size === keys.length, 'Select each source once')
 const sources = keys.map(key => { const source = available.find(s => s.key === key); need(source, 'Source is unavailable in this job', 404, 'closeout_source'); return structuredClone(source) })
 need(Array.isArray(input.requirements) && input.requirements.length > 0 && input.requirements.length <= 100, 'Record one to one hundred closeout requirements')
 const requirements: Requirement[] = input.requirements.map(value => {
  const raw = object(value); need(kinds.includes(raw.kind as Kind), 'Choose the requirement evidence kind')
  need(Array.isArray(raw.source_keys) && raw.source_keys.length <= 200, 'Name exact selected sources or leave missing evidence explicit')
  const source_keys = raw.source_keys.map(key => text(key, 'Source key', 200))
  need(new Set(source_keys).size === source_keys.length && source_keys.every(key => sources.some(s => s.key === key && s.kind === raw.kind)), 'A requirement must cite selected evidence of its own kind')
  return { id: text(raw.id, 'Requirement id', 100), title: text(raw.title, 'Recorded requirement', 1000), kind: raw.kind as Kind, source_keys, proposed_owner: text(raw.proposed_owner, 'Proposed missing-item owner', 250), reason: text(raw.reason, 'Requirement source or reason', 2000) }
 })
 need(new Set(requirements.map(r => r.id)).size === requirements.length, 'Requirement ids must be unique')
 const unresolved: CloseoutPacket['unresolved'] = [
  ...(job.punch?.issues ?? []).filter(i => i.status !== 'accepted').map(i => ({ kind: 'punch' as const, id: i.id, title: i.title, state: i.status, evidence: structuredClone(i) })),
  ...(job.warranties?.cases ?? []).filter(c => c.status !== 'closed').map(c => ({ kind: 'service' as const, id: c.id, title: c.description, state: c.status, evidence: structuredClone(c) })),
 ]
 const content = { title: text(input.title, 'Packet title', 250), requirements, sources, unresolved, source_digest: await fingerprint(sourceState(job)), boundary,
  comparisons: requirements.map(r => ({ requirement_id: r.id, state: r.source_keys.length ? 'recorded_evidence' as const : 'missing_evidence' as const, source_keys: r.source_keys, proposed_owner: r.proposed_owner })) }
 return { id: crypto.randomUUID(), job_id: job.id, revision: (job.agent_closeout?.length ?? 0) + 1, by: stamp(actor), ...content, digest: await fingerprint(content), drafts: [] } satisfies CloseoutPacket
}
export async function closeoutResponse(request: Request, env: Bindings, actor: Actor, parts: string[], body: (r: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'jobs' || parts[2] !== 'agent-closeout') return null
 await ownerSponsor(env.DB, actor)
 const clock = await readClock(env.DB), previous = await jobOf(env.DB, actor, parts[1]!)
 if (request.method === 'GET') {
  if (parts.length === 3) { requireOwner(actor); return json({ version: previous.version, sources: inventory(previous), packets: previous.agent_closeout ?? [], boundary }) }
  need(parts.length === 4, 'Unknown closeout route', 404, 'not_found')
  const packet = parts[3] === 'latest' ? (previous.agent_closeout ?? []).filter(p => p.review).at(-1) : find(previous.agent_closeout ?? [], parts[3])
  need(packet, 'Reviewed closeout packet not found', 404, 'not_found')
  if (actor.role === 'agent') await reviewed(env.DB, previous, packet)
  return json({ record: packet, version: previous.version })
 }
 need(request.method === 'POST', 'Method not allowed', 405, 'method_not_allowed')
 const input = await body(request)
 need(input.expected_version === previous.version, 'Job changed; reload before preparing closeout evidence', 409, 'stale_version')
 active(previous)
 const job = structuredClone(previous), packets = job.agent_closeout ??= []
 let record: CloseoutPacket | Draft
 const writes: D1PreparedStatement[] = []
 if (parts.length === 3) {
  requireOwner(actor); need(packets.length < 100, 'This job has one hundred retained closeout packets')
  record = await prepare(job, actor, input); packets.push(record)
 } else {
  need(parts.length === 5, 'Unknown closeout action', 404, 'not_found')
  const packet = find(packets, parts[3])
  need(input.digest === packet.digest, 'Review the exact packet digest', 409, 'closeout_revision')
  if (parts[4] === 'review') {
   requireOwner(actor); need(!packet.review, 'Packet review is immutable; prepare a new packet', 409, 'immutable')
   need(input.confirm === true, 'Explicitly consent to agent use of this private packet')
   need(packet.source_digest === await fingerprint(sourceState(job)), 'Closeout sources changed; prepare a new packet', 409, 'closeout_sources')
   packet.review = { by: stamp(actor), person_version: actor.version, generation: await warrantyGeneration(env.DB), statement: text(input.statement, 'Review statement', 2000) }
   record = packet
  } else if (parts[4] === 'revoke') {
   requireOwner(actor); need(packet.review && !packet.revocation, 'Only an active packet consent can be revoked', 409, 'closeout_review')
   need(input.confirm === true, 'Confirm revocation of this exact private packet')
   packet.revocation = { by: stamp(actor), reason: text(input.reason, 'Consent revocation reason', 2000) }
   writes.push(...closeoutCacheSql(job.id).map(s => env.DB.prepare(s.sql).bind(...s.params)))
   record = packet
  } else {
   need(parts[4] === 'drafts', 'Only follow-up drafts are supported', 404, 'not_found')
   await reviewed(env.DB, job, packet)
   need(packet.drafts.length < 100, 'This packet has one hundred retained follow-up drafts')
   const request_id = text(input.request_id, 'Draft request id', 100)
   need(input.kind === 'request' || input.kind === 'visit', 'Prepare a request or visit proposal')
   need(Array.isArray(input.requirement_ids) && input.requirement_ids.length > 0 && input.requirement_ids.length <= 100, 'Link draft requirements')
   const requirement_ids = input.requirement_ids.map(id => text(id, 'Requirement id', 100))
   need(requirement_ids.every(id => packet.requirements.some(r => r.id === id)), 'Draft requirements must belong to this packet')
   record = { id: crypto.randomUUID(), job_id: job.id, request_id, kind: input.kind, requirement_ids, proposed_owner: text(input.proposed_owner, 'Proposed owner', 250), message: text(input.message, 'Unsent follow-up', 4000), proposed_window: input.kind === 'visit' ? text(input.proposed_window, 'Proposed visit window', 500) : '', status: 'unsent', by: stamp(actor) }
   const earlier = packet.drafts.find(d => d.request_id === request_id)
   if (earlier) {
    const terms = ({ kind, requirement_ids, proposed_owner, message, proposed_window }: Draft) => ({ kind, requirement_ids, proposed_owner, message, proposed_window })
    need(JSON.stringify(terms(earlier)) === JSON.stringify(terms(record)), 'This request id already names different draft terms', 409, 'closeout_replay')
    return json({ record: earlier, version: previous.version })
   }
   packet.drafts.push(record)
  }
 }
 await saveJob(env.DB, actor, previous, job, writes, clock)
 return json({ record, version: job.version })
}
