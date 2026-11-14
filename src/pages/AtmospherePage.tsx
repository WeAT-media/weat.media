import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, ArrowRight, Database, Fingerprint, Globe, Radio, RefreshCw, Server, User } from 'lucide-react'
import { HANDLE_DOMAIN, SITE_NAME } from '@/config/site'

/** Интерактивное объяснение: что такое AT Protocol и ATmosphere — пошагово, на схеме */

type NodeId = 'you' | 'handle' | 'did' | 'pds' | 'relay' | 'apps'

interface Step {
  title: string
  text: string
  /** какие узлы схемы подсвечены на шаге */
  focus: NodeId[]
}

const steps: Step[] = [
  {
    title: 'AT Protocol — открытый протокол, а не сайт',
    text: 'Как e-mail: письма ходят между Gmail, Яндексом и вашим сервером по общим правилам. AT Protocol — такие же общие правила для соцсетей и медиа. Любой может поднять свой сервер или своё приложение.',
    focus: [],
  },
  {
    title: 'Имя — это домен, а домен — имя',
    text: `Ваше имя выглядит как домен: alina.${HANDLE_DOMAIN}. Можно взять и свой собственный — alina.dev. Имя легко поменять: оно лишь указывает на ваш постоянный идентификатор.`,
    focus: ['you', 'handle'],
  },
  {
    title: 'DID — постоянный идентификатор',
    text: 'В имя встроен DID (did:plc:…) — постоянный ключ, который не меняется никогда. Подписчики, лайки и ссылки привязаны к DID, поэтому смена имени или сервера ничего не ломает.',
    focus: ['handle', 'did'],
  },
  {
    title: 'PDS — ваш личный архив',
    text: 'Записи хранятся в репозитории на PDS (Personal Data Server). Каждая запись подписана вашим ключом — её нельзя тихо подменить. Репозиторий можно выгрузить целиком в любой момент.',
    focus: ['did', 'pds'],
  },
  {
    title: 'Relay — общая шина событий',
    text: 'PDS публикуют новые записи в общий поток (firehose). Relay собирает записи со всех серверов сети — так они становятся видны всем приложениям.',
    focus: ['pds', 'relay'],
  },
  {
    title: 'Приложения читают одну сеть',
    text: `Bluesky, ${SITE_NAME} и другие приложения — это разный визуал («витрины») с одними и теми же данными. Каждое приложение строит свою ленту и свою модерацию, а ваш аккаунт работает везде.`,
    focus: ['relay', 'apps'],
  },
  {
    title: 'Модерация — метки, а не удаление',
    text: `Модерацию в AT Protocol делают лейблеры — отдельные службы, которые ставят подписанные метки на записи и аккаунты: «спам», «нерабочий код», «нарушение закона». Запись при этом остаётся в репозитории автора. Читатель сам подписывается на лейблеры и решает, что делать с каждой меткой: скрыть, предупредить или показать. В ${SITE_NAME} лейблеры — коллегии присяжных (tech.justice.${HANDLE_DOMAIN}, spam.justice.${HANDLE_DOMAIN} и другие): решение выносит коллегия, а метку видит вся сеть.`,
    focus: ['apps'],
  },
  {
    title: 'ATmosphere — вся экосистема целиком',
    text: 'Все серверы, приложения, ленты и службы модерации на AT Protocol вместе называют ATmosphere. Ни одна компания не владеет ею — и не может забрать ваш аккаунт. Попробуйте: нажмите «Переехать» на схеме.',
    focus: ['you', 'handle', 'did', 'pds', 'relay', 'apps'],
  },
]

const PDS_LIST = [`pds.${HANDLE_DOMAIN}`, 'bsky.social', 'pds.alina.dev']

function Node({
  id,
  icon: Icon,
  label,
  sub,
  focus,
  onClick,
}: {
  id: NodeId
  icon: typeof User
  label: string
  sub: string
  focus: NodeId[]
  onClick: (id: NodeId) => void
}) {
  const on = focus.includes(id)
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`flex w-full items-center gap-3 border p-3 text-left transition-all duration-300 ${
        on ? 'border-accent bg-accent/10 shadow-sm' : 'border-border bg-background opacity-60 hover:opacity-100'
      }`}
    >
      <Icon size={18} className={on ? 'text-accent' : 'text-muted-foreground'} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  )
}

