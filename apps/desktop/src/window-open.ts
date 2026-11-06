const OAUTH_POPUP_NAMES = new Set([
  "labradoodle-app-connect",
  "labradoodle-mcp-oauth",
  "labradoodle-sso-oauth",
  "labradoodle-model-oauth",
  "labradoodle-plugin-connect",
]);

export function shouldOpenInAppPopup(
  appOrigin: string | null,
  childUrl: string,
  frameName: string,
) {
  let target: URL;
  try {
    target = new URL(childUrl);
  } catch {
    return false;
  }

  if (childUrl === "about:blank" && frameName === "labradoodle-sso-oauth") return true;

  const isHttp = target.protocol === "http:" || target.protocol === "https:";
  if (appOrigin !== null && target.origin === appOrigin) return isHttp;
  return target.protocol === "https:" && OAUTH_POPUP_NAMES.has(frameName);
}

/** Keep auth cookies in the parent app's server-specific session. */
export function oauthPopupSessionPreferences(partition: string | null) {
  return {
    preload: "",
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    ...(partition === null ? {} : { partition }),
  };
}
