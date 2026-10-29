import type { Input, Stamp } from './model'
import type { SchedulePreview } from './schedule-model'
import type { CostForecast } from './cost-model'
import type { cashReport } from './cost-periods'

export interface RecoverySources {
 digest:string; job_id:string; source_version:number
 facts:Input
}
export interface RecoveryAlternative {
 id:string; name:string; assumptions:string; schedule:SchedulePreview
 native_feasible:boolean
 labor_capacity:{task_id:string;required_minutes:string;available_minutes:number;sufficient:boolean}
 forecast:CostForecast; cash:ReturnType<typeof cashReport>
 amendment:{order_id:string;original_amount_cents:number;proposed_amount_cents:number;extra_cents:number;promised_on:string;reason:string;state:'unsent'}
 client_decision:{description:string;proposed_price_delta_cents:number;state:'unapproved'}
 outstanding_decisions:string[]
}
export interface RecoveryProposal {
 id:string; key:string; input_digest:string; digest:string; prepared_by:Stamp
 alternatives:RecoveryAlternative[]
 difference:{finish_minutes:number;remaining_cents:number;margin_cents:number;expected_cash_closing_cents:number[];expected_cash_trough_cents:number}
 reviews:{alternative_id:string;decision:'retain'|'reject';reason:string;by:Stamp}[]
}
export interface RecoveryRequest {
 id:string; purpose:string; as_of:string; prepared_by:Stamp; owner_version:number; installation:string
 sources:RecoverySources; package_order_id:string; package_task_id:string; package_cost_code:string; labor_cost_code:string; labor_task_id:string
 share_with_owner_agents:boolean; revoked_by?:Stamp; proposals:RecoveryProposal[]
}
