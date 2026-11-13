import { Link } from 'react-router'
import { ArrowRight, Landmark, ShieldCheck } from 'lucide-react'
import { useStore } from '@/lib/store'
import { PerkCard, Press, Reveal, WordReveal } from '@/components/motion/Motion'
import { AtomIcon, ClapperIcon, CrownRaysIcon, GavelIcon, PeopleIcon, ScaleIcon, SparkleIcon, WriteIcon } from '@/components/motion/AnimatedIcons'
import { SITE_NAME } from '@/config/site'

const features = [
  {
    icon: PeopleIcon,
    title: 'Сообщество людей, не корпораций',
    text: 'Здесь не решает корпоративный модератор и не работает рекламный алгоритм. Записи принадлежат авторам и хранятся в их личном архиве публикаций — площадка лишь собирает ленту.',
  },
  {
    icon: Landmark,
    title: 'Честная экономика: 90/10 и 99/1',
    text: 'Платные посты и видео: 90% каждой продажи — автору, 10% — инфраструктуре. Premium-подписка автора — 99% автору, 1% площадке. У платного видео есть бесплатное превью, у платной статьи — тизер: покупка осознанная.',
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
    text: 'Тексты, видео, курсы. 90% с каждой продажи — вам; с Premium-подписки — 99%. Выплаты на ваши реквизиты.',
  },
]

/** Лендинг: что это за площадка, кому и почему */
export default function LandingPage() {
  const { user } = useStore()

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      {/* Hero */}
      <section className="pt-16 md:pt-24">
        <p className="meta">{SITE_NAME} · поверх AT Protocol</p>
        <WordReveal text="Дышите свободно в ATmosphere." className="mt-4 max-w-[16ch] text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl" />
        <p className="mt-6 max-w-[62ch] text-lg leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">we</span> — это мы, сообщество.{' '}
          <span className="font-semibold text-accent">AT</span> — открытый AT Protocol, на котором мы стоим. А вместе
          weat звучит как wheat — пшеница.
        </p>
        <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-muted-foreground">
          Колос растёт не в одиночку, а полем, и корни у каждого свои. Так и здесь: тексты пускают корни в вашем
          собственном репозитории, а не в чужом сервере. Площадка лишь собирает урожай в общую ленту — и если
          однажды вы решите уйти, ваше поле уйдёт вместе с вами: имя, читатели, каждая запись. Сейте мысли, растите
          смыслы, делитесь хлебом.
        </p>
        <Reveal delay={0.35} className="mt-8 flex flex-wrap gap-3">
          <Press>
            <Link to="/feed" className="btn-primary !px-6 !py-3 !text-sm">
              Читать ленту <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </Press>
          <Press>
            <Link to={user ? '/compose' : '/login?returnTo=/compose'} className="btn-ghost !px-6 !py-3 !text-sm">
              <WriteIcon /> Стать автором
            </Link>
          </Press>
          <Press>
            <Link to="/atmosphere" className="btn-ghost !px-6 !py-3 !text-sm">
              <AtomIcon /> Что такое AT Protocol?
            </Link>
          </Press>
          <Press>
            <Link to="/premium" className="btn-ghost !px-6 !py-3 !text-sm">
              <CrownRaysIcon /> Премиум
            </Link>
          </Press>
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
            </Reveal>
          ))}
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
