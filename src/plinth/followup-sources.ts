import type { Job } from './model'
import type { FollowupSource } from './followup-model'
import { invoiceBalance } from './invoices'
import { wallClock } from './time-zone'
import { invitationSnapshot } from './schedule-resource-model'
import { bidAnswered } from './bid-follow-up'
const dateAt=(at:string,job:Job)=>wallClock(Date.parse(at),job.time_zone??'UTC').date
/** Source revisions are read live. A notice never resolves or approves its source. */
export function followupSources(job:Job):FollowupSource[]{
 const quotes=job.quotes.slice(-1).map(q=>({id:q.id,revision:String(q.revision),kind:'estimate' as const,title:'Estimate revision '+q.revision,event_on:dateAt(q.prepared_by.at,job),scheduled_on:dateAt(q.prepared_by.at,job),amount_cents:q.total_cents,outstanding:q.status==='draft'&&job.status==='quoting'}))
 const selections=(job.selections??[]).flatMap(s=>{const r=s.revisions.at(-1);return !r||r.status==='draft'?[]:[{id:s.id,revision:r.id,kind:'selection' as const,title:r.room+' · '+r.category,event_on:dateAt(r.presented_by!.at,job),scheduled_on:r.decision_on,amount_cents:Math.max(r.allowance_cents,...r.options.map(o=>o.price_cents)),outstanding:r.status==='presented'&&!s.decisions?.some(d=>d.revision_id===r.id&&['withdraw','dispute'].includes(d.kind))}]})
 const invoices=(job.invoices??[]).filter(i=>i.issued).map(i=>({id:i.id,revision:i.number!,kind:'collection' as const,title:i.number+' · '+i.description,event_on:i.due_on,scheduled_on:i.due_on,amount_cents:Math.max(0,invoiceBalance(job,i).due_cents),outstanding:invoiceBalance(job,i).due_cents>0}))
 const bids=(job.bids??[]).filter(b=>b.published_by).flatMap(b=>b.invitations.map(i=>({id:i.id,revision:b.revisions.at(-1)!.id,kind:'bid' as const,title:b.title+' · '+i.contact_name,event_on:dateAt(i.by.at,job),scheduled_on:b.revisions.at(-1)!.due_on,amount_cents:0,outstanding:!i.revoked_by&&!bidAnswered(b,i)})))
 const rfis=(job.rfis??[]).map(r=>({id:r.id,revision:String(r.number),kind:'rfi' as const,title:r.title,event_on:dateAt(r.by.at,job),scheduled_on:r.due_on,amount_cents:0,outstanding:!r.resolved}))
 const confirmations=(job.trade_invitations??[]).flatMap(i=>{const t=job.schedules.find(t=>t.id===i.task_id);return !t?[]:[{id:i.id,revision:i.snapshot,kind:'confirmation' as const,title:t.description,event_on:dateAt(i.invited_by.at,job),scheduled_on:dateAt(i.start,job),amount_cents:0,outstanding:t.status==='booked'&&i.snapshot===invitationSnapshot(t)&&i.responses.at(-1)?.kind!=='confirm'}]})
 const warranties=(job.warranties?.cases??[]).map(c=>({id:c.id,revision:c.id,kind:'warranty' as const,title:c.description,event_on:c.reported_on,scheduled_on:c.reported_on,amount_cents:0,outstanding:c.status==='open'}))
 return [...quotes,...selections,...invoices,...bids,...rfis,...confirmations,...warranties]
}
