import {portalEnabled} from './portal-policy'
import type { Bindings } from '../auth.server'
import { need, type Actor, type Input, type Job } from './model'
import { clientAccess } from './job-customers'
import { transaction } from './store'

const prefix = '/api/plinth/calendar/'
const headers = {
 'cache-control': 'private, no-store',
 'referrer-policy': 'no-referrer',
 'x-content-type-options': 'nosniff',
 'x-robots-tag': 'noindex, nofollow',
}
const encoder = new TextEncoder()
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
async function digest(token: string): Promise<string> {
 return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))))
}

/** A person manages only their own subscription to the supplied, current job. */
export async function manageCalendar(db: D1Database, actor: Actor, job: Job, input: Input, clock?: number): Promise<{ urlPath?: string; revoked: boolean }> {
 need(!actor.credential_id && ['owner', 'admin', 'project_manager', 'member'].includes(actor.role), 'A person must manage calendar subscriptions', 403, 'human_required')
 need(actor.role !== 'member' || await clientAccess(db,job,actor.id), 'Job not found', 404, 'not_found')
 need(input.expected_version === job.version, 'Job changed. Reload before applying this action.', 409, 'stale_version')
 need(input.action === 'rotate' || input.action === 'revoke', 'Choose rotate or revoke')
 const writes = [db.prepare('DELETE FROM pl_calendar_tokens WHERE person_id=? AND job_id=?').bind(actor.id, job.id)]
 let token: string | undefined
 if (input.action === 'rotate') {
  token = hex(crypto.getRandomValues(new Uint8Array(32)))
  writes.push(db.prepare('INSERT INTO pl_calendar_tokens(token_hash,person_id,job_id) VALUES(?,?,?)').bind(await digest(token), actor.id, job.id))
 }
 await transaction(db, actor, job, writes, clock)
 return token ? { urlPath: `${prefix}${token}.ics`, revoked: false } : { revoked: true }
}

function escapeText(value: string): string {
 return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

/** Fold by UTF-8 octets without splitting a Unicode code point. */
function fold(line: string): string {
 const parts: string[] = []
 let part = '', size = 0
 for (const character of line) {
  const length = encoder.encode(character).length
  if (size + length > 75) {
   parts.push(part)
   part = ' '
   size = 1
  }
  part += character
  size += length
 }
 parts.push(part)
 return parts.join('\r\n')
}

const utc = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

function calendar(job: Job): string {
 const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Plinth//Schedule Feed//EN', 'CALSCALE:GREGORIAN']
 for (const schedule of job.schedules) {
  if (schedule.status !== 'booked' && schedule.status !== 'cancelled') continue
  lines.push(
   'BEGIN:VEVENT',
   `UID:${escapeText(schedule.id)}@plinth`,
   `SEQUENCE:${schedule.revision ?? 0}`,
   `DTSTAMP:${utc(schedule.updated_at ?? schedule.prepared_by.at)}`,
   `DTSTART:${utc(schedule.start)}`,
   `DTEND:${utc(schedule.end)}`,
   `STATUS:${schedule.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
   `SUMMARY:${escapeText(schedule.trade)}`,
   `DESCRIPTION:${escapeText(schedule.description)}`,
   'END:VEVENT',
  )
 }
 lines.push('END:VCALENDAR')
 return lines.map(fold).join('\r\n') + '\r\n'
}

/** Public bearer URL: validate live person and job access on every fetch. */
export async function calendarFeed(request: Request, env: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (!path.startsWith(prefix)) return null
 if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, allow: 'GET' } })
 const match = /^\/api\/plinth\/calendar\/([a-f0-9]{64})\.ics$/.exec(path)
 if (!match) return new Response(null, { status: 404, headers })
 const row = await env.DB.prepare(`
  SELECT j.data,p.id,p.role FROM pl_calendar_tokens t
  JOIN oa_operators p ON p.id=t.person_id
  JOIN pl_jobs j ON j.id=t.job_id
  WHERE t.token_hash=? AND p.status='active'
   AND p.role IN ('owner','admin','member')
   AND NOT EXISTS(SELECT 1 FROM pl_team m WHERE m.operator_id=p.id AND NOT EXISTS(SELECT 1 FROM json_each(m.data,'$.job_ids') a WHERE a.value=j.id))
   AND NOT EXISTS(SELECT 1 FROM pl_erased_jobs e WHERE e.job_id=j.id)
 `).bind(await digest(match[1]!)).first<{ data: string; id: string; role: string }>()
 if (!row || row.role === 'member' && (!await clientAccess(env.DB,JSON.parse(row.data) as Job,row.id)||!portalEnabled(JSON.parse(row.data) as Job,'client','schedule'))) return new Response(null, { status: 404, headers })
 return new Response(calendar(JSON.parse(row.data) as Job), {
  headers: { ...headers, 'content-type': 'text/calendar; charset=utf-8' },
 })
}
