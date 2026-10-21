import { useEffect, useState } from 'react'
import { api, dateTime, Field, Form } from './shared'
import type { JobProps } from './job'
import type { HandoverDocument, HandoverPackage } from '../plinth/handover-model'
import { HandoverDocuments, type HandoverMutate } from './handover-documents'

interface Source { version: number; documents: HandoverDocument[]; packages: HandoverPackage[] }
export function Handover({ job, manager }: JobProps) {
 const [source, setSource] = useState<Source>(), [error, setError] = useState(''), [query, setQuery] = useState('')
 const path = `/jobs/${job.id}/handover`, prefix = '/api/plinth' + path + '/files/'
 async function refresh() { setSource(await api(path)); setError('') }
 useEffect(() => { refresh().catch(e => setError(e.message)) }, [job.id])
 const mutate: HandoverMutate = async (tail, input) => { try { return await api(path + tail, { expected_version: source?.version, ...input }) } finally { await refresh() } }
 if (!source) return <p role={error ? 'alert' : 'status'}>{error || 'Opening handover…'}</p>
 const words = query.trim().toLowerCase(), shown = source.packages.filter(p => !words || JSON.stringify(p).toLowerCase().includes(words))
 return <div className="split"><section className="card"><h2>Handover and final acceptance</h2><p>Builder completion and client acceptance are separate decisions. Punch exceptions stay assigned. Retainage still follows the approved billing rules.</p><Field label="Search handover packages and documents" name="handover-search" type="search" required={false} value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}/>
 {!shown.length && <p className="empty">No {manager ? '' : 'released '}handover packages match.</p>}
 {shown.map(p => <Package key={p.id} row={p} manager={manager} prefix={prefix} mutate={mutate}/>)}
 {manager && <details><summary>Prepare an exact handover package</summary><Form submit="Prepare handover package" action={async f => mutate('/packages', { title: f.get('title'), documents: f.getAll('document').filter(Boolean).map(v => { const [document_id, revision_id] = String(v).split(':'); return { document_id, revision_id } }) })}><Field label="Package title" name="title"/>{source.documents.map(d => <label key={d.id}>Include {d.title}<select name="document" aria-label={'Package revision: ' + d.title}><option value="">Leave out of this package</option>{d.revisions.map(r => <option key={r.id} value={d.id + ':' + r.id}>Revision {r.revision} · {r.reference}</option>)}</select></label>)}<p>Every unresolved punch item must have an assignee and be explicitly released to the client before preparing this package.</p></Form></details>}
 </section>{manager && <HandoverDocuments documents={source.documents} prefix={prefix} mutate={mutate}/>}</div>
}
function Package({ row: p, manager, prefix, mutate }: { row: HandoverPackage; manager: boolean; prefix: string; mutate: HandoverMutate }) {
 return <article className="record"><h3>{p.title} · package {p.revision}</h3><p>{p.by.name} · {dateTime(p.by.at)}</p><h4>Exact document revisions</h4>{p.documents.map(d => <p key={d.id}><strong>{d.title}</strong> · {d.kind}<br/><a href={prefix + d.source.file.id}>{d.source.file.name} · revision {d.source.revision}</a><br/>{d.source.reference}</p>)}
 {!!p.selection_references.length && <><h4>Approved selections</h4>{p.selection_references.map((s, i) => <p key={i}>{s.room} · {s.category} · revision {s.revision}<br/>{JSON.stringify(s.specification)}</p>)}</>}
 {!!p.warranty_references.length && <><h4>Signed warranty terms</h4>{p.warranty_references.map(w => <p key={w.id}>{JSON.stringify(w.snapshot)}</p>)}</>}
 <h4>Unresolved punch exceptions</h4>{p.exceptions.length ? p.exceptions.map(e => <p key={e.id}>#{e.number} {e.title} · {e.status}<br/>{e.responsible} · {e.location} · due {e.due_on}</p>) : <p>No unresolved punch exceptions in this package.</p>}
 {!!p.punch_results.length && <details><summary>Recorded punch results</summary>{p.punch_results.map(r => <p key={r.id}>#{r.number} {r.title} · {r.status} · {r.attempts} repair attempts</p>)}</details>}
 {p.completion ? <p className="notice">Builder completion: {p.completion.statement}<br/>{p.completion.by.name} · {dateTime(p.completion.by.at)}</p> : manager && <Form submit="Record builder completion and release package" action={async f => mutate(`/packages/${p.id}/complete`, { digest: p.digest, confirm: f.get('confirm') === 'on', client_safe: f.get('client_safe') === 'on', statement: f.get('statement') })}><Field label="Builder completion statement" name="statement"/><label><input name="client_safe" type="checkbox" required/> I reviewed every original and snapshot as safe for this job’s clients.</label><label><input name="confirm" type="checkbox" required/> I confirm this exact package and its listed punch exceptions.</label></Form>}
 {p.acceptance ? <p className="notice">Client acceptance: {p.acceptance.statement}<br/>{p.acceptance.by.name} · {dateTime(p.acceptance.by.at)}</p> : !manager && p.completion && <Form submit="Record client acceptance with listed exceptions" action={async f => mutate(`/packages/${p.id}/accept`, { digest: p.digest, confirm: f.get('confirm') === 'on', exception_ids: f.getAll('exception'), statement: f.get('statement') })}><Field label="Client acceptance statement" name="statement"/>{p.exceptions.map(e => <label key={e.id}><input name="exception" value={e.id} type="checkbox" required/> I acknowledge the unresolved exception: {e.title}</label>)}<label><input name="confirm" type="checkbox" required/> I accept this exact handover package with the listed exceptions.</label></Form>}
 </article>
}
