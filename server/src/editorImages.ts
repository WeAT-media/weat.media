import type { Sql } from './db.js'

export interface EditorImage {
  cid: string
  did: string
  mimeType: string
  bytes: Uint8Array
}

export interface EditorImageRepo {
  put(image: EditorImage): Promise<void>
  get(cid: string): Promise<EditorImage | undefined>
}

export function memEditorImages(): EditorImageRepo {
  const images = new Map<string, EditorImage>()
  return {
    async put(image) {
      images.set(image.cid, image)
    },
    async get(cid) {
      return images.get(cid)
    },
  }
}

export function editorImageRepo(sql: Sql): EditorImageRepo {
  return {
    async put(image) {
      await sql`
        INSERT INTO editor_images (cid, did, mime_type, bytes)
        VALUES (${image.cid}, ${image.did}, ${image.mimeType}, ${Buffer.from(image.bytes)})
        ON CONFLICT (cid) DO NOTHING`
    },
    async get(cid) {
      const [row] = await sql<{ cid: string; did: string; mime_type: string; bytes: Buffer }[]>`
        SELECT cid, did, mime_type, bytes FROM editor_images WHERE cid = ${cid}`
      return row && { cid: row.cid, did: row.did, mimeType: row.mime_type, bytes: row.bytes }
    },
  }
}
