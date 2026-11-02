import { projectRawMeetings } from './meeting-raw-grants'
import { ownMeetingActions, completeMeetingDelegate, meetingWorkChoices } from './meetings'
import { assignedJob } from './auth'
import { clientAccess } from './job-customers'
import type { Bindings } from '../auth.server'
import { need, type Actor, type Input, type Job } from './model'
import { jobs, readClock, saveJob } from './store'
import { requestMeetingEmail } from './meeting-share-mail'
import { meetingShareFeedback, projectMeetingShares } from './meeting-sharing'
import type { MeetingSharingJob } from './meeting-sharing-model'
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const json = (value: unknown) => Response.json(value, { headers })
/** A named extract grant is independent of client, field and subcontractor record-browsing doors. */
export async function meetingInboxResponse(request: Request, env: Bindings, actor: Actor, parts: string[], body: (request: Request) => Promise<Input>, project: (job: Job, actor: Actor) => Job) {
 if (parts[0] !== 'meeting-inbox') return null
 need(actor.role !== 'agent', 'A signed-in person reads shared meeting decisions', 403, 'human_required')
 const clock = await readClock(env.DB), all = await jobs(env.DB) as MeetingSharingJob[]
 const visible = []
 for (const job of all) {
  if (parts[1] && job.id !== parts[1]) continue
  const shares = await projectMeetingShares(env.DB, job, actor)
  const actions = await ownMeetingActions(env.DB, job, actor)
  const raw_meetings = await projectRawMeetings(env.DB, job, actor)
  if (shares.length || actions.length || raw_meetings.length) visible.push({ job, shares, actions, raw_meetings })
 }
 if (parts.length === 1 && request.method === 'GET') return json({ jobs: visible.map(({ job, shares, actions, raw_meetings }) => ({ id: job.id, name: job.name, version: job.version, shares, actions, raw_meetings })) })
 const entry = visible.find(row => row.job.id === parts[1]); need(entry, 'Meeting extract not found', 404, 'not_found')
 const canReadJob = actor.role === 'member' ? await clientAccess(env.DB, entry.job, actor.email) : assignedJob(actor, entry.job)
 const permitted = canReadJob ? project(entry.job, actor) : { ...entry.job, schedules: [], diary: [], variations: [], selections: [], rfis: [] }
 if (parts.length === 2 && request.method === 'GET') return json({ job_id: entry.job.id, version: entry.job.version, shares: entry.shares, actions: entry.actions, raw_meetings: entry.raw_meetings, work: meetingWorkChoices(permitted) })
 if (parts.length === 5 && parts[2] === 'actions' && parts[4] === 'complete' && request.method === 'POST') {
  const input = await body(request); need(input.expected_version === entry.job.version, 'The meeting action changed; reload before completing', 409, 'stale_version')
  const next = structuredClone(entry.job), writes = await completeMeetingDelegate(env.DB, next, actor, input, parts[3]!, permitted)
  await saveJob(env.DB, actor, entry.job, next, writes, clock)
  return json({ version: next.version, actions: await ownMeetingActions(env.DB, next, actor) })
 }
 if (parts.length === 3 && parts[2] === 'decision-search' && request.method === 'GET') {
  const params = new URL(request.url).searchParams, query = (params.get('q') ?? '').toLowerCase(), source = params.get('source')
  need(query.length <= 200, 'Search filters are limited to 200 characters')
  const results = entry.shares.filter(s => !('revocation' in s && s.revocation) && (!source || source === 'meeting-extracts:' + s.id) && (!query || [s.title,s.body].join('\n').toLowerCase().includes(query))).map(s => ({ source:'meeting-extracts:'+s.id,title:s.title,text:s.body,sender:s.by.name,tags:[],sheet:'',cost_code:'',href:`/api/plinth/meeting-inbox/${entry.job.id}/${s.id}/export.json` }))
  for (const m of entry.raw_meetings) {
   const text = [m.agenda,m.minutes,m.decisions,...m.actions.map(a=>[a.title,a.completion?.answer].join('\n'))].join('\n')
   if ((!source || source === 'meetings:'+m.id) && (!query || [m.title,text].join('\n').toLowerCase().includes(query))) results.push({source:'meetings:'+m.id,title:m.title,text,sender:m.by.name,tags:m.tags,sheet:m.sheet,cost_code:m.cost_code,href:`/api/plinth/jobs/${entry.job.id}/meetings/${m.id}/export.json`})
  }
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
