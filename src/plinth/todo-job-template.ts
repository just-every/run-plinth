import { requireManager } from './auth'
import { todoManager } from './todo-access'
import { applyTodoTemplate } from './todo-actions'
import { digest } from './attachments'
import { need, object, stamp, text, type Actor, type Input, type Stamp } from './model'
import { getScheduleTemplate } from './schedule-baselines'
import { templateTaskId } from './schedule-baseline-model'
import { library, libraryOf, saveLibrary } from './todo-store'
import type { Todo, TodoJob, TodoTemplate } from './todo-model'

export interface TodoTemplateBinding {
 todo_template_id: string
 todo_template_revision: number
 /** The schedule template's local task identity, before per-job identity translation. */
 task_id?: string
}
export interface TodoJobTemplateRevision {
 revision: number
 templates: TodoTemplateBinding[]
 approved_by: Stamp
}
export interface TodoJobTemplate extends TodoJobTemplateRevision {
 id: string
 schedule_template_id: string
 schedule_template_revision: number
 revisions: TodoJobTemplateRevision[]
}
const bindingId = (id: string, revision: number) => `job_template:${id}:${revision}`

export async function jobTemplateBindings(db: D1Database) {
 return (await library<TodoJobTemplate>(db, 'job_template')).map(row => row.data)
}

/** Company configuration names an actual current source revision, never an inferred task name. */
export async function bindJobTemplate(db: D1Database, actor: Actor, scheduleId: string, input: Input, clock: number) {
 requireManager(actor)
 const source = await getScheduleTemplate(db, scheduleId)
 need(!source.archived, 'Choose an active schedule template', 409, 'template_archived')
 need(input.schedule_template_revision === source.version, 'Schedule template changed; review its current tasks before binding checklists', 409, 'stale_version')
 const rows = input.templates
 need(Array.isArray(rows) && rows.length <= 30, 'Bind up to 30 to-do templates; an empty list removes future checklist creation')
 const templates: TodoTemplateBinding[] = []
 for (const value of rows) {
  const row = object(value), id = text(row.todo_template_id, 'To-do template id', 100)
  const template = await libraryOf<TodoTemplate>(db, id, 'template')
  const taskId = row.task_id ? text(row.task_id, 'Template task id', 100) : undefined
  need(!taskId || source.tasks.some(task => task.id === taskId), 'Choose a task belonging to this exact schedule template revision')
  need(!templates.some(t => t.todo_template_id === id && t.task_id === taskId), 'Bind each to-do template and date anchor once')
  templates.push({todo_template_id: id, todo_template_revision: template.data.version, ...(taskId ? {task_id: taskId} : {})})
 }
 const id = bindingId(source.id, source.version)
 const previous = (await library<TodoJobTemplate>(db, 'job_template')).find(row => row.id === id)
 need(input.expected_version === (previous?.version ?? 0), 'Checklist binding changed; reload before saving', 409, 'stale_version')
 const revision: TodoJobTemplateRevision = {revision: (previous?.version ?? 0) + 1, templates, approved_by: stamp(actor)}
 const binding: TodoJobTemplate = {id, schedule_template_id: source.id, schedule_template_revision: source.version, ...revision, revisions: [...previous?.data.revisions ?? [], structuredClone(revision)]}
 await saveLibrary(db, actor, {id, kind: 'job_template', version: revision.revision, data: binding}, clock, previous)
 return binding
}

/**
 * Call immediately AFTER applyScheduleTemplate on the same cloned job, BEFORE the parent's
 * existing guarded saveJob. This function performs no database writes of its own, so a grant
 * failure aborts both the published schedule and its checklist creation atomically.
 * The parent's clock must have been read before reading/applying the source schedule template.
 */
export async function applyJobTemplateTodos(db: D1Database, job: TodoJob, actor: Actor): Promise<Todo[]> {
 need(todoManager(actor, job), 'Manager access required', 403, 'forbidden')
 const application = job.schedule_template
 need(application, 'Apply the reviewed schedule template before creating its checklists', 409, 'template_required')
 const source = await getScheduleTemplate(db, application.template_id)
 need(!source.archived && source.version === application.template_version, 'The source schedule template changed; preview its current revision', 409, 'schedule_review')
 const binding = (await jobTemplateBindings(db)).find(row => row.id === bindingId(source.id, source.version))
 if (!binding) return []
 const created: Todo[] = []
 for (const linked of binding.templates) {
  const template = await libraryOf<TodoTemplate>(db, linked.todo_template_id, 'template')
  need(template.data.version === linked.todo_template_revision, 'The bound to-do template changed; review its binding again', 409, 'template_revision')
  const taskId = linked.task_id ? await templateTaskId(job.id, source.id, linked.task_id) : undefined
  if (taskId) need(application.task_ids.includes(taskId) && job.schedules.some(t => t.id === taskId && t.status === 'booked'), 'The bound schedule task is unavailable; review the checklist binding', 409, 'template_task')
  const keys = await Promise.all(template.data.specs.map(async (_, index) => digest(new TextEncoder().encode(JSON.stringify([job.id, binding.id, linked.todo_template_id, linked.task_id ?? null, index])))))
  if (keys.every(key => job.todos?.some(todo => todo.job_template?.application_key === key))) continue
  // Current contact/company/job grants are checked by prepareTodo for every newly created item.
  const todos = await applyTodoTemplate(db, template.data, {task_id: taskId}, actor, job, application.start)
  for (let index = 0; index < todos.length; index++) {
   const key = keys[index]!
   if (job.todos?.some(todo => todo.job_template?.application_key === key)) continue
   const todo = todos[index]!
   todo.id = key.slice(0, 32)
   todo.job_template = {application_key: key, binding_id: binding.id, binding_revision: binding.revision, schedule_template_id: source.id, schedule_template_revision: source.version, todo_template_id: template.data.id, todo_template_revision: template.data.version, ...(taskId ? {task_id: taskId} : {}), publication_id: application.publication_id}
   created.push(todo)
  }
 }
 need((job.todos?.length ?? 0) + created.length <= 500, 'A job supports up to 500 to-dos')
 if (created.length) job.todos = [...job.todos ?? [], ...created]
 return created
}
