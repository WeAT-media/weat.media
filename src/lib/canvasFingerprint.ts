const TEXT = 'Nullam dictum felis eu pede mollis'

function draw(withFallbackFont: boolean): string {
  const canvas = document.createElement('canvas')
  canvas.width = 2000
  canvas.height = 200
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#f60'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#111'
  ctx.font = withFallbackFont ? '11pt no-real-font-123' : '18pt Arial'
  ctx.fillText(TEXT, 8, 60)
  if (withFallbackFont) {
    ctx.fillStyle = 'rgba(17, 17, 17, 0.6)'
    ctx.font = '18pt Arial'
    ctx.fillText(`${TEXT} `, 8, 100)
  }
  for (const [x, y, radius, color] of [
    [80, 145, 28, 'rgb(255,0,255)'],
    [140, 145, 28, 'rgb(0,255,255)'],
    [200, 145, 28, 'rgb(255,255,0)'],
    [110, 155, 12, 'rgb(17,17,17)'],
    [170, 155, 12, 'rgb(17,17,17)'],
  ] as const) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvas.toDataURL('image/png')
}

let cached: Promise<string | null> | null = null

/** SHA-256(dataURL с несуществующим шрифтом + '_' + dataURL с Arial); исходные изображения не отправляются. */
export function canvasFingerprint(): Promise<string | null> {
  cached ??= (async () => {
    try {
      const input = `${draw(true)}_${draw(false)}`
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      return null
    }
  })()
  return cached
}
