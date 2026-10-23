import type { Actor, Job } from './model'

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
