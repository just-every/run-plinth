// The demo's one clock: Minneapolis wall time, counted in days from the Monday
// of the week the demo starts (a weekend start rolls to the coming Monday).
// Every booking, log date and record stamp is read from this one anchor.
const DAY = 86_400_000
const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })

/** Minneapolis wall time minus UTC at instant t, in ms. */
function offset(t: number) {
  const p = Object.fromEntries(zone.formatToParts(t).map(part => [part.type, Number(part.value)]))
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - Math.floor(t / 60_000) * 60_000
}

/** [days from Monday, hour, minute] in Minneapolis. */
export type When = [day: number, hour: number, minute?: number]

export function demoCalendar(now: Date) {
  const p = Object.fromEntries(zone.formatToParts(now).map(part => [part.type, Number(part.value)]))
  const today = Date.UTC(p.year!, p.month! - 1, p.day!), weekday = new Date(today).getUTCDay()
  const monday = weekday === 6 ? today + 2 * DAY : weekday === 0 ? today + DAY : today - (weekday - 1) * DAY
  /** The instant of a Minneapolis wall time. */
  const at = ([day, hour, minute = 0]: When) => { const wall = monday + day * DAY + (hour * 60 + minute) * 60_000; return wall - offset(wall - offset(wall)) }
  /** A calendar date, YYYY-MM-DD. */
  const date = (day: number) => new Date(monday + day * DAY).toISOString().slice(0, 10)
  /** "Mon Oct 12", for record text. */
  const named = (day: number) => new Date(monday + day * DAY).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
  return { now: now.getTime(), at, date, named }
}
export type Calendar = ReturnType<typeof demoCalendar>
