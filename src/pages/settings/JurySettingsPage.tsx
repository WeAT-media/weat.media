import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import { Switch } from '@/components/ui/switch'

/** Участие в коллегиях присяжных: отказ/возврат */
export default function JurySettingsPage() {
  const { juryOptOut, setJuryOptOut } = useStore()

  return (
    <Reveal className="border border-border p-6">
      <section aria-label="Участие в суде">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Участие в суде</h2>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-[52ch]">
            <p className="text-sm font-semibold">Служба присяжным</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Отказ освобождает от голосований по делам: кнопки «Виновна/Невиновна» будут закрыты.
              Вернуться можно в любой момент.
            </p>
          </div>
          <Switch
            size="lg"
            checked={!juryOptOut}
            aria-label="Служба присяжным"
            onCheckedChange={(v) => setJuryOptOut(!v)}
          />
        </div>
        {juryOptOut && (
          <p className="meta mt-4 !normal-case tracking-normal text-muted-foreground">
            участие выключено — в делах вы сейчас наблюдатель
          </p>
        )}
      </section>
    </Reveal>
  )
}
