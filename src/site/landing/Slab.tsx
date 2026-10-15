import type { ReactNode } from 'react'

/** The same seamless stone sits beneath every live, accessible product drawing. */
export function Slab({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`terrazzo-slab ${className}`}>{children}</div>
}
