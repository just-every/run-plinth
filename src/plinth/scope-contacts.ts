import {getVendor} from './vendors'
import type {Job} from './model'
/** ROLE-003 / SUB-001: a narrow inbox grant never escapes the contact's own released company scope. */
export async function scopeContact(db:D1Database,job:Job,email:string,id:string|undefined,trade?:string){
 const scope=job.subcontracts?.find(s=>s.id===id&&s.status==='released'&&(!trade||s.trade.toLowerCase()===trade.toLowerCase()))
 if(!scope)return undefined
 const vendor=await getVendor(db,scope.vendor_id)
 return vendor.contacts.some(c=>scope.contact_ids.includes(c.id)&&c.email.toLowerCase()===email.toLowerCase())?scope:undefined
}
