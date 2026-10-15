import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`product-card ${className}`}>{children}</div>
}
export function Status({ children, draft = false }: { children: ReactNode; draft?: boolean }) {
  return <span className="product-status"><span aria-hidden="true">{draft ? '•' : '✓'}</span>{children}</span>
}
export function DrawingAction({ children, kind = 'jade' }: { children: ReactNode; kind?: 'jade' | 'ink' | 'outline' }) {
  return <span className={`drawing-action ${kind}`}>{children}</span>
}
export function AmountRows({ rows }: { rows: [string, string][] }) {
  return <dl className="product-rows">{rows.map(([label, amount]) => <div className={label === 'This claim' ? 'key-row' : ''} key={label}><dt>{label}</dt><dd>{amount}</dd></div>)}</dl>
}
