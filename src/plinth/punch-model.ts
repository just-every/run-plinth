import { need, object, text, type Attachment, type Job, type Stamp } from './model'

export interface PunchField { id: string; label: string; type: 'text' | 'boolean' | 'choice'; required: boolean; options?: string[] }
export interface PunchForm { id: string; template_id: string; revision: number; name: string; fields: PunchField[]; by: Stamp }
export type PunchAnswers = Record<string, string | boolean>
export interface PunchAssignment { subcontract_id: string; email: string; company: string; trade: string; by: Stamp }
export interface PunchAttempt { id: string; number: number; note: string; attachments: Attachment[]; by: Stamp; review?: { decision: 'rejected' | 'accepted'; note: string; evidence: string; attachments: Attachment[]; by: Stamp } }
export interface PunchIssue {
 id: string; number: number; title: string; description: string; kind: 'punch' | 'quality' | 'safety'; severity: 'low' | 'normal' | 'high' | 'critical'; due_on: string; location: string
 sheet?: { sheet_id: string; revision_id: string; name: string; revision: number; page: number }
 photo: Attachment; annotation: { x: number; y: number; note: string }; form?: PunchForm; answers: PunchAnswers
 assignment?: PunchAssignment; assignments: PunchAssignment[]; attempts: PunchAttempt[]; status: 'open' | 'submitted' | 'rejected' | 'accepted'; by: Stamp; released_by?: Stamp
}
export interface PunchState { forms: PunchForm[]; issues: PunchIssue[] }
export type PunchJob = Job & { punch?: PunchState }
export const punchState = (job: PunchJob): PunchState => job.punch ?? { forms: [], issues: [] }
/** Clients receive deliberately released closeout records only. No access grants, company contact details or reusable internal forms. */
export function punchClientProjection(job: PunchJob) {
 return { forms: [], issues: punchState(job).issues.filter(i => i.released_by).map(i => ({ ...i, assignment: undefined, assignments: [] })) }
}
export function punchFields(value: unknown): PunchField[] {
 need(Array.isArray(value) && value.length > 0 && value.length <= 30, 'Provide between one and thirty form fields')
 const fields = value.map(v => {
  const raw = object(v), id = text(raw.id, 'Field id', 80), label = text(raw.label, 'Field label', 200)
  need(/^[a-zA-Z0-9_-]+$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id), 'Field ids use ordinary letters, numbers, underscores or hyphens')
  need(raw.type === 'text' || raw.type === 'boolean' || raw.type === 'choice', 'Field type must be text, boolean or choice')
  need(typeof raw.required === 'boolean', 'Each field needs an explicit required flag')
  let options: string[] | undefined
  if (raw.type === 'choice') { need(Array.isArray(raw.options) && raw.options.length > 0 && raw.options.length <= 20, 'Choice fields need one to twenty options'); options = raw.options.map(v => text(v, 'Choice option', 160)); need(new Set(options).size === options.length, 'Choice options must be unique') }
  return { id, label, type: raw.type, required: raw.required, ...(options ? { options } : {}) } as PunchField
 })
 need(new Set(fields.map(f => f.id)).size === fields.length, 'Form field ids must be unique'); return fields
}
export function punchAnswers(form: PunchForm | undefined, value: unknown): PunchAnswers {
 const raw = object(value ?? {}), fields = form?.fields ?? []
 need(Object.keys(raw).every(id => fields.some(f => f.id === id)), 'An answer does not belong to this exact form revision')
 const answers: PunchAnswers = {}
 for (const field of fields) {
  const answer = raw[field.id]
  if (answer === undefined || answer === '') { need(!field.required, `Answer ${field.label}`); continue }
  if (field.type === 'boolean') need(typeof answer === 'boolean', `${field.label} must be yes or no`)
  else { need(typeof answer === 'string' && answer.length <= 4000 && answer.trim(), `Provide a text answer for ${field.label}`); if (field.type === 'choice') need(field.options!.includes(answer), `Choose an option for ${field.label}`) }
  answers[field.id] = typeof answer === 'string' ? answer.trim() : answer as boolean
 }
 return answers
}
