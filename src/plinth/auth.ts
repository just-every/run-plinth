import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { need, type Actor, type Job, type TeamRole } from './model'
import { roleGate } from './role-gate'
import { roleOf } from './role-store'
import { presets } from './role-model'
import { teamGrant } from './team'
/** The actor each request was authenticated as, so edge records (exports) name them without a second sign-in check. */
export const authenticated=new WeakMap<Request,Actor>()
export async function authorize(request:Request,original:Bindings):Promise<Actor> {
 const actor=await authenticate(request,original);authenticated.set(request,actor);return actor
}
async function authenticate(request:Request,original:Bindings):Promise<Actor> {
 const env=runtimeBindings(original),url=new URL(request.url)
 need(url.origin===new URL(env.AUTH_ORIGIN).origin,'Wrong application origin',403,'origin')
 need(request.headers.get('sec-fetch-site')!=='cross-site','Cross-site requests are refused',403,'origin')
 const auth=operatorAuth(env)
 if(request.headers.has('authorization')) {
  const credential=await auth.authenticateCredential(request);need(credential,'Sign in required',401,'unauthenticated')
  const person=await env.DB.prepare("SELECT id,email,display_name,role,version FROM oa_operators WHERE id=? AND status='active'").bind(credential.personId).first<{id:string;email:string;display_name:string;role:string;version:number}>()
  need(person&&['owner','admin'].includes(person.role),'Only manager credentials may prepare drafts',403,'forbidden')
  return {id:person.id,email:person.email,name:person.display_name,role:'agent',version:credential.fence,credential_id:credential.id,request:{method:request.method,path:url.pathname}}
 }
 const session=await auth.getSession(request);need(session,'Sign in required',401,'unauthenticated')
 if(!['GET','HEAD'].includes(request.method))need(request.headers.get('origin')===url.origin,'A matching Origin header is required',403,'origin')
 const o=session.operator,request_info={method:request.method,path:url.pathname},grant=o.role==='admin'?await teamGrant(env.DB,o.id):null
 if(grant){
  const g=grant.grant,custom=g.role==='custom'?await roleOf(env.DB,g.role_id??''):null
  need(g.role!=='custom'||custom,'Your role was removed; ask the owner to assign another',403,'forbidden')
  const limit=custom?(custom.role.po_limit_cents??Number.MAX_SAFE_INTEGER):g.po_limit_cents
  const actor:Actor={id:o.id,email:o.email,name:o.displayName,role:custom?presets[custom.role.copy_of].base:g.role as TeamRole,version:o.version,session_id:session.id,team:{version:grant.version,job_ids:g.job_ids,po_limit_cents:limit},request:request_info,...(custom?{permissions:{role_id:custom.role.id,role_version:custom.version,name:custom.role.name,matrix:custom.role.permissions,financial:custom.role.financial_visible,po_limit_cents:custom.role.po_limit_cents}}:{})}
  roleGate(actor,request);return actor
 }
 return {id:o.id,email:o.email,name:o.displayName,role:o.role,version:o.version,session_id:session.id,request:request_info}
}
export function requireManager(actor:Actor,allowAgent=false){need(actor.role==='owner'||actor.role==='admin'||allowAgent&&actor.role==='agent','Builder manager access required',403,'forbidden')}
/** ROLE-001: job work is open to project managers too; jobOf has already refused jobs outside their assignments. */
export function requireJobManager(actor:Actor,allowAgent=false){need(actor.role==='project_manager'||actor.role==='owner'||actor.role==='admin'||allowAgent&&actor.role==='agent','Builder manager access required',403,'forbidden')}
export function requireOwner(actor:Actor){need(actor.role==='owner','Only the owner may do this',403,'forbidden')}
/** ROLE-002: estimators prepare estimates, takeoff, bids and proposals; they never accept for a client or touch money records. */
export function requireEstimating(actor:Actor,allowAgent=false){need(actor.role==='estimator'||actor.role==='project_manager'||actor.role==='owner'||actor.role==='admin'||allowAgent&&actor.role==='agent','Estimating access required',403,'forbidden')}
/** An estimator drafts a bid package; publishing and inviting contacts stay with owners and administrators. */
export function requireBidDrafting(actor:Actor){if(actor.role!=='estimator')requireManager(actor)}
/** Company rates and catalogs: estimators read them to price; changing them stays with owners and administrators. */
export function requireRateAccess(actor:Actor,method:string){if(actor.role==='estimator'&&method==='GET')return;requireManager(actor,method==='GET')}
/** The drawings an assigned estimator, superintendent or crew member works from. */
export function requirePlans(actor:Actor,allowAgent=false){need(isFieldRole(actor)||actor.role==='estimator'||actor.role==='project_manager'||actor.role==='owner'||actor.role==='admin'||allowAgent&&actor.role==='agent','Plan access required',403,'forbidden')}
/** Superintendents write daily logs and capture punch observations; crew read them. */
export function requireFieldLog(actor:Actor,allowAgent=false){need(actor.role==='superintendent'||actor.role==='project_manager'||actor.role==='owner'||actor.role==='admin'||allowAgent&&actor.role==='agent','Field log access required',403,'forbidden')}
/** Estimator, superintendent and crew are Plinth role-table presets on an operator-auth administrator, like a project manager. */
export const isTeamRole=(role:string):role is TeamRole=>role==='project_manager'||role==='estimator'||role==='superintendent'||role==='crew'
export const isFieldRole=(actor:Actor)=>actor.role==='superintendent'||actor.role==='crew'
export function visible(actor:Actor,job:Job){need(!isTeamRole(actor.role)||actor.team!.job_ids.includes(job.id),'Job not found',404,'not_found');need(actor.role!=='member'||(actor.email.toLowerCase()===job.client_email||actor.client_job_id===job.id),'Job not found',404,'not_found')}
export function actorPredicate(actor:Actor):{sql:string;params:unknown[]} {
 const person="EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active' AND role=?)"
 const role=actor.role==='agent'?null:isTeamRole(actor.role)?'admin':actor.role
 // A write commits only while the person's Plinth role and assignments are those this request was authorized with.
 const team=actor.team?{sql:' AND EXISTS(SELECT 1 FROM pl_team WHERE operator_id=? AND version=?)'+(actor.permissions?' AND EXISTS(SELECT 1 FROM pl_roles WHERE id=? AND version=?)':''),params:[actor.id,actor.team.version,...(actor.permissions?[actor.permissions.role_id,actor.permissions.role_version]:[])]}:actor.role==='admin'?{sql:' AND NOT EXISTS(SELECT 1 FROM pl_team WHERE operator_id=?)',params:[actor.id]}:{sql:'',params:[]}
 const now="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)"
 if(actor.credential_id)return {sql:`EXISTS(SELECT 1 FROM oa_credentials c JOIN oa_operators o ON o.id=c.operator_id WHERE c.id=? AND c.operator_id=? AND c.operator_version=? AND o.version=c.operator_version AND o.status='active' AND o.role IN ('owner','admin') AND c.revoked_at IS NULL AND c.expires_at>${now})`,params:[actor.credential_id,actor.id,actor.version]}
 return {sql:`${person} AND EXISTS(SELECT 1 FROM oa_sessions WHERE id=? AND operator_id=? AND operator_version=? AND revoked_at IS NULL AND expires_at>${now} AND (kind!='oidc' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings a ON a.singleton=1 AND a.idp_sign_in=1 AND a.generation=p.generation WHERE p.session_id=oa_sessions.id)) AND NOT EXISTS(SELECT 1 FROM oa_provider_session_pins pin WHERE pin.session_id=oa_sessions.id AND NOT EXISTS(SELECT 1 FROM oa_identity_providers provider WHERE provider.provider_id=pin.provider_id AND provider.status='linked' AND provider.issuer=pin.issuer AND provider.client_id=pin.client_id AND provider.linked_at=pin.linked_at)))${team.sql}`,params:[actor.id,actor.version,role,actor.session_id,actor.id,actor.version,...team.params]}
}
export function authGuard(db:D1Database,actor:Actor){const f=actorPredicate(actor);return db.prepare(`INSERT INTO pl_guard(ok) SELECT CASE WHEN ${f.sql} THEN 1 ELSE 0 END`).bind(...f.params)}
