import type { Actor, Job, Stamp, Variation } from './model'
import type { SchedulePreview } from './schedule-model'

export interface ChangeSigner {
 id: string; name: string; version: number; role: Actor['role']; team_version: number | null; role_version: number | null; role_id: string | null
}
export interface SignedChange {
 id: string; revision: number; variation_id: string; status: 'presented' | 'signed' | 'declined' | 'disputed' | 'applied'
 prepared_by: Stamp; builder: ChangeSigner; client: ChangeSigner
 document: {
  format: 'plinth-signed-change-v1'; job_id: string; job_name: string; scope: string; currency: 'USD'; amount_cents: number
  tax_cents: number; tax_reference: string; allowance: {selection_id: string; selection_revision_id: string; cost_code: string; allowance_cents: number; economic_delta_cents: number; prior_economic_delta_cents: number; amount_cents: number} | null; affected_tasks: {id: string; description: string; start: string; end: string; revised_start: string; revised_end: string}[]
  extra_days: number; completion_before: string; revised_completion: string; private_terms_digest: string
  statement: string; signers: {builder: {id: string; name: string}; client: {id: string; name: string}}
 }
 digest: string; source_digest: string; private_terms: Variation; schedule: SchedulePreview
 signatures: {side: 'builder' | 'client'; document_digest: string; name: string; statement: string; signed_by: Stamp}[]
 history: {kind: string; reason: string; by: Stamp}[]
 application?: {by: Stamp; budget_revision: number; sov_revision: number; claim_id?: string; invoice_id?: string; billing_deferred?: {reason: string}}
}
export type ChangeJob = Job & {signed_changes?: SignedChange[]}
