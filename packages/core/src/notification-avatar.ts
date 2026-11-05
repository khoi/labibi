import { DOOD_EYE_INK, DOODLE_DOOD, doodSvgMarkup } from "./dood.js";

/** Doodle's static notification portrait, flattened onto white, so the eyes are inked for a light page. */
export const DOODLE_NOTIFICATION_AVATAR = `data:image/svg+xml,${encodeURIComponent(
  doodSvgMarkup(DOODLE_DOOD, { size: 96, eyeInk: DOOD_EYE_INK.light }),
)}`;
