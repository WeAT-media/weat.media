import { Link } from 'react-router'
import { ArrowLeft, EyeOff, Landmark, LifeBuoy, Scale, ShieldCheck, Wrench } from 'lucide-react'
import Reveal from '@/components/Reveal'

const faq = [
  {
    icon: EyeOff,
    category: 'Видимость записей',
    items: [
      {
        q: 'Моя статья не видна в ленте',
        a: 'Проверьте три вещи: у записи не стоит отложенная публикация (publishAt в будущем), у читателя не включён фильтр по тегу/языку/типу, и у статьи нет вердикта «осуждена» при выключенной настройке «показывать осуждённые». Если ничего не помогло — напишите нам через форму, выберите категорию «Статья не видна» и приложите ссылку.',
      },
      {
        q: 'Статья есть у автора, но не у читателя',
        a: 'Так задумано: метки коллегий действуют только на их подписчиков. Читатель сам решает, как поступать с вердиктами — в настройках модерации.',
      },
    ],
  },
  {
    icon: Wrench,
    category: 'Технические проблемы',
    items: [
      {
        q: 'Не играет видео',
        a: 'Локально загруженные файлы живут только в сессии вкладки — после перезагрузки показывается демо-источник. Для ссылок проверьте, что источник отдаёт video/mp4.',
      },
      {
        q: 'Потерялся черновик или настройки',
        a: 'Прототип хранит всё в localStorage браузера: очистка данных сайта стирает черновики, подписки и сессию.',
      },
    ],
  },
  {
    icon: Landmark,
    category: 'Монетизация',
    items: [
      {
        q: 'Не могу включить платный контент',
        a: 'Сначала подключите выплаты в настройках («Выплаты»): 90% продаж уходит на эти реквизиты, поэтому без них платный пост заблокирован. В демо подключение локальное.',
      },
      {
        q: 'Как устроен сплит 90/10',
        a: '90% — автору напрямую, 10% — инфраструктура площадки (хостинг, relay, хранение репозиториев). Отмена подписки в любой момент.',
      },
    ],
  },
  {
    icon: ShieldCheck,
    category: 'Безопасность',
    items: [
      {
        q: 'Как пожаловаться на контент или пользователя',
        a: 'У комментариев и профилей есть кнопка «Пожаловаться» (спам, травля, незаконное, авторские права). Статью можно дополнительно вынести на суд коллегии присяжных — это публичный вердикт с меткой.',
      },
      {
        q: 'Что с моими данными',
        a: 'В прототипе всё локально: сессия, настройки и жалобы не покидают ваш браузер. В боевой версии идентичность — ваш DID в AT Protocol.',
      },
    ],
  },
]

/** Публичная поддержка: FAQ по категориям + вход в формы обращений */
export default function SupportPage() {
  return (
    <div className="mx-auto max-w-[860px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/feed"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Лента
        </Link>
        <p className="meta mt-8 flex items-center gap-1.5">
          <LifeBuoy size={12} aria-hidden="true" /> Поддержка · прототип: тикеты хранятся локально
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Помощь и поддержка</h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Частые вопросы по видимости записей, технике, монетизации и безопасности. Не нашли ответ — напишите нам
          или оформите запрос официального органа.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/support/contact" className="btn-primary !px-4 !py-2">Написать в поддержку</Link>
          <Link to="/support/tickets" className="btn-ghost !px-4 !py-2">Мои обращения</Link>
          <Link to="/support/legal" className="btn-ghost !px-4 !py-2">
            <Scale size={13} aria-hidden="true" /> Запрос официального органа
          </Link>
        </div>
      </div>

      <div className="mt-12 space-y-10">
        {faq.map((cat) => (
          <Reveal key={cat.category}>
            <section className="rule pt-8 first:border-t-0 first:pt-2" aria-label={cat.category}>
              <h2 className="inline-flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
                <cat.icon size={17} className="text-accent" aria-hidden="true" /> {cat.category}
              </h2>
              <div className="mt-5 space-y-5">
                {cat.items.map((item) => (
                  <div key={item.q}>
                    <h3 className="text-[15px] font-semibold">{item.q}</h3>
                    <p className="mt-1.5 max-w-[66ch] text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>
          </Reveal>
        ))}
      </div>
    </div>
  )
}
