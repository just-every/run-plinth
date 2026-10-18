import { emptyJob, type Actor, type Job } from '../plinth/model'
import { acceptQuote, approveVariation, prepareQuote, prepareVariation } from '../plinth/quotes'
import { prepareSchedule, prepareOrder, issueOrder, receiveOrder } from '../plinth/operations'
import { prepareDiary } from '../plinth/attachments'
import { prepareClaim, approveClaim, exportClaim } from '../plinth/claims'

// One remodeler's jobs, the same records the run site tells: Minnehaha
// Design-Build's Job 2214 (Ana Alvarez's second story in Linden Hills) and the
// other jobs on its Minneapolis map. Every date is a weekday counted from the
// Monday of the week the demo starts, so the schedule is always current.
type Booking = [trade: string, work: string, from: number, to: number]
type Project = { key: string; name: string; client: string; email: string; address: string; stage: number; lines: [string, number][]; bookings: Booking[]; logs: [number, string][]; changes: [string, number, boolean][]; orders: [string, string, number, number | null][]; billing: [string, number, 'draft' | 'exported'][]; agentBooking?: Booking }
const projects: Project[] = [
  { key: 'alvarez', name: 'Alvarez second story', client: 'Ana Alvarez', email: 'ana.alvarez@example.com', address: '4417 Drew Avenue South, Minneapolis, MN 55410', stage: 3,
    lines: [['Demolition, shoring and site protection', 3_840_000], ['Framing, sheathing and roof structure', 11_260_000], ['Windows, roofing and exterior envelope', 9_680_000], ['Electrical, plumbing and HVAC', 7_130_000], ['Insulation, drywall and finish carpentry', 6_290_000], ['Tile, paint and finishes', 3_660_000]],
    bookings: [['Peak Electric', 'Electrical rough-in', -7, -3], ['Riverbend Plumbing', 'Plumbing rough-in', -7, -3], ['Halvorsen Roofing', 'Roof dry-in', 0, 3], ['Cedar Insulation', 'Insulation', 3, 4], ['Twin Cities Drywall', 'Drywall', 7, 25], ['Jake Turner crew', 'Window install, 12 units', 9, 11], ['Jake Turner crew', 'Finish carpentry', 28, 37], ['Mendoza Tile', 'Primary bath tile', 42, 46], ['Lake Street Painting', 'Paint and punch list', 49, 56]],
    agentBooking: ['Larkin Exteriors', 'Siding, after the window install', 14, 25],
    logs: [[-7, 'Rough-ins started. Peak Electric and Riverbend Plumbing on site; Ana confirmed the skylight location over the new stair.'], [-5, 'Northfield Window Supply moved the 12 windows 9 days late. Roofing goes first so the house is dried in before the windows; Plinth\'s agent drafted siding to follow the window install, a week later than planned.'], [-3, 'Electrical and plumbing rough-ins complete. Framing inspection booked for Wednesday with the City of Minneapolis, permit BLD-2026-04187.']],
    changes: [['Change order 7 · skylight over the new stair, framed and flashed', 324_000, true], ['Primary bath zellige wall tile over the $3,800.00 allowance', 46_000, false]],
    orders: [['Northfield Window Supply', '12 windows per the window schedule, quote NWS-2214', 3_840_000, null], ['Lakeland Tile Supply', 'PO 2214-31 · zellige wall tile for the primary bath', 426_000, 0]],
    billing: [['Pay apps 1–3 · demolition through framing', 9_641_000, 'exported'], ['Pay app 4 · rough-ins and roof dry-in', 14_235_000, 'draft']] },
  { key: 'nguyen', name: 'Nguyen kitchen', client: 'Daniel Nguyen', email: 'daniel.nguyen@example.com', address: '2208 Fillmore Street NE, Minneapolis, MN 55418', stage: 3,
    lines: [['Demolition and protection', 640_000], ['Cabinetry and installation', 3_120_000], ['Electrical and plumbing', 1_180_000], ['Countertops, backsplash and finishes', 1_460_000]],
    bookings: [['Northstar Stone', 'Countertop template', 1, 1], ['Northside Electric', 'Trim-out and test circuits', 2, 3], ['Clearwater Plumbing', 'Connect fixtures and pressure test', 8, 9]],
    logs: [[-6, 'Cabinets delivered and checked against the order. Countertop template booked with Northstar Stone.'], [-2, 'Upper cabinets hung and leveled. Daniel confirmed the warm white finish.']],
    changes: [['Quartz countertop upgrade including matching backsplash', 285_000, true], ['Under-cabinet lighting requested at the site meeting', 78_000, false]],
    orders: [['Lakeside Cabinet Co.', 'Custom cabinetry and hardware, quote LC-2417', 1_180_000, 1_180_000], ['Trade Supply Co.', 'Fixtures and fittings to the approved selections', 245_000, 0]],
    billing: [['Pay app 1 · demolition and rough-in', 1_850_000, 'exported'], ['Pay app 2 · cabinetry', 3_900_000, 'draft']] },
  { key: 'okafor', name: 'Okafor basement', client: 'Grace Okafor', email: 'grace.okafor@example.com', address: '1734 Highland Parkway, St. Paul, MN 55116', stage: 2,
    lines: [['Framing and egress window', 1_480_000], ['Electrical and plumbing', 1_210_000], ['Drywall, trim and flooring', 1_690_000]],
    bookings: [['Riverbend Plumbing', 'Finish plumbing, basement bath', 1, 2], ['Summit Flooring', 'Luxury vinyl plank', 7, 8]],
    logs: [[-4, 'Drywall finished and sanded. Egress window passed inspection.']],
    changes: [['Add a wet bar rough-in on the north wall', 186_000, true]],
    orders: [['Summit Flooring', 'Luxury vinyl plank, 820 sq ft', 612_000, 306_000]],
    billing: [['Pay app 1 · framing and rough-in', 1_640_000, 'exported']] },
  { key: 'brennan', name: 'Brennan bath', client: 'Sofia Brennan', email: 'sofia.brennan@example.com', address: '618 Valley View Road, Edina, MN 55424', stage: 1,
    lines: [['Demolition and waterproofing', 520_000], ['Shower, tile and glass', 1_840_000], ['Vanity, plumbing and electrical', 960_000]],
    bookings: [['Mendoza Tile', 'Shower walls', 1, 4]],
    logs: [[-3, 'Waterproofing flood test passed. Tile layout approved by Sofia on site.']],
    changes: [], orders: [], billing: [] },
  { key: 'lindqvist', name: 'Lindqvist kitchen', client: 'Marit Lindqvist', email: 'marit.lindqvist@example.com', address: '5012 Pleasant Avenue, Minneapolis, MN 55419', stage: 0,
    lines: [['Design, demolition and protection', 920_000], ['Cabinetry, island and installation', 4_380_000], ['Electrical, plumbing and ventilation', 1_640_000], ['Countertops, tile and finishes', 1_910_000]],
    bookings: [], logs: [], changes: [], orders: [], billing: [] },
]

