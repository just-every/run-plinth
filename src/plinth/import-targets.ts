import { heldSql } from './holds.ts'
import type { D1Database, D1Sql, D1TargetAdapter, Json, TargetRow } from '../modules/import-kit/src/d1/index.ts'

interface NativeValue { data: string; version: number; attachments: AttachmentSnapshot[] }
interface AttachmentSnapshot { id: string; job_id: string; entry_id: string; name: string; mime: string; checksum: string; size: number; bytes_hex: string }
const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params })
const value = (row: TargetRow) => row.value as unknown as NativeValue
const attachmentColumns = ['id', 'job_id', 'entry_id', 'name', 'mime', 'checksum', 'size', 'bytes_hex'] as const
function scope(destination: string, kind: string) { if (destination !== 'plinth-jobs' || kind !== 'construction-project') throw new Error('IMPORT_TARGET_SCOPE') }
async function read(db: D1Database, destination: string, kind: string, id: string): Promise<TargetRow | undefined> {
  scope(destination, kind)
  const row = await db.prepare('SELECT data,version,import_revision FROM pl_jobs WHERE id=?').bind(id).first<{ data: string; version: number; import_revision: string | null }>()
  if (!row) return undefined
  const { results: attachments } = await db.prepare('SELECT id,job_id,entry_id,name,mime,checksum,size,hex(bytes) AS bytes_hex FROM pl_attachments WHERE job_id=? ORDER BY id').bind(id).all<AttachmentSnapshot>()
  return { destination, targetKind: kind, targetId: id, revision: row.import_revision ?? '', value: { data: row.data, version: row.version, attachments: attachments as unknown as Json[] } }
}
function matchesParts(row: TargetRow | null, destination: string, kind: string, id: string): D1Sql[] {
  scope(destination, kind)
  if (!row) return [sql('NOT EXISTS(SELECT 1 FROM pl_jobs WHERE id=?) AND NOT EXISTS(SELECT 1 FROM pl_attachments WHERE job_id=?)', id, id)]
  const current = value(row)
  const guards = [sql('EXISTS(SELECT 1 FROM pl_jobs WHERE id=? AND data=? AND version=? AND import_revision IS ?) AND (SELECT COUNT(*) FROM pl_attachments WHERE job_id=?)=? AND NOT EXISTS(SELECT 1 FROM pl_erased_jobs WHERE job_id=?)', id, current.data, current.version, row.revision || null, id, current.attachments.length, id)]
  // Each original remains an exact conjunct. Separate statements keep growing
  // room histories below the D1 per-statement binding ceiling during erasure.
  for (const attachment of current.attachments) {
    guards.push(sql(`EXISTS(SELECT 1 FROM pl_attachments WHERE ${attachmentColumns.map(k => `${k === 'bytes_hex' ? 'hex(bytes)' : k}=?`).join(' AND ')})`, ...attachmentColumns.map(k => attachment[k])))
  }
  return guards
}
function matches(row: TargetRow | null, destination: string, kind: string, id: string): D1Sql {
  const guards = matchesParts(row, destination, kind, id)
  return sql(guards.map(g => `(${g.sql})`).join(' AND '), ...guards.flatMap(g => g.params ?? []))
}

/** Native jobs and their import provenance always share one atomic D1 batch. */
export const importTargets: D1TargetAdapter = {
  read, matches, matchesParts,
  write(row) {
    scope(row.destination, row.targetKind)
    const next = value(row)
    if (next.attachments.length) throw new Error('IMPORT_CANNOT_WRITE_ATTACHMENTS')
    return [sql('INSERT INTO pl_jobs(id,version,data,import_revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data,import_revision=excluded.import_revision', row.targetId, next.version, next.data, row.revision), sql('UPDATE pl_clock SET version=version+1 WHERE id=1')]
  },
  /** A job under an owner hold is never retired by an import undo or rollback; the guard fails the whole batch. */
  remove(destination, kind, id) { scope(destination, kind); const held = heldSql('job', id); return [sql(`INSERT INTO pl_guard(ok) SELECT CASE WHEN NOT ${held.sql} THEN 1 ELSE 0 END`, ...held.params), sql('DELETE FROM pl_jobs WHERE id=?', id), sql('DELETE FROM pl_guard'), sql('UPDATE pl_clock SET version=version+1 WHERE id=1')] },
  async list(db, destination) {
    const { results } = await db.prepare('SELECT id FROM pl_jobs WHERE import_revision IS NOT NULL ORDER BY id').all<{ id: string }>()
    const rows: TargetRow[] = []
    for (const { id } of results) rows.push((await read(db, destination, 'construction-project', id))!)
    return rows
  },
  matchesCount(count) { return sql('(SELECT count(*) FROM pl_jobs WHERE import_revision IS NOT NULL)=?', count) },
  async preparePreservedUndo(db, destination, effects) {
    const observations = []
    const guards: D1Sql[] = []
    for (const effect of effects) {
      const { targetKind: kind, targetId: id } = effect.provenance
      const current = await read(db, destination, kind, id) ?? null
      guards.push(...matchesParts(current, destination, kind, id))
      observations.push({ effectId: effect.provenance.id, current, entity: { table: 'pl_jobs', recordId: id } })
    }
    if (!guards.length) {
      const count = await db.prepare('SELECT count(*) AS n FROM pl_jobs WHERE import_revision IS NOT NULL').first<{ n: number }>()
      guards.push(sql('(SELECT count(*) FROM pl_jobs WHERE import_revision IS NOT NULL)=?', count!.n))
    }
    return { observations, dependencies: [], guards }
  },
}
