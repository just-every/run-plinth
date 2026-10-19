import { need, object } from './model'
import { defaultCalendar, type WorkingCalendar } from './schedule-model'
import { dayStart, nextDate, timeZone, wallClock, zonedInstant } from './time-zone'

const MINUTE = 60_000
/** The calendar always runs in its job's IANA time zone; a job without one keeps UTC. */
export function workingCalendar(value: unknown, zone = 'UTC'): WorkingCalendar {
 const input = value === undefined ? defaultCalendar : object(value)
 need(Array.isArray(input.weekdays) && input.weekdays.length > 0 && input.weekdays.length <= 7 && input.weekdays.every(d => Number.isInteger(d) && d >= 0 && d <= 6), 'Choose working weekdays (0 Sunday through 6 Saturday)')
 need(Number.isInteger(input.start_hour) && Number.isInteger(input.end_hour) && Number(input.start_hour) >= 0 && Number(input.end_hour) <= 24 && Number(input.end_hour) > Number(input.start_hour), 'Working hours must be whole local hours from 0 through 24 in the job time zone')
 need(Array.isArray(input.holidays) && input.holidays.length <= 366 && input.holidays.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d), 'Holidays must be valid YYYY-MM-DD dates (up to 366)')
 const zoneName = timeZone(zone)
 return { weekdays: [...new Set(input.weekdays as number[])].sort(), start_hour: Number(input.start_hour), end_hour: Number(input.end_hour), holidays: [...new Set(input.holidays as string[])].sort(), ...(zoneName === 'UTC' ? {} : { time_zone: zoneName }) }
}
const zoneOf = (c: WorkingCalendar) => c.time_zone ?? 'UTC'
/** Working hours are local wall-clock hours on local dates, so a daylight-saving change moves their UTC instants, never their local times. */
function bounds(t: number, c: WorkingCalendar) {
 const zone = zoneOf(c), date = wallClock(t, zone).date
 return { open: zonedInstant(date, c.start_hour * 60, zone), close: zonedInstant(date, c.end_hour * 60, zone), working: c.weekdays.includes(new Date(date + 'T00:00:00Z').getUTCDay()) && !c.holidays.includes(date), next: zonedInstant(nextDate(date), 0, zone) }
}
/** Finish-to-start scheduling uses working minutes in the job's displayed time zone. */
export function nextWork(t: number, c: WorkingCalendar): number {
 for (let days = 0; days < 3700; days++) {
  const b = bounds(t, c)
  if (b.working && t < b.close) return Math.max(t, b.open)
  t = b.next
 }
 throw new Error('Working calendar horizon exceeded')
}
export function addWork(t: number, minutes: number, c: WorkingCalendar): number {
 t = nextWork(t, c)
 for (let days = 0; days < 3700; days++) {
  const b = bounds(t, c), available = (b.close - t) / MINUTE
  if (minutes <= available) return t + minutes * MINUTE
  minutes -= available; t = nextWork(b.next, c)
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
  t = dayStart(t, zoneOf(c)) - 1
 }
 throw new Error('Working calendar horizon exceeded')
}
export function workingMinutes(start: number, end: number, c: WorkingCalendar): number {
 let total = 0
 for (let t = dayStart(start, zoneOf(c)), days = 0; t < end && days < 3700; days++) {
  const b = bounds(t, c)
  if (b.working) total += Math.max(0, Math.min(end, b.close) - Math.max(start, b.open)) / MINUTE
  t = b.next
 }
 return total
}
