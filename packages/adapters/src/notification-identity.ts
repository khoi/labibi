import { DOODLE_NAME, DOODLE_NOTIFICATION_AVATAR } from "@labradoodle/core";
import { getLogger } from "@labradoodle/logging";

const MAX_AVATAR_BYTES = 1050;

async function renderAvatar(source: string) {
  const comma = source.indexOf(",");
  const bytes = Buffer.from(decodeURIComponent(source.slice(comma + 1)));
  const { default: sharp } = await import("sharp");
  const avatar = await sharp(bytes, { limitInputPixels: 16_777_216 })
    .rotate()
    .resize(40, 40, { fit: "cover" })
    .flatten({ background: "white" })
    .jpeg({ quality: 30 })
    .toBuffer();
  return avatar.length <= MAX_AVATAR_BYTES ? avatar.toString("base64") : undefined;
}

let doodleAvatar: Promise<string | undefined> | undefined;

/** Doodle as a push names it, small enough to travel inside one. Rendered once per process. */
export async function doodleNotificationIdentity() {
  doodleAvatar ??= renderAvatar(DOODLE_NOTIFICATION_AVATAR).catch((error: unknown) => {
    getLogger().error("notification avatar", error);
    return undefined;
  });
  const avatar = await doodleAvatar;
  return { name: DOODLE_NAME, ...(avatar ? { avatar } : {}) };
}
