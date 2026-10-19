import { need, sum } from './model'

export interface Rational { numerator: bigint; denominator: bigint }
/** JSON decimals are strings: a binary float never enters measurement arithmetic. */
export function decimal(value: unknown, name: string, positive = true): Rational {
 const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
 need(typeof raw === 'string' && /^\d{1,18}(?:\.\d{1,18})?$/.test(raw), `${name} must be an exact decimal string (up to 18 decimal places) or whole number`)
 const [whole, fraction = ''] = raw.split('.')
 const result = { numerator: BigInt(whole! + fraction), denominator: 10n ** BigInt(fraction.length) }
 need(!positive || result.numerator > 0n, `${name} must be positive`)
 return result
}
export function measurement(value: unknown): string | number {
 const exact = decimal(value, 'quantity')
 need(exact.numerator <= 1_000_000_000n * exact.denominator, 'Quantity exceeds the supported range')
 return typeof value === 'number' ? value : String(value)
}
/** Multiply all factors first, then round half-up once at the line's cent boundary. */
export function lineCents(quantity: string | number, rate: number, conversion?: { numerator: string; denominator: string }): number {
 const q = decimal(quantity, 'quantity'), n = decimal(conversion?.numerator ?? '1', 'Conversion numerator'), d = decimal(conversion?.denominator ?? '1', 'Conversion denominator')
 const numerator = q.numerator * n.numerator * d.denominator * BigInt(rate)
 const denominator = q.denominator * n.denominator * d.numerator
 const rounded = (numerator * 2n + denominator) / (denominator * 2n)
 need(rounded <= 1_000_000_000_000n, 'Line money exceeds the supported range')
 return sum([Number(rounded)])
}
