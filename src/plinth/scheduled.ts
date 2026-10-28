import { dispatchReportSchedules } from './report-schedule'
import { runtimeBindings, type Bindings } from '../auth.server'
import { dispatchConnectors } from './connector-dispatch'
import { warrantyScheduled } from './warranty-cron'
import { dispatchBidFollowUps } from './bid-follow-up'

export async function plinthScheduled(controller: ScheduledController, env: Bindings) {
 await Promise.all([dispatchConnectors(runtimeBindings(env)), warrantyScheduled(controller, env), dispatchReportSchedules(env, controller.scheduledTime)])
 await dispatchBidFollowUps(runtimeBindings(env).DB, controller.scheduledTime)
}