/** клик по узлу схемы открывает шаг, где он объясняется */
const stepFor: Record<NodeId, number> = { you: 1, handle: 1, did: 2, pds: 3, relay: 4, apps: 5 }

export default function AtmospherePage() {
  const [i, setI] = useState(0)
  const [pds, setPds] = useState(0)
  const [moved, setMoved] = useState(false)
  const step = steps[i]

  const move = () => {
    setPds((p) => (p + 1) % PDS_LIST.length)
    setMoved(true)
    setI(steps.length - 1)
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <section className="pt-12 md:pt-16">
        <p className="meta">Что такое AT Protocol и ATmosphere</p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">AT Protocol и ATmosphere</h1>
        <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">we</span> — это мы, сообщество.{' '}
          <span className="font-semibold text-accent">AT</span> — открытый AT Protocol, на котором мы стоим. А вместе
          weat звучит как wheat — пшеница.
        </p>
        <p className="mt-4 max-w-[60ch] text-muted-foreground">
          Восемь коротких шагов. Листайте кнопками или нажимайте на элементы схемы.
        </p>
      </section>

      <div className="mt-10 grid gap-8 md:grid-cols-[1fr_1.1fr]">
        {/* Текст шага */}
        <div className="flex flex-col">
          <p className="font-mono text-sm text-accent">
            {i + 1} / {steps.length}
          </p>
          <h2 key={i} className="mt-2 animate-in fade-in text-2xl font-extrabold tracking-tight">
            {step.title}
          </h2>
          <p key={`t${i}`} className="mt-3 animate-in fade-in leading-relaxed text-muted-foreground">
            {step.text}
          </p>
          {moved && i === steps.length - 1 && (
            <p className="mt-4 border-l-2 border-accent pl-3 text-sm">
              Аккаунт переехал на <b className="font-mono">{PDS_LIST[pds]}</b>. DID, подписчики и записи — те же;
              приложения продолжают вас показывать.
            </p>
          )}
          <div className="mt-auto flex items-center gap-2 pt-8">
            <button type="button" className="btn-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
              <ArrowLeft size={15} aria-hidden="true" /> Назад
            </button>
            {i < steps.length - 1 ? (
              <button type="button" className="btn-primary" onClick={() => setI(i + 1)}>
                Дальше <ArrowRight size={15} aria-hidden="true" />
              </button>
            ) : (
              <Link to="/feed" className="btn-primary">
                Читать ленту <ArrowRight size={15} aria-hidden="true" />
              </Link>
            )}
          </div>
          <div className="mt-4 flex gap-1.5" role="tablist" aria-label="Шаги">
            {steps.map((s, n) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={n === i}
                aria-label={s.title}
                onClick={() => setI(n)}
                className={`h-1.5 flex-1 transition-colors ${n <= i ? 'bg-accent' : 'bg-border'}`}
              />
            ))}
          </div>
        </div>

        {/* Схема */}
        <div className="border border-border bg-secondary/30 p-4 md:p-6">
          <div className="grid gap-2">
            <Node id="you" icon={User} label="Вы" sub="автор и читатель" focus={step.focus} onClick={(n) => setI(stepFor[n])} />
            <div className="grid grid-cols-2 gap-2">
              <Node id="handle" icon={Globe} label="Имя" sub={`alina.${HANDLE_DOMAIN}`} focus={step.focus} onClick={(n) => setI(stepFor[n])} />
              <Node id="did" icon={Fingerprint} label="DID" sub="did:plc:7xq…k2" focus={step.focus} onClick={(n) => setI(stepFor[n])} />
            </div>
            <div className="flex items-stretch gap-2">
              <div className="flex-1">
                <Node id="pds" icon={Database} label="PDS · архив" sub={PDS_LIST[pds]} focus={step.focus} onClick={(n) => setI(stepFor[n])} />
              </div>
              <button type="button" onClick={move} className="btn-ghost shrink-0 !px-3" title="Переехать на другой сервер">
                <RefreshCw size={15} aria-hidden="true" /> Переехать
              </button>
            </div>
            <Node id="relay" icon={Radio} label="Relay · firehose" sub="поток событий всей сети" focus={step.focus} onClick={(n) => setI(stepFor[n])} />
            <div className="grid grid-cols-3 gap-2">
              {['Bluesky', SITE_NAME, 'другие'].map((app) => (
                <Node key={app} id="apps" icon={Server} label={app} sub="приложение" focus={step.focus} onClick={(n) => setI(stepFor[n])} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
