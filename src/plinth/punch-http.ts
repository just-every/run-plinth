import {requirePortalFeature} from './portal-policy'
import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize } from './auth'
import { decisionDownload } from './decision-files'
import { DomainError, find, need, object, type Actor, type Attachment, type Input } from './model'
import { jobOf, jobs, readClock, saveJob } from './store'
import { punchAction } from './punch-actions'
import { punchProjection, punchScope, punchTradeIssues } from './punch-access'
import type { PunchJob } from './punch-model'
import { getVendor } from './vendors'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown) => Response.json(value, { headers })
async function body(request: Request): Promise<Input> {
 need((request.headers.get('content-type') ?? '').split(';')[0] === 'application/json', 'Send application/json', 415, 'content_type')
 const reader = request.body?.getReader(); need(reader, 'JSON body is required'); const chunks: Uint8Array[] = []; let size = 0
 for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 15_000_000) { await reader.cancel(); need(false, 'Request is too large', 413, 'body_size') } chunks.push(next.value) }
 const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length }
 try { return object(JSON.parse(new TextDecoder().decode(bytes))) } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('invalid_json', 'Invalid JSON body') }
}
async function source(db: D1Database, job: PunchJob, actor: Actor, portal: boolean) {
 const state = await punchProjection(db, job, actor, portal)
 const scopes: { id: string; company: string; trade: string; scope: string; contacts: { email: string; name: string }[] }[] = []
 if (actor.role === 'owner' || actor.role === 'admin') for (const scope of job.subcontracts ?? []) {
  if (scope.status !== 'released') continue
  const vendor = await getVendor(db, scope.vendor_id), contacts = []
  for (const c of vendor.contacts.filter(c => scope.contact_ids.includes(c.id))) if (await punchScope(db, job, c.email, scope.id)) contacts.push({ email: c.email, name: c.name })
  if (contacts.length) scopes.push({ id: scope.id, company: scope.vendor_name, trade: scope.trade, scope: scope.scope, contacts })
 }
 return { job_id: job.id, version: job.version, name: job.name, ...state, scopes, sheets: actor.role === 'member' ? [] : (job.takeoff ?? []).map(s => ({ id: s.id, name: s.name, revisions: s.revisions.map(r => ({ id: r.id, revision: r.revision, page: r.page })) })) }
}
function search<T extends { title: string; description: string; location: string; status: string; answers: unknown; annotation: { note: string }; attempts: unknown; sheet?: unknown; assignment?: unknown }>(rows: T[], url: URL, exporting = false) {
 const status = url.searchParams.get('status') ?? (exporting ? 'open' : 'all'), q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
 need(status === 'all' || status === 'open', 'status must be all or open'); need(q.length <= 500, 'Search is too long')
 return rows.filter(i => (status !== 'open' || i.status !== 'accepted') && (!q || JSON.stringify([i.title, i.description, i.location, i.sheet, i.assignment, i.answers, i.annotation.note, i.attempts]).toLowerCase().includes(q)))
}
/** A narrow trade inbox uses raw job storage only to find currently assigned records. It never grants the whole job, files or ordinary client routes. Every path authenticates here. */
export async function punchResponse(request: Request, original: Bindings): Promise<Response | null> {
 const url = new URL(request.url), parts = url.pathname.split('/').filter(Boolean)
 const portal = parts[0] === 'api' && parts[1] === 'plinth' && parts[2] === 'punch'
 const jobRoute = parts[0] === 'api' && parts[1] === 'plinth' && parts[2] === 'jobs' && parts[4] === 'punch'
 if (!portal && !jobRoute) return null
 const env = runtimeBindings(original), actor = await authorize(request, env); need(actor.role !== 'agent', 'A person must use the punch workflow', 403, 'human_required')
 const clock = await readClock(env.DB), jobId = parts[3], tail = parts.slice(portal ? 4 : 5)
 let previous: PunchJob
 if (portal) {
  need(actor.role === 'member', 'Use the job punch workspace for office work', 403, 'forbidden')
  const allowed: PunchJob[] = []
  for (const job of await jobs(env.DB)) if ((await punchTradeIssues(env.DB, job, actor)).length) allowed.push(job)
  if (!jobId) { need(request.method === 'GET' && parts.length === 3, 'Method not allowed', 405, 'method_not_allowed'); return json({ jobs: await Promise.all(allowed.map(j => source(env.DB, j, actor, true))) }) }
  previous = find(allowed, jobId)
 } else previous = await jobOf(env.DB, actor, jobId)
 if(actor.role==='member'&&!portal)requirePortalFeature(previous,'client','punch')
 const projected = await source(env.DB, previous, actor, portal)
 if (request.method === 'GET') {
  if (tail.length === 0) return json({ ...projected, issues: search(projected.issues, url) })
  if (tail.length === 1 && ['export.json', 'export.csv'].includes(tail[0])) {
   const issues = search(projected.issues, url, true)
   if (tail[0] === 'export.json') return new Response(JSON.stringify({ job_id: previous.id, name: previous.name, issues }), { headers: { ...headers, 'content-type': 'application/json', 'content-disposition': 'attachment; filename=punch-items.json' } })
   const fields = ['number', 'title', 'kind', 'severity', 'due_on', 'location', 'status', 'sheet', 'annotation', 'form', 'answers', 'attempts'] as const
   const cell = (v: unknown) => { const s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"' }
   return new Response(fields.join(',') + '\r\n' + issues.map(i => fields.map(f => cell(i[f])).join(',')).join('\r\n') + '\r\n', { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename=punch-items.csv' } })
  }
  if (tail.length === 2 && tail[0] === 'files') {
   const files: Attachment[] = projected.issues.flatMap(i => [i.photo, ...i.attempts.flatMap(a => [...a.attachments, ...(a.review?.attachments ?? [])])])
   return decisionDownload(env.DB, previous, files, tail[1])
  }
  need(false, 'Unknown punch route', 404, 'not_found')
 }
 need(request.method === 'POST', 'Method not allowed', 405, 'method_not_allowed')
 need((tail[0] === 'forms' && tail.length <= 2) || (tail[0] === 'issues' && (tail.length === 1 || tail.length === 3)), 'Unknown punch action', 404, 'not_found')
 if (portal) need(tail[0] === 'issues' && tail[2] === 'submit', 'Trade contacts can only submit assigned repair evidence', 403, 'forbidden')
 else need(actor.role !== 'member', 'Clients read released closeout observations only', 403, 'forbidden')
 const input = await body(request); need(input.expected_version === previous.version, 'Punch records changed. Reload before acting.', 409, 'stale_version')
 const job = structuredClone(previous), result = await punchAction(env.DB, job, actor, input, tail[0], tail[1], tail[2]); await saveJob(env.DB, actor, previous, job, result.writes, clock)
 const shown = await source(env.DB, job, actor, portal)
 return json({ ...shown, record: tail[0] === 'forms' ? shown.forms.find(f => f.id === result.record.id) : shown.issues.find(i => i.id === result.record.id) })
}
