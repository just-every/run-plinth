import { Badge, Action, calendarDay, Field, Form } from './shared'
import type { JobProps } from './job'

export function DailyLogs({job,manager,mutate}: JobProps) {
  return <div className="split"><section className="card"><div className="card-head"><h2>Daily logs</h2><span className="muted">{job.diary.length} {job.diary.length === 1 ? 'entry' : 'entries'}</span></div>
    {job.diary.length === 0 && <p className="empty">No daily logs yet. Record what happened on site, with photos.</p>}
    <ol className="timeline">{[...job.diary].sort((a, b) => b.date.localeCompare(a.date)).map(d => <li className="log-entry" key={d.id}><div className="log-date"><time dateTime={d.date}>{calendarDay(d.date)}</time><Badge>{d.status}</Badge></div><div className="log-body"><p className="pre-wrap">{d.note}</p><p className="muted">{d.prepared_by.name}</p>{d.attachments.length > 0 && <div className="photos">{d.attachments.map(a => <a key={a.id} href={'/api/plinth/jobs/'+job.id+'/diary/'+d.id+'/attachments/'+a.id} target="_blank" rel="noreferrer"><img src={'/api/plinth/jobs/'+job.id+'/diary/'+d.id+'/attachments/'+a.id} alt={a.name} /><span>{a.name}</span></a>)}</div>}{manager && d.status === 'draft' && <Action className="primary" action={() => mutate('/diary/'+d.id+'/approve')}>Publish daily log</Action>}</div></li>)}</ol></section>
    {manager && <aside className="card side"><h2>Write a daily log</h2><Form submit="Publish daily log" action={async f => {
    const attachments = []
    for (const file of f.getAll('photos')) if (file instanceof File && file.size) {
      if (file.size > 2 * 1024 * 1024) throw new Error('Each photo must be 2 MB or smaller.')
      const base64 = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })
      attachments.push({name:file.name,mime:file.type,base64})
    }
    return mutate('/diary',{date:f.get('date'),note:f.get('note'),attachments})
  }}><Field label="Log date" name="date" type="date" defaultValue={new Date().toISOString().slice(0,10)} /><label>Work, conditions and decisions<textarea name="note" required rows={5} /></label><label>Photos (PNG or JPEG, up to 2 MB each)<input type="file" name="photos" accept="image/png,image/jpeg" multiple /></label></Form></aside>}</div>
}
