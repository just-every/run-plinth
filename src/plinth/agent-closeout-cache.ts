import type { Job } from './model'

export function closeoutSources(job: Job) {
 return { handover: job.handover ?? null, selections: job.selections ?? [], punch: job.punch ?? null, warranties: job.warranties ?? null, diary: job.diary }
}
/** A cached MCP result or held read must not bypass changed evidence or job erasure. */
export function closeoutCacheSql(jobId: string) {
 return [
  { sql: `DELETE FROM agent_door_calls WHERE json_extract(outcome,'$.result.record.job_id')=? OR json_extract(outcome,'$.approval.id') IN (SELECT id FROM agent_door_approvals WHERE json_extract(saved,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup') AND json_extract(saved,'$.args.job_id')=?)`, params: [jobId, jobId] },
  { sql: `DELETE FROM agent_door_approvals WHERE json_extract(saved,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup') AND json_extract(saved,'$.args.job_id')=?`, params: [jobId] },
 ]
}
