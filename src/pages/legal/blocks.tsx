import type { ReactNode } from 'react'
import { Link } from 'react-router'

/** Типографика юридических документов */
export const H = ({ children }: { children: ReactNode }) => <h2 className="mt-10 text-xl font-extrabold tracking-tight">{children}</h2>
export const P = ({ children }: { children: ReactNode }) => <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{children}</p>
export const L = ({ items }: { items: ReactNode[] }) => (
  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-muted-foreground">
    {items.map((x, i) => <li key={i}>{x}</li>)}
  </ul>
)
export const A = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="font-semibold text-accent underline-offset-4 hover:underline">{children}</Link>
)
