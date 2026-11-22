import { useMemo } from 'react'
import { renderInline } from '@/lib/inline'
import { parseTimeline } from '@/lib/timeline'

export default function TimelineView({ raw }: { raw: string }) {
  const timeline = useMemo(() => parseTimeline(raw), [raw])
  if (!timeline) return null
  const horizontal = timeline.orientation === 'horizontal'
  return (
    <section className="my-10" aria-label={timeline.title || 'Хронология'}>
      {timeline.title && <h2 className="text-2xl font-extrabold tracking-tight">{timeline.title}</h2>}
      <ol
        className={horizontal
          ? 'mt-6 flex snap-x gap-0 overflow-x-auto pb-4'
          : 'mt-6 ml-2 space-y-8 border-l border-border pl-7'}
      >
        {timeline.items.map((item, index) => (
          <li
            key={index}
            className={horizontal
              ? 'relative w-72 shrink-0 snap-start border-t border-border pr-8 pt-6'
              : 'relative'}
          >
            <span
              aria-hidden="true"
              className={horizontal
                ? 'absolute -top-[5px] left-0 h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-background'
                : 'absolute -left-[33px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-background'}
            />
            {item.date && <time className="meta !normal-case tracking-normal text-accent">{item.date}</time>}
            {item.title && <h3 className="mt-1.5 text-lg font-bold leading-snug">{item.title}</h3>}
            {item.text && (
              <div className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                {item.text.split(/\n+/).map((paragraph, i) => <p key={i} className={i ? 'mt-2' : ''}>{renderInline(paragraph)}</p>)}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
