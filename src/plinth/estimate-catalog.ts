import { requireRateAccess } from './auth'
import { need, object, stamp, text, type Actor, type Input } from './model'
import { catalogValue } from './catalog-input'
import { readClock, transaction } from './store'
import type { Assembly, CatalogEntry, EstimateTemplate } from './catalog-model'
export async function catalogEntry(db:D1Database,id:string,kind?:CatalogEntry['kind']):Promise<CatalogEntry> {const row=await db.prepare('SELECT data FROM pl_estimate_catalog WHERE id=?').bind(id).first<{data:string}>();need(row,'Catalog record not found',404,'not_found');const entry=JSON.parse(row.data) as CatalogEntry;need(!kind||entry.kind===kind,'Wrong catalog record kind');return entry}
export async function catalogResponse(request:Request,db:D1Database,actor:Actor,parts:string[],readBody:(r:Request)=>Promise<Input>):Promise<Response|null> {
 if(parts[0]!=='estimate-catalog')return null
 requireRateAccess(actor,request.method);need(parts.length<=2,'Unknown catalog route',404,'not_found')
 const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
 if(request.method==='GET'){const rows=await db.prepare('SELECT data FROM pl_estimate_catalog ORDER BY rowid').all<{data:string}>();return Response.json({entries:rows.results.map(r=>JSON.parse(r.data))},{headers})}
 need(request.method==='POST','Method not allowed',405)
 const input=await readBody(request),clock=await readClock(db),previous=parts[1]?await catalogEntry(db,parts[1]):undefined
 if(previous)need(input.expected_version===previous.version,'Catalog changed; reload before saving',409,'stale_version')
 const kind=previous?.kind??input.kind;need(kind==='rate'||kind==='assembly'||kind==='template','Choose rate, assembly or template')
 const value=catalogValue(kind,object(input.value))
 if(kind==='assembly')for(const part of (value as Assembly).parts)await catalogEntry(db,part.rate_id,'rate')
 if(kind==='template')for(const item of (value as EstimateTemplate).items)await catalogEntry(db,item.assembly_id,'assembly')
 const version=(previous?.version??0)+1,name=text(input.name,'Catalog name',200),revision={version,name,value,reason:text(input.reason,'Change reason',2000),approved_by:stamp(actor)}
 const entry:CatalogEntry={id:previous?.id??crypto.randomUUID(),kind,version,name,revisions:[...(previous?.revisions??[]),revision]}
 const data=JSON.stringify(entry);need(data.length<=2_000_000,'Catalog history is too large')
 const writes=previous?[db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_estimate_catalog WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(entry.id,previous.version),db.prepare('UPDATE pl_estimate_catalog SET version=?,data=? WHERE id=?').bind(version,data,entry.id)]:[db.prepare('INSERT INTO pl_estimate_catalog(id,version,data) VALUES(?,?,?)').bind(entry.id,version,data)]
 await transaction(db,actor,null,writes,clock);return Response.json({entry},{status:previous?200:201,headers})
}
