import type { Stamp } from './model'

/** Office records travel with the job; service records use explicit client/company projections. */
export interface WarrantyState {
 components: WarrantyComponent[]
 promises: WarrantyPromise[]
 cases: WarrantyCase[]
 reminders: WarrantyReminder[]
}
/** An entered snapshot of the signed terms; no edit or case action replaces it. */
export interface WarrantyComponent {
 id: string; name: string; starts_on: string; ends_on: string
 terms: string; signed_terms_reference: string; recorded_by: Stamp
}
/** Native identity/assignment fence, without pretending that cron has a user session. */
export interface WarrantyAuthority {
 id: string; email: string; version: number; role: 'owner' | 'admin'
 team_version?: number
}
export interface WarrantyRecipient {
 kind: 'client' | 'office'; email: string
 /** Office recipients have an existing, active native identity. */
 operator_id?: string
}
export interface WarrantyPromise {
 id: string; revision: number; component_id: string; title: string; anchor_on: string
 interval_unit: 'month' | 'year'; interval_count: number; ends_on?: string; case_id?: string
 recipient: WarrantyRecipient; agreement_reference: string
 status: 'active' | 'paused' | 'revoked'; created_by: Stamp
 authority: WarrantyAuthority; auth_generation: number; activated_on: string
 history: { action: 'created' | 'paused' | 'resumed' | 'revoked' | 'case_closed'; reason: string; agreement_reference?: string; by: Stamp }[]
}
export interface WarrantyCost {
 id: string; currency: 'USD'; amount_cents: number; cost_code: string
 reference: string; description: string; recorded_by: Stamp
}
export interface WarrantyReview {
 id: string; decision: 'covered' | 'not_covered' | 'needs_evidence'
 reason: string; source_reference: string; reviewed_by: Stamp
}
export interface WarrantyCase {
 service?: import('./warranty-service-model').WarrantyService
 id: string; component_id: string; defect_key: string; description: string; reported_on: string
 reviewer_email: string; reviewer_id: string; repeated: boolean; earlier_case_ids: string[]
 escalation?: { reviewer_email: string; reason: string; recorded_by: Stamp }
 status: 'open' | 'closed'; recorded_by: Stamp; costs: WarrantyCost[]; reviews: WarrantyReview[]
 closure?: { reason: string; evidence_reference: string; review_id: string; closed_by: Stamp }
}
export type WarrantyReminderStatus = 'unknown' | 'accepted' | 'refused' | 'development' | 'unconfigured' | 'cancelled'
export interface WarrantyReminder {
 id: string; promise_id: string; agreement_revision: number; component_id: string; due_on: string; recipient_email: string
 status: WarrantyReminderStatus; label: string; reserved_at: string; completed_at?: string
 provider_message_id?: string
 /** Attribution distinguishes an automatic run from a signed-in person's dispatch. */
 dispatched_by: { kind: 'scheduler'; configured_by: string } | { kind: 'person'; by: Stamp }
}
