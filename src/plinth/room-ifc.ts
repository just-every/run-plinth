import type { RoomGeometry } from './room-geometry'
type Ref={ref:number}
type Value=number|string|null|Ref|Value[]
type Entity={kind:string;args:Value[]}
const isRef=(v:Value|undefined):v is Ref=>!!v&&typeof v==='object'&&!Array.isArray(v)&&'ref' in v
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
const multiply=(a:number[],b:number[])=>Array.from({length:16},(_,i)=>[0,1,2,3].reduce((n,k)=>n+a[k*4+i%4]!*b[Math.floor(i/4)*4+k]!,0))
const transform=(p:number[],m:number[])=>[0,1,2].map(i=>m[i]!*p[0]!+m[4+i]!*p[1]!+m[8+i]!*p[2]!+m[12+i]!)
/** Bounded IFC STEP geometry. Refuse an unsupported body rather than showing an incomplete building as complete. */
export function ifcGeometry(bytes:Uint8Array):RoomGeometry {
 const vertices:number[][]=[],triangles:number[][]=[],unsupported:string[]=[]
 const fail=(message:string):never=>{throw Error(message)}
 try{
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
  if(!/^\s*ISO-10303-21;/i.test(source)||!source.includes('END-ISO-10303-21;'))fail('Expected a complete IFC STEP original')
  if(!/FILE_SCHEMA\s*\(\s*\(\s*'IFC(?:2X3|4(?:X\d[^']*)?)'/i.test(source))fail('Only IFC2X3 and IFC4 STEP schemas are supported')
  const data=/\bDATA\s*;([\s\S]*?)\bENDSEC\s*;/i.exec(source)?.[1];if(!data)fail('IFC data section is missing')
  const entities=new Map<number,Entity>()
  const tokens=data!.replace(/\/\*[\s\S]*?\*\//g,' ').match(/'(?:[^']|'')*'|#[1-9]\d*|[A-Za-z_][A-Za-z_0-9]*|\.[A-Z_0-9]+\.|[+-]?(?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?|[(),;=$*]|\S/gi)??[]
  let cursor=0
  const take=(want:string)=>{if(tokens[cursor++]!==want)fail('Invalid IFC STEP structure')}
  const value=(depth=0):Value=>{
   if(depth>32)fail('IFC nesting exceeds the supported bound')
   const t=tokens[cursor++];if(t===undefined)fail('Truncated IFC value')
   if(t==='('){const list:Value[]=[];if(tokens[cursor]!==')'){do{list.push(value(depth+1));if(tokens[cursor]!==',')break;cursor++}while(true)}take(')');return list}
   if(t==='$'||t==='*')return null
   if(t!.startsWith('#'))return {ref:Number(t!.slice(1))}
   if(t!.startsWith("'"))return t!.slice(1,-1).replace(/''/g,"'")
   if(/^\.[A-Z_0-9]+\.$/i.test(t!))return t!.toUpperCase()
   if(/^[A-Z_][A-Z_0-9]*$/i.test(t!)&&tokens[cursor]==='(')return value(depth+1)
   const n=Number(t);if(!Number.isFinite(n))fail('Unsupported IFC typed value');return n
  }
  while(cursor<tokens.length){const id=tokens[cursor++];if(!/^#[1-9]\d*$/.test(id!))fail('Invalid IFC entity');take('=');const kind=tokens[cursor++]!.toUpperCase(),args=value();take(';');if(!Array.isArray(args)||entities.has(Number(id!.slice(1))))fail('Invalid or duplicate IFC entity');entities.set(Number(id!.slice(1)),{kind,args:args as Value[]});if(entities.size>20000)fail('IFC exceeds 20000 entities')}
  const entity=(v:Value|undefined,kind?:string)=>{const e=isRef(v)?entities.get(v.ref):undefined;if(!e||kind&&e.kind!==kind)fail('Missing or unsupported IFC '+(kind??'reference'));return e!}
  const nums=(v:Value|undefined,count?:number)=>{if(!Array.isArray(v)||count!==undefined&&v.length!==count||v.some(n=>typeof n!=='number'||!Number.isFinite(n)))fail('Invalid IFC coordinates');return v as number[]}
  const unit=(v:number[])=>{const length=Math.hypot(...v);if(!length)fail('Invalid IFC direction');return v.map(n=>n/length)}
  const cross=(a:number[],b:number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!]
  const point=(v:Value|undefined)=>nums(entity(v,'IFCCARTESIANPOINT').args[0])
  const axis=(v:Value|undefined):number[]=>{
   if(!v)return identity
   const e=entity(v),p=point(e.args[0]);if(e.kind==='IFCAXIS2PLACEMENT2D'){const x=e.args[1]?unit(nums(entity(e.args[1],'IFCDIRECTION').args[0],2)):[1,0];return [x[0]!,x[1]!,0,0,-x[1]!,x[0]!,0,0,0,0,1,0,p[0]!,p[1]!,0,1]}
   if(e.kind!=='IFCAXIS2PLACEMENT3D'||p.length!==3)fail('Unsupported IFC axis placement')
   const z=e.args[1]?unit(nums(entity(e.args[1],'IFCDIRECTION').args[0],3)):[0,0,1],raw=e.args[2]?unit(nums(entity(e.args[2],'IFCDIRECTION').args[0],3)):[1,0,0],y=unit(cross(z,raw)),x=unit(cross(y,z))
   return [...x,0,...y,0,...z,0,...p,1]
  }
  const placement=(v:Value|undefined,path=new Set<number>()):number[]=>{if(!v)return identity;if(!isRef(v)||path.has(v.ref)||path.size>=64)fail('Cyclic or unsupported IFC placement');const e=entity(v,'IFCLOCALPLACEMENT');return multiply(placement(e.args[0],new Set([...path,(v as Ref).ref])),axis(e.args[1]))}
  const lengthUnits=[...entities.values()].filter(e=>e.kind==='IFCSIUNIT'&&e.args[1]==='.LENGTHUNIT.')
  if(lengthUnits.length!==1||lengthUnits[0]!.args[3]!=='.METRE.')fail('IFC needs one explicit SI length unit in metres')
  const factors:Record<string,number>={'.MILLI.':.001,'.CENTI.':.01,'.DECI.':.1,'.KILO.':1000},prefix=lengthUnits[0]!.args[2],scale=prefix===null?1:typeof prefix==='string'?factors[prefix]:undefined
  if(scale===undefined)fail('Unsupported IFC length unit prefix')
  const add=(p:number[],m:number[])=>{const v=transform(p,m).map(n=>n*scale!);if(v.some(n=>!Number.isFinite(n)||Math.abs(n)>1e9)||vertices.length>=12000)fail('IFC positions are invalid or exceed 12000 vertices');vertices.push([v[0]!,v[2]!,-v[1]!]);return vertices.length-1}
  const face=(ids:number[])=>{if(ids.length!==3||ids.some(i=>!Number.isInteger(i)||i<0||i>=vertices.length)||triangles.length>=12000)fail('IFC triangles are invalid or exceed 12000 faces');triangles.push(ids)}
  const render=(v:Value,m:number[])=>{
   const e=entity(v)
   if(e.kind==='IFCTRIANGULATEDFACESET'){
    const points=entity(e.args[0],'IFCCARTESIANPOINTLIST3D').args[0];if(!Array.isArray(points))fail('Missing IFC tessellated coordinates')
    const ids=(points as Value[]).map(p=>add(nums(p,3),m)),faces=e.args[3],pn=e.args[4]
    if(pn!==null&&pn!==undefined)fail('IFC tessellated point remapping is unsupported')
    if(!Array.isArray(faces))fail('Missing IFC tessellated faces');for(const row of faces as Value[]){const indexes=nums(row,3);if(indexes.some(i=>!Number.isInteger(i)||i<1||i>ids.length))fail('IFC face references a missing position');face(indexes.map(i=>ids[i-1]!))}
   }else if(e.kind==='IFCFACETEDBREP'){
    const shell=entity(e.args[0],'IFCCLOSEDSHELL');if(!Array.isArray(shell.args[0]))fail('Missing IFC shell faces')
    for(const ref of shell.args[0] as Value[]){const f=entity(ref,'IFCFACE'),bounds=f.args[0];if(!Array.isArray(bounds)||bounds.length!==1)fail('IFC face holes are unsupported');const bound=entity((bounds as Value[])[0]),loop=entity(bound.args[0],'IFCPOLYLOOP');if(!['IFCFACEOUTERBOUND','IFCFACEBOUND'].includes(bound.kind)||!Array.isArray(loop.args[0]))fail('Unsupported IFC face boundary');let ps=(loop.args[0] as Value[]).map(v=>nums(point(v),3));if(bound.args[1]==='.F.')ps=ps.reverse();if(ps.length<3||ps.length>64)fail('IFC planar faces need 3 to 64 points');const minus=(a:number[],b:number[])=>a.map((n,i)=>n-b[i]!),normal=unit(cross(minus(ps[1]!,ps[0]!),minus(ps[2]!,ps[0]!))),dot=(a:number[],b:number[])=>a.reduce((n,x,i)=>n+x*b[i]!,0);if(ps.some((p,i)=>Math.abs(dot(minus(p,ps[0]!),normal))>1e-6||dot(cross(minus(ps[(i+1)%ps.length]!,p),minus(ps[(i+2)%ps.length]!,ps[(i+1)%ps.length]!)),normal)<-1e-9))fail('Concave or non-planar IFC faces are unsupported');const ids=ps.map(p=>add(p,m));for(let i=1;i<ids.length-1;i++)face([ids[0]!,ids[i]!,ids[i+1]!])}
   }else if(e.kind==='IFCEXTRUDEDAREASOLID'){
    const profile=entity(e.args[0],'IFCRECTANGLEPROFILEDEF'),x=Number(profile.args[3]),y=Number(profile.args[4]),depth=e.args[3]
    if(profile.args[0]!=='.AREA.'||!(x>0&&y>0)||typeof depth!=='number'||depth<=0)fail('Invalid IFC rectangular extrusion')
    const direction=unit(nums(entity(e.args[2],'IFCDIRECTION').args[0],3)),local=multiply(m,axis(e.args[1])),pm=axis(profile.args[2]),base=[[-x/2,-y/2,0],[x/2,-y/2,0],[x/2,y/2,0],[-x/2,y/2,0]].map(p=>transform(p,pm)),ids=[...base,...base.map(p=>p.map((n,i)=>n+direction[i]!*Number(depth)))].map(p=>add(p,local))
    for(const t of [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]])face(t.map(i=>ids[i]!))
   }else fail('Unsupported IFC body: '+e.kind)
  }
  const world=(v:Value|undefined,depth=0):number[]=>{if(depth>8)fail('IFC context nesting exceeds its bound');const context=entity(v);if(context.kind==='IFCGEOMETRICREPRESENTATIONSUBCONTEXT')return world(context.args[6],depth+1);if(context.kind!=='IFCGEOMETRICREPRESENTATIONCONTEXT')fail('Unsupported IFC representation context');return axis(context.args[4])}
  let products=0
  for(const e of entities.values()){
   if(!isRef(e.args[6])||entities.get(e.args[6].ref)?.kind!=='IFCPRODUCTDEFINITIONSHAPE')continue
   const shape=entity(e.args[6]),representations=shape.args[2];if(!Array.isArray(representations))fail('Missing IFC product representations')
   for(const ref of representations as Value[]){const rep=entity(ref,'IFCSHAPEREPRESENTATION');if(rep.args[1]!=='Body'){unsupported.push('IFC '+String(rep.args[1])+' representation is not rendered');continue}const matrix=multiply(world(rep.args[0]),placement(e.args[5]));if(!Array.isArray(rep.args[3]))fail('Missing IFC body items');for(const item of rep.args[3] as Value[])render(item,matrix);products++}
  }
  if(!products||!triangles.length)fail('No supported IFC product body geometry')
  unsupported.push('IFC styles, materials, property sets and non-body representations are not rendered')
  return {vertices,triangles,unsupported:[...new Set(unsupported)]}
 }catch(error){return {vertices:[],triangles:[],unsupported,error:error instanceof Error?error.message:'Unsupported IFC original'}}
}
