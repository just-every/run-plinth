import { cents, need, object, stamp, text, type Actor, type Input, type Stamp } from './model'
import { nanp } from './us-conventions'
import type { ComplianceRecord, RenewalRequest } from './compliance'

export interface VendorContact { id: string; name: string; email: string; phone: string; phone_e164?: string }
export interface VendorRate { id: string; description: string; unit: string; cents: number; effective_on: string; reference: string; reviewed_by: Stamp }
export interface Qualification { id: string; trade: string; status: 'qualified' | 'rejected'; evidence: string; reviewed_by: Stamp }
export interface VendorDocument { id: string; name: string; mime: string; checksum: string; size: number }
/** Tax identity keeps the TIN type and last four digits only; the full TIN stays inside the private W-9 original. */
export interface TaxIdentity { legal_name: string; tin_type: 'EIN' | 'SSN'; tin_last4: string; document: VendorDocument; received_by: Stamp; verification: 'W-9 received, TIN not checked with the IRS' }
export interface Vendor { compliance?: ComplianceRecord[]; renewal_requests?: RenewalRequest[]; id: string; version: number; kind: 'subcontractor' | 'vendor'; name: string; trades: string[]; service_areas: string[]; contacts: VendorContact[]; rates: VendorRate[]; qualifications: Qualification[]; tax?: TaxIdentity; history: { action: string; at: string; by: Stamp }[] }
/** What a bearer agent may read: no contacts, rates or tax identity. */
export type VendorSummary = Pick<Vendor, 'id' | 'version' | 'kind' | 'name' | 'trades' | 'service_areas' | 'qualifications'>

const list = (value: unknown, name: string, max: number, length: number) => {
 need(Array.isArray(value) && value.length <= max, `${name} must be a list of up to ${max}`)
 return [...new Set((value as unknown[]).map(v => text(v, name, length)))]
}
const identity = (value: unknown) => value === undefined ? crypto.randomUUID() : text(value, 'id', 100)
const date = (value: unknown, name: string) => { const d = text(value, name, 10); need(/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d, `${name} must be a calendar date (YYYY-MM-DD)`); return d }
function contact(value: unknown): VendorContact {
 const input = object(value), email = text(input.email, 'contact email', 254, true).toLowerCase(), phone = text(input.phone, 'contact phone', 40, true), e164 = phone ? nanp(phone) : null
 need(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Provide a valid contact email')
 return { id: identity(input.id), name: text(input.name, 'contact name', 200), email, phone, ...(e164 ? { phone_e164: e164 } : {}) }
}
export const currentQualification = (vendor: Vendor, trade: string) => vendor.qualifications.filter(q => q.trade.toLowerCase() === trade.toLowerCase()).at(-1)
export const summary = ({ id, version, kind, name, trades, service_areas, qualifications }: Vendor): VendorSummary => ({ id, version, kind, name, trades, service_areas, qualifications: qualifications.map(({ evidence: _evidence, ...q }) => ({ ...q, evidence: '' })) })

export function vendorFields(vendor: Vendor | undefined, input: Input, actor: Actor): Vendor {
 const kind = input.kind ?? vendor?.kind
 need(kind === 'subcontractor' || kind === 'vendor', 'kind must be subcontractor or vendor')
 const contacts = input.contacts === undefined ? vendor?.contacts ?? [] : (need(Array.isArray(input.contacts) && input.contacts.length <= 50, 'Up to 50 contacts'), (input.contacts as unknown[]).map(contact))
 need(new Set(contacts.map(c => c.id)).size === contacts.length, 'Contact ids must be unique')
 return { id: vendor?.id ?? crypto.randomUUID(), version: vendor?.version ?? 0, kind, name: text(input.name ?? vendor?.name, 'company name', 200),
  trades: input.trades === undefined ? vendor?.trades ?? [] : list(input.trades, 'trade', 20, 80),
  service_areas: input.service_areas === undefined ? vendor?.service_areas ?? [] : list(input.service_areas, 'service area', 50, 100),
  contacts, rates: vendor?.rates ?? [], qualifications: vendor?.qualifications ?? [], ...(vendor?.tax ? { tax: vendor.tax } : {}),
  history: [...vendor?.history ?? [], { action: vendor ? 'updated' : 'created', at: new Date().toISOString(), by: stamp(actor) }] }
}
export function addRate(vendor: Vendor, input: Input, actor: Actor): VendorRate {
 need(input.human_reviewed === true, 'Confirm that a person reviewed the rate source')
 const rate: VendorRate = { id: crypto.randomUUID(), description: text(input.description, 'rate description', 200), unit: text(input.unit, 'rate unit', 40), cents: cents(input.cents, 'rate cents'), effective_on: date(input.effective_on, 'effective date'), reference: text(input.reference, 'rate source reference', 200), reviewed_by: stamp(actor) }
 vendor.rates.push(rate); vendor.history.push({ action: 'rate.recorded', at: rate.reviewed_by.at, by: rate.reviewed_by }); return rate
}
/** A person records each qualification decision; later decisions append, so the latest per trade is current. */
export function qualify(vendor: Vendor, input: Input, actor: Actor): Qualification {
 const trade = text(input.trade, 'trade', 80)
 need(vendor.trades.some(t => t.toLowerCase() === trade.toLowerCase()), 'Add the trade to the company before qualifying it')
 need(input.status === 'qualified' || input.status === 'rejected', 'status must be qualified or rejected')
 const row: Qualification = { id: crypto.randomUUID(), trade, status: input.status, evidence: text(input.evidence, 'qualification evidence', 2000), reviewed_by: stamp(actor) }
 vendor.qualifications.push(row); vendor.history.push({ action: `qualification.${row.status}`, at: row.reviewed_by.at, by: row.reviewed_by }); return row
}
export function documentBytes(value: unknown, label = "The W-9") {
 need(typeof value === 'string' && value.length > 0 && value.length <= 2_796_204 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), 'Invalid base64 document')
 let raw = ''; try { raw = atob(value) } catch { need(false, 'Invalid base64 document') }
 need(btoa(raw) === value, 'Document base64 must be canonical')
 const bytes = Uint8Array.from(raw, c => c.charCodeAt(0)); need(bytes.length > 0 && bytes.length <= 2_097_152, `${label} must be at most 2 MB`)
 const head = new TextDecoder().decode(bytes.slice(0, 5))
 const mime = head === '%PDF-' ? 'application/pdf' : bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10' ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : ''
 need(mime, `${label} must be a PDF, PNG or JPEG file`)
 return { bytes, mime }
}
export function taxIdentity(input: Input, actor: Actor) {
 need(input.tin === undefined, 'Plinth does not store a full TIN; it stays inside the W-9 document. Send tin_last4 only.')
 need(input.tin_type === 'EIN' || input.tin_type === 'SSN', 'tin_type must be EIN or SSN')
 const last4 = text(input.tin_last4, 'tin_last4', 4); need(/^\d{4}$/.test(last4), 'tin_last4 must be the last four digits')
 const file = object(input.document), name = text(file.name, 'document name', 240); need(!/[\x00-\x1f/\\]/.test(name), 'Invalid document name')
 const { bytes, mime } = documentBytes(file.base64)
 return { bytes, legal_name: text(input.legal_name, 'legal name', 200), tin_type: input.tin_type as TaxIdentity['tin_type'], tin_last4: last4, name, mime, received_by: stamp(actor) }
}
