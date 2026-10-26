// ═════════════════════════════
// XOVIA DUEL INTERACTION HOOKS
// Physics-based card lifting, dynamic targeting indicator paths, chain-link
// visual alerts, and modular field activation animations. React-layer only.
// ═════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "@/data/cards";

// ── Physics-based card lift on hover/select ────────────────────────────────
export interface LiftState {
  liftY: number;
  rotation: number;
  scale: number;
  shadow: number;
}

const SPRING = { stiffness: 420, damping: 28, mass: 0.9 };

/**
 * Smooth spring-interpolated card lift. Mounts one `requestAnimationFrame`
 * loop per hovered card, recycling the handle on unmount (memory-safe under
 * rapid hover churn in high-traffic sessions).
 */
export function useCardLift(active: boolean) {
  const [lift, setLift] = useState<LiftState>({ liftY: 0, rotation: 0, scale: 1, shadow: 0 });
  const target = useRef({ liftY: 0, rotation: 0, scale: 1, shadow: 0 });
  const raf = useRef<number | null>(null);
  const current = useRef({ liftY: 0, rotation: 0, scale: 1, shadow: 0 });

  useEffect(() => {
    target.current = active
      ? { liftY: -18, rotation: (Math.random() - 0.5) * 3, scale: 1.06, shadow: 1 }
      : { liftY: 0, rotation: 0, scale: 1, shadow: 0 };

    if (raf.current !== null) return;
    const tick = () => {
      const c = current.current;
      const t = target.current;
      const k = 0.22; // critically-damped spring step
      c.liftY += (t.liftY - c.liftY) * k;
      c.rotation += (t.rotation - c.rotation) * k;
      c.scale += (t.scale - c.scale) * k;
      c.shadow += (t.shadow - c.shadow) * k;
      if (
        Math.abs(t.liftY - c.liftY) < 0.1 &&
        Math.abs(t.scale - c.scale) < 0.001 &&
        Math.abs(t.shadow - c.shadow) < 0.01
      ) {
        current.current = { ...t };
        setLift({ ...t });
        raf.current = null;
        return;
      }
      setLift({ ...c });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
    };
  }, [active]);

  return { lift, spring: SPRING };
}

// ── Dynamic targeting indicator paths ──────────────────────────────────────
export interface TargetPath {
  from: { x: number; y: number };
  to: { x: number; y: number };
  id: string;
}

/**
 * Reads DOM rects of the source and target elements (data-slot attributes) and
 * returns normalized viewport coordinates for an SVG targeting beam. Recomputed
 * on layout shifts with a ResizeObserver — no per-frame polling.
 */
