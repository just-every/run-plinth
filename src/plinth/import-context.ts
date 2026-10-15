import type { D1ImportContext, D1Database as KitDatabase } from '../modules/import-kit/src/d1/index.ts'
import { actorPredicate, requireOwner } from './auth.ts'
import type { Actor } from './model.ts'
import { IMPORT_NAMESPACE, IMPORT_VERSION } from './import-source.ts'
import { importTargets } from './import-targets.ts'

/** Role identity survives archive restore; every transaction still checks the
 * actual current owner session, actor version, revocation and expiry in D1. */
export function importContext(db: D1Database, actor: Actor, extra: Partial<D1ImportContext> = {}): D1ImportContext {
  requireOwner(actor)
  return {
    destination: 'plinth-jobs', namespace: IMPORT_NAMESPACE, mappingVersion: IMPORT_VERSION,
    batchSize: 1, maxBatches: 10, reversalPolicy: 'preserve-conflicts',
    storage: { database: db as unknown as KitDatabase, targets: importTargets },
    authorization: { principalId: 'role:owner', predicate(_action, destination) {
      if (destination !== 'plinth-jobs') throw new Error('IMPORT_DESTINATION')
      const current = actorPredicate(actor)
      return { sql: `(${current.sql}) AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active')`, params: [...current.params, actor.id] }
    } },
    ...extra,
  }
}
