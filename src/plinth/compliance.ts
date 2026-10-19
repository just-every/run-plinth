import { requireOwner } from './auth'
import { company } from './company'
import { cents, need, object, stamp, text, type Actor, type Input, type Stamp } from './model'
import { readClock, transaction } from './store'
import { wallClock } from './time-zone'
import type { Vendor, VendorDocument } from './vendor-model'

export const KINDS = ['general_liability', 'workers_comp', 'auto_liability', 'umbrella', 'license'] as const
export type ComplianceKind = typeof KINDS[number]
/** Received evidence. Uploading it never verifies coverage: only a designated reviewer's recorded decision does. */
export interface ComplianceRecord { id: string; kind: ComplianceKind; issuer: string; reference: string; limit_cents?: number; endorsements: string[]; effective_on: string; expires_on: string; document: VendorDocument; received_by: Stamp; review?: { decision: 'verified' | 'rejected'; note: string; by: Stamp } }
export interface RenewalRequest { id: string; kind: ComplianceKind; problem: Problem; job_id: string; prepared_at: string; delivery: 'Prepared, not sent: Plinth has no subcontractor mail connection yet' }
export interface Requirement { trade: string; kind: ComplianceKind; min_limit_cents?: number; enforcement: 'hold' | 'flag' }
export interface ComplianceRules { version: number; reviewers: string[]; requirements: Requirement[]; updated_by?: Stamp }
export type Problem = 'missing' | 'expired' | 'not_yet_effective' | 'unverified' | 'rejected' | 'below_limit'
export interface Issue { kind: ComplianceKind; problem: Problem }
export interface ComplianceCheck { checked_on: string; holds: Issue[]; flags: Issue[] }

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const empty: ComplianceRules = { version: 0, reviewers: [], requirements: [] }
const kind = (value: unknown): ComplianceKind => { need(KINDS.includes(value as ComplianceKind), `kind must be one of ${KINDS.join(', ')}`); return value as ComplianceKind }
const day = (value: unknown, name: string) => { const d = text(value, name, 10); need(/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d, `${name} must be a calendar date (YYYY-MM-DD)`); return d }
export async function rules(db: D1Database): Promise<ComplianceRules> {
 const row = await db.prepare('SELECT data FROM pl_compliance_rules WHERE id=1').first<{ data: string }>()
 return row ? JSON.parse(row.data) as ComplianceRules : empty
}
/** Today is the calendar date in the company time zone (UTC before company setup). */
export async function today(db: D1Database) { return wallClock(Date.now(), (await company(db))?.time_zone ?? 'UTC').date }

