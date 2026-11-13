import { motion, useReducedMotion, type Variants } from "motion/react";
import { motionTokens, springs } from "@/lib/motionTokens";

/**
 * Анимированные иконки главной. Состояния приходят от родителя (Press / PerkCard):
 *  rest — покой, hover — наведение, visible — первое появление на экране.
 * При «уменьшении движения» иконки статичны.
 */

type P = { size?: number; className?: string };

const svg = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
});

const still = (v: Variants, reduce: boolean | null): Variants =>
  reduce ? {} : v;

/**
 * Точка вращения в координатах viewBox (24×24). По умолчанию motion считает origin от рамки самой группы
 * (transform-box: fill-box), и '12px' оказывался не центром иконки — орбиты и молоточек уезжали.
 */
const pivot = (x: number, y: number) => ({
  transformBox: "view-box" as const,
  originX: `${x}px`,
  originY: `${y}px`,
});
const play = {
  duration: motionTokens.duration.slow,
  ease: motionTokens.easing.smooth,
};

/** Стать автором: перо пишет — линия прорисовывается, перо скользит вдоль */
export function WriteIcon({ size = 15, className }: P) {
  const r = useReducedMotion();
  return (
    <svg {...svg(size, className)}>
      <motion.path
        d="M3 20c2.5 0 4-1.5 6-1.5s3 1.5 5 1.5 3-1 4-1"
        variants={still(
          {
            rest: { pathLength: 1 },
            hover: { pathLength: [0, 1], transition: play },
          },
          r,
        )}
      />
      <motion.g
        variants={still(
          {
            rest: { x: 0, y: 0 },
            hover: { x: [-9, 0], y: [2, 0], rotate: [-6, 0], transition: play },
          },
          r,
        )}
      >
        <path d="M14.5 4.5l3 3L9 16H6v-3z" />
        <path d="M13 6l3 3" />
      </motion.g>
    </svg>
  );
}

/** Что такое AT Protocol: электроны вращаются вокруг ядра */
export function AtomIcon({ size = 15, className }: P) {
  const r = useReducedMotion();
  const spin = (deg: number, dir: 1 | -1) =>
    still(
      {
        rest: { rotate: deg },
        hover: {
          rotate: deg + 360 * dir,
          transition: {
            duration: motionTokens.duration.crawl * 1.6,
            ease: "linear",
          },
        },
      },
      r,
    );
  return (
    <svg {...svg(size, className)}>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      {([0, 60, 120] as const).map((deg, i) => (
        <motion.g
          key={deg}
          style={pivot(12, 12)}
          variants={spin(deg, i % 2 ? -1 : 1)}
        >
          <ellipse cx="12" cy="12" rx="10" ry="4" />
          <circle cx="22" cy="12" r="1.3" fill="currentColor" stroke="none" />
        </motion.g>
      ))}
    </svg>
  );
}

/** Премиум: корона с лучами, расходящимися в стороны */
export function CrownRaysIcon({ size = 15, className }: P) {
  const r = useReducedMotion();
  const rays: [number, number, number, number][] = [
    [12, 3.5, 12, 1],
    [5.5, 5, 4, 3.3],
    [18.5, 5, 20, 3.3],
  ];
  return (
    <svg {...svg(size, className)} viewBox="0 0 24 24">
      {rays.map(([x1, y1, x2, y2], i) => (
        <motion.line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          variants={still(
            {
              rest: { opacity: 0, pathLength: 0 },
              hover: {
                opacity: [0, 1, 0],
                pathLength: [0, 1, 1],
                transition: { ...play, delay: i * 0.06 },
              },
            },
            r,
          )}
          initial={r ? { opacity: 0 } : undefined}
        />
      ))}
      <motion.g
        variants={still(
          {
            rest: { y: 0 },
            hover: { y: [0, -1.5, 0], transition: springs.snappy },
          },
          r,
        )}
      >
        <path d="M3 9l4 3.5L12 6l5 6.5L21 9l-2 10H5z" />
        <path d="M5 21h14" />
      </motion.g>
    </svg>
  );
}

/** Сообщество людей: двое подходят друг к другу и по очереди приветственно подпрыгивают */
export function PeopleIcon({ size = 18, className }: P) {
  const r = useReducedMotion();
  const side = (dx: number, delay: number) =>
    still(
      {
        rest: { x: 0, y: 0 },
        visible: { x: [dx, 0], transition: springs.gentle },
        hover: {
          y: [0, -2.5, 0],
          transition: {
            duration: motionTokens.duration.normal,
            delay,
            ease: motionTokens.easing.smooth,
          },
        },
      },
      r,
    );
  return (
    <svg {...svg(size, className)}>
      <motion.g variants={side(-4, 0)}>
        <circle cx="8" cy="8" r="3" />
        <path d="M2.5 20c0-3.3 2.5-6 5.5-6s5 2 5.5 4" />
      </motion.g>
      <motion.g variants={side(4, 0.12)}>
        <circle cx="16.5" cy="8" r="3" />
        <path d="M11 18c.5-2 2.5-4 5.5-4s5.5 2.7 5.5 6" />
      </motion.g>
    </svg>
  );
}