/** Build with Plinth's real domain commands; stabilise IDs before persisting. */
export async function demoJobs(db: D1Database, owner: Actor, now: Date): Promise<Job[]> {
  const day = 86_400_000
  // A weekend start rolls forward to the coming Monday.
  const ahead = new Date(now.getTime() + 2 * day), monday = Date.UTC(ahead.getUTCFullYear(), ahead.getUTCMonth(), ahead.getUTCDate()) - ((ahead.getUTCDay() + 6) % 7) * day
  // Site hours, 8:00 am to 4:00 pm in Minneapolis.
  const at = (days: number, hour: number) => new Date(monday + days * day + hour * 3_600_000).toISOString()
  const agent: Actor = { id: 'demo-agent', email: 'agent@plinth.invalid', name: 'Plinth agent', role: 'agent', version: 1 }
  const result: Job[] = []
  for (const project of projects) {
    const client: Actor = { id: `demo-client-${project.key}`, email: project.email, name: project.client, role: 'member', version: 1 }
    const job = emptyJob({ name: project.name, client_email: client.email, address: project.address }, owner)
    const began = Date.now() - 1000
    // Each step's stamps read as done that many days before now, at 9:00 am.
    function backdate(days: number) {
      function walk(value: any) {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (key === 'at' && typeof child === 'string' && Date.parse(child) >= began) value[key] = new Date(now.getTime() - days * day).toISOString().slice(0, 10) + 'T14:00:00.000Z'
          else walk(child)
        }
      }
      walk(job)
    }
    const lines = project.lines.map(([description, unit_cents]) => ({ description, quantity: 1, unit_cents }))
    prepareQuote(job, owner, { lines, notes: 'Includes materials, labor and sales tax. Selections as agreed at the preconstruction meeting.' })
    backdate(60)
    if (!project.stage) {
      prepareQuote(job, owner, { lines: [...lines, { description: 'Pantry wall and pull-out storage', quantity: 1, unit_cents: 465_000 }], notes: 'Revision 2 adds the pantry wall Marit asked for. Awaiting her acceptance.' })
      backdate(2)
    } else {
      acceptQuote(job, owner, job.quotes[0].id, { method: 'signed', evidence: `${project.client} returned the signed agreement; scope and selections confirmed at the preconstruction meeting.` })
      backdate(56)
      for (const [trade, description, from, to] of project.bookings) prepareSchedule(job, owner, { trade, description, start: at(from, 13), end: at(to, 21) }, result)
      if (project.agentBooking) { const [trade, description, from, to] = project.agentBooking; prepareSchedule(job, agent, { trade, description, start: at(from, 13), end: at(to, 21) }, result) }
      backdate(5)
      for (const [offset, note] of project.logs) {
        await prepareDiary(db, job, owner, { date: at(offset, 0).slice(0, 10), note })
        backdate(Math.max(0, Math.round((now.getTime() - (monday + offset * day)) / day)))
      }
      for (const [description, amount_cents, approved] of project.changes) {
        const change = prepareVariation(job, owner, { description, amount_cents })
        backdate(approved ? 21 : 2)
        if (approved) { approveVariation(job, client, change.id); backdate(19) }
      }
      for (const [supplier, description, amount_cents, received] of project.orders) {
        const order = prepareOrder(job, owner, { supplier, description, amount_cents })
        backdate(18)
        if (received === null || received >= 0) { issueOrder(job, owner, order.id); backdate(17) }
        if (received) { receiveOrder(job, owner, order.id, { amount_cents: received, reference: `Delivery ticket ${supplier.split(' ')[0]}-${1040 + projects.indexOf(project)}` }); backdate(4) }
      }
      for (const [description, cumulative_cents, state] of project.billing) {
        const claim = prepareClaim(job, owner, { description, cumulative_cents })
        backdate(state === 'exported' ? 12 : 1)
        if (state === 'exported') { approveClaim(job, owner, claim.id); exportClaim(job, owner, claim.id); backdate(11) }
      }
    }
    // Replace every generated ID, including snapshot references, consistently.
    const ids = new Map<string, string>([[job.id, `demo-job-${project.key}`]])
    function identify(value: any) {
      if (!value || typeof value !== 'object') return
      if (typeof value.id === 'string' && ![owner.id, client.id, agent.id].includes(value.id) && !ids.has(value.id)) ids.set(value.id, `demo-${project.key}-${ids.size}`)
      Object.values(value).forEach(identify)
    }
    identify(job)
    const fixed = JSON.parse(JSON.stringify(job), (_key, value) => typeof value === 'string' ? ids.get(value) ?? value : value) as Job
    result.push(fixed)
  }
  return result
}
