import { BlockComponent, BlockViewExtension } from '@blocksuite/block-std'
import { BlockMarkdownAdapterExtension, type BlockMarkdownAdapterMatcher } from '@blocksuite/affine-shared/adapters'
import { defineBlockSchema, nanoid, type BlockModel } from '@blocksuite/store'
import { html, css, unsafeCSS } from 'lit'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { literal } from 'lit/static-html.js'
import { getEditorCaps } from '@/lib/editorCaps'
import { CarouselIcon, CarouselTooltip, PollIcon, PollTooltip } from '@/lib/slashMenuArt'
import {
  CODE_SANDBOX,
  USER_BLOCK_FLAVOUR,
  VISUAL_CSS,
  defaultValues,
  fallbackText,
  parseUserBlock,
  renderCodeSrcdoc,
  renderVisualHtml,
  type BlockDef,
  type UserBlockData,
} from '@/lib/userBlocks'
import type { CalloutTone } from '@/types/types'
import { DEFAULT_IVIDEO, normalizeIVideo } from '@/lib/interactiveVideo'
import { DEFAULT_POLL_SETTINGS, POLL_DURATIONS, durationLabel, normalizePoll, type PollData, type PollSettings } from '@/lib/poll'

/**
 * Настоящие BlockSuite-блоки "Карусель" и "Опрос" вместо прежнего хака
 * с ::: fence-разметкой поверх markdown. Каждый блок хранит свои данные
 * одной JSON-строкой в props.data — это упрощает модель, компонент и
 * markdown round-trip (сериализуются как ```carousel / ```poll фенсы,
 * по аналогии с тем, как affine:code сериализуется в markdown-адаптере).
 */

export interface CarouselSlideData {
  url: string
  caption?: string
}
export interface CarouselData {
  items: CarouselSlideData[]
}
export interface CalloutData {
  icon: string
  tone: CalloutTone
  text: string
}

const DEFAULT_CAROUSEL: CarouselData = {
  items: [
    { url: 'https://picsum.photos/seed/slide-1/1280/720', caption: 'Первый слайд' },
    { url: 'https://picsum.photos/seed/slide-2/1280/720', caption: 'Второй слайд' },
  ],
}
const DEFAULT_POLL: PollData = {
  question: 'О чём написать следующую статью?',
  options: ['Первый вариант', 'Второй вариант'],
  settings: DEFAULT_POLL_SETTINGS,
}
// дефолт для статической схемы; реальный дефолт новых callout'ов берётся
// из настроек «Редактор» (getEditorCaps) в slash-action
const DEFAULT_CALLOUT: CalloutData = {
  icon: '💡',
  tone: 'info',
  text: 'Текст заметки…',
}

export const CAROUSEL_FLAVOUR = 'affine:carousel'
export const POLL_FLAVOUR = 'affine:poll'
export const CALLOUT_FLAVOUR = 'affine:callout'
export const IVIDEO_FLAVOUR = 'affine:ivideo'
export const FAQ_FLAVOUR = 'affine:faq'
export const BUTTON_FLAVOUR = 'affine:actionbutton'

export interface ActionButtonData {
  label: string
  url: string
  variant: 'primary' | 'ghost'
  note: string
}
const DEFAULT_BUTTON: ActionButtonData = { label: 'Записаться на курс', url: 'https://', variant: 'primary', note: '' }

export interface FaqData {
  title: string
  items: { q: string; a: string }[]
}
const DEFAULT_FAQ: FaqData = {
  title: 'Частые вопросы',
  items: [
    { q: 'Для кого этот курс?', a: 'Для тех, кто…' },
    { q: 'Сколько длится обучение?', a: '…' },
  ],
}

type DataProps = { data: string }

export const CarouselBlockSchema = defineBlockSchema({
  flavour: CAROUSEL_FLAVOUR,
  props: (): DataProps => ({ data: JSON.stringify(DEFAULT_CAROUSEL) }),
  metadata: { version: 1, role: 'content' },
})

export const PollBlockSchema = defineBlockSchema({
  flavour: POLL_FLAVOUR,
  props: (): DataProps => ({ data: JSON.stringify(DEFAULT_POLL) }),
  metadata: { version: 1, role: 'content' },
})

export const CalloutBlockSchema = defineBlockSchema({
  flavour: CALLOUT_FLAVOUR,
  props: (): DataProps => ({ data: JSON.stringify(DEFAULT_CALLOUT) }),
  metadata: { version: 1, role: 'content' },
})

export const UserBlockSchema = defineBlockSchema({
  flavour: USER_BLOCK_FLAVOUR,
  props: (): DataProps => ({ data: '{}' }),
  metadata: { version: 1, role: 'content' },
})

export const IVideoBlockSchema = defineBlockSchema({
  flavour: IVIDEO_FLAVOUR,
  props: (): DataProps => ({ data: JSON.stringify(DEFAULT_IVIDEO, null, 2) }),
  metadata: { version: 1, role: 'content' },
})

export const FaqBlockSchema = defineBlockSchema({
  flavour: FAQ_FLAVOUR,
  props: (): DataProps => ({ data: JSON.stringify(DEFAULT_FAQ) }),
  metadata: { version: 1, role: 'content' },
})

export const ActionButtonBlockSchema = defineBlockSchema({
  flavour: BUTTON_FLAVOUR,
  props: (): DataProps => ({ data: JSON.stringify(DEFAULT_BUTTON) }),
  metadata: { version: 1, role: 'content' },
})

export const customBlockSchemas = [CarouselBlockSchema, PollBlockSchema, CalloutBlockSchema, UserBlockSchema, IVideoBlockSchema, FaqBlockSchema, ActionButtonBlockSchema]

/** Блоки, которые есть только у Premium: у остальных в редакторе превращаются в текст */
export const PREMIUM_FLAVOURS = new Set<string>([USER_BLOCK_FLAVOUR, CALLOUT_FLAVOUR, FAQ_FLAVOUR, BUTTON_FLAVOUR])

