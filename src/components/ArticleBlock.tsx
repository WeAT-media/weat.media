import { renderInline } from '@/lib/inline'
import { safeHref, safeImageSrc } from '@/lib/safeUrl'
import ArticleCarousel from '@/components/ArticleCarousel'
import CalloutView from '@/components/CalloutView'
import UserBlockView from '@/components/UserBlockView'
import InteractiveVideo from '@/components/InteractiveVideo'
import FaqView from '@/components/FaqView'
import ActionButtonView from '@/components/ActionButtonView'
import type { ArticleBlock } from '@/types/types'

/**
 * Один блок статьи. Общий для страницы статьи и предпросмотра в редакторе — чтобы автор видел ровно то,
 * что увидит читатель. Опросы и mdx рисует вызывающий: у них своё состояние (голоса, компонент).
 */
export default function Block({ block, id }: { block: ArticleBlock; id?: string }) {
  if (block.type === 'poll' || block.type === 'mdx') return null
  if (block.type === 'carousel') return <ArticleCarousel raw={block.text} />
  if (block.type === 'callout') return <CalloutView raw={block.text} />
  if (block.type === 'userblock') return <UserBlockView raw={block.text} />
  if (block.type === 'ivideo') return <InteractiveVideo raw={block.text} />
  if (block.type === 'faq') return <FaqView raw={block.text} />
  if (block.type === 'button') return <ActionButtonView raw={block.text} />
  if (block.type === 'bookmark') return <BookmarkCard raw={block.text} />
  if (block.type === 'h2') {
    // id — якорь для TOC; scroll-mt под sticky-шапку (~64px)
    return <h2 id={id} className="mt-10 scroll-mt-28 text-2xl font-extrabold tracking-tight">{renderInline(block.text)}</h2>
  }
  if (block.type === 'code') {
    return (
      <figure className="my-8">
        <figcaption className="meta mb-0 rounded-t-md border border-b-0 border-border bg-[hsl(var(--code-bg))] px-4 py-2 text-[hsl(var(--code-muted))]">
          {block.lang ?? 'code'}
        </figcaption>
        <pre className="overflow-x-auto rounded-b-md border border-t-0 border-border bg-[hsl(var(--code-bg))] p-5 text-[13px] leading-relaxed text-[hsl(var(--code-fg))]">
          <code>{block.text}</code>
        </pre>
      </figure>
    )
  }
  if (block.type === 'image') {
    const src = safeImageSrc(block.text)
    if (!src) return null
    return (
      <figure className="my-8">
        <img src={src} alt={block.alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md border border-border" />
        {block.alt && <figcaption className="meta mt-2 text-center !normal-case tracking-normal">{block.alt}</figcaption>}
      </figure>
    )
  }
  if (block.type === 'quote') {
    return (
      <blockquote className="my-8 border-l-2 border-accent pl-5 text-[17px] font-medium leading-relaxed">
        {renderInline(block.text)}
      </blockquote>
    )
  }
  if (block.type === 'ul') {
    return (
      <ul className="mt-5 list-none space-y-1.5">
        {block.text.split('\n').map((item, i) => (
          <li key={i} className="flex gap-3 text-[16px] leading-relaxed">
            <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-[1px] bg-accent" aria-hidden="true" />
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    )
  }
  return <p className="mt-5 text-[17px] leading-[1.75]">{renderInline(block.text)}</p>
}

/** карточка ссылки из редактора («/link»): заголовок, описание, картинка — как в BlockSuite */
function BookmarkCard({ raw }: { raw: string }) {
  let b: { url?: string; title?: string; description?: string; icon?: string; image?: string } = {}
  try {
    b = JSON.parse(raw)
  } catch {
    return null
  }
  const href = safeHref(b.url ?? '')
  if (!href) return null
  const host = (() => {
    try {
      return new URL(href).hostname.replace(/^www\./, '')
    } catch {
      return href
    }
  })()
  const img = b.image ? safeImageSrc(b.image) : undefined
  const icon = b.icon ? safeImageSrc(b.icon) : undefined
  return (
    <a href={href} target="_blank" rel="noreferrer" className="mt-5 flex overflow-hidden rounded-lg border border-border bg-secondary/40 transition-colors hover:border-accent">
      <span className="flex min-w-0 flex-1 flex-col gap-1 p-4">
        <span className="flex min-w-0 items-center gap-2 font-semibold">
          {icon && <img src={icon} alt="" className="h-4 w-4 shrink-0" loading="lazy" referrerPolicy="no-referrer" />}
          <span className="truncate">{b.title || host}</span>
        </span>
        {b.description && <span className="line-clamp-2 text-sm text-muted-foreground">{b.description}</span>}
        <span className="meta mt-auto truncate !normal-case tracking-normal text-accent">{host}</span>
      </span>
      {img && <img src={img} alt="" className="hidden w-40 shrink-0 object-cover sm:block" loading="lazy" referrerPolicy="no-referrer" />}
    </a>
  )
}
