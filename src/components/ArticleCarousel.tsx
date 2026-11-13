import { useEffect, useState } from 'react'
import { parseCarouselSlides } from '@/lib/carousel'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  useCarousel,
} from '@/components/ui/carousel'

function CarouselStatus({ count }: { count: number }) {
  const { api } = useCarousel()
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!api) return
    const onSelect = () => setIndex(api.selectedScrollSnap())
    api.on('select', onSelect)
    return () => {
      api.off('select', onSelect)
    }
  }, [api])

  return (
    <div className="mt-3 flex items-center justify-center gap-1.5" role="tablist" aria-label="Слайды">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          role="tab"
          aria-selected={i === index}
          aria-label={`Слайд ${i + 1} из ${count}`}
          onClick={() => api?.scrollTo(i)}
          className={`h-1.5 cursor-pointer rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            i === index ? 'w-5 bg-accent' : 'w-1.5 bg-border hover:bg-muted-foreground'
          }`}
        />
      ))}
      <span className="meta ml-3">{index + 1}/{count}</span>
    </div>
  )
}

/** Безопасная карусель изображений: только <img>, стрелки/dots/клавиатура, без произвольного HTML */
export default function ArticleCarousel({ raw }: { raw: string }) {
  const slides = parseCarouselSlides(raw)
  if (slides.length === 0) return null

  return (
    <figure className="my-8">
      <Carousel className="w-full" aria-label="Карусель изображений">
        <CarouselContent>
          {slides.map((s, i) => (
            <CarouselItem key={i}>
              <img
                src={s.url}
                alt={s.caption || `Слайд ${i + 1}`}
                loading="lazy"
                className="aspect-[16/9] w-full rounded-md border border-border object-cover"
              />
              {s.caption && <p className="meta mt-2 text-center !normal-case tracking-normal">{s.caption}</p>}
            </CarouselItem>
          ))}
        </CarouselContent>
        {slides.length > 1 && (
          <>
            <CarouselPrevious className="left-2 top-[40%] bg-background/90" />
            <CarouselNext className="right-2 top-[40%] bg-background/90" />
          </>
        )}
        {slides.length > 1 && <CarouselStatus count={slides.length} />}
      </Carousel>
    </figure>
  )
}
