import { need, type Input, type Job, type Schedule } from './model'

export interface TravelFields { travel_minutes?: number }
export interface TradeConflict {
 job_id: string; job_name: string; schedule_id: string; trade: string; start: string; end: string
 reason: 'overlap' | 'travel'; required_travel_minutes?: number; available_travel_minutes?: number
}
/** Elapsed minutes between sites, independent of working calendars and DST. */
export function travelFields(input: Input, previous?: Schedule): TravelFields {
 const value = input.travel_minutes === undefined ? (previous as (Schedule & TravelFields) | undefined)?.travel_minutes ?? 0 : input.travel_minutes
 need(Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1440, 'Travel buffer must be whole elapsed minutes from 0 to 1440')
 return Number(value) === 0 ? {} : { travel_minutes: Number(value) }
}
export function tradeConflicts(all: Job[], job: Job, row: Schedule): TradeConflict[] {
 if (row.milestone || row.status === 'cancelled') return []
 const result: TradeConflict[] = []
 for (const other of all) for (const booked of other.schedules) {
  if (booked.status !== 'booked' || booked.milestone || other.id === job.id && booked.id === row.id || booked.trade.toLowerCase() !== row.trade.toLowerCase()) continue
  const overlap = booked.start < row.end && booked.end > row.start
  const required = other.id === job.id ? 0 : Math.max((row as Schedule & TravelFields).travel_minutes ?? 0, (booked as Schedule & TravelFields).travel_minutes ?? 0)
  const available = (row.start >= booked.end ? Date.parse(row.start) - Date.parse(booked.end) : Date.parse(booked.start) - Date.parse(row.end)) / 60000
  if (overlap || available < required) result.push({ job_id: other.id, job_name: other.name, schedule_id: booked.id, trade: booked.trade, start: booked.start, end: booked.end, reason: overlap ? 'overlap' : 'travel', ...(!overlap ? { required_travel_minutes: required, available_travel_minutes: available } : {}) })
 }
 return result
}
