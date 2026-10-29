// Package subpaths expose the native portability checkpoint implementation.
// @ts-ignore The pinned package's journal subpath is JavaScript without declarations.
import { redactionStatements, invalidateTransfersStatements } from '@runeditrun/rer/modules/portability/journal'
// @ts-ignore The pinned package's fence subpath is JavaScript without declarations.
import { toD1Sql } from '@runeditrun/rer/modules/erasure/fence'
import { retireD1ImportCustody, type D1Sql } from '../modules/import-kit/src/d1/index.ts'
import { importContext } from './import-context.ts'
import type { Actor, Job } from './model.ts'

/** Also handles native-created jobs: the same deletion and restore checkpoint
 * apply whether or not import custody currently references the job. Callers
 * supply native deletion, permanent native tombstone, and their CAS guards. */
export async function retireImportedJob(db: D1Database, actor: Actor, job: Job, nativeStatements: D1Sql[]) {
  const checkpoint = [...await redactionStatements(db), ...await invalidateTransfersStatements(db)].map(toD1Sql) as D1Sql[]
  const values = [job.id, job.client_email]
  return retireD1ImportCustody(
    { target: { kind: 'construction-project', id: job.id }, values },
    nativeStatements,
    importContext(db, actor, { originalErasurePolicy: 'withdraw-all-job-artifacts' }),
    checkpoint,
  )
}
