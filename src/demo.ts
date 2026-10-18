import type { Bindings } from './auth.server'
import type { Actor } from './plinth/model'
import { demoJobs } from './demo/jobs'

/** Fresh local and hosted workspaces use real Plinth records, without network IO. */
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }): Promise<void> {
  const owner = await env.DB.prepare("SELECT id, version FROM oa_operators WHERE email=? AND role='owner'").bind(ownerEmail.toLowerCase()).first<{ id: string; version: number }>()
  if (!owner) throw new Error('The demo owner does not exist yet')
  const name = 'Erik Lindgren'
  await env.DB.prepare('UPDATE oa_operators SET display_name=? WHERE id=?').bind(name, owner.id).run()
  const actor: Actor = { id: owner.id, email: ownerEmail.toLowerCase(), name, role: 'owner', version: owner.version }
  const jobs = await demoJobs(env.DB, actor, now)
  await env.DB.batch([
    ...jobs.map(job => env.DB.prepare('INSERT INTO pl_jobs(id,version,data) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(job.id, job.version, JSON.stringify(job))),
    env.DB.prepare('INSERT INTO oa_first_run(singleton,completed_by,completed_at) VALUES(1,?,?) ON CONFLICT(singleton) DO NOTHING').bind(owner.id, now.getTime() - 35 * 86_400_000),
  ])
}
