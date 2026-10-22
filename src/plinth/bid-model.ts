import type {Attachment, Job, Stamp} from './model'

export interface BidLine {cost_code:string;description:string;budget_cents?:number}
export interface BidRevision {id:string;number:number;note:string;due_on:string;plans:Attachment[];by:Stamp}
export interface BidQuestion {id:string;text:string;by:Stamp;answer?:{text:string;by:Stamp}}
export interface BidResponse {id:string;revision_id:string;items:{cost_code:string;description:string;amount_cents:number}[];total_cents:number;exclusions:string;attachments:Attachment[];by:Stamp}
export interface BidInvitation {id:string;subcontract_id?:string;pre_award?:true;vendor_id:string;vendor_name:string;contact_id:string;email:string;contact_name:string;cost_codes:string[];by:Stamp;revoked_by?:Stamp;acknowledgments:{revision_id:string;by:Stamp}[];questions:BidQuestion[];responses:BidResponse[];decline?:{reason:string;by:Stamp}}
export interface BidPackage {id:string;title:string;trade:string;scope:string;mode:'priced'|'unpriced';lines:BidLine[];revisions:BidRevision[];prepared_by:Stamp;published_by?:Stamp;invitations:BidInvitation[]}
export type BidJob = Job & {bids?:BidPackage[]}
export type BidView = Omit<BidPackage,'invitations'> & {invitations:(BidInvitation & {status:string;late:boolean})[]}
export interface BidSource {id:string;version:number;name:string;cost_codes:string[];bids:BidView[]}
