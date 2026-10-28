import type {BidSource,BidView} from '../plinth/bid-model'
import {Action,Field,Form,dateTime} from './shared'
import type {BidMutate} from './bid-records'

export function BidFollowUp({source,bid,manage,estimator,mutate}:{source:BidSource;bid:BidView;manage:boolean;estimator:boolean;mutate:BidMutate}) {
 const plan=bid.follow_up,revision=bid.revisions.at(-1)!
 return <section className="record" aria-label="Procurement follow-up">
  <h4>Procurement and bid follow-up</h4>
  {plan?<><p>Required on site {plan.required_on_site} · {plan.lead_days} calendar days lead time · Order by {plan.order_by}</p><p>Linked task: {source.tasks?.find(t=>t.id===plan.task_id)?.description} · Bid deadline {revision.due_on}</p><p>Estimator: {plan.estimator_name} · {plan.paused?'Reminders paused':plan.revision_id!==revision.id?'Revision changed — approve follow-up again':'Approved native inbox reminders'}</p>
   {plan.escalation&&<div role="status"><strong>Estimator escalation</strong><p>{plan.escalation.invitation_ids.length} unresolved invitations · {dateTime(plan.escalation.at)}. Review procurement risk before promising the linked start.</p>{plan.escalation.review?<p>Reviewed by {plan.escalation.review.by.name}: {plan.escalation.review.reason}</p>:estimator&&<Form submit="Record procurement review" action={async f=>mutate(`/${bid.id}/review-follow-up`,{reason:f.get('reason')})}><Field label="Procurement decision and remaining risk" name="reason"/></Form>}</div>}
   {manage&&!plan.paused&&<div className="button-row"><Action action={()=>mutate(`/${bid.id}/run-follow-up`)}>Check due bid reminders</Action><Action className="secondary" action={()=>mutate(`/${bid.id}/pause-follow-up`)}>Pause bid reminders</Action></div>}
  </>:<p>No approved follow-up. Link a draft schedule task and approve reminders before promising its start.</p>}
  {manage&&<details><summary>Procurement settings</summary><p>Reminders appear in each invited contact’s private bid inbox. One acknowledgment reminder and one missing-price reminder per approval are recorded. Responses and declines stop the chase. No email, order, award or start date is sent automatically.</p>
   <Form submit="Approve procurement follow-up" action={async f=>mutate(`/${bid.id}/follow-up`,{revision_id:revision.id,...(f.get('task')==='new'?{draft_task:{description:f.get('task_name'),start:String(f.get('task_date'))+'T08:00:00Z',end:String(f.get('task_date'))+'T09:00:00Z'}}:{task_id:f.get('task')}),required_on_site:f.get('on_site'),lead_days:Number(f.get('lead')),remind_on:f.get('remind'),estimator_id:f.get('estimator'),confirm:f.get('confirm')==='on'})}>
    <label>Linked draft task<select aria-label="Linked draft task" name="task" required><option value="new">New unpromised task</option>{source.tasks?.filter(t=>t.status==='draft').map(t=><option key={t.id} value={t.id}>{t.description} · {t.start.slice(0,10)}</option>)}</select></label>
    <Field label="New draft task name" name="task_name" required={false}/><Field label="New draft task date (UTC)" name="task_date" type="date" required={false}/>
    <Field label="Required on site (UTC)" name="on_site" type="date" defaultValue={plan?.required_on_site}/><Field label="Material lead time (calendar days)" name="lead" type="number" min="1" max="3650" step="1" defaultValue={plan?.lead_days}/><Field label="First acknowledgment reminder (UTC)" name="remind" type="date" defaultValue={plan?.remind_on}/>
    <label>Assigned estimator<select aria-label="Assigned estimator" name="estimator" required><option value="">Choose a current assigned estimator</option>{source.estimators?.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label><input type="checkbox" name="confirm" required/> I approve these dates and native inbox reminders for the exact current bid revision.</label>
   </Form>
  </details>}
 </section>
}
