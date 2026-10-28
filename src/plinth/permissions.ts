import { holds, type Action, type Feature } from './role-model'
import { need, type Actor } from './model'

/**
 * ROLE-006: every internal route resolves to one feature area and action, and a custom role is checked against its switches
 * before any door runs. A route with no entry answers 403, so a door added later stays closed to custom roles until it is named here.
 * A switch can only narrow what the copied preset's doors already allow; it never opens a door the preset keeps shut.
 */
export interface Requirement { feature: Feature; action: Action; financial?: boolean }
const feature: Record<string, Feature> = {
 quotes: 'estimates', takeoff: 'estimates', 'takeoff-estimate': 'estimates', 'takeoff-files': 'estimates', pricing: 'estimates', 'estimate-template': 'estimates', 'pricing-rates': 'estimates', 'estimate-catalog': 'estimates', bids: 'estimates', 'bid-comparisons': 'estimates', products: 'estimates', 'product-images': 'estimates',
 selections: 'selections', 'selection-delegations': 'selections', 'decision-files': 'selections',
 variations: 'changes', 'variation-pricing': 'changes', 'allowance-changes': 'changes',
 submittals: 'documents', orders: 'orders', subcontracts: 'orders', 'lien-waiver-files': 'orders', 'lien-waiver-templates': 'orders',
 schedules: 'schedule', schedule: 'schedule', 'schedule-template': 'schedule', 'schedule-templates': 'schedule', 'schedule-baseline': 'schedule', 'schedule-actuals': 'schedule', 'schedule-constraints': 'schedule', 'schedule-documents': 'schedule', capacity: 'schedule', forecast: 'schedule', calendar: 'schedule', resources: 'schedule', 'trade-confirmations': 'schedule',
 diary: 'logs', time: 'time',
 'plan-inbox':'documents', plans:'documents', 'meeting-inbox': 'documents', rfis: 'documents', 'rfi-access': 'documents', 'rfi-files': 'documents', 'rfi-inbox': 'documents', punch: 'documents', handover: 'documents', satisfaction: 'documents', continuity: 'documents', warranties: 'documents', 'warranty-reminders': 'documents', 'portal-policy': 'company',
 payments: 'invoices', invoices: 'invoices', remittances: 'invoices', retainage: 'invoices', sov: 'invoices', claims: 'invoices', receivables: 'invoices',
 'report-schedules':'reports', reports: 'reports', audit: 'reports', holds: 'reports',
 company: 'company', vendors: 'company', customers: 'company', customer: 'company', 'compliance-rules': 'company', roles: 'company',
}
/** Verbs that decide, issue, send or publish rather than edit. */
const approving = new Set(['follow-up', 'run-follow-up', 'credit', 'debit', 'void', 'write-off', 'refund', 'accept', 'issue', 'send', 'approve', 'approve-amendment', 'publish', 'release', 'award', 'sign', 'move', 'cancel', 'notify', 'run', 'resume', 'order', 'receipt', 'draws', 'lien'])
const common = [/^jobs$/, /^jobs\/[^/]+$/, /^todos(?:\/.*)?$/, /^jobs\/[^/]+\/todos(?:\/.*)?$/]
const isId = (value: string) => /^[0-9a-f]{8}-[0-9a-f-]{20,}$|^[0-9a-f]{16,}$/i.test(value)
export function requirement(method: string, relative: string): Requirement | 'common' | null {
 if (method === 'GET' && relative === 'search') return 'common'
 if (method === 'GET' && common.some(rule => rule.test(relative)) || common.slice(2).some(rule => rule.test(relative))) return 'common'
 const parts = relative.split('/').filter(Boolean), job = parts[0] === 'jobs' && parts[1]
 if (parts[0] === 'reports' && method === 'POST' && parts.length === 2) {
  if (parts[1] === 'query') return { feature: 'reports', action: 'view' }
  if (parts[1] === 'fields' || parts[1] === 'views') return { feature: 'reports', action: 'create' }
 }
 if (parts[0] === 'plan-inbox') return { feature:'documents', action:'view' }
 if (parts[0] === 'jobs' && parts[2] === 'plans' && method === 'POST' && parts.at(-1) === 'acknowledge') return { feature:'documents', action:'view' }
 if (parts[0] === 'jobs' && parts[2] === 'plans' && method === 'POST' && parts.at(-1) === 'annotate') return { feature:'documents', action:'create' }
 if (parts[0] === 'meeting-inbox') return { feature: 'documents', action: method === 'GET' || parts.at(-1) === 'email-copy' ? 'view' : 'create' }
 if (parts[0] === 'jobs' && parts.length === 1 && method === 'POST') return { feature: 'leads', action: 'create' }
 if (method === 'GET' && job && parts[2] === 'costs' && parts[3] === 'access' && parts.length === 4) return 'common'
 const cost = costRequirement(method, relative); if (job && parts[2] === 'costs') return cost
 if(job&&parts[2]==='submittals')return {feature:'documents',action:method==='GET'?'view':parts[4]==='review'||parts[4]==='release'?'approve':parts.length===3?'create':'edit',financial:true}
 const rest = job ? parts.slice(2) : parts, category = rest[0] ?? '', area = feature[category]
 if (!area) return null
 const verbs = rest.slice(1).filter(part => !isId(part)), verb = verbs.at(-1) ?? ''
 const financial = (['estimates', 'budgets', 'bills', 'orders', 'changes', 'selections', 'invoices'] as Feature[]).includes(area)
 if (category === 'schedule-actuals' && method === 'POST') return { feature: 'schedule', action: 'edit' }
 const collection = !verb && method === 'POST' && (!rest.slice(1).some(isId) || !job && category === 'bids' && rest.length === 2)
 const action: Action = method === 'GET' ? 'view' : method === 'DELETE' ? 'delete' : verb === 'preview' || verb === 'plan-preview' ? 'view' : approving.has(verb) ? 'approve' : collection ? 'create' : 'edit'
 return { feature: area, action, ...(financial ? { financial: true } : {}) }
}
/** Custom roles only; presets keep their own door lists. */
export function enforce(actor: Actor, request: Request) {
 const prefix = '/api/plinth/', path = new URL(request.url).pathname
 const required = path.startsWith(prefix) ? requirement(request.method, path.slice(prefix.length).replace(/\/+$/, '')) : null
 need(required, 'This role does not include that route', 403, 'forbidden')
 if (required === 'common') return
 need(holds({ permissions: actor.permissions!.matrix }, required.feature, required.action), `${actor.permissions!.name} does not allow ${required.action} for ${required.feature}`, 403, 'forbidden')
 need(!required.financial || actor.permissions!.financial, `${actor.permissions!.name} does not include financial visibility`, 403, 'forbidden')
}

