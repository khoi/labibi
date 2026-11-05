import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge, validators } from "tailwind-merge";

// The web type scale in styles.css. Registered as font sizes so `text-heading2 text-foreground`
// keeps both instead of being merged as two text colours. Enter and exit scales are registered so a
// caller's zoom replaces the component's default instead of racing it in the stylesheet.
const twMerge = extendTailwindMerge<"enter-scale" | "exit-scale">({
  extend: {
    theme: { text: ["caption", "label", "body2", "body1", "heading3", "heading2", "heading1"] },
    classGroups: {
      "enter-scale": [{ "zoom-in": [validators.isAny] }],
      "exit-scale": [{ "zoom-out": [validators.isAny] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
