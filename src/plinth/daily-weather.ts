import { wallClock } from './time-zone'
import type { Job } from './model'
import type { DailyWeather } from './daily-logs-model'

/** NWS links are constrained to the public provider; unknown or absent observations stay unavailable. */
async function source(url: string) {
 const parsed = new URL(url)
 if (parsed.origin !== 'https://api.weather.gov' || parsed.username || parsed.password) throw Error('Invalid weather source')
 const response = await fetch(parsed, { headers: { accept: 'application/geo+json', 'user-agent': 'Plinth daily weather (https://run-plinth.com)' }, redirect: 'manual', signal: AbortSignal.timeout(8000) })
 if (!response.ok) throw Error('Weather provider unavailable')
 const raw = await response.text()
 if (raw.length > 1_000_000) throw Error('Weather response exceeds supported size')
 return JSON.parse(raw)
}
export async function dailyWeather(job: Job, date: string): Promise<DailyWeather> {
 const site = job.daily_log_settings
 const weather: DailyWeather = { source: 'US National Weather Service', site: site?.label ?? job.address, date, retrieved_at: new Date(Date.now()).toISOString(), status: 'unavailable', observations: [] }
 if (!site) return { ...weather, reason: 'Site coordinates have not been configured in Settings.' }
 try {
  const point = await source(`https://api.weather.gov/points/${site.latitude},${site.longitude}`)
  const stations = await source(point.properties.observationStations)
  const station = stations.features?.[0]?.id
  if (typeof station !== 'string' || !/^https:\/\/api\.weather\.gov\/stations\/[A-Za-z0-9_-]+$/.test(station)) throw Error('No nearby station')
  // A wide UTC window includes the selected local site date, including daylight-saving transitions.
  const day = Date.parse(date + 'T00:00:00Z'), start = new Date(day - 86400000).toISOString(), end = new Date(day + 2 * 86400000).toISOString()
  const url = station + '/observations?' + new URLSearchParams({ start, end, limit: '500' })
  const result = await source(url)
  if (!Array.isArray(result.features) || result.pagination?.next) throw Error('Incomplete observations')
  const observations = result.features.map((feature: any) => feature.properties).filter((p: any) => p && typeof p.timestamp === 'string' && Number.isFinite(Date.parse(p.timestamp)) && wallClock(Date.parse(p.timestamp), job.time_zone ?? 'UTC').date === date).map((p: any) => ({ at: p.timestamp, description: typeof p.textDescription === 'string' ? p.textDescription.slice(0, 300) : '', temperature_c: typeof p.temperature?.value === 'number' && Number.isFinite(p.temperature.value) && p.temperature?.unitCode === 'wmoUnit:degC' ? p.temperature.value : null }))
  if (!observations.length) return { ...weather, station: station.split('/').at(-1), url, reason: 'No NWS observations are available for this site date.' }
  return { ...weather, station: station.split('/').at(-1), url, status: 'available', observations }
 } catch {
  return { ...weather, reason: 'NWS observations could not be retrieved. No weather values were inferred.' }
 }
}
