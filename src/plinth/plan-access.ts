import { isTeamRole, requirePlans, visible } from './auth'
import { clientAccess } from './job-customers'
import { portalEnabled } from './portal-policy'
import { roleOf } from './role-store'
import { presets } from './role-model'
import { scopeContact } from './scope-contacts'
import { teamGrant } from './team'
import { need, type Actor, type Job } from './model'

/** Notices never create authority: current assignments, client contacts and released company contacts govern every request. */
export async function planRecipientAllowed(db:D1Database,job:Job,id:string){
 const person=await db.prepare("SELECT id,email,role FROM oa_operators WHERE id=? AND status='active'").bind(id).first<{id:string;email:string;role:string}>()
 if(!person)return false
 if(person.role==='member'){
  if(await clientAccess(db,job,person.email))return portalEnabled(job,'client','plans')
  if(!portalEnabled(job,'subcontractor','plans'))return false
  for(const scope of job.subcontracts??[])if(await scopeContact(db,job,person.email,scope.id))return true
  return false
 }
 if(person.role==='owner')return true
 if(person.role!=='admin')return false
 const team=await teamGrant(db,id);if(!team)return true
 const custom=team.grant.role==='custom'?await roleOf(db,team.grant.role_id??''):undefined
 if(team.grant.role==='custom'&&(!custom||!custom.role.permissions.documents.view))return false
 const role=custom?presets[custom.role.copy_of].base:team.grant.role
 return !['bookkeeper','reader'].includes(role)&&(!isTeamRole(role)||team.grant.job_ids.includes(job.id))
}
export function planManager(actor:Actor){return ['owner','admin','project_manager'].includes(actor.role)}
export async function planAccess(db:D1Database,job:Job,actor:Actor){
 need(actor.role!=='agent','A signed-in person opens distributed plans',403,'human_required')
 if(actor.role==='member'){
  need(await planRecipientAllowed(db,job,actor.id)&&(job.plan_sets??[]).some(s=>s.approved_by&&s.recipients.some(r=>r.id===actor.id)),'Plan job not found',404,'not_found');return
 }
 requirePlans(actor)
 visible(actor,job)
 need(!actor.permissions||actor.permissions.matrix.documents.view,'Plan job not found',404,'not_found')
}
export const planSetVisible=(actor:Actor,set:NonNullable<Job['plan_sets']>[number])=>planManager(actor)||actor.role==='estimator'||!!set.approved_by&&(actor.role!=='member'||set.recipients.some(r=>r.id===actor.id))