/** Блоки только для статей: в комментариях (compact-редактор) превращаются в текст */
export const ARTICLE_ONLY_FLAVOURS = new Set<string>([FAQ_FLAVOUR, IVIDEO_FLAVOUR, BUTTON_FLAVOUR])

/** документы compact-редакторов (комментарии): там «/» не предлагает блоки статьи */
const compactDocs = new WeakSet<object>()
export function markCompactDoc(doc: object) {
  compactDocs.add(doc)
}

/** Enter в input внутри <form> композера = неявная отправка формы (публикация) */
const stopEnter = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault()
}

function parseData<T>(raw: string, fallback: T): T {
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    return fallback
  }
}

/** Общие стили: редакторская карточка блока, без внешних библиотек */
const blockStyles = css`
  :host {
    display: block;
  }
  .indie-block {
    border: 1px solid var(--affine-border-color, #e3e2e4);
    border-radius: 8px;
    padding: 12px;
    margin: 8px 0;
    background: var(--affine-background-secondary-color, rgba(0, 0, 0, 0.02));
  }
  .indie-block__label {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.6;
    margin: 0 0 8px;
  }
  .indie-block__row {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
    align-items: center;
  }
  .indie-block__row input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--affine-border-color, #e3e2e4);
    border-radius: 6px;
    font-size: 13px;
    background: var(--affine-background-primary-color, #fff);
    color: inherit;
  }
  .indie-block__caption {
    flex: 0 0 140px;
  }
  .indie-block__btn {
    cursor: pointer;
    border: 1px solid var(--affine-border-color, #e3e2e4);
    border-radius: 6px;
    background: transparent;
    font-size: 12px;
    padding: 5px 9px;
    color: inherit;
  }
  .indie-block__del {
    flex: 0 0 auto;
    padding: 5px 8px;
  }
  .indie-block__slides {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    margin-top: 8px;
  }
  .indie-block__slide {
    flex: 0 0 auto;
    width: 160px;
  }
  .indie-block__slide img {
    width: 160px;
    height: 90px;
    object-fit: cover;
    border-radius: 6px;
    display: block;
    border: 1px solid var(--affine-border-color, #e3e2e4);
  }
  .indie-poll__settings {
    border: 0;
    border-top: 1px dashed var(--affine-border-color, #e3e2e4);
    margin: 10px 0 0;
    padding: 10px 0 0;
  }
  .indie-poll__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 6px 12px;
    margin-bottom: 8px;
  }
  .indie-poll__check {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }
  .indie-poll__check input {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--affine-primary-color, currentColor);
  }
  .indie-poll__field {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    opacity: 0.85;
  }
  .indie-poll__field--short {
    flex: 0 0 150px;
  }
  .indie-poll__field select {
    padding: 6px 8px;
    border: 1px solid var(--affine-border-color, #e3e2e4);
    border-radius: 6px;
    font-size: 13px;
    background: var(--affine-background-primary-color, #fff);
    color: inherit;
  }
  .indie-callout {
    display: flex;
    gap: 10px;
    border: 1px solid var(--affine-border-color, #e3e2e4);
    border-left-width: 3px;
    border-radius: 8px;
    padding: 12px;
    margin: 8px 0;
  }
  .indie-callout--info {
    border-left-color: #3b82f6;
    background: rgba(59, 130, 246, 0.07);
  }
  .indie-callout--success {
    border-left-color: #22c55e;
    background: rgba(34, 197, 94, 0.07);
  }
  .indie-callout--warning {
    border-left-color: #eab308;
    background: rgba(234, 179, 8, 0.08);
  }
  .indie-callout--danger {
    border-left-color: #ef4444;
    background: rgba(239, 68, 68, 0.07);
  }
  .indie-callout__icon {
    flex: 0 0 44px;
    text-align: center;
    font-size: 18px;
    padding: 4px 6px;
    border: 1px solid var(--affine-border-color, #e3e2e4);
    border-radius: 6px;
    background: var(--affine-background-primary-color, #fff);
    color: inherit;
  }
  .indie-callout__body {
    flex: 1;
    min-width: 0;
  }
  .indie-callout__text {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 44px;
    padding: 6px 8px;
    border: 1px solid var(--affine-border-color, #e3e2e4);
    border-radius: 6px;
    font-size: 14px;
    line-height: 1.5;
    background: var(--affine-background-primary-color, #fff);
    color: inherit;
  }
  .indie-callout__tone {
    margin-top: 6px;
    font-size: 12px;
    padding: 4px 6px;
    border: 1px solid var(--affine-border-color, #e3e2e4);
    border-radius: 6px;
    background: transparent;
    color: inherit;
  }
`

export class CarouselBlockComponent extends BlockComponent<BlockModel<DataProps>> {
  static override styles = blockStyles

  private get data(): CarouselData {
    return parseData(this.model.data, DEFAULT_CAROUSEL)
  }

  private persist(next: CarouselData) {
    this.doc.updateBlock(this.model, { data: JSON.stringify(next) })
  }

  private updateSlide(i: number, field: 'url' | 'caption', value: string) {
    const items = this.data.items.map((s, j) => (j === i ? { ...s, [field]: value } : s))
    this.persist({ items })
  }

  private removeSlide(i: number) {
    this.persist({ items: this.data.items.filter((_, j) => j !== i) })
  }

  private addSlide() {
    this.persist({ items: [...this.data.items, { url: 'https://', caption: '' }] })
  }

