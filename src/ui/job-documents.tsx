import { useEffect, useState } from 'react'
import type { DocumentLibrary, DocumentFolder, PrivateDocument } from '../plinth/job-documents'
import { api, dateTime, Field, Form } from './shared'

interface Source { version: number; library: DocumentLibrary; targets: {kind:string;id:string;label:string}[] }
async function upload(value: FormDataEntryValue | null) {
 if (!(value instanceof File) || !value.size) throw new Error('Choose an original file.')
 if (value.size > 2_097_152) throw new Error('Each original must be at most 2 MB.')
 const bytes = new Uint8Array(await value.arrayBuffer()); let raw = ''
 for (const byte of bytes) raw += String.fromCharCode(byte)
 return {name:value.name,base64:btoa(raw)}
}
export function JobDocuments({ jobId }: {jobId?:string}) {
 const path = jobId ? '/jobs/'+jobId+'/documents' : '/documents'
 const [source,setSource] = useState<Source>(), [error,setError] = useState(''), [area,setArea] = useState('Documents'), [folder,setFolder] = useState(''), [query,setQuery] = useState(''), [tag,setTag] = useState('')
 async function refresh() { setSource(await api(path)); setError('') }
 useEffect(() => { setSource(undefined); refresh().catch(e=>setError(e.message)) }, [path])
 async function mutate(tail:string, body:Record<string,unknown>) { try {return await api(path+tail,{expected_version:source?.version,...body})} finally {await refresh()} }
 if (!source) return <p role={error?'alert':'status'}>{error || 'Opening private documents…'}</p>
 const library=source.library, folders=library.folders.filter(f=>f.area===area)
 const folderName=(id:string):string=>{const f=library.folders.find(f=>f.id===id);return f?(f.parent_id?folderName(f.parent_id)+' › ':'')+f.name:''}
 const shown=library.files.filter(f=>(!folder?folders.some(d=>d.id===f.folder_id):f.folder_id===folder)&&(!query.trim()||[f.name,...f.versions.map(v=>v.file.name)].some(n=>n.toLowerCase().includes(query.trim().toLowerCase())))&&(!tag.trim()||f.tags.some(t=>t.toLowerCase()===tag.trim().toLowerCase())))
 return <section className="card document-library" aria-label={jobId?'Private job documents':'Private company documents'}>
  <h2>{jobId?'Job documents':'Company documents'}</h2><p>Private to the owner. A record link keeps the exact version private; it does not publish or share the file.</p>
  <div className="fields"><label>Area<select value={area} onChange={e=>{setArea(e.target.value);setFolder('')}}>{['Documents','Photos','Videos'].map(a=><option key={a}>{a}</option>)}</select></label><label>Folder<select value={folder} onChange={e=>setFolder(e.target.value)}><option value="">All {area.toLowerCase()} folders</option>{folders.map(f=><option key={f.id} value={f.id}>{folderName(f.id)}</option>)}</select></label><Field label="Search file names" name="search" required={false} type="search" value={query} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setQuery(e.target.value)}/><Field label="Search tag" name="tag-search" required={false} type="search" value={tag} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setTag(e.target.value)}/></div>
  <details><summary>Create a folder</summary><Form submit="Create folder" action={async f=>{const result=await mutate('/folders',{name:f.get('name'),area,parent_id:f.get('parent_id')||undefined});setFolder(result.record.id)}}><Field label="Folder name" name="name"/><label>Parent folder<select name="parent_id" key={area}><option value="">Top level in {area}</option>{folders.map(f=><option key={f.id} value={f.id}>{folderName(f.id)}</option>)}</select></label></Form></details>
  {!!folders.length&&<details><summary>Upload a file</summary><Form submit="Keep original file" action={async f=>{await mutate('/files',{folder_id:f.get('folder_id'),name:f.get('name'),tags:String(f.get('tags')??'').split(',').map(t=>t.trim()).filter(Boolean),file:await upload(f.get('file'))})}}><label>Upload folder<select name="folder_id" key={folder} defaultValue={folder||folders[0]?.id}>{folders.map(f=><option key={f.id} value={f.id}>{folderName(f.id)}</option>)}</select></label><Field label="Document name" name="name"/><Field label="Tags, separated by commas" name="tags" required={false}/><Field label="Original file" name="file" type="file"/><p>Keep originals up to 2 MB. Photos accept PNG and JPEG; Videos accept MP4 and WebM.</p></Form></details>}
  <p role="status">{shown.length} matching {shown.length===1?'file':'files'}</p>
  {shown.map(file=><Document key={file.id} file={file} folder={folderName(file.folder_id)} source={source} path={path} mutate={mutate}/>)}
 </section>
}
function Document({file,folder,source,path,mutate}:{file:PrivateDocument;folder:string;source:Source;path:string;mutate:(tail:string,body:Record<string,unknown>)=>Promise<any>}) {
 return <article className="record" aria-label={file.name}><h3>{file.name}</h3><p>{folder} · Private · {file.tags.join(', ')||'No tags'}</p>
  <ul className="rows">{file.versions.map(v=><li className="row" key={v.id}><div className="row-main"><a href={'/api/plinth'+path+'/files/'+file.id+'/'+v.id}>{v.file.name} · version {v.revision}</a><p>{v.by.name} · {dateTime(v.by.at)} · {v.file.size} bytes</p><p className="document-checksum">SHA-256 {v.file.checksum}</p></div></li>)}</ul>
  <details><summary>Add an immutable version</summary><Form submit="Keep new version" action={async f=>mutate('/files/'+file.id+'/versions',{file:await upload(f.get('file'))})}><Field label="New original file" name="file" type="file"/></Form></details>
  {!!source.targets.length&&<details><summary>Link a private version to a record</summary><Form submit="Link private version" action={async f=>{const [kind,record_id]=String(f.get('target')).split(':');return mutate('/links',{document_id:file.id,version_id:f.get('version'),kind,record_id})}}><label>Exact file version<select name="version" defaultValue={file.versions.at(-1)?.id}>{file.versions.map(v=><option key={v.id} value={v.id}>Version {v.revision}</option>)}</select></label><label>Existing job record<select name="target">{source.targets.map(t=><option key={t.kind+':'+t.id} value={t.kind+':'+t.id}>{t.kind} · {t.label}</option>)}</select></label></Form></details>}
  {source.library.links.filter(l=>l.document_id===file.id).map(l=><p key={l.id}>Private version {file.versions.find(v=>v.id===l.version_id)?.revision} linked to {l.kind} · {source.targets.find(t=>t.kind===l.kind&&t.id===l.record_id)?.label??'Historical record'}; external access is unchanged.</p>)}
 </article>
}
