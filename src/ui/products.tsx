import { productWarnings, type ProductRevision, type SupplierProduct } from '../plinth/product-model'
import type { JobProps } from './job'
import { Badge, cents, dateTime, Field, Form, money } from './shared'

type Snapshot = Omit<ProductRevision, 'cost_quote_cents'> & { product_id: string; cost_quote_cents?: number }
const today = () => new Date().toISOString().slice(0, 10)
const stale = (source: ProductRevision) => source.valid_until < today()

export function ProductSource({ source, jobId, office = false }: { source: Snapshot; jobId: string; office?: boolean }) {
  const url = /^https?:\/\//i.test(source.source_url) ? source.source_url : undefined
  return <div className="record">
    {productWarnings(source as ProductRevision).length>0&&<p className="notice">{productWarnings(source as ProductRevision).join(' · ')}</p>}
    <h4>{source.name} · source revision {source.revision}</h4>
    <img src={`/api/plinth/jobs/${encodeURIComponent(jobId)}/product-images/${encodeURIComponent(source.image.id)}`} alt={source.name} width="180" loading="lazy" />
    <p>Supplier: {source.supplier} · SKU: {source.sku}</p>
    <p>Dimensions: {source.dimensions} · Lead time: {source.lead_days} calendar days</p>
    <p>Captured {source.captured_on} · Valid through {source.valid_until} (UTC)</p>
    <p>Staff-transcribed source URL: {url ? <a href={url} target="_blank" rel="noreferrer">Open supplier source</a> : source.source_url}. Supplier information has not been independently verified.</p>
    {office && <p>Source evidence: {source.evidence}</p>}
    {office && source.cost_quote_cents !== undefined && <p>Supplier cost quote: {money(source.cost_quote_cents)}</p>}
  </div>
}

async function imageUpload(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || !value.size) return undefined
  if (!['image/png', 'image/jpeg'].includes(value.type)) throw new Error('Choose a PNG or JPEG product image.')
  if (value.size > 2 * 1024 * 1024) throw new Error('Product images must be 2 MB or smaller.')
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1]!)
    reader.onerror = () => reject(new Error('Could not read this image. Choose it again.'))
    reader.readAsDataURL(value)
  })
  return { name: value.name, mime: value.type, base64 }
}

function ProductForm({ revision, submit }: { revision?: ProductRevision; submit: (body: Record<string, unknown>) => Promise<unknown> }) {
  return <Form reset={!revision} submit={revision ? 'Capture refreshed revision' : 'Capture product'} action={async f => {
    const image = await imageUpload(f.get('image'))
    if (!revision && !image) throw new Error('Choose a product image for this capture.')
    return submit({ name: f.get('name'), sku: f.get('sku'), supplier: f.get('supplier'), source_url: f.get('source_url'), dimensions: f.get('dimensions'), cost_quote_cents: cents(f.get('cost')), lead_days: Number(f.get('lead_days')), captured_on: f.get('captured_on'), valid_until: f.get('valid_until'), discontinued: f.get('discontinued') === 'on', evidence: f.get('evidence'), ...(image ? { image } : {}) })
  }}>
    <div className="fields">
      <Field label="Product name" name="name" defaultValue={revision?.name} />
      <Field label="Supplier SKU" name="sku" defaultValue={revision?.sku} />
      <Field label="Supplier" name="supplier" defaultValue={revision?.supplier} />
      <Field label="Staff-transcribed product URL" name="source_url" type="url" pattern="https?://.+" defaultValue={revision?.source_url} />
      <Field label="Dimensions and units" name="dimensions" defaultValue={revision?.dimensions} />
      <Field label="Supplier cost quote (USD)" name="cost" inputMode="decimal" defaultValue={revision ? (revision.cost_quote_cents / 100).toFixed(2) : undefined} />
      <Field label="Lead time (calendar days)" name="lead_days" type="number" min="0" step="1" defaultValue={revision?.lead_days} />
      <Field label="Captured on" name="captured_on" type="date" defaultValue={today()} />
      <Field label="Quote valid through (UTC date)" name="valid_until" type="date" defaultValue={revision?.valid_until} />
      <Field label={revision ? 'Replacement image (optional; otherwise retain previous)' : 'Product image (required)'} name="image" type="file" accept="image/png,image/jpeg" required={!revision} />
    </div>
    <p className="muted">PNG or JPEG, at most 2 MB. Transcribe supplier details and record evidence for office review.</p>
    <label>Supplier evidence<textarea name="evidence" required rows={3} defaultValue={revision?.evidence} placeholder="Dated quote reference, supplier contact and source details" /></label>
    <label><input name="discontinued" type="checkbox" defaultChecked={revision?.discontinued} /> Supplier reports this product discontinued</label>
    {revision && <p>A refresh creates a new revision requiring review. Existing estimate and selection snapshots retain their original evidence.</p>}
  </Form>
}

