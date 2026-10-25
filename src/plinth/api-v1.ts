import { apiLimit } from './api-limits'
import schema from './api-schema.json'
import { requireJobManager } from './auth'
import { DomainError, need, type Actor, type Input, type Job } from './model'
import { jobOf, jobs, readClock, saveJob } from './store'
import { jobRef } from './audit'
import { prepareVariation } from './quotes'
import type { Bindings } from '../auth.server'

const summary = (job: Job) => ({id: job.id, version: job.version, name: job.name, status: job.status})
const draft = (row: Job['variations'][number]) => ({id: row.id, description: row.description, amount_cents: row.amount_cents, status: row.status})
const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'cache-control': 'no-store', 'plinth-api-version': '1', 'x-ratelimit-limit': '60'}})
export async function apiV1Response(request: Request, env: Bindings, actor: Actor, parts: string[], body: (request: Request) => Promise<Input>, dispatch: (request: Request) => Promise<Response>): Promise<Response | null> {
 if (parts[0] !== 'v1') return null
 const db = env.DB, method = request.method, url = new URL(request.url)
 if (parts[1] === 'connections') {
  url.pathname = '/api/plinth/'+parts.slice(1).join('/')
  return dispatch(new Request(url, request))
 }
 await apiLimit(db, actor)
 if (parts.length === 2 && parts[1] === 'openapi.json' && method === 'GET') return json(schema)
 if (parts.length === 2 && parts[1] === 'jobs' && method === 'GET') {
  const limit = Number(url.searchParams.get('limit') ?? '50'), after = url.searchParams.get('after') ?? ''
  need(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'limit must be an integer from 1 to 100')
  const allowed: Job[] = []
  for (const job of (await jobs(db)).sort((a,b) => a.id.localeCompare(b.id))) {
   if (job.id <= after) continue
   try { await jobOf(db, actor, job.id); allowed.push(job) } catch (error) { if (!(error instanceof DomainError) || error.status !== 404) throw error }
   if (allowed.length > limit) break
  }
  const page = allowed.slice(0, limit)
  return json({jobs: page.map(summary), next: allowed.length > limit ? page.at(-1)!.id : null})
 }
 if (parts[1] === 'jobs' && parts[2]) {
  if (parts.length === 3 && method === 'GET') return json({job: summary(await jobOf(db, actor, parts[2]))})
  if (parts.length === 4 && parts[3] === 'changes' && method === 'POST') {
   requireJobManager(actor, true)
   const input = await body(request), operationKey = request.headers.get('idempotency-key') ?? ''
   need(/^[A-Za-z0-9._-]{1,128}$/.test(operationKey), 'Send an Idempotency-Key of 1 to 128 safe characters')
   const hash = await jobRef(JSON.stringify({job_id: parts[2], expected_version: input.expected_version, description: input.description, amount_cents: input.amount_cents}))
   const replay = async () => {
    const previous = await db.prepare('SELECT * FROM pl_api_requests WHERE operator_id=? AND operation_key=?').bind(actor.id, operationKey).first<{request_hash: string; job_id: string; record_id: string}>()
    if (!previous) return null
    need(previous.request_hash === hash, 'This idempotency key was used with a different request', 409, 'idempotency_conflict')
    const job = await jobOf(db, actor, previous.job_id), record = job.variations.find(row => row.id === previous.record_id)
    need(record, 'Draft no longer available', 404, 'not_found')
    return json({job: summary(job), draft: draft(record), replayed: true})
   }
   const existing = await replay(); if (existing) return existing
   const clock = await readClock(db), previous = await jobOf(db, actor, parts[2])
   need(input.expected_version === previous.version, 'Job changed; reload before preparing a draft', 409, 'stale_version')
   const job = structuredClone(previous), record = prepareVariation(job, actor, input)
   try {
    await saveJob(db, actor, previous, job, [db.prepare('INSERT INTO pl_api_requests(operator_id,operation_key,request_hash,job_id,record_id) VALUES(?,?,?,?,?)').bind(actor.id, operationKey, hash, job.id, record.id)], clock)
   } catch (error) {
    if (error instanceof DomainError && error.status === 409) { const concurrent = await replay(); if (concurrent) return concurrent }
    throw error
   }
   return json({job: summary(job), draft: draft(record), replayed: false}, 201)
  }
  if (parts.length === 6 && parts[3] === 'changes' && parts[5] === 'approve' && method === 'POST') {
   url.pathname = `/api/plinth/jobs/${parts[2]}/variations/${parts[4]}/approve`
   return dispatch(new Request(url, request))
  }
 }
 return json({error: 'not_found', message: 'Unknown version 1 API operation'}, 404)
}
