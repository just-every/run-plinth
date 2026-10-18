import type { Calendar } from './calendar'
import type { Project, Step } from './timeline'

// The builder's other jobs on the run site's Minneapolis map. Sam Becker runs
// the three live ones, moved in from Buildertrend on Fri Oct 9 (-10) with Job
// 2214; Hannah Olson is quoting the Lindqvist kitchen.
const carried = (when: number, client: string, signed: string, lines: [string, number][]): Step[] => [
  { at: [-10, 14, when], by: 'sam', do: 'quote', lines, notes: 'Includes materials, labor and sales tax. Carried over from Buildertrend at the move-in.' },
  { at: [-10, 14, when + 2], by: 'sam', do: 'accept', method: 'signed', evidence: `${client} signed the agreement ${signed}; carried over from Buildertrend.` },
]

export function others({ named: d }: Calendar): Project[] {
  return [
    { key: 'nguyen', name: 'Nguyen kitchen', client: 'Daniel Nguyen', email: 'daniel.nguyen@example.com', address: '2208 Fillmore Street NE, Minneapolis, MN 55418',
      steps: [
        ...carried(0, 'Daniel Nguyen', d(-45), [['Demolition and protection', 640_000], ['Cabinetry and installation', 3_120_000], ['Electrical and plumbing', 1_180_000], ['Countertops, backsplash and finishes', 1_460_000]]),
        { at: [-10, 14, 5], by: 'sam', do: 'change', key: 'quartz', description: 'Quartz countertop upgrade including matching backsplash', cents: 285_000 },
        { at: [-10, 18, 15], by: 'client', do: 'sign', key: 'quartz' },
        { at: [-10, 14, 8], by: 'sam', do: 'bill', key: 'p1', description: `Pay app 1 · demolition and rough-in, billed through ${d(-19)} in Buildertrend`, cumulative: 1_850_000 },
        { at: [-10, 14, 9], by: 'sam', do: 'approve bill', key: 'p1' },
        { at: [-10, 14, 10], by: 'sam', do: 'export bill', key: 'p1' },
        { at: [-10, 14, 12], by: 'sam', do: 'order', key: 'cabinets', supplier: 'Lakeside Cabinet Co.', description: 'Custom cabinetry and hardware, quote LC-2417', cents: 1_180_000 },
        { at: [-10, 14, 13], by: 'sam', do: 'issue', key: 'cabinets' },
        { at: [-10, 14, 15], by: 'sam', do: 'book', trade: 'Northside Electric', work: 'Trim-out and test circuits', from: 2, to: 3 },
        { at: [-10, 14, 16], by: 'sam', do: 'book', trade: 'Clearwater Plumbing', work: 'Connect fixtures and pressure test', from: 8, to: 9 },
        { at: [-6, 10, 15], by: 'sam', do: 'receive', key: 'cabinets', cents: 1_180_000, reference: 'Delivery ticket Lakeside-1041' },
        { at: [-6, 15, 0], by: 'sam', do: 'book', trade: 'Northstar Stone', work: 'Countertop template', from: 1, to: 1 },
        { at: [-6, 16, 30], by: 'sam', do: 'log', note: `Cabinets delivered and checked against the order. Countertop template booked with Northstar Stone for ${d(1)}.` },
        { at: [-5, 10, 0], by: 'sam', do: 'order', key: 'fixtures', supplier: 'Trade Supply Co.', description: 'Fixtures and fittings to the approved selections', cents: 245_000 },
        { at: [-5, 10, 5], by: 'sam', do: 'issue', key: 'fixtures' },
        { at: [-4, 16, 20], by: 'sam', do: 'log', note: 'Upper cabinets hung and leveled. At the site meeting Daniel confirmed the warm white finish and asked for under-cabinet lighting.' },
        { at: [-4, 17, 0], by: 'sam', do: 'change', key: 'lighting', description: 'Under-cabinet lighting requested at the site meeting', cents: 78_000 },
        { at: [-3, 16, 0], by: 'sam', do: 'bill', key: 'p2', description: `Pay app 2 · cabinetry delivered and hung, through ${d(-3)}`, cumulative: 3_900_000 },
        { at: [1, 16, 10], by: 'sam', do: 'log', note: 'Northstar Stone templated the countertops; fabrication takes about two weeks.' },
        { at: [3, 16, 15], by: 'sam', do: 'log', note: 'Electrical trim-out complete; every circuit tested.' },
      ] },
    { key: 'okafor', name: 'Okafor basement', client: 'Grace Okafor', email: 'grace.okafor@example.com', address: '1734 Highland Parkway, St. Paul, MN 55116',
      steps: [
        ...carried(20, 'Grace Okafor', d(-38), [['Framing and egress window', 1_480_000], ['Electrical and plumbing', 1_210_000], ['Drywall, trim and flooring', 1_690_000]]),
        { at: [-10, 14, 25], by: 'sam', do: 'change', key: 'bar', description: 'Add a wet bar rough-in on the north wall', cents: 186_000 },
        { at: [-10, 20, 5], by: 'client', do: 'sign', key: 'bar' },
        { at: [-10, 14, 28], by: 'sam', do: 'bill', key: 'p1', description: `Pay app 1 · framing and egress window, billed through ${d(-19)} in Buildertrend`, cumulative: 1_640_000 },
        { at: [-10, 14, 29], by: 'sam', do: 'approve bill', key: 'p1' },
        { at: [-10, 14, 30], by: 'sam', do: 'export bill', key: 'p1' },
        { at: [-10, 14, 32], by: 'sam', do: 'order', key: 'floor', supplier: 'Summit Flooring', description: 'Luxury vinyl plank, 820 sq ft', cents: 612_000 },
        { at: [-10, 14, 33], by: 'sam', do: 'issue', key: 'floor' },
        { at: [-10, 14, 35], by: 'sam', do: 'book', trade: 'Highland Drywall', work: 'Drywall, hang and finish', from: 14, to: 25 },
        { at: [-10, 14, 36], by: 'sam', do: 'book', trade: 'Riverbend Plumbing', work: 'Finish plumbing, basement bath', from: 28, to: 29 },
        { at: [-10, 14, 37], by: 'sam', do: 'book', trade: 'Summit Flooring', work: 'Luxury vinyl plank', from: 30, to: 31 },
        { at: [-4, 15, 50], by: 'sam', do: 'log', note: `Egress window passed inspection; framing complete. Rough plumbing booked with Riverbend Plumbing for ${d(1)}.` },
        { at: [-4, 15, 55], by: 'sam', do: 'book', trade: 'Riverbend Plumbing', work: 'Rough plumbing, bath and wet bar', from: 1, to: 2 },
        { at: [2, 16, 0], by: 'sam', do: 'log', note: 'Rough plumbing for the bath and wet bar complete; pressure test passed.' },
      ] },
    { key: 'brennan', name: 'Brennan bath', client: 'Sofia Brennan', email: 'sofia.brennan@example.com', address: '618 Valley View Road, Edina, MN 55424',
      steps: [
        ...carried(40, 'Sofia Brennan', d(-24), [['Demolition and waterproofing', 520_000], ['Shower, tile and glass', 1_840_000], ['Vanity, plumbing and electrical', 960_000]]),
        { at: [-10, 14, 45], by: 'sam', do: 'book', trade: 'Clearwater Plumbing', work: 'Relocate the shower valve and drain', from: 1, to: 2 },
        { at: [-10, 14, 46], by: 'sam', do: 'book', trade: 'Mendoza Tile', work: 'Shower walls', from: 28, to: 31 },
        { at: [-3, 15, 30], by: 'sam', do: 'log', note: 'Demolition complete; subfloor sound. Sofia approved the tile layout on site.' },
        { at: [2, 15, 40], by: 'sam', do: 'log', note: 'Shower valve and drain relocated; rough plumbing inspection passed.' },
      ] },
    { key: 'lindqvist', name: 'Lindqvist kitchen', client: 'Marit Lindqvist', email: 'marit.lindqvist@example.com', address: '5012 Pleasant Avenue, Minneapolis, MN 55419',
      steps: [
        { at: [-6, 14, 0], by: 'hannah', do: 'quote', lines: [['Design, demolition and protection', 920_000], ['Cabinetry, island and installation', 4_380_000], ['Electrical, plumbing and ventilation', 1_640_000], ['Countertops, tile and finishes', 1_910_000]], notes: 'Includes materials, labor and sales tax. Selections as agreed at the design meeting.' },
        { at: [-4, 11, 0], by: 'hannah', do: 'quote', lines: [['Design, demolition and protection', 920_000], ['Cabinetry, island and installation', 4_380_000], ['Electrical, plumbing and ventilation', 1_640_000], ['Countertops, tile and finishes', 1_910_000], ['Pantry wall and pull-out storage', 465_000]], notes: 'Revision 2 adds the pantry wall Marit asked for. Awaiting her acceptance.' },
      ] },
  ]
}
