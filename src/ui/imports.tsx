import { useState } from 'react'
import { Badge, Action, api, Form, money } from './shared'
import { WorkbookImport } from './workbook-import'
import { Page } from './shell'

function download(name: string, body: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type })), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function Coverage({ report }: { report: any }) {
  return <section aria-label="Source coverage" className="record import-coverage">
    <h3>Source coverage</h3>
    <p>{report.scope}</p>
    <p><strong>Owner-declared source · unverified</strong></p>
    <dl><dt>Source system</dt><dd>{report.declaration?.sourceSystem || 'Not supplied'}</dd><dt>Extraction scope</dt><dd>{report.declaration?.extractionScope || 'Not supplied'}</dd><dt>Extraction time</dt><dd>{report.declaration?.extractedAt || 'Not supplied'}</dd><dt>Mapping revision</dt><dd className="id">{report.mappingRevision}</dd><dt>Original SHA-256</dt><dd className="id">{report.artifact.sha256}</dd><dt>Original bytes</dt><dd>{report.artifact.bytes}</dd></dl>
    <p aria-label="Coverage counts">{Object.entries(report.counts).map(([key, value]) => <span key={key}>{key}: {String(value)}{' · '}</span>)}</p>
    {report.diagnostics.length > 0 && <ul aria-label="Source diagnostics">{report.diagnostics.map((d: any, i: number) => <li key={i}>Row {d.location.row}, column {d.location.column} · {d.code} · {d.message}</li>)}</ul>}
    <ol className="rows">{report.rows.map((row: any, i: number) => <li className="record" key={i}><p><strong>{row.row ? 'Row ' + row.row : 'Erased row'}{row.externalId ? ' · ' + row.externalId : ''}</strong> <Badge>{row.disposition}</Badge></p><p>{row.reason}</p>{row.columns && <details><summary>Column coverage</summary><ul>{row.columns.map((c: any) => <li key={c.column}>Column {c.column} · {c.field} · line {c.line}, character {c.character} · {c.treatment}</li>)}</ul></details>}</li>)}</ol>
    <button className="secondary" onClick={() => download('accepted-jobs-coverage.json', JSON.stringify(report, null, 2), 'application/json')}>Download coverage report</button>
  </section>
}
export function Imports({onChange}: {onChange: () => Promise<void>}) {
  const [csv, setCsv] = useState(''), [declaration, setDeclaration] = useState<any>(), [preview, setPreview] = useState<any>(), [coverage, setCoverage] = useState<any>(), [reports, setReports] = useState<Record<string, any>>({}), [jobs, setJobs] = useState<any[]>([]), [loaded,setLoaded] = useState(false)
  async function refresh() { const result = await api('/imports'); setJobs(result.jobs); setLoaded(true) }
  return <Page title="Move in" lead="Review imported jobs and coded estimates before adopting inert drafts."><WorkbookImport onChange={async()=>{await refresh();await onChange()}}/><div className="split import-workspace">
    <section className="card"><div className="card-head"><h2>Preview your file</h2><span className="muted">Accepted jobs CSV</span></div><p className="card-lead">Use the documented columns below. Imported jobs remain drafts until you confirm their source acceptance.</p><code className="csv-header">external_id,title,client_email,site_address,quote_cents,accepted_on</code><p className="muted">Money is whole USD cents; dates use YYYY-MM-DD. Maximum 100 rows. No accounts are created and no messages sent.</p>
      <Form submit="Dry run CSV" reset={false} action={async f => {
        setPreview(undefined); setCoverage(undefined)
        const file=f.get('csv'); if (!(file instanceof File) || !file.size) throw new Error('Choose a CSV file.')
        const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer())
        const source={sourceSystem:String(f.get('sourceSystem') || ''),extractionScope:String(f.get('extractionScope') || ''),extractedAt:String(f.get('extractedAt') || ''),verified:false}
        setCsv(content); setDeclaration(source)
        const response=await fetch('/api/plinth/imports/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({csv:content,declaration:source})}), result:any=await response.json()
        setCoverage(result.coverage)
        if(!response.ok) throw new Error(result.message || 'CSV could not be reviewed.')
        setPreview(result); await refresh()
      }}><div onChange={() => {setPreview(undefined);setCoverage(undefined)}}><label>Jobs CSV<input name="csv" type="file" accept=".csv,text/csv" required /></label><details><summary>Declare source and extraction</summary><p>Optional owner declarations are unverified. Do not include credentials or personal details. Changing them requires a fresh dry run.</p><label>Source system<input name="sourceSystem" maxLength={120} /></label><label>Extraction scope<input name="extractionScope" maxLength={500} /></label><label>Extraction time in UTC<input name="extractedAt" placeholder="2026-10-01T12:00:00Z" maxLength={40} /></label></details></div></Form>
      {coverage && <Coverage report={coverage}/>}
      {preview && <div className="preview"><h3>Dry-run result</h3><ol className="rows">{preview.rows?.map((r:any,i:number) => <li className="row" key={i}><div className="row-main"><strong>{r.title}</strong><span className="muted">{r.client_email}</span></div><div className="row-end"><strong className="amount">{money(Number(r.quote_cents), r.currency)}</strong></div></li>)}</ol><details><summary>Counts and diagnostics</summary><pre>{JSON.stringify({counts:preview.counts,diagnostics:preview.diagnostics},null,2)}</pre></details><p>Approval applies only to this exact file, source declaration and mapping. Existing records are never overwritten.</p><Action className="primary" action={async () => { await api('/imports/commit',{csv,declaration,mappingRevision:coverage.mappingRevision,fingerprint:preview.fingerprint}); setPreview(undefined); setCoverage(undefined); setCsv(''); await refresh(); await onChange() }}>Approve and import drafts</Action></div>}
    </section>
    <aside className="card side"><h2>Import journal</h2><Action className="secondary" action={refresh}>{loaded ? 'Refresh journal' : 'Load journal'}</Action>{loaded && jobs.length===0 && <p className="muted">No imports yet.</p>}{jobs.map(j => <article className="record" aria-label={'Import ' + j.id} key={j.id}><div className="record-head"><h3>{j.name || 'Accepted jobs CSV'}</h3><Badge>{j.state}</Badge></div><p className="muted id">{j.id}</p>{j.state === 'completed' && <Action className="secondary" action={async () => { await api('/imports/'+j.id+'/undo',{}); setReports({}); await refresh(); await onChange() }}>Undo import</Action>}{['queued','applying','planned','created','preparing'].includes(j.state) && <Action className="primary" action={async () => { await api('/imports/'+j.id+'/resume',{}); setReports({}); await refresh(); await onChange() }}>Resume import</Action>}<Action className="secondary" action={async () => {const result=await api('/imports/'+j.id+'/coverage');setReports(value=>({...value,[j.id]:result.coverage}))}}>Inspect coverage</Action><Action className="secondary" action={async () => {const result=await api('/imports/'+j.id+'/originals'),original=result.originals[0]?.original;if(!original || original.status==='unavailable')throw new Error('Original unavailable after erasure.');download('accepted-jobs.csv',Uint8Array.from(atob(original.base64),(c:string)=>c.charCodeAt(0)),'text/csv')}}>Download original CSV</Action>{reports[j.id] && <Coverage report={reports[j.id]}/>}<details><summary>Journal details</summary><pre>{JSON.stringify(j,null,2)}</pre></details></article>)}</aside>
  </div></Page>
}
