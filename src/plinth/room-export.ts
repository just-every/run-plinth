import JSZip from 'jszip'
import { requireOwner } from './auth'
import { find, type Actor, type Job } from './model'
import { roomBoardFile } from './room-boards'
import { roomGeometry, type RoomGeometry } from './room-geometry'
const encode=(value:string)=>new TextEncoder().encode(value)
export function geometryObj(g:RoomGeometry){return encode('# Plinth static geometry\n'+g.vertices.map(v=>'v '+v.join(' ')).join('\n')+'\n'+g.triangles.map(t=>'f '+t.map(i=>i+1).join(' ')).join('\n')+'\n')}
export function geometryGlb(g:RoomGeometry){
 const binary=new Uint8Array(g.vertices.length*12+g.triangles.length*12),view=new DataView(binary.buffer)
 g.vertices.flat().forEach((n,i)=>view.setFloat32(i*4,n,true));g.triangles.flat().forEach((n,i)=>view.setUint32(g.vertices.length*12+i*4,n,true))
 const doc={asset:{version:'2.0',generator:'Plinth static geometry export'},buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:g.vertices.length*12},{buffer:0,byteOffset:g.vertices.length*12,byteLength:g.triangles.length*12}],accessors:[{bufferView:0,componentType:5126,count:g.vertices.length,type:'VEC3',min:[0,1,2].map(i=>Math.min(...g.vertices.map(v=>v[i]!))),max:[0,1,2].map(i=>Math.max(...g.vertices.map(v=>v[i]!)))},{bufferView:1,componentType:5125,count:g.triangles.length*3,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0}
 const json=encode(JSON.stringify(doc)),length=json.length+(4-json.length%4)%4,bytes=new Uint8Array(28+length+binary.length),header=new DataView(bytes.buffer)
 header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,bytes.length,true);header.setUint32(12,length,true);header.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+length);bytes.set(json,20);header.setUint32(20+length,binary.length,true);header.setUint32(24+length,0x004e4942,true);bytes.set(binary,28+length);return bytes
}
export function geometryIfc(g:RoomGeometry,sourceId:string,at:string){
 const real=(n:number)=>{const s=String(n);return /[.eE]/.test(s)?s:s+'.'}
 // IFC uses a right-handed Z-up coordinate system; GLB and the viewer use Y-up.
 const suffix=sourceId.replace(/-/g,'').slice(0,21),projectGuid='0'+suffix,modelGuid='1'+suffix
 const positions=g.vertices.map(v=>`(${[v[0]!, -v[2]!, v[1]!].map(real).join(',')})`).join(',')
 return encode(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Plinth static triangle exchange; originals are separate'),'2;1');
FILE_NAME('room.ifc','${at}',(),(),'Plinth','Plinth','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#2,$);
#4=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#5=IFCUNITASSIGNMENT((#4));
#6=IFCPROJECT('${projectGuid}',$,'Room geometry',$,$,$,$,(#3),#5);
#7=IFCCARTESIANPOINTLIST3D((${positions}));
#8=IFCTRIANGULATEDFACESET(#7,$,.F.,(${g.triangles.map(t=>'('+t.map(i=>i+1).join(',')+')').join(',')}),$);
#9=IFCSHAPEREPRESENTATION(#3,'Body','Tessellation',(#8));
#10=IFCPRODUCTDEFINITIONSHAPE($,$,(#9));
#11=IFCLOCALPLACEMENT($,#2);
#12=IFCBUILDINGELEMENTPROXY('${modelGuid}',$,'Room geometry',$,$,#11,#10,$,.NOTDEFINED.);
ENDSEC;
END-ISO-10303-21;
`)
}
/** A download is an owner export, never an external grant, approval or provider write. */
export async function roomBoardExport(db:D1Database,job:Job,actor:Actor,boardId:string,revisionId:string){
 requireOwner(actor)
 const board=find(job.room_boards??[],boardId),revision=find(board.revisions,revisionId),zip=new JSZip(),models=[]
 for(const file of revision.files){
  const response=await roomBoardFile(db,job,actor,file.id),bytes=new Uint8Array(await response.arrayBuffer())
  zip.file(`originals/${file.id}.${file.format}`,bytes)
  if(!['glb','obj','ifc'].includes(file.format))continue
  const geometry=roomGeometry(bytes,file.format as 'glb'|'obj'|'ifc'),paths:string[]=[]
  if(!geometry.error){
   const path=`geometry/${file.id}.obj`;zip.file(path,geometryObj(geometry));paths.push(path)
   // OBJ has no inherent unit. Do not invent metres for an uncalibrated OBJ original.
   if(file.format!=='obj'){for(const [ext,data] of [['glb',geometryGlb(geometry)],['ifc',geometryIfc(geometry,file.id,revision.by.at)]] as const){const path=`geometry/${file.id}.${ext}`;zip.file(path,data);paths.push(path)}}
  }
  models.push({original_id:file.id,unit:file.format==='obj'?'Unspecified; use original design-tool units':'m',exports:paths,unsupported:geometry.unsupported,error:geometry.error??null})
 }
 zip.file('board.json',JSON.stringify({format:'plinth-room-handoff-1',job_id:job.id,board_id:board.id,revision,models,originals:revision.files.map(f=>({id:f.id,name:f.name,path:`originals/${f.id}.${f.format}`,checksum:f.checksum,size:f.size})),boundary:'Private owner export. External tool authorization, sharing and downstream acceptance are separate. Original signed specifications are unchanged.'},null,2))
 const data=await zip.generateAsync({type:'uint8array',compression:'STORE'})
 return new Response(new Uint8Array(data),{headers:{'content-type':'application/zip','content-disposition':`attachment; filename="room-${board.id}-revision-${revision.revision}.zip"`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
}
