import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import { api, cents, Form, money } from './shared'

type Member = { id: string; email: string; name: string; role: string; version?: number; job_ids?: string[]; po_limit_cents?: number }
/** ROLE-001: the owner makes an administrator a project manager for chosen jobs with a PO approval limit, or back. */
export function TeamRoles({ jobs }: { jobs: Job[] }) {
  const [team, setTeam] = useState<Member[]>([])
  const load = () => api('/team').then(r => setTeam(r.team)).catch(() => setTeam([]))
  useEffect(() => { load() }, [])
  const staff = team.filter(m => m.role !== 'owner')
  return <section className="card narrow" aria-labelledby="team-title"><h2 id="team-title">Roles and job assignments</h2>
    <ul className="rows">{team.map(m => <li className="row" key={m.id}><div className="row-main"><strong>{m.name || m.email}</strong><span>{m.role === 'project_manager' ? `Project manager · ${(m.job_ids ?? []).length} job(s) · PO limit ${money(m.po_limit_cents)}` : m.role === 'owner' ? 'Owner' : 'Administrator'}</span></div></li>)}</ul>
    {staff.length ? <Form submit="Save role" action={async f => { const m = staff.find(x => x.id === f.get('person'))!; await api(`/team/${m.id}`, { expected_version: m.version ?? 0, role: f.get('role'), job_ids: f.getAll('jobs'), po_limit_cents: cents(f.get('limit') || '0') }, 'PUT'); await load() }}>
      <div className="fields"><label>Person<select name="person">{staff.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}</select></label>
        <label>Role<select name="role"><option value="project_manager">Project manager</option><option value="admin">Administrator</option></select></label>
        <label>Assigned jobs<select name="jobs" multiple>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
        <label>PO approval limit (USD)<input name="limit" inputMode="decimal" /></label></div>
    </Form> : <p className="hint">Invite an administrator first, then make them a project manager here.</p>}
  </section>
}
