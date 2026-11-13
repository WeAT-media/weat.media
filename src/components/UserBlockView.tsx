import { useMemo } from 'react'
import { CODE_SANDBOX, VISUAL_CSS, parseUserBlock, renderCodeSrcdoc, renderVisualHtml } from '@/lib/userBlocks'

let cssInjected = false
function ensureCss() {
  if (cssInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.dataset.userBlocks = ''
  style.textContent = VISUAL_CSS
  document.head.appendChild(style)
  cssInjected = true
}

/** Пользовательский блок в статье: визуальный — наша разметка с экранированием, код — sandbox-iframe */
export default function UserBlockView({ raw }: { raw: string }) {
  const data = useMemo(() => parseUserBlock(raw), [raw])
  ensureCss()
  if (!data) return null
  if (data.def.mode === 'code') {
    return (
      <iframe
        title={data.def.name}
        sandbox={CODE_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={renderCodeSrcdoc(data)}
        className="my-4 block w-full rounded-md border-0"
        style={{ height: data.def.height }}
      />
    )
  }
  // renderVisualHtml экранирует все значения и собирает только наши пресеты
  return <div className="my-4" dangerouslySetInnerHTML={{ __html: renderVisualHtml(data) }} />
}
