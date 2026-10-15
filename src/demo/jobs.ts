import { emptyJob, type Actor, type Job } from '../plinth/model'
import { acceptQuote, approveVariation, prepareQuote, prepareVariation } from '../plinth/quotes'
import { prepareSchedule, prepareOrder, issueOrder, receiveOrder } from '../plinth/operations'
import { prepareDiary } from '../plinth/attachments'
import { prepareClaim, approveClaim, exportClaim } from '../plinth/claims'

const day = 86_400_000
const projects = [
  { key: 'ashgrove', name: 'Ashgrove kitchen renovation', client: 'Amelia Hart', email: 'amelia.hart@example.com', address: '24 Banksia Street, Ashgrove QLD', stage: 3, offset: 0 },
  { key: 'paddington', name: 'Paddington bathroom & laundry', client: 'Daniel Nguyen', email: 'daniel.nguyen@example.com', address: '8 Fern Terrace, Paddington QLD', stage: 2, offset: 2 },
  { key: 'wilston', name: 'Wilston deck and pergola', client: 'Sofia Brooks', email: 'sofia.brooks@example.com', address: '61 Grove Road, Wilston QLD', stage: 1, offset: 4 },
  { key: 'redhill', name: 'Red Hill studio fitout', client: 'Oliver Reed', email: 'oliver.reed@example.com', address: '17 Terrace Lane, Red Hill QLD', stage: 0, offset: 6 },
]

/** Build with Plinth's real domain commands; stabilise IDs before persisting. */
export async function demoJobs(db: D1Database, owner: Actor, now: Date): Promise<Job[]> {
  const date = (days: number, hour = 0) => new Date(now.getTime() + days * day).toISOString().slice(0, 10) + `T${String(hour).padStart(2, '0')}:00:00.000Z`
  const result: Job[] = []
  for (const project of projects) {
    const client: Actor = { id: `demo-client-${project.key}`, email: project.email, name: project.client, role: 'member', version: 1 }
    const job = emptyJob({ name: project.name, client_email: client.email, address: project.address }, owner)
    const began = Date.now() - 1000
    function backdate(days: number) {
      function walk(value: any) {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (key === 'at' && typeof child === 'string' && Date.parse(child) >= began) value[key] = date(-days, 6)
          else walk(child)
        }
      }
      walk(job)
    }
    backdate(35)
    const quote = prepareQuote(job, owner, { lines: [
      { description: 'Site preparation, protection and demolition', quantity: 1, unit_cents: 420_000 },
      { description: 'Carpentry, cabinetry and installation', quantity: 1, unit_cents: 1_850_000 },
      { description: 'Electrical and plumbing works', quantity: 1, unit_cents: 680_000 },
      { description: 'Finishes, making good and handover', quantity: 1, unit_cents: 390_000 },
    ], notes: 'Includes materials, labour and GST. Client selections as discussed at the site meeting.' })
    backdate(33)
    if (!project.stage) {
      prepareQuote(job, owner, { lines: [...quote.lines.map(({ description, quantity, unit_cents }) => ({ description, quantity, unit_cents })), { description: 'Additional acoustic insulation to meeting room', quantity: 1, unit_cents: 195_000 }], notes: 'Revision 2 includes acoustic treatment requested by Oliver. Awaiting signed acceptance.' })
      backdate(2)
    } else {
      acceptQuote(job, owner, quote.id, { method: 'signed', evidence: `${project.client} returned the signed quotation; scope and selections confirmed at the pre-start meeting.` })
      backdate(30)
      for (let i = 0; i < 3; i++) {
        prepareSchedule(job, owner, { trade: ['Banksia Carpentry', 'Northside Electrical', 'Clearwater Plumbing'][i], start: date(project.offset + i + 1, 21), end: date(project.offset + i + 2, 3), description: ['Cabinetry and final fit-off', 'Fit-off and test circuits', 'Connect fixtures and pressure test'][i] }, result)
        backdate(7)
      }
      const notes = [
        'Site established and floor protection laid. Client walkthrough confirmed access and material storage. No changes to the agreed scope.',
        'Demolition complete. Existing framing inspected and measurements checked against the joinery shop drawings. Waste collected before close.',
        'Rough-in complete and inspected. Benchtop templating booked; client confirmed the warm white finish for cabinetry.',
        'Joinery delivered and checked against the order. Final fit-off scheduled with the electrician and plumber; handover checklist prepared.',
      ]
      for (let i = 0; i < project.stage + 1; i++) {
        await prepareDiary(db, job, owner, { date: date(-12 + i * 3).slice(0, 10), note: notes[i] })
        backdate(12 - i * 3)
      }
      const variation = prepareVariation(job, owner, { description: 'Client selected stone benchtop upgrade including matching splashback', amount_cents: 285_000 })
      backdate(11)
      approveVariation(job, client, variation.id)
      backdate(10)
      prepareVariation(job, owner, { description: 'Additional under-cabinet lighting requested at the site meeting; awaiting client approval', amount_cents: 78_000 })
      backdate(1)
      const order = prepareOrder(job, owner, { supplier: 'Bluegum Joinery', description: 'Made-to-measure cabinetry and hardware, quote BJ-2417', amount_cents: 1_180_000 })
      backdate(18)
      issueOrder(job, owner, order.id)
      backdate(17)
      receiveOrder(job, owner, order.id, { amount_cents: project.stage === 3 ? 1_180_000 : 590_000, reference: `BJ delivery docket ${project.key.toUpperCase()}-104` })
      backdate(4)
      const fittings = prepareOrder(job, owner, { supplier: 'Trade Supply Co.', description: 'Fixtures and fittings to approved client selection schedule', amount_cents: 245_000 })
      backdate(3)
      if (project.stage > 1) { issueOrder(job, owner, fittings.id); backdate(2) }
      const first = prepareClaim(job, owner, { description: 'Stage 1 · site preparation and rough-in', cumulative_cents: 850_000 })
      backdate(6)
      approveClaim(job, owner, first.id); backdate(5)
      exportClaim(job, owner, first.id); backdate(5)
      const next = prepareClaim(job, owner, { description: 'Stage 2 · joinery and fit-off', cumulative_cents: 2_150_000 })
      backdate(1)
      if (project.stage === 3) { approveClaim(job, owner, next.id); backdate(1) }
    }
    // Replace every generated ID, including snapshot references, consistently.
    const ids = new Map<string, string>([[job.id, `demo-job-${project.key}`]])
    function identify(value: any) {
      if (!value || typeof value !== 'object') return
      if (typeof value.id === 'string' && ![owner.id, client.id].includes(value.id) && !ids.has(value.id)) ids.set(value.id, `demo-${project.key}-${ids.size}`)
      Object.values(value).forEach(identify)
    }
    identify(job)
    const fixed = JSON.parse(JSON.stringify(job), (_key, value) => typeof value === 'string' ? ids.get(value) ?? value : value) as Job
    result.push(fixed)
  }
  return result
}