/** Суд присяжных: молоточек бьёт по подставке */
export function GavelIcon({ size = 18, className }: P) {
  const r = useReducedMotion();
  const hit = {
    rotate: [0, -28, 4, 0],
    transition: {
      duration: motionTokens.duration.slow,
      times: [0, 0.45, 0.7, 1],
    },
  };
  return (
    <svg {...svg(size, className)}>
      <motion.g
        style={pivot(4, 17)}
        variants={still({ rest: { rotate: 0 }, visible: hit, hover: hit }, r)}
      >
        <path d="M14 4l6 6" />
        <path d="M10.5 7.5l6 6" />
        <path d="M12.3 5.7l6 6-2 2-6-6z" />
        <path d="M11 10l-7 7" />
      </motion.g>
      <motion.path
        d="M3 21h10"
        variants={still(
          {
            rest: { y: 0 },
            visible: {
              y: [0, 0, 1, 0],
              transition: {
                duration: motionTokens.duration.slow,
                times: [0, 0.65, 0.75, 1],
              },
            },
            hover: {
              y: [0, 0, 1, 0],
              transition: {
                duration: motionTokens.duration.slow,
                times: [0, 0.65, 0.75, 1],
              },
            },
          },
          r,
        )}
      />
    </svg>
  );
}

/** Модерация по подписке: весы качаются из стороны в сторону */
export function ScaleIcon({ size = 18, className }: P) {
  const r = useReducedMotion();
  const sway = {
    rotate: [0, -10, 8, -4, 0],
    transition: {
      duration: motionTokens.duration.crawl * 1.2,
      ease: "easeInOut" as const,
    },
  };
  return (
    <svg {...svg(size, className)}>
      <path d="M12 3v18M7 21h10" />
      <motion.g
        style={pivot(12, 5)}
        variants={still({ rest: { rotate: 0 }, visible: sway, hover: sway }, r)}
      >
        <path d="M4 5h16" />
        <path d="M6 5l-3 7a3 3 0 0 0 6 0z" />
        <path d="M18 5l-3 7a3 3 0 0 0 6 0z" />
      </motion.g>
    </svg>
  );
}

/** Premium-блоки: звёзды появляются и гаснут (мерцают, пока на карточку наведена мышь) */
export function SparkleIcon({ size = 18, className }: P) {
  const r = useReducedMotion();
  const star =
    "M0 -5 C0.6 -0.6 0.6 -0.6 5 0 C0.6 0.6 0.6 0.6 0 5 C-0.6 0.6 -0.6 0.6 -5 0 C-0.6 -0.6 -0.6 -0.6 0 -5z";
  const stars: [number, number, number, number][] = [
    [9, 13, 1.4, 0],
    [17.5, 6, 0.8, 0.35],
    [18, 17, 0.6, 0.7],
  ];
  return (
    <svg {...svg(size, className)}>
      {stars.map(([x, y, s, delay], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
          <motion.path
            d={star}
            fill="currentColor"
            variants={still(
              {
                rest: { opacity: 1, scale: 1 },
                visible: {
                  opacity: [0, 1],
                  scale: [0, 1],
                  transition: { ...springs.gentle, delay },
                },
                hover: {
                  opacity: [1, 0.15, 1],
                  scale: [1, 0.4, 1],
                  transition: {
                    duration: motionTokens.duration.crawl,
                    delay,
                    repeat: Infinity,
                  },
                },
              },
              r,
            )}
          />
        </g>
      ))}
    </svg>
  );
}

/** Видео, опросы, карусели: хлопушка — «Мотор!» */
export function ClapperIcon({ size = 18, className }: P) {
  const r = useReducedMotion();
  const clap = {
    rotate: [0, -24, 0],
    transition: {
      duration: motionTokens.duration.normal,
      times: [0, 0.55, 1],
      ease: motionTokens.easing.sharp,
    },
  };
  return (
    <svg {...svg(size, className)}>
      <path d="M3 10h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <motion.g
        style={pivot(3, 10)}
        variants={still({ rest: { rotate: 0 }, visible: clap, hover: clap }, r)}
      >
        <path d="M3 10l1-4.6 17-3.2.8 4.4z" />
        <path d="M8 5.6l2.6 3.4M13 4.6l2.6 3.4M18 3.7l2.4 3.2" />
      </motion.g>
    </svg>
  );
}
