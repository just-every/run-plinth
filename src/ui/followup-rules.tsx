import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import type { FollowupRule, FollowupKind, FollowupAction, FollowupConsent } from '../plinth/followup-model'
import { api, Field, Form, Action, money } from './shared'
type RulesData={version:number;owner_id:string;rules:FollowupRule[];recipients:{id:string;display_name:string;email:string}[]}
const labels:Record<FollowupKind,string>={estimate:'Estimate',selection:'Selection',collection:'Collection'}
export function FollowupSettings({jobs}:{jobs:Job[]}){
 const [jobId,setJobId]=useState(jobs[0]?.id??''),[data,setData]=useState<RulesData>(),[editing,setEditing]=useState<FollowupRule>(),[preview,setPreview]=useState<{as_of:string;actions:FollowupAction[]}>(),[error,setError]=useState('')
 const root='/jobs/'+jobId+'/followup-rules'
 async function refresh(){if(!jobId)return;try{setData(await api(root));setError('')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{setData(undefined);setPreview(undefined);setEditing(undefined);void refresh()},[jobId])
 const r=editing?.revisions.at(-1)
 return <section aria-label="Follow-up rules"><h3>Follow-up rules</h3><p>Plan estimate, selection and collection sequences. Previews create no notices or financial actions. Delivery channels and required notices are still unavailable.</p>
 <label>Rule job<select value={jobId} onChange={e=>setJobId(e.target.value)}>{jobs.map(j=><option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
 {error&&<p role="alert">{error}</p>}
 {data&&<><Form key={jobId+':'+(r?.revision??0)+':'+(editing?.id??'new')} reset={false} submit={r?'Save rule revision':'Save preview rule'} action={async f=>{
  const steps=String(f.get('steps')).split('\n').filter(line=>line.trim()).map(line=>{const [days,kind,...label]=line.split(',');return {after_days:Number(days),escalate:kind?.trim()==='escalate',label:label.join(',').trim()}})
  const current=await api(root)
  await api(root,{expected_version:current.version,kind:f.get('kind'),mode:f.get('mode'),starts_on:f.get('starts_on'),stop_on:f.get('stop_on'),recipients:f.getAll('recipients'),escalation_recipient:data.owner_id,quiet_start:f.get('quiet_start'),quiet_end:f.get('quiet_end'),time_zone:f.get('time_zone'),approval_limit_cents:Number(f.get('approval_limit_cents')),steps,paused:f.get('paused')==='on',reason:f.get('reason'),confirm:f.get('confirm')==='on'})
  setEditing(undefined);setPreview(undefined);await refresh()
 }}><div className="fields">
 <label>Sequence<select name="kind" defaultValue={editing?.kind??'estimate'}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>Trigger<select name="mode" defaultValue={r?.mode??'event'}><option value="event">Source event</option><option value="scheduled">Scheduled dates</option></select></label>
 <Field name="starts_on" label="Sequence starts" type="date" defaultValue={r?.starts_on}/><Field name="stop_on" label="Sequence stops" type="date" defaultValue={r?.stop_on}/>
 <Field name="time_zone" label="Quiet-hours time zone" defaultValue={r?.time_zone??'America/Chicago'}/>
 <Field name="quiet_start" label="Quiet hours start" type="time" defaultValue={r?.quiet_start??'20:00'}/><Field name="quiet_end" label="Quiet hours end" type="time" defaultValue={r?.quiet_end??'08:00'}/>
 <Field name="approval_limit_cents" label="Owner review limit (cents)" type="number" min="0" step="1" defaultValue={r?.approval_limit_cents??1000000}/>
 </div><fieldset><legend>Recipients with current job access</legend>{data.recipients.map(p=><label key={p.id}><input type="checkbox" name="recipients" value={p.id} defaultChecked={r?.recipients.includes(p.id)??p.id===data.owner_id}/>{p.display_name}</label>)}</fieldset>
 <p>Recipients must enable their own preview consent in the job Settings. Escalation stays with you and also requires your consent.</p>
 <label>Steps<textarea name="steps" rows={3} required defaultValue={r?.steps.map(s=>s.after_days+','+(s.escalate?'escalate':'reminder')+','+s.label).join('\n')??'0,reminder,First follow-up\n7,escalate,Owner review'}/></label>
 <p>One line per step: elapsed days, reminder or escalate, label. Event sequences start at the estimate preparation, selection presentation or invoice due date. Scheduled sequences start at the later of the source due date and sequence start. Resolved, disputed or withdrawn work and opt-outs always stop eligibility.</p>
 <Field name="reason" label="Revision reason" defaultValue="Owner reviewed preview sequence"/><label><input name="paused" type="checkbox" defaultChecked={r?.paused}/>Pause this sequence</label>
 <label><input name="confirm" type="checkbox" required/>I confirm these preview settings; this authorizes no delivery or financial approval.</label></Form>
 <h4>Retained revisions</h4>{data.rules.map(rule=><article className="record" key={rule.id} aria-label={labels[rule.kind]+' rule'}><h4>{labels[rule.kind]} sequence · revision {rule.revisions.at(-1)!.revision}</h4><p>{rule.revisions.at(-1)!.paused?'Paused':'Active preview'} · limit {money(rule.revisions.at(-1)!.approval_limit_cents)}</p><Action action={async()=>setEditing(rule)}>Edit {labels[rule.kind].toLowerCase()} rule</Action><details><summary>{labels[rule.kind]} revision history</summary>{rule.revisions.map(v=><p key={v.revision}>Revision {v.revision} · {v.by.name} · {v.by.at} · {v.paused?'Paused':'Active'} · {v.reason}</p>)}</details></article>)}
 <Form submit="Preview dated actions" reset={false} action={async f=>setPreview(await api(root+'/preview?as_of='+encodeURIComponent(String(f.get('as_of')))))}>
 <Field name="as_of" label="Preview instant" defaultValue="2026-11-04T15:00:00Z"/></Form>
 {preview&&<section aria-label="Dated follow-up preview" role="region"><h4>Preview at {preview.as_of}</h4><p>No notice, task, approval or provider call was created.</p>{preview.actions.length===0?<p>No matching sources.</p>:preview.actions.map(a=><article className="record" key={a.key}><h4>{a.source_title} · {a.step}</h4><p>{a.recipient_name} · rule revision {a.rule_revision} · due {a.due_on}</p><p>{a.status==='eligible'?'Eligible preview':'Withheld'} · {a.reason}</p></article>)}</section>}</>}
 </section>
}
export function FollowupPreferences({jobId}:{jobId:string}){
 const [data,setData]=useState<{version:number;consents:FollowupConsent[];kinds:FollowupKind[]}>(),[open,setOpen]=useState(false)
 const root='/jobs/'+jobId+'/followup-consent'
 async function refresh(){setData(await api(root))}
 useEffect(()=>{if(open)void refresh()},[jobId,open])
 return <details className="card" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Follow-up preview Settings</summary>{data&&<><p>These choices affect prospective previews only. They authorize no delivery.</p>{data.kinds.map(kind=><Form key={kind+':'+data.version} reset={false} submit={'Save '+labels[kind].toLowerCase()+' preference'} action={async f=>{const current=await api(root);await api(root,{expected_version:current.version,kind,allowed:f.get('allowed')==='on',confirm:true});await refresh()}}><label><input type="checkbox" name="allowed" defaultChecked={data.consents.findLast(c=>c.kind===kind)?.allowed??false}/>Allow {labels[kind].toLowerCase()} follow-up previews for me</label></Form>)}</>}</details>
}
