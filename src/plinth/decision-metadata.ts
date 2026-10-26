import { requireJobManager } from './auth'
import { need, text, type Actor, type Input, type Job } from './model'
import { transaction } from './store'

export interface DecisionMetadata { tags: string[]; sheet: string; cost_code: string }
export async function decisionMetadata(db: D1Database, jobId: string) {
 const rows = await db.prepare('SELECT source,data FROM pl_decision_metadata WHERE job_id=?').bind(jobId).all<{ source: string; data: string }>()
 return new Map(rows.results.map(r => [r.source, JSON.parse(r.data) as DecisionMetadata]))
}
/** Annotation changes neither the source, its author nor any audience grant. */
export async function annotateDecision(db: D1Database, job: Job, actor: Actor, input: Input, permittedSources: string[]) {
 requireJobManager(actor)
 need(!actor.permissions && actor.session_id, 'Current office authority is required for source annotations', 403, 'forbidden')
 const source = text(input.source, 'Source', 200)
 need(permittedSources.includes(source), 'Source not found', 404, 'not_found')
 need(Array.isArray(input.tags) && input.tags.length <= 30, 'Provide up to 30 tags')
 const metadata: DecisionMetadata = { tags: [...new Set(input.tags.map(t => text(t, 'Tag', 80)))], sheet: text(input.sheet ?? '', 'Sheet', 200, true), cost_code: text(input.cost_code ?? '', 'Cost code', 80, true) }
 await transaction(db, actor, job, [db.prepare('INSERT INTO pl_decision_metadata(job_id,source,data) VALUES(?,?,?) ON CONFLICT(job_id,source) DO UPDATE SET data=excluded.data').bind(job.id, source, JSON.stringify(metadata))], undefined, { kind: 'record', action: 'decision.metadata', subject_kind: 'decision', subject_id: source, job_id: job.id })
 return metadata
}
