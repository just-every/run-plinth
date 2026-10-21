import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize, requireJobManager } from './auth'
import { decisionDownload } from './decision-files'
import { need } from './model'
import { jobRequest } from './job-request'
import { jobOf, readClock, saveJob } from './store'
import { handoverAction } from './handover-actions'
import { handoverClient, handoverState, type HandoverJob } from './handover-model'

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
export async function handoverResponse(request: Request, original: Bindings): Promise<Response | null> {
 const url = new URL(request.url), match = /^\/api\/plinth\/jobs\/([^/]+)\/handover(?:\/(.*))?$/.exec(url.pathname)
 if (!match) return null
 const env = runtimeBindings(original), actor = await authorize(request, env), clock = await readClock(env.DB), previous: HandoverJob = await jobOf(env.DB, actor, match[1]!), parts = match[2]?.split('/') ?? []
 need(actor.role !== 'agent', 'Handover requires a signed-in person', 403, 'human_required')
 const state = actor.role === 'member' ? handoverClient(previous) : handoverState(previous)
 if (request.method === 'GET') {
  if (parts[0] === 'files' && parts.length === 2) {
   const files = [...state.documents.flatMap(d => d.revisions.map(r => r.file)), ...state.packages.flatMap(p => p.documents.map(d => d.source.file))]
   return decisionDownload(env.DB, previous, files, parts[1]!)
  }
  need(!parts.length, 'Unknown handover route', 404, 'not_found')
  const words = (url.searchParams.get('q') ?? '').toLowerCase(), packages = state.packages.filter(p => !words || JSON.stringify(p).toLowerCase().includes(words))
  return json({ job_id: previous.id, version: previous.version, name: previous.name, documents: state.documents, packages })
 }
 need(request.method === 'POST', 'Method not allowed', 405, 'method_not_allowed')
 if (actor.role !== 'member') requireJobManager(actor)
 need(parts[0] === 'documents' && (parts.length === 1 || parts.length === 2) || parts[0] === 'packages' && (parts.length === 1 || parts.length === 3), 'Unknown handover action', 404, 'not_found')
 const input = await jobRequest(request)
 need(input.expected_version === previous.version, 'Job changed. Reload before applying handover changes.', 409, 'stale_version')
 const job = structuredClone(previous), result = await handoverAction(env.DB, job, actor, input, parts[0], parts[1], parts[2])
 await saveJob(env.DB, actor, previous, job, result.writes, clock)
 return json({ record: result.record, version: job.version })
}