  override renderBlock() {
    const { items } = this.data
    return html`
      <div class="indie-block" contenteditable="false" @keydown=${stopEnter}>
        <p class="indie-block__label">Карусель · ${items.length} слайд(а)</p>
        ${items.map(
          (s, i) => html`
            <div class="indie-block__row">
              <input
                .value=${s.url}
                placeholder="https://…/image.jpg"
                @input=${(e: Event) => this.updateSlide(i, 'url', (e.target as HTMLInputElement).value)}
              />
              <input
                class="indie-block__caption"
                .value=${s.caption ?? ''}
                placeholder="Подпись"
                @input=${(e: Event) => this.updateSlide(i, 'caption', (e.target as HTMLInputElement).value)}
              />
              <button type="button" class="indie-block__btn indie-block__del" @click=${() => this.removeSlide(i)}>✕</button>
            </div>
          `,
        )}
        <button type="button" class="indie-block__btn" @click=${() => this.addSlide()}>+ Добавить слайд</button>
        ${items.length > 0
          ? html`
              <div class="indie-block__slides">
                ${items.map(
                  (s) => html`
                    <div class="indie-block__slide">
                      <img src=${s.url} alt=${s.caption ?? ''} loading="lazy" />
                    </div>
                  `,
                )}
              </div>
            `
          : null}
      </div>
    `
  }
}

export class PollBlockComponent extends BlockComponent<BlockModel<DataProps>> {
  static override styles = blockStyles

  private get data(): PollData {
    return normalizePoll(parseData(this.model.data, DEFAULT_POLL))
  }

  private persist(next: PollData) {
    this.doc.updateBlock(this.model, { data: JSON.stringify(next) })
  }

  private setSetting<K extends keyof PollSettings>(key: K, value: PollSettings[K]) {
    this.persist({ ...this.data, settings: { ...this.data.settings, [key]: value } })
  }

  private setQuestion(question: string) {
    this.persist({ ...this.data, question })
  }

  private updateOption(i: number, value: string) {
    this.persist({ ...this.data, options: this.data.options.map((o, j) => (j === i ? value : o)) })
  }

  private removeOption(i: number) {
    this.persist({ ...this.data, options: this.data.options.filter((_, j) => j !== i) })
  }

  private addOption() {
    this.persist({ ...this.data, options: [...this.data.options, ''] })
  }

  override renderBlock() {
    const { question, options, settings } = this.data
    const check = (key: 'multiple' | 'shuffle' | 'subscribersOnly' | 'authorizedOnly' | 'anonymous' | 'allowRetract', label: string) => html`
      <label class="indie-poll__check">
        <input type="checkbox" .checked=${settings[key]} @change=${(e: Event) => this.setSetting(key, (e.target as HTMLInputElement).checked)} />
        ${label}
      </label>
    `
    return html`
      <div class="indie-block" contenteditable="false" @keydown=${stopEnter}>
        <p class="indie-block__label">Опрос · ${settings.multiple ? 'несколько ответов' : 'один ответ'} · ${settings.anonymous ? 'анонимный' : 'открытый'}</p>
        <div class="indie-block__row">
          <input
            .value=${question}
            placeholder="Вопрос опроса"
            @input=${(e: Event) => this.setQuestion((e.target as HTMLInputElement).value)}
          />
        </div>
        ${options.map(
          (o, i) => html`
            <div class="indie-block__row">
              <input
                .value=${o}
                placeholder=${`Вариант ${i + 1}`}
                @input=${(e: Event) => this.updateOption(i, (e.target as HTMLInputElement).value)}
              />
              <button type="button" class="indie-block__btn indie-block__del" @click=${() => this.removeOption(i)}>✕</button>
            </div>
          `,
        )}
        <button type="button" class="indie-block__btn" @click=${() => this.addOption()}>+ Добавить вариант</button>
        <fieldset class="indie-poll__settings">
          <legend class="indie-block__label">Настройки</legend>
          <div class="indie-poll__grid">
            ${check('multiple', 'Несколько вариантов')}
            ${check('shuffle', 'Перемешать варианты')}
            ${check('subscribersOnly', 'Только подписчики автора')}
            ${check('authorizedOnly', 'Только вошедшие пользователи')}
            ${check('anonymous', 'Анонимный опрос')}
            ${check('allowRetract', 'Можно отозвать голос')}
          </div>
          <div class="indie-block__row">
            <label class="indie-poll__field">
              Кто проголосовал
              <select
                ?disabled=${settings.anonymous}
                title=${settings.anonymous ? 'В анонимном опросе участники скрыты от всех, включая автора' : ''}
                @change=${(e: Event) => this.setSetting('showVoters', (e.target as HTMLSelectElement).value as PollSettings['showVoters'])}
              >
                ${settings.anonymous
                  ? html`<option selected>скрыто — анонимный</option>`
                  : html`
                      <option value="always" ?selected=${settings.showVoters === 'always'}>видно сразу</option>
                      <option value="afterClose" ?selected=${settings.showVoters === 'afterClose'}>после завершения</option>
                    `}
              </select>
            </label>
            <label class="indie-poll__field">
              Результаты
              <select @change=${(e: Event) => this.setSetting('showResults', (e.target as HTMLSelectElement).value as PollSettings['showResults'])}>
                <option value="afterVote" ?selected=${settings.showResults === 'afterVote'}>после своего голоса</option>
                <option value="afterClose" ?selected=${settings.showResults === 'afterClose'}>после завершения</option>
              </select>
            </label>
          </div>
          <div class="indie-block__row">
            <label class="indie-poll__field">
              Страны
              <input
                .value=${settings.countries.join(', ')}
                placeholder="все · или RU, KZ, BY"
                title="Коды стран ISO 3166-1 через запятую; пусто — без ограничения"
                @change=${(e: Event) =>
                  this.setSetting('countries', (e.target as HTMLInputElement).value.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))}
              />
            </label>
            <label class="indie-poll__field indie-poll__field--short">
              Длительность
              <select
                @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value
                  this.setSetting('durationHours', v ? (Number(v) as PollSettings['durationHours']) : null)
                }}
              >
                <option value="" ?selected=${settings.durationHours === null}>без срока</option>
                ${POLL_DURATIONS.map((h) => html`<option value=${h} ?selected=${settings.durationHours === h}>${durationLabel(h)}</option>`)}
              </select>
            </label>
          </div>
        </fieldset>
      </div>
    `
  }
}

