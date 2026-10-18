// The Gantt drawing the schedule (02) and the slip (04) share: week columns from
// Mon Oct 12, 2026, bars placed by calendar day, elbow dependency arrows, chips
// and notes. Every position is a percentage of the track, so the same drawing
// sits in a fixed label column at desktop and swipes at a fixed week width on a
// phone, with each task name on its own line above its bar.
import type { CSSProperties, ReactNode } from 'react'

const START = Date.UTC(2026, 9, 12)
/** Days from Mon Oct 12, 2026: day(10, 19) is 7. */
export const day = (month: number, date: number) => (Date.UTC(2026, month - 1, date) - START) / 86_400_000

export type Item =
  | { t: 'bar'; from: number; to: number; kind?: 'blue' | 'olive' | 'ox' | 'float'; lane?: 'up' | 'down' }
  | { t: 'ghost'; from: number; to: number; dashed?: boolean; lane?: 'up' | 'down' }
  | { t: 'diamond'; at: number; kind?: 'blue' | 'ox' }
  | { t: 'chip'; at: number; kind?: 'green' | 'pale' | 'ox'; children: ReactNode }
  | { t: 'note'; at: number; kind?: 'olive' | 'ox' | 'muted' | 'ink'; place?: 'mid' | 'above' | 'below'; align?: 'left' | 'right'; children: ReactNode }
  | { t: 'move'; from: number; to: number }
export interface Row { name: string; who?: string; items: Item[] }
/** An elbow from the end of one row's bar to the start of another's. */
export interface Link { from: [number, number]; to: [number, number]; via?: number; end?: 'right' | 'down' }

const pct = (days: number, span: number) => `${(days / span) * 100}%`
const at = (row: number, offset = '0px') => `calc((${row} + var(--frac)) * var(--row) + ${offset})`

function Items({ items, span }: { items: Item[]; span: number }) {
  return <>{items.map((item, i) => {
    switch (item.t) {
      case 'bar': return <i key={i} className={`g-bar g-${item.kind ?? 'blue'}${item.lane ? ` g-lane-${item.lane}` : ''}`} style={{ left: pct(item.from, span), width: pct(item.to - item.from, span) }} />
      case 'ghost': return <i key={i} className={`g-ghost${item.dashed ? ' g-dashed' : ''}${item.lane ? ` g-lane-${item.lane}` : ''}`} style={{ left: pct(item.from, span), width: pct(item.to - item.from, span) }} />
      case 'diamond': return <i key={i} className={`g-diamond g-${item.kind ?? 'blue'}`} style={{ left: pct(item.at, span) }} />
      case 'chip': return <span key={i} className={`g-chip chip chip-${item.kind ?? 'green'}`} style={{ left: pct(item.at, span) }}>{item.children}</span>
      case 'note': return <span key={i} className={`g-note g-note-${item.kind ?? 'muted'} g-${item.place ?? 'mid'}${item.align === 'right' ? ' g-right' : ''}`} style={item.align === 'right' ? { right: `calc(100% - ${pct(item.at, span)})` } : { left: pct(item.at, span) }}>{item.children}</span>
      case 'move': {
        const left = Math.min(item.from, item.to), back = item.to < item.from
        return <i key={i} className={`g-move${back ? ' g-back' : ''}`} style={{ left: pct(left, span), width: pct(Math.abs(item.to - item.from), span) }} />
      }
    }
  })}</>
}

function Links({ links, span }: { links: Link[]; span: number }) {
  return <>{links.map(({ from: [r1, x1], to: [r2, x2], via, end = 'right' }, i) => {
    const xv = via ?? x1 + 0.7
    const pieces: [string, CSSProperties][] = [
      ['h', { left: pct(x1, span), width: pct(xv - x1, span), top: at(r1) }],
    ]
    if (end === 'down') pieces.push(['v', { left: pct(xv, span), top: at(r1), height: `calc(${r2 - r1} * var(--row) - 11px)` }], ['ad', { left: pct(xv, span), top: at(r2, '-11px') }])
    else pieces.push(
      ['v', { left: pct(xv, span), top: at(r1), height: `calc(${r2 - r1} * var(--row))` }],
      ['h', { left: pct(Math.min(xv, x2), span), width: pct(Math.abs(x2 - xv), span), top: at(r2) }],
      ['ar', { left: pct(x2, span), top: at(r2) }],
    )
    return pieces.map(([kind, style], j) => <i key={`${i}-${j}`} className={`g-ln g-${kind}`} style={style} />)
  })}</>
}

export function Gantt({ weeks, rows, links = [], label, className = '', children }: { weeks: string[]; rows: Row[]; links?: Link[]; label: string; className?: string; children?: ReactNode }) {
  const span = weeks.length * 7
  return <div className={`gantt ${className}`} role="img" aria-label={label}>
    <div className="g-scroll" tabIndex={-1}>
      <div className="g-inner">
        <div className="g-weeks"><span className="g-corner" />{weeks.map((week, i) => <span key={i}>{week}</span>)}</div>
        <div className="g-rows" style={{ '--n': rows.length, '--cols': weeks.length } as CSSProperties}>
          {rows.map((row, r) => <div className="g-row" key={r}>
            <div className="g-label"><span><b>{row.name}</b>{row.who && <> · {row.who}</>}</span></div>
            <div className="g-track"><Items items={row.items} span={span} /></div>
          </div>)}
          <div className="g-links"><Links links={links} span={span} /></div>
        </div>
      </div>
    </div>
    {children}
  </div>
}
