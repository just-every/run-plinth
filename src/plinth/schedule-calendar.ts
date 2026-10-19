import { need, object } from './model'
import { defaultCalendar, type WorkingCalendar } from './schedule-model'

const DAY = 86_400_000, MINUTE = 60_000
export function workingCalendar(value: unknown): WorkingCalendar {
 const input = value === undefined ? defaultCalendar : object(value)
 need(Array.isArray(input.weekdays) && input.weekdays.length > 0 && input.weekdays.length <= 7 && input.weekdays.every(d => Number.isInteger(d) && d >= 0 && d <= 6), 'Choose working weekdays (0 Sunday through 6 Saturday)')
 need(Number.isInteger(input.start_hour) && Number.isInteger(input.end_hour) && Number(input.start_hour) >= 0 && Number(input.end_hour) <= 24 && Number(input.end_hour) > Number(input.start_hour), 'Working hours must be whole UTC hours from 0 through 24')
 need(Array.isArray(input.holidays) && input.holidays.length <= 366 && input.holidays.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d), 'Holidays must be valid YYYY-MM-DD dates (up to 366)')
 return { weekdays: [...new Set(input.weekdays as number[])].sort(), start_hour: Number(input.start_hour), end_hour: Number(input.end_hour), holidays: [...new Set(input.holidays as string[])].sort() }
}
const midnight = (t: number) => Math.floor(t / DAY) * DAY
function bounds(t: number, c: WorkingCalendar) {
 const day = midnight(t), date = new Date(day)
 return { open: day + c.start_hour * 3_600_000, close: day + c.end_hour * 3_600_000, working: c.weekdays.includes(date.getUTCDay()) && !c.holidays.includes(date.toISOString().slice(0, 10)) }
}
/** Finish-to-start scheduling uses working minutes in the explicitly displayed UTC calendar. */
export function nextWork(t: number, c: WorkingCalendar): number {
 for (let days = 0; days < 3700; days++) {
  const b = bounds(t, c)
  if (b.working && t < b.close) return Math.max(t, b.open)
  t = midnight(t) + DAY
 }
 throw new Error('Working calendar horizon exceeded')
}
export function addWork(t: number, minutes: number, c: WorkingCalendar): number {
 t = nextWork(t, c)
 for (let days = 0; days < 3700; days++) {
  const b = bounds(t, c), available = (b.close - t) / MINUTE
  if (minutes <= available) return t + minutes * MINUTE
  minutes -= available; t = nextWork(midnight(t) + DAY, c)
 }
 throw new Error('Working calendar horizon exceeded')
}
export function subtractWork(t: number, minutes: number, c: WorkingCalendar): number {
 for (let days = 0; days < 3700; days++) {
  const b = bounds(t, c)
  if (b.working && t > b.open) {
   t = Math.min(t, b.close)
   const available = (t - b.open) / MINUTE
   if (minutes <= available) return t - minutes * MINUTE
   minutes -= available
  }
  t = midnight(t) - 1
 }
 throw new Error('Working calendar horizon exceeded')
}
export function workingMinutes(start: number, end: number, c: WorkingCalendar): number {
 let total = 0
 for (let t = midnight(start), days = 0; t < end && days < 3700; t += DAY, days++) {
  const b = bounds(t, c)
  if (b.working) total += Math.max(0, Math.min(end, b.close) - Math.max(start, b.open)) / MINUTE
 }
 return total
}
