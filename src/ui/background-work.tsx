import { useEffect, useState } from 'react'
import { Action, Form, api } from './shared'
import type { ReportView } from '../plinth/report-query'
type Task={id:string;version:number;state:string;name:string;format:string;progress:number;total:number;error:string|null;checksum:string|null;digest:string;view_version:number;created_at:string}
const states:Record<string,string>={paused:'Paused',complete:'Complete',failed:'Failed',cancelled:'Cancelled',review_required:'Destination owner review required'}
/** Explicit owner-driven chunks use the existing Reports components and typography. */
export function BackgroundWork({views}:{views:{view:ReportView;version:number}[]}){
 const [tasks,setTasks]=useState<Task[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 async function refresh(){setLoading(true);try{setTasks((await api('/reports/work')).tasks);setError('')}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
 useEffect(()=>{void refresh()},[])
 async function act(task:Task,action:string){try{await api(`/reports/work/${task.id}/${action}`,{expected_version:task.version,...(action==='review'?{digest:task.digest,confirm:true}:{})});await refresh()}catch(e){await refresh();throw e}}
 return <details className="card"><summary>Report export work</summary>
 <p>Request a private capture of a saved view. Each explicit continuation saves at most 25 records. You can leave and resume later; nothing runs while this page is closed.</p>
 {error&&<p role="alert">{error}</p>}
 {views.length>0?<Form submit="Request report export" action={async f=>{const saved=views.find(v=>v.view.id===f.get('view'))!;await api('/reports/work',{view_id:saved.view.id,expected_view_version:saved.version,format:f.get('format')});await refresh()}}><div className="fields"><label>Export saved view<select name="view">{views.map(v=><option key={v.view.id} value={v.view.id}>{v.view.name}</option>)}</select></label><label>Export format<select name="format"><option value="csv">CSV</option><option value="xlsx">XLSX</option></select></label></div></Form>:<p>Save a view below before requesting an export.</p>}
 <Action action={refresh}>Refresh export work</Action>
 <div aria-live="polite">{loading&&<p role="status">Loading export work…</p>}{!loading&&!tasks.length&&<p>No requested exports.</p>}</div>
 {tasks.map(t=><section className="record" key={t.id} data-work-id={t.id} aria-label={t.name+' '+t.format+' export'}>
 <h3>{t.name} · {t.format.toUpperCase()}</h3>
 <p role="status">{states[t.state]??t.state} · {t.progress} of {t.total} records</p>
 <progress aria-label="Export progress" value={t.progress} max={Math.max(1,t.total)}/>
 <p>Saved view revision {t.view_version} · Captured {new Date(t.created_at).toLocaleString()}</p>
 {t.error&&<p role="alert">{t.error}</p>}
 {(t.state==='paused'||t.state==='failed')&&<Action action={()=>act(t,'resume')}>{t.state==='failed'?'Retry next chunk':'Resume next chunk'}</Action>}
 {t.state==='review_required'&&<Form submit="Approve recovered export" action={async f=>{if(f.get('confirm')!=='on')throw new Error('Review the captured view before approving.');await act(t,'review')}}><p>Recovered work is inactive. Review the captured view revision and record count before allowing continuation or download in this installation.</p><label><input name="confirm" type="checkbox" required/>I approve this exact recovered export in this installation.</label></Form>}
 {t.state==='complete'&&<><p><a href={`/api/plinth/reports/work/${t.id}/download`} download>Download verified {t.format.toUpperCase()}</a></p><details><summary>Download checksum</summary><p style={{overflowWrap:'anywhere'}}>SHA-256: {t.checksum}</p></details></>}
 {t.state!=='cancelled'&&<Action action={()=>act(t,'cancel')}>Cancel export</Action>}
 </section>)}
 </details>
}
