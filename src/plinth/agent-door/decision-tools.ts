import { defineTool } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { nativeCall, nativeVersion, safe } from './native'
import { recordClasses } from './classes'

const id = { type: 'string', minLength: 1, maxLength: 100 }
export function decisionTools(env: Bindings) {
 return (['list', 'read', 'draft'] as const).map(action => {
  const write = action === 'draft'
  const path = (args: Record<string, unknown>) => `jobs/${encodeURIComponent(String(args.job_id))}/decision-graphs` + (action === 'list' ? '' : '/' + encodeURIComponent(String(args.packet_id)))
  return defineTool({
   name: 'plinth.decisions.' + action, title: write ? 'Prepare an unsent decision request' : 'Read owner-reviewed decision evidence',
   description: 'Only explicitly reviewed owner packets. Selected revisions must remain current. No client choice, substitution approval, order authorization, send, acknowledgment or receipt action.',
   scope: write ? 'drafts:write' : 'drafts:read', readOnly: !write, untrusted: true,
   classes: action === 'list' ? ['standard'] : ['standard', 'sensitive'], clauses: ['AGENT-004', 'NATIVE-008'],
   inputSchema: { type: 'object', properties: { job_id: id, ...(action === 'list' ? {} : { packet_id: id }), ...(write ? { request_id: id, expected_version: { type: 'integer', minimum: 1 } } : {}) }, required: ['job_id', ...(action === 'list' ? [] : ['packet_id']), ...(write ? ['request_id'] : [])], additionalProperties: false },
   outputSchema: action === 'list' ? { type: 'object', properties: { packets: { type: 'array' }, version: { type: 'integer' } }, required: ['packets', 'version'] } : { type: 'object', properties: { record: {}, version: { type: 'integer' } }, required: ['record', 'version'] },
   async classify(args, ctx) {
    if (action === 'list') return [{ class: 'standard', facts: { measure: 1 } }]
    const value = await nativeCall(env, ctx.person, path(args), 'GET', undefined, ctx)
    return recordClasses(safe(value.record))
   },
   revision: (args, ctx) => nativeVersion(env, ctx.person, String(args.job_id)),
   async summary(args, ctx) {
    const value = await nativeCall(env, ctx.person, path(args), 'GET', undefined, ctx)
    return { target: { id: String(args.packet_id ?? args.job_id), name: 'Owner-reviewed decision packet' }, items: [write ? 'Prepare a private unsent request; consent unverified' : 'Read selected source evidence', JSON.stringify(safe(value.record ?? value.packets))] }
   },
   async run(args, ctx) {
    const value = await nativeCall(env, ctx.person, path(args) + (write ? '/draft' : ''), write ? 'POST' : 'GET', write ? { request_id: args.request_id, expected_version: args.expected_version ?? await nativeVersion(env, ctx.person, String(args.job_id)) } : undefined, ctx)
    return { result: action === 'list' ? { packets: value.packets, version: value.version } : { record: safe(value.record), version: value.version } }
   },
  })
 })
}
