import { need, object, text, type Actor, type Input, type Job } from './model'
import { todoGrant, todoManager, ownItems } from './todo-access'
import { createTodo, event, prepareNotice, type Todo, type TodoItem, type TodoTemplate } from './todo-model'
import { todoFiles } from './todo-store'
import { nextDate, wallClock } from './time-zone'
export async function validateAssignees(db:D1Database,todo:Todo,job?:Job){for(const item of todo.items)need(await todoGrant(db,job,item.assignee),'Each assignee must be active and currently assigned to this job, or an office manager for a company to-do',403,'assignee_grant')}
export async function prepareTodo(db:D1Database,input:Input,actor:Actor,job?:Job){need(todoManager(actor,job),'Manager access required',403,'forbidden');const todo=createTodo(input,actor,job);await validateAssignees(db,todo,job);if(input.attachments)todo.attachments=await todoFiles(input.attachments);prepareNotice(todo,'assignment','created',todo.items);return todo}
/** Offline operations retain their original revision and key. A replay is acknowledged only for the same person/action/items. */
export async function actTodo(db:D1Database,todo:Todo,actor:Actor,input:Input,action:string,job?:Job){
 const manager=todoManager(actor,job),itemId=input.item_id===undefined?undefined:text(input.item_id,'Checklist item',100),operation=text(input.operation_id,'Operation id',100)
 need(['complete','reopen','comment','edit','attachments'].includes(action),'Unknown to-do action',404,'not_found')
 if(['complete','reopen','comment'].includes(action)){
  const targets=itemId?todo.items.filter(i=>i.id===itemId):todo.items;need(targets.length>0,'Checklist item not found',404,'not_found');need(manager||!!itemId,'Choose your own assigned checklist item',403,'forbidden')
  if(!manager){const own=await ownItems(db,job,todo,actor);need(targets.every(i=>own.some(x=>x.id===i.id)),'Checklist item not found',404,'not_found')}
  const prior=[...todo.history,...todo.items.flatMap(i=>i.history)].find(h=>h.operation_id===operation)
  if(prior){const recorded=todo.items.filter(i=>i.history.some(h=>h.operation_id===operation)).map(i=>i.id).sort();need(prior.by.id===actor.id&&prior.action===action&&JSON.stringify(recorded)===JSON.stringify(targets.map(i=>i.id).sort()),'Operation id was already used for a different action',409,'operation_conflict');return false}
  need(input.expected_revision===todo.revision,'To-do changed. Review the current checklist before syncing this operation.',409,'stale_revision')
  const e=event(actor,action as 'complete'|'reopen'|'comment',operation,action==='comment'?text(input.comment,'Comment',4000):undefined)
  for(const i of targets){if(action!=='comment')i.completed=action==='complete';i.history.push(e)}
  todo.history.push({...e,comment:undefined})
  if(action==='comment')prepareNotice(todo,'comment',e.id,targets)
  return true
 }
 need(manager,'Manager access required',403,'forbidden');need(input.expected_revision===todo.revision,'To-do changed; reload before editing',409,'stale_revision')
 if(action==='attachments'){const files=await todoFiles(input.attachments);need(todo.attachments.length+files.length<=5,'Keep at most five originals per to-do');todo.attachments.push(...files);return true}
 const next=createTodo({...todo,...input,items:todo.items.map(i=>({title:i.title,assignee:i.assignee})),attachments:undefined},actor,job)
 todo.title=next.title;todo.notes=next.notes;todo.due_at=next.due_at;todo.priority=next.priority;todo.tags=next.tags;todo.links=next.links
 if(input.assignments!==undefined){need(Array.isArray(input.assignments)&&input.assignments.length<=todo.items.length,'Provide item assignments');for(const value of input.assignments){const x=object(value),i=todo.items.find(i=>i.id===x.item_id);need(i,'Checklist item not found',404,'not_found');const parsed=createTodo({...todo,items:[{title:i.title,assignee:x.assignee}]},actor,job).items[0]!;i.assignee=parsed.assignee;i.history.push(event(actor,'created',operation))}await validateAssignees(db,todo,job);prepareNotice(todo,'assignment',String(todo.revision+1),todo.items)}
 return true
}
export async function applyTodoTemplate(db:D1Database,template:TodoTemplate,input:Input,actor:Actor,job:Job,anchorAt=job.created_by.at){
 let anchor=anchorAt,task:Job['schedules'][number]|undefined
 if(input.task_id){task=job.schedules.find(t=>t.id===input.task_id);need(task,'Linked template task not found',404,'not_found');anchor=task.start}
 const rows:Todo[]=[]
 for(const raw of template.specs){const offset=raw.due_offset_days??0;need(Number.isSafeInteger(offset)&&Math.abs(Number(offset))<=3650,'Due offset must be whole days within ten years');const local=wallClock(Date.parse(anchor),job.time_zone??'UTC'),date=nextDate(local.date,Number(offset)),clock=String(raw.due_time??'17:00');need(/^([01]\d|2[0-3]):[0-5]\d$/.test(clock),'Template due time must be HH:MM');const todo=await prepareTodo(db,{...raw,due_at:date+'T'+clock,...(task?{links:[{kind:'schedule',id:task.id},...(Array.isArray(raw.links)?raw.links:[])]}:{})},actor,job);todo.template_id=template.id;rows.push(todo)}return rows
}
export function reminderNotices(todo:Todo,now=Date.now()){if(Date.parse(todo.due_at)<=now)prepareNotice(todo,'reminder',todo.due_at,todo.items.filter(i=>!i.completed))}
