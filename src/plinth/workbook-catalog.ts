import { canonicalJson, sha256, type D1Database, type D1Sql, type D1TargetAdapter, type TargetRow, type Json } from '../modules/import-kit/src/d1/index.ts'
import { catalogValue } from './catalog-input'
import type { CatalogEntry } from './catalog-model'
import type { Actor, Stamp } from './model'
import { IMPORT_NAMESPACE } from './import-source'
import type { WorkbookDraft } from './workbook-import'

interface Snapshot { entries: CatalogEntry[]; dependencies: { table: string; id: string; data: string }[] }
const sql = (sql: string, ...params: unknown[]): D1Sql => ({sql,params})
const snapshot = (row: TargetRow): Snapshot => JSON.parse((row.value as {data:string}).data)
const scope = (destination: string, kind: string) => { if(destination!=='plinth-jobs'||kind!=='catalog-group')throw Error('IMPORT_TARGET_SCOPE') }
const dependencySql = (table: string) => `SELECT id,data FROM ${table} WHERE EXISTS(SELECT 1 FROM json_each(?) AS refs WHERE instr(${table}.data,refs.value)>0)${table==='pl_estimate_catalog'?' AND (import_group IS NULL OR import_group!=?)':''} ORDER BY id`
const dependencyParams=(table:string,ids:string[],group:string)=>[JSON.stringify(ids),...(table==='pl_estimate_catalog'?[group]:[])]
export function catalogEffect(draft: WorkbookDraft, actor: Actor, sourceId: string) {
 const group='catalog-'+sha256(`${IMPORT_NAMESPACE}:${sourceId}`).slice(0,32)
 const by: Stamp={id:actor.id,name:actor.name,role:actor.role,at:draft.reviewed_at!}
 const entries: CatalogEntry[]=draft.lines.map((line,i)=>({id:group+'-'+sha256(line.id!).slice(0,16),version:1,kind:'rate',name:line.description,revisions:[{version:1,name:line.description,reason:'Owner reviewed workbook import',approved_by:by,value:catalogValue('rate',{...draft.catalog_rates![i],unit:line.rate_unit,cost_cents:line.cost_unit_cents,sell_cents:line.unit_cents}),import_evidence:{artifact_sha256:draft.artifact_sha256,source_name:draft.source_name,cost_code:line.cost_code,provenance:draft.provenance[i]}}]}))
 entries.sort((a,b)=>a.id.localeCompare(b.id))
 return {targetKind:'catalog-group',targetId:group,value:{data:canonicalJson({entries,dependencies:[]}),version:1,attachments:[]}}
}
async function read(db:D1Database,destination:string,kind:string,id:string):Promise<TargetRow|undefined>{
 scope(destination,kind)
 const rows=await db.prepare('SELECT data,import_revision FROM pl_estimate_catalog WHERE import_group=? ORDER BY id').bind(id).all<{data:string;import_revision:string}>()
 if(!rows.results.length)return undefined
 const entries=rows.results.map(r=>JSON.parse(r.data) as CatalogEntry),ids=entries.map(e=>e.id),dependencies:Snapshot['dependencies']=[]
 for(const table of ['pl_jobs','pl_estimate_catalog']){
  const result=await db.prepare(dependencySql(table)).bind(...dependencyParams(table,ids,id)).all<{id:string;data:string}>()
  for(const row of result.results)if(!ids.includes(row.id))dependencies.push({table,...row})
 }
 return {destination,targetKind:kind,targetId:id,revision:rows.results[0]!.import_revision,value:{data:canonicalJson({entries,dependencies}),version:1,attachments:[]}}
}
function matchesParts(row:TargetRow|null,destination:string,kind:string,id:string):D1Sql[]{
 scope(destination,kind)
 if(!row)return [sql('NOT EXISTS(SELECT 1 FROM pl_estimate_catalog WHERE import_group=?)',id)]
 const current=snapshot(row),ids=current.entries.map(e=>e.id),checks=[sql('(SELECT count(*) FROM pl_estimate_catalog WHERE import_group=?)=?',id,ids.length)]
 for(const entry of current.entries)checks.push(sql('EXISTS(SELECT 1 FROM pl_estimate_catalog WHERE id=? AND version=? AND data=? AND import_group=? AND import_revision=?)',entry.id,entry.version,canonicalJson(entry as unknown as Json),id,row.revision))
 for(const table of ['pl_jobs','pl_estimate_catalog']){
  const deps=current.dependencies.filter(d=>d.table===table),query=dependencySql(table)
  checks.push(sql(`(SELECT count(*) FROM (${query}))=?`,...dependencyParams(table,ids,id),deps.length))
  for(const dep of deps)checks.push(sql(`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND data=?)`,dep.id,dep.data))
 }
 return checks
}
export const catalogImportTargets:D1TargetAdapter={read,matchesParts,matches(row,destination,kind,id){const parts=matchesParts(row,destination,kind,id);return sql(parts.map(p=>'('+p.sql+')').join(' AND '),...parts.flatMap(p=>p.params??[]))},
 write(row){scope(row.destination,row.targetKind);const current=snapshot(row);if(current.dependencies.length)throw Error('IMPORT_CATALOG_DEPENDENCIES');return [...current.entries.map(entry=>sql('INSERT INTO pl_estimate_catalog(id,version,data,import_group,import_revision) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data,import_group=excluded.import_group,import_revision=excluded.import_revision',entry.id,entry.version,canonicalJson(entry as unknown as Json),row.targetId,row.revision)),sql('UPDATE pl_clock SET version=version+1 WHERE id=1')]},
 remove(destination,kind,id){scope(destination,kind);return [sql('DELETE FROM pl_estimate_catalog WHERE import_group=?',id),sql('UPDATE pl_clock SET version=version+1 WHERE id=1')]},
 async list(db,destination){const groups=await db.prepare('SELECT DISTINCT import_group AS id FROM pl_estimate_catalog WHERE import_group IS NOT NULL ORDER BY import_group').all<{id:string}>();return Promise.all(groups.results.map(g=>read(db,destination,'catalog-group',g.id).then(r=>r!)))},
 matchesCount(count){return sql('(SELECT count(DISTINCT import_group) FROM pl_estimate_catalog WHERE import_group IS NOT NULL)=?',count)},
}
