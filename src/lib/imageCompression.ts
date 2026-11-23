const MAX_SIDE = 2560
const QUALITY = 0.82

export async function toWebp(source: Blob): Promise<Blob> {
  let image: ImageBitmap | HTMLImageElement
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('ImageBitmap is not supported')
    image = await createImageBitmap(source)
  } catch {
    const url = URL.createObjectURL(source)
    try {
      image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error('Image decoding is not supported'))
        element.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  try {
    const width = 'naturalWidth' in image ? image.naturalWidth : image.width
    const height = 'naturalHeight' in image ? image.naturalHeight : image.height
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
    if (!blob || blob.type !== 'image/webp') throw new Error('WebP encoding is not supported')
    return blob
  } finally {
    if ('close' in image) image.close()
  }
}
