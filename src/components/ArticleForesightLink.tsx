import type { ComponentProps } from 'react'
import { Link } from 'react-router'
import { prefetchArticle } from '@/lib/prefetch'
import type { Article } from '@/types/types'

type ArticleForesightLinkProps = Omit<ComponentProps<typeof Link>, 'to'> & {
  article: Pick<Article, 'id' | 'atUri' | 'bodyPending'>
}

export default function ArticleForesightLink({ article, onPointerEnter, onFocus, ...props }: ArticleForesightLinkProps) {
  const prefetch = () => prefetchArticle(article.id, article.atUri, article.bodyPending)

  return (
    <Link
      {...props}
      to={`/article/${article.id}`}
      onPointerEnter={(event) => {
        prefetch()
        onPointerEnter?.(event)
      }}
      onFocus={(event) => {
        prefetch()
        onFocus?.(event)
      }}
    />
  )
}
