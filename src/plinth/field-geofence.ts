import { cents, need, stamp, text, type Actor, type Input, type Job, type Stamp } from './model'
export interface TimeFence { latitude:number; longitude:number; radius_meters:number; label:string; by:Stamp }
export interface LocationChoice { employee_id:string; consent:boolean; by:Stamp; inside?:boolean; reminder?:{kind:'clock_in'|'clock_out';message:string;at:string} }
function coordinate(value:unknown,limit:number){need(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit,'Location must contain valid coordinates');return value}
/** Coordinates are processed only for consented reminders. Worker coordinates are never stored. */
export function geofenceAction(job:Job,actor:Actor,input:Input,action:string){
 const data=job.field_time!,choices=data.location_choices??=[]
 if(action==='site'){
  need(actor.role==='owner','Only the owner configures a site reminder',403,'forbidden')
  if(input.enabled===false){data.site=undefined;for(const c of choices){delete c.inside;delete c.reminder}return {enabled:false}}
  const radius_meters=cents(input.radius_meters,'radius_meters');need(radius_meters>=25&&radius_meters<=10000,'Choose a radius between 25 and 10000 meters')
  data.site={latitude:coordinate(input.latitude,90),longitude:coordinate(input.longitude,180),radius_meters,label:text(input.label,'Visible site label',200),by:stamp(actor)}
  for(const c of choices){delete c.inside;delete c.reminder}return {enabled:true,label:data.site.label}
 }
 let choice=choices.find(c=>c.employee_id===actor.id)
 if(action==='consent'){
  need(typeof input.consent==='boolean','Explicitly choose whether to allow location reminders')
  if(!choice){choice={employee_id:actor.id,consent:input.consent,by:stamp(actor)};choices.push(choice)}
  choice.consent=input.consent;choice.by=stamp(actor);delete choice.inside;delete choice.reminder
  return {...choice,label:'Optional reminders only; GPS does not prove work; no time is recorded automatically'}
 }
 need(action==='location','Unknown geofence action',404,'not_found');need(choice?.consent,'Location reminders require your current explicit consent',403,'location_consent')
 const site=data.site;need(site,'Site reminders are disabled',409,'geofence_disabled')
 const latitude=coordinate(input.latitude,90),longitude=coordinate(input.longitude,180),radians=(v:number)=>v*Math.PI/180
 const a=Math.sin(radians(latitude-site.latitude)/2)**2+Math.cos(radians(site.latitude))*Math.cos(radians(latitude))*Math.sin(radians(longitude-site.longitude)/2)**2
 const distance=6371000*2*Math.atan2(Math.sqrt(Math.min(1,a)),Math.sqrt(Math.max(0,1-a))),inside=distance<=site.radius_meters
 const transition=choice.inside===undefined?inside:choice.inside!==inside
 choice.inside=inside
 if(transition)choice.reminder={kind:inside?'clock_in':'clock_out',message:inside?'At the site? Record your time when you start work.':'Leaving the site? Review and record your time.',at:new Date().toISOString()}
 return {inside,reminder:transition?choice.reminder:null,label:'Reminder only; no time recorded; worker coordinates discarded'}
}
