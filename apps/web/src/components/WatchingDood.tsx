import type { Dood as DoodLook } from "@labradoodle/core";
import { Dood } from "@labradoodle/ui-web";
import { useEffect, useRef, useState } from "react";

/** Doodle, the dood every bot starts as. */
const DOODLE: DoodLook = { shape: "coil", color: "yellow", eyes: "round" };

/** How far the eyes travel toward the pointer, in units of the dood's 24-unit box. */
const REACH = 1.8;

/** The pointer distance, in pixels, at which the eyes reach the edge of their travel. */
const FULL_GAZE_AT = 240;

/** Doodle, whose eyes follow the pointer around the page; under Reduce Motion it looks ahead. */
export function WatchingDood({ size }: { size: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const look = () => {
      frame = 0;
      const box = ref.current?.getBoundingClientRect();
      if (!box || !pointer) return;
      const dx = pointer.x - (box.left + box.width / 2);
      const dy = pointer.y - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy);
      const pull = Math.min(1, distance / FULL_GAZE_AT) * REACH;
      const next =
        distance === 0 ? { x: 0, y: 0 } : { x: (dx / distance) * pull, y: (dy / distance) * pull };
      setGaze((current) =>
        Math.abs(current.x - next.x) < 0.02 && Math.abs(current.y - next.y) < 0.02 ? current : next,
      );
    };
    const move = (event: PointerEvent) => {
      if (reduced?.matches) return;
      pointer = { x: event.clientX, y: event.clientY };
      frame ||= requestAnimationFrame(look);
    };
    const rest = () => {
      pointer = null;
      setGaze({ x: 0, y: 0 });
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", rest);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", rest);
    };
  }, []);
  return (
    <span ref={ref} className="inline-flex" data-testid="watching-dood">
      <Dood dood={DOODLE} size={size} gaze={gaze} />
    </span>
  );
}
