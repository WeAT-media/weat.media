import { Link } from 'react-router'
import { SITE_NAME } from '@/config/site'

/** Страница бота: на неё ведёт User-Agent краулера (WeatMediaCrawler/… (+https://weat.media/crawler)) */
export default function CrawlerInfoPage() {
  const code = 'rounded bg-secondary px-1.5 py-0.5 font-mono text-[13px]'
  return (
    <div className="mx-auto max-w-[760px] px-5 pb-24 pt-12 md:px-8">
      <p className="meta">Для владельцев сайтов</p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-tight">WeatMediaCrawler</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        Краулер {SITE_NAME} собирает открытые публикации со ссылкой на источник, чтобы их можно было читать и обсуждать в
        ATmosphere. Автор оригинала может забрать свои статьи себе.
      </p>

      <h2 className="mt-10 text-xl font-bold">Как узнать бота</h2>
      <p className="mt-2 text-muted-foreground">
        User-Agent: <code className={code}>WeatMediaCrawler/0.1 (+https://weat.media/crawler)</code>. Запросы идут с отдельного сервера, не
        чаще одного раза в пару секунд, и только к страницам, на которые есть ссылка в вашей RSS-ленте или которые
        добавил сотрудник.
      </p>

      <h2 className="mt-8 text-xl font-bold">Как запретить обход</h2>
      <p className="mt-2 text-muted-foreground">
        Краулер соблюдает <code className={code}>robots.txt</code> (RFC 9309): своя группа важнее «*», действует самое длинное совпадение.
        Запретить весь сайт:
      </p>
      <pre className="mt-3 overflow-x-auto border border-border bg-secondary/40 p-4 font-mono text-[13px]">{`User-agent: WeatMediaCrawler
Disallow: /`}</pre>
      <p className="mt-2 text-sm text-muted-foreground">Изменения подхватываются в течение часа. Уже собранное по запросу удалим — напишите нам.</p>

      <h2 className="mt-8 text-xl font-bold">Это ваши статьи?</h2>
      <p className="mt-2 text-muted-foreground">
        На странице статьи нажмите «Я автор оригинала» и разместите выданный код в профиле на своём сайте — после проверки
        статьи перейдут в ваш аккаунт. Подробнее —{' '}
        <Link to="/" className="text-accent underline underline-offset-4">на главной</Link>.
      </p>

      <h2 className="mt-8 text-xl font-bold">Связаться</h2>
      <p className="mt-2 text-muted-foreground">
        <Link to="/support/contact" className="text-accent underline underline-offset-4">Форма поддержки</Link> или{' '}
        <a href="mailto:support@weat.media" className="text-accent underline underline-offset-4">support@weat.media</a>; запросы
        правообладателей — <a href="mailto:legal@weat.media" className="text-accent underline underline-offset-4">legal@weat.media</a>.
      </p>
    </div>
  )
}
