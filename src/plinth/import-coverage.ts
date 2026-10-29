import { canonicalJson, sha256, type D1ImportContext, type D1Sql, type ImportPlan, type ImportJob } from '../modules/import-kit/src/d1/index.ts'
import { stored, boundary } from '../modules/import-kit/src/d1/jobs.ts'
import { authorize, readAtomic, guard } from '../modules/import-kit/src/d1/database.ts'
import { validatedProvenance, inventoryGuards, custodyGuards } from '../modules/import-kit/src/d1/integrity.ts'
import { exactRows } from '../modules/import-kit/src/d1/sets.ts'
import { sql } from '../modules/import-kit/src/d1/database.ts'
import { inspectAcceptedJobs, IMPORT_VERSION, type CsvInspection } from './import-source.ts'

export type Disposition = 'proposed' | 'imported' | 'duplicate' | 'conflict' | 'invalid' | 'unsupported' | 'blocked' | 'erased' | 'reversed'
export interface CoverageRow {
  row: number | null; externalId?: string; disposition: Disposition; reason: string
  targetId?: string; imported?: boolean; columns?: { field: string; column: number; line: number; character: number; treatment: string }[]
}
const treatments: Record<string, string> = {
  external_id: 'Stable source identity', title: 'Draft job and quote title',
  client_email: 'Job contact only; no account or grant', site_address: 'Job address',
  quote_cents: 'Draft source amount; no ledger posting', accepted_on: 'Unverified historical evidence; no native approval',
  currency: 'Draft job currency',
}
export function coverageReport(inspection: CsvInspection, rows?: CoverageRow[], fingerprint?: string) {
  const headerErrors = inspection.diagnostics.some(d => d.location.row === 1)
  const dispositions: CoverageRow[] = rows ?? inspection.table.map((fields, index) => {
    const diagnostics = inspection.diagnostics.filter(d => d.location.row === index + 2)
    const duplicate = diagnostics.some(d => d.code === 'DUPLICATE_ID')
    return {
      row: index + 2, externalId: inspection.rows[index]?.external_id,
      disposition: duplicate ? 'duplicate' : diagnostics.length ? 'invalid' : headerErrors ? 'unsupported' : 'blocked',
      reason: diagnostics.map(d => d.message).join('; ') || (headerErrors ? 'Unsupported or changed columns; no rows adopted' : 'Entire upload refused; correct diagnostics before approval'),
      columns: fields.map((cell, i) => ({ field: inspection.header[i]?.value ?? '(extra cell)', column: i + 1, line: cell.location.line, character: cell.location.character, treatment: treatments[inspection.header[i]?.value] ?? 'Unsupported; never silently skipped' })),
    }
  })
  const counts = Object.fromEntries((['proposed','imported','duplicate','conflict','invalid','unsupported','blocked','erased','reversed'] as Disposition[]).map(key => [key, dispositions.filter(row => row.disposition === key).length]))
  return {
    format: 'accepted-jobs-csv', mappingRevision: IMPORT_VERSION, fingerprint: fingerprint ?? null,
    artifact: { name: 'accepted-jobs.csv', sha256: inspection.sha256, bytes: inspection.bytes },
    declaration: inspection.declaration ?? null, declarationVerified: false,
    scope: 'Accepted jobs CSV only; attachments, signatures, history and continuing-job adoption are not mapped',
    counts: { total: dispositions.length, ...counts }, diagnostics: inspection.diagnostics,
    fields: inspection.header.map(cell => ({ field: cell.value, ...cell.location, treatment: treatments[cell.value] ?? 'Unsupported; never silently skipped' })),
    rows: dispositions,
  }
}

/** Both preview and retained reports fence current owner authority and the exact
 * native snapshots. The retained view uses the kit's validated, redacted plan. */
