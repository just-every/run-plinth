import type {Attachment,Stamp} from './model'
export interface WarrantyService {
 requested_by:Stamp; availability:string; attachments:Attachment[]
 ownership?:{by:Stamp;statement:string}
 assignment?:{subcontract_id:string;email:string;by:Stamp;reason:string}
 visits:{id:string;task_id:string;start:string;end:string;booked_by:Stamp;assignment:{subcontract_id:string;email:string};submission?:{by:Stamp;statement:string;attachments:Attachment[]};review?:{by:Stamp;accepted:boolean;reason:string}}[]
 client_acknowledgment?:{by:Stamp;visit_id:string;statement:string}
 history:{kind:string;by:Stamp;reason:string}[]
}
