import { catalogEffect } from './workbook-catalog'
import { canonicalJson, sha256, type ImportMapping } from '../modules/import-kit/src/d1/index.ts'
import type { Actor, Job, Stamp } from './model.ts'
import type { WorkbookDraft } from './workbook-import.ts'
import { IMPORT_NAMESPACE, IMPORT_VERSION, type AcceptedJobRow } from './import-source.ts'

/** Source acceptance is evidence only. Every imported quote remains a draft.
 * Kit reserves the target kind "job" for executable work; this native record
 * is a construction project and never activates application lifecycle effects. */
export function acceptedJobsMapping(actor: Actor): ImportMapping { return {
  version: IMPORT_VERSION,
  map(record) {
    if(record.kind==='opening-ledger')return {effects:[],unmapped:[{reason:'Supplied ledger retained for exact financial reconciliation; not a second financial posting'}]}
    if(record.kind==='cost-workbook'){
      const payload=record.payload as unknown as {target_job:Job;draft:WorkbookDraft;expected_version:number}
      return {effects:[{targetKind:'cost-workbook',targetId:payload.target_job.id+':'+record.artifactHash,value:{data:canonicalJson(payload.target_job as unknown as import('../modules/import-kit/src/d1/index').Json),version:payload.target_job.version,expected_version:payload.expected_version}}]}
    }
    if(record.kind==='catalog-workbook')return {effects:[catalogEffect(record.payload as unknown as WorkbookDraft,actor,record.sourceId)]}
    if (record.kind === 'coded-workbook') {
      const draft = record.payload as unknown as WorkbookDraft
      const id = `import-${sha256(`${IMPORT_NAMESPACE}:${record.sourceId}`).slice(0,32)}`
      const source: Stamp = { id: `source:${record.artifactHash}`, name: 'Reviewed workbook source', role: 'agent', at: 'source-undated' }
      const job: Job = { id,version:1,name:draft.name,client_email:draft.client_email,address:draft.address,status:'quoting',created_by:source,currency:draft.currency,
        quotes:[{id:`${id}-quote`,revision:1,lines:draft.lines,total_cents:draft.total_cents,...(draft.cost_total_cents===undefined?{}:{cost_total_cents:draft.cost_total_cents}),status:'draft',notes:'Imported coded estimate. Native approval is required before work or financial adoption.',prepared_by:source}],
        schedules:[],diary:[],variations:[],orders:[],claims:[],approvals:[],
        import_evidence:{format:'coded-workbook-v1',artifact_sha256:record.artifactHash,source_name:draft.source_name,mapping:draft.mapping,provenance:draft.provenance,diagnostics:draft.diagnostics,source_totals:draft.source_totals,acceptance_verified:false,reviewed_by:{id:actor.id,name:actor.name,role:actor.role}},
      }
      return {effects:[{targetKind:'construction-project',targetId:id,value:{data:canonicalJson(job),version:1,attachments:[]}}]}
    }
    const row = record.payload as unknown as AcceptedJobRow
    const id = `import-${sha256(`${IMPORT_NAMESPACE}:${row.external_id}`).slice(0, 32)}`
    const source: Stamp = { id: `source:${IMPORT_NAMESPACE}`, name: 'CSV source (unverified)', role: 'agent', at: row.accepted_on }
    const amount = Number(row.quote_cents)
    const job: Job = {
      id, version: 1, name: row.title, client_email: row.client_email.toLowerCase(), address: row.site_address,
      status: 'quoting', created_by: source,
      quotes: [{ id: `${id}-quote`, revision: 1, lines: [{ description: row.title, quantity: 1, unit_cents: amount, total_cents: amount }], total_cents: amount, notes: 'Imported source amount. Review and explicitly accept this quote before starting work.', status: 'draft', prepared_by: source }],
      schedules: [], diary: [], variations: [], orders: [], claims: [], approvals: [], ...(row.currency === 'AUD' ? { currency: 'AUD' as const } : {}),
      import_evidence: { format: IMPORT_NAMESPACE, external_id: row.external_id, accepted_on: row.accepted_on, quote_cents: amount, ...(row.currency ? { currency: row.currency } : {}), acceptance_verified: false, artifact_sha256: record.artifactHash, reviewed_by: { id: actor.id, name: actor.name, role: actor.role } },
    }
    return { effects: [{ targetKind: 'construction-project', targetId: id, value: { data: canonicalJson(job), version: 1, attachments: [] } }], unmapped: [{ field: 'accepted_on', reason: 'Source acceptance is preserved as unverified evidence; native quote acceptance requires a person.' }] }
  },
} }