export function complianceRecord(input: Input, actor: Actor, document: VendorDocument): ComplianceRecord {
 const effective_on = day(input.effective_on, 'effective date'), expires_on = day(input.expires_on, 'expiry date')
 need(expires_on >= effective_on, 'The expiry date cannot precede the effective date')
 need(input.endorsements === undefined || Array.isArray(input.endorsements) && input.endorsements.length <= 20, 'endorsements must be a list')
 need(input.verified === undefined, 'Uploading evidence never verifies it; a designated reviewer records that decision')
 return { id: document.id, kind: kind(input.kind), issuer: text(input.issuer, 'carrier or licensing authority', 200), reference: text(input.reference, 'policy or license number', 100), ...(input.limit_cents === undefined ? {} : { limit_cents: cents(input.limit_cents, 'limit_cents') }), endorsements: ((input.endorsements ?? []) as unknown[]).map(e => text(e, 'endorsement', 200)), effective_on, expires_on, document, received_by: stamp(actor) }
}
/** Owners always review; administrators only when the owner names them in the rules. */
export function review(record: ComplianceRecord, input: Input, actor: Actor, current: ComplianceRules) {
 need(actor.role === 'owner' || actor.role === 'admin' && current.reviewers.includes(actor.email.toLowerCase()), 'Only the owner or a designated compliance reviewer records this decision', 403, 'forbidden')
 need(!record.review, 'This evidence already has a decision; upload new evidence to change it', 409, 'immutable')
 need(input.decision === 'verified' || input.decision === 'rejected', 'decision must be verified or rejected')
 record.review = { decision: input.decision, note: text(input.note, 'review note', 2000), by: stamp(actor) }
 return record.review
}
/** A requirement is met by verified evidence of its kind in force on the date (effective and expiry dates inclusive) at or above any minimum limit. */
export function evaluate(vendor: Vendor, trade: string, current: ComplianceRules, on: string): ComplianceCheck {
 const holds: Issue[] = [], flags: Issue[] = []
 for (const r of current.requirements.filter(r => r.trade === '*' || r.trade.toLowerCase() === trade.toLowerCase())) {
  const records = (vendor.compliance ?? []).filter(c => c.kind === r.kind)
  const good = (c: ComplianceRecord) => c.review?.decision === 'verified' && c.effective_on <= on && on <= c.expires_on && (r.min_limit_cents === undefined || (c.limit_cents ?? 0) >= r.min_limit_cents)
  if (records.some(good)) continue
  const latest = records.at(-1)
  const problem: Problem = !latest ? 'missing' : latest.expires_on < on ? 'expired' : latest.effective_on > on ? 'not_yet_effective' : latest.review?.decision === 'rejected' ? 'rejected' : !latest.review ? 'unverified' : 'below_limit'
  ;(r.enforcement === 'hold' ? holds : flags).push({ kind: r.kind, problem })
 }
 return { checked_on: on, holds, flags }
}
/** Missing, expired or rejected evidence prepares one renewal request per kind and job; it is never reported as sent. */
export function renewalRequests(vendor: Vendor, check: ComplianceCheck, jobId: string): boolean {
 let added = false
 for (const issue of [...check.holds, ...check.flags].filter(i => ['missing', 'expired', 'rejected', 'below_limit'].includes(i.problem))) {
  if ((vendor.renewal_requests ??= []).some(r => r.kind === issue.kind && r.job_id === jobId && r.problem === issue.problem)) continue
  vendor.renewal_requests.push({ id: crypto.randomUUID(), kind: issue.kind, problem: issue.problem, job_id: jobId, prepared_at: new Date().toISOString(), delivery: 'Prepared, not sent: Plinth has no subcontractor mail connection yet' }); added = true
 }
 return added
}
export async function rulesResponse(request: Request, db: D1Database, actor: Actor, parts: string[], readBody: (request: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'compliance-rules') return null
 need(parts.length === 1, 'Unknown compliance route', 404, 'not_found')
 need(actor.role === 'owner' || actor.role === 'admin', 'Builder manager access required', 403, 'forbidden')
 if (request.method === 'GET') return Response.json({ rules: await rules(db) }, { headers })
 need(request.method === 'PUT', 'Method not allowed', 405, 'method_not_allowed'); requireOwner(actor)
 const input = object(await readBody(request)), clock = await readClock(db), previous = await rules(db)
 need(input.expected_version === previous.version, 'Compliance rules changed; reload before saving', 409, 'stale_version')
 need(Array.isArray(input.requirements) && input.requirements.length <= 100 && Array.isArray(input.reviewers) && input.reviewers.length <= 20, 'Send requirements and reviewers lists')
 const requirements = (input.requirements as unknown[]).map(value => { const r = object(value); need(r.enforcement === 'hold' || r.enforcement === 'flag', 'enforcement must be hold or flag'); return { trade: text(r.trade, 'trade (or * for every trade)', 80), kind: kind(r.kind), ...(r.min_limit_cents === undefined ? {} : { min_limit_cents: cents(r.min_limit_cents, 'min_limit_cents') }), enforcement: r.enforcement } as Requirement })
 const reviewers = [...new Set((input.reviewers as unknown[]).map(e => text(e, 'reviewer email', 254).toLowerCase()))]
 const next: ComplianceRules = { version: previous.version + 1, reviewers, requirements, updated_by: stamp(actor) }, data = JSON.stringify(next)
 await transaction(db, actor, null, [previous.version ? db.prepare('UPDATE pl_compliance_rules SET version=?,data=? WHERE id=1 AND version=?').bind(next.version, data, previous.version) : db.prepare('INSERT INTO pl_compliance_rules(id,version,data) VALUES(1,?,?)').bind(next.version, data)], clock)
 return Response.json({ rules: next }, { headers })
}
