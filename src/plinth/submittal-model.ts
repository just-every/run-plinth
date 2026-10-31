import type { Attachment, Job, Order, Stamp } from './model'

export interface SubmittalReviewer { id: string; name: string; operator_version: number; team_version: number; role_version: number }
export interface SubmittalCycle {
 id: string; revision: number; product_reference: string; required_on: string; specified_scope: string;
 deviation: string; reviewer: SubmittalReviewer; commitment: string; attachments: Attachment[]; submitted_by: Stamp;
 annotations: { id: string; file_id: string; page: number; text: string; by: Stamp }[];
 decision?: { disposition: 'approved' | 'rejected' | 'revise_resubmit'; comment: string; by: Stamp };
}
export interface SubmittalNotice {
 id: string; cycle_id: string; to: string; by: Stamp; subject: string; body: string;
 status: 'unknown' | 'accepted' | 'refused' | 'development'; label: string; provider_message_id?: string;
}
export interface Submittal { id: string; title: string; order_id: string; cycles: SubmittalCycle[]; created_by: Stamp; notices?: SubmittalNotice[] }
export interface SubmittalRelease { submittal_id: string; cycle_id: string; product_reference: string; by: Stamp }
export interface SubmittalView { version: number; person_id: string; manage: boolean; register: Submittal[]; reviewers: SubmittalReviewer[]; orders: Order[] }

/** Exact economics are frozen alongside the vendor version; fulfillment never rewrites the approved terms. */
export function submittalCommitment(row: Order, proposed = false) {
 const amendment = proposed ? row.amendments?.find(a => a.status === 'pending')?.proposed : undefined
 return JSON.stringify({ id: row.id, supplier: row.supplier, description: row.description, amount_cents: amendment?.amount_cents ?? row.amount_cents, lines: amendment?.lines ?? row.lines ?? [], source: row.source ?? null })
}
export const submittalFor = (job: Job, order: Order) => job.submittals?.find(s => s.order_id === order.id)
