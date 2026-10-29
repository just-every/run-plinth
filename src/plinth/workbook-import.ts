import { catalogValue } from './catalog-input'
import type { VendorRate } from './catalog-model'
import { readXls } from './workbook-xls'
import { Buffer } from 'node:buffer'
import JSZip from 'jszip'
import { DOMParser, type Document, type Element } from '@xmldom/xmldom'
import { canonicalJson, sha256, type SourceBundle, type Json } from '../modules/import-kit/src/d1/index.ts'
import { IMPORT_LIMITS, IMPORT_NAMESPACE, csvCells } from './import-source.ts'
import { DomainError, need, object, text, type Line } from './model.ts'
import { lineCents, measurement } from './estimate-math.ts'
import { standardConversion } from './us-conventions.ts'
import { estimateLines } from './estimate-input.ts'

export interface Cell { value: string; address: string; formula?: string; problem?: string }
export interface Sheet { name: string; rows: { number: number; cells: Cell[] }[] }
export interface Workbook { name: string; hash: string; base64: string; size: number; sheets: Sheet[]; problems: string[] }
export const workbookFields = ['id', 'description', 'code', 'phase', 'category', 'quantity', 'unit', 'rate_unit', 'unit_cents', 'cost_unit_cents', 'vendor', 'effective_on', 'reference', 'kind', 'dated_on', 'period', 'employee_reference', 'due_on', 'tax_percent', 'tax_reference', 'taxable', 'tax_exemption'] as const
export type WorkbookField = typeof workbookFields[number]
interface Mapping { purpose: 'estimate' | 'catalog' | 'costs'; sheet: string; columns: Partial<Record<WorkbookField, string>>; codes: Record<string,string>; units: Record<string,string>; currency: 'USD' | 'AUD'; duplicates: 'reject' | 'skip-identical'; reviewed_formulas: boolean; reviewed_tax: boolean; excluded_rows: Record<string,string> }
interface Diagnostic { row?: number; cell?: string; code: string; message: string; resolved: boolean }
interface RowTotal { row: number; total_cents: number | null; cost_total_cents: number | null; disposition: 'included' | 'excluded' | 'duplicate' | 'rejected' }
export interface WorkbookDraft { kind: 'estimate' | 'catalog' | 'costs'; reviewed_at?: string; catalog_rates?: VendorRate[]; name: string; client_email: string; address: string; currency: 'USD' | 'AUD'; lines: (Line & {import_tax_cents?:number})[]; total_cents: number; cost_total_cents?: number; mapping: Mapping; provenance: { row: number; cells: Record<string, Cell> }[]; diagnostics: Diagnostic[]; artifact_sha256: string; source_name: string; source_totals: { total_cents: number | null; cost_total_cents: number | null; rows: RowTotal[] } }
const fail = (message: string): never => { throw new DomainError('invalid_workbook', message) }
const nodes = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagName(tag))
const content = (node: Element, tag: string) => nodes(node, tag)[0]?.textContent ?? ''
function xml(value: string): Document {
 if (/<!DOCTYPE|<!ENTITY/i.test(value)) fail('Workbook XML entities are unsupported')
 try { return new DOMParser({onError: () => { throw new Error('xml') }}).parseFromString(value, 'application/xml') } catch { return fail('Workbook XML is malformed') }
}
function column(index: number): string { let label=''; for(let n=index+1;n>0;n=Math.floor((n-1)/26))label=String.fromCharCode(65+(n-1)%26)+label; return label }
/** A deliberately small formula vocabulary. We never evaluate formulas or access external links. */
function supportedFormula(formula: string): boolean {
 const cellOrNumber = '(?:\\$?[A-Z]{1,3}\\$?[1-9]\\d*|\\d+(?:\\.\\d+)?)'
 const arithmetic = new RegExp(`^${cellOrNumber}(?:\\s*[+*/-]\\s*${cellOrNumber})*$`)
 return arithmetic.test(formula.trim()) || /^SUM\(\$?[A-Z]{1,3}\$?[1-9]\d*(?::\$?[A-Z]{1,3}\$?[1-9]\d*)?(?:,\$?[A-Z]{1,3}\$?[1-9]\d*(?::\$?[A-Z]{1,3}\$?[1-9]\d*)?)*\)$/.test(formula.trim())
}
export async function readWorkbook(input: Record<string,unknown>): Promise<Workbook> {
 const name = text(input.name, 'File name', 200)
 need(/\.(csv|xls|xlsx)$/i.test(name), 'Choose a UTF-8 CSV, XLS or XLSX file; macro-enabled workbooks are unsupported')
 need(typeof input.base64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) && input.base64.length % 4 === 0, 'Provide base64 file bytes')
 const bytes = Buffer.from(input.base64, 'base64')
 need(bytes.length > 0 && bytes.length <= IMPORT_LIMITS.bytes, 'Workbook must contain at most 256 KiB')
 need(bytes.toString('base64') === input.base64, 'Provide canonical base64 file bytes')
 const book: Workbook = {name,hash:sha256(bytes),base64:input.base64,size:bytes.length,sheets:[],problems:[]}
 if (/\.csv$/i.test(name)) {
  let value: string
  try { value=new TextDecoder('utf-8',{fatal:true}).decode(bytes) } catch { return fail('CSV must be valid UTF-8') }
  need(!value.includes('\0'), 'CSV contains invalid text')
  book.sheets=[{name:'CSV',rows:csvCells(value).map((values,i)=>({number:i+1,cells:values.map((value,j)=>({value,address:column(j)+(i+1)}))}))}]
 } else if (/\.xls$/i.test(name)) {
  const legacy=readXls(bytes);book.sheets=legacy.sheets;book.problems=legacy.problems
 } else {
  let zip: JSZip
  try { zip=await JSZip.loadAsync(bytes) } catch { return fail('Choose a valid unencrypted XLSX workbook') }
  const entries=Object.values(zip.files)
  need(entries.length<=200, 'Workbook contains too many package parts')
  // Check declared expanded sizes before decompression, then actual sizes as well.
  let expanded=0
  for(const entry of entries){expanded+=Number((entry as unknown as {_data?:{uncompressedSize:number}})._data?.uncompressedSize??0);need(expanded<=2_000_000,'Workbook expanded content exceeds 2 MB')}
  const part=async(path:string)=>{const file=zip.file(path);need(file,`Workbook part is missing: ${path}`);const value=await file.async('string');need(value.length<=1_000_000,'Workbook XML is too large');return xml(value)}
  if(entries.some(e=>/vbaProject|macrosheet|externalLinks|activeX/i.test(e.name)))book.problems.push('Macros, external links and active content are unsupported; remove them from a copy before adoption.')
  const strings=zip.file('xl/sharedStrings.xml')?nodes(await part('xl/sharedStrings.xml'),'si').map(si=>nodes(si,'t').map(t=>t.textContent??'').join('')):[]
  const relations=nodes(await part('xl/_rels/workbook.xml.rels'),'Relationship')
  const workbook=await part('xl/workbook.xml'),sheets=nodes(workbook,'sheet')
  need(sheets.length>0&&sheets.length<=10,'Choose a workbook with 1–10 sheets')
  for(const sheet of sheets){
   const relation=relations.find(r=>r.getAttribute('Id')===sheet.getAttribute('r:id')),target=relation?.getAttribute('Target')??''
   need(relation?.getAttribute('TargetMode')!=='External' && /^\/?(?:xl\/)?worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(target),'Unsupported worksheet relationship')
   const path=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:'xl/'+target
   const rows=nodes(await part(path),'row').map((row,i)=>{
    const number=Number(row.getAttribute('r')||i+1)
    need(Number.isInteger(number)&&number>0&&number<=10000,'Unsupported worksheet row')
    const cells: Cell[]=[]
    for(const c of nodes(row,'c')){
     const address=c.getAttribute('r')??'',match=/^([A-Z]{1,2})([1-9]\d*)$/.exec(address)
     need(match&&Number(match[2])===number,'Worksheet cells need exact row addresses')
     let index=0;for(const letter of match[1])index=index*26+letter.charCodeAt(0)-64;index--
     need(index<100&&!cells[index],'Worksheet has too many or duplicate columns')
     const kind=c.getAttribute('t'),raw=content(c,'v'),f=nodes(c,'f')[0]
     let value=kind==='s'?strings[Number(raw)]:kind==='inlineStr'?nodes(c,'t').map(t=>t.textContent??'').join(''):raw
     const problem=kind==='e'?'Cell contains an Excel error':!['n','s','inlineStr','str',null,''].includes(kind)?'Unsupported cell value type':value===undefined?'Shared string is unavailable':f&&(!supportedFormula(f.textContent??'')||f.hasAttribute('t'))?'Unsupported formula; replace it with reviewed literal values':f&&!raw?'Formula has no cached value; recalculate and save it in the source workbook':undefined
     cells[index]={value:value??'',address,...(f?{formula:f.textContent??''}:{}),...(problem?{problem}:{})}
    }
    return {number,cells:Array.from({length:cells.length},(_,j)=>cells[j]??{value:'',address:column(j)+number})}
   })
   need(rows.length<=IMPORT_LIMITS.rows+1,'Worksheet exceeds 100 data rows')
   need(new Set(rows.map(r=>r.number)).size===rows.length,'Worksheet has duplicate row numbers')
   book.sheets.push({name:sheet.getAttribute('name')??'',rows})
  }
 }
 for(const sheet of book.sheets)need(sheet.rows.length>0&&sheet.rows[0].number===1,'Each worksheet needs a header in row 1')
 return book
}
export function workbookInspection(book: Workbook) { return {name:book.name,sha256:book.hash,problems:book.problems,sheets:book.sheets.map(s=>({name:s.name,columns:s.rows[0].cells.map((c,i)=>({column:column(i),label:c.value})),rows:s.rows.length-1}))} }
function stringMap(value: unknown, name: string): Record<string,string> { const result: Record<string,string>=Object.create(null); for(const [key,val] of Object.entries(value===undefined?{}:object(value))){need(key.length<=100,`${name} key is too long`);result[key]=text(val,name,200)} return result }
export function workbookSource(book: Workbook, input: Record<string,unknown>): {source:SourceBundle;draft:WorkbookDraft;canAdopt:boolean} {
 const raw=object(input.mapping),sheet=book.sheets.find(s=>s.name===raw.sheet)
 need(sheet,'Choose a worksheet')
 const purpose=raw.purpose??'estimate';need(purpose==='estimate'||purpose==='catalog'||purpose==='costs','Choose estimate, catalog or cost draft import')
 const rawColumns=object(raw.columns),columns: Mapping['columns']={}
 for(const key of workbookFields){if(rawColumns[key]!==undefined&&rawColumns[key]!==''){const col=text(rawColumns[key],key,2);need(/^[A-Z]{1,2}$/.test(col),'Map fields to column letters');columns[key]=col}}
 const required:WorkbookField[]=purpose==='costs'?['id','description','code','quantity','unit','unit_cents','kind','dated_on','period','reference']:purpose==='catalog'?['id','description','code','unit','unit_cents','cost_unit_cents','vendor','effective_on','reference']:['id','description','code','phase','category','quantity','unit','unit_cents']
 for(const key of required)need(columns[key],`Map the ${key} column`)
 need(raw.currency==='USD'||raw.currency==='AUD','Choose USD or historical AUD currency')
 need(raw.duplicates==='reject'||raw.duplicates==='skip-identical','Choose duplicate handling')
 need(purpose==='estimate'||raw.currency==='USD','Native rate catalogs are USD; historical AUD estimates stay separate')
 const mapping:Mapping={purpose,sheet:sheet.name,columns,codes:stringMap(raw.codes,'Code mapping'),units:stringMap(raw.units,'Unit mapping'),currency:raw.currency,duplicates:raw.duplicates,reviewed_formulas:raw.reviewed_formulas===true,reviewed_tax:raw.reviewed_tax===true,excluded_rows:stringMap(raw.excluded_rows,'Exclusion reason')}
 for(const code of Object.values(mapping.codes))need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(code),'Target cost codes must use letters, digits, dots, underscores or hyphens')
 const email=purpose!=='estimate'?'':text(input.client_email,'Client email',254).toLowerCase();need(purpose!=='estimate'||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Provide a client email')
 const catalog_rates:VendorRate[]=[]
 const reviewed_at=purpose!=='estimate'?text(input.reviewed_at,'Preview review time',30):undefined
 if(reviewed_at)need(Number.isFinite(Date.parse(reviewed_at))&&new Date(reviewed_at).toISOString()===reviewed_at&&Date.parse(reviewed_at)<=Date.now()+60000&&Date.parse(reviewed_at)>=Date.now()-86400000,'Preview the catalog again before approving')
 const sourceRows: RowTotal[]=[]
 const diagnostics: Diagnostic[]=book.problems.map(message=>({code:'unsupported_content',message,resolved:false})),lines:Line[]=[],provenance:WorkbookDraft['provenance']=[],seen=new Map<string,string>()
 for(const row of sheet.rows.slice(1)){
  if(!row.cells.some(c=>c.value||c.formula))continue
  const fields:Record<string,Cell>={};for(const [key,col] of Object.entries(columns)){let i=0;for(const letter of col)i=i*26+letter.charCodeAt(0)-64;fields[key]=row.cells[i-1]??{value:'',address:col+row.number}}
  const sourceTotal:RowTotal={row:row.number,total_cents:null,cost_total_cents:null,disposition:'rejected'}
  sourceRows.push(sourceTotal)
  const values=Object.fromEntries(Object.entries(fields).map(([key,c])=>[key,c.value]));if(purpose==='catalog'){values.quantity='1';values.phase='Catalog';values.category='material'}else if(purpose==='costs'){values.phase='Imported cost';values.category=values.kind==='time'?'labor':'other'}
  // Raw totals include omitted and duplicate rows. An unsupported value remains unknown.
  try {
   need(!Object.values(fields).some(c=>c.problem||c.formula&&!mapping.reviewed_formulas),'Source values need review')
   const quantity=measurement(values.quantity),unit=mapping.units[values.unit],rateUnit=mapping.units[values.rate_unit||values.unit]
   need(unit&&rateUnit,'Map units before comparing source totals')
   const conversion=standardConversion(unit,rateUnit)??undefined;need(unit===rateUnit||conversion,'Unsupported unit conversion')
   const rate=(key:string)=>{need(/^(0|[1-9]\d*)$/.test(values[key])&&Number.isSafeInteger(Number(values[key])), 'Invalid source cents');return Number(values[key])}
   sourceTotal.total_cents=lineCents(quantity,rate('unit_cents'),conversion)
   if(values.cost_unit_cents)sourceTotal.cost_total_cents=lineCents(quantity,rate('cost_unit_cents'),conversion)
  }catch { /* The preview reports unknown rather than inventing a source amount. */ }
  const reason=mapping.excluded_rows[String(row.number)]
  if(reason){sourceTotal.disposition='excluded';diagnostics.push({row:row.number,code:'excluded',message:reason,resolved:true});continue}
  const problem=Object.values(fields).find(c=>c.problem||c.formula&&!mapping.reviewed_formulas)
  if(problem){diagnostics.push({row:row.number,cell:problem.address,code:problem.problem?'formula_or_cell':'formula_review',message:problem.problem??'Review the cached formula values before adopting',resolved:false});continue}
  const rowHash=canonicalJson(values),previous=seen.get(values.id)
  if(previous!==undefined){sourceTotal.disposition='duplicate';const resolved=mapping.duplicates==='skip-identical'&&previous===rowHash;diagnostics.push({row:row.number,code:'duplicate',message:resolved?'Identical duplicate omitted':'Duplicate source id; exclude or correct the conflicting row',resolved});continue}
  seen.set(values.id,rowHash)
  try {
   need(mapping.codes[values.code],`Unmapped or invalid cost code: ${values.code}`)
   need(mapping.units[values.unit],`Unmapped measurement unit: ${values.unit}`)
   if(values.rate_unit)need(mapping.units[values.rate_unit],`Unmapped rate unit: ${values.rate_unit}`)
   const amount=(key:string)=>{const value=values[key];need(/^(0|[1-9]\d*)$/.test(value),`${key} must contain exact whole cents`);const n=Number(value);need(Number.isSafeInteger(n),`${key} is too large`);return n}
   need(purpose!=='catalog'||!values.rate_unit||mapping.units[values.rate_unit]===mapping.units[values.unit],'Catalog rates need the same source and rate unit')
   const rate=purpose==='catalog'?catalogValue('rate',{vendor:values.vendor,effective_on:values.effective_on,reference:values.reference,unit:mapping.units[values.rate_unit||values.unit],cost_cents:amount('cost_unit_cents'),sell_cents:amount('unit_cents')}) as VendorRate:undefined
   const line=estimateLines({lines:[{id:values.id,description:values.description,cost_code:mapping.codes[values.code],phase:values.phase,category:values.category,quantity:values.quantity,unit:mapping.units[values.unit],...(values.rate_unit?{rate_unit:mapping.units[values.rate_unit]}:{}),unit_cents:amount('unit_cents'),...(values.cost_unit_cents?{cost_unit_cents:amount('cost_unit_cents')}:{})}]}).lines[0]
   sourceTotal.disposition='included';if(rate)catalog_rates.push(rate);lines.push(line);provenance.push({row:row.number,cells:fields})
  }catch(error){diagnostics.push({row:row.number,code:'invalid_row',message:error instanceof DomainError?error.message:'Invalid estimate row',resolved:false})}
 }
 for(const excluded of Object.keys(mapping.excluded_rows))need(sheet.rows.slice(1).some(r=>String(r.number)===excluded),'Excluded row is not in the selected sheet')
 const total_cents=lines.reduce((total,line)=>total+line.total_cents,0),cost=lines.every(l=>l.cost_total_cents!==undefined)?lines.reduce((total,line)=>total+line.cost_total_cents!,0):undefined
 need(Number.isSafeInteger(total_cents)&&total_cents<=1_000_000_000_000,'Estimate total exceeds the supported range')
 need(cost===undefined||Number.isSafeInteger(cost)&&cost<=1_000_000_000_000,'Estimate cost total exceeds the supported range')
 const sourceTotal=(key:'total_cents'|'cost_total_cents')=>{const value=sourceRows.every(r=>r[key]!==null)?sourceRows.reduce((sum,r)=>sum+r[key]!,0):null;return value!==null&&Number.isSafeInteger(value)&&value<=1_000_000_000_000?value:null}
 const source_totals={total_cents:sourceTotal('total_cents'),cost_total_cents:sourceTotal('cost_total_cents'),rows:sourceRows}
 const draft:WorkbookDraft={kind:purpose,...(reviewed_at?{reviewed_at,catalog_rates}:{}),name:text(input.title,'Estimate title',200),client_email:email,address:text(input.address,'Site address',500,true),currency:mapping.currency,lines,total_cents,...(cost===undefined?{}:{cost_total_cents:cost}),mapping,provenance,diagnostics,source_totals,artifact_sha256:book.hash,source_name:book.name}
 const payload=draft as unknown as Json
 return {draft,canAdopt:lines.length>0&&diagnostics.every(d=>d.resolved),source:{diagnostics:[],artifacts:[{name:book.name,sha256:book.hash,size:book.size,original:{status:'available',base64:book.base64}}],records:[{namespace:IMPORT_NAMESPACE,kind:purpose==='catalog'?'catalog-workbook':purpose==='costs'?'cost-workbook':'coded-workbook',sourceId:(purpose==='catalog'?'catalog-workbook:':purpose==='costs'?'cost-workbook:':'workbook:')+book.hash,payload,payloadHash:sha256(canonicalJson(payload)),artifactHash:book.hash,location:{artifact:book.name,pointer:sheet.name}}]}}
}