export async function importCoverage(context: D1ImportContext, input: { plan: ImportPlan; inspection: CsvInspection } | { id: string }) {
  await authorize(context, 'read')
  let plan: ImportPlan, job: ImportJob | undefined, inspection: CsvInspection | undefined
  const guards: D1Sql[] = []
  if ('id' in input) {
    const retained = await stored(input.id, context)
    plan = retained.plan; job = retained.job
    guards.push(...boundary(job, plan), ...custodyGuards(plan, job.id), ...await inventoryGuards(job, plan, context))
    const artifact = plan.source.artifacts[0]
    // Do not recover withdrawn original bytes from any alternate representation.
    if (artifact.original?.status === 'available') {
      const { Buffer } = await import('node:buffer')
      inspection = inspectAcceptedJobs(Buffer.from(artifact.original.base64, 'base64').toString('utf8'))
    }
  } else { plan = input.plan; inspection = input.inspection }
  const rows: CoverageRow[] = []
  for (const [index, entry] of plan.entries.entries()) {
    if (entry.erased) {
      rows.push({ row: null, disposition: 'erased', reason: 'Custody erased; source values and locations unavailable' })
      continue
    }
    const effect = entry.effects[0], id = effect.targetId, db = context.storage.database
    const claim = await db.prepare('SELECT * FROM ik_sources WHERE identity=?').bind(entry.identity).first<Record<string, unknown>>()
    guards.push(...exactRows('ik_sources', ['identity','source_hash','mapping_version','effects_hash','job_id'], claim ? [claim] : [], sql('identity=?', entry.identity)))
    const native = await context.storage.targets.read(db, context.destination, effect.targetKind, id) ?? null
    guards.push(...(context.storage.targets.matchesParts?.(native, context.destination, effect.targetKind, id) ?? [context.storage.targets.matches(native, context.destination, effect.targetKind, id)]).map(guard))
    const erased = await db.prepare('SELECT job_id FROM pl_erased_jobs WHERE job_id=?').bind(id).first()
    guards.push(guard(sql('(SELECT COUNT(*) FROM pl_erased_jobs WHERE job_id=?)=?', id, erased ? 1 : 0)))
    let disposition: Disposition = 'proposed', reason = 'Would create an inert job and quote draft'
    const imported = !!job && index < job.checkpoint
    if (erased) { disposition = 'erased'; reason = 'Erasure fence refuses source adoption' }
    else if (native || claim) {
      const raw = await db.prepare('SELECT * FROM ik_provenance WHERE source_identity=? AND target_id=? AND reversed=0').bind(entry.identity, id).first()
      const provenance = raw ? await validatedProvenance(raw, context, guards) : undefined
      const sameSource = claim?.source_hash === entry.source.payloadHash && claim?.mapping_version === plan.mappingVersion && claim?.effects_hash === sha256(canonicalJson(entry.effects))
      const unchanged = native && provenance && native.revision === provenance.appliedRevision && sha256(canonicalJson(native.value)) === provenance.valueHash
      if (sameSource && unchanged) {
        disposition = imported && claim.job_id === job!.id ? 'imported' : 'duplicate'
        reason = disposition === 'imported' ? 'Imported draft retained unchanged' : 'Existing identical source; no second native record'
      } else { disposition = 'conflict'; reason = sameSource ? 'Native work changed; retained without overwrite' : 'Source identity or target already exists with different reviewed content' }
    } else if (imported) { disposition = 'reversed'; reason = 'Imported record was reversed; no native record remains' }
    const fields = inspection?.table[index]
    const coordinates = (entry.source.payload as { source_coordinates?: { row: number; columns: { field: string; column: number; line: number; character: number }[] } }).source_coordinates
    const retainedColumns = coordinates?.columns
    rows.push({
      row: coordinates?.row ?? entry.source.location.row ?? index + 2, externalId: entry.source.sourceId, targetId: id, disposition, reason, imported,
      columns: retainedColumns?.map(cell => ({ ...cell, treatment: treatments[cell.field] ?? 'Unsupported' })) ?? fields?.map((cell, i) => ({ field: inspection!.header[i]?.value ?? '', column: i + 1, line: cell.location.line, character: cell.location.character, treatment: treatments[inspection!.header[i]?.value] ?? 'Unsupported' })),
    })
  }
  await readAtomic(context, guards)
  const artifact = plan.source.artifacts[0]
  const fallback: CsvInspection = { sha256: artifact.sha256, bytes: artifact.size, header: [], table: [], rows: [], diagnostics: [] }
  const report = coverageReport(inspection ?? fallback, rows, job?.fingerprint ?? plan.fingerprint)
  const declarations = plan.entries.filter(entry => !entry.erased).map(entry => (entry.source.payload as Record<string, unknown>).source_declaration)
  return {
    ...report, declaration: job?.erasedRecords ? null : declarations[0] ?? report.declaration,
    originalStatus: artifact.original?.status ?? 'unavailable', job: job ? { id: job.id, state: job.state, checkpoint: job.checkpoint, total: job.total } : null,
  }
}
