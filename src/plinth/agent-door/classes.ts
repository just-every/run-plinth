import type { ClassAndFacts } from '../../modules/agent-door/index.ts'

/** These detectors inspect actual content; supplied risk labels are never consulted. */
export function protectedContent(value: unknown): boolean {
 if (typeof value==='string') return /\b\d{3}-\d{2}-\d{4}\b|\b(?:bank account|routing number|social security|patient diagnosis|individual payroll)\s*[:#]/i.test(value)
 if(Array.isArray(value)) return value.some(protectedContent)
 if(value&&typeof value==='object') return Object.entries(value).some(([key,item])=> /^(?:ssn|tax_id|bank_account|routing_number|card_number|payroll_number)$/.test(key) && !!item || protectedContent(item))
 return false
}
export function recordClasses(value: unknown): ClassAndFacts[] {
 return protectedContent(value) ? [{class:'sensitive',facts:{measure:1,kind:'protected record content'}}] : [{class:'standard',facts:{measure:1}}]
}
