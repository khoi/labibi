import {
  DOOD_INK,
  DOOD_PATHS,
  DOOD_STROKE_WIDTH,
  DOOD_VIEWBOX,
  doodEyeShapes,
} from "@labradoodle/core";
import { useEffect, useLayoutEffect, useState } from "react";
import { takeSignInPending } from "../lib/sign-in-pending";
import { SSO_CALLBACK_PATH } from "../lib/sso-flow";
import "./sign-in-entrance.css";

const SIGN_IN_PATHS = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  SSO_CALLBACK_PATH,
];

/** After a sign-in, the first signed-in page opens through Doodle's eye. */
export function SignInEntrance({ pathname }: { pathname: string }) {
  const [playing, setPlaying] = useState(false);

  useLayoutEffect(() => {
    if (SIGN_IN_PATHS.includes(pathname) || !takeSignInPending()) return;
    if (navigator.webdriver || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPlaying(true);
  }, [pathname]);

  useEffect(() => {
    if (!playing) return;
    const skip = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      setPlaying(false);
    };
    window.addEventListener("keydown", skip, true);
    window.addEventListener("click", skip, true);
    return () => {
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("click", skip, true);
    };
  }, [playing]);

  if (!playing) return null;
  return (
    <div className="sign-in-entrance" aria-hidden="true" data-sign-in-entrance>
      <div
        className="sign-in-entrance-iris"
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setPlaying(false);
        }}
      />
      <div className="sign-in-entrance-stage">
        <svg className="sign-in-entrance-dood" viewBox={DOOD_VIEWBOX}>
          <path
            className="sign-in-entrance-scribble"
            d={DOOD_PATHS.coil}
            pathLength={1}
            fill="none"
            stroke={DOOD_INK.yellow.ink}
            strokeWidth={DOOD_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g className="sign-in-entrance-glance">
            <g className="sign-in-entrance-eyes">
              {doodEyeShapes("round").map(({ d }) => (
                <path key={d} d={d} />
              ))}
            </g>
          </g>
        </svg>
        <div className="sign-in-entrance-pupil" />
      </div>
    </div>
  );
}