function ProductRecord({ product, job, mutate }: Pick<JobProps, 'job' | 'mutate'> & { product: SupplierProduct }) {
  const current = product.revisions.at(-1)
  if (!current) return null
  const outdated = stale(current), ready = !!current.reviewed_by
  return <article className="record">
    <div className="record-head"><h3>{current.name}</h3><Badge>{current.reviewed_by ? 'Reviewed' : 'Needs review'}</Badge>{outdated && <Badge>Stale</Badge>}{current.discontinued && <Badge>Discontinued</Badge>}</div>
    <ProductSource source={{ ...current, product_id: product.id }} jobId={job.id} office />
    <p className="muted">Captured by {current.prepared_by.name} · {dateTime(current.prepared_by.at)}{current.reviewed_by && <> · Reviewed by {current.reviewed_by.name} · {dateTime(current.reviewed_by.at)}</>}</p>
    {!current.reviewed_by && <Form submit="Review this revision" action={async f => mutate(`/products/${product.id}/review`, { revision_id: current.id, confirm: f.get('confirm') === 'on' })}>
      <label><input type="checkbox" name="confirm" required /> I reviewed this exact product revision, supplier cost quote, lead time and source evidence.</label>
    </Form>}
    {job.status === 'quoting' && <details><summary>Add product to estimate draft</summary>
      <p>Appends one product to the previous quote lines in a new draft revision. Review selling price and cost code before preparing.</p>
      {!ready ? <p className="notice">Review the exact capture before preparing a draft.</p> : <Form submit="Prepare estimate draft with product" action={async f => mutate(`/products/${product.id}/estimate`, { revision_id: current.id, cost_code: f.get('cost_code'), unit_cents: cents(f.get('unit')) })}>
        <div className="fields"><Field label="Estimate cost code" name="cost_code" /><Field label="Unit selling price (USD)" name="unit" inputMode="decimal" /></div>
      </Form>}
    </details>}
    <details><summary>Refresh supplier capture</summary><ProductForm key={current.id} revision={current} submit={body => mutate(`/products/${product.id}/revise`, body)} /></details>
    <details><summary>Revision history ({product.revisions.length})</summary>{[...product.revisions].reverse().map(r => <section key={r.id}>
      <ProductSource source={{ ...r, product_id: product.id }} jobId={job.id} office />
      <p>Revision {r.revision} · {r.reviewed_by ? `Reviewed by ${r.reviewed_by.name} on ${dateTime(r.reviewed_by.at)}` : 'Needs review'}{stale(r) && ' · Stale'}{r.discontinued && ' · Discontinued'}</p>
    </section>)}</details>
  </article>
}

export function Products({ job, mutate }: Pick<JobProps, 'job' | 'mutate'>) {
  return <section className="card">
    <h2>Supplier products and source evidence</h2>
    <p className="card-lead">Capture supplier details, review each revision, then use reviewed sources in estimate drafts or the client room board under Selections.</p>
    {!(job.products?.length) && <p className="empty">No supplier products captured yet.</p>}
    {(job.products ?? []).map(product => <ProductRecord key={product.id} product={product} job={job} mutate={mutate} />)}
    <details><summary>Capture a supplier product</summary><ProductForm submit={body => mutate('/products', body)} /></details>
  </section>
}
