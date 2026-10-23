import { clientAccess } from './job-customers'
import { authGuard, visible } from './auth'
import { auditStatement, jobRef, type AuditEvent } from './audit'
import { DomainError, need, type Actor, type Job } from './model'
export async function jobs(db:D1Database):Promise<Job[]> {const rows=await db.prepare('SELECT data FROM pl_jobs ORDER BY rowid DESC').all<{data:string}>();return rows.results.map(r=>JSON.parse(r.data) as Job)}
export async function jobOf(db:D1Database,actor:Actor,id:string):Promise<Job>{const row=await db.prepare('SELECT data FROM pl_jobs WHERE id=?').bind(id).first<{data:string}>();need(row,'Job not found',404,'not_found');const job=JSON.parse(row.data) as Job;if(actor.role==='member'&&await clientAccess(db,job,actor.email))actor.client_job_id=job.id;visible(actor,job);return job}
/** Every committed write carries its ROLE-005 audit row in the same batch. */
export async function transaction(db:D1Database,actor:Actor,job:Job|null,writes:D1PreparedStatement[],clock?:number,event?:AuditEvent) {
 const seen=clock??(await db.prepare('SELECT version FROM pl_clock WHERE id=1').first<{version:number}>())!.version
 const checks=[authGuard(db,actor),db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_clock WHERE id=1 AND version=?) THEN 1 ELSE 0 END').bind(seen)]
 if(job)checks.push(db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(job.id,job.version))
 try{await db.batch([...checks,...writes,auditStatement(db,actor,{...(job?{job_id:job.id}:{}),...event}),db.prepare('UPDATE pl_clock SET version=version+1 WHERE id=1'),db.prepare('DELETE FROM pl_guard')])}catch(error){if(/CHECK constraint failed|UNIQUE constraint failed|job_erased|FOREIGN KEY constraint failed/.test(String(error)))throw new DomainError('conflict','The record or your authority changed. Reload before trying again.',409);throw error}
}
export async function insertJob(db:D1Database,actor:Actor,job:Job,clock?:number){const data=JSON.stringify(job);await transaction(db,actor,null,[db.prepare('INSERT INTO pl_jobs(id,version,data) VALUES(?,?,?)').bind(job.id,job.version,data)],clock,{job_id:job.id,version_after:job.version,after_ref:await jobRef(data)});return job}
export async function saveJob(db:D1Database,actor:Actor,previous:Job,next:Job,writes:D1PreparedStatement[]=[],clock?:number){next.version=previous.version+1;const data=JSON.stringify(next);need(data.length<=8_000_000,'Job history is too large');await transaction(db,actor,previous,[db.prepare('UPDATE pl_jobs SET version=?,data=? WHERE id=? AND version=?').bind(next.version,data,next.id,previous.version),...writes],clock,{job_id:next.id,version_before:previous.version,version_after:next.version,before_ref:await jobRef(JSON.stringify(previous)),after_ref:await jobRef(data)});return next}
export async function readClock(db:D1Database){return (await db.prepare('SELECT version FROM pl_clock WHERE id=1').first<{version:number}>())!.version}
