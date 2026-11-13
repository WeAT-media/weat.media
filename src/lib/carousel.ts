export interface CarouselSlide {
  url: string
  caption: string
}

/** Разбор carousel-разметки: строки вида «url | подпись». strict=true принимает только http(s)/относительные URL */
export function parseCarouselSlides(raw: string, strict = true): CarouselSlide[] {
  return raw
    .split('\n')
    .map((line) => {
      const [url, ...cap] = line.split('|')
      return { url: (url ?? '').trim(), caption: cap.join('|').trim() }
    })
    .filter((s) => (strict ? /^(https?:\/\/|\/)/.test(s.url) : s.url !== '' || s.caption !== ''))
}

export function slidesToChunk(slides: CarouselSlide[]): string {
  return slides.map((s) => `${s.url}${s.caption ? ` | ${s.caption}` : ''}`).join('\n')
}

const CHUNK_RE = /:::carousel\n([\s\S]*?)\n:::/

export function carouselChunk(text: string): string | null {
  return CHUNK_RE.exec(text)?.[1] ?? null
}

export function replaceCarouselChunk(text: string, slides: CarouselSlide[]): string {
  return text.replace(CHUNK_RE, `:::carousel\n${slidesToChunk(slides)}\n:::`)
}
