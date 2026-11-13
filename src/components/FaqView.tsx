import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { renderInline } from '@/lib/inline'
import { parseFaq } from '@/lib/faq'

/** FAQ в статье: раскрывающиеся ответы (видны всем читателям) + разметка FAQPage для поисковиков */
export default function FaqView({ raw }: { raw: string }) {
  const faq = useMemo(() => parseFaq(raw), [raw])
  if (!faq) return null
  // JSON-LD: текст экранируется JSON.stringify; «</» разбиваем, чтобы не закрыть <script>
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.items.map((it) => ({ '@type': 'Question', name: it.q, acceptedAnswer: { '@type': 'Answer', text: it.a } })),
  }).replace(/</g, '\\u003c')
  return (
    <section className="my-10" aria-label={faq.title || 'Частые вопросы'}>
      {faq.title && <h2 className="text-2xl font-extrabold tracking-tight">{faq.title}</h2>}
      <div className="mt-4 divide-y divide-border border-y border-border">
        {faq.items.map((it, i) => (
          <details key={i} className="group py-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 text-[17px] font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
              {it.q}
              <ChevronDown size={18} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="pb-4 text-[16px] leading-relaxed text-muted-foreground">
              {it.a.split(/\n+/).map((p, n) => (
                <p key={n} className={n ? 'mt-2' : ''}>{renderInline(p)}</p>
              ))}
            </div>
          </details>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
    </section>
  )
}
