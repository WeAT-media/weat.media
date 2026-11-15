import { ArrowBigUp } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useStore } from '@/lib/store'
import { upvoteCount } from '@/lib/analytics'
import { useI18n } from '@/lib/i18n'

export default function UpvoteButton({ articleId, commentId, large }: { articleId?: string; commentId?: string; large?: boolean }) {
  const { user, upvotes, toggleUpvote, articles } = useStore()
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const key = commentId ? `comment:${commentId}` : articleId!
  const mine = upvotes.includes(key)
  const article = commentId ? undefined : articles.find((a) => a.id === articleId)
  const count = article ? upvoteCount(article, mine) : mine ? 1 : 0
  const action = mine ? t('removeVote') : commentId ? t('upvoteComment') : t('upvotePost')
  const onClick = () => {
    if (!user) { navigate(`/login?returnTo=${encodeURIComponent(location.pathname)}`); return }
    toggleUpvote(key)
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={mine} aria-label={`${action}. ${t('votesNow', count)}`} title={user ? action : t('loginToVote')} className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border font-mono font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${large ? 'px-4 py-2 text-[13px]' : commentId ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-[12px]'} ${mine ? 'border-accent bg-accent text-accent-foreground' : 'border-border text-foreground hover:border-accent hover:text-accent'}`}>
      <ArrowBigUp size={large ? 15 : 13} aria-hidden="true" />{count}
    </button>
  )
}
