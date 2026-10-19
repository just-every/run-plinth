import { cents, DomainError, find, need, recordApproval, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import { evaluate, renewalRequests, rules, today, type ComplianceCheck } from './compliance'
import { currentQualification } from './vendor-model'
import { getVendor, save } from './vendors'
import type { Draw, LienSetup } from './lien-waiver-model'

export interface Subcontract { id: string; vendor_id: string; vendor_name: string; trade: string; scope: string; contact_ids: string[]; awarded_on: string; amount_cents?: number; awarded_by: Stamp; status?: 'awarded' | 'on_hold' | 'released'; compliance?: ComplianceCheck; released_by?: Stamp; lien?: LienSetup; draws?: Draw[] }
/** A person awards a scope on a job to a company currently qualified for that trade, with dated award terms.
 * Client job responses never include awards; SUB-003 adds insurance and license holds before release. */
export async function awardSubcontract(db: D1Database, job: Job, actor: Actor, input: Input): Promise<{ row: Subcontract; writes: D1PreparedStatement[] }> {
 need(actor.role === 'owner' || actor.role === 'admin', 'Only an owner or administrator awards a subcontract scope', 403, 'forbidden')
 const vendor = await getVendor(db, text(input.vendor_id, 'vendor_id', 100)), trade = text(input.trade, 'trade', 80)
 need(currentQualification(vendor, trade)?.status === 'qualified', `${vendor.name} is not currently qualified for ${trade}`, 409, 'not_qualified')
 need(Array.isArray(input.contact_ids) && input.contact_ids.length <= 20, 'contact_ids must be a list')
 const contacts = [...new Set(input.contact_ids as unknown[])].map(id => text(id, 'contact id', 100))
 need(contacts.every(id => vendor.contacts.some(c => c.id === id)), 'Assign contacts from this company only')
 const awarded_on = text(input.awarded_on, 'award date', 10)
 need(/^\d{4}-\d{2}-\d{2}$/.test(awarded_on) && new Date(awarded_on + 'T00:00:00Z').toISOString().slice(0, 10) === awarded_on, 'Award date must be a calendar date (YYYY-MM-DD)')
 const row: Subcontract = { id: crypto.randomUUID(), vendor_id: vendor.id, vendor_name: vendor.name, trade: currentQualification(vendor, trade)!.trade, scope: text(input.scope, 'scope', 2000), contact_ids: contacts, awarded_on, ...(input.amount_cents === undefined ? {} : { amount_cents: cents(input.amount_cents) }), awarded_by: stamp(actor) }
 // SUB-003: the owner's rules check the company's verified evidence on the company-zone date; holds keep the award from release.
 const check = evaluate(vendor, row.trade, await rules(db), await today(db)), next = structuredClone(vendor)
 row.compliance = check; row.status = check.holds.length ? 'on_hold' : 'awarded'
 ;(job.subcontracts ??= []).push(row)
 recordApproval(job, actor, 'subcontract.award', { id: row.id, prepared_by: row.awarded_by }, row)
 return { row, writes: renewalRequests(next, check, job.id) ? save(db, next, vendor) : [] }
}
/** Release lets the awarded company start; it re-checks compliance now and is refused while any hold remains. */
export async function releaseSubcontract(db: D1Database, job: Job, actor: Actor, id: string): Promise<Subcontract> {
 need(actor.role === 'owner' || actor.role === 'admin', 'Only an owner or administrator releases a subcontract scope', 403, 'forbidden')
 const row = find(job.subcontracts ?? [], id); need(row.status !== 'released', 'This scope is already released', 409, 'immutable')
 const check = evaluate(await getVendor(db, row.vendor_id), row.trade, await rules(db), await today(db))
 if (check.holds.length) throw new DomainError('compliance_hold', 'Required insurance or license evidence is missing, expired or not verified', 409, check)
 row.compliance = check; row.status = 'released'; row.released_by = stamp(actor)
 recordApproval(job, actor, 'subcontract.release', { id: row.id, prepared_by: row.awarded_by }, { id: row.id, vendor_id: row.vendor_id, trade: row.trade, compliance: check })
 return row
}
