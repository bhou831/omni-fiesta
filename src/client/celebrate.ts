import { useEffect, useRef, type RefObject } from 'react';

// Presentation only: a short firework finale for a saved result the player has just seen arrive.
export const CELEBRATION_COLORS = [
  '#f2bcae',
  '#e08f7a',
  '#d9c5a3',
  '#b8cfbf',
  '#bdcbe0',
  '#c78777',
];

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  decay: number;
}

const BURSTS = [
  [0, 0],
  [-220, -90],
  [240, -60],
  [-120, 110],
  [150, 120],
] as const;

let sparks: Spark[] = [];
let canvas: HTMLCanvasElement | null = null;
let frame = 0;

const motionAllowed = () =>
  !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches;

function ensureCanvas() {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'celebration-canvas';
  const ratio = window.devicePixelRatio || 1;
  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  document.body.appendChild(canvas);
  return canvas;
}

function tick() {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const ratio = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  sparks = sparks.filter((spark) => {
    spark.vy += 0.08;
    spark.vx *= 0.985;
    spark.vy *= 0.985;
    spark.x += spark.vx;
    spark.y += spark.vy;
    spark.life -= spark.decay;
    if (spark.life <= 0) return false;
    ctx.globalAlpha = spark.life;
    ctx.fillStyle = spark.color;
    ctx.beginPath();
    ctx.arc(spark.x * ratio, spark.y * ratio, spark.size * ratio, 0, Math.PI * 2);
    ctx.fill();
    return true;
  });
  if (sparks.length > 0) {
    frame = requestAnimationFrame(tick);
    return;
  }
  frame = 0;
  canvas.remove();
  canvas = null;
}

function burst(x: number, y: number, colors: readonly string[]) {
  ensureCanvas();
  for (let i = 0; i < 80; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 8;
    sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 2.5,
      color: colors[i % colors.length]!,
      life: 1,
      decay: 0.008 + Math.random() * 0.008,
    });
  }
  if (!frame) frame = requestAnimationFrame(tick);
}

/** Five staggered bursts around `target`; does nothing for reduced motion or hidden tabs. */
export function celebrate(target: Element | null, colors: readonly string[] = CELEBRATION_COLORS) {
  if (!motionAllowed()) return;
  const rect = target?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : innerHeight / 2;
  const spread = Math.min(1, innerWidth / 900);
  BURSTS.forEach(([dx, dy], i) =>
    setTimeout(() => {
      if (motionAllowed()) burst(x + dx * spread, y + dy * spread, colors);
    }, i * 260),
  );
}

/** Fires when `active` turns on after mount, so a reload that shows a saved result stays quiet. */
export function useCelebrateOnArrival(
  active: boolean,
  target: RefObject<Element | null>,
  colors?: readonly string[],
) {
  const previous = useRef(active);
  useEffect(() => {
    if (active && !previous.current) celebrate(target.current, colors);
    previous.current = active;
  }, [active]);
}
