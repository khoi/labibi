import type { DoodEyes, DoodForm, Dood as DoodLook, DoodPose } from "@labradoodle/core";
import { DOOD_INK, DOOD_PATHS, DOOD_VIEWBOX, doodEyeShapes, shippedHash } from "@labradoodle/core";
import type { CSSProperties } from "react";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAvatarMotionVisibility } from "../hooks/use-avatar-motion-visibility.js";
import { cn } from "../lib/utils.js";
import "./dood.css";

const RiveDood = lazy(async () => await import("./rive-dood.js"));

/** Rive draws doods this size and up; smaller ones stay crisp SVG. */
const RIVE_MIN_SIZE = 20;

/** A change of form passes through the dood itself (about 1.7s), so each one is held this long. */
const FORM_HOLD_MS = 1500;

/** How many slices of the stroke carry the working gradient in the SVG dood. */
const FLOW_SEGMENTS = 24;

const RESTING: DoodPose = { state: "idle", form: "self" };

/** Unit tests run without a canvas; Rive is skipped there and the SVG dood stands in. */
const riveAvailable =
  typeof window !== "undefined" &&
  !(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST;

/** The nearest theme around the dood: the app's root, or a dark surface on a light page. */
function themeAround(element: Element | null): "dark" | "light" {
  const scope = element?.closest<HTMLElement>("[data-theme]") ?? document.documentElement;
  return scope.dataset.theme === "dark" ? "dark" : "light";
}

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
    subtree: true,
  });
  return () => observer.disconnect();
}

function useHeldForm(form: DoodForm): DoodForm {
  const [shown, setShown] = useState(form);
  const changedAt = useRef(0);
  useEffect(() => {
    if (form === shown) return;
    const wait = Math.max(0, changedAt.current + FORM_HOLD_MS - performance.now());
    const timer = setTimeout(() => {
      changedAt.current = performance.now();
      setShown(form);
    }, wait);
    return () => clearTimeout(timer);
  }, [form, shown]);
  return shown;
}

/** A bot's dood: its body, ink and eyes, doing what `pose` says. Square, `size` pixels a side. */
export function Dood({
  dood,
  pose = RESTING,
  size = 24,
  motion = true,
  gaze,
  className,
}: {
  dood: DoodLook;
  pose?: DoodPose;
  size?: number;
  motion?: boolean;
  /** Where the eyes look, in units of the 24-unit box; set, the SVG dood is drawn instead of Rive. */
  gaze?: { x: number; y: number };
  className?: string;
}) {
  const canMove = motion && size >= RIVE_MIN_SIZE;
  const { ref, visible, reducedMotion } = useAvatarMotionVisibility(canMove);
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => themeAround(ref.current),
    () => "light" as const,
  );
  const form = useHeldForm(pose.form);
  const [wantsRive, setWantsRive] = useState(false);
  const [riveShown, setRiveShown] = useState(false);
  useEffect(() => {
    if (riveAvailable && canMove && visible && !reducedMotion && !gaze) setWantsRive(true);
  }, [canMove, visible, reducedMotion, gaze]);
  const rive = wantsRive && canMove && !reducedMotion && !gaze;
  const eyes = pose.eyes ?? dood.eyes;
  const { ink, tone } = DOOD_INK[dood.color];
  const busy = pose.state === "thinking" || pose.state === "working";
  const path = DOOD_PATHS[dood.shape];
  return (
    <span
      aria-hidden="true"
      className={cn("labradoodle-dood", className)}
      data-slot="dood"
      data-shape={dood.shape}
      data-color={dood.color}
      data-state={pose.state}
      data-form={form}
      data-rive={rive && riveShown ? "shown" : rive ? "loading" : undefined}
      data-gaze={gaze ? "" : undefined}
      style={
        {
          "--dood-size": `${size}px`,
          "--dood-ink": ink,
          "--dood-tone": tone,
          "--dood-phase": (shippedHash(`${dood.shape}-${dood.eyes}`) % 997) / 997,
          ...(gaze ? { "--dood-gaze-x": gaze.x, "--dood-gaze-y": gaze.y } : {}),
        } as CSSProperties
      }
    >
      <svg
        ref={ref}
        className="labradoodle-dood-svg"
        viewBox={DOOD_VIEWBOX}
        overflow="visible"
        data-motion={canMove && !reducedMotion && visible}
      >
        <path className="labradoodle-dood-body" d={path} />
        {busy && canMove ? (
          <g className="labradoodle-dood-flow">
            {Array.from({ length: FLOW_SEGMENTS }, (_, index) => (
              <path
                key={index}
                d={path}
                pathLength={1}
                style={
                  {
                    "--mix": `${Math.round(Math.abs(((index + 0.5) * 2) / FLOW_SEGMENTS - 1) * 100)}%`,
                    "--segment": index,
                  } as CSSProperties
                }
              />
            ))}
          </g>
        ) : null}
        <g className="labradoodle-dood-gaze">
          <g className="labradoodle-dood-eyes">
            <DoodEyeShapes eyes={pose.state === "done" ? "flat" : eyes} />
          </g>
        </g>
      </svg>
      {rive ? (
        <Suspense fallback={null}>
          <RiveDood
            dood={{ ...dood, eyes }}
            form={form}
            state={pose.state}
            theme={theme}
            onShown={() => setRiveShown(true)}
          />
        </Suspense>
      ) : null}
    </span>
  );
}

export function DoodEyeShapes({ eyes }: { eyes: DoodEyes }) {
  return doodEyeShapes(eyes).map(({ d, rotate }) => (
    <path
      key={`${d}-${rotate ? "r" : ""}`}
      d={d}
      transform={rotate ? `rotate(-45 ${rotate.cx} ${rotate.cy})` : undefined}
    />
  ));
}
