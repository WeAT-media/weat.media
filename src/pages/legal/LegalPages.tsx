import { Link, Navigate, useParams } from 'react-router'
import { ArrowLeft, FileText } from 'lucide-react'
import { SITE_NAME } from '@/config/site'
import { LEGAL_DOCS, LEGAL_VERSION } from './documents'

const back = 'inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent'

/** /legal — список документов */
export function LegalIndexPage() {
  return (
    <div className="mx-auto max-w-[860px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <p className="meta">Правовая информация</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Документы {SITE_NAME}</h1>
        <p className="mt-4 text-[15px] text-muted-foreground">Действующая редакция от {LEGAL_VERSION}.</p>
      </div>
      <ul className="mt-10 divide-y divide-border border-y border-border">
        {LEGAL_DOCS.map((d) => (
          <li key={d.slug}>
            <Link to={`/legal/${d.slug}`} className="group flex gap-3 py-5">
              <FileText size={16} className="mt-1 shrink-0 text-accent" aria-hidden="true" />
              <span>
                <span className="block font-bold underline-offset-4 group-hover:text-accent group-hover:underline">{d.title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{d.summary}</span>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link to="/support/legal" className="group flex gap-3 py-5">
            <FileText size={16} className="mt-1 shrink-0 text-accent" aria-hidden="true" />
            <span>
              <span className="block font-bold underline-offset-4 group-hover:text-accent group-hover:underline">Запросы официальных органов</span>
              <span className="mt-1 block text-sm text-muted-foreground">Канал для запросов с правовым основанием.</span>
            </span>
          </Link>
        </li>
      </ul>
    </div>
  )
}

/** /legal/:slug — один документ */
export function LegalDocPage() {
  const { slug } = useParams()
  const doc = LEGAL_DOCS.find((d) => d.slug === slug)
  if (!doc) return <Navigate to="/legal" replace />
  return (
    <div className="mx-auto max-w-[760px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link to="/legal" className={back}>
          <ArrowLeft size={13} aria-hidden="true" /> Все документы
        </Link>
        <p className="meta mt-8">Редакция от {LEGAL_VERSION}</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">{doc.title}</h1>
      </div>
      <article className="mt-6">{doc.body}</article>
    </div>
  )
}
