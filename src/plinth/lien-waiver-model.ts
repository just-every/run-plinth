import { cents, DomainError, find, need, object, stamp, sum, text, type Actor, type Attachment, type Input, type Stamp } from './model'
import type { Subcontract } from './subcontracts'
import { supplierRetainageBalance } from './supplier-retainage-model'

export const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'] as const
export const FORMS = ['conditional_progress', 'unconditional_progress', 'conditional_final', 'unconditional_final'] as const
export type WaiverForm = typeof FORMS[number]
export type WaiverKind = 'conditional' | 'unconditional'
const SOURCE = 'Owner-provided wording; Plinth does not certify statutory form compliance' as const
/** Owner wording for one state, optionally for one job; a job's own template wins over the state template. */
export interface WaiverTemplate { id: string; name: string; state: string; job_id?: string; form: WaiverForm; wording: string; source: typeof SOURCE }
export interface WaiverTemplates { version: number; templates: WaiverTemplate[]; updated_by?: Stamp }
/** Tier 1 is the awarded company; each lower tier names its parent one tier up. Notice deadlines are inclusive calendar dates. */
export interface LienParty { id: string; name: string; tier: number; parent_id?: string; notice_deadline_on?: string; notice_received_on?: string }
export interface LienSetup { state: string; parties: LienParty[]; updated_by: Stamp }
export interface WaiverRelease { document: Attachment; signer_name: string; amount_cents: number; through_date: string; received_by: Stamp; signature: 'Signed release received; Plinth did not verify the signature' }
export interface Waiver { id: string; party_id: string; party_name: string; tier: number; kind: WaiverKind; template: Omit<WaiverTemplate, 'job_id'>; amount_cents: number; through_date: string; status: 'requested' | 'received' | 'accepted'; requested_by: Stamp; delivery: 'Prepared, not sent: Plinth has no subcontractor mail connection yet'; release?: WaiverRelease; accepted_by?: Stamp }
export interface SubPayment { paid_on: string; amount_cents: number; reference: string; recorded_by: Stamp; label: 'Payment recorded by staff; Plinth did not send or verify funds' }
export interface Draw { id: string; number: number; through_date: string; amount_cents: number; final: boolean; requested_by: Stamp; waivers: Waiver[]; exception?: { reason: string; by: Stamp }; payment?: SubPayment }
export interface PacketItem { subcontract_id: string; vendor_name: string; draw_id: string; draw_number: number; through_date: string; paid: boolean; party_id: string; party_name: string; tier: number; kind: WaiverKind; status: 'not_requested' | 'requested' | 'received' | 'accepted'; amount_cents?: number }
export interface LienPacket { as_of: string; unresolved: PacketItem[]; resolved: PacketItem[]; notices: { subcontract_id: string; party_id: string; party_name: string; tier: number; notice_deadline_on: string; notice_received_on?: string; status: 'received' | 'open' | 'past_deadline' }[]; exceptions: { draw_id: string; reason: string; by: Stamp }[] }

export const day = (value: unknown, name: string) => { const d = text(value, name, 10); need(/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d, `${name} must be a calendar date (YYYY-MM-DD)`); return d }
const optionalDay = (value: unknown, name: string) => value === undefined || value === null || value === '' ? undefined : day(value, name)
const state = (value: unknown) => { const s = text(value, 'state', 2).toUpperCase(); need((US_STATES as readonly string[]).includes(s), 'state must be a US state or DC postal code'); return s }

