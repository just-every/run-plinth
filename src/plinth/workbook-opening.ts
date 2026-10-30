import {canonicalJson,sha256,type Json,type SourceBundle} from '../modules/import-kit/src/d1/index'
import {readWorkbook,type Workbook} from './workbook-import'
import {openingRows,openingAmounts,type OpeningRow} from './workbook-opening-rows'
import {active,cents,need,object,stamp,sum,text,usdOnly,type Actor,type Job,type Stamp,type Claim} from './model'
import {costs,document} from './cost-model'
import {requireOpenCostPeriod} from './cost-periods'
import {period} from './cost-model'
import {localDate} from './remittances'
import {prepareSovApplication} from './sov'
import {reconcile} from './claims'
import {sourceTax,share} from './invoice-pricing'
import {lienPacket} from './lien-waiver-model'
import {costWorkbookDigest} from './workbook-costs'
export interface OpeningBalance {id:string;as_of:string;source_sha256:string;ledger_sha256:string;reviewed_by:Stamp;rows:OpeningRow[];provenance:unknown;ledger_provenance:unknown}
const mime=(name:string)=>/\.xls$/i.test(name)?'application/vnd.ms-excel':/\.xlsx$/i.test(name)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv'
export async function openingWorkbook(book:Workbook,input:Record<string,unknown>,previous:Job,actor:Actor){
 active(previous);usdOnly(previous);need(input.expected_version===previous.version,'Job changed; preview opening balances again',409,'stale_version')
 const source=openingRows(book,input.mapping),ledgerInput=object(input.ledger),ledger=await readWorkbook(ledgerInput),comparison=openingRows(ledger,ledgerInput.mapping)
 need(ledger.hash!==book.hash,'Supply the separate ledger snapshot, rather than the source workbook')
 const diagnostics=[...source.diagnostics,...comparison.diagnostics.map(d=>({...d,message:'Ledger: '+d.message}))]
 const reviewed_at=text(input.reviewed_at,'Preview review time',30);need(Number.isFinite(Date.parse(reviewed_at))&&new Date(reviewed_at).toISOString()===reviewed_at&&Date.parse(reviewed_at)<=Date.now()+60000&&Date.parse(reviewed_at)>=Date.now()-86400000,'Preview opening balances again before approving')
 const as_of=localDate(input.as_of,'Opening as-of date'),posting_period=period(input.posting_period??as_of.slice(0,7)),by={...stamp(actor),at:reviewed_at},id=previous.id+':'+book.hash
 if(input.ledger_reviewed!==true)diagnostics.push({code:'ledger_review',message:'Explicitly review the separately supplied ledger before financial adoption',resolved:false})
 const key=(row:OpeningRow)=>JSON.stringify([row.native_line_id,row.cost_code,...openingAmounts.map(k=>row[k])])
 if(source.rows.length!==comparison.rows.length||source.rows.some(row=>!comparison.rows.some(other=>key(other)===key(row))))diagnostics.push({code:'ledger_mismatch',message:'Source and supplied ledger must reconcile every native line, code and financial value',resolved:false})
 const totals=Object.fromEntries(openingAmounts.map(k=>[k,sum(source.rows.map(r=>r[k]))]))
 const draft={kind:'opening' as const,reviewed_at,source_name:book.name,artifact_sha256:book.hash,ledger_name:ledger.name,ledger_sha256:ledger.hash,as_of,posting_period,rows:source.rows,source_totals:source.raw_totals,target_totals:totals,ledger_totals:Object.fromEntries(openingAmounts.map(k=>[k,sum(comparison.rows.map(r=>r[k]))])),provenance:source.provenance,ledger_provenance:comparison.provenance,diagnostics}
 const job=structuredClone(previous),state=costs(job)
 if(!diagnostics.some(d=>!d.resolved)){
  need(!state.opening&&!state.entries.length&&!state.bills.length&&!state.sources.length&&!job.claims.length&&!(job.invoices??[]).length&&!(job.remittances??[]).length,'Opening adoption requires an accepted job with no existing actual costs, invoices, receipts or pay applications',409,'opening_history')
  requireOpenCostPeriod(job,posting_period)
  const sov=job.sov?.at(-1);need(sov,'Prepare the native priced SOV before mapping historical progress',409,'sov_required')
  need(source.rows.length===sov.lines.length&&sov.lines.every(line=>source.rows.some(r=>r.native_line_id===line.id&&r.cost_code===line.cost_code&&r.scheduled_cents===line.scheduled_cents)),'Source SOV must match every current native line, code and scheduled amount',409,'opening_sov')
  const progress=source.rows.map(row=>({line_id:row.native_line_id,completed_cents:row.completed_cents,stored_cents:row.stored_cents,evidence:'Owner-reviewed supplied opening workbook and ledger',order_ids:row.order_ids}))
  const gross=sum(source.rows.map(r=>r.completed_cents+r.stored_cents)),app=gross>0?prepareSovApplication(job,actor,{lines:progress}):undefined
  need(gross>=0,'Opening cumulative billed value cannot be negative');need(gross!==0||source.rows.every(r=>r.completed_cents+r.stored_cents===0),'Offsetting progress at zero total needs explicit native reconciliation')
  for(const row of source.rows){
   const line=sov.lines.find(l=>l.id===row.native_line_id)!,tax=line.source.kind==='quote'?sourceTax(sov.sources.quote.pricing).find(t=>t.line.id===line.source.line_id)?.tax:(()=>{const variation=sov.sources.variations.find(v=>v.id===line.source.id);return variation?sum(sourceTax(variation.pricing).map(t=>t.tax))*(variation.amount_cents<0?-1:1):undefined})()
   need(tax!==undefined,'Opening line needs its native reviewed tax source')
   const expectedTax=line.scheduled_cents<0?tax:line.scheduled_cents===0?0:share(row.completed_cents+row.stored_cents,tax,line.scheduled_cents)
   need(row.billed_tax_cents===expectedTax,'Opening billed tax must reconcile to the accepted native tax snapshot',409,'opening_tax')
   const retained=app?.retainage?.lines.find(l=>l.line_id===row.native_line_id)?.held_cents??0
   need(row.client_retainage_cents===retained,'Opening client retainage must reconcile to the reviewed native retainage plan',409,'opening_retainage')
   need(row.retainage_cents<=Math.max(0,row.actual_cents),'Supplier retainage exceeds its opening actual cost')
   if(row.actual_cents)state.entries.push({id:id+'-actual-'+sha256(row.native_line_id).slice(0,12),source_id:id,source_line_id:row.id,source_kind:'opening',cost_code:row.cost_code,amount_cents:cents(row.actual_cents,'Opening actual',true),dated_on:as_of,period:posting_period,matches:[],by})
  }
  state.opening={id,as_of,source_sha256:book.hash,ledger_sha256:ledger.hash,reviewed_by:by,rows:source.rows,provenance:source.provenance,ledger_provenance:comparison.provenance}
  if(app){app.prepared_by=by;const claim:Claim={id:'opening-progress-'+sha256(id).slice(0,32),description:'Owner-reviewed historical opening progress',cumulative_cents:gross,status:'exported',prepared_by:by,approved_by:by,exported_by:by,sov:app,reconciliation:reconcile(job,gross),imported_opening:{id,source_sha256:book.hash,ledger_sha256:ledger.hash,as_of}}
   claim.export={format:'plinth-progress-claim-v1',purpose:'Reviewed historical opening position from supplied records. Not a new invoice or payment request.',job_id:job.id,job_name:job.name,claim_id:claim.id,description:claim.description,reconciliation:structuredClone(claim.reconciliation),approved_by:by,lien_waivers:lienPacket(job.subcontracts??[],as_of),sov:structuredClone(app)};job.claims.push(claim)
  }
  const original=await document({name:book.name,mime:mime(book.name),base64:book.base64})
  ;(state.workbook_imports??=[]).push({id,before_version:previous.version,before_job_json:canonicalJson(previous as unknown as Json),input_digest:costWorkbookDigest(input),document:original,mapping:source.mapping,provenance:source.provenance,source_ids:[],bill_ids:[]})
  job.approvals.push({id:id+'-approval',kind:'move.opening.adopt',subject_id:id,revision:1,prepared_by:by,approved_by:by,decision:'approved',snapshot:{as_of,source_sha256:book.hash,ledger_sha256:ledger.hash,totals,rows:source.rows}})
  job.version=previous.version+1
 }
 const payload={draft,target_job:job,expected_version:previous.version} as unknown as Json
 const bundle:SourceBundle={diagnostics:[],artifacts:[book,ledger].map(b=>({name:b.name,sha256:b.hash,size:b.size,original:{status:'available',base64:b.base64}})),records:[{namespace:'accepted-jobs-csv',kind:'cost-workbook',sourceId:'opening:'+book.hash+':'+ledger.hash+':'+previous.id,payload,payloadHash:sha256(canonicalJson(payload)),artifactHash:book.hash,location:{artifact:book.name,pointer:String(source.mapping.sheet)}},{namespace:'accepted-jobs-csv',kind:'opening-ledger',sourceId:'opening-ledger:'+ledger.hash+':'+previous.id,payload:{target_job:{id:previous.id},rows:comparison.rows,provenance:comparison.provenance} as unknown as Json,payloadHash:sha256(canonicalJson({target_job:{id:previous.id},rows:comparison.rows,provenance:comparison.provenance} as unknown as Json)),artifactHash:ledger.hash,location:{artifact:ledger.name,pointer:String(comparison.mapping.sheet)}}]}
 return {draft,source:bundle,canAdopt:source.rows.length>0&&diagnostics.every(d=>d.resolved)}
}
