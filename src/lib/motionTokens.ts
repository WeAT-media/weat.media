/**
 * Токены анимации (по скиллу motion-foundations, ECC): длительности, кривые, пружины.
 * В компонентах — только эти значения, без чисел «на месте».
 */
export const motionTokens = {
  duration: { instant: 0.08, fast: 0.18, normal: 0.35, slow: 0.6, crawl: 1.0 },
  easing: {
    smooth: [0.22, 1, 0.36, 1] as const,
    sharp: [0.4, 0, 0.2, 1] as const,
  },
  distance: { sm: 8, md: 16, lg: 24 },
  scale: { press: 0.97, pop: 1.03 },
  stagger: { words: 0.06, items: 0.07 },
}

export const springs = {
  snappy: { type: 'spring', stiffness: 300, damping: 30 },
  gentle: { type: 'spring', stiffness: 120, damping: 14 },
} as const

/** «уменьшение движения»: без сдвигов, только прозрачность не дольше 0,2 с */
export const reducedFade = { duration: 0.15 }
