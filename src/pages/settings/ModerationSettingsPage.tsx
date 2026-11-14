import { useStore } from '@/lib/store'
import { labelers as allLabelers } from '@/data/mock'
import { collegiumKey, useHiddenCollegia } from '@/lib/labels'
import Reveal from '@/components/Reveal'
import CollegiumIcon from '@/components/CollegiumIcon'
import { Switch } from '@/components/ui/switch'
import type { LabelAction } from '@/types/types'

function ActionRadio({
  group,
  value,
  current,
  onChange,
}: {
  group: string
  value: LabelAction
  current: LabelAction
  onChange: (a: LabelAction) => void
}) {
  const labels: Record<LabelAction, string> = { hide: 'Скрывать', warn: 'Предупреждать', ignore: 'Игнорировать' }
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.04em] transition-colors duration-200 focus-within:ring-2 focus-within:ring-ring ${
        current === value ? 'border-accent bg-accent text-accent-foreground' : 'border-border text-foreground hover:border-accent hover:text-accent'
      }`}
    >
      <input
        type="radio"
        name={group}
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {labels[value]}
    </label>
  )
}

/** Модерация: подписки на коллегии присяжных и действия по их меткам */
export default function ModerationSettingsPage() {
  // РФ-контур: коллегий nsfw/politics нет — их записи закрыты сервером
  const hidden = useHiddenCollegia()
  const labelers = allLabelers.filter((l) => !hidden.includes(collegiumKey(l.id)))
  const { settings, toggleSubscription, setLabelAction } = useStore()

  return (
    <div>
      <p className="max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">
        Коллегии присяжных — это labeler-сервисы. Они не удаляют и не банят: они выдают подписанные метки.
        Подписка и действие для каждой метки — ваш выбор.
      </p>

      <div className="mt-8 space-y-10">
        {labelers.map((l) => {
          const s = settings[l.id] ?? { subscribed: false, actions: {} as Record<string, LabelAction> }
          return (
            <Reveal key={l.id} className="rule pt-8">
              <section aria-label={l.name}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex max-w-[62ch] gap-4">
                    <CollegiumIcon id={l.id} size={18} className="mt-1" />
                    <div>
                    <p className="meta text-accent">@{l.handle}</p>
                    <h2 className="mt-1.5 text-2xl font-extrabold tracking-tight">{l.name}</h2>
                    <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{l.description}</p>
                    <p className="meta mt-3">{l.subscribers.toLocaleString('ru-RU')} подписчиков</p>
                    </div>
                  </div>
                  <Switch
                    size="lg"
                    checked={s.subscribed}
                    aria-label={`Подписка на ${l.name}`}
                    onCheckedChange={() => toggleSubscription(l.id)}
                  />
                </div>

                <div className={`mt-6 space-y-4 ${s.subscribed ? '' : 'opacity-45'}`}>
                  {l.labels.map((label) => {
                    const current = s.actions[label.value] ?? label.defaultAction
                    return (
                      <div
                        key={label.value}
                        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border/70 pb-4 last:border-b-0"
                      >
                        <div className="min-w-[220px]">
                          <p className="font-mono text-[13px] font-semibold">{label.value}</p>
                          <p className="mt-0.5 text-sm text-muted-foreground">{label.description}</p>
                        </div>
                        <fieldset disabled={!s.subscribed} className="flex gap-2">
                          <legend className="sr-only">Действие для {label.value}</legend>
                          {(['hide', 'warn', 'ignore'] as LabelAction[]).map((a) => (
                            <ActionRadio
                              key={a}
                              group={`${l.id}-${label.value}`}
                              value={a}
                              current={current}
                              onChange={(next) => setLabelAction(l.id, label.value, next)}
                            />
                          ))}
                        </fieldset>
                      </div>
                    )
                  })}
                </div>

                {!s.subscribed && (
                  <p className="meta mt-4">Не подписаны — метки этой коллегии на вашу ленту не действуют.</p>
                )}
              </section>
            </Reveal>
          )
        })}
      </div>

      <Reveal className="rule mt-14 pt-8">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Хотите свою коллегию? Запустите labeler-сервис — это обычный аккаунт с записью{' '}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-[13px]">app.bsky.labeler.service</code> в репозитории.
          Правила, состав присяжных и кворум определяете вы; протокол гарантирует лишь одно — подпись под меткой
          проверяема, а контроль над ней у подписчика.
        </p>
      </Reveal>
    </div>
  )
}
