import { requireJobManager } from './auth'
import { cents, find, need, recordApproval, stamp, sum, text, type Actor, type Input, type Job, type Stamp } from './model'
import { costCode, document, type CostDocument } from './cost-model'
import { day, fulfillment, milli, show } from './purchase-order-model'
import { receiveOrder } from './operations'
import { orderAction } from './purchase-orders'

export interface StockLot {
 id:string; origin_job_id:string; order_id:string; receipt_id:string; line_id:string; description:string; unit:string; cost_code:string; location:string; received_on:string;
 quantity:number; good:number; damaged:number; installed:number; returned:number; transferred:number; good_cents:number; damaged_cents:number; value_cents:number;
}
export interface StockMovement { id:string; operation_id:string; kind:'receive'|'transfer-out'|'transfer-in'|'install'|'return'; lot_id:string; quantity:string; amount_cents:number; dated_on:string; reference:string; by:Stamp; transfer_id?:string; other_job_id?:string; condition?:'good'|'damaged' }
export interface InventoryClaim { id:string; order_id:string; receipt_id:string; line_id:string; cost_code:string; supplier:string; damaged:string; short:string; exposure_cents:number; reference:string; by:Stamp; review?:{forecast_impact_cents:number;reason:string;by:Stamp}; adjustments?:{id:string;forecast_impact_cents:number;reason:string;by:Stamp}[] }
export interface EquipmentAllocation { id:string; equipment:string; location:string; cost_code:string; from:string; through:string; reference:string; by:Stamp }
export interface InventoryState { lots:StockLot[]; movements:StockMovement[]; tickets:{receipt_id:string;document:CostDocument}[]; claims:InventoryClaim[]; equipment:EquipmentAllocation[]; operations:string[] }
export const inventory=(job:Job):InventoryState=>job.site_inventory??={lots:[],movements:[],tickets:[],claims:[],equipment:[],operations:[]}
const price=(quantity:number,value:number,total:number)=>Number((BigInt(quantity)*BigInt(value)*2n+BigInt(total))/(2n*BigInt(total)))
export function inventoryView(job:Job){
 const state=inventory(job)
 return {version:job.version,...state,tickets:state.tickets.map(t=>({...t,document:{...t.document,base64:undefined}})),lots:state.lots.map(l=>({...l,received_quantity:show(l.quantity),good_quantity:show(l.good),damaged_quantity:show(l.damaged),installed_quantity:show(l.installed),returned_quantity:show(l.returned),transferred_quantity:show(l.transferred)})),orders:job.orders.filter(o=>o.lines&&o.status!=='draft').map(o=>({id:o.id,supplier:o.supplier,description:o.description,...fulfillment(o)})),label:'Native stock custody. Claims are prepared, not sent; forecast review does not change PO terms or authorize a supplier credit or payment.'}
}
export function inventoryAccess(actor:Actor){requireJobManager(actor)}
const movement=(job:Job,actor:Actor,input:Input,row:Omit<StockMovement,'id'|'operation_id'|'by'>)=>{const m={...row,id:crypto.randomUUID(),operation_id:text(input.operation_id,'operation_id',100),by:stamp(actor)};inventory(job).movements.push(m);recordApproval(job,actor,'inventory.'+m.kind,{id:m.id,prepared_by:m.by},m);return m}
export function inventoryOperation(job:Job,input:Input){const key=text(input.operation_id,'operation_id',100);need(!inventory(job).operations.includes(key),'This inventory operation is already recorded',409,'inventory_replay');inventory(job).operations.push(key)}
export async function receiveStock(job:Job,actor:Actor,input:Input){
 const order=find(job.orders,text(input.order_id,'order_id',100));need(order.lines,'Choose an itemized PO',409,'inventory_order')
 const location=text(input.location,'Stock location',200),received_on=day(input.received_on,'Arrival date'),original=await document(input.document)
 need(Array.isArray(input.lines)&&input.lines.length>0,'Provide delivered quantities')
 const rows=input.lines.map(value=>{const v=value as Input,line=find(order.lines!,String(v.line_id)),quantity=milli(v.quantity,'Delivered quantity',true),damaged=v.damaged===undefined?0:milli(v.damaged,'Damaged quantity',true),expected=v.expected_quantity===undefined?quantity:milli(v.expected_quantity,'Expected delivery quantity');need(expected>0,'Record delivered stock or a positive expected shortage');need(damaged<=quantity,'Damage cannot exceed the delivery');need(expected>=quantity,'Expected delivery cannot be below received quantity');const outstanding=fulfillment(order).lines.find(l=>l.line_id===line.id)!;need(expected<=Number(outstanding.outstanding)*1000,'Expected delivery exceeds the outstanding order',409,'over_receipt');return {line,quantity,damaged,short:expected-quantity}})
 const before=order.receipts.length;receiveOrder(job,actor,order.id,{...input,received_on},true);const receipt=order.receipts[before]!
 inventory(job).tickets.push({receipt_id:receipt.id,document:original})
 // Allocate the receipt's rounded cents once, then retain that value through every custody movement.
 const weights=rows.map(r=>BigInt(r.quantity)*BigInt(r.line.unit_cents)),total=weights.reduce((a,b)=>a+b,0n)
 const values=rows.map((_,i)=>total?Number(BigInt(receipt.amount_cents)*weights[i]!/total):0);let left=receipt.amount_cents-sum(values)
 const remainders=total?weights.map((w,i)=>({i,r:BigInt(receipt.amount_cents)*w%total})).sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1):[]
 for(const r of remainders)if(left-->0)values[r.i]++
 rows.forEach((r,i)=>{
  // A total shortage has a ticket and claim, but no physical lot or stock movement.
  if(r.quantity>0){
   const value=values[i]!,damage=price(r.damaged,value,r.quantity),lot:StockLot={id:crypto.randomUUID(),origin_job_id:job.id,order_id:order.id,receipt_id:receipt.id,line_id:r.line.id,description:r.line.description,unit:r.line.unit,cost_code:r.line.cost_code,location,received_on,quantity:r.quantity,good:r.quantity-r.damaged,damaged:r.damaged,installed:0,returned:0,transferred:0,good_cents:value-damage,damaged_cents:damage,value_cents:value}
   inventory(job).lots.push(lot);movement(job,actor,input,{kind:'receive',lot_id:lot.id,quantity:show(r.quantity),amount_cents:value,dated_on:received_on,reference:receipt.reference})
  }
  if(r.damaged||r.short)inventory(job).claims.push({id:crypto.randomUUID(),order_id:order.id,receipt_id:receipt.id,line_id:r.line.id,cost_code:r.line.cost_code,supplier:order.supplier,damaged:show(r.damaged),short:show(r.short),exposure_cents:cents(Number((BigInt(r.damaged+r.short)*BigInt(r.line.unit_cents)+500n)/1000n)),reference:receipt.reference,by:stamp(actor)})
 })
 return receipt
}
function consume(lot:StockLot,quantity:number,condition:'good'|'damaged'){
 need(quantity<=lot[condition],'Insufficient stock in this location and condition',409,'insufficient_stock')
 const key=condition==='good'?'good_cents':'damaged_cents',amount=price(quantity,lot[key],lot[condition]);lot[condition]-=quantity;lot[key]-=amount;return amount
}
export function moveStock(job:Job,actor:Actor,input:Input,kind:'install'|'return'|'transfer',target?:Job){
 const lot=find(inventory(job).lots,text(input.lot_id,'lot_id',100)),quantity=milli(input.quantity,'Quantity'),dated_on=day(input.dated_on,'Movement date'),reference=text(input.reference,'Movement reference',1000)
 need(dated_on>=lot.received_on,'Movement cannot precede stock arrival')
 const condition=input.condition==='damaged'?'damaged':'good';need(kind==='return'||condition==='good','Damaged stock cannot be installed or transferred',409,'damaged_stock')
 const amount=consume(lot,quantity,condition)
 if(kind==='transfer'){
  need(target&&target.id!==job.id,'Choose another authorized job');need((target.currency??'USD')===(job.currency??'USD'),'Transfers cannot mix currencies',409,'currency')
  const code=costCode(target,input.cost_code),location=text(input.location,'Destination location',200),transfer_id=crypto.randomUUID()
  const incoming:StockLot={...lot,id:crypto.randomUUID(),cost_code:code,location,received_on:dated_on,quantity,good:quantity,damaged:0,installed:0,returned:0,transferred:0,good_cents:amount,damaged_cents:0,value_cents:amount}
  lot.transferred+=quantity;inventory(target).lots.push(incoming)
  movement(job,actor,input,{kind:'transfer-out',lot_id:lot.id,quantity:show(quantity),amount_cents:amount,dated_on,reference,transfer_id,other_job_id:target.id})
  movement(target,actor,input,{kind:'transfer-in',lot_id:incoming.id,quantity:show(quantity),amount_cents:amount,dated_on,reference,transfer_id,other_job_id:job.id});return incoming
 }
 if(kind==='return'){
  need(lot.origin_job_id===job.id,'Return transferred stock to its originating job before returning it to the supplier',409,'inventory_origin')
  const order=find(job.orders,lot.order_id);orderAction(job,actor,order.id,'return',{lines:[{line_id:lot.line_id,quantity:show(quantity)}],reason:reference,reference,returned_on:dated_on},true);lot.returned+=quantity
 }else lot.installed+=quantity
 return movement(job,actor,input,{kind,lot_id:lot.id,quantity:show(quantity),amount_cents:amount,dated_on,reference,condition})
}
export function allocateEquipment(job:Job,actor:Actor,input:Input,all:Job[]){
 const equipment=text(input.equipment,'Equipment reference',200),from=day(input.from,'Allocation start'),through=day(input.through,'Allocation end');need(through>=from,'Allocation end must follow its start')
 need(!all.some(j=>inventory(j).equipment.some(e=>e.equipment.toLowerCase()===equipment.toLowerCase()&&e.from<=through&&from<=e.through)),'Equipment is already allocated for these dates',409,'equipment_conflict')
 const row={id:crypto.randomUUID(),equipment,from,through,cost_code:costCode(job,input.cost_code),location:text(input.location,'Equipment location',200),reference:text(input.reference,'Allocation reference',1000),by:stamp(actor)}
 inventory(job).equipment.push(row);recordApproval(job,actor,'inventory.equipment',{id:row.id,prepared_by:row.by},row);return row
}
export const claimImpact=(claim:InventoryClaim)=>claim.adjustments?.at(-1)?.forecast_impact_cents??claim.review?.forecast_impact_cents??0
export function reviewClaim(job:Job,actor:Actor,input:Input,adjust=false){
 requireJobManager(actor)
 const row=find(inventory(job).claims,text(input.claim_id,'claim_id',100));need(adjust?row.review:!row.review,adjust?'Review the original claim before adjusting its remaining exposure':'This claim review is immutable',409,'immutable');need(input.confirm===true,'Explicitly confirm the reviewed forecast impact')
 const review={forecast_impact_cents:cents(input.forecast_impact_cents,'Forecast impact'),reason:text(input.reason,'Forecast review reason',1000),by:stamp(actor)}
 if(adjust)(row.adjustments??=[]).push({id:crypto.randomUUID(),...review});else row.review=review
 recordApproval(job,actor,adjust?'inventory.claim-adjust':'inventory.claim-review',{id:row.id,prepared_by:row.by},row);return row
}
