import type { Dood, DoodEyes, DoodForm, DoodState } from "@labradoodle/core";
import type { Rive, ViewModelInstance } from "@rive-app/react-canvas";
import { Fit, Layout, useRive, useViewModelInstanceEnum } from "@rive-app/react-canvas";
import { useEffect, useRef } from "react";
import { doodRiveUrl } from "./rive-runtime.js";

/** The file's names for the eyes we store. */
const RIVE_EYES: Record<DoodEyes, string> = {
  round: "round",
  arch: "dome",
  flat: "cup",
  pill: "tall",
  cross: "cross",
};

/** The canvas overhangs the square by a quarter on every side (dood.css), so jumps are not cut off. */
const BLEED = 0.25 / 1.5;

/** The file blends from its defaults into the look it is given over about 250ms. */
const REVEAL_MS = 320;

function drawInsideBleed(loaded: Pick<Rive, "layout" | "resizeToCanvas">) {
  const whole = loaded.resizeToCanvas.bind(loaded);
  const place = () => {
    whole();
    const { maxX: width, maxY: height } = loaded.layout;
    // A hidden canvas measures 0x0; Rive's setter would resize again on empty bounds forever.
    if (!width || !height) return;
    loaded.layout = new Layout({
      fit: Fit.Contain,
      minX: width * BLEED,
      minY: height * BLEED,
      maxX: width * (1 - BLEED),
      maxY: height * (1 - BLEED),
    });
  };
  loaded.resizeToCanvas = place;
  place();
}

function useEnum(name: string, value: string, instance: ViewModelInstance | null | undefined) {
  const property = useViewModelInstanceEnum(name, instance);
  const set = useRef(property.setValue);
  useEffect(() => {
    set.current = property.setValue;
  });
  const current = property.value;
  useEffect(() => {
    if (current !== null && current !== value) set.current(value);
  }, [current, value]);
}

/** The Rive file animates the character itself; this only sets its view-model enums. */
export default function RiveDood({
  dood,
  form,
  state,
  theme,
  onShown,
}: {
  dood: Dood;
  form: DoodForm;
  state: DoodState;
  theme: "dark" | "light";
  onShown: () => void;
}) {
  const values = {
    colour: dood.color,
    eyes: RIVE_EYES[dood.eyes],
    form,
    shape: dood.shape,
    state,
    theme,
  };
  const initial = useRef(values);
  useEffect(() => {
    initial.current = values;
  });
  const { rive, RiveComponent } = useRive({
    src: doodRiveUrl,
    artboard: "Dood",
    stateMachine: "Agent",
    autoBind: true,
    autoplay: false,
    layout: new Layout({ fit: Fit.Contain }),
    onRiveReady: (loaded) => {
      drawInsideBleed(loaded);
      const view = loaded.viewModelInstance;
      for (const [name, value] of Object.entries(initial.current)) {
        const property = view?.enum(name);
        if (property) property.value = value;
      }
      loaded.play();
      setTimeout(onShown, REVEAL_MS);
    },
  });
  const instance = rive?.viewModelInstance;
  useEnum("state", values.state, instance);
  useEnum("shape", values.shape, instance);
  useEnum("colour", values.colour, instance);
  useEnum("eyes", values.eyes, instance);
  useEnum("theme", values.theme, instance);
  useEnum("form", values.form, instance);
  return <RiveComponent className="labradoodle-dood-canvas" />;
}
