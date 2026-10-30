import {canonicalJson,sha256,type Json,type SourceBundle} from '../modules/import-kit/src/d1/index'
import {active,need,stamp,text,usdOnly,type Actor,type Job} from './model'
import {prepareCostBill} from './cost-bills'
import {prepareCostSource} from './cost-labor'
import {costs,document} from './cost-model'
import {decimal} from './estimate-math'
import type {WorkbookDraft} from './workbook-import'

export const costWorkbookDigest=(input:Record<string,unknown>)=>sha256(canonicalJson(Object.fromEntries(Object.entries(input).filter(([key])=>key!=='fingerprint')) as Json))
/** Only native drafts are imported. Existing cost approval, separation and open-period gates still own posting. */
export async function costWorkbook(source:SourceBundle,draft:WorkbookDraft,previous:Job,actor:Actor,input:Record<string,unknown>,allJobs:Job[]){
 active(previous);usdOnly(previous);need(input.expected_version===previous.version,'Job changed; reload and preview the cost workbook again',409,'stale_version')
 const job=structuredClone(previous),state=costs(job),id=previous.id+':'+draft.artifact_sha256,by={...stamp(actor),at:draft.reviewed_at!}
 need(!state.workbook_imports?.some(i=>i.id===id),'This cost workbook already has a journal; use its original approval to inspect the result',409,'cost_duplicate')
 const mime=/\.xls$/i.test(draft.source_name)?'application/vnd.ms-excel':/\.xlsx$/i.test(draft.source_name)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv'
 const original=await document({name:draft.source_name,mime,base64:input.base64}),source_ids:string[]=[],bill_ids:string[]=[]
 for(let index=0;index<draft.lines.length;index++){
  const line=draft.lines[index]!,provenance=draft.provenance[index]!,values=Object.fromEntries(Object.entries(provenance.cells).map(([key,c])=>[key,c.value]))
  try{
   need(['time','expense','bill'].includes(values.kind),'Choose time, expense or bill source rows')
   if(values.kind==='bill'){
    need(draft.mapping.reviewed_tax,'Review supplier tax rates and taxable amounts before importing bills')
    need(values.taxable==='true'||values.taxable==='false','Map an explicit true or false taxable value')
    const vendor=text(values.vendor,'Supplier vendor',200),reference=text(values.reference,'Supplier invoice reference',200)
    need(!allJobs.some(j=>costs(j).bills.some(b=>b.vendor.trim().toLowerCase()===vendor.toLowerCase()&&b.reference.trim().toLowerCase()===reference.toLowerCase())),'Vendor invoice reference already exists in this installation')
    const bill=await prepareCostBill(job,actor,{kind:'bill',vendor:values.vendor,reference:values.reference,dated_on:values.dated_on,period:values.period,due_on:values.due_on,document:original,tax:{percent:values.tax_percent,reference:values.tax_reference,exemption_reference:values.tax_exemption,human_reviewed:true},lines:[{cost_code:line.cost_code,description:line.description,subtotal_cents:line.total_cents,taxable:values.taxable==='true',matches:[]}]},by,id+'-'+sha256(line.id!).slice(0,16))
    bill.workbook_import_id=id;state.bills.push(bill);bill_ids.push(bill.id);line.import_tax_cents=bill.tax.tax_cents;line.total_cents=bill.amount_cents;continue
   }
   let minutes:number|undefined
   if(values.kind==='time'){
    need(line.unit===line.rate_unit&&['hour','minute'].includes(line.unit!),'Time requires mapped hour or minute units with the same rate unit')
    const q=decimal(String(line.quantity),'Time quantity'),factor=line.unit==='hour'?60n:1n,n=q.numerator*factor
    need(n%q.denominator===0n,'Time must resolve to whole native minutes');minutes=Number(n/q.denominator)
   }
   const prepared=await prepareCostSource(job,actor,{kind:values.kind,reference:values.reference,employee_reference:values.employee_reference,cost_code:line.cost_code,dated_on:values.dated_on,period:values.period,...(minutes===undefined?{amount_cents:line.total_cents,document:original}:{minutes,hour_cents:line.unit==='hour'?line.unit_cents:line.unit_cents*60,burden_bps:0})},by,id+'-'+sha256(line.id!).slice(0,16))
   need(prepared.amount_cents===line.total_cents,'Native cost rounding differs from the imported value; correct the source before adoption')
   delete prepared.document;prepared.workbook_import_id=id;prepared.detail={...prepared.detail,source_row:provenance.row,source_id:line.id}
   state.sources.push(prepared);source_ids.push(prepared.id)
  }catch(error){draft.diagnostics.push({row:provenance.row,code:'native_cost',message:error instanceof Error?error.message:'Invalid native cost source',resolved:false})}
 }
 ;(state.workbook_imports??=[]).push({id,before_version:previous.version,input_digest:costWorkbookDigest(input),document:original,mapping:draft.mapping,provenance:draft.provenance,source_ids,bill_ids})
 draft.total_cents=draft.lines.reduce((total,line)=>total+line.total_cents,0)
 need(Number.isSafeInteger(draft.total_cents)&&draft.total_cents<=1_000_000_000_000,'Imported gross cost exceeds the supported range')
 job.version=previous.version+1
 need(canonicalJson(job as unknown as Json).length<=8_000_000,'Imported cost history is too large')
 const record=source.records[0]!,payload={draft,target_job:job,expected_version:previous.version} as unknown as Json
 record.sourceId+=':'+job.id;record.payload=payload;record.payloadHash=sha256(canonicalJson(payload))
 return {source,draft,canAdopt:source_ids.length+bill_ids.length>0&&draft.diagnostics.every(d=>d.resolved)}
}
