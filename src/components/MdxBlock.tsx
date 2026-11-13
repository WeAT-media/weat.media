import { Megaphone, Info, Sparkles } from 'lucide-react'

/**
 * MDX-блоки Premium-авторов (корпоративный стиль платформы).
 * В прототипе поддержаны компоненты: cta, note и generic.
 */
export default function MdxBlock({ component, text }: { component: string; text: string }) {
  const [first, ...rest] = text.split('\n')

  if (component === 'cta') {
    return (
      <aside className="my-8 border-2 border-accent bg-secondary/70 p-6">
        <p className="meta inline-flex items-center gap-1.5 text-accent">
          <Megaphone size={12} aria-hidden="true" /> MDX · call-to-action
        </p>
        <p className="mt-2 text-lg font-extrabold tracking-tight">{first}</p>
        {rest.length > 0 && <p className="mt-1.5 text-[15px] text-muted-foreground">{rest.join(' ')}</p>}
        <button className="btn-primary mt-4 !px-4 !py-2">Перейти</button>
      </aside>
    )
  }

  if (component === 'note') {
    return (
      <aside className="my-8 border-l-4 border-primary bg-secondary/50 p-5">
        <p className="meta inline-flex items-center gap-1.5">
          <Info size={12} aria-hidden="true" /> MDX · примечание
        </p>
        <p className="mt-2 text-[15px] leading-relaxed">{first}</p>
        {rest.length > 0 && <p className="mt-1 text-sm text-muted-foreground">{rest.join(' ')}</p>}
      </aside>
    )
  }

  return (
    <aside className="my-8 border border-dashed border-border p-5">
      <p className="meta inline-flex items-center gap-1.5 text-accent">
        <Sparkles size={12} aria-hidden="true" /> MDX-компонент «{component}»
      </p>
      <p className="mt-2 text-[15px]">{first}</p>
    </aside>
  )
}
