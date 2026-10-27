export type OfficeHooks = {
 signal: AbortSignal
 check(): void
 progress(message: string): void
 recognizeImage(blob: Blob): Promise<string>
 boundedText(text: string): string
}
export type OfficeResult = { text: string; notes: string[] }

export function fail(message: string): never { throw new Error(`Office extraction: ${message}`) }

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
 result(): OfficeResult {
  return { text: this.hooks.boundedText(this.sections.join('\n\n')), notes: [...this.notes] }
 }
}
