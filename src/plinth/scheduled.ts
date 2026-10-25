import { runtimeBindings, type Bindings } from '../auth.server'
import { dispatchConnectors } from './connector-dispatch'
import { warrantyScheduled } from './warranty-cron'

export async function plinthScheduled(controller: ScheduledController, env: Bindings) {
 await Promise.all([dispatchConnectors(runtimeBindings(env)), warrantyScheduled(controller, env)])
}
