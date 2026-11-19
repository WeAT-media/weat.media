import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, BadgePercent, Ban, Blocks, Check, Clapperboard, Crown, FlaskConical, Gavel, LineChart, Minus, Rocket } from 'lucide-react'
import { Counter, PerkCard, Press, Reveal, SplitBar, WordReveal } from '@/components/motion/Motion'
import { useStore } from '@/lib/store'
import { payments } from '@/lib/api'
import { SITE_NAME } from '@/config/site'
import { PREMIUM_PRICE_RUB, PREMIUM_SALE_FEE_PCT, PREMIUM_VOTE_WEIGHT, SALE_FEE_PCT } from '@/config/premium'
import { formatMoney } from '@/lib/money'
import FeeNote from '@/components/FeeNote'
import type { InteractiveVideo as IV } from '@/lib/interactiveVideo'

/** Живой пример на странице: два свободных ролика MDN (CC0) — глава, метка на кадре, викторина и развилка */
const DEMO: IV = {
  v: 1,
  start: 'intro',
  segments: [
    { id: 'intro', title: 'Цветок', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' },
    { id: 'more', title: 'Ещё раз, крупнее', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm' },
  ],
  chapters: [
    { segment: 'intro', t: 0, title: 'Начало' },
    { segment: 'intro', t: 2, title: 'Бутон раскрывается' },
    { segment: 'more', t: 0, title: 'Вторая ветка' },
  ],
  hotspots: [
    { segment: 'intro', from: 0.5, to: 3.5, x: 72, y: 18, label: 'Что за цветок?', action: { type: 'link', url: 'https://ru.wikipedia.org/wiki/Цветок' } },
    { segment: 'intro', from: 1, to: 3.5, x: 20, y: 80, label: 'К бутону ⟶', action: { type: 'seek', t: 2 } },
  ],
  questions: [
    { id: 'quiz', segment: 'intro', t: 3, prompt: 'Это видео снято замедленно?', options: [{ label: 'Да, это ускоренная съёмка', correct: true }, { label: 'Нет, в реальном времени' }] },
    { id: 'branch', segment: 'intro', t: 4.6, prompt: 'Что дальше?', options: [{ label: 'Посмотреть ещё раз — другая ветка', goto: 'more' }, { label: 'Досмотреть эту' }] },
  ],
}
const DEMO_RAW = JSON.stringify(DEMO)
// плеер (video.js) и видео грузятся только по нажатию — иначе они тормозят первый показ страницы
const InteractiveVideo = lazy(() => import('@/components/InteractiveVideo'))

function DemoVideo() {
  const [started, setStarted] = useState(false)
  const placeholder = (
    <button type="button" onClick={() => setStarted(true)} className="mt-3 flex aspect-video w-full items-center justify-center border border-border bg-muted text-sm font-semibold">
      ▶ Запустить пример
    </button>
  )
  if (!started) return placeholder
  return <Suspense fallback={placeholder}><InteractiveVideo raw={DEMO_RAW} /></Suspense>
}

const perks = [
  {
    icon: LineChart,
    title: 'Открытая аналитика',
    text: 'Просмотры, дочитывания, время чтения, источники трафика и UTM-метки по любой статье. Сигналы анти-накрутки — видно, где просмотры настоящие.',
  },
  {
    icon: Ban,
    title: 'Без рекламы',
    text: 'Ни одного рекламного блока в ленте и статьях. Совсем.',
  },
  {
    icon: BadgePercent,
    title: `Комиссия ${PREMIUM_SALE_FEE_PCT}% вместо ${SALE_FEE_PCT}%`,
    text: `С каждой продажи ваших платных статей и видео вам остаётся ${100 - PREMIUM_SALE_FEE_PCT}%. Premium окупается с первых продаж.`,
  },
  {
    icon: Blocks,
    title: 'Свои блоки, FAQ и кнопки',
    text: 'Собирайте блоки в конструкторе или на HTML/CSS. Готовые: FAQ для курса (поисковики показывают вопросы в выдаче) и «кнопка с действием» — «Записаться», «Купить», «Скачать» заметной кнопкой вместо ссылки в тексте.',
  },
  {
    icon: Gavel,
    title: `Голос присяжного ×${PREMIUM_VOTE_WEIGHT}`,
    text: 'В коллегиях ваш голос весит больше: Premium — это подтверждённый, вовлечённый участник сообщества.',
  },
  {
    icon: Rocket,
    title: 'Ранний доступ',
    text: 'Новые функции — сначала у вас. Можно повлиять на то, какими они станут.',
  },
]

const compare: [string, boolean | string, boolean | string][] = [
  ['Чтение ленты и статей', true, true],
  ['Публикации, комментарии, суд присяжных', true, true],
  ['Реклама', 'есть', 'нет'],
  ['Комиссия с продаж', `${SALE_FEE_PCT}%`, `${PREMIUM_SALE_FEE_PCT}%`],
  ['Открытая аналитика статей', false, true],
  ['Свои блоки в редакторе', false, true],
  ['FAQ в статьях', false, true],
  ['Кнопка с действием', false, true],
  ['Вес голоса присяжного', '×1', `×${PREMIUM_VOTE_WEIGHT}`],
  ['Ранний доступ к функциям', false, true],
  ['Интерактивные видео (с играми на Canvas)', false, 'скоро'],
]

function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <Check size={16} className="mx-auto text-accent" aria-label="есть" />
  if (v === false) return <Minus size={16} className="mx-auto text-muted-foreground" aria-label="нет" />
  return <span className="font-mono text-sm">{v}</span>
}

/** Лендинг Premium: что даёт и сколько стоит */
export default function PremiumPage() {
  const { user, isPremium } = useStore()
  const price = formatMoney(PREMIUM_PRICE_RUB, 'RUB')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')
  // счёт lava.top на 30 дней; Premium включит вебхук, страница /purchase/:id ждёт подтверждения
  const buy = async () => {
    setPaying(true)
    setPayError('')
    try {
      const { paymentUrl } = await payments.premium()
      if (!paymentUrl) throw new Error('Платёжный сервис не вернул ссылку')
      window.location.href = paymentUrl
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Не удалось создать счёт')
      setPaying(false)
    }
  }

  const cta = isPremium ? (
    <span className="btn-ghost !px-6 !py-3 !text-sm"><Crown size={15} aria-hidden="true" /> У вас Premium</span>
  ) : user ? (
    <span className="flex flex-col items-center gap-2">
      <button type="button" onClick={() => void buy()} disabled={paying} className="btn-primary !px-6 !py-3 !text-sm">
        <Crown size={15} aria-hidden="true" /> {paying ? 'Переходим к оплате…' : `Оформить за ${price} / 30 дней`}
      </button>
      {payError && <span role="alert" className="text-sm text-destructive">{payError}</span>}
    </span>
  ) : (
    <Link to="/login?returnTo=/premium" className="btn-primary !px-6 !py-3 !text-sm">
      <Crown size={15} aria-hidden="true" /> Войти и оформить <ArrowRight size={15} aria-hidden="true" />
    </Link>
  )

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <section className="pt-16 md:pt-24">
        <p className="meta inline-flex items-center gap-1.5 text-accent"><Crown size={12} aria-hidden="true" /> {SITE_NAME} Premium</p>
        <WordReveal text="Больше видно. Меньше отдаёте." className="mt-4 max-w-[18ch] text-5xl font-extrabold leading-[1.05] tracking-tight md:text-6xl" />
        <p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-muted-foreground">
          Анонимная аналитика других авторов, лента без рекламы и комиссия {PREMIUM_SALE_FEE_PCT}%* с ваших продаж. {price} в месяц —
          отмена в любой момент.
        </p>
        <FeeNote className="mt-2" />
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Press>{cta}</Press>
          <span className="meta">аккаунт и записи остаются вашими — Premium ничего не запирает</span>
        </div>
      </section>

      <section className="mt-20" aria-label="Что даёт Premium">
        <div className="grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {perks.map((p, i) => (
            <PerkCard key={p.title} index={i}>
              <p.icon size={18} className="text-accent" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-extrabold tracking-tight">{p.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.text}</p>
            </PerkCard>
          ))}
        </div>
      </section>

      {/* экономика: комиссия досчитывает 10 → 1, доля автора дорастает 90 → 99 */}
      <Reveal className="mt-20 grid items-center gap-8 border border-border bg-secondary/40 p-7 md:grid-cols-[auto_1fr] md:p-10">
        <div>
          <p className="meta">Комиссия площадки с продаж</p>
          <p className="mt-2 font-mono text-6xl font-extrabold tracking-tight text-accent md:text-7xl">
            <Counter from={SALE_FEE_PCT} to={PREMIUM_SALE_FEE_PCT} suffix="%" />
          </p>
          <p className="meta mt-1">вместо {SALE_FEE_PCT}%</p>
        </div>
        <div>
          <SplitBar from={100 - SALE_FEE_PCT} to={100 - PREMIUM_SALE_FEE_PCT} />
          <div className="mt-2 flex justify-between gap-4">
            <span className="meta">автору — <Counter from={100 - SALE_FEE_PCT} to={100 - PREMIUM_SALE_FEE_PCT} suffix="%" /></span>
            <span className="meta">площадке — {PREMIUM_SALE_FEE_PCT}%</span>
          </div>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            С каждой продажи статьи или видео у Premium-автора остаётся {100 - PREMIUM_SALE_FEE_PCT}%, у остальных — {100 - SALE_FEE_PCT}%.
          </p>
        </div>
      </Reveal>

      {/* скоро: интерактивное видео (сейчас — developer preview в настройках) */}
      <Reveal className="mt-20 grid gap-6 border-2 border-dashed border-accent/60 bg-secondary/40 p-7 md:grid-cols-[auto_1fr] md:p-10">
        <Clapperboard size={40} className="text-accent" aria-hidden="true" />
        <div>
          <p className="meta inline-flex items-center gap-1.5 text-accent">
            <FlaskConical size={12} aria-hidden="true" /> Скоро в Premium · сейчас developer preview
          </p>
          <h2 className="mt-3 text-2xl font-extrabold tracking-tight md:text-3xl">Интерактивные видео</h2>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
            Видео, в котором зритель участвует: главы с переходами, кнопки прямо на кадре, вопросы по ходу просмотра и ветвление сюжета —
            «выберите, что смотреть дальше». Для курсов, разборов и обучающих роликов.
          </p>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
            А между фрагментами — целые мини-игры, анимации и тренажёры на HTML Canvas: зритель играет, и от результата зависит,
            что он увидит дальше. Код игры работает в изолированной песочнице — без доступа к аккаунту и данным страницы.
          </p>
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {['Главы и прогресс просмотра', 'Кликабельные метки на кадре', 'Вопросы и викторины с паузой', 'Ветвление сюжета по ответу', 'Мини-игры и анимации на Canvas внутри видео', 'Продолжение зависит от результата игры'].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check size={14} className="text-accent" aria-hidden="true" /> {t}</li>
            ))}
          </ul>
          <p className="meta mt-4 !normal-case tracking-normal">
            Попробовать уже сейчас: Настройки → Разработчикам → Developer preview, затем «/» → «Интерактивное видео» в редакторе.
          </p>
        </div>
        {/* живой пример: нажмите play — появятся метки, вопрос и развилка */}
        <div className="md:col-span-2">
          <p className="meta">Пример — нажмите play</p>
          <DemoVideo />
        </div>
      </Reveal>

      <Reveal className="mt-20">
        <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Сравнение</h2>
        <table className="mt-6 w-full text-left text-[15px]">
          <thead>
            <tr className="rule">
              <th className="py-3 pr-4 font-normal"><span className="sr-only">Возможность</span></th>
              <th className="w-32 py-3 text-center font-mono text-[12px] font-semibold uppercase tracking-[0.08em]">Бесплатно</th>
              <th className="w-32 py-3 text-center font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">Premium</th>
            </tr>
          </thead>
          <tbody>
            {compare.map(([label, free, prem]) => (
              <tr key={label} className="rule">
                <td className="py-3 pr-4">{label}</td>
                <td className="py-3 text-center"><Cell v={free} /></td>
                <td className="py-3 text-center"><Cell v={prem} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>

      <section className="mt-20 text-center">
        <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">Окупается с первых продаж</h2>
        <p className="mx-auto mt-4 max-w-[54ch] text-[15px] leading-relaxed text-muted-foreground">
          Продали статей на {formatMoney(Math.ceil((PREMIUM_PRICE_RUB * 100) / (SALE_FEE_PCT - PREMIUM_SALE_FEE_PCT)), 'RUB')} в месяц — разница в комиссии
          уже покрыла подписку.
        </p>
        <div className="mt-7 flex justify-center"><Press>{cta}</Press></div>
      </section>
    </div>
  )
}
