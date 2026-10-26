import type { Bindings } from '../auth.server'
import { need, type Actor, type Input } from './model'
import { jobs, readClock, saveJob } from './store'
import { requestMeetingEmail } from './meeting-share-mail'
import { meetingShareFeedback, projectMeetingShares } from './meeting-sharing'
import type { MeetingSharingJob } from './meeting-sharing-model'
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const json = (value: unknown) => Response.json(value, { headers })
/** A named extract grant is independent of client, field and subcontractor record-browsing doors. */
export async function meetingInboxResponse(request: Request, env: Bindings, actor: Actor, parts: string[], body: (request: Request) => Promise<Input>) {
 if (parts[0] !== 'meeting-inbox') return null
 need(actor.role !== 'agent', 'A signed-in person reads shared meeting decisions', 403, 'human_required')
 const clock = await readClock(env.DB), all = await jobs(env.DB) as MeetingSharingJob[]
 const visible = []
 for (const job of all) {
  if (parts[1] && job.id !== parts[1]) continue
  const shares = await projectMeetingShares(env.DB, job, actor)
  if (shares.length) visible.push({ job, shares })
 }
 if (parts.length === 1 && request.method === 'GET') return json({ jobs: visible.map(({ job, shares }) => ({ id: job.id, name: job.name, version: job.version, shares })) })
 const entry = visible.find(row => row.job.id === parts[1]); need(entry, 'Meeting extract not found', 404, 'not_found')
 if (parts.length === 2 && request.method === 'GET') return json({ job_id: entry.job.id, version: entry.job.version, shares: entry.shares })
 if (parts.length === 3 && parts[2] === 'decision-search' && request.method === 'GET') {
  const params = new URL(request.url).searchParams, query = (params.get('q') ?? '').toLowerCase(), source = params.get('source')
  need(query.length <= 200, 'Search filters are limited to 200 characters')
  const results = entry.shares.filter(s => !('revocation' in s && s.revocation) && (!source || source === 'meeting-extracts:' + s.id) && (!query || [s.title,s.body].join('\n').toLowerCase().includes(query))).map(s => ({ source:'meeting-extracts:'+s.id,title:s.title,text:s.body,sender:s.by.name,tags:[],sheet:'',cost_code:'',href:`/api/plinth/meeting-inbox/${entry.job.id}/${s.id}/export.json` }))
  return json({results,count:results.length})
 }
 const share = entry.shares.find(row => row.id === parts[2]); need(share, 'Meeting extract not found', 404, 'not_found')
 if (parts.length === 4 && parts[3] === 'export.json' && request.method === 'GET') return new Response(JSON.stringify(share), { headers: { ...headers, 'content-type': 'application/json', 'content-disposition': 'attachment; filename=meeting-extract.json' } })
 if (parts.length === 4 && ['feedback','email-copy'].includes(parts[3]!) && request.method === 'POST') {
  const input = await body(request); need(input.expected_version === entry.job.version, 'The shared meeting changed; reload before commenting', 409, 'stale_version')
  const next = structuredClone(entry.job), record = parts[3]==='feedback' ? await meetingShareFeedback(env.DB, next, actor, input, parts[2]!) : await requestMeetingEmail(env.DB,next,actor,input,parts[2]!)
  await saveJob(env.DB, actor, entry.job, next, [], clock)
  return json({ record, version: next.version, shares: await projectMeetingShares(env.DB, next, actor) })
 }
 need(false, 'Unknown shared meeting route', 404, 'not_found')
}
