import { DomainError, find, need, object, stamp, text, type Actor, type Input, type Job } from './model'
import { readClock, transaction } from './store'
import { parseFieldDefinition, parseFieldValues, requireFieldsAtStage, validateFieldDefinitions, type ReportFieldDefinition, type ReportRecordScope } from './report-field-model'
import { financialId, reportColumns, reportRecordView, reportRecords } from './report-records'

export async function fieldConfig(db: D1Database) {
 const row = await db.prepare('SELECT version,data FROM pl_report_config WHERE id=1').first<{version:number;data:string}>()
 return { version:row?.version ?? 0, fields:JSON.parse(row?.data ?? '[]') as ReportFieldDefinition[] }
}
export function reportAudit(db: D1Database, actor: Actor, action: string, before: unknown, after: unknown) {
 return db.prepare('INSERT INTO oa_auth_audit(id,actor_id,action,value,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,`plinth.report.${action}`,JSON.stringify({before,after,by:stamp(actor)}),Date.now())
}
export async function saveField(db: D1Database, actor: Actor, input: Input) {
 need(actor.role === 'owner' || actor.role === 'admin', 'Only owners and administrators define custom fields',403,'forbidden')
 const clock=await readClock(db), config=await fieldConfig(db)
 need(input.expected_version===config.version,'Field definitions changed; reload',409,'stale_version')
 const previous=input.id===undefined?undefined:config.fields.find(f=>f.id===input.id), field=parseFieldDefinition(input,previous)
 need(!field.id.startsWith('native.'),'native. is reserved for built-in report columns')
 const fields=[...config.fields.filter(f=>f.id!==field.id),field];validateFieldDefinitions(fields)
 await transaction(db,actor,null,[db.prepare('INSERT INTO pl_report_config(id,version,data) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data').bind(config.version+1,JSON.stringify(fields)),reportAudit(db,actor,'field',previous,field)],clock)
 return {version:config.version+1,fields}
}
export async function saveValues(db:D1Database,actor:Actor,scope:ReportRecordScope,id:string,input:Input) {
 const clock=await readClock(db), config=await fieldConfig(db), record=find(await reportRecords(db,actor,scope),id)
 need(input.expected_version===record.version,'Custom values changed; reload',409,'stale_version')
 const stored=await db.prepare('SELECT data FROM pl_report_values WHERE record_scope=? AND record_id=?').bind(scope,id).first<{data:string}>()
 const previous=JSON.parse(stored?.data??'{}'), columns=reportColumns(config.fields,scope,actor)
 if(actor.permissions)for(const key of Object.keys(object(input.values)))need(columns.some(column=>column.id===key),'Unknown or unavailable custom field',403,'forbidden')
 const values=parseFieldValues(input.values,config.fields,scope,record.currency,previous)
 const stage=input.stage===undefined?record.stage:text(input.stage,'stage',80);need(stage.length>0&&stage.length<=80,'Stage must contain one to 80 characters')
 requireFieldsAtStage(config.fields,scope,stage,values)
 await transaction(db,actor,null,[db.prepare('INSERT INTO pl_report_values(record_scope,record_id,job_id,version,stage,data) VALUES(?,?,?,?,?,?) ON CONFLICT(record_scope,record_id) DO UPDATE SET version=excluded.version,stage=excluded.stage,data=excluded.data').bind(scope,id,record.job_id??null,record.version+1,stage,JSON.stringify(values)),reportAudit(db,actor,'values',{id,scope,version:record.version,field_ids:Object.keys(previous)},{id,scope,version:record.version+1,field_ids:Object.keys(values)})],clock)
 return reportRecordView({...record,version:record.version+1,stage,values:{...record.values,...values}},columns)
}
/** Real native lifecycle boundaries consult the same definitions as named custom stage transitions. */
export async function reportNativeGate(db:D1Database,job:Job,actor:Actor,category:string,id?:string,action?:string) {
 if(actor.role==='agent'||actor.role==='member'&&!(category==='variations'&&action==='approve'))return
 const jobStages=category==='quotes'&&action==='accept'?['active','construction']:category==='schedule'&&id==='publish'||category==='schedule-template'&&id==='apply'||category==='schedules'&&(action==='approve'||!id)?['construction']:[]
 const financialStage=category==='invoices'&&action==='issue'?'issued':category==='quotes'&&action==='accept'?'accepted':category==='orders'&&action==='issue'?'issued':category==='claims'&&action==='approve'?'approved':category==='claims'&&(action==='export'||action==='issue')?'exported':category==='variations'&&action==='approve'?'approved':category==='subcontracts'&&action==='release'?'released':null
 if(!jobStages.length&&!financialStage)return
 const config=await fieldConfig(db)
 const check=(scope:ReportRecordScope,stage:string,values:Parameters<typeof requireFieldsAtStage>[3])=>{try{requireFieldsAtStage(config.fields,scope,stage,values)}catch(error){if((actor.role==='member'||actor.role==='project_manager'&&scope==='financial')&&error instanceof DomainError&&error.code==='required_fields')throw new DomainError('required_fields','The office must complete required information before this decision.',409);throw error}}
 if(jobStages.length){const row=await db.prepare("SELECT data FROM pl_report_values WHERE record_scope='job' AND record_id=?").bind(job.id).first<{data:string}>();for(const stage of jobStages)check('job',stage,JSON.parse(row?.data??'{}'))}
 if(financialStage&&id){const kind=category==='invoices'?'invoice':category==='quotes'?'quote':category==='orders'?'order':category==='claims'?'claim':category==='variations'?'variation':'subcontract';const row=await db.prepare("SELECT data FROM pl_report_values WHERE record_scope='financial' AND record_id=?").bind(financialId(job.id,kind,id)).first<{data:string}>();check('financial',financialStage,JSON.parse(row?.data??'{}'))}
}
