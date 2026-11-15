import { Bookmark, BookmarkCheck } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useStore } from '@/lib/store'
import { useI18n } from '@/lib/i18n'

export default function BookmarkButton({ articleId, large }: { articleId: string; large?: boolean }) {
  const { user, bookmarks, toggleBookmark } = useStore()
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const mine = bookmarks.includes(articleId)
  const label = mine ? t('removeBookmark') : t('bookmark')
  const onClick = () => {
    if (!user) { navigate(`/login?returnTo=${encodeURIComponent(location.pathname)}`); return }
    toggleBookmark(articleId)
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={mine} aria-label={label} title={user ? label : t('loginToSave')} className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border font-mono font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${large ? 'px-4 py-2 text-[13px]' : 'px-3 py-1 text-[12px]'} ${mine ? 'border-accent bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:border-accent hover:text-accent'}`}>
      {mine ? <BookmarkCheck size={large ? 15 : 13} aria-hidden="true" /> : <Bookmark size={large ? 15 : 13} aria-hidden="true" />}
      {mine ? t('bookmarked') : t('bookmark')}
    </button>
  )
}
