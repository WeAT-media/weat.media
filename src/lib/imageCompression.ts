const MAX_SIDE = 2560
const QUALITY = 0.82

export async function toWebp(source: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') throw new Error('WebP encoding is not supported')
  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
    if (!blob || blob.type !== 'image/webp') throw new Error('WebP encoding is not supported')
    return blob
  } finally {
    bitmap.close()
  }
}
