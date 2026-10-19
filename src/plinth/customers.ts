import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize, requireManager } from './auth'
import { contactNote, createCustomer, editContact, editProperty, updateCustomer, type Customer } from './customer-model'
import { DomainError, need, object, type Actor, type Input } from './model'
import { readClock, transaction } from './store'

export type { Customer } from './customer-model'
const root = '/api/plinth/customers'
const headers = {'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json = (value:unknown,status=200)=>Response.json(value,{status,headers})

/** Internal lookup only: HTTP callers must authenticate before requesting customer data. */
export async function getCustomer(db:D1Database,id:string):Promise<Customer> {
 const row = await db.prepare('SELECT data FROM pl_customers WHERE id=?').bind(id).first<{data:string}>()
 need(row,'Customer not found',404,'not_found')
 return JSON.parse(row.data) as Customer
}
async function body(request:Request):Promise<Input> {
 need((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'application/json','Send application/json',415,'content_type')
 const reader = request.body?.getReader()
 need(reader,'JSON body is required')
 const chunks:Uint8Array[] = []
 let size = 0
 for(;;) {
  const chunk = await reader.read()
  if(chunk.done) break
  size += chunk.value.byteLength
  if(size > 2_000_000) { await reader.cancel(); throw new DomainError('body_size','Request is too large',413) }
  chunks.push(chunk.value)
 }
 const bytes = new Uint8Array(size)
 let offset = 0
 for(const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length }
 try { return object(JSON.parse(new TextDecoder().decode(bytes))) }
 catch(error) { if(error instanceof DomainError) throw error; throw new DomainError('invalid_json','Invalid JSON body') }
}
async function save(db:D1Database,actor:Actor,customer:Customer,clock:number,previous?:Customer) {
 customer.version = previous ? previous.version + 1 : 1
 const data = JSON.stringify(customer)
 need(new TextEncoder().encode(data).byteLength <= 8_000_000,'Customer history is too large',413,'body_size')
 const writes = previous ? [
  db.prepare('INSERT INTO pl_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM pl_customers WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(previous.id,previous.version),
  db.prepare('UPDATE pl_customers SET version=?,data=? WHERE id=? AND version=?').bind(customer.version,data,customer.id,previous.version),
 ] : [db.prepare('INSERT INTO pl_customers(id,version,data) VALUES(?,?,?)').bind(customer.id,customer.version,data)]
 await transaction(db,actor,null,writes,clock)
}
async function handle(request:Request,original:Bindings):Promise<Response> {
 const env = runtimeBindings(original),actor = await authorize(request,env)
 requireManager(actor)
 let parts:string[]
 try { parts = new URL(request.url).pathname.slice(root.length).split('/').filter(Boolean).map(decodeURIComponent) }
 catch { throw new DomainError('invalid','Invalid customer path') }
 const method = request.method
 need((parts.length <= 3 || parts.length===4 && parts[1]==='contacts' && parts[3]==='notes' && method==='POST') && (parts.length < 2 || parts[1] === 'contacts' || parts[1] === 'properties'),'Unknown customer route',404,'not_found')
 if(parts.length === 0 && method === 'GET') {
  const rows = await env.DB.prepare('SELECT data FROM pl_customers ORDER BY rowid DESC').all<{data:string}>()
  return json({customers:rows.results.map(row=>JSON.parse(row.data) as Customer),role:actor.role})
 }
 // Observe the shared clock before reading a customer so later writes cannot use stale state.
 const clock = method === 'POST' ? await readClock(env.DB) : 0
 if(parts.length === 0) {
  need(method === 'POST','Method not allowed',405,'method_not_allowed')
  const customer = createCustomer(await body(request),actor)
  await save(env.DB,actor,customer,clock)
  return json({customer,role:actor.role},201)
 }
 const previous = await getCustomer(env.DB,parts[0])
 if(method === 'GET') {
  if(parts.length === 1) return json({customer:previous,role:actor.role})
  const records = parts[1] === 'contacts' ? previous.contacts : previous.properties
  if(parts.length === 2) return json({[parts[1]]:records,customer_id:previous.id,version:previous.version,role:actor.role})
  const record = records.find(row=>row.id === parts[2])
  need(record,'Record not found',404,'not_found')
  return json({record,customer_id:previous.id,version:previous.version,role:actor.role})
 }
 need(method === 'POST','Method not allowed',405,'method_not_allowed')
 const input = await body(request)
 need(Number.isSafeInteger(input.expected_version) && input.expected_version === previous.version,'Customer changed. Reload before applying this action.',409,'stale_version')
 const customer = structuredClone(previous)
 const record = parts.length === 4 ? contactNote(customer,input,actor,parts[2]) : parts.length === 1 ? updateCustomer(customer,input,actor)
  : parts[1] === 'contacts' ? editContact(customer,input,actor,parts[2]) : editProperty(customer,input,actor,parts[2])
 await save(env.DB,actor,customer,clock,previous)
 return json({customer,record,role:actor.role},parts.length === 2 ? 201 : 200)
}
/** Call before the general Plinth handler. Every matched request authenticates independently. */
export async function customersResponse(request:Request,env:Bindings):Promise<Response|null> {
 const path = new URL(request.url).pathname
 if(path !== root && !path.startsWith(root+'/')) return null
 try { return await handle(request,env) }
 catch(error) {
  if(error instanceof DomainError) return json({error:error.code,message:error.message,...(error.details ? {details:error.details} : {})},error.status)
  const failure = error as {status?:number;code?:string;message?:string}
  if(failure.status && failure.status < 500) return json({error:failure.code ?? 'forbidden',message:failure.message ?? 'Request refused'},failure.status)
  return json({error:'server_error',message:'The request could not be completed'},500)
 }
}
