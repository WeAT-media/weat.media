import type { ComponentProps } from 'react'
import { Link } from 'react-router'
import { useForesight } from '@foresightjs/react'
import { prefetchArticle } from '@/lib/prefetch'
import type { Article } from '@/types/types'

type ArticleForesightLinkProps = Omit<ComponentProps<typeof Link>, 'to'> & {
  article: Pick<Article, 'id' | 'atUri' | 'bodyPending'>
}

export default function ArticleForesightLink({ article, ...props }: ArticleForesightLinkProps) {
  const { elementRef } = useForesight<HTMLAnchorElement>({
    callback: () => prefetchArticle(article.id, article.atUri, article.bodyPending),
    hitSlop: 24,
    name: `article:${article.id}`,
    reactivateAfter: 5 * 60 * 1000,
  })

  return <Link {...props} ref={elementRef} to={`/article/${article.id}`} />
}
