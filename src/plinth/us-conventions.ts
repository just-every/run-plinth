import { need, object, text } from './model'

/** USPS codes: the 50 states, DC and the inhabited territories. */
const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI AS MP'.split(' '))
export interface UsAddress { line1: string; line2: string; city: string; state: string; zip: string }
/** A US postal address: two-letter USPS state code and a 5-digit or ZIP+4 code. */
export function usAddress(value: unknown): UsAddress {
 const input = object(value), state = text(input.state, 'state', 2).toUpperCase(), zip = text(input.zip, 'ZIP code', 10)
 need(STATES.has(state), 'state must be a two-letter USPS code such as TX or DC')
 need(/^\d{5}(?:-\d{4})?$/.test(zip), 'ZIP code must be 5 digits or ZIP+4 (12345-6789)')
 return { line1: text(input.line1, 'street address', 200), line2: text(input.line2, 'address line 2', 200, true), city: text(input.city, 'city', 100), state, zip }
}
/** A North American Numbering Plan number in E.164 (+1NXXNXXXXXX), or null when the text is not one.
 * Spaces, dots, dashes, parentheses and a leading +1 or 1 are ignored. */
export function nanp(value: string): string | null {
 if (!/^[\d\s().+-]+$/.test(value)) return null
 const digits = value.replace(/\D/g, ''), local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
 return /^[2-9]\d{2}[2-9]\d{6}$/.test(local) ? `+1${local}` : null
}
export function usPhone(value: unknown, name = 'phone'): string {
 const e164 = nanp(text(value, name, 40)); need(e164, `${name} must be a 10-digit US number such as (512) 555-0142`); return e164
}
export const displayPhone = (e164: string) => `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`
/** Exact sizes in metres (length) and square metres (area): 1 in = 0.0254 m by definition. */
const SIZES: Record<string, { dimension: 'length' | 'area'; size: string }> = {
 'in': { dimension: 'length', size: '0.0254' }, 'ft': { dimension: 'length', size: '0.3048' }, 'yd': { dimension: 'length', size: '0.9144' },
 'mm': { dimension: 'length', size: '0.001' }, 'cm': { dimension: 'length', size: '0.01' }, 'm': { dimension: 'length', size: '1' },
 'sq in': { dimension: 'area', size: '0.00064516' }, 'sq ft': { dimension: 'area', size: '0.09290304' }, 'sq yd': { dimension: 'area', size: '0.83612736' },
 'sq m': { dimension: 'area', size: '1' }, 'm²': { dimension: 'area', size: '1' },
}
/** The exact conversion between two standard US or metric units of the same dimension, or null when either unit is not one of them. */
export function standardConversion(unit: string, rateUnit: string): { numerator: string; denominator: string } | null {
 const from = Object.hasOwn(SIZES, unit) ? SIZES[unit] : undefined, to = Object.hasOwn(SIZES, rateUnit) ? SIZES[rateUnit] : undefined
 return from && to && from.dimension === to.dimension && unit !== rateUnit ? { numerator: from.size, denominator: to.size } : null
}
