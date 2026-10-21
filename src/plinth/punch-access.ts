import { scopeContact } from './scope-contacts'
import { evaluate, rules, today } from './compliance'
import { getVendor } from './vendors'
import { currentQualification } from './vendor-model'
import { need, type Actor } from './model'
import { punchClientProjection, punchState, type PunchIssue, type PunchJob } from './punch-model'

export const punchOffice = (actor: Actor) => actor.role === 'owner' || actor.role === 'admin'
export function requirePunchOffice(actor: Actor) { need(punchOffice(actor), 'Only the owner or an administrator manages punch observations', 403, 'forbidden') }
export function requirePunchManager(actor: Actor) { need(punchOffice(actor) || actor.role === 'project_manager', 'Job manager access required', 403, 'forbidden') }
/** Scope release, current contact membership, qualification and current compliance are all needed; a historic assignment is never an enduring grant. */
export async function punchScope(db: D1Database, job: PunchJob, email: string, scopeId: string | undefined) {
 const scope = await scopeContact(db, job, email, scopeId)
 if (!scope) return undefined
 const vendor = await getVendor(db, scope.vendor_id)
 if (currentQualification(vendor, scope.trade)?.status !== 'qualified' || evaluate(vendor, scope.trade, await rules(db), await today(db)).holds.length) return undefined
 return scope
}
export async function punchTradeIssues(db: D1Database, job: PunchJob, actor: Actor): Promise<PunchIssue[]> {
 const visible: PunchIssue[] = []
 for (const row of punchState(job).issues) if (row.assignment?.email === actor.email.toLowerCase() && await punchScope(db, job, actor.email, row.assignment.subcontract_id)) visible.push(row)
 return visible
}
export async function punchProjection(db: D1Database, job: PunchJob, actor: Actor, portal = false) {
 if (actor.role !== 'member') return punchState(job)
 if (!portal) return punchClientProjection(job)
 // Assignment history may contain another company's contact. Each trade sees the observation and immutable repairs, with current contact only.
 return { forms: [], issues: (await punchTradeIssues(db, job, actor)).map(i => ({ ...i, assignments: [] })) }
}
