import { Link } from 'react-router'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import { Switch } from '@/components/ui/switch'
import { remoteId } from '@/lib/remoteFeed'
import { clock } from '@/lib/videoResume'

/** История прочтений и «продолжить с места»: приватно, с аккаунтом — на всех устройствах */
export default function HistorySettingsPage() {
  const { readHistory, clearHistory, videoProgress, prefs, setPrefs } = useStore()
  const enabled = prefs.historyEnabled !== false

  return (
    <Reveal className="border border-border bg-secondary/40 p-6">
      <section aria-label="История прочтений">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">История</h2>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <p className="text-sm font-semibold">Вести историю</p>
            <p className="mt-1 max-w-[56ch] text-sm text-muted-foreground">
              Видна только вам. С аккаунтом — на всех ваших устройствах; после выхода стирается из этого браузера.
            </p>
          </div>
          <Switch size="lg" checked={enabled} aria-label="Вести историю" onCheckedChange={(v) => setPrefs({ historyEnabled: v })} />
        </div>

        {readHistory.length === 0 ? (
          <p className="pt-6 text-sm text-muted-foreground">{enabled ? 'Вы ещё ничего не открывали.' : 'История выключена.'}</p>
        ) : (
          <>
            <ul className="mt-2">
              {readHistory.map((e) => {
                // позиция ролика: ключ плеера — id в индексе (или локальный) и id видео
                const prefix = `${e.uri ? remoteId(e.uri) : e.id}:`
                const resume = e.kind === 'video' ? Object.entries(videoProgress).find(([k]) => k.startsWith(prefix))?.[1] : undefined
                return (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/70 py-3 last:border-b-0">
                    <span className="min-w-0">
                      <Link
                        to={`/article/${e.id}`}
                        className="font-semibold decoration-accent underline-offset-4 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {e.title}
                      </Link>
                      <span className="meta ml-2">
                        {e.kind === 'video' ? 'видео' : 'статья'}
                        {e.author && ` · @${e.author}`}
                      </span>
                    </span>
                    <span className="meta shrink-0">
                      {resume && <span className="mr-2 text-accent">продолжить с {clock(resume.t)}</span>}
                      {new Date(e.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </li>
                )
              })}
            </ul>
            <button type="button" onClick={clearHistory} className="btn-ghost mt-5 !px-3 !py-1.5 !text-[11px]">
              Очистить историю
            </button>
          </>
        )}
      </section>
    </Reveal>
  )
}
