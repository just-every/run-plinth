// 12 · Interlude: the plan map of Minneapolis on Mon Nov 16, a text-free plate
// with HTML pins, leader lines and cards placed against the drawn water. On a
// phone the map is cropped to the lakes and the river with numbered pins, the
// summary card above it and the pin cards stacked below in the same order.
import type { CSSProperties, ReactNode } from 'react'
import { Picture, Segs, Tick } from '../parts'

interface Pin { n: string; at: [number, number]; card: [number, number, number]; lead: [number, number]; title: ReactNode; trade: ReactNode; note: ReactNode; shop?: boolean }
// Plate coordinates (1536 × 1024): the pin's tip, the card's left, top and width, the leader's card end.
const pins: Pin[] = [
  { n: '1', at: [214, 549], card: [36, 600, 314], lead: [205, 600], title: <Segs>{['Linden Hills', 'Alvarez second story']}</Segs>, trade: <Segs>{['Finish carpentry', "Jake Turner's crew"]}</Segs>, note: <>handover Fri Dec 18 on track <Tick /></> },
  { n: '2', at: [967, 84], card: [1040, 36, 314], lead: [1040, 80], title: <Segs>{['Northeast', 'Nguyen kitchen']}</Segs>, trade: <Segs>{['Northstar Stone', 'countertop install']}</Segs>, note: 'walkthrough Fri Nov 20' },
  { n: '3', at: [1417, 862], card: [1189, 689, 314], lead: [1372, 777], title: <Segs>{['Highland Park', 'Okafor basement']}</Segs>, trade: <Segs>{['Riverbend Plumbing', 'finish plumbing']}</Segs>, note: <>drywall done Fri Nov 13 <Tick /></> },
  { n: '4', at: [103, 884], card: [170, 884, 264], lead: [170, 897], title: <Segs>{['Edina', 'Brennan bath']}</Segs>, trade: <Segs>{['Mendoza Tile', 'shower walls']}</Segs>, note: 'tile through Thu Nov 19' },
  { n: '5', at: [566, 704], card: [561, 561, 300], lead: [645, 647], title: <Segs>{['Tangletown', 'Lindqvist kitchen']}</Segs>, trade: <Segs>{['Pre-construction', 'no crew yet']}</Segs>, note: 'starts Mon Jan 11' },
  { n: 'S', at: [985, 497], card: [1031, 392, 224], lead: [1031, 455], title: 'Longfellow shop', trade: null, note: 'Minnehaha Design-Build', shop: true },
]
const PHONE: [number, number, number, number] = [40, 30, 1460, 880] // the phone crop: x, y, width, height

export function MapInterlude() {
  return <section id="jobs-map" className="mapband" aria-label="All nine jobs on Mon Nov 16">
    <div className="map-summary card"><p className="eyebrow">Mon Nov 16</p><h2><Segs>{['9 jobs', '$2.41M under contract']}</Segs></h2><p className="muted"><Segs>{['Forecast margin 21.8%', '0 trade conflicts']}</Segs></p></div>
    <div className="map-stage">

      <div className="map-frame">
      <Picture className="map-art" name="map" widths={[768, 1152, 1536]} sizes="100vw" width={1536} height={1024}
        phone={{ name: 'map-phone', widths: [780, 1180], media: '(max-width: 1179px)', width: 1460, height: 880 }}
        alt="Plan map of Minneapolis: Bde Maka Ska and Lake Harriet on the west side, Minnehaha Creek, downtown and the Mississippi River, with the Longfellow shop just west of the river." />
      <svg className="map-leaders" viewBox="0 0 1536 1024" preserveAspectRatio="none" aria-hidden="true">{pins.map(pin => <line key={pin.n} x1={pin.at[0]} y1={pin.at[1] - (pin.shop ? 0 : 10)} x2={pin.lead[0]} y2={pin.lead[1]} vectorEffect="non-scaling-stroke" />)}</svg>
      {pins.map(pin => <span key={pin.n} className={`map-pin${pin.shop ? ' map-shop' : ''}`} aria-hidden="true"
        style={{ '--x': pin.at[0], '--y': pin.at[1], '--px': (pin.at[0] - PHONE[0]) / PHONE[2], '--py': (pin.at[1] - PHONE[1]) / PHONE[3] } as CSSProperties}>
        {pin.shop ? <i /> : <svg viewBox="0 0 24 32"><path d="M12 31S2 19.6 2 11.6a10 10 0 0 1 20 0C22 19.6 12 31 12 31z" /><circle cx="12" cy="11.5" r="4" /></svg>}<b>{pin.n}</b>
      </span>)}
      </div>
      <ol className="map-cards">{pins.map(pin => <li key={pin.n} className={`card map-card${pin.shop ? ' shop-card' : ''}`} style={{ '--x': pin.card[0], '--y': pin.card[1], '--w': pin.card[2] } as CSSProperties}>
        <span className="map-num" aria-hidden="true">{pin.n}</span><div><p className="map-title">{pin.title}</p>{pin.trade && <p className="map-trade">{pin.trade}</p>}<p className="map-note">{pin.note}</p></div>
      </li>)}</ol>
    </div>
  </section>
}
