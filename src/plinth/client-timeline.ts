import { digest } from './attachments'
import { thread } from './mail-store'
import { need, type Actor, type Job } from './model'

export interface TimelineItem {
 source: string; kind: string; title: string; text: string; date: string; date_label: string; status: string
 href: string; source_href: string; files: { name: string; href: string }[]
}
export interface TimelinePage { items: TimelineItem[]; count: number; next_cursor: string | null }

/** The dispatcher supplies the ordinary client job projection, never the private job.
 * Search and pagination operate only after the same current source grants have been applied.
 */
export async function clientTimeline(db: D1Database, shown: Job, actor: Actor, params: URLSearchParams): Promise<TimelinePage> {
 need(actor.role === 'member' && !actor.agent_door, 'Client sign-in required', 403, 'forbidden')
 const q = (params.get('q') ?? '').trim().toLocaleLowerCase('en-US'), source = params.get('source') ?? ''
 need(q.length <= 200 && source.length <= 200, 'Timeline filters are limited to 200 characters')
 const limit = Number(params.get('limit') ?? 20)
 need(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'Choose a page size from 1 to 50')
 const items: TimelineItem[] = [], base = `/api/plinth/jobs/${shown.id}`
 const add = (kind: string, id: string, title: string, text: string, date: string, date_label: string, status: string, tab: string, files: TimelineItem['files'] = []) => {
  const key = `${kind}:${id}`, page = `/app?job=${encodeURIComponent(shown.id)}&tab=`
  items.push({ source: key, kind, title, text, date, date_label, status, href: `${page}Timeline&source=${encodeURIComponent(key)}`, source_href: `${page}${encodeURIComponent(tab)}`, files })
 }
 for (const row of shown.schedules) add('schedule', row.id, row.description, row.trade, row.start, 'Scheduled start', row.status, 'Schedule')
 for (const row of shown.diary) add('diary', row.id, `Daily log · ${row.date}`, row.note, row.date, 'Log date', row.status, 'Daily logs', row.attachments.map(f => ({ name: f.name, href: `${base}/diary/${row.id}/attachments/${f.id}` })))
 for (const row of shown.variations) add('change', row.id, row.description, '', row.approved_by?.at ?? row.prepared_by.at, row.approved_by ? 'Approved' : 'Prepared', row.status === 'draft' ? 'Awaiting client decision' : row.status, 'Changes')
 for (const selection of shown.selections ?? []) {
  const row = selection.revisions.at(-1)
  if (row) add('selection', selection.id, `${row.room}: ${row.category}`, row.signature?.statement ?? `Decision due ${row.decision_on}`, row.signature?.by.at ?? row.presented_by?.at ?? row.prepared_by.at, row.signature ? 'Choice recorded' : 'Presented', row.status, 'Selections')
 }
 for (const row of shown.invoices ?? []) if (row.issued) {
  const balance = row.balance
  const amount = balance ? new Intl.NumberFormat('en-US', { style: 'currency', currency: shown.currency ?? 'USD' }).format(balance.due_cents / 100) : ''
  add('invoice', row.id, `${row.number}: ${row.description}`, `Due ${row.due_on}${balance ? ` · Balance due ${amount}` : ''}`, row.issued.issued_by.at, 'Issued', balance?.due_cents === 0 ? 'No balance due' : 'Issued · Balance outstanding', 'Billing', [{ name: 'Issued invoice', href: `${base}/invoices/${row.id}/document.html` }])
 }
 const originals = await db.prepare('SELECT message_id FROM pl_mail_originals WHERE job_id=?').bind(shown.id).all<{ message_id: string }>()
 for (const row of await thread(db, shown.id, actor)) add('correspondence', row.id, row.subject, row.body, row.created_at, row.direction === 'in' ? 'Received' : 'Message recorded', row.label, 'Messages', [...(originals.results.some(original => original.message_id === row.id) ? [{ name: 'Original email', href: `${base}/correspondence/${row.id}/original` }] : []), ...row.files.map(f => ({ name: f.name, href: `${base}/correspondence/files/${f.id}` }))])
 const filtered = items.filter(item => (!source || item.source === source) && (!q || [item.title, item.text].join('\n').toLocaleLowerCase('en-US').includes(q)))
 filtered.sort((a, b) => b.date.localeCompare(a.date) || a.source.localeCompare(b.source))
 // Bind cursors to the viewer and the authorized result snapshot. Private edits do
 // not invalidate them; grant loss or visible source changes require a fresh read.
 const snapshot = await digest(new TextEncoder().encode(JSON.stringify([actor.id, shown.id, q, source, limit, filtered])))
 let offset = 0
 const cursor = params.get('cursor')
 if (cursor) {
  let saved: { snapshot?: string; after?: string } = {}
  try { need(cursor.length <= 1000, 'Invalid timeline cursor'); saved = JSON.parse(atob(cursor)) } catch { need(false, 'Invalid timeline cursor') }
  need(saved && saved.snapshot === snapshot, 'Timeline changed. Search again for current records.', 409, 'timeline_changed')
  offset = filtered.findIndex(item => item.source === saved.after) + 1
  need(offset > 0, 'Timeline changed. Search again for current records.', 409, 'timeline_changed')
 }
 const page = filtered.slice(offset, offset + limit)
 return { items: page.map(item => { const at = q ? item.text.toLocaleLowerCase('en-US').indexOf(q) : 0; return { ...item, text: item.text.slice(Math.max(0, at - 120), Math.max(0, at - 120) + 800) } }), count: filtered.length, next_cursor: offset + page.length < filtered.length ? btoa(JSON.stringify({ snapshot, after: page.at(-1)!.source })) : null }
}
