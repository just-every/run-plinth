import { runtimeBindings, type Bindings } from '../auth.server'
import { authorize, requireManager } from './auth'
import { need, object, stamp, text, type Actor, type Job } from './model'
import { fromBase64, digest } from './attachments'
import { todoManager, todoProjection, requireTodoAccess, todoGrant, ownItems } from './todo-access'
import { actTodo, applyTodoTemplate, prepareTodo, reminderNotices } from './todo-actions'
import { preferences, savePreferences, sendTodoNotice } from './todo-notices'
import { insertTodos, library, libraryOf, loadTodo, readClock, saveLibrary, saveTodo, todoBody, todoJob, todoJobs } from './todo-store'
import { bindJobTemplate, jobTemplateBindings } from './todo-job-template'
import type { Todo, TodoAssignee, TodoTemplate, TodoView } from './todo-model'
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
async function people(db:D1Database,actor:Actor,job?:Job){need(todoManager(actor,job),'Manager access required',403,'forbidden');const rows=await db.prepare("SELECT email,display_name,role FROM oa_operators WHERE status='active' ORDER BY email").all<{email:string;display_name:string;role:string}>(),result:{label:string;assignee:TodoAssignee}[]=[];for(const p of rows.results){const assignments:TodoAssignee[]=p.role==='member'?(job?[{kind:'client',email:p.email},...(job.subcontracts??[]).map(s=>({kind:'sub' as const,email:p.email,subcontract_id:s.id}))]:[]):[{kind:'office',email:p.email}];for(const assignee of assignments)if(await todoGrant(db,job,assignee))result.push({label:`${p.display_name} · ${assignee.kind}${assignee.kind==='sub'?' · '+job!.subcontracts!.find(s=>s.id===assignee.subcontract_id)!.trade:''}`,assignee})}return result}
async function list(db:D1Database,actor:Actor,url:URL,job?:Job&{todos?:Todo[]}){const params=url.searchParams,all=job?[{job,todos:job.todos??[]}]:[...(await todoJobs(db)).map(job=>({job,todos:job.todos??[]})),{job:undefined,todos:(await library<Todo>(db,'todo')).map(r=>r.data)}],shown:TodoView[]=[]
 for(const group of all){if(params.get('job_id')&&group.job?.id!==params.get('job_id'))continue;for(const todo of group.todos){const view=await todoProjection(db,group.job,todo,actor);if(!view)continue;if(params.get('mine')==='true'&&!(await ownItems(db,group.job,todo,actor)).length)continue
  const visibleItems=view.items;if(params.get('overdue')==='true'&&!(Date.parse(todo.due_at)<Date.now()&&visibleItems.some(i=>!i.completed)))continue;if(params.get('assignee')&&!visibleItems.some(i=>i.assignee.email===params.get('assignee')?.toLowerCase()))continue
  if((params.get('tag')||params.get('priority')||params.get('record_id'))&&!todoManager(actor,group.job))continue;if(params.get('tag')&&!todo.tags.includes(params.get('tag')!))continue;if(params.get('priority')&&todo.priority!==params.get('priority'))continue;if(params.get('record_id')&&!todo.links.some(l=>l.id===params.get('record_id')&&(!params.get('record_kind')||l.kind===params.get('record_kind'))))continue
  const q=params.get('q')?.toLowerCase();if(q&&!([view.title,...visibleItems.map(i=>i.title)].join(' ').toLowerCase().includes(q)))continue;shown.push(view)
 }}return shown}
