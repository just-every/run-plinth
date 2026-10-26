import { thread } from './mail-store'
import type { Actor, Job } from './model'
import { need } from './model'
export interface DecisionHit { source: string; title: string; text: string; sender: string; tags: string[]; sheet: string; cost_code: string; href: string; files?: { name: string; href: string }[] }
/** Build each query from current permitted sources. No retained index can revive erased or revoked material. */
export async function decisionSearch(db: D1Database, job: Job, projected: Job, actor: Actor, params: URLSearchParams) {
 need(actor.role !== 'agent', 'A signed-in person searches decisions', 403, 'human_required')
 const hits: DecisionHit[] = [], base = `/api/plinth/jobs/${job.id}`
 const add = (kind: string, id: string, title: string, text: string, sender = '', tags: string[] = [], sheet = '', cost_code = '', files?: DecisionHit['files']) => hits.push({ source: `${kind}:${id}`, title, text, sender, tags, sheet, cost_code, href: `${base}/decision-search?source=${encodeURIComponent(kind + ':' + id)}`, ...(files ? { files } : {}) })
 const office = ['owner','admin','project_manager'].includes(actor.role) && !actor.permissions
 if (office) for (const m of job.meetings ?? []) add('meetings', m.id, m.title, [m.agenda,m.minutes,m.decisions,...m.attendees,...m.actions.map(a => [a.title,a.completion?.answer].join('\n'))].join('\n'), m.by.name, m.tags, m.sheet, m.cost_code)
 if (office || actor.role === 'member') for (const m of await thread(db, job.id, actor)) add('correspondence', m.id, m.subject, m.body, m.direction === 'in' ? m.counterparty : m.by_name, [], '', '', m.files.map(f => ({ name: f.name, href: `${base}/correspondence/files/${f.id}` })))
 for (const d of projected.diary) add('diary', d.id, d.date, d.note, d.prepared_by.name, [], '', '', d.attachments.map(f => ({ name: f.name, href: `${base}/diary/${d.id}/attachments/${f.id}` })))
 for (const t of projected.schedules) add('schedules', t.id, t.description, t.description, t.prepared_by.name)
 for (const v of projected.variations) add('variations', v.id, v.description, v.description, v.prepared_by.name)
 for (const s of projected.selections ?? []) { const revision = s.revisions.at(-1); if (!revision) continue; add('selections', s.id, `${revision.room}: ${revision.category}`, [...s.comments.map(c => c.text), ...s.decisions?.map(d => d.reason) ?? [], revision.signature?.statement ?? ''].join('\n'), revision.prepared_by.name, [], '', revision.cost_code ?? '') }
 // The office job projection already applies document-feature restrictions. External RFI recipients retain their separate inbox doors.
 for (const r of projected.rfis ?? []) add('rfis', r.id, r.title, [r.question,...r.responses.map(v => v.text)].join('\n'), r.by.name, [], r.sheet?.name ?? '', r.cost_code ?? '')
 const lower = (v: string) => v.toLocaleLowerCase('en-US'), filters = ['q','tag','sender','sheet','cost_code','source']
 for (const key of filters) need((params.get(key)?.length ?? 0) <= 200, 'Search filters are limited to 200 characters')
 const results = hits.filter(h => (!params.get('source') || h.source === params.get('source')) && (!params.get('q') || lower([h.title,h.text,...h.files?.map(f => f.name) ?? []].join('\n')).includes(lower(params.get('q')!))) && (!params.get('tag') || h.tags.some(t => lower(t) === lower(params.get('tag')!))) && (!params.get('sender') || lower(h.sender).includes(lower(params.get('sender')!))) && (!params.get('sheet') || lower(h.sheet).includes(lower(params.get('sheet')!))) && (!params.get('cost_code') || lower(h.cost_code) === lower(params.get('cost_code')!)))
 return { results, count: results.length }
}
