import { emptyJob, type Actor, type Job } from '../plinth/model'
import { acceptQuote, approveVariation, prepareQuote, prepareVariation } from '../plinth/quotes'
import { prepareSchedule, prepareOrder, issueOrder, receiveOrder } from '../plinth/operations'
import { prepareDiary } from '../plinth/attachments'
import { prepareClaim, approveClaim, exportClaim } from '../plinth/claims'
import type { Calendar, When } from './calendar'

/** Who does a step: a builder's person, the Plinth agent, or the job's client. */
export type Who = 'erik' | 'rosa' | 'sam' | 'hannah' | 'agent' | 'client'
type Lines = [description: string, unit_cents: number][]
/** What a step does, as one of Plinth's own commands. */
export type Action =
  | { do: 'quote'; lines: Lines; notes: string }
  | { do: 'accept'; method: string; evidence: string }
  | { do: 'book'; trade: string; work: string; from: number; to: number; hours?: [start: When[1], end: When[1]] }
  | { do: 'log'; note: string }
  | { do: 'change'; key: string; description: string; cents: number }
  | { do: 'sign'; key: string; carried?: string }
  | { do: 'order'; key: string; supplier: string; description: string; cents: number }
  | { do: 'issue'; key: string }
  | { do: 'receive'; key: string; cents: number; reference: string }
  | { do: 'bill'; key: string; description: string; cumulative: number }
  | { do: 'approve bill'; key: string }
  | { do: 'export bill'; key: string }
/** One thing that happened on a job, at a Minneapolis time. */
export type Step = { at: When; by: Who } & Action
export type Project = { key: string; name: string; client: string; email: string; address: string; steps: Step[] }

/**
 * Play a job's steps in time order, up to now, through Plinth's domain
 * commands. Each step's new stamps read the step's own time, so every record
 * agrees with the calendar it describes. Steps after now have not happened yet.
 */
export async function playJob(db: D1Database, project: Project, people: Record<Exclude<Who, 'client'>, Actor>, calendar: Calendar, others: Job[]): Promise<Job> {
  const client: Actor = { id: `demo-client-${project.key}`, email: project.email, name: project.client, role: 'member', version: 1 }
  const actor = (who: Who) => who === 'client' ? client : people[who]
  const steps = project.steps.map((step, order) => ({ step, time: calendar.at(step.at), order })).filter(s => s.time <= calendar.now).sort((a, b) => a.time - b.time || a.order - b.order)
  const job = emptyJob({ name: project.name, client_email: client.email, address: project.address }, actor(steps[0]!.step.by))
  const keyed = new Map<string, string>(), stamped = new WeakSet<object>()
  const stampAll = (iso: string) => { const walk = (value: any) => { if (!value || typeof value !== 'object') return; if (typeof value.at === 'string' && typeof value.role === 'string' && !stamped.has(value)) { value.at = iso; stamped.add(value) } Object.values(value).forEach(walk) }; walk(job) }
  const shift = (day: number, hour: number, minute = 0) => new Date(calendar.at([day, hour, minute])).toISOString()
  for (const { step, time } of steps) {
    const by = actor(step.by)
    switch (step.do) {
      case 'quote': prepareQuote(job, by, { lines: step.lines.map(([description, unit_cents]) => ({ description, quantity: 1, unit_cents })), notes: step.notes }); break
      case 'accept': acceptQuote(job, by, job.quotes.at(-1)!.id, { method: step.method, evidence: step.evidence }); break
      case 'book': { const [start, end] = step.hours ?? [7, 15.5]; prepareSchedule(job, by, { trade: step.trade, description: step.work, start: shift(step.from, Math.floor(start), (start % 1) * 60), end: shift(step.to, Math.floor(end), (end % 1) * 60) }, [...others, job]); break }
      case 'log': await prepareDiary(db, job, by, { date: calendar.date(step.at[0]), note: step.note }); break
      case 'change': keyed.set(step.key, prepareVariation(job, by, { description: step.description, amount_cents: step.cents }).id); break
      case 'sign': approveVariation(job, by, keyed.get(step.key)!, step.carried); break
      case 'order': keyed.set(step.key, prepareOrder(job, by, { supplier: step.supplier, description: step.description, amount_cents: step.cents }).id); break
      case 'issue': issueOrder(job, by, keyed.get(step.key)!); break
      case 'receive': receiveOrder(job, by, keyed.get(step.key)!, { amount_cents: step.cents, reference: step.reference }); break
      case 'bill': keyed.set(step.key, prepareClaim(job, by, { description: step.description, cumulative_cents: step.cumulative }).id); break
      case 'approve bill': approveClaim(job, by, keyed.get(step.key)!); break
      case 'export bill': exportClaim(job, by, keyed.get(step.key)!, new Date(time).toISOString().slice(0, 10)); break
    }
    stampAll(new Date(time).toISOString())
  }
  return job
}
