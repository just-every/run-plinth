import { useEffect, useState } from 'react'
import type { Job } from '../plinth/model'
import { api, cents, Form, money } from './shared'
import { CustomRoles } from './roles'

type Member = { id: string; email: string; name: string; role: string; role_name?: string; role_id?: string; version?: number; job_ids?: string[]; po_limit_cents?: number }
type CustomRole = { id: string; name: string }
/** ROLE-001 and ROLE-002: the owner narrows an administrator to a preset for chosen jobs (project manager with a PO approval limit, estimator, superintendent or crew), or back. */
const presets: Record<string, string> = { project_manager: 'Project manager', estimator: 'Estimator', superintendent: 'Superintendent', crew: 'Crew' }
export function TeamRoles({ jobs }: { jobs: Job[] }) {
  const [team, setTeam] = useState<Member[]>([]), [custom, setCustom] = useState<CustomRole[]>([])
  const load = () => api('/team').then(r => setTeam(r.team)).catch(() => setTeam([]))
  const loadRoles = () => api('/roles').then(r => setCustom(r.roles)).catch(() => setCustom([]))
  useEffect(() => { load(); loadRoles() }, [])
  const staff = team.filter(m => m.role !== 'owner')
  return <><section className="card narrow" aria-labelledby="team-title"><h2 id="team-title">Roles and job assignments</h2>
    <ul className="rows">{team.map(m => <li className="row" key={m.id}><div className="row-main"><strong>{m.name || m.email}</strong><span>{m.role === 'project_manager' ? `Project manager · ${(m.job_ids ?? []).length} job(s) · PO limit ${money(m.po_limit_cents)}` : m.role === 'custom' ? `${m.role_name ?? 'Custom role'} · custom role${m.job_ids?.length ? ` · ${m.job_ids.length} job(s)` : ''}` : presets[m.role] ? `${presets[m.role]} · ${(m.job_ids ?? []).length} job(s)` : m.role === 'owner' ? 'Owner' : 'Administrator'}</span></div></li>)}</ul>
    {staff.length ? <Form submit="Save role" action={async f => { const m = staff.find(x => x.id === f.get('person'))!; const choice = String(f.get('role')), isCustom = choice.startsWith('custom:'); await api(`/team/${m.id}`, { expected_version: m.version ?? 0, role: isCustom ? 'custom' : choice, ...(isCustom ? { role_id: choice.slice(7) } : {}), job_ids: f.getAll('jobs'), po_limit_cents: cents(f.get('limit') || '0') }, 'PUT'); await load() }}>
      <div className="fields"><label>Person<select name="person">{staff.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}</select></label>
        <label>Role<select name="role">{Object.entries(presets).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="admin">Administrator</option>{custom.map(r => <option key={r.id} value={`custom:${r.id}`}>{r.name} (custom)</option>)}</select></label>
        <label>Assigned jobs<select name="jobs" multiple>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
        <label>PO approval limit (USD, project managers only)<input name="limit" inputMode="decimal" /></label></div>
    </Form> : <p className="hint">Invite an administrator first, then give them a role and jobs here.</p>}
  </section><CustomRoles onChange={loadRoles} /></>
}
