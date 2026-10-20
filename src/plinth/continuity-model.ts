import type { BudgetRevision } from './budget-model'
import type { Job, Stamp } from './model'

/** A source event owns one journal; completion means draft preparation, never finalization. */
export interface Continuity {
 id: string; source: BudgetRevision['source']; budget_id: string; created_by: Stamp
 stage: 'schedule' | 'purchasing' | 'billing' | 'complete'
 schedule?: { id: string; status: 'proposed'; calendar_day_impact: number | null; reference: string; tasks: Job['schedules']; selection_revision_id?: string }
 purchasing?: { id: string; status: 'draft'; order_id?: string; lines: BudgetRevision['billing_lines']; label: string }
 billing?: { id: string; status: 'draft'; purpose: string; budget: BudgetRevision; adjustment_cents: number; claim_ids: string[] }
 notices?: { id: string; recipient_id: string; email: string; channel: 'email'; approved_by: Stamp; status: 'unknown' | 'accepted' | 'refused' | 'development' | 'unconfigured' | 'cancelled'; label: string; provider_message_id?: string }[]
}
