import { runtimeBindings, type Bindings } from '../auth.server'
import { dispatchWarrantyReminders } from './warranty-reminders'

/** Durable cursor resumes at the next bounded page on the following hour. */
export async function warrantyScheduled(controller: ScheduledController, original: Bindings) {
 const env=runtimeBindings(original),until=Date.now()+45_000
 for(let page=0;page<8&&Date.now()<until;page++){
  const result=await dispatchWarrantyReminders(env,{now:controller.scheduledTime})
  if(result.nextCursor===null)break
 }
}
