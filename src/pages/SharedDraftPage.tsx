import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Clock, Users } from 'lucide-react'
import { useStore } from '@/lib/store'
import { renderInline } from '@/lib/inline'
import BlocksEditor from '@/components/BlocksEditor'
import type { ArticleBlock } from '@/types/types'

function blocksToMarkdown(blocks: ArticleBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'h2':
          return `### ${b.text}`
        case 'quote':
          return b.text.split('\n').map((l) => `> ${l}`).join('\n')
        case 'ul':
          return b.text.split('\n').map((l) => `- ${l}`).join('\n')
        case 'code':
          return `\`\`\`${b.lang ?? ''}\n${b.text}\n\`\`\``
        case 'carousel':
          return `:::carousel\n${b.text}\n:::`
        case 'poll':
        case 'mdx':
          return ''
        default:
          return b.text
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

/** Временная ссылка для рецензирования черновика (до публикации) */
export default function SharedDraftPage() {
  const { token } = useParams()
  const { sharedDrafts } = useStore()
  const entry = token ? sharedDrafts[token] : undefined
  const [editedMd, setEditedMd] = useState(() => blocksToMarkdown(entry?.article.blocks ?? []))

  if (!entry) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <p className="meta">Ссылка недействительна</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Черновик не найден</h1>
        <p className="mt-3 text-muted-foreground">
          Временные ссылки живут 24 часа и удаляются после публикации.
        </p>
        <Link to="/feed" className="btn-ghost mt-8">К ленте</Link>
      </div>
    )
  }

  const { article, createdAt } = entry

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 md:px-8">
      <div className="mx-auto max-w-[44rem] pt-10">
        <p className="meta inline-flex items-center gap-1.5 border border-dashed border-accent px-3 py-2 text-accent">
          <Clock size={12} aria-hidden="true" /> Временная ссылка для рецензии · создана{' '}
          {createdAt.slice(0, 16).replace('T', ' ')} · истекает через 24 ч
        </p>
        <h1 className="mt-8 text-[34px] font-extrabold leading-[1.15] tracking-tight md:text-[42px]">
          {article.title}
        </h1>
        {article.subtitle && <p className="mt-3 text-lg text-muted-foreground">{article.subtitle}</p>}
        <p className="meta mt-4">@{article.author.handle} · черновик, в ленте ещё не выходил</p>

        <div className="mt-10">
          {article.blocks.map((b, i) =>
            b.type === 'h2' ? (
              <h2 key={i} className="mt-8 text-2xl font-extrabold tracking-tight">{renderInline(b.text)}</h2>
            ) : b.type === 'code' ? (
              <pre key={i} className="mt-6 overflow-x-auto rounded-md bg-primary p-4 text-[13px] text-primary-foreground"><code>{b.text}</code></pre>
            ) : b.type === 'quote' ? (
              <blockquote key={i} className="my-6 border-l-2 border-accent pl-4 text-[17px] font-medium">{renderInline(b.text)}</blockquote>
            ) : b.type === 'ul' ? (
              <ul key={i} className="mt-5 list-none space-y-1.5">
                {b.text.split('\n').map((item, j) => (
                  <li key={j} className="flex gap-3 text-[16px]">
                    <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-[1px] bg-accent" aria-hidden="true" />
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            ) : b.type === 'poll' || b.type === 'mdx' ? null : (
              <p key={i} className="mt-5 text-[17px] leading-[1.75]">{renderInline(b.text)}</p>
            ),
          )}
        </div>

        {/* Совместное редактирование: Yjs-комната по токену ссылки, синхронизация между вкладками */}
        <div className="rule mt-12 pt-8">
          <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
            <Users size={14} className="text-accent" aria-hidden="true" /> Совместное редактирование
          </h2>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            Откройте эту ссылку в соседней вкладке — правки синхронизируются через Yjs-комнату «{token}»
            (BroadcastChannel). Честно: это работает только между вкладками этого браузера; для сетевого
            соавторства между устройствами нужен sync server (y-websocket), которого в прототипе нет.
            Изменения здесь не меняют исходный черновик автора.
          </p>
          <div className="mt-5">
            <BlocksEditor value={blocksToMarkdown(article.blocks)} onChange={setEditedMd} roomId={token} />
          </div>
          {editedMd.trim() && (
            <p className="meta mt-3">
              в комнате сейчас: {editedMd.trim().split(/\s+/).length} слов · сериализовано в markdown
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
