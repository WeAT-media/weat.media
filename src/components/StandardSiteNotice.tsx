export default function StandardSiteNotice() {
  return (
    <div className="border border-dashed border-border bg-background/50 p-4">
      <p className="text-sm font-semibold">Автоматический перенос в standard.site</p>
      <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
        Бесплатные публичные статьи автоматически попадают в открытую ленту AT Protocol для приложений standard.site.
        Платные материалы и статьи с настройкой «Не индексировать» не переносятся.{' '}
        <a href="https://standard.site/" target="_blank" rel="noreferrer" className="font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Подробнее о standard.site
        </a>
      </p>
    </div>
  )
}
