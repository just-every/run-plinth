import { Action, dateTime, Field, Form } from './shared'
import type { JobProps } from './job'

export function SchedulePanel({job,manager,mutate}: JobProps) {
  return <div className="two-columns"><section className="panel"><h2>Scheduled trades</h2><p>Overlapping bookings for the same trade are refused across all jobs.</p>{job.schedules.length === 0 && <p>No trades booked yet.</p>}{job.schedules.map(s => <article className="record" key={s.id}><span className="badge">{s.status}</span><h3>{s.trade}</h3><p>{dateTime(s.start)} – {dateTime(s.end)}</p><p>{s.description}</p>{manager && s.status === 'draft' && <Action action={() => mutate('/schedules/'+s.id+'/approve')}>Approve trade booking</Action>}</article>)}</section>{manager && <section className="panel"><h2>Book a trade</h2><Form submit="Book trade" action={async f => mutate('/schedules',{trade:f.get('trade'),start:new Date(String(f.get('start'))).toISOString(),end:new Date(String(f.get('end'))).toISOString(),description:f.get('description')})}><Field label="Trade or subcontractor" name="trade" placeholder="River City Electrical" /><Field label="Starts (your local time)" name="start" type="datetime-local" /><Field label="Ends (your local time)" name="end" type="datetime-local" /><Field label="Work to complete" name="description" /></Form></section>}</div>
}
export function DiaryPanel({job,manager,mutate}: JobProps) {
  return <div className="two-columns"><section className="panel"><h2>Daily site diary</h2>{job.diary.length === 0 && <p>No entries yet. Record what happened on site, with photos.</p>}{[...job.diary].reverse().map(d => <article className="record" key={d.id}><div className="heading"><h3>{d.date}</h3><span className="badge">{d.status}</span></div><p className="pre-wrap">{d.note}</p><p className="muted">{d.prepared_by.name}</p><div className="photos">{d.attachments.map(a => <a key={a.id} href={'/api/plinth/jobs/'+job.id+'/diary/'+d.id+'/attachments/'+a.id} target="_blank" rel="noreferrer"><img src={'/api/plinth/jobs/'+job.id+'/diary/'+d.id+'/attachments/'+a.id} alt={a.name} /><span>{a.name}</span></a>)}</div>{manager && d.status === 'draft' && <Action action={() => mutate('/diary/'+d.id+'/approve')}>Publish diary entry</Action>}</article>)}</section>{manager && <section className="panel"><h2>Record a site day</h2><Form submit="Publish diary entry" action={async f => {
    const attachments = []
    for (const file of f.getAll('photos')) if (file instanceof File && file.size) {
      if (file.size > 2 * 1024 * 1024) throw new Error('Each photo must be 2 MB or smaller.')
      const base64 = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })
      attachments.push({name:file.name,mime:file.type,base64})
    }
    return mutate('/diary',{date:f.get('date'),note:f.get('note'),attachments})
  }}><Field label="Site date" name="date" type="date" defaultValue={new Date().toISOString().slice(0,10)} /><label>Work, conditions and decisions<textarea name="note" required rows={5} /></label><label>Photos (PNG or JPEG, up to 2 MB each)<input type="file" name="photos" accept="image/png,image/jpeg" multiple /></label></Form></section>}</div>
}
