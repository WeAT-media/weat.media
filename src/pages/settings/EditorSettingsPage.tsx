import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Code2, Crown, Plus, PenLine, Shapes, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import UserBlockView from '@/components/UserBlockView'
import {
  FIELD_TYPES,
  LIMITS,
  PRESETS,
  defaultValues,
  newId,
  normalizeDef,
  templates,
  type BlockDef,
  type FieldDef,
  type FieldType,
} from '@/lib/userBlocks'

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const monoCls = `${inputCls} font-mono text-[12px] leading-relaxed`
const labelCls = 'meta mb-1.5 block'

const slugKey = (label: string, taken: string[]) => {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya' }
  let k = label.toLowerCase().split('').map((ch) => map[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!/^[a-z]/.test(k)) k = `f_${k}`
  k = k.slice(0, 20) || 'field'
  let out = k
  for (let i = 2; taken.includes(out); i++) out = `${k}_${i}`
  return out
}

function FieldsEditor({ fields, onChange }: { fields: FieldDef[]; onChange: (f: FieldDef[]) => void }) {
  const update = (i: number, patch: Partial<FieldDef>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_150px_120px_auto]">
          <input
            value={f.label}
            onChange={(e) => update(i, { label: e.target.value })}
            aria-label="Название поля"
            placeholder="Название поля"
            className={inputCls}
          />
          <select value={f.type} onChange={(e) => update(i, { type: e.target.value as FieldType })} aria-label="Тип поля" className={inputCls}>
            {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
          <code className="self-center truncate font-mono text-[12px] text-muted-foreground" title="Ключ для шаблона">{`{{${f.key}}}`}</code>
          <button type="button" onClick={() => onChange(fields.filter((_, j) => j !== i))} aria-label="Удалить поле" className="btn-ghost !px-2.5 !py-2 hover:!border-destructive hover:!text-destructive">
            <Trash2 size={13} aria-hidden="true" />
          </button>
          {f.type === 'select' && (
            <input
              value={(f.options ?? []).join(', ')}
              onChange={(e) => update(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
              aria-label="Варианты через запятую"
              placeholder="Варианты через запятую"
              className={`${inputCls} sm:col-span-4`}
            />
          )}
          <input
            value={f.default ?? ''}
            onChange={(e) => update(i, { default: e.target.value })}
            aria-label="Значение по умолчанию"
            placeholder="Значение по умолчанию"
            className={`${inputCls} sm:col-span-4`}
          />
        </div>
      ))}
      {fields.length < LIMITS.fields && (
        <button
          type="button"
          onClick={() => onChange([...fields, { key: slugKey('Поле', fields.map((f) => f.key)), label: 'Поле', type: 'text' }])}
          className="btn-ghost !px-3 !py-1.5 !text-[11px]"
        >
          <Plus size={12} aria-hidden="true" /> Поле
        </button>
      )}
    </div>
  )
}