/** Native to-do routes authenticate independently. DomainError is handled by Plinth's outer public HTTP boundary. */
export async function todosResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=/^\/api\/plinth\/(?:jobs\/([^/]+)\/)?todos(?:\/(.*))?$/.exec(url.pathname);if(!match)return null
 const env=runtimeBindings(original),actor=await authorize(request,env);need(actor.role!=='agent','A signed-in person is required',403,'human_required');const db=env.DB,jobId=match[1],parts=(match[2]??'').split('/').filter(Boolean),method=request.method
 const clock=method==='POST'?await readClock(db):0,job=jobId?await todoJob(db,jobId):undefined
 if(parts[0]==='people'&&parts.length===1&&method==='GET')return json({people:await people(db,actor,job)})
 if(!jobId&&parts[0]==='preferences'&&parts.length===1){if(method==='GET')return json({preferences:(await preferences(db,actor.id))?.data??{revision:0,assignment:'off',comment:'off',reminder:'off'},available_channels:['email'],unavailable_channels:['sms','push','digest']});need(method==='POST','Method not allowed',405,'method_not_allowed');return json({preferences:await savePreferences(db,actor,await todoBody(request),clock)})}
 if(!jobId&&parts[0]==='job-templates'){requireManager(actor);if(parts.length===1&&method==='GET')return json({bindings:await jobTemplateBindings(db)});need(parts.length===2&&method==='POST','Unknown job-template binding route',404,'not_found');return json({binding:await bindJobTemplate(db,actor,parts[1]!,await todoBody(request),clock)})}
 if(!jobId&&parts[0]==='templates'){
  requireManager(actor);if(parts.length===1&&method==='GET')return json({templates:(await library<TodoTemplate>(db,'template')).map(r=>r.data)})
  need(parts.length===1&&method==='POST','Unknown template route',404,'not_found');const input=await todoBody(request),specs=input.specs;need(Array.isArray(specs)&&specs.length>0&&specs.length<=30,'A template holds 1–30 to-dos');const template:TodoTemplate={id:crypto.randomUUID(),version:1,name:text(input.name,'Template name',240),specs:specs.map(object),created_by:stamp(actor)};await saveLibrary(db,actor,{id:template.id,kind:'template',version:1,data:template},clock);return json({template},201)
 }
 if(parts.length===0){if(method==='GET'){const todos=await list(db,actor,url,job);if(job&&!todoManager(actor,job))need(todos.length,'Job to-dos not found',404,'not_found');return json({todos,actor_id:actor.id,role:actor.role,manager:todoManager(actor,job),...(job?{version:job.version}:{}),available_channels:['email']})}
  need(method==='POST','Method not allowed',405,'method_not_allowed');const input=await todoBody(request);need(todoManager(actor,job),'Manager access required',403,'forbidden');if(job)need(input.expected_version===job.version,'Job changed; reload',409,'stale_version');const todo=await prepareTodo(db,input,actor,job);await insertTodos(db,actor,[todo],clock,job);return json({todo:await todoProjection(db,job,todo,actor)},201)
 }
 if(job&&parts[0]==='from-template'&&parts.length===1&&method==='POST'){need(todoManager(actor,job),'Manager access required',403,'forbidden');const input=await todoBody(request);need(input.expected_version===job.version,'Job changed; reload',409,'stale_version');const template=await libraryOf<TodoTemplate>(db,text(input.template_id,'Template id',100),'template'),todos=await applyTodoTemplate(db,template.data,input,actor,job);await insertTodos(db,actor,todos,clock,job);return json({todos},201)}
 const context=await loadTodo(db,parts[0]!,jobId);await requireTodoAccess(db,context.job,context.todo,actor)
 if(parts.length===1&&method==='GET')return json({todo:await todoProjection(db,context.job,context.todo,actor),manager:todoManager(actor,context.job)})
 if(parts.length===3&&parts[1]==='files'&&method==='GET'){need(todoManager(actor,context.job),'Original not found',404,'not_found');const file=context.todo.attachments.find(f=>f.id===parts[2]);need(file,'Original not found',404,'not_found');const bytes=fromBase64(file.base64);need(await digest(bytes)===file.checksum,'Original integrity check failed',503,'document_integrity');return new Response(bytes,{headers:{...headers,'content-type':file.mime,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'content-security-policy':"sandbox; default-src 'none'"}})}
 need(method==='POST','Method not allowed',405,'method_not_allowed');const input=await todoBody(request)
 if(parts.length===4&&parts[1]==='notices'&&parts[3]==='send'){const todo=await sendTodoNotice(env,actor,context,parts[2]!,input,clock);return json({todo:await todoProjection(db,context.job,todo,actor)})}
 need(parts.length===2,'Unknown to-do route',404,'not_found');const todo=structuredClone(context.todo)
 if(parts[1]==='prepare-reminders'){need(todoManager(actor,context.job),'Manager access required',403,'forbidden');need(input.expected_revision===todo.revision,'To-do changed; reload',409,'stale_revision');reminderNotices(todo);await saveTodo(db,actor,context,todo,clock)}
 else {const changed=await actTodo(db,todo,actor,input,parts[1]!,context.job);if(changed)await saveTodo(db,actor,context,todo,clock);else return json({todo:await todoProjection(db,context.job,todo,actor),deduplicated:true})}
 return json({todo:await todoProjection(db,context.job,todo,actor)})
}
