import { DOODLE_NOTIFICATION_AVATAR } from "@labradoodle/core";

const ICON_SIZE = 96;
let icon: string | undefined;
let rasterizing = false;

// Chromium and Electron do not reliably draw SVG notification icons.
function rasterize(svgUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = ICON_SIZE;
        canvas.height = ICON_SIZE;
        const context = canvas.getContext("2d");
        if (!context) return resolve(undefined);
        context.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(undefined);
      }
    };
    image.onerror = () => resolve(undefined);
    image.src = svgUrl;
  });
}

/** Renders Doodle's icon ahead of the first notification. */
export function prepareNotificationIcon() {
  if (rasterizing) return;
  rasterizing = true;
  void rasterize(DOODLE_NOTIFICATION_AVATAR).then((value) => {
    icon = value;
  });
}

/** Doodle's prepared icon, or undefined to keep the browser default. */
export function notificationIcon(): string | undefined {
  return icon;
}
