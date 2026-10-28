import { useEffect, useMemo, useState } from 'react'
import type { RoomGeometry } from '../plinth/room-geometry'
/** Camera changes only the view; source coordinates and original bytes stay untouched. */
export function RoomModelViewer({url,name}:{url:string;name:string}){
 const [geometry,setGeometry]=useState<RoomGeometry>(),[error,setError]=useState(''),[yaw,setYaw]=useState(30),[pitch,setPitch]=useState(20),[zoom,setZoom]=useState(1)
 useEffect(()=>{const controller=new AbortController();setGeometry(undefined);setError('');fetch(url,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Could not retrieve model geometry');setGeometry(await r.json())}).catch(e=>{if(e.name!=='AbortError')setError(e.message)});return()=>controller.abort()},[url])
 const polygons=useMemo(()=>{
  if(!geometry?.vertices.length)return []
  const min=[0,1,2].map(i=>Math.min(...geometry.vertices.map(v=>v[i]!))),max=[0,1,2].map(i=>Math.max(...geometry.vertices.map(v=>v[i]!))),center=min.map((v,i)=>(v+max[i]!)/2),size=Math.max(...max.map((v,i)=>v-min[i]!))||1,a=yaw*Math.PI/180,b=pitch*Math.PI/180
  const ps=geometry.vertices.map(v=>{const [x,y,z]=v.map((n,i)=>(n-center[i]!)/size);const tx=x!*Math.cos(a)+z!*Math.sin(a),tz=-x!*Math.sin(a)+z!*Math.cos(a);return [300+tx*350*zoom,200-(y!*Math.cos(b)-tz*Math.sin(b))*350*zoom,y!*Math.sin(b)+tz*Math.cos(b)]})
  return geometry.triangles.map(t=>({points:t.map(i=>ps[i]!.slice(0,2).join(',')).join(' '),depth:t.reduce((sum,i)=>sum+ps[i]![2]!,0)/3})).sort((a,b)=>a.depth-b.depth)
 },[geometry,yaw,pitch,zoom])
 return <section aria-label={'Model viewer '+name}>
  {error||geometry?.error?<p role="alert">{error||geometry?.error}. Original retained; this model cannot be rendered.</p>:!geometry?<p role="status">Loading model geometry…</p>:<>
   <p role="status">{geometry.vertices.length} vertices · {geometry.triangles.length} triangles · Static geometry</p>
   <svg className="room-model" viewBox="0 0 600 400" role="img" aria-label={'Geometry of '+name}><title>{name} static model</title>{polygons.map((p,i)=><polygon key={i} points={p.points} fill="#b3cec5" stroke="#285c50" strokeWidth="1"/>)}</svg>
   <div className="room-camera"><label>Rotate model<input type="range" min="-180" max="180" value={yaw} onChange={e=>setYaw(Number(e.target.value))}/></label><label>Tilt model<input type="range" min="-90" max="90" value={pitch} onChange={e=>setPitch(Number(e.target.value))}/></label><label>Zoom model<input type="range" min="0.5" max="2" step="0.1" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label></div>
  </>}
  <p>Supported: static triangles, embedded GLB positions and node transforms, OBJ polygon triangulation. No external resources are fetched.</p>
  {geometry?.unsupported.map(value=><p className="notice" key={value}>{value}</p>)}
 </section>
}
