import { useEffect, useRef, useState } from 'react'

/**
 * Код на странице статьи — Shiki с теми же темами, что у редактора BlockSuite (light-plus / dark-plus),
 * поэтому читатель видит ту же подсветку, что автор. Shiki грузится только возле viewport;
 * пока не загрузился или язык неизвестен — простой <pre>. HTML собирает Shiki из текста с экранированием.
 */

const ALIASES: Record<string, string> = { ts: 'typescript', js: 'javascript', sh: 'bash', shell: 'bash', yml: 'yaml', md: 'markdown', rs: 'rust', py: 'python', 'c++': 'cpp' }

const cache = new Map<string, string>()

async function highlight(code: string, lang: string): Promise<string | null> {
  const key = `${lang}\u0000${code}`
  if (cache.has(key)) return cache.get(key)!
  const { codeToHtml, bundledLanguages } = await import('shiki')
  const id = ALIASES[lang] ?? lang
  if (!(id in bundledLanguages)) return null
  const html = await codeToHtml(code, { lang: id, themes: { light: 'light-plus', dark: 'dark-plus' }, defaultColor: 'light' })
  if (cache.size > 200) cache.delete(cache.keys().next().value!)
  cache.set(key, html)
  return html
}

export default function CodeView({ code, lang }: { code: string; lang?: string }) {
  const holder = useRef<HTMLElement>(null)
  const l = (lang ?? '').trim().toLowerCase()
  const [near, setNear] = useState(() => typeof window !== 'undefined' && !('IntersectionObserver' in window))
  const [html, setHtml] = useState<{ key: string; value: string } | null>(null)
  const key = `${l}\u0000${code}`

  useEffect(() => {
    const el = holder.current
    if (!el || !l || l === 'plain' || l === 'text') return
    if (!('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      setNear(true)
      io.disconnect()
    }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [l])

  useEffect(() => {
    if (!near) return
    let alive = true
    highlight(code, l).then((v) => alive && v && setHtml({ key, value: v }), (e) => console.warn('CodeView', e))
    return () => {
      alive = false
    }
  }, [code, l, key, near])

  return (
    <figure ref={holder} className="code-view my-8 overflow-hidden rounded-md border border-border">
      <figcaption className="meta border-b border-border px-4 py-2">{lang || 'code'}</figcaption>
      {html?.key === key ? (
        <div className="overflow-x-auto text-[13px] leading-relaxed [&_pre]:p-5" dangerouslySetInnerHTML={{ __html: html.value }} />
      ) : (
        <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed">
          <code>{code}</code>
        </pre>
      )}
    </figure>
  )
}
