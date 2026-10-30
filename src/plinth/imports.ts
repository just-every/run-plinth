import type { Bindings } from '../auth.server'
import {
  applyD1ImportBatches, createD1ImportJob, planD1Import, readD1ImportJob,
  readD1ImportUndoReport, readD1ErasureJournal, readD1ImportOriginals, resumeD1Import, undoD1Import, rollbackD1Import,
  type D1ImportContext,
} from '../modules/import-kit/src/d1/index.ts'
import { authorize, requireOwner } from './auth.ts'
import { DomainError, need } from './model.ts'
import { acceptedJobsSource, sourceDeclaration, IMPORT_VERSION, IMPORT_LIMITS } from './import-source.ts'
import { acceptedJobsMapping } from './import-mapping.ts'
import { importContext } from './import-context.ts'
import { coverageReport, importCoverage } from './import-coverage.ts'
import { readWorkbook, workbookInspection, workbookSource } from './workbook-import.ts'
import { auditStatement } from './audit.ts'

const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
async function body(request: Request): Promise<Record<string, unknown>> {
  need(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'Send application/json', 415)
  // Bound the actual stream as well as Content-Length; JSON escaping may expand CSV.
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  need(reader, 'Request body is required')
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > IMPORT_LIMITS.bytes * 6 + 1024) { await reader.cancel(); throw new DomainError('upload_too_large', 'Import request is too large', 413) }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new DomainError('invalid_json', 'Provide a JSON object') }
  need(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Provide a JSON object')
  return parsed as Record<string, unknown>
}
async function journal(context: D1ImportContext) {
  const db = context.storage.database
  const current = context.authorization.predicate('read', context.destination)
  const check = () => db.prepare(`SELECT CASE WHEN (${current.sql}) THEN 1 ELSE json('IMPORT_ATOMIC_GUARD') END AS ok`).bind(...current.params ?? [])
  const snapshots = await db.batch([
    check(),
    db.prepare('SELECT id,fingerprint,destination,namespace,mapping_version AS mappingVersion,principal_id AS principalId,state,checkpoint,total,fence,error FROM ik_jobs WHERE destination=? AND namespace=? AND principal_id=? ORDER BY rowid DESC LIMIT 100').bind(context.destination, context.namespace, context.authorization.principalId),
    check(),
  ]) as { results: Record<string, unknown>[] }[]
  return snapshots[1].results
}
function errorResponse(error: unknown): Response {
  if (error instanceof DomainError) return respond({ error: error.code, message: error.message, details: error.details }, error.status)
  const message = error instanceof Error ? error.message : ''
  if (/CREDENTIAL_IN_DURABLE_(DATA|URL)|CREDENTIAL_ENCODING_DEPTH_LIMIT/.test(message)) return respond({ error: 'invalid_source', message: 'Remove credentials or credential-bearing URLs from the CSV before importing.' }, 400)
  if (/^IMPORT_(JOB|STREAM)_RETIRED$/.test(message)) {
    const receiptId = (error as Error & { receiptId?: string }).receiptId
    return respond({ error: message, message: 'This import custody was retired during erasure and can no longer resume or undo.', receiptId }, 410)
  }
  const code = /\b(?:IMPORT_[A-Z_]+|REVIEW_FINGERPRINT_MISMATCH|OPERATION_KEY_CONFLICT|NATIVE_EDIT_CONFLICT|TARGET_[A-Z_]+|SOURCE_[A-Z_]+|JOB_BINDING_MISMATCH|STORED_PLAN_CHANGED)\b/.exec(message)?.[0]
  if (code) return respond({ error: code, message: code === 'REVIEW_FINGERPRINT_MISMATCH' ? 'The CSV changed after preview. Preview and approve it again.' : 'The import could not proceed. Reload its journal before taking another action.' }, code === 'IMPORT_JOB_NOT_FOUND' ? 404 : 409)
  if (/CHECK constraint failed|UNIQUE constraint failed|job_erased|FOREIGN KEY constraint failed/.test(message)) return respond({ error: 'conflict', message: 'Data or authority changed. Reload before continuing.' }, 409)
  console.error('Plinth import failed', /^[A-Z][A-Z0-9_]{2,100}(?::|$)/.exec(message)?.[0].replace(/:$/, '') ?? (error instanceof Error ? error.name : 'unknown'))
  return respond({ error: 'import_failed', message: 'The import could not complete. Inspect its journal before continuing.' }, 500)
}

