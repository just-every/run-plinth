import { need, object, recordApproval, text, type Actor, type Input, type Job } from './model'
import { requireOwner } from './auth'

/** Feature restrictions only subtract from current record grants. An enabled feature never creates a job, company or record grant. */
export const CLIENT_FEATURES = ['contracts','selections','changes','schedule','photos','billing','todos','handover','punch','rfis'] as const
export const SUB_FEATURES = ['bids','schedule','todos','punch','rfis','bills','compliance'] as const
export type PortalKind = 'client' | 'subcontractor'
export interface PortalPolicy { client: string[]; subcontractor: string[] }
export function portalEnabled(job: Job, kind: PortalKind, feature: string) { return !(job.portal_policy?.[kind] ?? []).includes(feature) }
export function requirePortalFeature(job: Job, kind: PortalKind, feature: string) { need(portalEnabled(job,kind,feature),'Portal record not found',404,'not_found') }
export function portalPolicy(job: Job, actor: Actor, input: Input) {
 requireOwner(actor)
 const value=object(input.disabled), next:PortalPolicy={client:[],subcontractor:[]}
 for(const kind of ['client','subcontractor'] as const){
  const allowed:readonly string[]=kind==='client'?CLIENT_FEATURES:SUB_FEATURES, raw=value[kind]
  need(Array.isArray(raw)&&raw.length<=allowed.length,'Supply disabled feature lists for both presets')
  const fields=raw.map(v=>text(v,'Portal feature',40));need(fields.every(v=>allowed.includes(v))&&new Set(fields).size===fields.length,'Choose unique supported portal features')
  next[kind]=fields
 }
 const before=structuredClone(job.portal_policy??{client:[],subcontractor:[]});job.portal_policy=next
 const by={id:job.id,prepared_by:job.created_by};recordApproval(job,actor,'portal.policy',by,{before,after:next,reason:text(input.reason,'Access change reason',2000)})
 return next
}
/** All existing direct client routes use the same feature as their job projection. */
export function clientRouteFeature(category:string):string|undefined {
 return ({quotes:'contracts',selections:'selections','allowance-changes':'selections','decision-files':'selections',variations:'changes',schedules:'schedule',calendar:'schedule',diary:'photos',invoices:'billing',claims:'billing',remittances:'billing',todos:'todos',handover:'handover',punch:'punch',rfis:'rfis','rfi-files':'rfis'} as Record<string,string>)[category]
}
export function clientPolicyProjection<T extends Job>(shown:T,source:Job):T {
 const next=structuredClone(shown)
 const blank=(feature:string,fields:string[])=>{if(!portalEnabled(source,'client',feature))for(const field of fields)(next as unknown as Record<string,unknown>)[field]=field==='handover'||field==='punch'?undefined:[]}
 blank('contracts',['quotes','budgets']);blank('selections',['selections']);blank('changes',['variations']);blank('schedule',['schedules','schedule_baselines','schedule_revisions','schedule_published_actuals','schedule_actuals','schedule_critical_path']);blank('photos',['diary']);blank('billing',['invoices','claims']);blank('handover',['handover']);blank('punch',['punch'])
 if(!portalEnabled(source,'client','schedule'))next.schedule_template=undefined
 if(!portalEnabled(source,'client','billing'))next.invoice_deposit_liability_cents=undefined
 // Approval snapshots may contain the same record in another shape; never retain a disabled feature through history.
 next.approvals=next.approvals.filter(a=>{const f=a.kind.startsWith('selection.')?'selections':a.kind.startsWith('schedule')?'schedule':a.kind==='quote'?'contracts':a.kind==='variation'?'changes':a.kind==='diary'?'photos':undefined;return !!f&&portalEnabled(source,'client',f)})
 next.portal_policy=undefined;next.portal_submissions=undefined
 return next
}
