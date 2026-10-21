import { Field, Form } from './shared'
import { handoverKinds, type HandoverDocument } from '../plinth/handover-model'

export type HandoverMutate = (path: string, input: Record<string, unknown>) => Promise<unknown>
async function original(form: FormData) {
 const file = form.get('file'); if (!(file instanceof File) || !file.size) throw new Error('Choose an original PDF, PNG or JPEG.')
 if (file.size > 2 * 1024 * 1024) throw new Error('Each original must be 2 MB or smaller.')
 const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = reject; reader.readAsDataURL(file) })
 return { name: file.name, mime: file.type, base64 }
}
const sourceFields = <><Field label="Exact document revision reference" name="reference"/><Field label="Original document (PDF, PNG or JPEG)" name="file" type="file" accept="application/pdf,image/png,image/jpeg"/></>
export function HandoverDocuments({ documents, prefix, mutate }: { documents: HandoverDocument[]; prefix: string; mutate: HandoverMutate }) {
 return <section className="card"><h2>Handover document library</h2><p>These originals stay in the office until a builder reviews and releases an exact package.</p>
 <details><summary>Add a handover document</summary><Form submit="Add original document" action={async f => mutate('/documents', { title: f.get('title'), kind: f.get('kind'), tags: String(f.get('tags')).split(',').map(s => s.trim()).filter(Boolean), reference: f.get('reference'), file: await original(f) })}><Field label="Document title" name="title"/><label>Category<select name="kind">{handoverKinds.map(k => <option key={k}>{k}</option>)}</select></label><Field label="Document tags (comma separated)" name="tags" required={false}/>{sourceFields}</Form></details>
 {!documents.length && <p className="empty">No handover documents yet.</p>}
 {documents.map(d => <article className="record" key={d.id}><h3>{d.title}</h3><p>{d.kind} · {d.tags.join(', ')}</p>{d.revisions.map(r => <p key={r.id}><a href={prefix + r.file.id}>{r.file.name} · revision {r.revision}</a><br/>{r.reference}</p>)}<details><summary>Add a revision of {d.title}</summary><Form submit="Keep new original revision" action={async f => mutate('/documents/' + d.id, { reference: f.get('reference'), file: await original(f) })}>{sourceFields}</Form></details></article>)}
 </section>
}
