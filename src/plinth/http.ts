import { recoveryResponse } from './agent-recovery-http'
import { roomBoardExport } from './room-export'
import { roomBoardAction, roomBoardFile } from './room-boards'
import { signedChangeResponse } from './signed-change-http'
import { followupResponse } from './followup-rules'
import { submittalAccess, submittalAction, submittalFile, submittalReviewers, requireSubmittalGate } from './submittals'
import { planResponse } from './plan-http'
import { satisfactionResponse } from './satisfaction'
import { reportScheduleResponse } from './report-schedule'
import { meetingAction, meetingAccess } from './meetings'
import { meetingEmailPreview, sendMeetingEmail } from './meeting-share-mail'
import { meetingInboxResponse } from './meeting-share-http'
import { publishMeetingShare, revokeMeetingShare } from './meeting-sharing'
import type { MeetingSharingJob } from './meeting-sharing-model'
import { annotateDecision } from './decision-metadata'
import { decisionSearch } from './decision-search'
import { readTranscriptions, saveTranscription, transcriptionAuthority, transcriptionPreview } from './file-transcriptions'
import { apiV1Response } from './api-v1'
import { connectorsResponse } from './connectors'
import { fieldTimeResponse } from './field-time'
import { costBilling, costBillingAccess, costBillingLines } from './cost-billing'
import { enforceCostPeriods } from './cost-periods'
import { refreshExceptions as refreshCostExceptions } from './cost-exceptions'
import { costResponse, withoutCosts, protectCosts } from './cost-http'
import {selectionDelegationsResponse} from './selection-delegations'
import {warrantyServiceResponse,warrantyAgentProjection} from './warranty-service'
import {clientPolicyProjection,clientRouteFeature,portalPolicy,requirePortalFeature} from './portal-policy'
import {subcontractorPortalResponse} from './subcontractor-portal'
import { bidComparisonResponse } from './bid-comparison-http'
import { applyJobTemplateTodos } from './todo-job-template'
import { todosResponse } from './todos'
import { bidsResponse } from './bids'
import { handoverResponse } from './handover'
import { handoverClient } from './handover-model'
import { punchResponse } from './punch-http'
import { punchClientProjection } from './punch-model'
import { rfiAction, rfiAccess, rfiFile } from './rfis'
import { rfiInboxResponse } from './rfi-inbox'
import { travelFields } from './schedule-travel'
import { tradePortalResponse, inviteTrade } from './trade-confirmations'
import { resourceResponse, resources, resourceConflicts, scopedConflicts, requireResources } from './schedule-resources'
import { allocations } from './schedule-resource-model'
import { selectionDecision, selectionDecisionFile } from './selection-decisions'
import { enqueueContinuity, resumeContinuity, linkContinuityClaim } from './continuity'
import { sendContinuityNotice } from './continuity-notice'
import { takeoffAction, takeoffFile } from './takeoff-documents'
import { previewTakeoff, applyTakeoff } from './takeoff-estimate'
import { publicProductSources } from './product-source'
import { productAction, productImage } from './products'
import { previewAllowanceChange, applyAllowanceChange } from './allowance-changes'
import { freezeOriginalBudget, reviseBudget } from './budget'
import { warrantyAction } from './warranties'
import { dispatchWarrantyReminders } from './warranty-reminders'
import { prepareSov, sovCsv } from './sov'
import { invoiceAction, invoiceProjection, invoiceBalance, depositLiability, invoiceDocument } from './invoices'
import { remittanceAction, remittanceFields, receivables } from './remittances'
import { sendInvoice } from './invoice-send'
import { jobMailResponse } from './mail-http'
import { jobPayResponse, payPublicResponse } from './pay-http'
import { mailPublicResponse } from './mail-events'
import { configureRetainage, releaseRetainage, currentRetainageBalance } from './retainage'
import { configureSupplierRetainage, releaseSupplierRetainage, supplierRetainageBalance } from './supplier-retainage'
import { applicationDocument } from './sov-document'
import { previewVariationPricing, preparePricedVariation } from './variation-pricing'
import { learningResponse } from './agent-learning'
import { reportsResponse } from './reports'
import { reportNativeGate } from './report-store'
import { selectionAction, selectionOrderInput, selectionProjection } from './selections'
import { pricingResponse, previewPricing, applyPricing } from './estimate-pricing'
import { catalogResponse } from './estimate-catalog'
import { catalogPreview, applyCatalog } from './catalog-quote'
import { costCodeReport, costCodeCsv, projectEstimateCosts } from './estimate-report'
import { constraintAction, constraintFile, requireScheduleClearance } from './schedule-constraints'
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { auditExport, auditResponse } from './audit-http'
import { holdsResponse } from './holds'
import { searchJobs } from './search'
import { siteContacts } from './site-contacts'
import { assignedJob, authenticated, authorize, isFieldRole, isTeamRole, requireJobManager, requireManager, requireOwner } from './auth'
import { permissionView, roleJobView } from './role-view'
import { rolesResponse } from './roles'
import { teamResponse } from './team'
import { emptyJob, DomainError, need, object, recordApproval, type Actor, type Input, type Job } from './model'
import { insertJob, jobOf, jobs, readClock, saveJob, transaction } from './store'
import { acceptQuote, approveVariation, prepareQuote, prepareVariation } from './quotes'
import { checkConflicts, approveSchedule, issueOrder, prepareOrder, prepareSchedule, receiveOrder } from './operations'
import { orderAction, orderResponse } from './purchase-orders'
import { sendOrder } from './purchase-order-send'
import { approveDiary, prepareDiary, serveAttachment } from './attachments'
import { customersResponse } from './customers'
import { getCustomer } from './customers'
import { clientAccess, linkCustomer } from './job-customers'
import { calendarFeed, manageCalendar } from './calendar'
import { changeSchedule } from './schedule-changes'
import { previewSchedule, publishSchedule } from './schedule-plan'
import { templateResponse, getScheduleTemplate, previewScheduleTemplate, applyScheduleTemplate, scheduleBaselineAction, recordRevision } from './schedule-baselines'
import { approveClaim, exportClaim, prepareClaim } from './claims'
import { company, companyResponse } from './company'
import { currencyTotals } from './currency-report'
import { vendorsResponse } from './vendors'
import { awardSubcontract, releaseSubcontract, subcontractAccess } from './subcontracts'
import { rulesResponse, today } from './compliance'
import { lienAction, packetResponse, releaseFile, templatesResponse } from './lien-waivers'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
const findSovClaim=(job:Job,id:string)=>job.claims.find(c=>c.id===id)?.sov
const role=(actor:Actor)=>actor.role==='member'?'client':actor.role
/** Each job with its client's name from People & access, once they are invited. */
async function resourcePreview(db:D1Database,job:Job,actor:Actor,preview:import('./schedule-model').SchedulePreview){preview.conflicts.push(...scopedConflicts(resourceConflicts(await resources(db),await jobs(db),{...job,schedules:preview.tasks}),actor));return preview}
async function named(db:D1Database,list:Job[]):Promise<Job[]>{const rows=await db.prepare("SELECT lower(email) AS email,display_name FROM oa_operators WHERE role='member'").all<{email:string;display_name:string}>();const names=new Map(rows.results.map(r=>[r.email,r.display_name]));return list.map(job=>names.has(job.client_email)?{...job,client_name:names.get(job.client_email)}:job)}
function display(job:Job,actor:Actor):any {
 job={...job,recovery_requests:undefined,room_boards:actor.role==='owner'&&!actor.agent_door?job.room_boards:undefined,signed_changes:undefined,approvals:job.approvals.filter(a=>!a.kind.startsWith('signed-change.'))}
 if(actor.agent_native_role) {
  const native=display(job,{...actor,role:actor.agent_native_role,agent_door:undefined,agent_native_role:undefined})
  return {...native,bids:undefined,bid_comparisons:undefined,bid_cost_adjustments:undefined,bid_comparison_awards:undefined,portal_submissions:undefined,warranties:native.warranties?warrantyAgentProjection(native):undefined}
 }
 if(actor.role!=='owner'){job={...job,room_boards:undefined};delete job.followup}
 job={...job,estimate_performance:undefined,submittals:undefined,approvals:job.approvals.filter(a=>!a.kind.startsWith('plans.')&&!a.kind.startsWith('submittal.')&&!a.kind.startsWith('estimate.performance.')),satisfaction:undefined,plan_sets:undefined,report_schedules:undefined,meeting_shares:undefined,meeting_office_access:!actor.permissions&&['owner','admin','project_manager'].includes(actor.role)} as Job
 if(!['owner','admin','project_manager'].includes(actor.role)||actor.permissions)job={...job,meetings:undefined}
 job=withoutCosts(job,actor)
 if(actor.role==='bookkeeper'||actor.role==='reader')return roleJobView(job,actor)
 if(actor.permissions)return permissionView(display(job,{...actor,role:'admin',permissions:undefined}),actor)
 if(isTeamRole(actor.role)&&actor.role!=='project_manager')return roleJobView(job,actor)
 if(actor.role!=='member')return {...job,warranties:actor.role==='agent'?warrantyAgentProjection(job):job.warranties,portal_submissions:actor.role==='agent'?undefined:job.portal_submissions,...(actor.role==='agent'?{bids:undefined,bid_comparisons:undefined,bid_cost_adjustments:undefined,bid_comparison_awards:undefined,approvals:job.approvals.filter(a=>!a.kind.startsWith('bid.award')&&!job.warranties?.cases.some(c=>c.service&&c.id===a.subject_id))}:{}),invoices:invoiceProjection(job,actor),invoice_deposit_liability_cents:depositLiability(job),subcontracts:job.subcontracts?.map(sub=>({...sub,retainage_balance:supplierRetainageBalance(sub)})),retainage_balance:currentRetainageBalance(job),selections:selectionProjection(job,false)}
 const claims=job.claims.filter(c=>c.status!=='draft').map(c=>{const {commitments_cents,received_cents,outstanding_cents,orders,...reconciliation}=c.reconciliation;const {export:artifact,...claim}=c;return {...claim,sov:undefined,reconciliation}})
 const safe=projectEstimateCosts({...job,meetings:undefined,bid_comparisons:undefined,bid_cost_adjustments:undefined,bid_comparison_awards:undefined,todos:undefined,bids:undefined,handover:handoverClient(job),punch:punchClientProjection(job),remittances:undefined,invoices:invoiceProjection(job,actor),invoice_deposit_liability_cents:depositLiability(job),retainage:undefined,retainage_balance:undefined,continuity:undefined,takeoff:undefined,rfis:undefined,rfi_access:undefined,trade_invitations:undefined,products:undefined,budgets:undefined,warranties:undefined,sov:undefined,selections:undefined,subcontracts:undefined,schedule_constraints:undefined,schedule_actuals:job.schedule_published_actuals??[],quotes:job.quotes.filter(q=>q.status==='accepted'),schedules:job.schedules.filter(s=>s.status!=='draft'),diary:job.diary.filter(d=>d.status==='published'),orders:[],claims,approvals:job.approvals.filter(a=>['quote','variation','schedule','schedule.move','schedule.cancel','schedule.publish','schedule.baseline','schedule.revision','schedule.template','diary','selection.sign'].includes(a.kind)||a.kind.startsWith('selection.delegation.')).map(a=>{if(!['schedule.publish','schedule.revision'].includes(a.kind))return a;const snapshot=structuredClone(a.snapshot) as {before?:{tasks?:Job['schedules']}};if(snapshot.before?.tasks)snapshot.before.tasks=snapshot.before.tasks.filter(s=>s.status!=='draft');return {...a,snapshot}})})
 return clientPolicyProjection(JSON.parse(JSON.stringify({...safe,selections:publicProductSources(selectionProjection(job,true)),approvals:safe.approvals.map(a=>a.kind==='selection.sign'?{...a,snapshot:publicProductSources(job.approvals.find(source=>source.id===a.id)!.snapshot)}:a)},(key,value)=>['resources','trade_invitations'].includes(key)?undefined:value)),job)
}
async function body(request:Request):Promise<Input>{need((request.headers.get('content-type')??'').split(';')[0]==='application/json','Send application/json',415,'content_type');const reader=request.body?.getReader();need(reader,'JSON body is required');const chunks:Uint8Array[]=[];let size=0;for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>15_000_000){await reader.cancel();need(false,'Request is too large',413,'body_size')}chunks.push(r.value)}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}try{return object(JSON.parse(new TextDecoder().decode(bytes)))}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('invalid_json','Invalid JSON body')}}
async function handle(request:Request,original:Bindings):Promise<Response>{return nativePlinth(request,original,await authorize(request,original))}
/** Native dispatcher shared by HTTP and explicitly declared door tools. Authentication stays at each caller. */
export async function nativePlinth(request:Request,original:Bindings,actor:Actor):Promise<Response>{const env=runtimeBindings(original),parts=new URL(request.url).pathname.slice('/api/plinth/'.length).split('/').filter(Boolean),method=request.method
 const versioned=await apiV1Response(request,env,actor,parts,body,r=>handle(r,env));if(versioned)return versioned
 const connections=await connectorsResponse(request,env,actor,parts,body);if(connections)return connections
 if(parts[0]==='agent-credentials'&&parts.length===1&&method==='POST'){requireOwner(actor);const input=await body(request);const credential=await operatorAuth(env).mintCredential(request,{expiresInSeconds:input.expires_in_seconds===undefined?86400:Number(input.expires_in_seconds)});return json({credential},201)}
 if(parts[0]==='agent-credentials'&&parts.length===1&&method==='GET'){requireOwner(actor);const credentials=await env.DB.prepare('SELECT id,operator_id,expires_at,revoked_at FROM oa_credentials ORDER BY expires_at DESC').all();return json({credentials:credentials.results})}
 if(parts[0]==='agent-credentials'&&parts.length===3&&parts[2]==='revoke'&&method==='POST'){requireOwner(actor);await body(request);await transaction(env.DB,actor,null,[env.DB.prepare("UPDATE oa_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").bind(Date.now(),parts[1]),env.DB.prepare("INSERT INTO oa_auth_audit(id,actor_id,action,value,created_at) VALUES(?,?,'credential.revoke',?,?)").bind(crypto.randomUUID(),actor.id,parts[1],Date.now())]);return json({revoked:true})}
 const plans=await planResponse(request,env,actor,parts,body);if(plans)return plans
 const subPortal=await subcontractorPortalResponse(request,env,actor,parts);if(subPortal)return subPortal
 const scheduledReports=await reportScheduleResponse(request,env,actor,parts,body);if(scheduledReports)return scheduledReports
 const surveys=await satisfactionResponse(request,env,actor,parts,body);if(surveys)return surveys
 const learning=await learningResponse(request,env.DB,actor,parts,body);if(learning)return learning
 const reports=await reportsResponse(request,env.DB,actor,parts,body);if(reports)return reports
 const team=await teamResponse(request,env.DB,actor,parts,body);if(team)return team
 const history=await auditResponse(request,env.DB,actor,parts);if(history)return history
 const holds=await holdsResponse(request,env.DB,actor,parts,body);if(holds)return holds
 const roles=await rolesResponse(request,env.DB,actor,parts,body);if(roles)return roles
 if(parts[0]==='search'&&parts.length===1&&method==='GET'){
  need(actor.role!=='agent','A signed-in person searches jobs',403,'human_required')
  const query=new URL(request.url).searchParams.get('q')?.trim()??'';need(query.length>0&&query.length<=200,'Enter up to 200 characters')
  const all=await jobs(env.DB),allowed=actor.role==='member'?await Promise.all(all.map(job=>clientAccess(env.DB,job,actor.email))):all.map(job=>assignedJob(actor,job))
  return json({results:searchJobs((await named(env.DB,all.filter((_,i)=>allowed[i]))).map(job=>display(job,actor)),query)})
 }
 const compliance=await rulesResponse(request,env.DB,actor,parts,body);if(compliance)return compliance
 const waiverWording=await templatesResponse(request,env.DB,actor,parts,body);if(waiverWording)return waiverWording
 const setup=await companyResponse(request,env.DB,actor,parts,body);if(setup)return setup
 const pricing=await pricingResponse(request,env.DB,actor,parts,body);if(pricing)return pricing
 const catalog=await catalogResponse(request,env.DB,actor,parts,body);if(catalog)return catalog
 const meetingInbox=await meetingInboxResponse(request,env,actor,parts,body);if(meetingInbox)return meetingInbox
 const rfiInbox=await rfiInboxResponse(request,env,actor,parts,body);if(rfiInbox)return rfiInbox
 const tradePortal=await tradePortalResponse(request,env,actor,parts,body);if(tradePortal)return tradePortal
 const resource=await resourceResponse(request,env.DB,actor,parts,body);if(resource)return resource
 const templates=await templateResponse(request,env,actor,parts);if(templates)return templates
 const signedChanges=await signedChangeResponse(request,env,actor,parts,body);if(signedChanges)return signedChanges
 const followup=await followupResponse(request,env,actor,parts,body);if(followup)return followup
 if(parts[0]!=='jobs')return json({error:'not_found',message:'Unknown Plinth route'},404)
 if(parts.length===1){if(method==='GET'){const all=await jobs(env.DB),allowed=actor.role==='member'?await Promise.all(all.map(job=>clientAccess(env.DB,job,actor.email))):all.map(job=>assignedJob(actor,job));const shown=all.filter((job,i)=>allowed[i]);return json({role:role(actor),...(actor.permissions?{role_name:actor.permissions.name}:{}),jobs:(await named(env.DB,shown)).map(job=>display(job,actor)),...(actor.role==='member'||isTeamRole(actor.role)&&actor.role!=='project_manager'||actor.permissions&&!actor.permissions.financial?{}:{currency_totals:currencyTotals(shown)})})}if(method==='POST'){requireManager(actor);const input=await body(request),clock=await readClock(env.DB),job=emptyJob(input,actor,(await company(env.DB))?.time_zone);if(input.customer_id)await linkCustomer(env.DB,job,actor,input);await insertJob(env.DB,actor,job,clock);return json({job,role:role(actor)},201)}return json({error:'method_not_allowed'},405)}
 // Observe the installation clock before reading any cross-job schedule state.
 const clock=await readClock(env.DB),previous=await jobOf(env.DB,actor,parts[1])
 const recovery=await recoveryResponse(request,env.DB,previous,actor,parts,body,clock);if(recovery)return recovery
 if(actor.role==='member'){const feature=clientRouteFeature(parts[2]);if(feature)requirePortalFeature(previous,'client',feature)}
 if(parts[2]==='room-boards'&&method==='GET'){
  requireOwner(actor)
  if(parts.length===3)return json({version:previous.version,boards:previous.room_boards??[]})
  if(parts.length===7&&parts[4]==='revisions'&&parts[6]==='export')return roomBoardExport(env.DB,previous,actor,parts[3]!,parts[5]!)
  if((parts.length===5||parts.length===6)&&parts[3]==='files'&&(!parts[5]||parts[5]==='geometry'))return roomBoardFile(env.DB,previous,actor,parts[4]!,parts[5]==='geometry',new URL(request.url).searchParams.get('download')==='1')
  return json({error:'not_found'},404)
 }
 if(parts[2]==='submittals'&&method==='GET'){
  submittalAccess(actor,previous)
  if(parts.length===3)return json({version:previous.version,person_id:actor.id,manage:actor.role==='owner',register:previous.submittals??[],reviewers:await submittalReviewers(env.DB,previous),orders:previous.orders})
  if(parts.length===5&&parts[3]==='files')return submittalFile(env.DB,previous,actor,parts[4]!)
  return json({error:'not_found'},404)
 }
 if(parts.length===3&&parts[2]==='capacity'&&method==='GET'){requireJobManager(actor);const conflicts=resourceConflicts(await resources(env.DB),await jobs(env.DB),previous);return json({resources:(await resources(env.DB)).map(r=>actor.role==='project_manager'?{...r,history:[],leave:r.leave.map(w=>({...w,reason:'Unavailable'}))}:r),bookings:(await jobs(env.DB)).flatMap(j=>j.schedules.filter(t=>t.status==='booked'&&!t.milestone).map(t=>({job_name:actor.role==='project_manager'&&!actor.team!.job_ids.includes(j.id)?'Another job':j.name,description:actor.role==='project_manager'&&!actor.team!.job_ids.includes(j.id)?'Allocated resource':t.description,start:t.start,end:t.end,resources:t.resources??[]}))),conflicts:conflicts.map(c=>actor.role==='project_manager'&&!actor.team!.job_ids.includes(c.job_id)?{reason:c.reason,resource_id:c.resource_id,job_name:'Another job',start:c.start,end:c.end}:c)})}
 if(parts.length===3&&parts[2]==='forecast'&&method==='GET'){need(actor.role!=='member','Forecasts are internal',403,'forbidden');const booked=previous.schedules.some(t=>t.status==='booked');if(!booked)return json({forecast:null});const planned=await previewSchedule(previous,{...actor,role:'admin',permissions:undefined},{calendar:previous.schedule_calendar,tasks:previous.schedules},await jobs(env.DB));return json({forecast:{completion_before:planned.completion_before,completion_after:planned.completion_after,tasks:planned.tasks.map(t=>({id:t.id,description:t.description,start:t.start,end:t.end,status:t.status}))}})}
 if(parts.length===4&&parts[2]==='invoices'&&parts[3]==='cost-sources'&&method==='GET'){costBillingAccess(actor);const state=previous.cost_records;return json({entries:(state?.entries??[]).map(e=>{const source=state?.bills.find(b=>b.id===e.source_id)??state?.sources.find(s=>s.id===e.source_id);return {...e,reference:source?.reference,document_checksum:source?.document?.checksum}})})}
 if(parts.length===4&&parts[2]==='decision-search'&&['transcriptions','transcription-preview'].includes(parts[3])&&['GET','POST'].includes(method)){
  if(method==='POST')transcriptionAuthority(actor)
  const sources=await decisionSearch(env.DB,previous,display(previous,actor),actor,new URLSearchParams())
  if(method==='GET'&&parts[3]==='transcriptions')return json(await readTranscriptions(env.DB,previous,new URL(request.url).searchParams.get('source'),sources.results))
  need(method==='POST','Method not allowed',405,'method_not_allowed');const input=await body(request)
  return json(parts[3]==='transcription-preview'?await transcriptionPreview(env.DB,previous,actor,input,sources.results):{transcription:await saveTranscription(env.DB,previous,actor,input,sources.results,clock)})
 }
 if(parts.length===4&&parts[2]==='decision-search'&&parts[3]==='metadata'&&method==='POST'){const input=await body(request);const sources=await decisionSearch(env.DB,previous,display(previous,actor),actor,new URLSearchParams());return json({metadata:await annotateDecision(env.DB,previous,actor,input,sources.results.map(r=>r.source))})}
 if(parts.length===3&&parts[2]==='decision-search'&&method==='GET')return json(await decisionSearch(env.DB,previous,display(previous,actor),actor,new URL(request.url).searchParams))
 if(parts.length===7&&parts[2]==='meetings'&&parts[4]==='links'&&method==='GET'){meetingAccess(actor);const link=previous.meetings?.find(m=>m.id===parts[3])?.actions.find(a=>a.id===parts[5])?.completion?.links.find((_,index)=>String(index)===parts[6]);need(link,'Resolved source not found',404,'not_found');return json(link)}
 if(parts.length===3&&parts[2]==='meetings'&&method==='GET'){meetingAccess(actor);return json({meetings:previous.meetings??[]})}
 if(parts.length===5&&parts[2]==='meeting-shares'&&parts[4]==='email-preview'&&method==='GET')return json(await meetingEmailPreview(env,previous as MeetingSharingJob,actor,parts[3]!,new URL(request.url).searchParams.get('request_id')??''))
 if(parts.length===5&&parts[2]==='meetings'&&parts[4]==='shares'&&method==='GET'){meetingAccess(actor);return json({shares:((previous as MeetingSharingJob).meeting_shares??[]).filter(share=>share.meeting_id===parts[3])})}
 const correspondence=await jobMailResponse(request,env,actor,previous,parts,body);if(correspondence)return correspondence
 const payments=await jobPayResponse(request,env,actor,previous,parts,body);if(payments)return payments
 if(parts.length===3&&parts[2]==='receivables'&&method==='GET'){requireJobManager(actor);return json(receivables(previous,new URL(request.url).searchParams.get('as_of')??undefined))}
 if(parts.length===3&&parts[2]==='customer'&&method==='GET'){requireManager(actor);return json({customer:previous.customer_id?await getCustomer(env.DB,previous.customer_id):null})}
 if(parts.length===3&&parts[2]==='calendar'&&method==='POST'){const input=await body(request);need(input.expected_version===previous.version,'Job changed. Reload before changing the feed.',409,'stale_version');return json(await manageCalendar(env.DB,actor,previous,input,clock))}
 if(parts.length===5&&parts[2]==='quotes'&&['cost-codes.json','cost-codes.csv'].includes(parts[4])&&method==='GET'){
  const report=costCodeReport(previous,actor,parts[3])
  if(parts[4]==='cost-codes.json')return json(report)
  return new Response(costCodeCsv(report),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename=estimate-${report.revision}-cost-codes.csv`}})
 }
 if(parts.length===5&&parts[2]==='invoices'&&['document.json','document.html','document.csv'].includes(parts[4])&&method==='GET'){
  need(actor.role!=='agent','A person downloads invoice artifacts',403,'human_required');const row=invoiceProjection(previous,actor).find(invoice=>invoice.id===parts[3]);need(row?.issued,'Issued invoice not found',404,'not_found');const original=previous.invoices!.find(invoice=>invoice.id===row.id)!
  if(parts[4]==='document.json')return json({invoice:row,balance:invoiceBalance(previous,original)})
  if(parts[4]==='document.html')return new Response(invoiceDocument(original),{headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}})
  const fields=['number','description','due_on','gross_cents','withheld_cents','payable_cents','subtotal_cents','tax_cents'] as const,issued=row.issued
  const cell=(value:unknown)=>{const raw=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"'}
  return new Response(fields.join(',')+'\r\n'+fields.map(key=>cell(issued[key])).join(',')+'\r\n',{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename=invoice.csv'}})
 }
 if(parts.length===5&&parts[2]==='claims'&&['application.json','application.csv','application.html'].includes(parts[4])&&method==='GET'){
  requireJobManager(actor);const claim=previous.claims.find(c=>c.id===parts[3]);need(claim?.status==='exported'&&claim.export?.sov,'Issue this SOV application before downloading it',409,'application_unissued');const app=claim.export.sov
  if(parts[4]==='application.json')return json({application:app,issued_by:claim.exported_by,approved_by:claim.approved_by,lien_waivers:claim.export.lien_waivers})
  const html=parts[4]==='application.html';return new Response(html?applicationDocument(app,claim):sovCsv(app),{headers:{...headers,'content-type':html?'text/html; charset=utf-8':'text/csv; charset=utf-8',...(html?{'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}:{'content-disposition':'attachment; filename=plinth-sov-application.csv'})}})
 }
 if(parts.length===5&&parts[2]==='claims'&&parts[4]==='packet'&&method==='GET')return packetResponse(env.DB,previous,actor,parts[3]!)
 if(parts[2]==='orders'&&(parts.length===4||parts.length===5&&parts[4]==='document')&&method==='GET'){if(parts.length===5){const order=previous.orders.find(o=>o.id===parts[3]);need(order,'Order not found',404,'not_found');await requireSubmittalGate(env.DB,previous,order,false,actor)}return orderResponse(previous,actor,parts[3]!,parts.length===5)}
 if(parts.length===4&&parts[2]==='lien-waiver-files'&&method==='GET')return releaseFile(env.DB,previous,actor,parts[3]!)
 if(parts.length===4&&parts[2]==='schedule-documents'&&method==='GET')return constraintFile(env.DB,previous,actor,parts[3])
 if(parts.length===4&&parts[2]==='takeoff-files'&&method==='GET')return takeoffFile(env.DB,previous,actor,parts[3]!)
 if(parts.length===4&&parts[2]==='rfi-files'&&method==='GET')return rfiFile(env.DB,previous,actor,parts[3]!)
 if(parts.length===4&&parts[2]==='decision-files'&&method==='GET')return selectionDecisionFile(env.DB,previous,actor,parts[3]!)
 if(parts.length===4&&parts[2]==='product-images'&&method==='GET')return productImage(env.DB,previous,actor,parts[3]!)
 if(parts.length===2&&method==='GET'){const shown=display((await named(env.DB,[previous]))[0]!,actor);return json({job:isFieldRole(actor)?{...shown,site_contacts:await siteContacts(env.DB,previous.id)}:shown,role:role(actor)})}
 if(parts[2]==='diary'&&parts[4]==='attachments'&&parts.length===6&&method==='GET')return serveAttachment(env.DB,previous,actor,parts[3],parts[5])
 if(parts.length===2&&method==='DELETE'){
  requireOwner(actor);const input=await body(request);need(input.expected_version===previous.version,'Job changed. Reload before erasing.',409,'stale_version')
  const { eraseJob }=await import('./import-erasure')
  await eraseJob(env.DB,actor,previous)
  return json({erased:true,job_id:previous.id})
 }
 need(method==='POST','Method not allowed',405,'method_not_allowed');const input=await body(request);if(parts.length===5&&parts[2]==='claims'&&parts[4]==='export'){requireJobManager(actor);const exported=previous.claims.find(c=>c.id===parts[3]&&c.status==='exported');if(exported)return json({job:display(previous,actor),record:exported,role:role(actor),report:exported.export})}
 need(input.expected_version===previous.version,'Job changed. Reload before applying this action.',409,'stale_version')
 if(parts.length===4&&parts[2]==='warranty-reminders'&&parts[3]==='run'){
  requireJobManager(actor);const report=await dispatchWarrantyReminders(env,{jobId:previous.id,actor});return json({job:display((await named(env.DB,[await jobOf(env.DB,actor,previous.id)]))[0]!,actor),report,role:role(actor)})
 }
 if(parts.length===5&&parts[2]==='quotes'&&parts[4]==='plan-preview'){requireJobManager(actor);need(previous.status==='quoting'&&previous.quotes.at(-1)?.id===parts[3],'Preview the current draft quote',409,'revision');const candidate=structuredClone(previous);candidate.status='active';return json({preview:await previewScheduleTemplate(candidate,actor,input,await getScheduleTemplate(env.DB,String(input.template_id)),await jobs(env.DB))})}
 if(parts.length===4&&parts[2]==='allowance-changes'&&parts[3]==='preview')return json({preview:await previewAllowanceChange(env.DB,previous,actor,input)})
 if(parts.length===4&&parts[2]==='variation-pricing'&&parts[3]==='preview')return json({preview:await previewVariationPricing(env.DB,previous,actor,input)})
 if(parts.length===4&&parts[2]==='invoices'&&parts[3]==='preview'){costBillingAccess(actor);const preview=costBilling(previous,input.cost_billing);return json({preview,lines:costBillingLines(preview)})}
 if(parts.length===4&&parts[2]==='pricing'&&parts[3]==='preview')return json({preview:await previewPricing(env.DB,previous,actor,input)})
 if(parts.length===4&&parts[2]==='takeoff-estimate'&&parts[3]==='preview')return json({preview:await previewTakeoff(env.DB,previous,actor,input)})
 if(parts.length===4&&parts[2]==='estimate-template'&&parts[3]==='preview')return json({preview:await catalogPreview(env.DB,previous,actor,input)})
 if(parts.length===4&&parts[2]==='schedule-template'&&parts[3]==='preview')return json({preview:await resourcePreview(env.DB,previous,actor,await previewScheduleTemplate(previous,actor,input,await getScheduleTemplate(env.DB,String(input.template_id)),await jobs(env.DB)))})
 if(parts.length===4&&parts[2]==='schedule'&&parts[3]==='preview')return json({preview:await resourcePreview(env.DB,previous,actor,await previewSchedule(previous,actor,input,await jobs(env.DB)))})
 if(parts.length===5&&parts[2]==='invoices'&&parts[4]==='send'){const sent=await sendInvoice(env,previous,actor,parts[3]!,input,clock);return json({job:display(sent,actor),role:role(actor)})}
 if(parts.length===5&&parts[2]==='meeting-shares'&&parts[4]==='send-email'){const sent=await sendMeetingEmail(env,previous as MeetingSharingJob,actor,input,parts[3]!,clock);return json({job:display(sent,actor),role:role(actor)})}
 if(parts.length===5&&parts[2]==='orders'&&parts[4]==='send'){const sent=await sendOrder(env,previous,actor,parts[3]!,input,clock);return json({job:display((await named(env.DB,[sent]))[0]!,actor),record:sent.orders.find(o=>o.id===parts[3]),role:role(actor)})}
 if(parts.length===5&&parts[2]==='continuity'&&parts[4]==='notify'){const sent=await sendContinuityNotice(env,previous,actor,parts[3]!,input,clock);return json({job:display(sent,actor),role:role(actor)})}
 const job=structuredClone(previous);let record:unknown;let writes:D1PreparedStatement[]=[];const category=parts[2],id=parts[3],action=parts[4]
 await reportNativeGate(env.DB,previous,actor,category,id,action)
 if(category==='room-boards'&&(parts.length===3||parts.length===5)){const result=await roomBoardAction(env.DB,job,actor,input,id,action);record=result.record;writes=result.writes}
 else if(category==='submittals'&&(parts.length===3||parts.length===5)){const result=await submittalAction(env.DB,job,actor,input,id,action);record=result.record;writes=result.writes}
 else if(category==='meeting-shares'&&parts.length===5&&action==='revoke'){record=revokeMeetingShare(job as MeetingSharingJob,actor,input,id!)}
 else if(category==='meetings'&&parts.length===5&&action==='share'){const result=await publishMeetingShare(env.DB,job as MeetingSharingJob,actor,input,id!);record=result.record;writes=result.writes}
 else if(category==='meetings'&&(parts.length===3||parts.length===5)){const result=await meetingAction(env.DB,job,actor,input,id,action);record=result.record;writes=result.writes}
 else if(category==='portal-policy'&&parts.length===3)record=portalPolicy(job,actor,input)
 else if(category==='rfi-access'&&parts.length===3)record=await rfiAccess(env.DB,job,actor,input)
 else if(category==='rfis'&&(parts.length===3||parts.length===5)){const result=await rfiAction(env.DB,job,actor,input,id,action);record=result.record;writes=result.writes}
 else if(category==='schedules'&&parts.length===5&&action==='invite')record=await inviteTrade(env.DB,job,actor,input,id!)
 else if(category==='schedules'&&parts.length===5&&action==='resources'){requireJobManager(actor);const row=job.schedules.find(t=>t.id===id);need(row,'Task not found',404,'not_found');Object.assign(row,allocations(input,row),travelFields(input,row));checkConflicts(await jobs(env.DB),job,row);requireScheduleClearance(job,[row]);row.revision=(row.revision??0)+1;row.updated_at=new Date().toISOString();recordApproval(job,actor,'schedule.resources',row,row);record=row}
 else if(category==='continuity'&&parts.length===5&&action==='resume')record=resumeContinuity(job,actor,id!)
 else if(category==='takeoff'&&(parts.length===3||parts.length===5)){const result=await takeoffAction(env.DB,job,actor,input,id,action);record=result.record;writes=result.writes}
 else if(category==='takeoff-estimate'&&id==='apply'&&parts.length===4)record=await applyTakeoff(env.DB,job,actor,input)
 else if(category==='products'&&(parts.length===3||parts.length===5)){const result=await productAction(env.DB,job,actor,input,id,action);record=result.record;writes=result.writes}
 else if(category==='warranties'&&(parts.length===3||parts.length===5)){record=await warrantyAction(env.DB,job,actor,input,id,action);if(id&&['review','close'].includes(action!)){const item=job.warranties!.cases.find(c=>c.id===id)!;recordApproval(job,actor,'warranty.'+action,{id,prepared_by:item.recorded_by,revision:item.reviews.length},record)}}
 else if(category==='allowance-changes'&&id==='apply'&&parts.length===4)record=await applyAllowanceChange(env.DB,job,actor,input)
 else if(category==='remittances'&&(parts.length===3||parts.length===5)){const row=remittanceAction(job,actor,input,id,action);writes=await remittanceFields(env.DB,job,actor,row,input);record=row}
 else if(category==='invoices'&&(parts.length===3||parts.length===5)){const result=await invoiceAction(env.DB,job,actor,input,id,action);record=result.record;writes=result.writes}
 else if(category==='retainage'&&parts.length===3)record=configureRetainage(job,actor,input)
 else if(category==='retainage'&&parts.length===4&&id==='release')record=releaseRetainage(job,actor,input)
 else if(category==='sov'&&parts.length===3)record=prepareSov(job,actor,input)
 else if(category==='variation-pricing'&&id==='apply'&&parts.length===4)record=await preparePricedVariation(env.DB,job,actor,input)
 else if(category==='selections'&&parts.length===3)record=selectionAction(job,actor,input)
 else if(category==='selections'&&parts.length===5&&['substitute','reminder','dispute','withdraw'].includes(action!)){const result=await selectionDecision(env.DB,job,actor,input,id!,action!);record=result.record;writes=result.writes}
 else if(category==='selections'&&parts.length===5){if(action==='order'){requireJobManager(actor,true);record=prepareOrder(job,actor,selectionOrderInput(job,id!,String(input.revision_id),input))}else record=selectionAction(job,actor,input,id,action)}
 else if(category==='pricing'&&id==='apply'&&parts.length===4)record=await applyPricing(env.DB,job,actor,input)
 else if(category==='estimate-template'&&id==='apply'&&parts.length===4)record=await applyCatalog(env.DB,job,actor,input)
 else if(category==='schedule-constraints'&&(parts.length===3||parts.length===4)){const result=await constraintAction(env.DB,job,actor,input,id);record=result.record;writes=result.writes}
 else if(parts.length===4&&category==='schedule'&&id==='publish'){record=await publishSchedule(job,actor,input,await jobs(env.DB));recordRevision(job,actor,input)}
 else if(parts.length===4&&category==='schedule-template'&&id==='apply'){record=await applyScheduleTemplate(job,actor,input,await getScheduleTemplate(env.DB,String(input.template_id)),await jobs(env.DB));await applyJobTemplateTodos(env.DB,job,actor)}
 else if(category==='subcontracts'&&parts.length===5&&action==='access')record=await subcontractAccess(env.DB,job,actor,id!,input)
 else if(category==='subcontracts'&&parts.length===5&&action==='retainage')record=configureSupplierRetainage(job,actor,id!,input)
 else if(category==='subcontracts'&&parts.length===6&&action==='retainage'&&parts[5]==='release')record=releaseSupplierRetainage(job,actor,id!,input)
 else if(category==='subcontracts'&&parts.length>=5&&['lien','draws'].includes(action!)){const result=await lienAction(env.DB,job,actor,parts.slice(3),input);record=result.record;writes=result.writes}
 else if(parts.length===3&&['schedule-baseline','schedule-actuals'].includes(category))record=await scheduleBaselineAction(job,actor,input,category==='schedule-baseline'?'baseline':'actuals',await jobs(env.DB))
 else if(parts.length===3){switch(category){case 'customer':record=await linkCustomer(env.DB,job,actor,input);break;case 'subcontracts':{const awarded=await awardSubcontract(env.DB,job,actor,input);record=awarded.row;writes=awarded.writes;break}case 'quotes':record=prepareQuote(job,actor,input);break;case 'schedules':record=prepareSchedule(job,actor,input,await jobs(env.DB));break;case 'diary':{const prepared=await prepareDiary(env.DB,job,actor,input);record=prepared.row;writes=prepared.writes;break}case 'variations':record=prepareVariation(job,actor,input);break;case 'orders':record=prepareOrder(job,actor,input);break;case 'claims':{const claim=prepareClaim(job,actor,input);linkContinuityClaim(job,claim);record=claim;break;}default:throw new DomainError('not_found','Unknown action',404)}}
 else if(parts.length===5){switch(category+'/'+action){case 'quotes/accept':{record=acceptQuote(job,actor,id,input);const choice=object(input.schedule_choice);if(choice.kind==='template'){const schedule=object(choice.input);await applyScheduleTemplate(job,actor,schedule,await getScheduleTemplate(env.DB,String(schedule.template_id)),await jobs(env.DB));await applyJobTemplateTodos(env.DB,job,actor)}const budget=freezeOriginalBudget(job,actor,input);enqueueContinuity(job,actor,budget);break;}case 'schedules/move':case 'schedules/cancel':record=changeSchedule(job,actor,id,input,action,await jobs(env.DB));break;case 'schedules/approve':record=approveSchedule(job,actor,id,await jobs(env.DB));break;case 'diary/approve':record=approveDiary(job,actor,id);break;case 'variations/approve':record=approveVariation(job,actor,id);reviseBudget(job,actor,record as import('./model').Variation);const budget=job.budgets?.at(-1);if(budget)enqueueContinuity(job,actor,budget);break;case 'orders/issue':record=issueOrder(job,actor,id);break;case 'orders/receive':record=receiveOrder(job,actor,id,input);break;case 'orders/acknowledge':case 'orders/promise':case 'orders/ship':case 'orders/return':case 'orders/cancel':case 'orders/amend':case 'orders/approve-amendment':record=orderAction(job,actor,id!,action!,input);break;case 'claims/approve':record=approveClaim(job,actor,id);break;case 'subcontracts/release':record=await releaseSubcontract(env.DB,job,actor,id);break;case 'claims/issue':need(findSovClaim(job,id),'Only SOV applications use issue',409,'sov_required');record=exportClaim(job,actor,id,await today(env.DB));break;case 'claims/export':record=exportClaim(job,actor,id,await today(env.DB));break;default:throw new DomainError('not_found','Unknown action',404)}}else throw new DomainError('not_found','Unknown action',404)
 if(JSON.stringify(previous.schedules)!==JSON.stringify(job.schedules))await requireResources(env.DB,job,await jobs(env.DB),actor)
 enforceCostPeriods(previous,job,actor,input)
 refreshCostExceptions(job)
 if(category==='orders'&&['issue','approve-amendment','receive','ship'].includes(action??''))await requireSubmittalGate(env.DB,job,job.orders.find(o=>o.id===id)!,false,actor)
 await saveJob(env.DB,actor,previous,job,writes,clock)
 if(actor.role==='member'&&category==='invoices')record=invoiceProjection(job,actor).find(invoice=>invoice.id===id)
 if(actor.role==='member'&&category==='selections')record=selectionProjection(job,true).find(s=>s.id===id)
 if(actor.role==='member')record=projectEstimateCosts(record)
 return json({job:display((await named(env.DB,[job]))[0]!,actor),record,role:role(actor),...(category==='claims'&&action==='export'?{report:(record as {export:unknown}).export}:{})})
}
/** Each direct API request authenticates independently of document-route guards. */
export async function plinthResponse(request:Request,env:Bindings):Promise<Response|null>{if(!new URL(request.url).pathname.startsWith('/api/plinth/'))return null;try{const response=await mailPublicResponse(request,runtimeBindings(env)) ?? await payPublicResponse(request,runtimeBindings(env)) ?? await fieldTimeResponse(request,env) ?? await costResponse(request,env) ?? await selectionDelegationsResponse(request,env) ?? await warrantyServiceResponse(request,env) ?? await bidComparisonResponse(request,env) ?? await todosResponse(request,env) ?? await bidsResponse(request,env) ?? await handoverResponse(request,env) ?? await punchResponse(request,env) ?? await customersResponse(request,env) ?? await vendorsResponse(request,env) ?? await calendarFeed(request,env) ?? await handle(request,env);await auditExport(request,runtimeBindings(env).DB,authenticated.get(request),response.status);return await protectCosts(response,authenticated.get(request))}catch(error){if(error instanceof DomainError){const response=json({error:error.code,message:error.message,...(error.details?{details:error.details}:{})},error.status);if(error.status===429)response.headers.set('retry-after','60');return response;}const e=error as {status?:number;code?:string;message?:string};if(e.status&&e.status<500)return json({error:e.code??'forbidden',message:e.message??'Request refused'},e.status);console.error('Plinth request failed',error instanceof Error?error.message:'unknown error');return json({error:'server_error',message:'The request could not be completed'},500)}}
