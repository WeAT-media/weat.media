/**
 * Файлы документа BlockSuite. Картинки из markdown (![…](https://…)) храним ссылкой: sourceId = «url:<адрес>».
 * Так в markdown при сохранении остаётся исходный адрес (а не «assets/…»), а соавторы по ссылке видят ту же
 * картинку. Сами байты — через AppView (/api/image-proxy): CSP сайта не пускает браузер к чужим адресам.
 * Остальное (файлы, вставленные в редактор) — в общей памяти страницы с LRU-лимитом: предпросмотр создаёт своё
 * хранилище, но получает те же blob по sourceId.
 */
import { toWebp } from '@/lib/imageCompression'
import { uploadEditorImage } from '@/lib/api'

export const URL_SOURCE = 'url:'

const files = new Map<string, Blob>()
const MAX_CACHE_BYTES = 100 * 1024 * 1024

function cacheBlob(key: string, blob: Blob) {
  files.delete(key)
  files.set(key, blob)
  let size = 0
  for (const value of files.values()) size += value.size
  while (size > MAX_CACHE_BYTES && files.size > 1) {
    const oldest = files.keys().next().value!
    size -= files.get(oldest)!.size
    files.delete(oldest)
  }
}

const uploads = new Map<string, Promise<string>>()

export function uploadEditorBlob(key: string, blob: Blob): Promise<string> {
  let pending = uploads.get(key)
  if (!pending) {
    pending = uploadEditorImage(blob).then(({ url }) => {
      cacheBlob(`${URL_SOURCE}${url}`, blob)
      return url
    }).catch((error) => {
      uploads.delete(key)
      throw error
    })
    uploads.set(key, pending)
  }
  return pending
}

export function createEditorBlobSource() {
  return {
    name: 'weat-editor',
    readonly: false,
    async get(key: string): Promise<Blob | null> {
      const hit = files.get(key)
      if (hit) {
        cacheBlob(key, hit)
        return hit
      }
      if (!key.startsWith(URL_SOURCE)) return null
      const res = await fetch(`/api/image-proxy?${new URLSearchParams({ url: key.slice(URL_SOURCE.length) })}`).catch(() => null)
      if (!res?.ok) return null
      const blob = await res.blob()
      cacheBlob(key, blob)
      return blob
    },
    async set(key: string, value: Blob) {
      let blob = value
      if (!['image/gif', 'image/webp'].includes(value.type)) {
        blob = await toWebp(value)
      }
      cacheBlob(key, blob)
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