if (!customElements.get('affine-carousel')) {
  customElements.define('affine-carousel', CarouselBlockComponent)
}
if (!customElements.get('affine-poll')) {
  customElements.define('affine-poll', PollBlockComponent)
}

/** Пользовательский блок: превью по шаблону автора + поля для значений */
export class UserBlockComponent extends BlockComponent<BlockModel<DataProps>> {
  static override styles = [
    blockStyles,
    unsafeCSS(VISUAL_CSS),
    css`
      .indie-ub__frame {
        display: block;
        width: 100%;
        border: 0;
        border-radius: 8px;
        background: transparent;
      }
      .indie-ub__fields {
        border-top: 1px dashed var(--affine-border-color, #e3e2e4);
        margin-top: 10px;
        padding-top: 10px;
      }
      .indie-ub__fields textarea,
      .indie-ub__fields select {
        flex: 1;
        min-width: 0;
        padding: 6px 8px;
        border: 1px solid var(--affine-border-color, #e3e2e4);
        border-radius: 6px;
        font: inherit;
        font-size: 13px;
        background: var(--affine-background-primary-color, #fff);
        color: inherit;
      }
      .indie-ub__key {
        flex: 0 0 110px;
        font-size: 12px;
        opacity: 0.7;
      }
    `,
  ]

  private get data(): UserBlockData | null {
    return parseUserBlock(this.model.data)
  }

  private setValue(key: string, value: string) {
    const d = this.data
    if (!d) return
    this.doc.updateBlock(this.model, { data: JSON.stringify({ ...d, values: { ...d.values, [key]: value } }) })
  }

  override renderBlock() {
    const d = this.data
    if (!d) return html`<div class="indie-block" contenteditable="false">Блок повреждён</div>`
    const preview =
      d.def.mode === 'code'
        ? html`<iframe
            class="indie-ub__frame"
            title=${d.def.name}
            sandbox=${CODE_SANDBOX}
            referrerpolicy="no-referrer"
            style="height:${d.def.height}px"
            .srcdoc=${renderCodeSrcdoc(d)}
          ></iframe>`
        : unsafeHTML(renderVisualHtml(d)) // значения экранированы в renderVisualHtml
    const field = (f: BlockDef['fields'][number]) => {
      const v = d.values[f.key] ?? ''
      const on = (e: Event) => this.setValue(f.key, (e.target as HTMLInputElement).value)
      if (f.type === 'textarea') return html`<textarea rows="2" .value=${v} @input=${on}></textarea>`
      if (f.type === 'select')
        return html`<select @change=${on}>${(f.options ?? []).map((o) => html`<option ?selected=${o === v}>${o}</option>`)}</select>`
      if (f.type === 'color') return html`<input type="color" .value=${v || d.def.accent} @input=${on} />`
      return html`<input .value=${v} placeholder=${f.type === 'image' || f.type === 'link' ? 'https://…' : ''} @input=${on} />`
    }
    return html`
      <div class="indie-block" contenteditable="false" @keydown=${stopEnter}>
        <p class="indie-block__label">${d.def.icon} ${d.def.name} · мой блок</p>
        ${preview}
        ${d.def.fields.length
          ? html`<div class="indie-ub__fields">
              ${d.def.fields.map((f) => html`<div class="indie-block__row"><span class="indie-ub__key">${f.label}</span>${field(f)}</div>`)}
            </div>`
          : null}
      </div>
    `
  }
}

if (!customElements.get('affine-userblock')) {
  customElements.define('affine-userblock', UserBlockComponent)
}

const CALLOUT_TONES: CalloutTone[] = ['info', 'success', 'warning', 'danger']

/** Callout: иконка + редактируемый текст + тон (info/success/warning/danger) */
export class CalloutBlockComponent extends BlockComponent<BlockModel<DataProps>> {
  static override styles = blockStyles

  private get data(): CalloutData {
    return parseData(this.model.data, DEFAULT_CALLOUT)
  }

  private persist(next: CalloutData) {
    this.doc.updateBlock(this.model, { data: JSON.stringify(next) })
  }

  override renderBlock() {
    const { icon, tone, text } = this.data
    return html`
      <div class="indie-callout indie-callout--${tone}" contenteditable="false" @keydown=${stopEnter}>
        <input
          class="indie-callout__icon"
          .value=${icon}
          maxlength="4"
          title="Иконка заметки"
          @input=${(e: Event) => this.persist({ ...this.data, icon: (e.target as HTMLInputElement).value })}
        />
        <div class="indie-callout__body">
          <textarea
            class="indie-callout__text"
            .value=${text}
            placeholder="Текст заметки…"
            @input=${(e: Event) => this.persist({ ...this.data, text: (e.target as HTMLTextAreaElement).value })}
          ></textarea>
          <select
            class="indie-callout__tone"
            title="Тон заметки"
            @change=${(e: Event) => this.persist({ ...this.data, tone: (e.target as HTMLSelectElement).value as CalloutTone })}
          >
            ${CALLOUT_TONES.map((t) => html`<option value=${t} ?selected=${t === tone}>${t}</option>`)}
          </select>
        </div>
      </div>
    `
  }
}

if (!customElements.get('affine-callout')) {
  customElements.define('affine-callout', CalloutBlockComponent)
}

/**
 * Интерактивное видео (developer preview): сценарий — JSON (фрагменты, главы, метки, вопросы).
 * Ошибки сценария видны сразу; читатель получает уже нормализованные данные.
 */
