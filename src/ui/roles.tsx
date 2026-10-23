import { useEffect, useState } from 'react'
import { api, Action, cents, Field, Form, money } from './shared'
import { features, actions, type Matrix, type Role } from '../plinth/role-model'

type Preset = { id: string; name: string; locked?: boolean }
const label = (value: string) => value.replace(/^./, c => c.toUpperCase())
/** ROLE-006: copy a preset, rename it and switch view, create, edit, delete and approve for each feature area. */
export function CustomRoles({ onChange }: { onChange?: () => void }) {
  const [presets, setPresets] = useState<Preset[]>([]), [roles, setRoles] = useState<(Role & { assigned: number })[]>([]), [error, setError] = useState('')
  const load = () => api('/roles').then(r => { setPresets(r.presets); setRoles(r.roles); setError(''); onChange?.() }).catch(e => setError(e.message))
  useEffect(() => { load() }, [])
  return <section className="card" aria-labelledby="roles-title"><h2 id="roles-title">Custom roles</h2>
    <p className="card-lead">Copy a preset, rename it and switch what it may view, create, edit, delete and approve in each area. A role can only narrow what the copied preset’s screens allow, and you cannot switch on a permission you do not hold. Changes apply to everyone in the role on their next request and are recorded in the audit history.</p>
    {error && <p role="alert">{error}</p>}
    {roles.map(role => <RoleEditor key={role.id + role.version} role={role} reload={load} />)}
    {roles.length === 0 && <p className="muted">No custom roles yet.</p>}
    <Form submit="Create role from preset" action={async f => { await api('/roles', { copy_of: f.get('copy_of'), name: f.get('name') }); await load() }}>
      <div className="fields"><label>Copy preset<select name="copy_of">{presets.filter(p => !p.locked).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><Field label="New role name" name="name" maxLength={80} /></div>
    </Form></section>
}
function RoleEditor({ role, reload }: { role: Role & { assigned: number }; reload: () => Promise<unknown> | void }) {
  const [matrix, setMatrix] = useState<Matrix>(role.permissions)
  return <details className="record"><summary>{role.name} · copy of {label(role.copy_of.replace('_', ' '))} · {role.assigned} {role.assigned === 1 ? 'person' : 'people'}</summary>
    <Form reset={false} submit="Save role" action={async f => { await api(`/roles/${role.id}`, { expected_version: role.version, name: f.get('name'), permissions: matrix, financial_visible: f.get('financial') === 'on', po_limit_cents: String(f.get('limit') ?? '').trim() ? cents(f.get('limit')) : null }, 'PUT'); await reload() }}>
      <Field label="Role name" name="name" defaultValue={role.name} maxLength={80} />
      <div className="table-scroll"><table className="lines"><caption className="visually-hidden">{role.name} permissions</caption><thead><tr><th scope="col">Area</th>{actions.map(a => <th scope="col" key={a}>{label(a)}</th>)}</tr></thead>
        <tbody>{features.map(feature => <tr key={feature}><th scope="row">{label(feature)}</th>{actions.map(action => <td key={action}><input type="checkbox" aria-label={`${label(feature)} ${action}`} checked={matrix[feature][action]} onChange={e => setMatrix({ ...matrix, [feature]: { ...matrix[feature], [action]: e.target.checked } })} /></td>)}</tr>)}</tbody></table></div>
      <label><input name="financial" type="checkbox" defaultChecked={role.financial_visible} />Financial visibility: cost, margin, markup and pay rates</label>
      <Field label={`Purchase order approval limit (USD; blank for none${role.po_limit_cents !== null ? `, now ${money(role.po_limit_cents)}` : ''})`} name="limit" required={false} inputMode="decimal" defaultValue={role.po_limit_cents === null ? '' : (role.po_limit_cents / 100).toFixed(2)} />
    </Form>
    {role.assigned === 0 && <Action className="danger-button" action={async () => { await api(`/roles/${role.id}`, { expected_version: role.version }, 'DELETE'); await reload() }}>Delete role</Action>}
  </details>
}
