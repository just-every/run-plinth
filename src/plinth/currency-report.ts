import { currencyOf, sum, type Currency, type Job } from './model'

export interface CurrencyTotal { currency: Currency; historical: boolean; jobs: number; contract_cents: number; quoted_cents: number; billed_cents: number }
/** Portfolio money grouped by currency: an AUD historical job is never added into a USD total. */
export function currencyTotals(list: Job[]): CurrencyTotal[] {
 const groups = new Map<Currency, Job[]>()
 for (const job of list) groups.set(currencyOf(job), [...groups.get(currencyOf(job)) ?? [], job])
 return [...groups].sort(([a], [b]) => a === 'USD' ? -1 : b === 'USD' ? 1 : a.localeCompare(b)).map(([currency, jobs]) => ({
  currency, historical: currency !== 'USD', jobs: jobs.length,
  contract_cents: sum(jobs.map(job => { const quote = job.quotes.find(q => q.status === 'accepted'); return quote ? sum([quote.total_cents, ...job.variations.filter(v => v.status === 'approved').map(v => v.amount_cents)]) : 0 })),
  quoted_cents: sum(jobs.filter(job => job.status === 'quoting').map(job => job.quotes.at(-1)?.total_cents ?? 0)),
  billed_cents: sum(jobs.map(job => Math.max(0, ...job.claims.filter(c => c.status !== 'draft').map(c => c.cumulative_cents)))),
 }))
}