export class IVideoBlockComponent extends BlockComponent<BlockModel<DataProps>> {
  static override styles = [
    blockStyles,
    css`
      .indie-iv__code {
        width: 100%;
        min-height: 260px;
        font: 12px/1.5 ui-monospace, monospace;
        border: 1px solid var(--affine-border-color, #e3e2e4);
        border-radius: 6px;
        padding: 8px;
        resize: vertical;
      }
      .indie-iv__err {
        color: #b42318;
        font-size: 12px;
        margin: 6px 0 0;
      }
      .indie-iv__ok {
        color: #2e7d32;
        font-size: 12px;
        margin: 6px 0 0;
      }
      .indie-iv__badge {
        display: inline-block;
        font: 600 10px/1 ui-monospace, monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        border: 1px solid currentColor;
        border-radius: 999px;
        padding: 3px 7px;
        margin-left: 6px;
        color: #8a5cf6;
      }
    `,
  ]

  private draft: string | null = null

  override renderBlock() {
    const text = this.draft ?? this.model.data
    let errors: string[] = []
    let stats = ''
    try {
      const r = normalizeIVideo(JSON.parse(text))
      errors = r.errors
      stats = `фрагментов ${r.data.segments.length} · глав ${r.data.chapters.length} · меток ${r.data.hotspots.length} · вопросов ${r.data.questions.length}`
    } catch (e) {
      errors = [`JSON: ${(e as Error).message}`]
    }
    return html`
      <div class="indie-block" contenteditable="false">
        <div class="indie-block__label">Интерактивное видео <span class="indie-iv__badge">developer preview</span></div>
        <textarea
          class="indie-iv__code"
          spellcheck="false"
          .value=${text}
          @input=${(e: Event) => {
            this.draft = (e.target as HTMLTextAreaElement).value
            try {
              JSON.parse(this.draft)
              this.doc.updateBlock(this.model, { data: this.draft })
            } catch {
              this.requestUpdate()
            }
          }}
        ></textarea>
        ${errors.length
          ? errors.slice(0, 5).map((e) => html`<p class="indie-iv__err">⚠ ${e}</p>`)
          : html`<p class="indie-iv__ok">✓ ${stats}</p>`}
        <p class="indie-block__label" style="margin-top:6px">
          segments — фрагменты (https mp4/webm) · chapters — главы · hotspots — кнопки на кадре (link / seek / segment) · questions — вопросы;
          вариант с goto переключает фрагмент (ветвление), correct — викторина.
        </p>
      </div>
    `
  }
}

/** FAQ (Premium-автор): пары «вопрос — ответ»; читатели видят раскрывающийся список */
export class FaqBlockComponent extends BlockComponent<BlockModel<DataProps>> {
  static override styles = [
    blockStyles,
    css`
      .indie-faq__item {
        border-top: 1px solid var(--affine-border-color, #e3e2e4);
        padding-top: 8px;
        margin-top: 8px;
      }
      .indie-faq__a {
        width: 100%;
        min-height: 56px;
        font: inherit;
        border: 1px solid var(--affine-border-color, #e3e2e4);
        border-radius: 6px;
        padding: 6px 8px;
        resize: vertical;
      }
    `,
  ]

  private get data(): FaqData {
    return parseData(this.model.data, DEFAULT_FAQ)
  }
  private persist(next: FaqData) {
    this.doc.updateBlock(this.model, { data: JSON.stringify(next) })
  }
  private setItem(i: number, patch: Partial<FaqData['items'][number]>) {
    const items = this.data.items.map((it, n) => (n === i ? { ...it, ...patch } : it))
    this.persist({ ...this.data, items })
  }

  override renderBlock() {
    const { title, items } = this.data
    return html`
      <div class="indie-block" contenteditable="false" @keydown=${stopEnter}>
        <div class="indie-block__label">FAQ · вопросы и ответы</div>
        <div class="indie-block__row">
          <input .value=${title} placeholder="Заголовок блока" @input=${(e: Event) => this.persist({ ...this.data, title: (e.target as HTMLInputElement).value })} />
        </div>
        ${items.map(
          (it, i) => html`
            <div class="indie-faq__item">
              <div class="indie-block__row">
                <input .value=${it.q} placeholder=${`Вопрос ${i + 1}`} @input=${(e: Event) => this.setItem(i, { q: (e.target as HTMLInputElement).value })} />
                <button type="button" class="indie-block__btn indie-block__del" @click=${() => this.persist({ ...this.data, items: items.filter((_, n) => n !== i) })}>✕</button>
              </div>
              <textarea class="indie-faq__a" .value=${it.a} placeholder="Ответ" @input=${(e: Event) => this.setItem(i, { a: (e.target as HTMLTextAreaElement).value })}></textarea>
            </div>
          `,
        )}
        <button type="button" class="indie-block__btn" ?disabled=${items.length >= 30} @click=${() => this.persist({ ...this.data, items: [...items, { q: '', a: '' }] })}>+ Вопрос</button>
      </div>
    `
  }
}

/** Кнопка с действием (Premium-автор): как ссылка, но заметной кнопкой — «Записаться», «Купить», «Скачать» */
export class ActionButtonBlockComponent extends BlockComponent<BlockModel<DataProps>> {
  static override styles = [
    blockStyles,
    css`
      .indie-btn__preview {
        display: inline-block;
        margin-top: 8px;
        padding: 8px 16px;
        border-radius: 999px;
        font-weight: 600;
        font-size: 13px;
        border: 1px solid #bc773f;
      }
      .indie-btn__preview--primary {
        background: #bc773f;
        color: #fff;
      }
      .indie-btn__preview--ghost {
        color: #bc773f;
      }
      .indie-btn__warn {
        color: #b42318;
        font-size: 12px;
        margin: 4px 0 0;
      }
    `,
  ]

  private get data(): ActionButtonData {
    return parseData(this.model.data, DEFAULT_BUTTON)
  }
  private persist(p: Partial<ActionButtonData>) {
    this.doc.updateBlock(this.model, { data: JSON.stringify({ ...this.data, ...p }) })
  }

