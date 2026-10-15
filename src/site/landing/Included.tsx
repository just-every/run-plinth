import { Card } from './Card'
import { Slab } from './Slab'

const items = [
  ['Purchase orders', 'Issue POs and record what arrived.', 'M7 3h10l5 5v18H7zM17 3v6h5M11 13h7M11 17h7'],
  ['Approval history', 'Who prepared and who approved, with the exact record.', 'M4 12a10 10 0 1 1 2 10M4 6v7h7M15 7v8l5 3'],
  ['People & access', 'Clients see only their own jobs.', 'M17 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M7.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M25.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M8 25v-5a6 6 0 0 1 12 0v5M1 24v-5a4 4 0 0 1 6-3M27 24v-5a4 4 0 0 0-6-3'],
  ['Agent drafts', 'Agents prepare drafts; people approve.', 'M21 10V3H5v23h11M9 8h8M9 12h5M14 21l9-10 4 4-10 10-5 1z'],
  ['Export and restore', 'One archive with every job and photo.', 'M7 23a6 6 0 0 1-1-12 8 8 0 0 1 16-1 7 7 0 0 1 0 13M14 25V12m-4 4 4-4 4 4'],
  ['Erase a job', 'Remove a job and its photos for good.', 'M4 7h21M10 7V3h9v4M7 7l1 19h13l1-19M12 11v11M17 11v11'],
]
export function Included() {
  return <section id="included" className="site-included"><p className="site-eyebrow">Also included</p><h2>Everything else a job needs.</h2><Slab className="included-grid">{items.map(([title, description, path]) => <Card key={title}><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg><h3>{title}</h3><p>{description}</p></Card>)}</Slab></section>
}
