import { clientAccess } from './job-customers'
import { need, type Actor, type Job } from './model'
import { scopeContact } from './scope-contacts'
import { teamGrant } from './team'
import { officeAuthority } from './warranty-store'
import type { Todo, TodoAssignee, TodoView } from './todo-model'
export function todoManager(actor:Actor,job?:Job){return actor.role==='owner'||actor.role==='admin'||!!job&&actor.role==='project_manager'&&!!actor.team?.job_ids.includes(job.id)}
export async function todoGrant(db:D1Database,job:Job|undefined,assignment:TodoAssignee){
 const person=await db.prepare("SELECT id,role FROM oa_operators WHERE lower(email)=? AND status='active'").bind(assignment.email).first<{id:string;role:string}>();if(!person)return false
 if(assignment.kind==='office'){if(!job){const t=person.role==='admin'?await teamGrant(db,person.id):null;return person.role==='owner'||person.role==='admin'&&!t}return !!await officeAuthority(db,job,person.id,true)}
 if(!job||person.role!=='member')return false
 return assignment.kind==='client'?clientAccess(db,job,assignment.email):!!await scopeContact(db,job,assignment.email,assignment.subcontract_id)
}
export async function ownItems(db:D1Database,job:Job|undefined,todo:Todo,actor:Actor){const items=[];for(const item of todo.items)if(item.assignee.email===actor.email.toLowerCase()&&await todoGrant(db,job,item.assignee))items.push(item);return items}
export async function todoProjection(db:D1Database,job:Job|undefined,todo:Todo,actor:Actor):Promise<TodoView|null>{if(todoManager(actor,job))return {...todo,attachments:todo.attachments.map(({base64,...file})=>file) as Todo['attachments']};const items=await ownItems(db,job,todo,actor);if(!items.length)return null;return {id:todo.id,title:todo.title,items:items.map(i=>({...i,assignee:{...i.assignee}})),job_id:todo.job_id,revision:todo.revision}}
export async function requireTodoAccess(db:D1Database,job:Job|undefined,todo:Todo,actor:Actor){need(actor.role!=='agent','A signed-in person is required',403,'human_required');need(await todoProjection(db,job,todo,actor),'To-do not found',404,'not_found')}
