import type { Calendar } from './calendar'
import type { Action, Project, Step } from './timeline'

// Job 2214, the run site's records: Ana and Marco Alvarez's second story in
// Linden Hills, run by Rosa Delgado. Day 0 is Monday Oct 19 on the site's 2026
// calendar: the move from Buildertrend is Fri Oct 9 (-10), change order 7 is
// signed Mon Oct 12 (-7), the windows slip Wed Oct 14 (-5), and pay app 4
// covers Oct 1 – Oct 16 and is issued Mon Oct 19, 8:30 am.
export function alvarez({ named: d }: Calendar): Project {
  const moveIn = (minute: number, action: Action): Step => ({ at: [-10, 16, 35 + minute], by: 'rosa', ...action })
  // [scope, amount, the day Ana signed it in Buildertrend]: all before pay apps 1–3, billed through Wed Sep 30.
  const changes: [string, number, number][] = [
    ['sister the undersized ceiling joists found at demolition', 248_000, -61],
    ['relocate the HVAC return to the new hall closet', 135_000, -54],
    ['two recessed lights and a dimmer in the stair hall', 86_000, -47],
    ['LVL header over the new stair opening, per the engineer’s revision', 312_000, -40],
    ['closed-cell spray foam at the rim joists in place of batts', 194_000, -33],
    ['hose bib and exterior outlet on the north wall', 187_000, -26],
  ]
  const booked: [string, string, number, number][] = [
    ['Peak Electric', 'Electrical rough-in', -7, -3], ['Riverbend Plumbing', 'Plumbing rough-in', -7, -3], ['Cedar Insulation', 'Insulation', 3, 4], ['Twin Cities Drywall', 'Drywall', 7, 25],
    ['Jake Turner crew', 'Finish carpentry', 28, 37], ['Mendoza Tile', 'Primary bath tile', 42, 46], ['Lake Street Painting', 'Paint and punch list', 49, 56],
  ]
  return {
    key: 'alvarez', name: 'Alvarez second story', client: 'Ana Alvarez', email: 'ana.alvarez@example.com', address: '4417 Drew Avenue South, Minneapolis, MN 55410',
    steps: [
      // Fri Oct 9: the move-in carries the signed contract, change orders 1–6, pay apps 1–3, the booked trades and the windows PO.
      moveIn(0, { do: 'quote', lines: [['Demolition, shoring and site protection', 3_840_000], ['Framing, sheathing and roof structure', 11_260_000], ['Windows, roofing and exterior envelope', 9_680_000], ['Electrical, plumbing and HVAC', 7_130_000], ['Insulation, drywall and finish carpentry', 6_290_000], ['Tile, paint and finishes', 3_660_000]], notes: 'Includes materials, labor and sales tax. Carried over from Buildertrend at the move-in.' }),
      moveIn(3, { do: 'accept', method: 'signed', evidence: `Ana and Marco Alvarez e-signed the contract ${d(-66)}; carried over from Buildertrend.` }),
      ...changes.map(([scope, cents], i) => moveIn(10 + i, { do: 'change', key: `co${i + 1}`, description: `Change order ${i + 1} · ${scope}`, cents })),
      ...changes.map(([, , signed], i) => ({ at: [-10, 16, 45 + i], by: 'client', do: 'sign', key: `co${i + 1}`, carried: `signed by Ana Alvarez in Buildertrend ${d(signed)}` }) as Step),
      { at: [-10, 17, 40], by: 'rosa', do: 'bill', key: 'pa1-3', description: `Pay apps 1–3 · demolition through framing, billed through ${d(-19)} in Buildertrend`, cumulative: 9_641_000 },
      { at: [-10, 17, 41], by: 'rosa', do: 'approve bill', key: 'pa1-3' },
      { at: [-10, 17, 42], by: 'rosa', do: 'export bill', key: 'pa1-3' },
      ...booked.map(([trade, work, from, to], i) => ({ at: [-10, 17, 50 + i], by: 'rosa', do: 'book', trade, work, from, to }) as Step),
      { at: [-10, 18, 5], by: 'rosa', do: 'order', key: 'nws', supplier: 'Northfield Window Supply', description: '12 windows per the window schedule, quote NWS-2214', cents: 3_840_000 },
      { at: [-10, 18, 6], by: 'rosa', do: 'issue', key: 'nws' },
      // Mon Oct 12: rough-ins start; change order 7 is priced, then signed by Ana at 7:48 pm.
      { at: [-7, 15, 30], by: 'rosa', do: 'change', key: 'co7', description: 'Change order 7 · fixed 2 × 4 ft skylight over the primary bedroom, framed and flashed (08-610 Skylights)', cents: 324_000 },
      { at: [-7, 16, 41], by: 'rosa', do: 'log', note: 'Rough-ins started: Peak Electric and Riverbend Plumbing on site. Change order 7 priced for a fixed 2 × 4 ft skylight over the primary bedroom, +2 days within float; sent to Ana to sign.' },
      { at: [-7, 19, 48], by: 'client', do: 'sign', key: 'co7' },
      { at: [-6, 7, 30], by: 'rosa', do: 'book', trade: 'Jake Turner crew', work: 'Skylight framing, change order 7', from: -4, to: -3 },
      // Wed Oct 14, 9:12 am: Northfield moves the windows 9 days. The agent drafts siding at 9:20 am; roofing goes first.
      { at: [-5, 9, 20], by: 'agent', do: 'book', trade: 'Larkin Exteriors', work: 'Siding, after the window install', from: 14, to: 25 },
      { at: [-5, 11, 40], by: 'rosa', do: 'book', trade: 'Halvorsen Roofing', work: 'Roof dry-in', from: 0, to: 3 },
      { at: [-5, 11, 55], by: 'rosa', do: 'book', trade: 'Jake Turner crew', work: 'Window install, 12 units', from: 9, to: 11 },
      { at: [-5, 16, 52], by: 'rosa', do: 'log', note: `Northfield Window Supply moved the 12 windows from ${d(0)} to ${d(9)}, 9 days late (9:12 am). Roofing goes first: Halvorsen Roofing confirmed the roof dry-in for ${d(0)} – ${d(3)}, so the house is dried in before the windows. Plinth's agent drafted siding to follow the window install, ${d(14)} – ${d(25)}, for approval.` },
      { at: [-4, 16, 45], by: 'rosa', do: 'log', note: 'Skylight framing started over the primary bedroom. Electrical rough-in at the panel.' },
      { at: [-3, 14, 10], by: 'rosa', do: 'book', trade: 'City of Minneapolis', work: 'Framing inspection, permit BLD-2026-04187', from: 2, to: 2, hours: [10, 11] },
      { at: [-3, 16, 47], by: 'rosa', do: 'log', note: `Electrical and plumbing rough-ins complete. Skylight framed and flashed (change order 7). Framing inspection booked with the City of Minneapolis for ${d(2)}, 10:00 am, permit BLD-2026-04187.` },
      { at: [-3, 17, 10], by: 'rosa', do: 'bill', key: 'pa4', description: `Pay app 4 · ${d(-18)} – ${d(-3)}: framing, steel, CO 7 and rough-ins`, cumulative: 15_920_000 },
      // The week of Mon Oct 19: what has happened by now.
      { at: [0, 8, 30], by: 'rosa', do: 'approve bill', key: 'pa4' },
      { at: [0, 16, 44], by: 'rosa', do: 'log', note: `Halvorsen Roofing on site at 7:05 am with a crew of 3: tear-off and underlayment on the south slope. Cedar Insulation confirmed for ${d(3)}.` },
      { at: [1, 16, 38], by: 'rosa', do: 'log', note: 'South slope shingled; north slope underlayment down.' },
      { at: [2, 16, 52], by: 'rosa', do: 'log', note: 'National Weather Service: 41°F, clear, wind 8 mph. Crew: Jake Turner + 1, Halvorsen Roofing 3. Framing inspection passed at 10:40 am (City of Minneapolis, permit BLD-2026-04187); insulation unblocked for tomorrow. North slope shingled · dry-in Thu.' },
      { at: [3, 16, 50], by: 'rosa', do: 'log', note: 'Dried in at 3:40 pm. Cedar Insulation started the exterior walls.' },
      { at: [4, 15, 20], by: 'rosa', do: 'export bill', key: 'pa4' },
      { at: [4, 16, 31], by: 'rosa', do: 'log', note: `Insulation complete. Twin Cities Drywall starts ${d(7)}.` },
    ],
  }
}