/** Cost routes use explicit verbs so posting never borrows a data-entry switch. */
export function costRequirement(method: string, relative: string): Requirement | null {
 const m = /^jobs\/[^/]+\/costs(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(relative)
 if (!m) return null
 const [, category = 'ledger', id, verb] = m
 if (category === 'bills') {
  if (method === 'GET' && (!id || verb === 'original')) return { feature: 'bills', action: 'view', financial: true }
  if (method === 'POST' && !id) return { feature: 'bills', action: 'create', financial: true }
  if (method === 'POST' && id && ['recode', 'review', 'route', 'post'].includes(verb ?? '')) return { feature: 'bills', action: verb === 'post' ? 'approve' : 'edit', financial: true }
 }
 if (!id && method === 'GET' && ['ledger', 'forecasts', 'cash', 'periods', 'period-preview'].includes(category)) return { feature: 'budgets', action: 'view', financial: true }
 if (!id && method === 'GET' && category === 'draw-packet') return { feature: 'reports', action: 'view', financial: true }
 if (!id && method === 'POST' && category === 'period-reviews') return { feature: 'reports', action: 'approve', financial: true }
 if (!id && method === 'POST' && category === 'forecasts') return { feature: 'budgets', action: 'create', financial: true }
 if (!id && method === 'POST' && category === 'reconcile') return { feature: 'reports', action: 'edit', financial: true }
 return null
}
