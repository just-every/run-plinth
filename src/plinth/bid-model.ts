import type {Attachment, Job, Stamp} from './model'

export interface BidLine {cost_code:string;description:string;budget_cents?:number}
export interface BidRevision {id:string;number:number;note:string;due_on:string;plans:Attachment[];by:Stamp}
export interface BidQuestion {id:string;text:string;by:Stamp;answer?:{text:string;by:Stamp}}
export interface BidResponse {id:string;revision_id:string;items:{cost_code:string;description:string;amount_cents:number}[];total_cents:number;exclusions:string;attachments:Attachment[];by:Stamp}
export interface BidReminder {id:string;approval_id:string;revision_id:string;kind:'acknowledgment'|'price';at:string}
export interface BidFollowUp {id:string;revision_id:string;task_id:string;required_on_site:string;lead_days:number;order_by:string;remind_on:string;estimator_id:string;estimator_name:string;approved_by:Stamp;authority_version:number;generation:number;paused?:true;escalation?:{at:string;invitation_ids:string[];review?:{by:Stamp;reason:string}}}
export interface BidInvitation {id:string;subcontract_id?:string;pre_award?:true;vendor_id:string;vendor_name:string;contact_id:string;email:string;contact_name:string;cost_codes:string[];by:Stamp;revoked_by?:Stamp;acknowledgments:{revision_id:string;by:Stamp}[];questions:BidQuestion[];responses:BidResponse[];reminders?:BidReminder[];decline?:{reason:string;by:Stamp}}
export interface BidPackage {id:string;title:string;trade:string;scope:string;mode:'priced'|'unpriced';lines:BidLine[];revisions:BidRevision[];prepared_by:Stamp;published_by?:Stamp;invitations:BidInvitation[];follow_up?:BidFollowUp}
export type BidJob = Job & {bids?:BidPackage[]}
export type BidView = Omit<BidPackage,'invitations'> & {invitations:(BidInvitation & {status:string;late:boolean})[]}
export interface BidSource {id:string;version:number;name:string;cost_codes:string[];bids:BidView[];tasks?:{id:string;description:string;start:string;status:string}[];estimators?:{id:string;name:string}[]}
