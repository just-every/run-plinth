import { need, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
import { digest, period } from './cost-model'
import { periodSnapshot, requireOpenCostPeriod } from './cost-periods'
import { teamGrant } from './team'
import { roleOf } from './role-store'
import { presets } from './role-model'
export interface AccountingReview { id: string; period: string; months: number; opening_cash_cents: number; source_version: number; digest: string; reference: string; by: Stamp; snapshot: unknown }
export interface AccountingAuthority { accountant_id: string; granted_by: Stamp; reason: string; reviews: AccountingReview[] }
const parameters = (input: Input) => ({ period: period(input.period), months: input.months === undefined ? 3 : Number(input.months), opening_cash_cents: Number(input.opening_cash_cents ?? 0) })
const native = (job: Job, actor: Actor) => need(actor.role === 'bookkeeper' && job.accounting_authority?.accountant_id === actor.id, 'Only the owner-designated accountant account may review this period', 403, 'accountant_required')
export async function accountingRead(job: Job, actor: Actor, category: string | undefined, input: Input) {
 if (category === 'accountant') { need(actor.role === 'owner', 'Only the owner manages accountant authority', 403, 'forbidden'); return { authority: job.accounting_authority ?? null } }
 if (category !== 'period-preview') return null
 native(job, actor); const p = parameters(input); requireOpenCostPeriod(job, p.period); const snapshot = periodSnapshot(job, p.period, p)
 return { ...p, source_version: job.version, snapshot, digest: await digest(snapshot) }
}
export async function accountingWrite(db: D1Database, job: Job, actor: Actor, input: Input, category: string | undefined) {
 if (category === 'accountant') {
  need(actor.role === 'owner', 'Only the owner grants or revokes accountant authority', 403, 'forbidden')
  const id = input.accountant_id === null ? '' : text(input.accountant_id, 'Accountant account', 100)
  if (id) await currentAccountant(db,job,id)
  job.accounting_authority = { accountant_id: id, granted_by: stamp(actor), reason: text(input.reason, 'Authority evidence', 2000), reviews: job.accounting_authority?.reviews ?? [] }
  return job.accounting_authority
 }
 if (category !== 'period-reviews') return null
 native(job, actor); const p = parameters(input); requireOpenCostPeriod(job, p.period)
 const snapshot = periodSnapshot(job, p.period, p), hash = await digest(snapshot)
 need(input.confirm === true && input.digest === hash, 'Review and explicitly confirm the exact current period snapshot', 409, 'accountant_snapshot')
 const review: AccountingReview = { id: crypto.randomUUID(), ...p, source_version: job.version + 1, digest: hash, reference: text(input.reference, 'Accountant review evidence', 2000), by: stamp(actor), snapshot }
 job.accounting_authority!.reviews.push(review); return review
}
/** Owner recording remains separate from the accountant's authenticated review; stale or revoked reviews never close a period. */
export async function nativePeriodClose(db:D1Database, job: Job, actor: Actor, input: Input) {
 need(actor.role === 'owner', 'Only the owner records a period close', 403, 'forbidden')
 if (!input.native_review_id) return
 const review = job.accounting_authority?.reviews.find(r => r.id === input.native_review_id), p = parameters(input)
 need(review && review.by.id === job.accounting_authority!.accountant_id && review.source_version === job.version && review.period === p.period && review.months === p.months && review.opening_cash_cents === p.opening_cash_cents, 'Accountant review changed, was revoked or is stale; review the current snapshot again', 409, 'accountant_snapshot')
 await currentAccountant(db,job,review.by.id)
 input.accountant_approved = true; input.accountant_name = review.by.name; input.approval_reference = review.reference
}

async function currentAccountant(db:D1Database,job:Job,id:string){
 const person = await db.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role='admin'").bind(id).first(); need(person, 'Choose an active internal accountant account',403,'accountant_required')
 const grant=await teamGrant(db,id),custom=grant?.grant.role==='custom'?await roleOf(db,grant.grant.role_id??''):null,base=custom?presets[custom.role.copy_of].base:grant?.grant.role
 need(base==='bookkeeper'&&grant?.grant.job_ids.includes(job.id)&&(!custom||custom.role.financial_visible&&custom.role.permissions.reports.approve&&custom.role.permissions.budgets.view),'The accountant must still have assigned bookkeeper review access',403,'accountant_required')
}
