import type { Attachment, Stamp } from './model'
import type { ProductSource } from './product-model'
import { need, object, text, type Input } from './model'
import { validateShape } from './takeoff-geometry'

export interface LayoutPoint { x:number; y:number }
export interface LayoutOpening { id:string; kind:'door'|'window'; wall:number; offset:number; width:number; height:number }
export interface LayoutPlacement { id:string; name:string; x:number; y:number; width:number; depth:number; rotation:0|90; product_source:ProductSource; selection?:{id:string;revision_id:string;option_id:string;proposed_price_cents:number} }
export interface LayoutGeometry { points:LayoutPoint[]; openings:LayoutOpening[]; placements:LayoutPlacement[] }
export interface LayoutRevision extends LayoutGeometry { id:string; revision:number; reason:string; by:Stamp; reconstructed:boolean }
export interface RoomLayout { id:string; name:string; underlays:{document:Attachment;by:Stamp}[]; revisions:LayoutRevision[]; adoptions:{revision_id:string;digest:string;sheet_id:string;selection_ids:string[];by:Stamp}[] }
export const rounded=(n:number)=>Math.round(n*1e6)/1e6
export function metres(value:unknown,label:string,zero=false):number {
 need(typeof value==='number'&&Number.isFinite(value)&&value>=(zero?0:0.001)&&value<=1000,`${label} must be ${zero?'zero or more':'positive'} metres, at most 1000`)
 need(Math.abs(value*1000-Math.round(value*1000))<1e-6,`${label} supports millimetre precision`)
 return value
}
export function layoutMeasures(g:LayoutGeometry){
 const walls=g.points.map((p,i)=>{const q=g.points[(i+1)%g.points.length]!;const length=rounded(Math.hypot(q.x-p.x,q.y-p.y));return {wall:i,length_m:length,net_run_m:rounded(length-g.openings.filter(o=>o.wall===i).reduce((n,o)=>n+o.width,0))}})
 return {walls,perimeter_m:rounded(walls.reduce((n,w)=>n+w.length_m,0)),area_m2:rounded(Math.abs(g.points.reduce((n,p,i)=>{const q=g.points[(i+1)%g.points.length]!;return n+p.x*q.y-q.x*p.y},0))/2)}
}
export function layoutPoints(input:Input):LayoutPoint[]{
 need(input.unit==='m','Editable geometry uses metres; convert source dimensions explicitly')
 need(Array.isArray(input.points)&&input.points.length>=3&&input.points.length<=40,'Enter three to 40 ordered wall corners')
 const points=input.points.map(raw=>{const p=object(raw);return {x:metres(p.x,'Corner X',true),y:metres(p.y,'Corner Y',true)}})
 validateShape({kind:'area',points} as import('./takeoff-model').TakeoffMeasurement)
 need(layoutMeasures({points,openings:[],placements:[]}).area_m2>=0.001,'The room needs a measurable closed floor area')
 return points
}
export function layoutOpenings(value:unknown,points:LayoutPoint[]):LayoutOpening[]{
 need(Array.isArray(value)&&value.length<=80,'Provide at most 80 wall openings')
 const lengths=layoutMeasures({points,openings:[],placements:[]}).walls
 const result=value.map(raw=>{const o=object(raw);need(o.kind==='door'||o.kind==='window','Choose door or window');need(Number.isInteger(o.wall)&&Number(o.wall)>=0&&Number(o.wall)<points.length,'Choose an existing wall');const row:LayoutOpening={id:text(o.id,'Opening label',80),kind:o.kind,wall:Number(o.wall),offset:metres(o.offset,'Opening offset',true),width:metres(o.width,'Opening width'),height:metres(o.height,'Opening height')};need(row.offset+row.width<=lengths[row.wall]!.length_m+1e-6,'The opening must fit its wall');return row})
 need(new Set(result.map(o=>o.id)).size===result.length,'Opening labels must be unique')
 for(const w of lengths)need(result.filter(o=>o.wall===w.wall).reduce((n,o)=>n+o.width,0)<w.length_m,'Openings must leave a positive measured wall run')
 for(const [i,a] of result.entries())for(const b of result.slice(i+1))need(a.wall!==b.wall||a.offset+a.width<=b.offset||b.offset+b.width<=a.offset,'Wall openings cannot overlap')
 return result
}
export function insideRoom(p:LayoutPoint,ps:LayoutPoint[]){let inside=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i]!,b=ps[j]!,cross=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);if(Math.abs(cross)<1e-8&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y))return true;if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside}return inside}
export function placementCorners(p:Pick<LayoutPlacement,'x'|'y'|'width'|'depth'|'rotation'>){const w=p.rotation===90?p.depth:p.width,d=p.rotation===90?p.width:p.depth;return [{x:p.x,y:p.y},{x:p.x+w,y:p.y},{x:p.x+w,y:p.y+d},{x:p.x,y:p.y+d}]}
