import { useEffect, useState } from 'react'
import type { Vendor } from '../plinth/vendor-model'
import { currentQualification } from '../plinth/vendor-model'
import { api, Badge, cents, Field, Form, money } from './shared'
import { Page } from './shell'

const lines = (value: FormDataEntryValue | null) => String(value ?? '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
const base64 = async (file: File) => { const bytes = new Uint8Array(await file.arrayBuffer()); let raw = ''; for (const b of bytes) raw += String.fromCharCode(b); return btoa(raw) }

const KINDS = { general_liability: 'General liability', workers_comp: 'Workers comp', auto_liability: 'Auto liability', umbrella: 'Umbrella', license: 'License' } as const
/** SUB-003: received certificates and licenses stay unverified until the owner or a designated reviewer decides. */
function Compliance({ vendor, post }: { vendor: Vendor; post: (path: string, body: Record<string, unknown>) => Promise<void> }) {
  return <>
    <h3>Insurance and licenses</h3>
    <ul>{(vendor.compliance ?? []).map(c => <li key={c.id}>{KINDS[c.kind]} · {c.issuer} {c.reference}{c.limit_cents !== undefined ? ` · limit ${money(c.limit_cents)}` : ''} · {c.effective_on} to {c.expires_on} · {c.review ? `${c.review.decision} by ${c.review.by.name}` : 'Not verified'} · <a href={`/api/plinth/vendors/${vendor.id}/compliance/${c.id}`}>Download</a>
      {!c.review && <Form submit="Record review" action={f => post(`/compliance/${c.id}/review`, { decision: f.get('decision'), note: f.get('note') })}><div className="fields"><label>Decision<select name="decision"><option value="verified">Verified</option><option value="rejected">Rejected</option></select></label><Field name="note" label="How it was checked" /></div></Form>}</li>)}</ul>
    {!!vendor.renewal_requests?.length && <><h4>Renewal requests</h4><ul>{vendor.renewal_requests.map(q => <li key={q.id}>{KINDS[q.kind]}: {q.problem} · {q.delivery}</li>)}</ul></>}
    <Form submit="Store evidence" action={async f => { const file = f.get('document') as File; await post('/compliance', { kind: f.get('kind'), issuer: f.get('issuer'), reference: f.get('reference'), ...(f.get('limit') ? { limit_cents: cents(f.get('limit')) } : {}), endorsements: lines(f.get('endorsements')), effective_on: f.get('effective_on'), expires_on: f.get('expires_on'), document: { name: file.name, base64: await base64(file) } }) }}>
      <div className="fields"><label>Evidence<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><Field name="issuer" label="Carrier or licensing authority" /><Field name="reference" label="Policy or license number" /><Field name="limit" label="Limit (USD)" inputMode="decimal" required={false} /><Field name="endorsements" label="Endorsements" required={false} /><Field name="effective_on" label="Effective" type="date" /><Field name="expires_on" label="Expires" type="date" /><Field name="document" label="Certificate or license (PDF, PNG or JPEG)" type="file" accept="application/pdf,image/png,image/jpeg" /></div>
    </Form>
  </>
}
/** Owner rules: the evidence each trade needs, whether a gap holds or only flags an award, and who may verify. */
function ComplianceRules() {
  const [rules, setRules] = useState<{ version: number; reviewers: string[]; requirements: { trade: string; kind: keyof typeof KINDS; min_limit_cents?: number; enforcement: string }[] }>()
  useEffect(() => { api('/compliance-rules').then(r => setRules(r.rules)).catch(() => {}) }, [])
  if (!rules) return null
  return <section className="card narrow" aria-labelledby="compliance-rules"><h2 id="compliance-rules">Insurance and license rules</h2>
    <ul>{rules.requirements.map((r, i) => <li key={i}>{r.trade === '*' ? 'Every trade' : r.trade}: {KINDS[r.kind]}{r.min_limit_cents !== undefined ? ` of at least ${money(r.min_limit_cents)}` : ''} · {r.enforcement === 'hold' ? 'holds release' : 'flags only'}</li>)}</ul>
    <p>Reviewers besides the owner: {rules.reviewers.join(', ') || 'none'}</p>
    <Form submit="Add requirement" action={async f => { const r = await api('/compliance-rules', { expected_version: rules.version, reviewers: rules.reviewers, requirements: [...rules.requirements, { trade: f.get('trade'), kind: f.get('kind'), enforcement: f.get('enforcement'), ...(f.get('limit') ? { min_limit_cents: cents(f.get('limit')) } : {}) }] }, 'PUT'); setRules(r.rules) }}>
      <div className="fields"><Field name="trade" label="Trade (* for every trade)" /><label>Evidence<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><Field name="limit" label="Minimum limit (USD)" inputMode="decimal" required={false} /><label>When missing<select name="enforcement"><option value="hold">Hold release</option><option value="flag">Flag only</option></select></label></div>
    </Form>
    <Form submit="Save reviewers" action={async f => { const r = await api('/compliance-rules', { expected_version: rules.version, reviewers: lines(f.get('reviewers')), requirements: rules.requirements }, 'PUT'); setRules(r.rules) }}><Field name="reviewers" label="Reviewer emails (administrators)" required={false} defaultValue={rules.reviewers.join(', ')} /></Form>
  </section>
}

/** SUB-001: subcontractor and vendor directory with private rates, W-9 custody and per-trade qualification. */
export function Vendors() {
  const [vendors, setVendors] = useState<Vendor[]>([]), [open, setOpen] = useState(''), [error, setError] = useState('')
  const load = () => api('/vendors').then(r => setVendors(r.vendors)).catch(e => setError(e.message))
  useEffect(() => { load() }, [])
  const selected = vendors.find(v => v.id === open)
  const post = async (path: string, body: Record<string, unknown>) => { await api(`/vendors/${selected!.id}${path}`, { expected_version: selected!.version, ...body }); await load() }
  return <Page title="Subcontractors" lead="Trades, service areas, reviewed rates and W-9s for the companies you award scopes to. Only owners and administrators see rates and tax documents.">
    {error && <p role="alert" className="error">{error}</p>}
    <section className="card narrow" aria-labelledby="add-vendor"><h2 id="add-vendor">Add a company</h2>
      <Form submit="Add company" action={async f => { await api('/vendors', { kind: f.get('kind'), name: f.get('name'), trades: lines(f.get('trades')), service_areas: lines(f.get('areas')), contacts: f.get('contact') ? [{ name: f.get('contact'), email: f.get('email') || '', phone: f.get('phone') || '' }] : [] }); await load() }}>
        <div className="fields"><Field name="name" label="Company name" /><label>Kind<select name="kind"><option value="subcontractor">Subcontractor</option><option value="vendor">Vendor</option></select></label><Field name="trades" label="Trades (comma separated)" /><Field name="areas" label="Service areas" required={false} /><Field name="contact" label="Contact name" required={false} /><Field name="email" label="Contact email" type="email" required={false} /><Field name="phone" label="Contact phone" type="tel" required={false} /></div>
      </Form></section>
    <ComplianceRules />
    <section className="card" aria-labelledby="vendor-list"><h2 id="vendor-list">Directory</h2>{!vendors.length ? <p className="empty">No companies yet.</p> :
      <ul className="rows">{vendors.map(v => <li className="row" key={v.id}><div className="row-main"><button type="button" className="link-button" onClick={() => setOpen(v.id)}>{v.name}</button><span>{v.kind} · {v.trades.join(', ') || 'No trades'}{v.service_areas.length ? ` · ${v.service_areas.join(', ')}` : ''}</span></div><div className="row-end">{v.trades.map(t => <Badge key={t} status={currentQualification(v, t)?.status ?? 'pending'}>{`${t}: ${currentQualification(v, t)?.status ?? 'not reviewed'}`}</Badge>)}</div></li>)}</ul>}</section>
    {selected && <section className="card" aria-labelledby="vendor-detail"><h2 id="vendor-detail">{selected.name}</h2>
      <p>{selected.contacts.map(c => `${c.name}${c.email ? ` · ${c.email}` : ''}${c.phone ? ` · ${c.phone}` : ''}`).join('; ') || 'No contacts'}</p>
      <h3>Qualification</h3>
      <ul>{selected.qualifications.map(q => <li key={q.id}>{q.trade}: {q.status} · {q.reviewed_by.name} · {q.evidence}</li>)}</ul>
      <Form submit="Record qualification decision" action={f => post('/qualifications', { trade: f.get('trade'), status: f.get('status'), evidence: f.get('evidence') })}><div className="fields"><label>Trade<select name="trade">{selected.trades.map(t => <option key={t}>{t}</option>)}</select></label><label>Decision<select name="status"><option value="qualified">Qualified</option><option value="rejected">Rejected</option></select></label><Field name="evidence" label="Evidence reviewed" /></div></Form>
      <h3>Reviewed rates</h3>
      <ul>{selected.rates.map(r => <li key={r.id}>{r.description}: {money(r.cents)} per {r.unit} from {r.effective_on} · {r.reference} · {r.reviewed_by.name}</li>)}</ul>
      <Form submit="Record reviewed rate" action={f => post('/rates', { description: f.get('description'), unit: f.get('unit'), cents: cents(f.get('rate')), effective_on: f.get('effective_on'), reference: f.get('reference'), human_reviewed: f.get('reviewed') === 'on' })}><div className="fields"><Field name="description" label="Rate" /><Field name="unit" label="Unit" placeholder="sq ft" /><Field name="rate" label="USD per unit" inputMode="decimal" /><Field name="effective_on" label="Effective date" type="date" /><Field name="reference" label="Source reference" /></div><label><input type="checkbox" name="reviewed" required /> A person reviewed this rate source</label></Form>
      <Compliance vendor={selected} post={post} />
      <h3>W-9</h3>
      {selected.tax ? <p>{selected.tax.legal_name} · {selected.tax.tin_type} ending {selected.tax.tin_last4} · {selected.tax.verification} · <a href={`/api/plinth/vendors/${selected.id}/w9`}>Download W-9</a></p> : <p>No W-9 on file.</p>}
      <Form submit="Store W-9" action={async f => { const file = f.get('document') as File; await post('/w9', { legal_name: f.get('legal_name'), tin_type: f.get('tin_type'), tin_last4: f.get('tin_last4'), document: { name: file.name, base64: await base64(file) } }) }}><div className="fields"><Field name="legal_name" label="Legal name on W-9" /><label>TIN type<select name="tin_type"><option>EIN</option><option>SSN</option></select></label><Field name="tin_last4" label="Last four TIN digits" inputMode="numeric" maxLength={4} /><Field name="document" label="Signed W-9 (PDF, PNG or JPEG)" type="file" accept="application/pdf,image/png,image/jpeg" /></div></Form>
    </section>}
  </Page>
}
