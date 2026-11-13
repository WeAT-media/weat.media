import { Bookmark, BookmarkCheck } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useStore } from '@/lib/store'

/** Закладка статьи: приватный список читателя (чужих закладок не видно — счётчика нет); гостю — login с возвратом */
export default function BookmarkButton({ articleId, large }: { articleId: string; large?: boolean }) {
  const { user, bookmarks, toggleBookmark } = useStore()
  const navigate = useNavigate()
  const location = useLocation()

  const mine = bookmarks.includes(articleId)

  const onClick = () => {
    if (!user) {
      navigate(`/login?returnTo=${encodeURIComponent(location.pathname)}`)
      return
    }
    toggleBookmark(articleId)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={mine}
      aria-label={mine ? 'Убрать из закладок' : 'В закладки'}
      title={user ? (mine ? 'Убрать из закладок' : 'В закладки') : 'Войдите, чтобы сохранить'}
      className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border font-mono font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        large ? 'px-4 py-2 text-[13px]' : 'px-3 py-1 text-[12px]'
      } ${
        mine
          ? 'border-accent bg-accent text-accent-foreground'
          : 'border-border text-muted-foreground hover:border-accent hover:text-accent'
      }`}
    >
      {mine ? (
        <BookmarkCheck size={large ? 15 : 13} aria-hidden="true" />
      ) : (
        <Bookmark size={large ? 15 : 13} aria-hidden="true" />
      )}
      {mine ? 'В закладках' : 'В закладки'}
    </button>
  )
}
