import type { Job } from './model'
import type { D1Sql } from '../modules/import-kit/src/d1/index.ts'

const tools = "('plinth.decisions.list','plinth.decisions.read','plinth.decisions.draft')"
/** Retire only decision-packet caches; keep the shared content-free decision audit. */
export function retireDecisionReplay(job: Job, packetIds = job.decision_graphs?.map(p => p.id) ?? []): D1Sql[] {
 const packets = JSON.stringify(packetIds), records = JSON.stringify((job.decision_graphs ?? []).filter(p => packetIds.includes(p.id)).flatMap(p => [p.id, ...p.drafts.map(d => d.id)]))
 const approvals = `json_extract(saved,'$.tool') IN ${tools} AND json_extract(saved,'$.args.job_id')=? AND (json_extract(saved,'$.tool')='plinth.decisions.list' OR json_extract(saved,'$.args.packet_id') IN (SELECT value FROM json_each(?)))`
 return [
  { sql: `DELETE FROM agent_door_calls WHERE decision_id IN (SELECT json_extract(saved,'$.decision_id') FROM agent_door_approvals WHERE ${approvals}) OR json_extract(outcome,'$.result.record.id') IN (SELECT value FROM json_each(?))`, params: [job.id, packets, records] },
  { sql: `DELETE FROM agent_door_approvals WHERE ${approvals}`, params: [job.id, packets] },
  { sql: `DELETE FROM agent_door_reviews WHERE json_extract(saved,'$.tool') IN ${tools} AND (json_extract(saved,'$.summary.target.id') IN (SELECT value FROM json_each(?)) OR (json_extract(saved,'$.summary.arguments.job_id')=? AND (json_extract(saved,'$.tool')='plinth.decisions.list' OR json_extract(saved,'$.summary.arguments.packet_id') IN (SELECT value FROM json_each(?)))))`, params: [packets, job.id, packets] },
 ]
}
/** Draft appends do not retire their own in-flight execution or approval. */
export function changedDecisionReplay(before: Job, after: Job): D1Sql[] {
 const record = (job: Job, kind: string, id: string) => {
  const rows = kind === 'selection' ? job.selections : kind === 'product' ? job.products : kind === 'task' ? job.schedules : kind === 'rfi' ? job.rfis : job.orders
  return rows?.find(r => r.id === id)
 }
 const changed = (before.decision_graphs ?? []).filter(p => p.sources.some(ref => JSON.stringify(record(before, ref.kind, ref.id)) !== JSON.stringify(record(after, ref.kind, ref.id)))).map(p => p.id)
 return changed.length ? retireDecisionReplay(before, changed) : []
}
