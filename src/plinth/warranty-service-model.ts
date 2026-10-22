import type {Attachment,Stamp} from './model'
export interface WarrantyNoRepairResolution {
 id:string; by:Stamp; reason:string; basis:'withdrawal'|'not_covered'; review_id?:string; withdrawal_id?:string
}
export interface WarrantyService {
 requested_by:Stamp; availability:string; attachments:Attachment[]
 ownership?:{by:Stamp;statement:string}
 assignment?:{subcontract_id:string;email:string;by:Stamp;reason:string}
 visits:{id:string;task_id:string;start:string;end:string;booked_by:Stamp;assignment:{subcontract_id:string;email:string};submission?:{by:Stamp;statement:string;attachments:Attachment[]};review?:{by:Stamp;accepted:boolean;reason:string}}[]
 client_acknowledgment?:{by:Stamp;visit_id:string;statement:string}
 withdrawal?:{id:string;by:Stamp;statement:string}
 /** Append-only: a newer coverage review makes earlier resolutions ineligible for acknowledgment. */
 no_repair_resolutions?:WarrantyNoRepairResolution[]
 not_covered_acknowledgment?:{by:Stamp;review_id:string;resolution_id:string;statement:string}
 history:{kind:string;by:Stamp;reason:string;visit_id?:string;subcontract_id?:string}[]
}
