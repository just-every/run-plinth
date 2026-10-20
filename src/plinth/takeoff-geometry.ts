import { decimal } from './estimate-math'
import { find, need, object, type Input } from './model'
import type { Calibration, DrawingRevision, MeasuredQuantity, Point, TakeoffMeasurement, TakeoffSheet } from './takeoff-model'

export function points(value:unknown,drawing:DrawingRevision,min:number,max=500):Point[]{
 need(Array.isArray(value)&&value.length>=min&&value.length<=max,`Provide ${min} to ${max} drawing points`)
 return value.map(raw=>{const p=object(raw);need(typeof p.x==='number'&&Number.isFinite(p.x)&&p.x>=0&&p.x<=drawing.width&&typeof p.y==='number'&&Number.isFinite(p.y)&&p.y>=0&&p.y<=drawing.height,'Point must be inside the source page');return {x:Math.round(p.x*1000)/1000,y:Math.round(p.y*1000)/1000}})
}
const length=(ps:Point[])=>ps.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-ps[i]!.x,p.y-ps[i]!.y),0)
function area(ps:Point[]){return Math.abs(ps.reduce((n,p,i)=>{const q=ps[(i+1)%ps.length]!;return n+p.x*q.y-q.x*p.y},0))/2}
/** Geometry is measured in scale-1 PDF points. Retained coordinates resolve to 0.001 PDF point. */
function quantity(m:TakeoffMeasurement,c?:Calibration):number {
 if(m.kind==='count')return m.points.length
 need(c,'Length and area measurements require their exact calibration')
 const ref=length(c.points);need(ref>0,'Calibration endpoints must differ')
 const ratio=Number(c.length)/ref;const value=m.kind==='area'?area(m.points)*ratio*ratio:length(m.points)*ratio
 need(Number.isFinite(value)&&value>0&&value<=1e9,'Measured quantity must be positive and within supported bounds')
 return value
}
const micro=(n:number)=>BigInt(Math.floor(n*1_000_000+0.5))
const format=(n:bigint)=>`${n/1_000_000n}.${String(n%1_000_000n).padStart(6,'0')}`
export function measured(sheet:TakeoffSheet,m:TakeoffMeasurement):MeasuredQuantity {
 const drawing=find(sheet.revisions,m.revision_id);need(drawing===sheet.revisions.at(-1),'A revised drawing needs recalibration and new reviewed measurements; old annotations remain history',409,'takeoff_review_required')
 const calibration=m.calibration_id?find(sheet.calibrations,m.calibration_id):undefined
 const deductions=sheet.measurements.filter(d=>d.deduct_from===m.id&&d.revision_id===drawing.id)
 const gross=micro(quantity(m,calibration)),deducted=deductions.reduce((n,d)=>{need(d.kind===m.kind&&d.dimension===m.dimension&&d.calibration_id===m.calibration_id,'Opening deductions must use the parent dimension, kind and calibration');return n+micro(quantity(d,calibration))},0n)
 need(deducted<gross,'Openings must leave a positive net measured quantity',409,'takeoff_deduction')
 return {id:m.id,sheet_id:sheet.id,sheet_name:sheet.name,name:m.name,kind:m.kind,dimension:m.dimension,gross_quantity:format(gross),net_quantity:format(gross-deducted),unit:m.kind==='count'?'each':m.kind==='area'?'sq '+calibration!.unit:calibration!.unit,measurement:structuredClone(m),...(calibration?{calibration:structuredClone(calibration)}:{}),drawing:structuredClone(drawing),deductions:structuredClone(deductions)}
}
export function combined(sheets:TakeoffSheet[],input:Input){
 need(Array.isArray(input.measurement_ids)&&input.measurement_ids.length>0&&input.measurement_ids.length<=200,'Select one to 200 measured quantities')
 const ids=input.measurement_ids.map(id=>String(id));need(new Set(ids).size===ids.length,'Select each measurement once')
 const measurements=ids.map(id=>{const sheet=sheets.find(s=>s.measurements.some(m=>m.id===id));need(sheet,'Measurement not found',404,'not_found');const m=find(sheet.measurements,id);need(!m.deduct_from,'Opening deductions are included by their parent, never added as positive quantities');return measured(sheet,m)})
 const totals=new Map<string,{unit:string;value:bigint}>()
 for(const m of measurements){const prior=totals.get(m.dimension);need(!prior||prior.unit===m.unit,'Combined template dimensions must have matching units');const q=decimal(m.net_quantity,'Net measured quantity');totals.set(m.dimension,{unit:m.unit,value:(prior?.value??0n)+q.numerator*1_000_000n/q.denominator})}
 return {measurements,dimensions:Object.fromEntries([...totals].map(([key,total])=>[key,format(total.value)])),units:Object.fromEntries([...totals].map(([key,total])=>[key,total.unit])),precision:'Coordinates: 0.001 PDF point. Euclidean lengths and shoelace areas scaled by the retained calibration, each gross/opening rounded half up to 0.000001 source unit before subtraction and dimension sums; pricing retains its existing exact-decimal half-up cent boundary.'}
}
const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
const on=(p:Point,a:Point,b:Point)=>Math.abs(cross(a,b,p))<1e-7&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y)
function intersects(a:Point,b:Point,c:Point,d:Point){const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);return abC*abD<0&&cdA*cdB<0||on(c,a,b)||on(d,a,b)||on(a,c,d)||on(b,c,d)}
function inside(p:Point,polygon:Point[]){let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i]!,b=polygon[j]!;if(on(p,a,b))return true;if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)result=!result}return result}
export function validateShape(row:TakeoffMeasurement){
 if(row.kind!=='area')return
 const ps=row.points
 for(let i=0;i<ps.length;i++){const a=ps[i]!,b=ps[(i+1)%ps.length]!;need(a.x!==b.x||a.y!==b.y,'Polygon edges must have different endpoints')
  for(let j=i+1;j<ps.length;j++){if(j===i+1||i===0&&j===ps.length-1)continue;need(!intersects(a,b,ps[j]!,ps[(j+1)%ps.length]!),'Floor and opening polygons cannot intersect themselves')}
 }
}
export function validateOpening(parent:TakeoffMeasurement,opening:TakeoffMeasurement,others:TakeoffMeasurement[]){
 if(parent.kind==='area'){
  need(opening.points.every(p=>inside(p,parent.points)),'Every opening point must lie inside its parent area')
  need(!opening.points.some((p,i)=>parent.points.some((q,j)=>{const b=opening.points[(i+1)%opening.points.length]!,d=parent.points[(j+1)%parent.points.length]!;return cross(p,b,q)*cross(p,b,d)<0&&cross(q,d,p)*cross(q,d,b)<0})), 'Opening edges cannot cross the parent boundary')
  // Midpoints also prevent a concave parent boundary from cutting across an opening edge.
  need(opening.points.every((p,i)=>{const q=opening.points[(i+1)%opening.points.length]!;return inside({x:(p.x+q.x)/2,y:(p.y+q.y)/2},parent.points)}),'Opening edges must remain inside the parent area')
  for(const other of others){need(!opening.points.some(p=>inside(p,other.points))&&!other.points.some(p=>inside(p,opening.points))&&!opening.points.some((p,i)=>other.points.some((q,j)=>intersects(p,opening.points[(i+1)%opening.points.length]!,q,other.points[(j+1)%other.points.length]!))),'Opening deductions cannot overlap or count the same opening twice')}
 }else if(parent.kind==='length'){
  need(opening.points.slice(1).every((p,i)=>parent.points.slice(1).some((q,j)=>on(opening.points[i]!,parent.points[j]!,q)&&on(p,parent.points[j]!,q))),'An opening length must follow a parent line segment')
  for(const other of others)need(!opening.points.slice(1).some((p,i)=>other.points.slice(1).some((q,j)=>intersects(opening.points[i]!,p,other.points[j]!,q))),'Opening length deductions cannot overlap')
 }else{
  need(opening.points.every(p=>parent.points.some(q=>q.x===p.x&&q.y===p.y)),'Deduct only recorded parent count markers')
  need(new Set(opening.points.map(p=>`${p.x},${p.y}`)).size===opening.points.length&&!opening.points.some(p=>others.some(o=>o.points.some(q=>q.x===p.x&&q.y===p.y))),'Count deductions cannot remove a marker twice')
 }
}
