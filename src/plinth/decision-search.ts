import { thread } from './mail-store'
import { decisionMetadata } from './decision-metadata'
import { searchableFile, type SearchFile } from './decision-file-search'
import type { rfiProjection } from './rfis'
import type { Actor, Job, Stamp } from './model'
import { need } from './model'
export interface DecisionHit { source: string; title: string; text: string; sender: string; tags: string[]; sheet: string; cost_code: string; href: string; files?: { name: string; href: string }[]; extraction?: { status: string; detail?: string } }
type Sources = Pick<Job, 'diary' | 'schedules' | 'variations' | 'selections' | 'takeoff' | 'todos' | 'punch'> & { rfis?: ReturnType<typeof rfiProjection> }
const author = (by: Stamp) => by.name
/** Rebuild from current permitted parents. Source annotations and derived file text never grant access. */
export async function decisionSearch(db: D1Database, job: Job, projected: Sources, actor: Actor, params: URLSearchParams, rfiOnly = false) {
 need(actor.role !== 'agent', 'A signed-in person searches decisions', 403, 'human_required')
 const hits: DecisionHit[] = [], base = `/api/plinth/jobs/${job.id}`, pending: { parent: DecisionHit; file: SearchFile }[] = []
 const metadata = await decisionMetadata(db, job.id)
 const add = (kind: string, id: string, title: string, text: string, sender = '', tags: string[] = [], sheet = '', cost_code = '', files?: SearchFile[]) => {
  const source = `${kind}:${id}`, annotations = metadata.get(source)
  const hit: DecisionHit = { source, title, text, sender, tags, sheet, cost_code, ...annotations, href: `${rfiOnly ? `/api/plinth/rfi-inbox/${job.id}` : base}/decision-search?source=${encodeURIComponent(source)}`, ...(files?.length ? { files: files.map(f => ({ name: f.name, href: f.href })) } : {}) }
  hits.push(hit)
  for (const file of files ?? []) pending.push({ parent: hit, file })
 }
 const office = ['owner', 'admin', 'project_manager'].includes(actor.role) && !actor.permissions
 if (!rfiOnly && office) for (const m of job.meetings ?? []) add('meetings', m.id, m.title, [m.agenda, m.minutes, m.decisions, ...m.attendees, ...m.actions.map(a => [a.title, a.completion?.answer].join('\n'))].join('\n'), author(m.by), m.tags, m.sheet, m.cost_code)
 if (!rfiOnly && (office || actor.role === 'member')) for (const m of await thread(db, job.id, actor)) add('correspondence', m.id, m.subject, m.body, m.direction === 'in' ? m.counterparty : m.by_name, [], '', '', m.files.map(f => ({ ...f, table: 'pl_mail_files', href: `${base}/correspondence/files/${f.id}` })))
 for (const d of projected.diary) add('diary', d.id, d.date, d.note, author(d.prepared_by), [], '', '', d.attachments.map(f => ({ ...f, href: `${base}/diary/${d.id}/attachments/${f.id}` })))
 for (const t of projected.schedules) add('schedules', t.id, t.description, t.description, author(t.prepared_by))
 for (const v of projected.variations) add('variations', v.id, v.description, v.description, author(v.prepared_by))
 for (const s of projected.selections ?? []) {
  const revision = s.revisions.at(-1); if (!revision) continue
  add('selections', s.id, `${revision.room}: ${revision.category}`, revision.signature?.statement ?? '', author(revision.prepared_by), [], '', revision.cost_code ?? '')
  for (const c of s.comments) add('comments', c.id, `${revision.room}: ${revision.category} comment`, c.text, author(c.by), [], '', revision.cost_code ?? '')
  for (const d of s.decisions ?? []) add('selection-decisions', d.id, `${revision.room}: ${d.kind}`, d.reason, author(d.by), [], '', revision.cost_code ?? '', d.attachments.map(f => ({ ...f, href: `${base}/decision-files/${f.id}` })))
 }
 // External responses and exact distributed sheets come only from the current RFI projection.
 for (const r of projected.rfis ?? []) {
  const files = (attachments: typeof r.attachments) => attachments.map(f => ({ ...f, href: rfiOnly ? `/api/plinth/rfi-inbox/${job.id}/files/${f.id}` : `${base}/rfi-files/${f.id}` }))
  const sheetFiles = r.sheet ? [r.sheet.document] : []
  add('rfis', r.id, r.title, r.question, author(r.by), [], r.sheet?.name ?? '', r.cost_code ?? '', files([...r.attachments, ...sheetFiles]))
  for (const response of r.responses) add('rfi-responses', response.id, r.title, response.text, author(response.by), [], r.sheet?.name ?? '', r.cost_code ?? '', files([...response.attachments, ...sheetFiles]))
 }
 for (const sheet of projected.takeoff ?? []) for (const revision of sheet.revisions) add('drawings', revision.id, sheet.name, '', author(revision.uploaded_by), [], sheet.name, '', [{ ...revision.document, href: `${base}/takeoff-files/${revision.document.id}` }])
 for (const todo of projected.todos ?? []) {
  add('todos', todo.id, todo.title, todo.notes, author(todo.created_by), todo.tags, '', '', todo.attachments.map(f => ({ ...f, href: `/api/plinth/todos/${todo.id}/files/${f.id}` })))
  for (const item of todo.items) for (const event of item.history) if (event.comment) add('comments', event.id, `${todo.title}: ${item.title}`, event.comment, author(event.by), todo.tags)
 }
 for (const issue of projected.punch?.issues ?? []) {
  add('punch', issue.id, issue.title, issue.description, author(issue.by), [], issue.sheet?.name ?? '', '', [{ ...issue.photo, href: `${base}/punch/files/${issue.photo.id}` }])
  for (const attempt of issue.attempts) add('punch-attempts', attempt.id, issue.title, attempt.note, author(attempt.by), [], issue.sheet?.name ?? '', '', attempt.attachments.map(f => ({ ...f, href: `${base}/punch/files/${f.id}` })))
 }
 const seen = new Set<string>()
 for (const { parent, file } of pending) {
  if (seen.has(file.id)) continue; seen.add(file.id)
  const hit = await searchableFile(db, job.id, parent, file)
  Object.assign(hit, metadata.get(hit.source)); hits.push(hit)
 }
 const lower = (v: string) => v.toLocaleLowerCase('en-US'), filters = ['q', 'tag', 'sender', 'sheet', 'cost_code', 'source']
 for (const key of filters) need((params.get(key)?.length ?? 0) <= 200, 'Search filters are limited to 200 characters')
 const results = hits.filter(h => (!params.get('source') || h.source === params.get('source')) && (!params.get('q') || lower([h.title, h.text].join('\n')).includes(lower(params.get('q')!))) && (!params.get('tag') || h.tags.some(t => lower(t) === lower(params.get('tag')!))) && (!params.get('sender') || lower(h.sender).includes(lower(params.get('sender')!))) && (!params.get('sheet') || lower(h.sheet).includes(lower(params.get('sheet')!))) && (!params.get('cost_code') || lower(h.cost_code) === lower(params.get('cost_code')!)))
 const query = lower(params.get('q') ?? '')
 return { results: results.map(hit => { const at = query ? lower(hit.text).indexOf(query) : 0; const start = Math.max(0, at - 240); return { ...hit, text: hit.text.slice(start, start + 1600) } }), count: results.length }
}