function BlockEditor({ initial, onSave, onCancel }: { initial: BlockDef; onSave: (d: BlockDef) => void; onCancel: () => void }) {
  const [def, setDef] = useState<BlockDef>(initial)
  const set = (patch: Partial<BlockDef>) => setDef((d) => ({ ...d, ...patch }))
  const setFields = (fields: FieldDef[]) =>
    set({ fields: fields.map((f, i) => (f.key && fields.findIndex((x) => x.key === f.key) === i ? f : { ...f, key: slugKey(f.label, fields.slice(0, i).map((x) => x.key)) })) })
  const preview = useMemo(() => {
    const d = normalizeDef(def)
    return JSON.stringify({ def: d, values: defaultValues(d) })
  }, [def])
  const keys = def.fields.map((f) => `{{${f.key}}}`).join(' ')

  return (
    <div className="mt-4 border border-accent/60 p-5">
      <div className="grid gap-4 sm:grid-cols-[80px_1fr]">
        <div>
          <label className={labelCls} htmlFor="ub-icon">Иконка</label>
          <input id="ub-icon" value={def.icon} maxLength={4} onChange={(e) => set({ icon: e.target.value })} className={`${inputCls} text-center text-lg`} />
        </div>
        <div>
          <label className={labelCls} htmlFor="ub-name">Название в меню «/»</label>
          <input id="ub-name" value={def.name} maxLength={LIMITS.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} />
        </div>
      </div>
      <label className={`${labelCls} mt-4`} htmlFor="ub-desc">Подсказка</label>
      <input id="ub-desc" value={def.description} maxLength={80} onChange={(e) => set({ description: e.target.value })} placeholder="Что это за блок" className={inputCls} />

      <div role="tablist" aria-label="Способ создания" className="mt-5 flex gap-2">
        {(
          [
            ['visual', 'Конструктор', Shapes],
            ['code', 'Код: HTML/CSS', Code2],
          ] as const
        ).map(([mode, label, Icon]) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={def.mode === mode}
            onClick={() => set({ mode })}
            className={`btn-ghost !px-3 !py-1.5 !text-[11px] ${def.mode === mode ? '!border-accent !text-accent' : ''}`}
          >
            <Icon size={12} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <span className={labelCls}>Поля, которые заполняют в редакторе</span>
            <FieldsEditor fields={def.fields} onChange={setFields} />
          </div>

          {def.mode === 'visual' ? (
            <>
              <div>
                <label className={labelCls} htmlFor="ub-preset">Стиль</label>
                <select id="ub-preset" value={def.preset} onChange={(e) => set({ preset: e.target.value as BlockDef['preset'] })} className={inputCls}>
                  {PRESETS.map((p) => <option key={p.preset} value={p.preset}>{p.label}</option>)}
                </select>
              </div>
              <div className="flex gap-4">
                <label className="meta flex items-center gap-2">
                  Акцент <input type="color" value={def.accent} onChange={(e) => set({ accent: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-border" />
                </label>
                <label className="meta flex items-center gap-2">
                  Фон <input type="color" value={def.background} onChange={(e) => set({ background: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-border" />
                </label>
              </div>
              <p className="text-sm text-muted-foreground">
                Поле с ключом <code className="font-mono text-[12px]">{'{{icon}}'}</code> становится иконкой, первая строка — заголовком, многострочные — текстом, «Цвет» — акцентом.
              </p>
            </>
          ) : (
            <>
              <div>
                <label className={labelCls} htmlFor="ub-template">HTML-шаблон</label>
                <textarea id="ub-template" rows={7} spellCheck={false} value={def.template} maxLength={LIMITS.template} onChange={(e) => set({ template: e.target.value })} className={monoCls} />
                <p className="meta mt-1 !normal-case tracking-normal">подставьте поля: {keys || 'добавьте поля выше'}</p>
              </div>
              <div>
                <label className={labelCls} htmlFor="ub-css">CSS</label>
                <textarea id="ub-css" rows={5} spellCheck={false} value={def.css} maxLength={LIMITS.css} onChange={(e) => set({ css: e.target.value })} className={monoCls} />
              </div>
              <div className="max-w-[180px]">
                <label className={labelCls} htmlFor="ub-height">Высота, px</label>
                <input id="ub-height" type="number" min={60} max={600} value={def.height} onChange={(e) => set({ height: Number(e.target.value) })} className={inputCls} />
              </div>
              <p className="text-sm text-muted-foreground">
                Шаблон работает в изолированной рамке: скрипты, формы и доступ к странице отключены, картинки — только по https.
              </p>
            </>
          )}
        </div>

        <div>
          <span className={labelCls}>Превью</span>
          <div className="rounded-md border border-dashed border-border p-3">
            <UserBlockView raw={preview} />
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={() => onSave(normalizeDef({ ...def, updatedAt: new Date().toISOString() }))} className="btn-primary !px-4 !py-2">
          Сохранить
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost !px-4 !py-2">Отмена</button>
      </div>
    </div>
  )
}

/**
 * Настройки визуального редактора — Premium: свои блоки (конструктор или HTML/CSS),
 * которые появляются в «/»-меню. Обычному пользователю — upsell.
 */
export default function EditorSettingsPage() {
  const { isPremium, editorPrefs, setEditorPrefs, blockDefs, setBlockDefs } = useStore()
  const [editing, setEditing] = useState<BlockDef | null>(null)

  if (!isPremium) {
    return (
      <Reveal className="border-2 border-dashed border-accent/60 bg-secondary/50 p-6">
        <p className="meta inline-flex items-center gap-1.5 text-accent">
          <Crown size={12} aria-hidden="true" /> Premium
        </p>
        <h2 className="mt-3 text-xl font-extrabold tracking-tight">Свои блоки — для Premium</h2>
        <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-muted-foreground">
          Соберите собственные блоки в конструкторе или напишите HTML/CSS-шаблон — заметки, карточки, плашки в вашем
          стиле. Они появятся в «/»-меню редактора. Карусель и опрос доступны всем.
        </p>
        <Link to="/premium" className="btn-primary mt-5 !px-4 !py-2">
          Узнать о Premium
        </Link>
      </Reveal>
    )
  }

  const save = (d: BlockDef) => {
    const exists = blockDefs.some((x) => x.id === d.id)
    setBlockDefs(exists ? blockDefs.map((x) => (x.id === d.id ? d : x)) : [...blockDefs, d].slice(0, LIMITS.defs))
    setEditing(null)
  }

  return (
    <Reveal className="border border-border p-6">
      <section aria-label="Редактор">
        <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
          <PenLine size={14} aria-hidden="true" /> Редактор
        </h2>

        <div className="mt-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-[15px] font-semibold">Свои блоки в «/»-меню</p>
            <p className="meta mt-1 !normal-case tracking-normal text-muted-foreground">
              выключите, чтобы временно скрыть их из меню; уже вставленные блоки остаются
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={editorPrefs.customBlocks}
            aria-label="Свои блоки"
            onClick={() => setEditorPrefs({ customBlocks: !editorPrefs.customBlocks })}
            className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              editorPrefs.customBlocks ? 'bg-accent' : 'bg-border'
            }`}
          >
            <span
              className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-background shadow transition-transform duration-200 ${
                editorPrefs.customBlocks ? 'translate-x-6' : 'translate-x-1'
              }`}
              aria-hidden="true"
            />
          </button>
        </div>

        <h3 className="mt-8 font-mono text-[12px] font-bold uppercase tracking-[0.12em]">Мои блоки · {blockDefs.length}/{LIMITS.defs}</h3>
        {blockDefs.length === 0 && !editing && (
          <p className="mt-2 text-sm text-muted-foreground">Пока пусто. Начните с заготовки или с чистого листа.</p>
        )}
        <ul className="mt-3 divide-y divide-border border-y border-border empty:hidden">
          {blockDefs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-sm font-bold">{d.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{d.name}</span>
                  <span className="meta block !normal-case tracking-normal">{d.mode === 'code' ? 'HTML/CSS' : 'конструктор'} · полей: {d.fields.length}</span>
                </span>
              </span>
              <span className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setEditing(d)} className="btn-ghost !px-3 !py-1.5 !text-[11px]">Изменить</button>
                <button
                  type="button"
                  onClick={() => setBlockDefs(blockDefs.filter((x) => x.id !== d.id))}
                  aria-label={`Удалить блок ${d.name}`}
                  className="btn-ghost !px-2.5 !py-1.5 hover:!border-destructive hover:!text-destructive"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>

        {editing ? (
          <BlockEditor key={editing.id} initial={editing} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          blockDefs.length < LIMITS.defs && (
            <div className="mt-4">
              <p className="meta mb-2">Новый блок</p>
              <div className="flex flex-wrap gap-2">
                {templates().map((t) => (
                  <button key={t.name} type="button" onClick={() => setEditing({ ...t, id: newId() })} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                    {t.icon} {t.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setEditing(normalizeDef({ id: newId(), name: 'Новый блок', fields: [{ key: 'text', label: 'Текст', type: 'textarea' }] }))}
                  className="btn-ghost !px-3 !py-1.5 !text-[11px]"
                >
                  <Plus size={12} aria-hidden="true" /> С нуля
                </button>
              </div>
            </div>
          )
        )}
      </section>
    </Reveal>
  )
}
