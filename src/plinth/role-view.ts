import type { Actor, Job } from './model'
import type { Feature } from './role-model'
import { projectEstimateCosts } from './estimate-report'

/**
 * ROLE-002: what a job shows an estimator, superintendent or crew member. The view is built from an allow-list, so a
 * record added to Job later (billing, margins, pay, client contact) is hidden from these presets until it is named here.
 * Hidden collections stay as empty lists so every screen reads the same shape as the client view does.
 */
const keep = (job: Job, keys: string[]) => Object.fromEntries(keys.filter(key => (job as unknown as Record<string, unknown>)[key] !== undefined).map(key => [key, (job as unknown as Record<string, unknown>)[key]]))
const scheduleKeys = (job: Job) => Object.keys(job).filter(key => key.startsWith('schedule_'))
const empty = { quotes: [], schedules: [], diary: [], variations: [], orders: [], claims: [], approvals: [] }
export function roleJobView(job: Job, actor: Actor): Job {
 const identity = { id: job.id, version: job.version, name: job.name, address: job.address, status: job.status, created_by: job.created_by, ...(job.time_zone ? { time_zone: job.time_zone } : {}), ...(job.currency ? { currency: job.currency } : {}) }
 if (actor.role === 'estimator') return { ...empty, ...identity, client_email: job.client_email, ...(job.client_name ? { client_name: job.client_name } : {}), quotes: job.quotes, ...keep(job, ['takeoff', 'products', 'bids', 'bid_comparisons', 'bid_cost_adjustments']) } as Job
 const crew = actor.role === 'crew'
 return { ...empty, ...identity, client_email: '', schedules: job.schedules.filter(task => !crew || task.status === 'booked'), diary: job.diary.filter(entry => !crew || entry.status === 'published'), ...keep(job, [...scheduleKeys(job), 'schedule_constraints', 'takeoff', 'punch']) } as Job
}

/**
 * ROLE-006: a custom role's job view follows its view switches, whichever preset it copied. Collections a role may not view are
 * empty or absent; without financial visibility, cost, margin, markup, pricing, budgets and approval snapshots (which carry prices) go too.
 */
export function permissionView(job: Job, actor: Actor): Job {
 const p = actor.permissions!, can = (feature: Feature) => p.matrix[feature].view, out = { ...job } as unknown as Record<string, unknown>
 const drop = (...keys: string[]) => { for (const key of keys) delete out[key] }
 if (!can('estimates')) { out.quotes = []; drop('takeoff', 'products', 'bids', 'bid_comparisons', 'bid_cost_adjustments', 'bid_comparison_awards') }
 if (!can('budgets') || !p.financial) drop('budgets')
 if (!can('orders')) { out.orders = []; drop('subcontracts', 'portal_submissions') }
 if (!can('changes')) out.variations = []
 if (!can('selections')) drop('selections')
 if (!can('schedule')) { out.schedules = []; drop(...Object.keys(job).filter(key => key.startsWith('schedule_')), 'trade_invitations') }
 if (!can('logs')) out.diary = []
 if (!can('documents')) drop('rfis', 'rfi_access', 'punch', 'handover', 'warranties', 'continuity')
 if (!can('invoices')) { out.invoices = []; out.claims = []; drop('remittances', 'retainage', 'retainage_balance', 'sov', 'invoice_deposit_liability_cents') }
 if (!can('company')) drop('customer_id', 'property_id', 'client_contact_ids', 'portal_features', 'portal_policy', 'import_evidence')
 if (!can('leads') && !can('estimates') && !can('invoices')) { out.client_email = ''; drop('client_name') }
 drop('todos')
 if (!p.financial) { out.quotes = projectEstimateCosts(out.quotes); out.approvals = []; out.claims = (out.claims as Job['claims']).map(claim => ({ ...claim, sov: undefined })) }
 return out as unknown as Job
}