  override renderBlock() {
    const { label, url, variant, note } = this.data
    const ok = /^https:\/\/[^\s]+\.[^\s]+/.test(url) || /^\/(?![/\\])/.test(url)
    return html`
      <div class="indie-block" contenteditable="false" @keydown=${stopEnter}>
        <div class="indie-block__label">Кнопка с действием</div>
        <div class="indie-block__row">
          <input .value=${label} placeholder="Текст кнопки" maxlength="48" @input=${(e: Event) => this.persist({ label: (e.target as HTMLInputElement).value })} />
          <select @change=${(e: Event) => this.persist({ variant: (e.target as HTMLSelectElement).value as ActionButtonData['variant'] })}>
            <option value="primary" ?selected=${variant === 'primary'}>заливка</option>
            <option value="ghost" ?selected=${variant === 'ghost'}>контур</option>
          </select>
        </div>
        <div class="indie-block__row">
          <input .value=${url} placeholder="https://… или /страница" @input=${(e: Event) => this.persist({ url: (e.target as HTMLInputElement).value.trim() })} />
        </div>
        ${ok ? '' : html`<p class="indie-btn__warn">Ссылка — https://… или путь на сайте (/…)</p>`}
        <div class="indie-block__row">
          <input .value=${note} placeholder="Подпись под кнопкой (необязательно)" maxlength="120" @input=${(e: Event) => this.persist({ note: (e.target as HTMLInputElement).value })} />
        </div>
        <span class="indie-btn__preview indie-btn__preview--${variant}">${label || 'Кнопка'}</span>
      </div>
    `
  }
}

if (!customElements.get('affine-actionbutton')) {
  customElements.define('affine-actionbutton', ActionButtonBlockComponent)
}

if (!customElements.get('affine-faq')) {
  customElements.define('affine-faq', FaqBlockComponent)
}

if (!customElements.get('affine-ivideo')) {
  customElements.define('affine-ivideo', IVideoBlockComponent)
}

const CarouselBlockViewExtension = BlockViewExtension(CAROUSEL_FLAVOUR as BlockSuite.Flavour, literal`affine-carousel`)
const PollBlockViewExtension = BlockViewExtension(POLL_FLAVOUR as BlockSuite.Flavour, literal`affine-poll`)
const CalloutBlockViewExtension = BlockViewExtension(CALLOUT_FLAVOUR as BlockSuite.Flavour, literal`affine-callout`)
const UserBlockViewExtension = BlockViewExtension(USER_BLOCK_FLAVOUR as BlockSuite.Flavour, literal`affine-userblock`)
const IVideoBlockViewExtension = BlockViewExtension(IVIDEO_FLAVOUR as BlockSuite.Flavour, literal`affine-ivideo`)
const FaqBlockViewExtension = BlockViewExtension(FAQ_FLAVOUR as BlockSuite.Flavour, literal`affine-faq`)
const ButtonBlockViewExtension = BlockViewExtension(BUTTON_FLAVOUR as BlockSuite.Flavour, literal`affine-actionbutton`)

/**
 * markdown round-trip: сериализуем как ```carousel / ```poll code-фенсы
 * (JSON внутри), по образцу affine:code markdown-матчера из @blocksuite/blocks.
 * Это даёт устойчивый, проверяемый формат и не трогает инфраструктуру
 * code-блока как таковую.
 */
function createFenceMatcher(flavour: string, lang: string): BlockMarkdownAdapterMatcher {
  const isMatchingCodeNode = (node: unknown): node is { type: 'code'; lang?: string | null; value: string } =>
    typeof node === 'object' && node !== null && (node as { type?: string }).type === 'code' && (node as { lang?: string }).lang === lang

  return {
    flavour,
    toMatch: (o) => isMatchingCodeNode(o.node),
    fromMatch: (o) => o.node.flavour === flavour,
    toBlockSnapshot: {
      enter: (o, context) => {
        if (!isMatchingCodeNode(o.node)) return
        context.walkerContext
          .openNode(
            {
              type: 'block',
              id: nanoid(),
              flavour,
              props: { data: o.node.value },
              children: [],
            },
            'children',
          )
          .closeNode()
      },
    },
    fromBlockSnapshot: {
      enter: (o, context) => {
        const data = (o.node.props.data as string) ?? '{}'
        context.walkerContext
          .openNode(
            {
              type: 'code',
              lang,
              meta: null,
              value: data,
            },
            'children',
          )
          .closeNode()
      },
    },
  }
}

export const carouselMarkdownMatcher = createFenceMatcher(CAROUSEL_FLAVOUR, 'carousel')
export const pollMarkdownMatcher = createFenceMatcher(POLL_FLAVOUR, 'poll')
export const calloutMarkdownMatcher = createFenceMatcher(CALLOUT_FLAVOUR, 'callout')
export const userBlockMarkdownMatcher = createFenceMatcher(USER_BLOCK_FLAVOUR, 'userblock')
export const ivideoMarkdownMatcher = createFenceMatcher(IVIDEO_FLAVOUR, 'ivideo')
export const faqMarkdownMatcher = createFenceMatcher(FAQ_FLAVOUR, 'faq')
export const buttonMarkdownMatcher = createFenceMatcher(BUTTON_FLAVOUR, 'button')

export const CarouselBlockSpec = [BlockMarkdownAdapterExtension(carouselMarkdownMatcher), CarouselBlockViewExtension]
export const PollBlockSpec = [BlockMarkdownAdapterExtension(pollMarkdownMatcher), PollBlockViewExtension]
export const CalloutBlockSpec = [BlockMarkdownAdapterExtension(calloutMarkdownMatcher), CalloutBlockViewExtension]

export const UserBlockSpec = [BlockMarkdownAdapterExtension(userBlockMarkdownMatcher), UserBlockViewExtension]

export const IVideoBlockSpec = [BlockMarkdownAdapterExtension(ivideoMarkdownMatcher), IVideoBlockViewExtension]

export const FaqBlockSpec = [BlockMarkdownAdapterExtension(faqMarkdownMatcher), FaqBlockViewExtension]

export const ButtonBlockSpec = [BlockMarkdownAdapterExtension(buttonMarkdownMatcher), ButtonBlockViewExtension]

export const customBlockSpecs = [...CarouselBlockSpec, ...PollBlockSpec, ...CalloutBlockSpec, ...UserBlockSpec, ...IVideoBlockSpec, ...FaqBlockSpec, ...ButtonBlockSpec]
export const customMarkdownMatchers: BlockMarkdownAdapterMatcher[] = [
  carouselMarkdownMatcher,
  pollMarkdownMatcher,
  calloutMarkdownMatcher,
  userBlockMarkdownMatcher,
  ivideoMarkdownMatcher,
  faqMarkdownMatcher,
  buttonMarkdownMatcher,
]

/** Пункты слэш-меню "/" — добавляются к встроенным, а не заменяют их. */
export interface SlashMenuActionCtx {
  rootComponent: { doc: { addBlock: (flavour: string, props: Record<string, unknown>, parent?: unknown, index?: number) => string; getParent: (model: unknown) => unknown } }
  model: { id: string }
}

function addCustomBlockViaSlashMenu(flavour: string, defaults: Record<string, unknown>, ctx: SlashMenuActionCtx) {
  const { rootComponent, model } = ctx
  const doc = rootComponent.doc as unknown as { getParent: (m: unknown) => { children: { id: string }[] } | null }
  const parent = doc.getParent(model)
  const index = parent ? parent.children.findIndex((c) => c.id === model.id) + 1 : undefined
  rootComponent.doc.addBlock(flavour, defaults, parent, index)
  // заменяемый "/carousel"-текст триггера framework удаляет сам (cleanSpecifiedTail
  // в slash-menu-popover) до вызова action — здесь дополнительная очистка не нужна.
}

/** Свои блоки в «/» — только у Premium с включёнными кастомными блоками */
function userBlocksAllowed(): boolean {
  const caps = getEditorCaps()
  return caps.premium && caps.customBlocksEnabled
}

type SlashShowCtx = { model: { doc: { schema: { flavourSchemaMap: Map<string, unknown> } } } }

export function createCarouselSlashMenuItem() {
  return {
    name: 'Карусель',
    description: 'Вставить карусель изображений.',
    icon: CarouselIcon,
    tooltip: { figure: CarouselTooltip, caption: 'Карусель' },
    alias: ['carousel', 'карусель', 'images'],
    showWhen: ({ model }: SlashShowCtx) => model.doc.schema.flavourSchemaMap.has(CAROUSEL_FLAVOUR),
    action: (ctx: SlashMenuActionCtx) => addCustomBlockViaSlashMenu(CAROUSEL_FLAVOUR, { data: JSON.stringify(DEFAULT_CAROUSEL) }, ctx),
  }
}

export function createPollSlashMenuItem() {
  return {
    name: 'Опрос',
    description: 'Вставить опрос с вариантами ответа.',
    icon: PollIcon,
    tooltip: { figure: PollTooltip, caption: 'Опрос' },
    alias: ['poll', 'опрос', 'голосование'],
    showWhen: ({ model }: SlashShowCtx) => model.doc.schema.flavourSchemaMap.has(POLL_FLAVOUR),
    action: (ctx: SlashMenuActionCtx) => addCustomBlockViaSlashMenu(POLL_FLAVOUR, { data: JSON.stringify(DEFAULT_POLL) }, ctx),
  }
}

/** Экспериментальные блоки — только при включённом Developer preview */
export function devPreviewSlashItems(ctx: SlashMenuActionCtx) {
  if (!getEditorCaps().devPreview || isCompact(ctx)) return []
  return [
    { groupName: 'Developer preview' },
    {
      name: 'Интерактивное видео',
      description: 'Главы, кнопки на кадре, вопросы и ветвление сюжета.',
      alias: ['video', 'видео', 'interactive', 'интерактив'],
      icon: html`<span style="display:flex;width:20px;height:20px;align-items:center;justify-content:center;font-size:14px">🎬</span>`,
      action: (c: SlashMenuActionCtx) => addCustomBlockViaSlashMenu(IVIDEO_FLAVOUR, { data: JSON.stringify(DEFAULT_IVIDEO, null, 2) }, c),
    },
  ]
}

const isCompact = (ctx: SlashMenuActionCtx) => compactDocs.has((ctx as unknown as { model: { doc: object } }).model.doc)

/** FAQ — Premium-автору и только в статье (не в комментариях) */
export function faqSlashItems(ctx: SlashMenuActionCtx) {
  if (!getEditorCaps().premium || isCompact(ctx)) return []
  return [
    {
      name: 'FAQ',
      description: 'Частые вопросы и ответы — для курса или продукта.',
      alias: ['faq', 'вопросы', 'чаво', 'q&a'],
      icon: html`<span style="display:flex;width:20px;height:20px;align-items:center;justify-content:center;font-size:11px;font-weight:800">FAQ</span>`,
      action: (c: SlashMenuActionCtx) => addCustomBlockViaSlashMenu(FAQ_FLAVOUR, { data: JSON.stringify(DEFAULT_FAQ) }, c),
    },
    {
      name: 'Кнопка с действием',
      description: 'Ссылка в виде заметной кнопки: «Записаться», «Купить», «Скачать».',
      alias: ['button', 'кнопка', 'cta', 'действие'],
      icon: html`<span style="display:flex;width:20px;height:20px;align-items:center;justify-content:center;font-size:13px">▶</span>`,
      action: (c: SlashMenuActionCtx) => addCustomBlockViaSlashMenu(BUTTON_FLAVOUR, { data: JSON.stringify(DEFAULT_BUTTON) }, c),
    },
  ]
}

/** Генератор: пункты строятся при каждом открытии меню из актуальных шаблонов автора */
export function userBlockSlashItems(ctx: SlashMenuActionCtx) {
  if (!userBlocksAllowed()) return []
  const defs = getEditorCaps().blockDefs
  if (defs.length === 0) return []
  void ctx
  return [
    { groupName: 'Мои блоки' },
    ...defs.map((def) => ({
      name: def.name,
      description: def.description || (def.mode === 'code' ? 'HTML/CSS-шаблон' : 'Блок из конструктора'),
      alias: [def.name.toLowerCase(), 'мой блок', 'custom'],
      icon: html`<span style="display:flex;width:20px;height:20px;align-items:center;justify-content:center;font-size:${def.icon.length > 2 ? '9px' : '15px'};font-weight:700">${def.icon}</span>`,
      action: (c: SlashMenuActionCtx) =>
        addCustomBlockViaSlashMenu(USER_BLOCK_FLAVOUR, { data: JSON.stringify({ def, values: defaultValues(def) }) }, c),
    })),
  ]
}

/**
 * Охранник документа: у не-Premium любой Premium-блок (вставка из буфера, drag&drop,
 * загрузка черновика, ответ на комментарий) сразу заменяется обычным абзацем с текстом.
 */
export function attachPremiumGuard(doc: {
  slots: { blockUpdated: { on: (fn: (e: { type: string; id: string; flavour: string }) => void) => { dispose: () => void } } }
  getBlock: (id: string) => { model: { data?: string; flavour: string } } | null | undefined
  getParent: (model: unknown) => { children: { id: string }[] } | null
  addBlock: (flavour: string, props: Record<string, unknown>, parent?: unknown, index?: number) => string
  deleteBlock: (model: unknown) => void
  getBlocksByFlavour: (flavour: string) => { model: unknown }[]
}, TextCtor: new (s?: string) => unknown): () => void {
  const compact = compactDocs.has(doc)
  const blocked = (flavour: string) => (compact && ARTICLE_ONLY_FLAVOURS.has(flavour)) || (!getEditorCaps().premium && PREMIUM_FLAVOURS.has(flavour))
  const downgrade = (model: { data?: string; flavour: string }) => {
    if (!blocked(model.flavour)) return
    const parent = doc.getParent(model)
    if (!parent) return
    const index = parent.children.findIndex((c) => c.id === (model as unknown as { id: string }).id)
    let text = ''
    if (model.flavour === USER_BLOCK_FLAVOUR) {
      const d = parseUserBlock(model.data ?? '')
      text = d ? fallbackText(d) : ''
    } else if (model.flavour === BUTTON_FLAVOUR) {
      const b = parseData(model.data ?? '', DEFAULT_BUTTON)
      text = b.url ? `${b.label}: ${b.url}` : b.label
    } else if (model.flavour === FAQ_FLAVOUR) {
      const f = parseData(model.data ?? '', DEFAULT_FAQ)
      text = f.items.map((it) => `${it.q} — ${it.a}`).join(' · ')
    } else {
      try {
        text = String((JSON.parse(model.data ?? '{}') as { text?: string }).text ?? '')
      } catch {
        text = ''
      }
    }
    // сначала вставляем текст, потом удаляем блок: соседи не «прыгают»
    doc.addBlock('affine:paragraph', { text: new TextCtor(text) }, parent, index + 1)
    doc.deleteBlock(model)
  }
  for (const flavour of new Set([...PREMIUM_FLAVOURS, ...ARTICLE_ONLY_FLAVOURS])) for (const b of doc.getBlocksByFlavour(flavour)) downgrade(b.model as never)
  const sub = doc.slots.blockUpdated.on((e) => {
    if (e.type !== 'add' || !blocked(e.flavour)) return
    // после текущей транзакции: удалять блок прямо в обработчике его создания нельзя
    queueMicrotask(() => {
      const b = doc.getBlock(e.id)
      if (b) downgrade(b.model)
    })
  })
  return () => sub.dispose()
}

let slashMenuPatched = false

/** Добавляет пункты "Карусель"/"Опрос"/"Заметка" в стандартное слэш-меню и
 *  убирает из него документные пункты, бессмысленные для статьи (один раз на загрузку модуля). */
export async function registerCustomSlashMenuItems() {
  if (slashMenuPatched) return
  const { AffineSlashMenuWidget } = await import('@blocksuite/blocks')
  const config = AffineSlashMenuWidget.DEFAULT_CONFIG

  // убираем «New Doc»/«Linked Doc» — в редакторе статьи нет мультидокументности;
  // фильтр по фактическому name конфигурации, остальные блоки не трогаем
  const REMOVED = new Set(['New Doc', 'Linked Doc'])
  const filtered = config.items.filter(
    (it) => !REMOVED.has((it as { name?: string }).name ?? ''),
  )
  // вычищаем опустевшие заголовки групп (groupName без пунктов до следующего заголовка)
  const cleaned: unknown[] = []
  for (let i = 0; i < filtered.length; i++) {
    const it = filtered[i] as { groupName?: string }
    if (it.groupName !== undefined) {
      const next = filtered[i + 1] as { groupName?: string } | undefined
      if (!next || next.groupName !== undefined) continue
    }
    cleaned.push(it)
  }
  config.items = cleaned as typeof config.items

  if (config.items.some((it) => (it as { name?: string })?.name === 'Карусель')) {
    slashMenuPatched = true
    return
  }
  config.items.push(
    { groupName: 'Карусель и опрос' } as never,
    createCarouselSlashMenuItem() as never,
    createPollSlashMenuItem() as never,
    // свои блоки автора (Premium); встроенной «Заметки» больше нет — её собирают в конструкторе
    faqSlashItems as never,
    userBlockSlashItems as never,
    devPreviewSlashItems as never,
  )
  slashMenuPatched = true
}
