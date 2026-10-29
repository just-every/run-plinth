import { ifcGeometry } from './room-ifc'
/** Bounded static geometry only. Originals remain downloadable when a feature is unsupported. */
export interface RoomGeometry { vertices:number[][]; triangles:number[][]; unsupported:string[]; error?:string }
const ceiling=12000
export function roomGeometry(bytes:Uint8Array,format:'glb'|'obj'|'ifc'):RoomGeometry {
 if(format==='ifc')return ifcGeometry(bytes)
 const unsupported=new Set<string>(),vertices:number[][]=[],triangles:number[][]=[]
 const fail=(message:string):never=>{throw Error(message)}
 const vertex=(v:number[])=>{if(v.length!==3||v.some(n=>!Number.isFinite(n)||Math.abs(n)>1e9))fail('Invalid or unbounded position');if(vertices.length>=ceiling)fail('Geometry exceeds 12000 vertices');vertices.push(v)}
 const triangle=(v:number[])=>{if(triangles.length>=ceiling)fail('Geometry exceeds 12000 triangles');triangles.push(v)}
 try{
  if(format==='obj'){
   const lines=new TextDecoder('utf-8',{fatal:true}).decode(bytes).split(/\r?\n/)
   for(const raw of lines){const line=raw.trim();if(!line||line.startsWith('#'))continue;const [kind,...parts]=line.split(/\s+/)
    if(kind==='v'){if(parts.length!==3)fail('Only XYZ OBJ vertices are supported');vertex(parts.map(Number))}
    else if(kind==='f'){if(parts.length<3||parts.length>64)fail('OBJ faces need 3 to 64 vertices');const ids=parts.map(p=>{const token=p.split('/')[0]!;if(!/^-?[1-9]\d*$/.test(token))fail('Invalid OBJ face index');const n=Number(token);return n<0?vertices.length+n:n-1});if(ids.some(n=>!Number.isInteger(n)||n<0||n>=vertices.length))fail('OBJ face references a missing vertex');for(let i=1;i<ids.length-1;i++)triangle([ids[0]!,ids[i]!,ids[i+1]!])}
    else if(!['o','g','s'].includes(kind!))unsupported.add(kind==='mtllib'||kind==='usemtl'?'OBJ materials and external textures are not rendered':kind==='vn'||kind==='vt'?'OBJ supplied normals and texture coordinates are not rendered':'OBJ feature '+kind+' is not rendered')
   }
  }else{
   const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
   if(bytes.length<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.length)fail('Expected a complete GLB version 2 original')
   let doc:any,bin:Uint8Array|undefined,offset=12
   while(offset<bytes.length){if(offset+8>bytes.length)fail('Truncated GLB chunk');const length=view.getUint32(offset,true),kind=view.getUint32(offset+4,true);offset+=8;if(length%4||offset+length>bytes.length)fail('Invalid GLB chunk bounds');if(kind===0x4e4f534a){if(doc)fail('Multiple GLB JSON chunks');doc=JSON.parse(new TextDecoder().decode(bytes.slice(offset,offset+length)))}else if(kind===0x004e4942){if(bin)fail('Multiple GLB binary chunks');bin=bytes.slice(offset,offset+length)}else unsupported.add('Unknown GLB chunks are not rendered');offset+=length}
   if(!doc||!bin||doc.asset?.version!=='2.0')fail('GLB needs version 2 JSON and embedded geometry')
   if(doc.extensionsRequired?.length)fail('Required GLB extensions are unsupported: '+doc.extensionsRequired.join(', '))
   if(doc.buffers?.length!==1||doc.buffers[0].uri||doc.buffers[0].byteLength>bin!.length)fail('External or multiple GLB buffers are unsupported')
   if(doc.animations?.length)unsupported.add('GLB animations are not played; static geometry only')
   if(doc.skins?.length)fail('Skinned GLB geometry is unsupported')
   if(doc.materials?.length||doc.textures?.length)unsupported.add('GLB materials and textures are not rendered')
   if(doc.cameras?.length)unsupported.add('GLB cameras are not used')
   const read=(id:number,position:boolean):number[][]=>{
    const a=doc.accessors?.[id],b=doc.bufferViews?.[a?.bufferView]
    if(!a||!b||b.buffer!==0||a.sparse||a.normalized)fail('Unsupported GLB accessor or buffer view')
    const count=a.count,width=position?3:1,types:any={5121:1,5123:2,5125:4,5126:4},size=types[a.componentType]
    if(a.type!==(position?'VEC3':'SCALAR')||position&&a.componentType!==5126||!position&&![5121,5123,5125].includes(a.componentType)||!size||!Number.isInteger(count)||count<1||count>ceiling*3)fail('Unsupported or oversized GLB accessor')
    const start=(b.byteOffset??0)+(a.byteOffset??0),stride=b.byteStride??width*size,end=start+(count-1)*stride+width*size
    if(![start,stride,end,b.byteLength].every(Number.isSafeInteger)||start<0||stride<width*size||end>(b.byteOffset??0)+b.byteLength||end>doc.buffers[0].byteLength||end>bin!.length)fail('GLB accessor exceeds its buffer')
    const data=new DataView(bin!.buffer,bin!.byteOffset,bin!.byteLength)
    return Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>{const at=start+i*stride+j*size;return a.componentType===5126?data.getFloat32(at,true):size===1?data.getUint8(at):size===2?data.getUint16(at,true):data.getUint32(at,true)}))
   }
   const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
   const multiply=(a:number[],b:number[])=>Array.from({length:16},(_,i)=>{const r=i%4,c=Math.floor(i/4);return [0,1,2,3].reduce((s,k)=>s+a[k*4+r]!*b[c*4+k]!,0)})
   const local=(node:any)=>{
    if(node.matrix){if(node.matrix.length!==16||node.matrix.some((n:any)=>!Number.isFinite(n)))fail('Invalid GLB node matrix');return node.matrix as number[]}
    const t=node.translation??[0,0,0],s=node.scale??[1,1,1],q=node.rotation??[0,0,0,1]
    if(t.length!==3||s.length!==3||q.length!==4||[...t,...s,...q].some(n=>!Number.isFinite(n)))fail('Invalid GLB node transform')
    const [x,y,z,w]=q as [number,number,number,number]
    return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,(2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,(2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1]
   }
   let visited=0
   const mesh=(id:number,matrix:number[])=>{const m=doc.meshes?.[id];if(!m)fail('Missing GLB mesh');if(m.weights)fail('GLB morph targets are unsupported');for(const p of m.primitives??[]){if(p.mode!==undefined&&p.mode!==4)fail('Only triangle GLB primitives are supported');if(p.targets)fail('GLB morph targets are unsupported');if(p.attributes?.POSITION===undefined)fail('GLB primitive has no positions');const ps=read(p.attributes.POSITION,true),base=vertices.length;for(const v of ps)vertex([0,1,2].map(i=>matrix[i]!*v[0]!+matrix[4+i]!*v[1]!+matrix[8+i]!*v[2]!+matrix[12+i]!));const ids=p.indices===undefined?ps.map((_,i)=>i):read(p.indices,false).map(v=>v[0]!);if(ids.length%3||ids.some(n=>n<0||n>=ps.length))fail('Invalid GLB triangle indices');for(let i=0;i<ids.length;i+=3)triangle(ids.slice(i,i+3).map(n=>n+base))}}
   const walk=(id:number,parent:number[],path:Set<number>)=>{if(++visited>256||path.has(id))fail('GLB node graph is cyclic or exceeds 256 nodes');const n=doc.nodes?.[id];if(!n)fail('Missing GLB node');const matrix=multiply(parent,local(n));if(n.mesh!==undefined)mesh(n.mesh,matrix);for(const child of n.children??[])walk(child,matrix,new Set([...path,id]))}
   const scene=doc.scenes?.[doc.scene??0];if(!scene)fail('GLB needs a static scene');for(const id of scene.nodes??[])walk(id,identity,new Set())
  }
  if(!vertices.length||!triangles.length)fail('No supported triangle geometry')
  return {vertices,triangles,unsupported:[...unsupported]}
 }catch(error){return {vertices:[],triangles:[],unsupported:[...unsupported],error:error instanceof Error?error.message:'Unsupported model original'}}
}
