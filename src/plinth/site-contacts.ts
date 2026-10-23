import type { TeamGrant } from './team'

const labels: Record<string, string> = { project_manager: 'Project manager', estimator: 'Estimator', superintendent: 'Superintendent', crew: 'Crew', custom: 'Team' }
/** SCH-005: who a field worker can call about this job: the owner and the internal people the owner assigned to it. */
export async function siteContacts(db: D1Database, jobId: string) {
 const { results } = await db.prepare("SELECT o.email,o.display_name,o.role,t.data FROM oa_operators o LEFT JOIN pl_team t ON t.operator_id=o.id WHERE o.status='active' AND o.role IN ('owner','admin') ORDER BY o.role DESC,o.display_name").all<{ email: string; display_name: string; role: string; data: string | null }>()
 return results.flatMap(r => { const grant = r.data ? JSON.parse(r.data) as TeamGrant : null; return r.role === 'owner' ? [{ name: r.display_name, email: r.email, role: 'Builder' }] : grant?.job_ids.includes(jobId) ? [{ name: r.display_name, email: r.email, role: labels[grant.role] ?? 'Team' }] : [] })
}
