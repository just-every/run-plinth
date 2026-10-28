import {clientAccess} from './job-customers'
import {portalEnabled} from './portal-policy'
import {scopeContact} from './scope-contacts'
import {currentQualification, type Vendor} from './vendor-model'
import {need, type Actor} from './model'
import type {BidInvitation, BidJob, BidPackage, BidSource} from './bid-model'
import {bidEstimators} from './bid-follow-up'

/** Current policy requires both a qualified contact and its own released company scope. */
export async function bidContact(db:D1Database,job:BidJob,bid:BidPackage,invite:Pick<BidInvitation,'vendor_id'|'contact_id'|'email'|'subcontract_id'|'pre_award'>){
 if(await clientAccess(db,job,invite.email))return false
 if(!portalEnabled(job,'subcontractor','bids'))return false
 const row=await db.prepare('SELECT data FROM pl_vendors WHERE id=?').bind(invite.vendor_id).first<{data:string}>()
 if(!row)return false
 const vendor=JSON.parse(row.data) as Vendor
 if(vendor.kind!=='subcontractor'||currentQualification(vendor,bid.trade)?.status!=='qualified'||!vendor.trades.some(t=>t.toLowerCase()===bid.trade.toLowerCase()))return false
 const scope=invite.pre_award?undefined:await scopeContact(db,job,invite.email,invite.subcontract_id,bid.trade)
 if(!invite.pre_award&&(!scope||scope.vendor_id!==invite.vendor_id||!scope.contact_ids.includes(invite.contact_id)))return false
 if(invite.pre_award&&invite.subcontract_id)return false
 if(!vendor.contacts.some(c=>c.id===invite.contact_id&&c.email.toLowerCase()===invite.email))return false
 return !!await db.prepare("SELECT 1 FROM oa_operators WHERE lower(email)=? AND status='active' AND role='member'").bind(invite.email).first()
}
export async function bidInvite(db:D1Database,job:BidJob,bid:BidPackage,actor:Actor){
 const invite=bid.invitations.find(i=>i.email===actor.email.toLowerCase()&&!i.revoked_by)
 return bid.published_by&&invite&&await bidContact(db,job,bid,invite)?invite:undefined
}
export function bidOffice(actor:Actor){return actor.role==='owner'||actor.role==='admin'||actor.role==='project_manager'||actor.role==='estimator'}
export function bidStatus(bid:BidPackage,invite:BidInvitation){
 const revision=bid.revisions.at(-1)!,response=invite.responses.at(-1),received=invite.decline?.by.at??(response?.revision_id===revision.id?response.by.at:undefined)
 const late=(received??new Date().toISOString())>revision.due_on+'T23:59:59.999Z'
 return {status:invite.revoked_by?'Revoked':invite.decline?'Declined':response?.revision_id===revision.id?'Received':response?'Revision response pending':late?'Late — awaiting response':'Awaiting response',late}
}
export async function bidSource(db:D1Database,job:BidJob,actor:Actor):Promise<BidSource>{
 const office=bidOffice(actor),bids=[]
 for(const bid of job.bids??[]){
  const own=office?undefined:await bidInvite(db,job,bid,actor)
  if(!office&&!own)continue
  const allowed=own?.cost_codes??bid.lines.map(l=>l.cost_code)
  bids.push({...bid,...(own?{follow_up:undefined,scope:bid.lines.filter(l=>allowed.includes(l.cost_code)).map(l=>l.description).join(' · ')}:{}),lines:bid.lines.filter(l=>allowed.includes(l.cost_code)).map(l=>bid.mode==='unpriced'?{cost_code:l.cost_code,description:l.description}:l),invitations:(office?bid.invitations:[own!]).map(i=>({...i,...bidStatus(bid,i)}))})
 }
 return {id:job.id,version:job.version,name:job.name,cost_codes:office?[...new Set(job.quotes.at(-1)?.lines.flatMap(l=>l.cost_code?[l.cost_code]:[])??[])]:[],bids,...(office?{tasks:job.schedules.map(({id,description,start,status})=>({id,description,start,status})),estimators:await bidEstimators(db,job)}:{})}
}
export async function requireBidInvite(db:D1Database,job:BidJob,bid:BidPackage,actor:Actor){need(actor.role==='member','Only the invited subcontractor contact may respond',403,'bid_contact');const invite=await bidInvite(db,job,bid,actor);need(invite,'Bid invitation not found',404,'not_found');return invite}