export function templateList(input: Input, actor: Actor, previous: WaiverTemplates): WaiverTemplates {
 need(Array.isArray(input.templates) && input.templates.length <= 200, 'Send a templates list of up to 200')
 const templates = (input.templates as unknown[]).map(value => {
  const t = object(value); need(FORMS.includes(t.form as WaiverForm), `form must be one of ${FORMS.join(', ')}`)
  return { id: t.id === undefined ? crypto.randomUUID() : text(t.id, 'template id', 100), name: text(t.name, 'template name', 200), state: state(t.state), ...(t.job_id ? { job_id: text(t.job_id, 'job_id', 100) } : {}), form: t.form as WaiverForm, wording: text(t.wording, 'waiver wording', 20_000), source: SOURCE }
 })
 need(new Set(templates.map(t => `${t.state}|${t.job_id ?? ''}|${t.form}`)).size === templates.length, 'One template per state, job and form')
 return { version: previous.version + 1, templates, updated_by: stamp(actor) }
}
/** Tier 1 is always the awarded company; changing the setup never drops a party that already has waivers. */
export function lienSetup(sub: Subcontract, input: Input, actor: Actor): LienSetup {
 need(input.lower_tiers === undefined || Array.isArray(input.lower_tiers) && input.lower_tiers.length <= 50, 'lower_tiers must be a list of up to 50')
 const parties: LienParty[] = [{ id: sub.vendor_id, name: sub.vendor_name, tier: 1, ...dates(input) }]
 for (const value of (input.lower_tiers ?? []) as unknown[]) {
  const p = object(value), parent = parties.find(x => x.id === text(p.parent_id, 'parent_id', 100))
  need(parent, 'Each lower-tier party names a parent listed before it'); const id = text(p.id, 'party id', 100)
  need(!parties.some(x => x.id === id), 'Party ids must be unique')
  parties.push({ id, name: text(p.name, 'party name', 200), tier: parent.tier + 1, parent_id: parent.id, ...dates(p) })
 }
 const used = new Set((sub.draws ?? []).flatMap(d => d.waivers.map(w => w.party_id)))
 need([...used].every(id => parties.some(p => p.id === id)), 'A party with waivers cannot be removed', 409, 'waiver_party')
 return { state: state(input.state), parties, updated_by: stamp(actor) }
}
function dates(input: Input) {
 const deadline = optionalDay(input.notice_deadline_on, 'notice deadline'), received = optionalDay(input.notice_received_on, 'notice received date')
 return { ...(deadline ? { notice_deadline_on: deadline } : {}), ...(received ? { notice_received_on: received } : {}) }
}
/** Draws bill the released award in order: through-dates never go backwards and the total never exceeds the award amount. */
export function requestDraw(sub: Subcontract, input: Input, actor: Actor): Draw {
 need(sub.status === 'released', 'Release the subcontract scope before its first draw', 409, 'subcontract_state')
 need(sub.lien, 'Record the lien state and parties before requesting a draw', 409, 'lien_setup')
 const draws = sub.draws ??= [], through_date = day(input.through_date, 'through date'), amount = cents(input.amount_cents)
 need(amount > 0, 'Draw amount must be positive')
 need(!draws.some(d => d.final), 'The final draw has already been requested', 409, 'draw_final')
 need(draws.every(d => d.through_date <= through_date), 'A draw cannot run through an earlier date than the previous draw', 409, 'draw_order')
 need(sub.amount_cents === undefined || sum([amount, ...draws.map(d => d.amount_cents)]) <= sub.amount_cents, 'Draws would exceed the awarded amount', 409, 'draw_balance')
 const row: Draw = { id: crypto.randomUUID(), number: draws.length + 1, through_date, amount_cents: amount, final: input.final === true, requested_by: stamp(actor), waivers: [] }
 draws.push(row); return row
}
/** Conditional waivers are requested before payment; the unconditional waits for the recorded payment. */
export function requestWaiver(sub: Subcontract, draw: Draw, input: Input, actor: Actor, all: WaiverTemplates, jobId: string): Waiver {
 const party = find(sub.lien!.parties, text(input.party_id, 'party_id', 100)), kind = input.kind
 need(kind === 'conditional' || kind === 'unconditional', 'kind must be conditional or unconditional')
 if (kind === 'conditional') need(!draw.payment, 'This draw is paid; request the unconditional release', 409, 'payment_recorded')
 else need(draw.payment, 'An unconditional release waits for confirmed payment of this draw', 409, 'payment_unconfirmed')
 need(!draw.waivers.some(w => w.party_id === party.id && w.kind === kind), `A ${kind} waiver is already requested from ${party.name} for this draw`, 409, 'waiver_exists')
 const amount = party.tier === 1 ? kind === 'conditional' ? draw.amount_cents : draw.payment!.amount_cents : cents(input.amount_cents)
 need(amount > 0 && amount <= draw.amount_cents, 'A lower-tier waiver amount must be positive and within the draw')
 const form = `${kind}_${draw.final ? 'final' : 'progress'}` as WaiverForm, matching = all.templates.filter(t => t.state === sub.lien!.state && t.form === form)
 const template = matching.find(t => t.job_id === jobId) ?? matching.find(t => !t.job_id)
 need(template, `Add ${sub.lien!.state} ${form.replace('_', ' ')} waiver wording before requesting it`, 409, 'waiver_template')
 const { job_id: _job, ...snapshot } = template
 const row: Waiver = { id: crypto.randomUUID(), party_id: party.id, party_name: party.name, tier: party.tier, kind, template: snapshot, amount_cents: amount, through_date: draw.through_date, status: 'requested', requested_by: stamp(actor), delivery: 'Prepared, not sent: Plinth has no subcontractor mail connection yet' }
 draw.waivers.push(row); return row
}
/** A signed release must state exactly the requested amount and through-date. */
export function exact(waiver: Waiver, input: Input, label: string) {
 const amount = cents(input.amount_cents), through = day(input.through_date, 'through date')
 if (amount !== waiver.amount_cents || through !== waiver.through_date) throw new DomainError('waiver_mismatch', `${label} must match the requested amount and through-date exactly`, 409, { expected: { amount_cents: waiver.amount_cents, through_date: waiver.through_date }, received: { amount_cents: amount, through_date: through } })
 return { amount_cents: amount, through_date: through }
}
export function attachRelease(waiver: Waiver, input: Input, actor: Actor, document: Attachment): WaiverRelease {
 need(waiver.status === 'requested', 'This waiver already has a signed release', 409, 'immutable')
 const figures = exact(waiver, input, 'The signed release')
 waiver.release = { document, signer_name: text(input.signer_name, 'signer name', 200), ...figures, received_by: stamp(actor), signature: 'Signed release received; Plinth did not verify the signature' }
 waiver.status = 'received'; return waiver.release
}
/** The reviewer signs off by restating the exact amount and through-date of the received release. */
export function acceptWaiver(waiver: Waiver, input: Input, actor: Actor) {
 need(waiver.status === 'received', 'Attach the signed release before accepting it', 409, 'waiver_state')
 exact(waiver, input, 'The reviewed figures'); waiver.status = 'accepted'; waiver.accepted_by = stamp(actor); return waiver
}
/** Payment needs an accepted conditional waiver from every party on the award, unless the owner recorded an exception. */
export function recordPayment(sub: Subcontract, draw: Draw, input: Input, actor: Actor): SubPayment {
 need(!draw.payment, 'This draw is already paid', 409, 'immutable')
 need(!(supplierRetainageBalance(sub)?.draws.find(row=>row.draw_id===draw.id)?.held_cents), 'Release this supplier draw’s retained value before recording its existing full-gross payment; net payment handoff is not available', 409, 'supplier_retainage_held')
 const missing = sub.lien!.parties.filter(p => !draw.waivers.some(w => w.party_id === p.id && w.kind === 'conditional' && w.status === 'accepted'))
 if (missing.length && !draw.exception) throw new DomainError('waiver_required', 'Accept a conditional waiver from every party, or record an owner exception, before payment', 409, { missing: missing.map(p => ({ party_id: p.id, party_name: p.name, tier: p.tier })) })
 const amount = cents(input.amount_cents); need(amount === draw.amount_cents, 'Record one payment of exactly the draw amount', 409, 'payment_amount')
 const paid_on = day(input.paid_on, 'payment date'); need(paid_on >= draw.through_date, 'Payment cannot precede the draw through-date')
 draw.payment = { paid_on, amount_cents: amount, reference: text(input.reference, 'payment reference', 200), recorded_by: stamp(actor), label: 'Payment recorded by staff; Plinth did not send or verify funds' }
 return draw.payment
}
export function recordException(draw: Draw, input: Input, actor: Actor) {
 need(actor.role === 'owner', 'Only the owner approves a lien waiver exception', 403, 'forbidden')
 need(!draw.payment && !draw.exception, 'An exception is recorded once, before payment', 409, 'immutable')
 draw.exception = { reason: text(input.reason, 'exception reason', 2000), by: stamp(actor) }; return draw.exception
}
/** Every party owes a conditional waiver on an unpaid draw and an unconditional one once it is paid; anything not accepted is unresolved. */
export function lienPacket(subs: Subcontract[], on: string): LienPacket {
 const packet: LienPacket = { as_of: on, unresolved: [], resolved: [], notices: [], exceptions: [] }
 for (const sub of subs.filter(s => s.lien)) {
  for (const p of sub.lien!.parties.filter(p => p.notice_deadline_on)) packet.notices.push({ subcontract_id: sub.id, party_id: p.id, party_name: p.name, tier: p.tier, notice_deadline_on: p.notice_deadline_on!, ...(p.notice_received_on ? { notice_received_on: p.notice_received_on } : {}), status: p.notice_received_on ? 'received' : on > p.notice_deadline_on! ? 'past_deadline' : 'open' })
  for (const draw of sub.draws ?? []) {
   if (draw.exception) packet.exceptions.push({ draw_id: draw.id, ...draw.exception })
   for (const party of sub.lien!.parties) for (const kind of [draw.payment ? 'unconditional' : 'conditional'] as WaiverKind[]) {
    const w = draw.waivers.find(x => x.party_id === party.id && x.kind === kind)
    const item: PacketItem = { subcontract_id: sub.id, vendor_name: sub.vendor_name, draw_id: draw.id, draw_number: draw.number, through_date: draw.through_date, paid: !!draw.payment, party_id: party.id, party_name: party.name, tier: party.tier, kind, status: w?.status ?? 'not_requested', ...(w ? { amount_cents: w.amount_cents } : {}) }
    ;(item.status === 'accepted' ? packet.resolved : packet.unresolved).push(item)
   }
  }
 }
 return packet
}