export async function importResponse(request: Request, env: Bindings): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (path !== '/api/plinth/imports' && !path.startsWith('/api/plinth/imports/')) return null
  try {
    const actor = await authorize(request, env)
    requireOwner(actor)
    const context = importContext(env.DB, actor)
    const route = path.slice('/api/plinth/imports'.length)
    if (request.method === 'POST' && ['/workbook/inspect','/workbook/preview','/workbook/commit'].includes(route)) {
      const input = await body(request), book = await readWorkbook(input)
      if (route === '/workbook/inspect') return respond(workbookInspection(book))
      const { source, draft, canAdopt } = workbookSource(book,input)
      const plan = await planD1Import(source,acceptedJobsMapping(actor),context)
      if (route === '/workbook/preview') return respond({draft,canAdopt,fingerprint:plan.fingerprint,source:workbookInspection(book)})
      need(input.fingerprint === plan.fingerprint, 'The workbook or mapping changed. Preview and approve again.',409,'REVIEW_FINGERPRINT_MISMATCH')
      need(canAdopt,'Resolve every rejected row or explicitly exclude it with a reason before adoption',409,'workbook_diagnostics')
      const approved = {...context,reviewedFingerprint:plan.fingerprint,operationKey:`workbook:${book.hash}`}
      const created = await createD1ImportJob(plan,approved)
      const job = created.state === 'queued' || created.state === 'applying' ? await applyD1ImportBatches(created.id,approved) : created
      await env.DB.batch([auditStatement(env.DB,actor,{detail:{job_id:job.id,fingerprint:plan.fingerprint}})])
      return respond({job})
    }
    if (request.method === 'GET' && (route === '' || route === '/')) return respond({ jobs: await journal(context) })
    if (request.method === 'GET' && route === '/erasure-journal') return respond({ entries: await readD1ErasureJournal(context) })
    if (request.method === 'POST' && (route === '/preview' || route === '/commit')) {
      const input = await body(request)
      need(typeof input.csv === 'string', 'csv must be a string')
      need(input.mappingRevision === undefined || input.mappingRevision === IMPORT_VERSION, 'Mapping revision changed. Preview the current mapping again.', 409, 'REVIEW_FINGERPRINT_MISMATCH')
      let parsed
      try { parsed = acceptedJobsSource(input.csv, sourceDeclaration(input.declaration)) }
      catch (error) {
        if (error instanceof DomainError && error.code === 'invalid_csv' && (error.details as any)?.inspection) return respond({ error: error.code, message: error.message, coverage: coverageReport((error.details as any).inspection) }, 400)
        throw error
      }
      const { source, rows, inspection } = parsed
      let plan = await planD1Import(source, acceptedJobsMapping(actor), context)
      // Recognize unchanged intake approved before coordinate reporting existed.
      // Only an exact retained operation may use that older representation.
      if (!inspection.declaration) {
        const legacy = await planD1Import(acceptedJobsSource(input.csv, undefined, true).source, acceptedJobsMapping(actor), context)
        const previous = await env.DB.prepare('SELECT id FROM ik_jobs WHERE operation_key=? AND destination=? AND namespace=? AND principal_id=?').bind('accepted-jobs:' + legacy.fingerprint, context.destination, context.namespace, context.authorization.principalId).first()
        if (previous) plan = legacy
      }
      if (route === '/preview') return respond({ fingerprint: plan.fingerprint, counts: plan.counts, diagnostics: plan.diagnostics, rows, coverage: await importCoverage(context, { plan, inspection }), adoption: 'draft', limits: IMPORT_LIMITS })
      need(typeof input.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(input.fingerprint), 'Approve the preview fingerprint before importing')
      need(input.fingerprint === plan.fingerprint, 'The CSV changed after preview. Preview and approve it again.', 409, 'REVIEW_FINGERPRINT_MISMATCH')
      const prior = await env.DB.prepare('SELECT id FROM ik_jobs WHERE operation_key=? AND destination=? AND namespace=? AND principal_id=?').bind('accepted-jobs:' + plan.fingerprint, context.destination, context.namespace, context.authorization.principalId).first()
      if (!prior) {
        const coverage = await importCoverage(context, { plan, inspection })
        if (coverage.rows.some(row => row.disposition === 'conflict' || row.disposition === 'erased')) return respond({ error: 'SOURCE_CONFLICT', message: 'Existing source or native work conflicts. No rows were imported; inspect coverage.', coverage }, 409)
      }
      const approved = { ...context, reviewedFingerprint: input.fingerprint, operationKey: `accepted-jobs:${input.fingerprint}` }
      const created = await createD1ImportJob(plan, approved)
      const job = created.state === 'queued' || created.state === 'applying' ? await applyD1ImportBatches(created.id, approved) : created
      await env.DB.batch([auditStatement(env.DB, actor, { detail: { job_id: job.id, fingerprint: input.fingerprint } })])
      return respond({ job })
    }
    const match = /^\/([^/]+)(?:\/(resume|undo|rollback|originals|report|coverage))?$/.exec(route)
    if (match) {
      const id = decodeURIComponent(match[1]), action = match[2]
      if (request.method === 'GET' && !action) return respond({ job: await readD1ImportJob(id, context) })
      if (request.method === 'GET' && action === 'coverage') return respond({ coverage: await importCoverage(context, { id }) })
      if (request.method === 'GET' && action === 'originals') return respond({ originals: await readD1ImportOriginals(id, context) })
      if (request.method === 'GET' && action === 'report') return respond({ report: await readD1ImportUndoReport(id, context) })
      if (request.method === 'POST' && action === 'resume') { const job = await resumeD1Import(id, context); await env.DB.batch([auditStatement(env.DB, actor, { subject_id: id })]); return respond({ job }) }
      if (request.method === 'POST' && (action === 'undo' || action === 'rollback')) {
        const job = action === 'undo' ? await undoD1Import(id, context) : await rollbackD1Import(id, context)
        await env.DB.batch([auditStatement(env.DB, actor, { subject_id: id })])
        return respond({ job, report: await readD1ImportUndoReport(id, context) })
      }
    }
    return respond({ error: 'not_found', message: 'Import route not found' }, 404)
  } catch (error) { return errorResponse(error) }
}
