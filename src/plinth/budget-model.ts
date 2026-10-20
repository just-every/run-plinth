import { sum, type Line, type Stamp } from './model'
export interface BudgetCode { cost_code: string; revenue_cents: number; cost_cents: number | null; allowance_cents: number; commitment_plan_cents: number }
export interface BudgetRevision {
 id: string; revision: number; source: { kind: 'quote' | 'variation'; id: string; revision: number }; recorded_by: Stamp
 contract_cents: number; codes: BudgetCode[]; billing_lines: { id: string; cost_code: string; description: string; scheduled_cents: number }[]
 allowances: { cost_code: string; amount_cents: number }[]; commitment_plan: { cost_code: string; amount_cents: number; description: string }[]
 schedule: { kind: 'none'; reason: string } | { kind: 'template'; application: NonNullable<import('./model').Job['schedule_template']> }
}
export const budgetCost = (lines: Line[]) => lines.every(l => l.cost_total_cents !== undefined) ? sum(lines.map(l=>l.cost_total_cents!)) : null
