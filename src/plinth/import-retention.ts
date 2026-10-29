import { sha256, type D1Sql } from '../modules/import-kit/src/d1/index.ts'
import { stored, boundary } from '../modules/import-kit/src/d1/jobs.ts'
import { guard, sql } from '../modules/import-kit/src/d1/database.ts'
import { heldSql, requireNoHold } from './holds.ts'
import { importContext } from './import-context.ts'
import type { Actor, Job } from './model.ts'
import type { HistoryEvidence } from './import-history.ts'

/** A shared source cannot be withdrawn while any of its native jobs is held.
 * Preserve the established affected-artifact policy, including after upgrades;
 * historical sidecars and files are selected by their retained source hashes. */
export async function importRetention(db: D1Database, actor: Actor, job: Job) {
  const context = importContext(db, actor)
  const { results } = await db.prepare('SELECT id,namespace,mapping_version,principal_id FROM ik_jobs WHERE destination=?').bind(context.destination).all<{ id: string; namespace: string; mapping_version: string; principal_id: string }>()
  const retained = []
  for (const row of results) retained.push(await stored(row.id, { ...context, namespace: row.namespace, mappingVersion: row.mapping_version, authorization: { ...context.authorization, principalId: row.principal_id } }, 'erase'))
  const hashes = new Set<string>()
  for (const { plan } of retained) for (const entry of plan.entries) {
    if (!entry.effects.some(effect => effect.targetKind === 'construction-project' && effect.targetId === job.id)) continue
    hashes.add(entry.source.artifactHash)
    const payload = entry.source.payload as { source_history_sha256?: string; source_history?: HistoryEvidence }
    if (payload.source_history_sha256) hashes.add(payload.source_history_sha256)
    for (const file of payload.source_history?.files ?? []) if (file.sha256) hashes.add(file.sha256)
  }
  const guards: D1Sql[] = [guard(sql('(SELECT COUNT(*) FROM ik_jobs WHERE destination=?)=?', context.destination, retained.length))]
  const peers = new Set<string>()
  for (const { job: imported, plan } of retained) {
    guards.push(...boundary(imported, plan, 'erase'))
    if (!plan.source.artifacts.some(artifact => hashes.has(artifact.sha256) && artifact.original?.status === 'available')) continue
    for (const entry of plan.entries) for (const effect of entry.effects) if (effect.targetKind === 'construction-project') peers.add(effect.targetId)
  }
  for (const id of peers) {
    await requireNoHold(db, actor, 'job', id)
    const held = heldSql('job', id)
    guards.push(guard(sql(`NOT ${held.sql}`, ...held.params)))
  }
  return { guards, original: (bytes: Uint8Array) => hashes.has(sha256(bytes)) }
}
