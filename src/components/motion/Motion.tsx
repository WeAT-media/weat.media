import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion, useInView, useReducedMotion } from 'motion/react'
import { motionTokens, reducedFade, springs } from '@/lib/motionTokens'

/** Заголовок, проявляющийся по словам */
export function WordReveal({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.h1
      className={className}
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: reduce ? 0 : motionTokens.stagger.words } } }}
      aria-label={text}
    >
      {text.split(' ').map((w, i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          className="mr-[0.25em] inline-block"
          variants={{
            hidden: { opacity: 0, y: reduce ? 0 : motionTokens.distance.lg },
            visible: { opacity: 1, y: 0, transition: reduce ? reducedFade : springs.gentle },
          }}
        >
          {w}
        </motion.span>
      ))}
    </motion.h1>
  )
}

/** Появление при прокрутке до блока; delay — для лесенки в сетке */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.md }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={reduce ? reducedFade : { ...springs.gentle, delay }}
    >
      {children}
    </motion.div>
  )
}

/**
 * Карточка преимущества: появление лесенкой, подъём при наведении.
 * Состояния visible / hover передаются детям — анимированные иконки играют вместе с карточкой.
 */
export function PerkCard({ children, index }: { children: ReactNode; index: number }) {
  const reduce = useReducedMotion()
  const delay = index * motionTokens.stagger.items
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  // появление играет один раз; после него уход курсора возвращает в rest, а не повторяет вход
  // (иначе люди снова «съезжались», а молоток бил ещё раз)
  const [entered, setEntered] = useState(false)
  const [hover, setHover] = useState(false)
  const state = !inView ? 'hidden' : hover ? 'hover' : entered ? 'rest' : 'visible'
  return (
    <motion.div
      ref={ref}
      className="h-full bg-background p-7 md:p-8"
      initial="hidden"
      animate={state}
      onHoverStart={() => {
        setEntered(true)
        setHover(true)
      }}
      onHoverEnd={() => setHover(false)}
      onAnimationComplete={(def) => def === 'visible' && setEntered(true)}
      variants={{
        hidden: { opacity: 0, y: reduce ? 0 : motionTokens.distance.md },
        visible: { opacity: 1, y: 0, transition: reduce ? reducedFade : { ...springs.gentle, delay } },
        rest: { opacity: 1, y: 0, transition: springs.snappy },
        hover: reduce ? {} : { opacity: 1, y: -motionTokens.distance.sm, transition: springs.snappy },
      }}
    >
      {children}
    </motion.div>
  )
}

/** Число, досчитывающее до значения, когда блок попадает в экран */
export function Counter({ from, to, suffix = '' }: { from: number; to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  useEffect(() => {
    const node = ref.current
    if (!node || !inView) return
    if (reduce) {
      node.textContent = `${to}${suffix}`
      return
    }
    const c = animate(from, to, {
      duration: motionTokens.duration.crawl,
      ease: motionTokens.easing.smooth,
      onUpdate: (v) => (node.textContent = `${Math.round(v)}${suffix}`),
    })
    return () => c.stop()
  }, [inView, from, to, suffix, reduce])
  return <span ref={ref}>{`${reduce ? to : from}${suffix}`}</span>
}

/** Полоса «автору / площадке»: доля автора дорастает от обычной до Premium */
export function SplitBar({ from, to }: { from: number; to: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  return (
    <div ref={ref} className="flex h-3 w-full overflow-hidden rounded-sm bg-primary" role="img" aria-label={`${to}% автору, ${100 - to}% площадке`}>
      <motion.div
        className="h-full origin-left bg-accent"
        style={{ width: '100%' }}
        initial={{ scaleX: reduce ? to / 100 : from / 100 }}
        animate={{ scaleX: inView ? to / 100 : reduce ? to / 100 : from / 100 }}
        transition={reduce ? reducedFade : { duration: motionTokens.duration.crawl, ease: motionTokens.easing.smooth, delay: motionTokens.duration.fast }}
      />
    </div>
  )
}

/** Кнопка: лёгкая пружина при наведении и нажатии; состояние hover получают иконки внутри */
export function Press({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.span
      className="inline-flex"
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileTap="tap"
      variants={{
        rest: { scale: 1 },
        hover: { scale: reduce ? 1 : motionTokens.scale.pop },
        tap: { scale: reduce ? 1 : motionTokens.scale.press },
      }}
      transition={springs.snappy}
    >
      {children}
    </motion.span>
  )
}
