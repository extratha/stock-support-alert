/**
 * Full page load instead of a client-side transition. After login/logout/session expiry we
 * want every page (and Next's client router cache) fetched fresh with the current cookie,
 * so nothing from the previous session can be shown.
 */
export function hardNavigate(path: string): void {
  window.location.href = path;
}
