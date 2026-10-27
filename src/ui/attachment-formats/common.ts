import type { OfficeHooks, OfficeResult } from '../attachment-office/types'

export const MAX_INPUT = 20 * 1024 * 1024, MAX_PIXELS = 16_000_000
export function fail(message: string): never { throw new Error(`File extraction: ${message}`) }
export const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export class Draft {
 private sections: string[] = []
 readonly notes = new Set<string>()
 constructor(readonly hooks: OfficeHooks) {}
 add(label: string, text: string) {
  this.hooks.check()
  if (!text.trim()) return
  this.sections.push(`${label}\n${text.trim()}`)
  this.hooks.boundedText(this.sections.join('\n\n'))
 }
 result(): OfficeResult { return { text: this.hooks.boundedText(this.sections.join('\n\n')), notes: [...this.notes] } }
}
