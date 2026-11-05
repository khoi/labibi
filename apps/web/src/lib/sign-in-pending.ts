const PENDING = "rakazo:sign-in-pending";

export function markSignInPending() {
  try {
    sessionStorage.setItem(PENDING, "1");
  } catch {
    // Storage can be unavailable in private modes.
  }
}

export function takeSignInPending() {
  try {
    const pending = sessionStorage.getItem(PENDING) !== null;
    sessionStorage.removeItem(PENDING);
    return pending;
  } catch {
    return false;
  }
}
