import { Link } from 'react-router'
import { ArrowLeft, ArrowUpRight, BookOpen, Hourglass, KeyRound, PenLine, Share2 } from 'lucide-react'
import Reveal from '@/components/Reveal'
import { SITE_NAME } from '@/config/site'

const sections = [
  {
    id: 'quickstart',
    icon: BookOpen,
    title: 'Быстрый старт',
    body: [
      `${SITE_NAME} — читательская платформа поверх AT Protocol: записи живут в репозиториях авторов, площадка лишь агрегирует ленту. Чтобы опубликовать первую запись, войдите через свой PDS-handle и откройте «Написать».`,
      'Публикация появляется в ленте сразу; отложенный пост выйдет автоматически в указанную дату (publishAt). В сеть AT Protocol запись уходит через 24 часа — см. «Период охлаждения».',
    ],
  },
  {
    id: 'auth',
    icon: KeyRound,
    title: 'Авторизация',
    body: [
      'Вход — через AT Protocol handle или соцсети. Идентичность переносима: смена площадки не отнимает подписчиков и историю — они привязаны к вашему DID, а не к аккаунту на конкретной площадке.',
      'В этом прототипе сессия создаётся локально и хранится в localStorage браузера; реальный OAuth-танец не выполняется.',
    ],
  },
  {
    id: 'publishing',
    icon: PenLine,
    title: 'Публикации',
    body: [
      'Текст пишется в мини-markdown: ### заголовок, > цитата, ``` код, - списки. У записи есть язык, теги (свои разрешены — попадают в фильтр ленты) и необязательный пейволл: 90% — автору, 10% — инфраструктура.',
      'Перепечатка: если статья уже выходила (на другой площадке или в блоге), отметьте это на шаге «Публикация» и укажите ссылку на оригинал и дату. Они попадут в саму запись (source) — на странице статьи будет «Впервые опубликовано … · оригинал · архив». Даже если оригинал удалят, ссылка на его копию в Wayback Machine останется.',
      'Видео добавляется ссылкой или локальным файлом (файл не покидает вкладку). У платного видео можно задать бесплатное превью в секундах, у платного текста — тизер до пейволла. В описании видео работают таймкоды 00:00 / 1:02:10.',
    ],
  },
  {
    id: 'cooldown',
    icon: Hourglass,
    title: 'Период охлаждения',
    body: [
      'Статьи и комментарии, опубликованные с сайта, первые 24 часа видны только на weAT.media: в ленте, на странице статьи и в обсуждении. В ваш AT-репозиторий — а значит в Bluesky, релеи и другие приложения сети — запись уходит, когда эти 24 часа пройдут. Досрочно отправить нельзя.',
      'Зачем: в сети AT запись разлетается по релеям и чужим AppView за секунды, и удалить её оттуда полностью уже невозможно. Пока идёт охлаждение, вы можете спокойно исправить статью или удалить её целиком — в сети от неё не останется следа. У статьи и комментария в этот период стоит пометка «в сеть — …» с точным временем.',
      'Отложенный пост: охлаждение считается от выхода. Статья с публикацией на 10:00 появится на сайте в 10:00, а в AT уйдёт на следующий день в 10:00. До выхода её видите только вы.',
      'Адрес записи (at://…) выдаётся сразу и после ухода в сеть не меняется: ссылки, лайки и комментарии на сайте продолжают работать. Для отправки сервер один раз создаёт в вашем аккаунте пароль приложения «weat-cooldown»; его можно отозвать в настройках безопасности, тогда новые записи будут ждать, пока вы снова не опубликуете что-нибудь с сайта.',
      'Модерация: модераторы видят записи в охлаждении и могут поставить на них метку коллегии — она будет действовать и после ухода в сеть. Менять или удалять вашу запись модераторы не могут. Записи, созданные напрямую в репозитории (через Bluesky, API PDS или токен /v1), охлаждение не проходят.',
    ],
  },
  {
    id: 'atproto',
    icon: Share2,
    title: 'AT Protocol',
    body: [
      'Записи — документы в репозитории автора, подписанные его ключом. Спорный контент разбирают коллегии присяжных: вердикт — это подписанная метка labeler-сервиса, а не удаление. Читатель сам выбирает, как поступать с метками: скрывать, предупреждать или игнорировать.',
      'Программный доступ к тем же операциям — через XRPC-эндпоинты, описанные на странице API.',
    ],
  },
]

/** Документация платформы: быстрый старт, авторизация, публикации, ATProto */
export default function DocsPage() {
  return (
    <div className="mx-auto max-w-[860px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/feed"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Лента
        </Link>
        <p className="meta mt-8">Документация · prototype v0</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Как устроена {SITE_NAME}</h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Короткое руководство по платформе: как начать писать, как устроены вход, публикации и модерация
          через коллегии присяжных.
        </p>
      </div>

      <nav aria-label="Разделы документации" className="mt-8 flex flex-wrap gap-2">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-border px-3 py-1 font-mono text-[12px] font-semibold tracking-[0.04em] transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {s.title}
          </a>
        ))}
        <Link
          to="/api"
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 font-mono text-[12px] font-semibold tracking-[0.04em] text-accent transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          API <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      </nav>

      <div className="mt-10">
        {sections.map((s) => (
          <Reveal key={s.id}>
            <section id={s.id} className="rule scroll-mt-24 py-8 first:border-t-0 first:pt-2" aria-label={s.title}>
              <h2 className="inline-flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
                <s.icon size={17} className="text-accent" aria-hidden="true" /> {s.title}
              </h2>
              {s.body.map((p, i) => (
                <p key={i} className="mt-3 max-w-[66ch] text-[15px] leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
            </section>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-6 border border-border bg-secondary/40 p-6">
        <p className="meta">Для разработчиков</p>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed">
          Всё, что умеет интерфейс, доступно программно: создание записей, отложенные посты, подборки, опросы.
          Эндпоинты, токены и примеры — на странице{' '}
          <Link to="/api" className="font-semibold text-accent underline-offset-4 hover:underline">
            API публикаций
          </Link>
          .
        </p>
      </Reveal>
    </div>
  )
}
