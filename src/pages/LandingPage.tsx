import { Link } from 'react-router'
import { ArrowRight, Check, Landmark, ShieldCheck } from 'lucide-react'
import { useStore } from '@/lib/store'
import { PerkCard, Press, Reveal, WordReveal } from '@/components/motion/Motion'
import { ClapperIcon, GavelIcon, PeopleIcon, ScaleIcon, SparkleIcon, WriteIcon } from '@/components/motion/AnimatedIcons'
import { SITE_NAME } from '@/config/site'
import FeeNote from '@/components/FeeNote'

const features = [
  {
    icon: PeopleIcon,
    title: 'Сообщество людей, не корпораций',
    text: 'Здесь не решает корпоративный модератор и не работает рекламный алгоритм. Записи принадлежат авторам и хранятся в их личном архиве публикаций — площадка лишь собирает ленту.',
  },
  {
    icon: Landmark,
    title: 'Честная экономика: 90/10 и 99/1',
    text: 'Платные посты и видео: 90%* каждой продажи — автору, 10% — инфраструктуре. Premium-автору — 99%*, площадке — 1%. У платного видео есть бесплатное превью, у платной статьи — тизер: покупка осознанная.',
    fee: true,
  },
  {
    icon: GavelIcon,
    title: 'Суд присяжных вместо произвола',
    text: 'Спорные записи разбирает случайная коллегия из читателей с репутацией. Вердикт — это открытая пометка, а не удаление. Бан не решается произволом модератора: действуют закон и региональные ограничения по судебным решениям, а спорное — решают присяжные, открыто и с возможностью апелляции.',
  },
  {
    icon: ScaleIcon,
    title: 'Модерация по подписке',
    text: 'Коллегии — независимые службы модерации, чьи пометки вы выбираете сами: скрывать такое, предупреждать или игнорировать. Два читателя одной платформы могут жить в двух разных модерациях — и оба правы.',
  },
  {
    icon: SparkleIcon,
    title: 'Premium: расширенные блоки и ноль рекламы',
    text: 'Подписчики Premium получают особые интерактивные блоки в записях (callout-заметки, кнопки, виджеты) с настройкой редактора, открытую аналитику статей с сигналами анти-накрутки, ранний доступ к новым функциям и полное отсутствие рекламы в ленте.',
  },
  {
    icon: ClapperIcon,
    title: 'Видео, опросы, карусели',
    text: 'Видео-записи с таймкодами и превью для платных, опросы с настройкой круга голосующих, карусели изображений и совместное редактирование черновиков — всё в редакторе.',
  },
]

const steps = [
  {
    n: '1',
    title: 'Читайте без регистрации',
    text: 'Лента открыта всем. Фильтруйте по тегам, языку и типу — или доверьтесь дайджесту «Горячее».',
  },
  {
    n: '2',
    title: 'Войдите своим ATmosphere-аккаунтом',
    text: 'Один аккаунт на всю экосистему: он принадлежит вам, а не площадке, и переезжает вместе с вами.',
  },
  {
    n: '3',
    title: 'Пишите и зарабатывайте',
    text: 'Тексты, видео, курсы. 90%* с каждой продажи — вам, с Premium — 99%*. Выплаты на ваши реквизиты.',
    fee: true,
  },
]

const faq = [
  ['Что такое weAT.media?', 'Независимая платформа статей и видео на открытом AT Protocol. Читать публикации можно без регистрации, а авторам доступны продажи и аналитика.'],
  ['Кому принадлежат публикации и аккаунт?', 'Автору. Записи хранятся в его репозитории на PDS. При смене приложения или сервера сохраняются постоянный идентификатор, публикации и аудитория.'],
  ['Сколько зарабатывает автор?', 'Автор получает 90% с продаж платных материалов, а с подпиской Premium — 99%. Перед покупкой читатель видит бесплатный тизер или превью.'],
  ['Как работает модерация?', 'Спорные публикации получают открытые метки по решению коллегии присяжных. Читатель сам выбирает службы модерации и решает, скрывать ли помеченные материалы.'],
] as const

