import { requireJobManager } from './auth'
import { decisionDownload, decisionFiles } from './decision-files'
import { find, need, recordApproval, stamp, text, type Actor, type Input, type Job, type Order } from './model'
import { day } from './purchase-order-model'
import { roleOf } from './role-store'
import { presets } from './role-model'
import { teamGrant } from './team'
import { submittalCommitment, submittalFor, type Submittal, type SubmittalCycle, type SubmittalReviewer } from './submittal-model'

/** Review is limited to existing internal job managers, independently of permission to issue a monetary commitment. */
export async function submittalReviewers(db: D1Database, job: Job): Promise<SubmittalReviewer[]> {
 const people = await db.prepare("SELECT id,display_name,version,role FROM oa_operators WHERE status='active' AND role IN ('owner','admin')").all<{ id: string; display_name: string; version: number; role: string }>()
 const eligible: SubmittalReviewer[] = []
 for (const person of people.results) {
  const team = await teamGrant(db, person.id), grant = team?.grant
  let roleVersion = 0
  if (grant) {
   if (!grant.job_ids.includes(job.id)) continue
   if (grant.role === 'custom') {
    const custom = await roleOf(db, grant.role_id ?? '')
    if (!custom || !['admin','project_manager'].includes(presets[custom.role.copy_of].base) || !custom.role.financial_visible || !custom.role.permissions.documents.view || !custom.role.permissions.documents.approve || !custom.role.permissions.orders.view) continue
    roleVersion = custom.version
   } else if (grant.role !== 'project_manager') continue
  }
  eligible.push({ id: person.id, name: person.display_name, operator_version: person.version, team_version: team?.version ?? 0, role_version: roleVersion })
 }
 return eligible
}
const sameAuthority = (a: SubmittalReviewer, b: SubmittalReviewer) => a.id === b.id && a.operator_version === b.operator_version && a.team_version === b.team_version && a.role_version === b.role_version
export async function currentReviewer(db: D1Database, job: Job, cycle: SubmittalCycle) {
 const current = (await submittalReviewers(db, job)).find(p => p.id === cycle.reviewer.id)
 need(current && sameAuthority(current, cycle.reviewer), 'The designated reviewer authority changed; submit a new review cycle', 409, 'submittal_authority')
 return current
}
export function submittalAccess(actor: Actor, job: Job) {
 requireJobManager(actor)
 need(!actor.permissions || actor.team?.job_ids.includes(job.id), 'Submittal job not found', 404, 'not_found')
 need(!actor.permissions || actor.permissions.financial && actor.permissions.matrix.orders.view && actor.permissions.matrix.documents.view, 'Submittals require current document and financial order visibility', 403, 'forbidden')
}
async function submitCycle(db: D1Database, job: Job, actor: Actor, row: Submittal, input: Input) {
 const order = find(job.orders, row.order_id)
 need(order.status !== 'cancelled', 'A cancelled commitment cannot be submitted', 409, 'order_state')
 const reviewer = (await submittalReviewers(db, job)).find(p => p.id === input.reviewer_id)
 need(reviewer, 'Choose a current internal job manager as reviewer', 403, 'submittal_reviewer')
 need(typeof input.deviates === 'boolean', 'Explicitly state whether this product deviates from specified scope')
 const deviation = input.deviates ? text(input.deviation, 'Specified-scope deviation', 2000) : ''
 const id = crypto.randomUUID(), files = await decisionFiles(db, job, id, input.attachments)
 need(files.attachments.length > 0, 'Attach the original vendor package')
 const cycle: SubmittalCycle = { id, revision: row.cycles.length + 1, product_reference: text(input.product_reference, 'Exact product and vendor version', 300), required_on: day(input.required_on, 'Required review date'), specified_scope: text(input.specified_scope, 'Specified scope', 2000), deviation, reviewer, commitment: submittalCommitment(order, true), attachments: files.attachments, submitted_by: stamp(actor), annotations: [] }
 row.cycles.push(cycle)
 recordApproval(job, actor, 'submittal.submit', { id: row.id, prepared_by: row.created_by, revision: cycle.revision }, cycle)
 return files.writes
}
export async function submittalAction(db: D1Database, job: Job, actor: Actor, input: Input, id?: string, action?: string) {
 submittalAccess(actor, job)
 let row: Submittal, writes: D1PreparedStatement[] = []
 if (!id || action === 'resubmit' || action === 'release') need(actor.role === 'owner', 'Only the owner registers, routes or releases a required submittal', 403, 'forbidden')
 if (!id) {
  const order = find(job.orders, text(input.order_id, 'Commitment', 100))
  need(order.status === 'draft', 'Register the required submittal before issuing the commitment', 409, 'order_state')
  need(!submittalFor(job, order), 'This commitment already has a submittal register entry', 409, 'submittal_exists')
  row = { id: crypto.randomUUID(), title: text(input.title, 'Submittal title', 300), order_id: order.id, cycles: [], created_by: stamp(actor) }
  writes = await submitCycle(db, job, actor, row, input)
  ;(job.submittals ??= []).push(row)
 } else {
  row = find(job.submittals ?? [], id)
  const cycle = row.cycles.at(-1)!
  if (action === 'resubmit') {
   need(input.cycle_id === cycle.id, 'Resubmit from the current review cycle', 409, 'submittal_version')
   writes = await submitCycle(db, job, actor, row, input)
  } else {
   need(input.cycle_id === cycle.id, 'This is not the current vendor version', 409, 'submittal_version')
   if (action === 'release') {
    need(input.confirm === true, 'Explicitly confirm the exact approved product and commitment')
    const order = find(job.orders, row.order_id)
    need(input.order_id === row.order_id && input.product_reference === cycle.product_reference, 'The product or commitment does not match this review', 409, 'submittal_mismatch')
    order.submittal_release = { submittal_id: row.id, cycle_id: cycle.id, product_reference: cycle.product_reference, by: stamp(actor) }
    await requireSubmittalGate(db, job, order, true)
    recordApproval(job, actor, 'submittal.release', { id: row.id, prepared_by: row.created_by, revision: cycle.revision }, order.submittal_release)
   } else {
    need(!cycle.decision, 'A completed review cycle is immutable', 409, 'immutable')
    need(cycle.reviewer.id === actor.id, 'Only the designated reviewer decides or annotates this cycle', 403, 'submittal_reviewer')
    await currentReviewer(db, job, cycle)
    if (action === 'annotate') {
     const file = find(cycle.attachments, String(input.file_id))
     need(Number.isSafeInteger(input.page) && Number(input.page) >= 1, 'Use a positive original page number')
     cycle.annotations.push({ id: crypto.randomUUID(), file_id: file.id, page: Number(input.page), text: text(input.text, 'Review annotation', 2000), by: stamp(actor) })
    } else if (action === 'review') {
     need(input.confirm === true, 'Explicitly confirm the disposition for these exact originals')
     need(['approved','rejected','revise_resubmit'].includes(String(input.disposition)), 'Choose approved, rejected or revise and resubmit')
     need(submittalCommitment(find(job.orders, row.order_id), true) === cycle.commitment, 'Commitment terms changed; resubmit for current terms', 409, 'submittal_mismatch')
     cycle.decision = { disposition: input.disposition as 'approved' | 'rejected' | 'revise_resubmit', comment: text(input.comment, 'Review comments', 2000), by: stamp(actor) }
     recordApproval(job, actor, 'submittal.review', { id: row.id, prepared_by: cycle.submitted_by, revision: cycle.revision }, cycle)
    } else need(false, 'Unknown submittal action', 404, 'not_found')
   }
  }
 }
 return { record: row, writes }
}
/** Every procurement effect checks the register, so omitting a release token cannot bypass a required review. */
export async function requireSubmittalGate(db: D1Database, job: Job, order: Order, proposed = false, actor?: Actor) {
 const row = submittalFor(job, order)
 if (!row) { need(!order.submittal_release, 'The submittal register entry is missing', 409, 'submittal_missing'); return }
 need(!actor?.permissions || actor.team?.job_ids.includes(job.id), 'Submittal job not found', 404, 'not_found')
 const cycle = row.cycles.at(-1)!, release = order.submittal_release
 need(cycle.decision?.disposition === 'approved', 'The current submittal must be approved before procurement release', 409, 'submittal_unapproved')
 need(release?.submittal_id === row.id && release.cycle_id === cycle.id && release.product_reference === cycle.product_reference, 'Select the exact current approved vendor version before release', 409, 'submittal_version')
 need(cycle.commitment === submittalCommitment(order, proposed), 'Approval does not match these commitment terms', 409, 'submittal_mismatch')
 await currentReviewer(db, job, cycle)
}
export async function submittalFile(db: D1Database, job: Job, actor: Actor, id: string) {
 submittalAccess(actor, job)
 const files = (job.submittals ?? []).flatMap(s => s.cycles.flatMap(c => c.attachments))
 return decisionDownload(db, job, files, id)
}
