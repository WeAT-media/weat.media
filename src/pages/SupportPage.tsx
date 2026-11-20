import { Link } from 'react-router'
import { ArrowLeft, AtSign, EyeOff, Landmark, LifeBuoy, Scale, ShieldCheck, Wrench } from 'lucide-react'
import Reveal from '@/components/Reveal'

const faq = [
  {
    icon: AtSign,
    category: 'Вход через AT Protocol',
    items: [
      {
        q: 'Как войти на weAT.media с аккаунтом Bluesky или своего PDS',
        a: 'На странице входа в блоке «Через другой AT-сервер» введите handle полностью, например alice.bsky.social или ваш домен, и нажмите «Войти». Вас перенаправит на ваш сервер (bsky.social или собственный PDS) — подтвердите доступ там. Пароль от Bluesky weAT.media не видит. Если профиль уже привязан, откроется он, иначе создастся новый.',
      },
      {
        q: 'Как войти в Bluesky с аккаунтом weAT.media',
        a: 'В приложении Bluesky на экране входа выберите «Хостинг-провайдер» → «Свой» и укажите weat.media. Логин — handle целиком (например alina.weat.media), пароль — от weAT.media. Если включена двухфакторная защита, основной пароль в Bluesky не подойдёт: создайте пароль приложения в Настройки → Безопасность и войдите с ним. Аккаунты обоих регионов входят по одному адресу weat.media.',
      },
      {
        q: 'Я вхожу через Google, GitHub или Яндекс — какой пароль вводить в Bluesky',
        a: 'Своего пароля у такого аккаунта сначала нет. Задайте его: Настройки → Безопасность → «Задать пароль AT Protocol», подтвердите кодом из письма (email нужно подтвердить) или из приложения-аутентификатора. Вход через Google, GitHub или Яндекс на weAT.media продолжит работать. Этот же пароль спросит страница входа weat.media, если другое AT-приложение перенаправит вас сюда после ввода handle.',
      },
      {
        q: 'Bluesky пишет «Invalid identifier or password»',
        a: 'Проверьте, что в логине handle полностью, с .weat.media, а не только имя или email. Для аккаунтов с двухфакторной защитой нужен пароль приложения. После 20 неудачных попыток за минуту вход временно ограничивается — подождите минуту.',
      },
    ],
  },
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
