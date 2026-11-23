/**
 * Файлы документа BlockSuite. Картинки из markdown (![…](https://…)) храним ссылкой: sourceId = «url:<адрес>».
 * Так в markdown при сохранении остаётся исходный адрес (а не «assets/…»), а соавторы по ссылке видят ту же
 * картинку. Сами байты — через AppView (/api/image-proxy): CSP сайта не пускает браузер к чужим адресам.
 * Остальное (файлы, вставленные в редактор) — в памяти, как у штатного хранилища.
 */
import { toWebp } from '@/lib/imageCompression'

export const URL_SOURCE = 'url:'

export function createEditorBlobSource() {
  const files = new Map<string, Blob>()
  return {
    name: 'weat-editor',
    readonly: false,
    async get(key: string): Promise<Blob | null> {
      const hit = files.get(key)
      if (hit) return hit
      if (!key.startsWith(URL_SOURCE)) return null
      const res = await fetch(`/api/image-proxy?${new URLSearchParams({ url: key.slice(URL_SOURCE.length) })}`).catch(() => null)
      if (!res?.ok) return null
      const blob = await res.blob()
      files.set(key, blob)
      return blob
    },
    async set(key: string, value: Blob) {
      let blob = value
      if (!['image/gif', 'image/svg+xml', 'image/webp'].includes(value.type)) {
        blob = await toWebp(value).catch(() => value)
      }
      files.set(key, blob)
      return key
    },
    async delete(key: string) {
      files.delete(key)
    },
    async list() {
      return [...files.keys()]
    },
  }
}
