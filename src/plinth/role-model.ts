import { cents, need, object, text, type Input } from './model'

/** ROLE-006: a role is switches over feature areas and actions. The presets below are the defaults an owner copies and adjusts. */
export const features = ['leads', 'estimates', 'budgets', 'bills', 'orders', 'changes', 'selections', 'schedule', 'logs', 'time', 'documents', 'invoices', 'reports', 'company'] as const
export const actions = ['view', 'create', 'edit', 'delete', 'approve'] as const
export type Feature = typeof features[number]
export type Action = typeof actions[number]
export type Matrix = Record<Feature, Record<Action, boolean>>
export type Preset = 'administrator' | 'project_manager' | 'estimator' | 'superintendent' | 'crew'
export interface RoleSpec { name: string; copy_of: Preset; permissions: Matrix; /** Cost, margin, markup and pay rates are their own switch. */ financial_visible: boolean; /** Largest purchase order the role may approve, USD cents; null is no limit. */ po_limit_cents: number | null }
export interface Role extends RoleSpec { id: string; version: number; created_by: { id: string; name: string; at: string }; updated_by: { id: string; name: string; at: string } }
/** v view, c create, e edit, d delete, a approve. */
const letters: Record<string, Action> = { v: 'view', c: 'create', e: 'edit', d: 'delete', a: 'approve' }
const matrix = (spec: Partial<Record<Feature, string>>): Matrix => Object.fromEntries(features.map(f => [f, Object.fromEntries(actions.map(a => [a, (spec[f] ?? '').split('').some(l => letters[l] === a)]))])) as Matrix
const all = Object.fromEntries(features.map(f => [f, 'vcdea'])) as Record<Feature, string>
/** The operator-auth role each preset rides on; every preset's job reach is still its own doors (ROLE-001, ROLE-002). */
export const presets: Record<Preset, { name: string; base: 'admin' | 'project_manager' | 'estimator' | 'superintendent' | 'crew'; permissions: Matrix; financial_visible: boolean; po_limit_cents: number | null }> = {
 administrator: { name: 'Administrator', base: 'admin', permissions: matrix(all), financial_visible: true, po_limit_cents: null },
 project_manager: { name: 'Project manager', base: 'project_manager', permissions: matrix({ ...all, company: 'v', reports: 'vc', bills: 'v' }), financial_visible: true, po_limit_cents: 0 },
 estimator: { name: 'Estimator', base: 'estimator', permissions: matrix({ leads: 'vce', estimates: 'vce', documents: 'v' }), financial_visible: true, po_limit_cents: 0 },
 superintendent: { name: 'Superintendent', base: 'superintendent', permissions: matrix({ schedule: 've', logs: 'vc', documents: 'vc' }), financial_visible: false, po_limit_cents: 0 },
 crew: { name: 'Crew', base: 'crew', permissions: matrix({ schedule: 'v', logs: 'v', documents: 'v' }), financial_visible: false, po_limit_cents: 0 },
}
export const holds = (role: { permissions: Matrix }, feature: Feature, action: Action) => role.permissions[feature][action]
/** Validate a role's switches; unknown features or actions are refused rather than ignored. */
export function parseSpec(input: Input, previous?: RoleSpec): RoleSpec {
 const copy = previous?.copy_of ?? input.copy_of
 need(typeof copy === 'string' && copy in presets, 'Copy one of administrator, project_manager, estimator, superintendent or crew')
 const source = previous ?? { ...structuredClone(presets[copy as Preset]), copy_of: copy as Preset }
 const next: RoleSpec = { name: input.name === undefined && previous ? previous.name : text(input.name, 'Role name', 80), copy_of: source.copy_of, permissions: structuredClone(source.permissions), financial_visible: source.financial_visible, po_limit_cents: source.po_limit_cents }
 if (input.permissions !== undefined) {
  const given = object(input.permissions)
  for (const [feature, value] of Object.entries(given)) {
   need((features as readonly string[]).includes(feature), `Unknown feature area ${feature}`)
   for (const [action, on] of Object.entries(object(value))) { need((actions as readonly string[]).includes(action), `Unknown action ${action}`); need(typeof on === 'boolean', 'Switches are on or off'); next.permissions[feature as Feature][action as Action] = on }
  }
 }
 if (input.financial_visible !== undefined) { need(typeof input.financial_visible === 'boolean', 'financial_visible is on or off'); next.financial_visible = input.financial_visible }
 if (input.po_limit_cents !== undefined) next.po_limit_cents = input.po_limit_cents === null ? null : cents(input.po_limit_cents, 'po_limit_cents')
 return next
}
/** The first switch a spec turns on that its editor does not hold, so nobody grants more than they have. */
export function escalation(editor: { permissions: Matrix; financial_visible: boolean; po_limit_cents: number | null }, before: RoleSpec | undefined, after: RoleSpec): string | undefined {
 for (const f of features) for (const a of actions) if (after.permissions[f][a] && !before?.permissions[f][a] && !editor.permissions[f][a]) return `${f} ${a}`
 if (after.financial_visible && !before?.financial_visible && !editor.financial_visible) return 'financial visibility'
 const cap = (limit: number | null) => limit === null ? Infinity : limit
 if (cap(after.po_limit_cents) > cap(before?.po_limit_cents ?? 0) && cap(after.po_limit_cents) > cap(editor.po_limit_cents)) return 'a larger purchase order approval limit'
}
