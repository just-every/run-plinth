import { need, type Actor, type TeamRole } from './model'
import { enforce } from './permissions'

/**
 * ROLE-002: the doors an estimator, superintendent or crew member may use. Everything not listed is refused
 * before any door runs, so a route added later (time, pay, billing, reports) stays closed to these presets
 * until its own clause registers it here. Job assignment is enforced separately by jobOf/visible on every request.
 */
type Rule = readonly [method: string, path: RegExp]
const id = '[^/]+'
const rule = (method: string, path: string): Rule => [method, new RegExp(`^${path}$`)]
/** Own work for every internal preset: assigned jobs, published plans, photos, to-do items assigned to the person, and the punch list to read. */
const common: Rule[] = [
 rule('GET', `meeting-inbox(?:/${id})?(?:/${id}/(?:export\\.json|decision-search))?`), rule('POST', `meeting-inbox/${id}/${id}/(?:feedback|email-copy)`),
 rule('GET', `meeting-inbox/${id}/decision-search`),
 rule('GET', 'search'),
 rule('GET', 'jobs'), rule('GET', `jobs/${id}`), rule('GET', `jobs/${id}/forecast`),
 rule('GET', `jobs/${id}/takeoff-files/${id}`), rule('GET', `jobs/${id}/diary/${id}/attachments/${id}`),
 rule('GET', 'todos'), rule('GET', 'todos/preferences'), rule('POST', 'todos/preferences'), rule('GET', `jobs/${id}/todos`), rule('GET', `jobs/${id}/todos/${id}`), rule('POST', `jobs/${id}/todos/${id}/(?:complete|reopen|comment)`),
 rule('GET', `jobs/${id}/punch`), rule('GET', `jobs/${id}/punch/export\\.(?:json|csv)`), rule('GET', `jobs/${id}/punch/files/${id}`),
]
const rules: Record<Exclude<TeamRole, 'project_manager'>, Rule[]> = {
 // Leads are jobs still in quoting until CRM-002 adds the pipeline; proposals are quote revisions. Acceptance, selections, change orders, money records and award decisions stay with the office.
 estimator: [
  ...common,
  rule('POST', `jobs/${id}/quotes`), rule('GET', `jobs/${id}/quotes/${id}/cost-codes\\.(?:json|csv)`),
  rule('POST', `jobs/${id}/takeoff`), rule('POST', `jobs/${id}/takeoff/${id}/${id}`), rule('POST', `jobs/${id}/takeoff-estimate/(?:preview|apply)`),
  rule('POST', `jobs/${id}/pricing/(?:preview|apply)`), rule('POST', `jobs/${id}/estimate-template/(?:preview|apply)`),
  rule('GET', 'pricing-rates'), rule('GET', `pricing-rates/${id}`), rule('GET', 'estimate-catalog'),
  rule('GET', 'bids'), rule('GET', `bids/${id}`), rule('GET', `bids/${id}/files/${id}`), rule('POST', `bids/${id}`),
 ],
 // Superintendents record the day: logs are saved as drafts for the office to publish, and observations are captured with photos.
 superintendent: [...common, rule('GET', `jobs/${id}/time`), rule('POST', `jobs/${id}/time`), rule('POST', `jobs/${id}/time/${id}/correct`), rule('POST', `jobs/${id}/time/(?:consent|location)`), rule('POST', `jobs/${id}/diary`), rule('POST', `jobs/${id}/punch/issues`), rule('POST', `jobs/${id}/schedule-actuals`)],
 bookkeeper: [rule('GET', `jobs/${id}/costs/period-preview`), rule('POST', `jobs/${id}/costs/period-reviews`), rule('GET', `jobs/${id}/costs/access`), rule('GET', 'jobs'), rule('GET', `jobs/${id}`), rule('GET', `jobs/${id}/costs(?:/(?:ledger|bills|forecasts|cash|periods))?`), rule('GET', `jobs/${id}/costs/bills/${id}/original`), rule('POST', `jobs/${id}/costs/bills`), rule('POST', `jobs/${id}/costs/bills/${id}/(?:recode|review|route)`), rule('POST', `jobs/${id}/costs/reconcile`)],
 reader: [rule('GET', `report-schedules(?:/${id}/downloads/${id})?`),rule('GET', `jobs/${id}/costs/access`), rule('GET', 'jobs'), rule('GET', `jobs/${id}`), rule('GET', `jobs/${id}/costs/draw-packet`)],
 crew: [...common, rule('GET', `jobs/${id}/time`), rule('POST', `jobs/${id}/time`), rule('POST', `jobs/${id}/time/${id}/correct`), rule('POST', `jobs/${id}/time/(?:consent|location)`)],
}
export function roleGate(actor: Actor, request: Request) {
 if (actor.permissions) enforce(actor, request)
 if (!(actor.role in rules)) return
 const path = new URL(request.url).pathname, prefix = '/api/plinth/'
 const allowed = path.startsWith(prefix) && rules[actor.role as keyof typeof rules]?.some(([method, pattern]) => method === request.method && pattern.test(path.slice(prefix.length).replace(/\/+$/, '')))
 need(allowed, 'This role does not include that route', 403, 'forbidden')
}