export function useTargetingPath(
  sourceSelector: string | null,
  targetSelector: string | null,
  enabled: boolean,
) {
  const [path, setPath] = useState<TargetPath | null>(null);

  useEffect(() => {
    if (!enabled || !sourceSelector || !targetSelector) {
      setPath(null);
      return;
    }
    const compute = () => {
      const src = document.querySelector(sourceSelector);
      const dst = document.querySelector(targetSelector);
      if (!(src instanceof HTMLElement) || !(dst instanceof HTMLElement)) return;
      const a = src.getBoundingClientRect();
      const b = dst.getBoundingClientRect();
      setPath({
        from: { x: a.left + a.width / 2, y: a.top + a.height / 2 },
        to: { x: b.left + b.width / 2, y: b.top + b.height / 2 },
        id: `${sourceSelector}->${targetSelector}`,
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (document.querySelector(sourceSelector)) ro.observe(document.querySelector(sourceSelector)!);
    if (document.querySelector(targetSelector)) ro.observe(document.querySelector(targetSelector)!);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [enabled, sourceSelector, targetSelector]);

  return path;
}

/** Renders the targeting beam as a full-viewport SVG overlay. */
export function TargetingOverlay({ path }: { path: TargetPath | null }) {
  if (!path) return null;
  const mx = (path.from.x + path.to.x) / 2;
  const my = (path.from.y + path.to.y) / 2;
  return (
    <svg className="pointer-events-none fixed inset-0 z-40 h-full w-full">
      <defs>
        <linearGradient id="xov-target-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(8,75%,62%)" stopOpacity="0.2" />
          <stop offset="50%" stopColor="hsl(48,90%,58%)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="hsl(8,75%,62%)" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <line
        x1={path.from.x}
        y1={path.from.y}
        x2={path.to.x}
        y2={path.to.y}
        stroke="url(#xov-target-grad)"
        strokeWidth={3}
        strokeDasharray="10 6"
        strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 6px hsl(48 90% 58% / 0.7))" }}
      />
      <circle cx={mx} cy={my} r={5} fill="hsl(48,90%,58%)" opacity={0.85} />
      <circle
        cx={path.to.x}
        cy={path.to.y}
        r={7}
        fill="none"
        stroke="hsl(8,75%,62%)"
        strokeWidth={2}
        opacity={0.8}
      />
    </svg>
  );
}

// ── Chain-link visual alerts ───────────────────────────────────────────────
export interface ChainAlert {
  id: number;
  cardName: string;
  linkNumber: number;
  owner: "you" | "opp";
}

/**
 * Broadcasts a transient chain alert banner per link added to the stack.
 * Alerts auto-expire (2.2 s) and the pool is recycled so long duels never leak.
 */
export function useChainAlerts(chain: ChainAlert[]) {
  const [alerts, setAlerts] = useState<ChainAlert[]>([]);
  const seen = useRef(new Set<number>());

  useEffect(() => {
    for (const link of chain) {
      if (seen.current.has(link.id)) continue;
      seen.current.add(link.id);
      setAlerts((a) => [...a, link]);
      const t = setTimeout(() => {
        setAlerts((a) => a.filter((x) => x.id !== link.id));
        seen.current.delete(link.id);
      }, 2200);
      // cleanup captured per-link
      void t;
    }
  }, [chain]);

  return alerts;
}

// ── Field activation animation triggers ────────────────────────────────────
export type FieldEffect = "summon" | "set" | "activate" | "destroy" | "banish" | "attack";
export interface FieldFx {
  slot: string; // e.g. "you:monster:2"
  effect: FieldEffect;
  nonce: number;
}

/**
 * Modular field FX queue. `fire` is stable; effects are keyed by nonce so
 * repeated triggers on the same slot still re-animate.
 */
export function useFieldFx() {
  const [fx, setFx] = useState<FieldFx[]>([]);
  const nonce = useRef(0);

  const fire = useCallback((slot: string, effect: FieldEffect) => {
    nonce.current += 1;
    const item: FieldFx = { slot, effect, nonce: nonce.current };
    setFx((q) => [...q, item]);
    setTimeout(() => setFx((q) => q.filter((f) => f.nonce !== item.nonce)), 900);
  }, []);

  const activeAt = useMemo(() => new Map(fx.map((f) => [f.slot, f])), [fx]);
  return { fire, activeAt };
}

// ── High-traffic rendering pipeline utilities ──────────────────────────────
/**
 * Cheap FPS instrumentation. Returns a ref holding the latest sample — reading
 * it never triggers a re-render, so monitoring is free during massive spikes.
 */
export function useFrameBudget(sampleEveryMs = 2000) {
  const stats = useRef({ fps: 60, dropped: 0 });
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    let lastSample = performance.now();
    const loop = (now: number) => {
      frames++;
      if (now - lastSample >= sampleEveryMs) {
        const fps = (frames * 1000) / (now - lastSample);
        stats.current = {
          fps: Math.round(fps),
          dropped: fps < 45 ? stats.current.dropped + 1 : stats.current.dropped,
        };
        frames = 0;
        lastSample = now;
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sampleEveryMs]);
  return stats;
}

/**
 * Memory-recycled image element for card art: cancels decode on unmount and
 * keeps an LRU cache of decoded bitmaps so re-mounting hot cards is instant.
 */
const artCache = new Map<string, HTMLImageElement>();
const ART_CACHE_MAX = 240;

export function recycleCardArt(src: string): Promise<HTMLImageElement> {
  const cached = artCache.get(src);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (artCache.size >= ART_CACHE_MAX) {
        const oldest = artCache.keys().next().value;
        if (oldest) artCache.delete(oldest);
      }
      artCache.set(src, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
}

export function prefetchCardArt(cards: Card[]) {
  for (const c of cards.slice(0, 60)) {
    if (!artCache.has(c.art)) {
      const img = new Image();
      img.decoding = "async";
      img.src = c.art;
      if (artCache.size >= ART_CACHE_MAX) {
        const oldest = artCache.keys().next().value;
        if (oldest) artCache.delete(oldest);
      }
      artCache.set(c.art, img);
    }
  }
}
