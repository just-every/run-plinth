import {need,object,text,type Input} from './model'
import type {Cell,Workbook} from './workbook-import'
export const openingFields=['id','description','code','native_line_id','scheduled_cents','completed_cents','stored_cents','actual_cents','paid_cents','retainage_cents','collected_cents','client_retainage_cents','billed_tax_cents','order_ids'] as const
export const openingAmounts=openingFields.filter(k=>k.endsWith('_cents')) as ('scheduled_cents'|'completed_cents'|'stored_cents'|'actual_cents'|'paid_cents'|'retainage_cents'|'collected_cents'|'client_retainage_cents'|'billed_tax_cents')[]
export interface OpeningRow {id:string;description:string;cost_code:string;native_line_id:string;scheduled_cents:number;completed_cents:number;stored_cents:number;actual_cents:number;paid_cents:number;retainage_cents:number;collected_cents:number;client_retainage_cents:number;billed_tax_cents:number;order_ids:string[]}
export interface OpeningDiagnostic {row?:number;cell?:string;code:string;message:string;resolved:boolean}
export function openingRows(book:Workbook,value:unknown){
 const raw=object(value),sheet=book.sheets.find(s=>s.name===raw.sheet);need(sheet,'Choose the opening or ledger worksheet')
 need(raw.currency==='USD','Opening balances must explicitly use USD; currencies cannot be combined')
 const cols=object(raw.columns),columns:Record<string,string>={},codes=object(raw.codes),excluded=raw.excluded_rows===undefined?{}:object(raw.excluded_rows)
 for(const field of openingFields){if(cols[field]!==undefined&&cols[field]!==''){const col=text(cols[field],field,2);need(/^[A-Z]{1,2}$/.test(col),'Map financial fields to column letters');columns[field]=col}else need(field==='order_ids',`Map the ${field} column`)}
 for(const code of Object.values(codes))need(typeof code==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(code),'Map valid target cost codes')
 need(raw.duplicates==='reject'||raw.duplicates==='skip-identical','Choose duplicate handling')
 const rows:OpeningRow[]=[],provenance:{row:number;cells:Record<string,Cell>}[]=[],diagnostics:OpeningDiagnostic[]=book.problems.map(message=>({code:'unsupported_content',message,resolved:false})),seen=new Map<string,string>(),raw_totals:Record<string,number|null>=Object.fromEntries(openingAmounts.map(k=>[k,0]))
 for(const row of sheet.rows.slice(1)){
  if(!row.cells.some(c=>c.value||c.formula))continue
  const cells:Record<string,Cell>={}
  for(const [field,col] of Object.entries(columns)){let index=0;for(const letter of col)index=index*26+letter.charCodeAt(0)-64;cells[field]=row.cells[index-1]??{value:'',address:col+row.number}}
  const values=Object.fromEntries(Object.entries(cells).map(([key,cell])=>[key,cell.value])),amounts:Record<string,number>={}
  for(const field of openingAmounts){const cell=cells[field]!,valid=!cell.problem&&(!cell.formula||raw.reviewed_formulas===true)&&/^-?(0|[1-9]\d*)$/.test(cell.value)&&Number.isSafeInteger(Number(cell.value))&&Math.abs(Number(cell.value))<=1_000_000_000_000;if(valid){amounts[field]=Number(cell.value);if(raw_totals[field]!==null)raw_totals[field]!+=Number(cell.value)}else raw_totals[field]=null}
  if(excluded[String(row.number)]!==undefined){const reason=text(excluded[String(row.number)],'Exclusion reason',2000);diagnostics.push({row:row.number,code:'excluded',message:reason,resolved:true});continue}
  const problem=Object.values(cells).find(c=>c.problem||c.formula&&raw.reviewed_formulas!==true)
  if(problem){diagnostics.push({row:row.number,cell:problem.address,code:'formula_review',message:problem.problem??'Review the saved formula cache before adoption',resolved:false});continue}
  try{
   need(openingAmounts.every(k=>amounts[k]!==undefined),'Financial values must be exact signed whole cents')
   const id=text(values.id,'Source id',100),serialized=JSON.stringify(values),prior=seen.get(id)
   if(prior!==undefined){const resolved=raw.duplicates==='skip-identical'&&prior===serialized;diagnostics.push({row:row.number,code:'duplicate',message:resolved?'Identical financial row omitted':'Resolve the duplicate financial source id',resolved});continue}seen.set(id,serialized)
   const cost_code=codes[values.code];need(typeof cost_code==='string',`Unmapped or invalid cost code: ${values.code}`)
   need(amounts.stored_cents>=0&&amounts.retainage_cents>=0&&amounts.client_retainage_cents>=0,'Stored values and retainage cannot be negative')
   const lineIds=raw.line_ids===undefined?{}:object(raw.line_ids),nativeLine=lineIds[values.native_line_id]??values.native_line_id
   const result={id,description:text(values.description,'Source description',500),cost_code,native_line_id:text(nativeLine,'Native SOV line',200),...amounts,order_ids:(values.order_ids??'').split(';').map(s=>s.trim()).filter(Boolean)} as unknown as OpeningRow
   need(!rows.some(r=>r.native_line_id===result.native_line_id),'Each native SOV line must have one financial row')
   rows.push(result);provenance.push({row:row.number,cells})
  }catch(error){diagnostics.push({row:row.number,code:'invalid_row',message:error instanceof Error?error.message:'Invalid financial row',resolved:false})}
 }
 for(const field of openingAmounts)if(raw_totals[field]!==null)need(Number.isSafeInteger(raw_totals[field])&&Math.abs(raw_totals[field]!)<=1_000_000_000_000,'Financial source totals exceed the supported range')
 need(Object.keys(excluded).every(n=>sheet.rows.slice(1).some(r=>String(r.number)===n)),'Excluded financial row is absent from the sheet')
 return {mapping:raw,rows,provenance,diagnostics,raw_totals}
}
