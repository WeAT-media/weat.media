/**
 * Сноска к долям и суммам автору (90% / 99%): это доля от площадки — комиссии платёжного провайдера
 * и банков сюда не входят, их удерживают они. Ставится рядом со «*» у суммы.
 */
export const FEE_NOTE = '* без учёта комиссий платёжного провайдера и банков'

/** мелким шрифтом: оговорка, а не часть предложения */
export default function FeeNote({ className = '' }: { className?: string }) {
  return <p className={`text-[10px] leading-snug text-muted-foreground ${className}`}>{FEE_NOTE}</p>
}
