/** Знак площадки — колос пшеницы (weat — «we AT»). Тот же рисунок, что в public/favicon.svg */
/** stemClass — цвет стебля: на тёмном фоне (футер) нужен светлый */
export default function WheatMark({ className = 'h-5 w-5', stemClass = 'text-foreground' }: { className?: string; stemClass?: string }) {
  return (
    <svg viewBox="8 4 48 54" className={`text-accent ${className}`} aria-hidden="true">
      <path d="M32 55V19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className={stemClass} />
      <g fill="currentColor">
        <ellipse cx="32" cy="12.5" rx="2.9" ry="5.6" />
        {[22, 31, 40].map((y) => (
          <g key={y}>
            <ellipse cx="26.6" cy={y} rx="2.9" ry="5.6" transform={`rotate(-38 26.6 ${y})`} />
            <ellipse cx="37.4" cy={y} rx="2.9" ry="5.6" transform={`rotate(38 37.4 ${y})`} />
          </g>
        ))}
      </g>
    </svg>
  )
}
