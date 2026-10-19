import type { EstimateLineFields, EstimateQuoteFields } from './estimate-model'
import type { ScheduleConstraint } from './schedule-constraint-model'
import type { ScheduleBaselineFields } from './schedule-baseline-model'
import type { TaskDependency, WorkingCalendar } from './schedule-model'
import { timeZone } from './time-zone'
import type { Subcontract } from './subcontracts'
/** Money of a job: USD unless it is a labelled historical import. */
export const currencyOf = (job: { currency?: Currency }): Currency => job.currency ?? 'USD'
export type Input = Record<string, unknown>
export type Role = 'owner' | 'admin' | 'member' | 'agent'
export interface Actor { id: string; email: string; name: string; role: Role; version: number; session_id?: string; credential_id?: string; client_job_id?: string }
export interface Stamp { id: string; name: string; role: Role; at: string }
export interface Approval { id: string; kind: string; subject_id: string; revision: number; prepared_by: Stamp; approved_by: Stamp; decision: 'approved'; snapshot: unknown }
export interface Line extends EstimateLineFields { description: string; quantity: number | string; unit_cents: number; total_cents: number }
export interface Quote extends EstimateQuoteFields { id: string; revision: number; lines: Line[]; total_cents: number; notes: string; status: 'draft' | 'accepted' | 'superseded'; prepared_by: Stamp; acceptance?: { method: string; evidence: string; client_email: string; recorded_by: Stamp } }
export interface Schedule { id: string; trade: string; start: string; end: string; description: string; status: 'draft' | 'booked' | 'cancelled'; prepared_by: Stamp; revision?: number; updated_at?: string; owner?: string; duration_minutes?: number; milestone?: boolean; predecessors?: TaskDependency[] }
export interface Attachment { id: string; name: string; mime: string; checksum: string; size: number }
export interface Diary { id: string; date: string; note: string; attachments: Attachment[]; status: 'draft' | 'published'; prepared_by: Stamp }
export interface Variation { id: string; revision: number; description: string; amount_cents: number; status: 'draft' | 'approved'; prepared_by: Stamp; approved_by?: Stamp; carried_over?: string }
export interface Receipt { id: string; amount_cents: number; reference: string; recorded_by: Stamp }
export interface Order { id: string; supplier: string; description: string; amount_cents: number; status: 'draft' | 'issued'; receipts: Receipt[]; prepared_by: Stamp; issued_by?: Stamp }
export type Currency = 'USD' | 'AUD'
export interface Reconciliation { currency: Currency; base_cents: number; variation_cents: number; contract_cents: number; previous_cents: number; cumulative_cents: number; current_cents: number; remaining_cents: number; commitments_cents: number; received_cents: number; outstanding_cents: number; accepted_quote_id: string; variations: {id:string;amount_cents:number}[]; orders: {id:string;amount_cents:number;received_cents:number}[] }
export interface Claim { id: string; description: string; cumulative_cents: number; status: 'draft' | 'approved' | 'exported'; prepared_by: Stamp; reconciliation: Reconciliation; approved_by?: Stamp; exported_by?: Stamp; export?: {format:'plinth-progress-claim-v1';purpose:string;job_id:string;job_name:string;claim_id:string;description:string;reconciliation:Reconciliation;approved_by:Stamp} }
export interface Job extends ScheduleBaselineFields { schedule_constraints?: ScheduleConstraint[]; id: string; version: number; name: string; client_email: string; address: string; status: 'quoting' | 'active'; created_by: Stamp; quotes: Quote[]; schedules: Schedule[]; diary: Diary[]; variations: Variation[]; orders: Order[]; claims: Claim[]; approvals: Approval[]; import_evidence?: Record<string, unknown>; client_name?: string; customer_id?: string; property_id?: string; client_contact_ids?: string[]; schedule_calendar?: WorkingCalendar; schedule_critical_path?: string[]; schedule_published_actuals?: {task_id:string;actual_start:string;actual_finish?:string}[]; time_zone?: string; currency?: Currency; subcontracts?: Subcontract[] }
export class DomainError extends Error { constructor(public code:string, message:string, public status=400, public details?:unknown){super(message)} }
export function need(value:unknown,message:string,status=400,code='invalid',details?:unknown): asserts value {if(!value)throw new DomainError(code,message,status,details)}
export function object(value:unknown): Input {need(!!value&&typeof value==='object'&&!Array.isArray(value),'Expected an object'); return value as Input}
export function text(value:unknown,name:string,max=4000,optional=false):string {if(optional&&(value===undefined||value===null||value===''))return '';need(typeof value==='string'&&value.trim().length>0&&value.length<=max,`${name} is required (up to ${max} characters)`);return value.trim()}
export function cents(value:unknown,name='amount_cents',negative=false):number {need(typeof value==='number'&&Number.isSafeInteger(value)&&(negative||value>=0)&&Math.abs(value)<=1_000_000_000_000,`${name} must be integer cents within the supported range`);return value}
export function sum(values:number[]):number {const n=values.reduce((a,b)=>a+b,0);need(Number.isSafeInteger(n)&&Math.abs(n)<=1_000_000_000_000,'Money total exceeds supported range');return n}
export function stamp(actor:Actor):Stamp{return {id:actor.id,name:actor.name,role:actor.role,at:new Date().toISOString()}}
/** New business is USD; a job keeps the IANA time zone it was created in (default: the company's, else UTC). */
export function emptyJob(input:Input,actor:Actor,defaultZone='UTC'):Job {need(input.currency===undefined||input.currency==='USD','New jobs are priced in USD; historical AUD jobs arrive only through import',400,'currency');const zone=timeZone(input.time_zone??defaultZone);const email=text(input.client_email,'client_email',254).toLowerCase();need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Provide a client email');return {id:crypto.randomUUID(),version:1,name:text(input.name,'name',200),client_email:email,address:text(input.address,'address',500,true),status:'quoting',created_by:stamp(actor),quotes:[],schedules:[],diary:[],variations:[],orders:[],claims:[],approvals:[],...(zone==='UTC'?{}:{time_zone:zone})}}
export function find<T extends {id:string}>(rows:T[],id:string):T {const row=rows.find(r=>r.id===id);need(row,'Record not found',404,'not_found');return row}
export function recordApproval(job:Job,actor:Actor,kind:string,row:{id:string;prepared_by:Stamp;revision?:number},snapshot:unknown) {need(actor.role!=='agent','Agents prepare drafts; a person must approve',403,'human_required');job.approvals.push({id:crypto.randomUUID(),kind,subject_id:row.id,revision:row.revision??1,prepared_by:row.prepared_by,approved_by:stamp(actor),decision:'approved',snapshot:structuredClone(snapshot)})}
/** Catalog rates and reviewed tax are USD; they never price a historical job in another currency. */
export function usdOnly(job:Job){need(currencyOf(job)==='USD',`This historical ${currencyOf(job)} job keeps its own currency; USD catalog rates and tax cannot be applied to it`,409,'currency')}
export function active(job:Job){need(job.status==='active','Accept the quote before scheduling or recording job work',409,'quote_required')}
