import { defineTool, type ToolDefinition } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall, nativeVersion, safe } from './native'
import { recordClasses } from './classes'

/** This adapter has no raw-source, consent, booking, sending or service-decision verb. */
export function closeoutTools(env: Bindings): ToolDefinition[] {
 const id = { type: 'string', minLength: 1, maxLength: 100 }
 return [false, true].map(write => {
  const fields = ['digest', 'request_id', 'kind', 'requirement_ids', 'proposed_owner', 'message', 'proposed_window']
  const path = (args: Record<string, unknown>) => 'jobs/' + encodeURIComponent(String(args.job_id)) + '/agent-closeout/' + encodeURIComponent(String(args.record_id ?? 'latest'))
  const input = (args: Record<string, unknown>) => Object.fromEntries(Object.entries((args.input ?? {}) as Record<string, unknown>).filter(([key]) => fields.includes(key)))
  return defineTool({ name: 'plinth.closeout.' + (write ? 'followup' : 'read'), title: write ? 'Prepare an unsent closeout follow-up' : 'Read owner-reviewed closeout evidence',
   description: 'Only an exact, current, owner-reviewed private packet. Missing evidence and unresolved repairs remain open. No certification, coverage interpretation, send, booking, release or closure.',
   scope: write ? 'drafts:write' : 'drafts:read', readOnly: !write, clauses: ['AGENT-006'], classes: ['standard', 'sensitive'], untrusted: true,
   inputSchema: { type: 'object', properties: { job_id: id, record_id: id, ...(write ? { expected_version: { type: 'integer', minimum: 1 }, input: { type: 'object', properties: Object.fromEntries(fields.map(key => [key, {}])), additionalProperties: false } } : {}) }, required: ['job_id', ...(write ? ['record_id', 'input'] : [])] },
   outputSchema: { type: 'object', properties: { record: {}, version: { type: 'integer' } }, required: ['record', 'version'], additionalProperties: false },
   async classify(args, ctx) { const packet = await nativeCall(env, ctx.person, path(args), 'GET', undefined, ctx); return recordClasses(safe({ packet: packet.record, input: input(args) })) },
   revision(args, ctx) { return nativeVersion(env, ctx.person, String(args.job_id)) },
   async summary(args, ctx) { const value = await nativeCall(env, ctx.person, path(args), 'GET', undefined, ctx), record = value.record as { id: string; title: string }, proposed = input(args); return { target: { id: record.id, name: record.title }, items: ['Unsent closeout follow-up only', ...['kind','proposed_owner','message','proposed_window'].flatMap(key => typeof proposed[key] === 'string' ? [String(proposed[key])] : [])] } },
   async run(args, ctx) {
    const result = await nativeCall(env, ctx.person, path(args) + (write ? '/drafts' : ''), write ? 'POST' : 'GET', write ? { ...input(args), expected_version: args.expected_version ?? await nativeVersion(env, ctx.person, String(args.job_id)) } : undefined, ctx)
    return { result: { record: safe(result.record), version: result.version } }
   },
  })
 })
}
