import { need, object, text, type Input, type Schedule, type Stamp } from './model'
export interface Allocation { resource_id:string; units:number }
export interface ResourceWindow { start:string; end:string; reason:string }
export interface ScheduleResource { id:string; version:number; name:string; kind:'crew'|'equipment'; capacity:number; available:ResourceWindow[]; leave:ResourceWindow[]; history:{by:Stamp; reason:string; capacity:number; available:ResourceWindow[]; leave:ResourceWindow[]}[] }
export interface TradeInvitation {subcontract_id:string; id:string; task_id:string; email:string; invited_by:Stamp; snapshot:string; start:string; end:string; responses:{kind:'confirm'|'alternative'; start:string; end:string; reason:string; by:Stamp}[]}
export function allocations(input:Input,old?:Schedule):{resources?:Allocation[]}{
 if(input.resources===undefined)return old?.resources?{resources:structuredClone(old.resources)}:{}
 need(Array.isArray(input.resources)&&input.resources.length<=30,'Allocate up to 30 crews or equipment resources')
 const resources=input.resources.map(v=>{const r=object(v);need(Number.isSafeInteger(r.units)&&Number(r.units)>0&&Number(r.units)<=10000,'Resource units must be whole numbers from 1 to 10000');return {resource_id:text(r.resource_id,'Resource',100),units:Number(r.units)}})
 need(new Set(resources.map(r=>r.resource_id)).size===resources.length,'A resource can be allocated once per task');return {resources}
}
export function invitationSnapshot(task:Schedule){return JSON.stringify({trade:task.trade,start:task.start,end:task.end,status:task.status,resources:task.resources??[],travel_minutes:task.travel_minutes??0})}