/** Лендинг: что это за площадка, кому и почему */
export default function LandingPage() {
  const { user } = useStore()

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      {/* Hero */}
      <section className="grid items-center gap-10 pb-16 pt-12 md:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] md:pb-20 md:pt-20">
        <div>
          <p className="meta inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" /> Независимая платформа для авторов и читателей</p>
          <WordReveal text="Ваши тексты. Ваши читатели. Ваши правила." accentFrom={4} className="mt-5 max-w-[13ch] text-[40px] font-extrabold leading-[1.03] tracking-tight sm:text-5xl md:text-7xl" />
          <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-muted-foreground md:text-xl">
            Публикуйте статьи и видео, получайте до 99% с продаж и забирайте аудиторию с собой — благодаря открытому AT Protocol.
          </p>
          <Reveal delay={0.2} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Press>
              <Link to="/feed" className="btn-primary w-full justify-center !px-6 !py-3 !text-sm sm:w-auto">
                Читать без регистрации <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </Press>
            <Press>
              <Link to={user ? '/compose' : '/login?returnTo=/compose'} className="btn-ghost w-full justify-center !px-6 !py-3 !text-sm sm:w-auto">
                <WriteIcon /> Начать публиковать
              </Link>
            </Press>
          </Reveal>
          <p className="mt-4 text-sm text-muted-foreground">Уже есть аккаунт ATmosphere? <Link to="/login" className="font-semibold text-accent underline-offset-4 hover:underline">Войти</Link></p>
        </div>
        <Reveal delay={0.15} className="border border-border bg-secondary/40 p-6 md:p-7">
          <p className="meta text-accent">Свобода без мелкого шрифта</p>
          <ul className="mt-5 space-y-5">
            {[
              ['Контент принадлежит вам', 'Публикации хранятся в вашем личном репозитории.'],
              ['90–99% автору', 'Понятная комиссия и бесплатный тизер платных материалов.'],
              ['Никакого чёрного ящика', 'Лента, модерация и вердикты — открыты и настраиваются.'],
            ].map(([title, text]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Check size={14} strokeWidth={2.5} aria-hidden="true" /></span>
                <div><h2 className="font-bold leading-snug">{title}</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p></div>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-5 text-sm font-semibold">
            <Link to="/atmosphere" className="inline-flex items-center gap-1 text-accent hover:underline">Как устроен AT Protocol <ArrowRight size={13} aria-hidden="true" /></Link>
            <Link to="/premium" className="inline-flex items-center gap-1 hover:text-accent">О Premium <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
        </Reveal>
      </section>

      {/* Как это работает — 3 простых шага */}
      <section className="mt-20" aria-label="Как это работает">
        <p className="meta">Как это работает</p>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.12} className="rule pt-6">
              <p className="font-mono text-3xl font-bold text-accent">{s.n}</p>
              <h2 className="mt-3 text-lg font-extrabold tracking-tight">{s.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
              {'fee' in s && s.fee && <FeeNote className="mt-2" />}
            </Reveal>
          ))}
        </div>
      </section>

      {/* Переезд: свой блог из ATmosphere и статьи, которые собрал краулер */}
      <section className="mt-20" aria-labelledby="move-title">
        <p className="meta">Переезд без потерь</p>
        <h2 id="move-title" className="mt-3 max-w-[24ch] text-3xl font-extrabold tracking-tight md:text-4xl">
          Переезжайте со своим блогом — тексты и читатели остаются с вами
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Reveal className="border border-border p-6 md:p-7">
            <p className="meta text-accent">Из Bluesky и других приложений AT</p>
            <h3 className="mt-3 text-xl font-extrabold tracking-tight">Импорт постов в черновики</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              Войдите своим AT-аккаунтом (bsky.social или собственный сервер) — аккаунт останется тем же. В настройках →
              «Импорт постов» ваши посты станут черновиками: первый абзац — заголовок, ссылки и картинки на месте.
              Ничего не публикуется само: вы просматриваете каждый пост, правите и выпускаете.
            </p>
            <Link to="/login" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
              Войти через AT-аккаунт <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </Reveal>
          <Reveal delay={0.12} className="border border-accent/50 bg-secondary/40 p-6 md:p-7">
            <p className="meta text-accent">Ваши статьи уже здесь</p>
            <h3 className="mt-3 text-xl font-extrabold tracking-tight">Заберите статьи у краулера</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              Краулер {SITE_NAME} собирает открытые публикации со ссылкой на источник и хранит их в служебном аккаунте
              <span className="font-mono text-foreground"> crawler.weat.media</span>. Если статья ваша, права на неё
              переходят к вам:
            </p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-muted-foreground">
              <li>
                на странице статьи нажмите <b className="text-foreground">«Я автор оригинала»</b> — или напишите в{' '}
                <Link to="/support/contact" className="text-accent underline underline-offset-4">поддержку</Link>;
              </li>
              <li>подтвердите, что это вы: разместите выданный код в своём профиле на исходном сайте;</li>
              <li>после проверки нажмите «Забрать статьи» — они перейдут в ваш аккаунт со ссылкой на оригинал, а старые адреса откроют их у вас.</li>
            </ol>
            <p className="mt-3 text-sm text-muted-foreground">
              Подтвердили автора — к вам переходят все его статьи, которые собрал краулер, а не только одна.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Преимущества */}
      <section className="mt-20" aria-label="Преимущества">
        <p className="meta">Почему так устроено</p>
        <div className="mt-6 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <PerkCard key={f.title} index={i}>
              <f.icon size={36} className="text-accent" />
              <h2 className="mt-5 text-2xl font-extrabold leading-snug tracking-tight">{f.title}</h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{f.text}</p>
              {'fee' in f && f.fee && <FeeNote className="mt-2" />}
              {f.icon === SparkleIcon && (
                <Link to="/premium" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
                  Подробнее о Premium <ArrowRight size={13} aria-hidden="true" />
                </Link>
              )}
            </PerkCard>
          ))}
        </div>
      </section>

      {/* Что разрешено и что спорно */}
      <Reveal className="mt-20 border border-border bg-secondary/40 p-7 md:p-10">
        <p className="meta inline-flex items-center gap-1.5">
          <ShieldCheck size={12} aria-hidden="true" /> Правила без произвола
        </p>
        <h2 className="mt-3 text-2xl font-extrabold tracking-tight md:text-3xl">
          Что разрешено — решаете вы. Что спорно — решает суд
        </h2>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Разрешено всё, что не нарушает закон: мнения, разборы, курсы, репосты со ссылкой на источник. Спорное —
            недостоверность, плагиат, накрутки — выносится на открытое разбирательство с кворумом, публичной
            хронологией и апелляцией. Вердикт не удаляет запись: это пометка, а её действие настраивает каждый
            читатель.
          </p>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Закон обязателен для всех: региональные ограничения применяются по судебным решениям и действуют только
            в указанных регионах. «Бан» здесь — не рычаг модератора, а открытый процесс: пометку выдаёт коллегия,
            её можно оспорить на апелляции, а автор в любой момент может переехать на другой сервер, не теряя
            читателей.
          </p>
        </div>
      </Reveal>

      <section className="mt-20" aria-labelledby="faq-title">
        <p className="meta">Коротко о главном</p>
        <h2 id="faq-title" className="mt-3 text-3xl font-extrabold tracking-tight">Частые вопросы</h2>
        <div className="mt-6 divide-y divide-border border-y border-border">
          {faq.map(([question, answer]) => (
            <details key={question} className="group py-2">
              <summary className="cursor-pointer list-none py-4 text-lg font-bold marker:hidden [&::-webkit-details-marker]:hidden">{question}</summary>
              <p className="max-w-[70ch] pb-5 text-[15px] leading-relaxed text-muted-foreground">{answer}</p>
            </details>
          ))}
        </div>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })) }).replace(/</g, '\\u003c') }} />
      </section>

      {/* CTA */}
      <Reveal className="mt-20 text-center">
        <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">Читайте людей, а не ленту алгоритма</h2>
        <p className="mx-auto mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
          Лента открыта без регистрации. Авторство — через ваш ATmosphere-аккаунт.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Press>
            <Link to="/feed" className="btn-primary !px-6 !py-3 !text-sm">
              Читать ленту <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </Press>
          <Press>
            <Link to={user ? '/compose' : '/login?returnTo=/compose'} className="btn-ghost !px-6 !py-3 !text-sm">
              Стать автором
            </Link>
          </Press>
        </div>
      </Reveal>
    </div>
  )
}
