import { need, text } from './model'
import type { WarrantyComponent, WarrantyPromise, WarrantyReminder } from './warranty-model'
import { wallClock } from './time-zone'

export function warrantyDay(value: unknown, name: string): string {
 const date = text(value, name, 10), instant = Date.parse(date + 'T00:00:00Z')
 need(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date && date >= '1900-01-01', `${name} must be a calendar date (YYYY-MM-DD) from 1900 onward`)
 return date
}
/** Inclusive job-local dates are an indication of term timing, never a coverage decision. */
export function warrantyPeriod(component: WarrantyComponent, on: string): 'upcoming' | 'within_period' | 'expired' {
 return on < component.starts_on ? 'upcoming' : on > component.ends_on ? 'expired' : 'within_period'
}
/** Every occurrence is calculated from the original anchor, avoiding Jan-31/Feb-28 drift. */
export function warrantyOccurrence(promise: Pick<WarrantyPromise, 'anchor_on' | 'interval_unit' | 'interval_count'>, index: number): string {
 need(Number.isSafeInteger(index) && index >= 0, 'Occurrence index must be nonnegative')
 const [year, month, day] = promise.anchor_on.split('-').map(Number)
 const months = index * promise.interval_count * (promise.interval_unit === 'year' ? 12 : 1)
 const absolute = year! * 12 + month! - 1 + months, y = Math.floor(absolute / 12), m = absolute % 12
 need(y <= 9999, 'Occurrence exceeds the supported calendar')
 const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
 return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(Math.min(day!, last)).padStart(2, '0')}`
}
/** At most one oldest pending occurrence per promise per dispatch; historic catch-up is bounded. */
export function nextWarrantyDue(promise: WarrantyPromise, reminders: WarrantyReminder[], zone: string, now: number): string | undefined {
 if (promise.status !== 'active') return undefined
 const wall = wallClock(now, zone), floor = promise.activated_on
 if (wall.date < floor || wall.date < promise.anchor_on) return undefined
 const [fy, fm] = floor.split('-').map(Number), [ay, am] = promise.anchor_on.split('-').map(Number)
 const step = promise.interval_count * (promise.interval_unit === 'year' ? 12 : 1)
 // Resume cancels historic obligations before the newly confirmed local agreement date.
 let index = Math.max(0, Math.floor(((fy! - ay!) * 12 + fm! - am!) / step))
 const seen = new Set(reminders.filter(r => r.promise_id === promise.id && r.recipient_email === promise.recipient.email).map(r => r.due_on))
 // Records are capped, so scanning beyond the history length cannot find another attempted date.
 for (let n = 0; n <= seen.size + 1; n++, index++) {
  let due: string
  try { due = warrantyOccurrence(promise, index) } catch { return undefined }
  if (due < floor) continue
  if (due > wall.date || due === wall.date && wall.hour < 9 || promise.ends_on && due > promise.ends_on) return undefined
  if (!seen.has(due)) return due
 }
 return undefined
}
