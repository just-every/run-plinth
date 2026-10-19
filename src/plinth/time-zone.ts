import { need } from './model'

const DAY = 86_400_000
const formats = new Map<string, Intl.DateTimeFormat>()
function format(zone: string) {
 let f = formats.get(zone)
 if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); formats.set(zone, f) }
 return f
}
/** An IANA time zone name, stored in its canonical spelling (for example America/New_York). */
export function timeZone(value: unknown, name = 'time_zone'): string {
 need(typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value), `${name} must be an IANA time zone such as America/Chicago`)
 try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone } catch { need(false, `${name} must be an IANA time zone such as America/Chicago`); throw new Error('unreachable') }
}
/** Wall-clock fields of an instant in a zone. */
export function wallClock(t: number, zone: string) {
 const p = Object.fromEntries(format(zone).formatToParts(new Date(t)).map(x => [x.type, x.value]))
 return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) }
}
/** Offset of the zone from UTC at an instant, in minutes (America/New_York is -300 in winter and -240 in summer). */
export function offsetMinutes(t: number, zone: string): number {
 const w = wallClock(t, zone), [y, m, d] = w.date.split('-').map(Number)
 return Math.round((Date.UTC(y!, m! - 1, d!, w.hour, w.minute, w.second) - Math.floor(t / 1000) * 1000) / 60_000)
}
export const nextDate = (date: string, days = 1) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10)
/** The instant a local wall-clock time occurs on a local date. A time skipped by a
 * daylight-saving gap resolves with the offset in force before the gap (02:30 becomes 03:30). */
export function zonedInstant(date: string, minutes: number, zone: string): number {
 const guess = Date.parse(date + 'T00:00:00Z') + minutes * 60_000
 const a = guess - offsetMinutes(guess, zone) * 60_000, b = guess - offsetMinutes(a, zone) * 60_000
 const exact = [a, b].filter(t => t + offsetMinutes(t, zone) * 60_000 === guess)
 return exact.length ? Math.min(...exact) : Math.max(a, b)
}
/** Local midnight that starts the local date containing t. */
export const dayStart = (t: number, zone: string) => zonedInstant(wallClock(t, zone).date, 0, zone)
