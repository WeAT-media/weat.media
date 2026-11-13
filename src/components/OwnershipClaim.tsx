import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { BadgeCheck, Copy } from 'lucide-react'
import { claims, hasSession, type OwnershipClaim as Claim } from '@/lib/api'
import type { Article } from '@/types/types'

const STATUS: Record<Claim['status'], string> = {
  pending: 'на проверке',
  approved: 'авторство подтверждено',
  rejected: 'отклонена',
  transferred: 'статьи перенесены в ваш аккаунт',
}

/** «Я автор оригинала» у импортированной статьи: заявка, код для профиля на сайте, статус */
export default function OwnershipClaim({ article }: { article: Article }) {
  const [claim, setClaim] = useState<Claim | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const site = article.source?.label ?? 'сайте-источнике'
  const logged = hasSession()

  // уже подавали — показываем статус: по этой статье или по автору с того же сайта
  useEffect(() => {
    if (!logged || !article.atUri) return
    let alive = true
    claims.mine().then(
      (list) => alive && setClaim(list.find((c) => c.articleUri === article.atUri || (c.sourceAuthor && c.sourceSite === article.source?.label && c.sourceAuthor === article.author.name)) ?? null),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [logged, article.atUri, article.source?.label, article.author.name])

  if (!article.atUri) return null
  if (!logged) {
    return (
      <Link to={`/login?returnTo=${encodeURIComponent(`/article/${article.id}`)}`} className="meta text-accent underline-offset-4 hover:underline">
        Вы автор? Войдите, чтобы подтвердить
      </Link>
    )
  }

  if (!claim) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              setClaim(await claims.create(article.atUri!))
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Не удалось подать заявку')
            } finally {
              setBusy(false)
            }
          }}
          className="btn-ghost !px-3 !py-1.5 !text-[11px]"
        >
          <BadgeCheck size={12} aria-hidden="true" /> Я автор оригинала
        </button>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="w-full border-t border-border pt-3 text-sm" role="status">
      <p className="font-semibold">
        Заявка на авторство · {STATUS[claim.status]}
      </p>
      {claim.status === 'pending' && (
        <>
          <p className="mt-1 text-muted-foreground">
            {claim.sourceAuthor ? (
              <>
                Добавьте код в профиль <b>{claim.sourceAuthor}</b> на {claim.sourceSite} (поле «О себе»). После проверки все статьи этого автора,
                собранные краулером, перейдут в ваш аккаунт.
              </>
            ) : (
              <>У источника нет автора — заявка касается только этой статьи. Разместите код на {claim.sourceSite} так, чтобы было видно, что это вы, или ответьте поддержке.</>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs">{claim.code}</code>
            <button type="button" className="btn-ghost !px-2 !py-1 !text-[11px]" onClick={() => navigator.clipboard.writeText(claim.code).then(() => setCopied(true), () => {})}>
              <Copy size={11} aria-hidden="true" /> {copied ? 'скопировано' : 'копировать'}
            </button>
            {claim.sourceAuthorUrl && (
              <a href={claim.sourceAuthorUrl} target="_blank" rel="noopener noreferrer" className="meta text-accent underline-offset-4 hover:underline">
                профиль на {site}
              </a>
            )}
          </div>
        </>
      )}
      {claim.status === 'rejected' && claim.decisionNote && <p className="mt-1 text-muted-foreground">Причина: {claim.decisionNote}</p>}
    </div>
  )
}
