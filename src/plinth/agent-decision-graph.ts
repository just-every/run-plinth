import { requireOwner } from './auth'
import { digest } from './attachments'
import { decisionHeld } from './selection-model'
import { day, fulfillment } from './purchase-order-model'
import { jobOf, readClock, saveJob } from './store'
import { find, need, object, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import type { Bindings } from '../auth.server'

interface Reference { kind: 'selection' | 'product' | 'task' | 'rfi' | 'order'; id: string; revision_id?: string; fingerprint: string }
interface Link { selection_id: string; revision_id: string; task_ids: string[]; product_ids: string[]; rfi_ids: string[]; order_ids: string[]; lead_days: number; review_days: number; buffer_days: number }
export interface DecisionGraph {
 id: string; auth_generation: number; origin: string; as_of: string; links: Link[]; sources: Reference[]; facts: unknown[];
 reviewed_by: Stamp; owner_version: number; review: string;
 drafts: { id: string; request_id: string; text: string; by: Stamp; status: 'proposed'; delivery: 'unsent'; consent: 'unverified' }[]
}
const json = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'private, no-store' } })
const fingerprint = (value: unknown) => digest(new TextEncoder().encode(JSON.stringify(value)))
const ids = (value: unknown, name: string, required = false): string[] => {
 need(Array.isArray(value) && value.length <= 30 && (!required || value.length > 0), `Choose ${required ? 'one to' : 'up to'} 30 ${name}`)
 const result = value.map(v => text(v, name, 100)); need(new Set(result).size === result.length, `Choose each ${name} once`); return result
}
const days = (value: unknown, name: string) => { need(Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 3650, `${name} is zero to 3650 calendar days`); return Number(value) }
function source(job: Job, ref: Omit<Reference, 'fingerprint'>) {
 if (ref.kind === 'selection') return find(job.selections ?? [], ref.id)
 if (ref.kind === 'product') return find(job.products ?? [], ref.id)
 if (ref.kind === 'task') return find(job.schedules, ref.id)
 if (ref.kind === 'rfi') return find(job.rfis ?? [], ref.id)
 return find(job.orders, ref.id)
}
async function collect(job: Job, links: Link[]) {
 const refs: Omit<Reference, 'fingerprint'>[] = []
 for (const link of links) {
  refs.push({ kind: 'selection', id: link.selection_id, revision_id: link.revision_id })
  for (const [kind, values] of [['task', link.task_ids], ['product', link.product_ids], ['rfi', link.rfi_ids], ['order', link.order_ids]] as const) for (const id of values) refs.push({ kind, id })
 }
 const unique = [...new Map(refs.map(r => [r.kind + ':' + r.id, r])).values()]
 return Promise.all(unique.map(async ref => ({ ...ref, fingerprint: await fingerprint(source(job, ref)) })))
}
/** No unselected job record is included in a reviewed packet or a draft request. */
function facts(job: Job, link: Link, asOf: string) {
 const selection = find(job.selections ?? [], link.selection_id), revision = find(selection.revisions, link.revision_id)
 need(revision === selection.revisions.at(-1), 'Review the latest selection revision', 409, 'decision_source_stale')
 const tasks = link.task_ids.map(id => find(job.schedules, id))
 need(tasks.every(t => t.status !== 'cancelled'), 'A cancelled task cannot supply a decision deadline', 409, 'decision_source_stale')
 const latestTask = Math.min(...tasks.map(t => Date.parse(t.start)))
 // Lead, review and safety buffers are explicitly whole elapsed calendar days in UTC.
 const cutoff = new Date(latestTask - (link.lead_days + link.review_days + link.buffer_days) * 86_400_000).toISOString()
 const held = decisionHeld(selection, revision.id), signed = revision.status === 'signed' && !!revision.signature && !held
 const chosen = revision.signature?.option
 const comparisons = link.product_ids.map(id => {
  const product = find(job.products ?? [], id), candidate = product.revisions.at(-1)!
  need(candidate.reviewed_by, 'Review the exact selected product capture first', 409, 'product_unreviewed')
  const original = chosen?.product_source ?? revision.options.find(o => o.product_source)?.product_source
  return { product_id: id, revision_id: candidate.id, name: candidate.name, specifications: candidate.dimensions, supplier: candidate.supplier,
   source_url: candidate.source_url, evidence: candidate.evidence, captured_on: candidate.captured_on, valid_until: candidate.valid_until,
   available: !candidate.discontinued && candidate.valid_until >= asOf, supplier_quote_cents: candidate.cost_quote_cents,
   original_product_revision_id: original?.id ?? null, original_supplier_quote_cents: original?.cost_quote_cents ?? null,
   supplier_quote_difference_cents: original ? candidate.cost_quote_cents - original.cost_quote_cents : null,
   client_price_difference_cents: null, lead_days: candidate.lead_days,
   specification_comparison: original ? { original: original.dimensions, proposed: candidate.dimensions } : null,
   status: 'proposed', approval_required: 'Existing exact builder and client substitution doors' }
 })
 const orders = link.order_ids.map(id => {
  const order = find(job.orders, id)
  need(order.source?.kind === 'selection' && order.source.selection_id === selection.id && order.source.revision_id === revision.id, 'An order must bind this exact selection revision', 409, 'decision_order_source')
  const state = fulfillment(order)
  return { order_id: order.id, status: order.status, approved_by: order.issued_by ?? null,
   vendor_send: order.delivery?.status ?? 'unsent', acknowledgment: order.acknowledgment ?? null,
   human_receipts: order.receipts, returned: order.returns ?? [], delivery_status: state.delivery_status,
   received: order.status === 'issued' && state.delivery_status === 'received' && order.receipts.length > 0 }
 })
 const rfis = link.rfi_ids.map(id => {
  const rfi = find(job.rfis ?? [], id)
  need(rfi.task_ids.some(id => link.task_ids.includes(id)), 'An RFI must name one of the selected dependent tasks', 409, 'decision_rfi_task')
  return { id: rfi.id, title: rfi.title, question: rfi.question, responses: rfi.responses, resolved: rfi.resolved ?? null }
 })
 return { selection_id: selection.id, revision_id: revision.id, status: signed ? 'approved' : 'proposed', held,
  choice: chosen ?? null, options: revision.options, tasks: tasks.map(t => ({ id: t.id, revision: t.revision ?? 1, description: t.description, start: t.start, predecessors: t.predecessors ?? [] })),
  timing: { basis: 'Elapsed UTC calendar days before earliest dependent task start', lead_days: link.lead_days, review_days: link.review_days, buffer_days: link.buffer_days, latest_safe_decision_at: cutoff,
   warning: !signed && Date.parse(asOf + 'T00:00:00Z') >= Date.parse(cutoff) ? 'Decision cutoff reached; dependent work at risk' : !signed ? 'Decision pending before cutoff' : 'Client choice recorded; procurement still requires human review' },
  comparisons, rfis, submittal_evidence: { status: 'unavailable', reason: 'Submittal evidence is not authorized by this packet; use the existing reviewed submittal door' },
  orders, case_closed: signed && orders.length > 0 && orders.every(o => o.received) && rfis.every(r => !!r.resolved) }
}
function access(actor: Actor, origin: string, packet?: DecisionGraph) {
 if (actor.role === 'owner' && !actor.agent_door) return
 need(packet && packet.origin === origin && actor.agent_door?.sponsor_role === 'owner' && actor.agent_native_role === 'owner' && actor.id === packet.reviewed_by.id && actor.version === packet.owner_version, 'Only the reviewing owner and their bounded draft agent may read this packet', 403, 'decision_packet_authority')
}
async function current(job: Job, packet: DecisionGraph) {
 const refs = await collect(job, packet.links)
 need(JSON.stringify(refs) === JSON.stringify(packet.sources), 'Selected evidence changed; the owner must review a new packet', 409, 'decision_source_stale')
}
export async function decisionGraphResponse(request: Request, env: Bindings, actor: Actor, parts: string[], body: (r: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'jobs' || parts[2] !== 'decision-graphs') return null
 const clock = await readClock(env.DB), previous = await jobOf(env.DB, actor, parts[1])
 const generation = (await env.DB.prepare('SELECT generation FROM oa_auth_settings WHERE singleton=1').first<{generation:number}>())!.generation
 if (parts.length === 3) {
  if (request.method === 'GET') {
   if (actor.role !== 'owner') need(actor.agent_door?.sponsor_role === 'owner' && actor.agent_native_role === 'owner', 'Only the owner may list reviewed packets', 403, 'decision_packet_authority')
   return json({ packets: (previous.decision_graphs ?? []).filter(p => actor.role === 'owner' || p.auth_generation === generation && p.origin === env.AUTH_ORIGIN && p.reviewed_by.id === actor.id && p.owner_version === actor.version).map(({ id, as_of }) => ({ id, as_of })), version: previous.version })
  }
  requireOwner(actor); need(!actor.agent_door, 'A signed-in owner explicitly reviews source access', 403, 'human_required')
  need(request.method === 'POST', 'Method not allowed', 405, 'method_not_allowed')
  const input = await body(request); need(input.expected_version === previous.version, 'Job changed. Reload before review.', 409, 'stale_version')
  need(input.confirm === true, 'Explicitly consent to these exact native facts for a private draft request')
  const as_of = day(input.as_of, 'As-of date')
  need(Array.isArray(input.links) && input.links.length > 0 && input.links.length <= 30, 'Choose one to 30 decision links')
  const links = input.links.map(value => {
   const row = object(value), selection_id = text(row.selection_id, 'Selection identity', 100), revision_id = text(row.revision_id, 'Selection revision', 100)
   const revision = find(find(previous.selections ?? [], selection_id).revisions, revision_id)
   const lead_days = days(row.lead_days, 'Lead time'); need(lead_days >= Math.max(revision.lead_days, ...revision.options.map(o => o.product_source?.lead_days ?? 0)), 'Do not shorten the selection source lead time')
   const product_ids = ids(row.product_ids ?? [], 'product identities')
   for (const id of product_ids) need(lead_days >= find(previous.products ?? [], id).revisions.at(-1)!.lead_days, 'Do not shorten a selected product lead time')
   return { selection_id, revision_id, task_ids: ids(row.task_ids, 'dependent task identities', true), product_ids, rfi_ids: ids(row.rfi_ids ?? [], 'RFI identities'), order_ids: ids(row.order_ids ?? [], 'order identities'), lead_days, review_days: days(row.review_days, 'Review buffer'), buffer_days: days(row.buffer_days, 'Safety buffer') }
  })
  need(new Set(links.map(l => l.selection_id)).size === links.length, 'Choose each decision once')
  const packet: DecisionGraph = { id: crypto.randomUUID(), auth_generation: generation, origin: env.AUTH_ORIGIN, as_of, links, sources: await collect(previous, links), facts: links.map(l => facts(previous, l, as_of)), reviewed_by: stamp(actor), owner_version: actor.version, review: text(input.review, 'Owner review reason', 2000), drafts: [] }
  const next = structuredClone(previous); (next.decision_graphs ??= []).push(packet); await saveJob(env.DB, actor, previous, next, [], clock)
  return json({ record: packet, version: next.version })
 }
 need(parts.length === 4 || parts.length === 5 && parts[4] === 'draft', 'Unknown decision packet route', 404, 'not_found')
 const packet = find(previous.decision_graphs ?? [], parts[3]); access(actor, env.AUTH_ORIGIN, packet)
 if (actor.role !== 'owner') need(packet.auth_generation === generation, 'The receiving owner must review a fresh packet', 409, 'decision_packet_installation')
 if (request.method === 'GET' && parts.length === 4) {
  if (actor.role === 'owner') { const refs = await collect(previous, packet.links); return json({ record: packet, current: packet.auth_generation === generation && packet.origin === env.AUTH_ORIGIN && JSON.stringify(refs) === JSON.stringify(packet.sources), version: previous.version }) }
  await current(previous, packet); return json({ record: packet, current: true, version: previous.version })
 }
 need(request.method === 'POST' && parts[4] === 'draft', 'Method not allowed', 405, 'method_not_allowed')
 need(packet.auth_generation === generation && packet.origin === env.AUTH_ORIGIN, 'The receiving owner must review a fresh packet', 409, 'decision_packet_installation')
 const input = await body(request); need(input.expected_version === previous.version, 'Job changed. Reload before drafting.', 409, 'stale_version'); await current(previous, packet)
 const request_id = text(input.request_id, 'Draft request identity', 100), repeated = packet.drafts.find(d => d.request_id === request_id)
 if (repeated) return json({ record: repeated, version: previous.version })
 need(packet.drafts.length < 100, 'Review a new packet after 100 draft requests')
 const next = structuredClone(previous), selected = find(next.decision_graphs!, packet.id)
 const draft: DecisionGraph['drafts'][number] = { id: crypto.randomUUID(), request_id, status: 'proposed', delivery: 'unsent', consent: 'unverified', by: stamp(actor), text: `Private request draft as of ${packet.as_of}. Review the cited choices and task cutoffs: ${JSON.stringify(packet.facts)}. Recipient consent and current authority require separate human review. Clients choose; builders approve substitutions and vendor sends. An acknowledgment is not delivery.` }
 selected.drafts.push(draft); await saveJob(env.DB, actor, previous, next, [], clock)
 return json({ record: draft, version: next.version })
}
