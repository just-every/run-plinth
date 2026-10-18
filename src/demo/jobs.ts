import type { Actor, Job } from '../plinth/model'
import { demoCalendar } from './calendar'
import { playJob } from './timeline'
import { alvarez } from './alvarez'
import { others } from './others'

// One remodeler's jobs, the same records the run site tells: Minnehaha
// Design-Build's Job 2214 (Ana Alvarez's second story in Linden Hills) and the
// other jobs on its Minneapolis map. Every date and stamp is Minneapolis time
// counted from the Monday of the week the demo starts, so the schedule is
// always current and each record agrees with the day it describes.
const team = (name: string, key: string): Actor => ({ id: `demo-person-${key}`, email: `${key}@minnehahabuild.example`, name, role: 'admin', version: 1 })

/** Build with Plinth's real domain commands; stabilise IDs before persisting. */
export async function demoJobs(db: D1Database, owner: Actor, now: Date): Promise<Job[]> {
  const calendar = demoCalendar(now)
  const agent: Actor = { id: 'demo-agent', email: 'agent@plinth.invalid', name: 'Plinth agent', role: 'agent', version: 1 }
  const people = { erik: owner, rosa: team('Rosa Delgado', 'rosa'), sam: team('Sam Becker', 'sam'), hannah: team('Hannah Olson', 'hannah'), agent }
  const fixed = new Set(Object.values(people).map(p => p.id))
  const result: Job[] = []
  for (const project of [alvarez(calendar), ...others(calendar)]) {
    const job = await playJob(db, project, people, calendar, result)
    // Replace every generated ID, including snapshot references, consistently.
    const ids = new Map<string, string>([[job.id, `demo-job-${project.key}`]])
    function identify(value: any) {
      if (!value || typeof value !== 'object') return
      if (typeof value.id === 'string' && !fixed.has(value.id) && value.id !== `demo-client-${project.key}` && !ids.has(value.id)) ids.set(value.id, `demo-${project.key}-${ids.size}`)
      Object.values(value).forEach(identify)
    }
    identify(job)
    result.push(JSON.parse(JSON.stringify(job), (_key, value) => typeof value === 'string' ? ids.get(value) ?? value : value) as Job)
  }
  return result
}
