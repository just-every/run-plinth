// Small pieces every section draws with: the section frame, the eyebrow and
// heading, chips, ticks and the line icons the desk's cards carry.
import type { ReactNode } from 'react'

export const SOURCE = 'https://github.com/just-every/run-plinth'
export const DEMO = 'https://demo.run-plinth.com/'
// The one start line every Run Edit Run page shows, and the alternative for people who already have Node.
export const START = 'curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-plinth'
export const ALTERNATIVE = 'npx -y @runeditrun/rer dev just-every/run-plinth'

export function Section({ id, tone = 'white', className = '', children }: { id: string; tone?: 'white' | 'sea' | 'ox'; className?: string; children: ReactNode }) {
  return <section id={id} className={`band band-${tone} ${className}`}><div className="wrap">{children}</div></section>
}

export function Copy({ eyebrow, title, children, className = '' }: { eyebrow: string; title: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`copy ${className}`}><p className="eyebrow"><Segs>{eyebrow.split(' · ')}</Segs></p><h2>{title}</h2><p className="lead">{children}</p></div>
}

/** Text in "·" segments: each segment keeps its trailing separator and never breaks inside,
 * so a wrapped line never starts with a separator or an arrow. */
export function Segs({ children }: { children: ReactNode[] }) {
  return <span className="segs">{children.map((part, i) => <span key={i}>{i ? ' ' : ''}<span className={typeof part === 'string' && part.length > 26 ? 'seg-long' : 'seg'}>{part}{i < children.length - 1 ? '\u00a0·' : ''}</span></span>)}</span>
}

/** A ✓ drawn as a stroke, so it never falls back to another font's glyph. */
export function Tick({ className = '' }: { className?: string }) {
  return <svg className={`tick ${className}`} viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6.4 4.8 9 9.8 3.2" /></svg>
}
export function Arrow({ className = '' }: { className?: string }) {
  return <svg className={`arrow ${className}`} viewBox="0 0 16 12" aria-hidden="true"><path d="M1 6h13M9.5 1.5 14 6l-4.5 4.5" /></svg>
}
/** A filled green disc with a white tick: a step that is done. */
export function Done({ className = '' }: { className?: string }) {
  return <span className={`done ${className}`} aria-hidden="true"><Tick /></span>
}
export function Chip({ kind = 'green', children }: { kind?: 'green' | 'soft' | 'ox' | 'pale'; children: ReactNode }) {
  return <span className={`chip chip-${kind}`}>{children}</span>
}
export function Avatar({ children, kind = 'blue' }: { children: ReactNode; kind?: 'blue' | 'green' }) {
  return <span className={`avatar avatar-${kind}`} aria-hidden="true">{children}</span>
}

const icons: Record<string, ReactNode> = {
  doc: <><path d="M6 2.5h8l4 4V21H6z" /><path d="M14 2.5V7h4M9 11h6M9 14.5h6M9 18h4" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="17" rx="1.5" /><path d="M9 4.5V3h6v1.5M9 3.5h6v2.5H9z" /><path d="m8.8 13.4 2.2 2.2 4.3-4.6" /></>,
  clipboardList: <><rect x="5" y="4.5" width="14" height="17" rx="1.5" /><path d="M9 3h6v3H9zM8.5 10.5h7M8.5 14h7M8.5 17.5h5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.4 2" /></>,
  wrench: <path d="M14.6 3.4a5 5 0 0 0-5.4 6.9l-6 6a1.9 1.9 0 0 0 2.7 2.7l6-6a5 5 0 0 0 6.7-5.6l-3 3-3.1-.7-.7-3.1z" />,
  coins: <><ellipse cx="13.5" cy="5.5" rx="6" ry="2.4" /><path d="M7.5 5.5v3c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4v-3M7.5 8.5v3c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4v-3" /><ellipse cx="9.5" cy="14" rx="6" ry="2.4" /><path d="M3.5 14v3.5c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V14" /></>,
  chart: <><path d="M3 21h18" /><rect x="5" y="13" width="3" height="7" /><rect x="10.5" y="9" width="3" height="11" /><rect x="16" y="4.5" width="3" height="15.5" /></>,
  bank: <><path d="M3 9.5 12 4l9 5.5zM4 20.5h16M5.5 11v7.5M9.5 11v7.5M14.5 11v7.5M18.5 11v7.5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="1.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" /></>,
  sun: <><circle cx="12" cy="12" r="3.6" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" /></>,
  people: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20v-1.5A5.5 5.5 0 0 1 14.5 18.5V20" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16 14a4.5 4.5 0 0 1 5 4.5V20" /></>,
  note: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4.5" /></>,
  bell: <><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  dollar: <path d="M12 3v18M16.5 7.2c-.8-1.2-2.4-2-4.4-2-2.6 0-4.4 1.3-4.4 3.3 0 4.6 9 2.5 9 7 0 2-1.9 3.4-4.6 3.4-2.1 0-3.9-.8-4.8-2.2" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="1.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 13h1.5M11.3 13h1.5M15 13h1.5M7.5 16.5h1.5M11.3 16.5h1.5" /></>,
  card: <><rect x="3" y="5.5" width="18" height="13" rx="1.5" /><path d="M3 10h18M6.5 15h4" /></>,
  clip: <path d="M15.5 6.5 8.4 13.6a2.2 2.2 0 0 0 3.1 3.1l7.4-7.4a4 4 0 0 0-5.7-5.7l-7.6 7.6a5.8 5.8 0 0 0 8.2 8.2l6.3-6.3" />,
  pin: <><path d="M12 22s-7-7.6-7-12.6a7 7 0 0 1 14 0C19 14.4 12 22 12 22z" /><circle cx="12" cy="9.4" r="2.6" /></>,
}
export function Icon({ name, className = '' }: { name: keyof typeof icons | string; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>
}

/** The approved stepladder mark with the Plinth wordmark. */
export function Lockup({ light = false }: { light?: boolean }) {
  return <a className="lockup" href="/" aria-label="Plinth home"><img src={light ? '/brand/mark-light.svg' : '/brand/mark.svg'} alt="" width="30" height="33" /><span>Plinth</span></a>
}

/** One AVIF/WebP picture at responsive widths, from public/site. */
export function Picture({ name, widths, sizes, alt, className = '', width, height, eager = false, phone }: { name: string; widths: number[]; sizes: string; alt: string; className?: string; width: number; height: number; eager?: boolean; phone?: { name: string; widths: number[]; media: string; width: number; height: number } }) {
  const set = (n: string, ws: number[], ext: string) => ws.map(w => `/site/${n}-${w}.${ext} ${w}w`).join(', ')
  return <picture className={className}>
    {phone && <source media={phone.media} type="image/avif" srcSet={set(phone.name, phone.widths, 'avif')} sizes="100vw" width={phone.width} height={phone.height} />}
    {phone && <source media={phone.media} type="image/webp" srcSet={set(phone.name, phone.widths, 'webp')} sizes="100vw" width={phone.width} height={phone.height} />}
    <source type="image/avif" srcSet={set(name, widths, 'avif')} sizes={sizes} />
    <img src={`/site/${name}-${widths.at(-1)}.webp`} srcSet={set(name, widths, 'webp')} sizes={sizes} alt={alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} decoding={eager ? 'sync' : 'async'} {...(eager ? { fetchPriority: 'high' as const } : {})} />
  </picture>
}
