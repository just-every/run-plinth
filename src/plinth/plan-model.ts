import type { Attachment, Stamp } from './model'
export interface PlanSheet { id:string; number:string; revision:string; kind:'plan'|'specification'|'addendum'; page:number; width:number; height:number; document:Attachment }
export interface PlanAnnotation { id:string; sheet_id:string; revision:string; x:number; y:number; text:string; by:Stamp }
export interface PlanRecipient { id:string; name:string; acknowledged_by?:Stamp }
export interface PlanSet { drawing_review?:import('./drawing-review').DrawingState; id:string; title:string; issue_on:string; sheets:PlanSheet[]; prepared_by:Stamp; approved_by?:Stamp; recipients:PlanRecipient[]; annotations:PlanAnnotation[] }
export interface PlanSheetView extends PlanSheet { current:boolean; superseded_by?:{set_id:string;sheet_id:string;revision:string}; href:string }
export interface PlanSetView extends Omit<PlanSet,'sheets'> { sheets:PlanSheetView[] }
export interface PlanView { id:string; version:number; name:string; manage:boolean; review:boolean; annotate:boolean; person_id:string; sets:PlanSetView[]; recipients:PlanRecipient[] }
export const planLink=(job:string,set:string,sheet:string)=>'/app?'+new URLSearchParams({view:'plans',plan_job:job,plan_set:set,plan_sheet:sheet})
