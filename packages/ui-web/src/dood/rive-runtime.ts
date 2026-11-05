import wasmUrl from "@rive-app/canvas/rive.wasm?url";
import wasmFallbackUrl from "@rive-app/canvas/rive_fallback.wasm?url";
import { RuntimeLoader } from "@rive-app/react-canvas";
import riveFile from "./dood.riv?url";

/** The runtime and the character file are served from our own assets, never a CDN. */
RuntimeLoader.setWasmUrl(wasmUrl);
RuntimeLoader.setWasmFallbackUrl(wasmFallbackUrl);

export const doodRiveUrl: string = riveFile;
